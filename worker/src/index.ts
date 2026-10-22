/**
 * 積木城市 push backend.
 * The app uploads the next few weeks of reminder times; a cron trigger runs every minute
 * and sends the due ones as Web Push notifications.
 */
import { sendPush, type PushSubscriptionJSON, type Vapid } from './webpush';

export interface Env {
  DB: D1Database;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_JWK: string; // secret
  VAPID_SUBJECT: string;
  ALLOWED_ORIGINS: string; // comma separated
}

interface Reminder {
  key: string;
  at: number;
  title: string;
  body: string;
}

const MAX_REMINDERS = 1000;
/** D1 caps bound parameters per statement, so rows are inserted 20 at a time (5 params each). */
const ROWS_PER_INSERT = 20;
const STALE_MS = 6 * 3600_000; // don't deliver reminders that are hours late (e.g. after an outage)

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  if (!allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function vapid(env: Env): Vapid {
  return { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: env.VAPID_SUBJECT };
}

function validCredentials(body: any): body is { deviceId: string; secret: string } {
  return typeof body?.deviceId === 'string' && /^[a-f0-9]{32}$/.test(body.deviceId)
    && typeof body?.secret === 'string' && /^[a-f0-9]{48}$/.test(body.secret);
}

function validSubscription(s: any): s is PushSubscriptionJSON {
  return typeof s?.endpoint === 'string' && s.endpoint.startsWith('https://')
    && typeof s?.keys?.p256dh === 'string' && typeof s?.keys?.auth === 'string';
}

function validReminder(r: any): r is Reminder {
  return typeof r?.key === 'string' && /^[\w-]{1,80}$/.test(r.key)
    && Number.isFinite(r?.at)
    && typeof r?.title === 'string' && r.title.length <= 120
    && typeof r?.body === 'string' && r.body.length <= 240;
}

/** Returns the device row when deviceId + secret match. */
async function authenticate(env: Env, body: { deviceId: string; secret: string }) {
  const row = await env.DB.prepare('SELECT id, secret_hash, subscription FROM devices WHERE id = ?')
    .bind(body.deviceId)
    .first<{ id: string; secret_hash: string; subscription: string }>();
  if (!row || row.secret_hash !== (await sha256Hex(body.secret))) return null;
  return row;
}

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const json = (data: unknown, status = 200) => Response.json(data, { status });

  if (req.method === 'GET' && url.pathname === '/api/health') return json({ ok: true });

  const body = await req.json().catch(() => null);
  if (!validCredentials(body)) return json({ error: 'bad credentials' }, 400);
  const now = Date.now();

  if (req.method === 'POST' && url.pathname === '/api/subscribe') {
    if (!validSubscription((body as any).subscription)) return json({ error: 'bad subscription' }, 400);
    const hash = await sha256Hex(body.secret);
    const existing = await env.DB.prepare('SELECT secret_hash FROM devices WHERE id = ?').bind(body.deviceId).first<{ secret_hash: string }>();
    if (existing && existing.secret_hash !== hash) return json({ error: 'forbidden' }, 403);
    console.log(JSON.stringify({ event: 'subscribe', device: body.deviceId.slice(0, 6), service: new URL((body as any).subscription.endpoint).host }));
    await env.DB.prepare(
      `INSERT INTO devices (id, secret_hash, subscription, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT(id) DO UPDATE SET subscription = ?3, updated_at = ?4`,
    ).bind(body.deviceId, hash, JSON.stringify((body as any).subscription), now).run();
    return json({ ok: true });
  }

  const device = await authenticate(env, body);
  if (!device) return json({ error: 'forbidden' }, 403);

  if (req.method === 'PUT' && url.pathname === '/api/reminders') {
    const list = (body as any).reminders;
    if (!Array.isArray(list) || list.length > MAX_REMINDERS || !list.every(validReminder)) return json({ error: 'bad reminders' }, 400);
    const future = list.filter((r: Reminder) => r.at > now);
    const inserts = [];
    for (let i = 0; i < future.length; i += ROWS_PER_INSERT) {
      const rows = future.slice(i, i + ROWS_PER_INSERT);
      inserts.push(
        env.DB.prepare(`INSERT OR REPLACE INTO reminders (device_id, key, at, title, body) VALUES ${rows.map(() => '(?, ?, ?, ?, ?)').join(', ')}`)
          .bind(...rows.flatMap((r: Reminder) => [device.id, r.key, r.at, r.title, r.body])),
      );
    }
    await env.DB.batch([env.DB.prepare('DELETE FROM reminders WHERE device_id = ?').bind(device.id), ...inserts]);
    console.log(JSON.stringify({ event: 'sync', device: device.id.slice(0, 6), count: list.length }));
    return json({ ok: true, count: list.length });
  }

  if (req.method === 'POST' && url.pathname === '/api/test') {
    const res = await sendPush(JSON.parse(device.subscription), { title: '積木城市', body: '測試成功！之後的提醒會從這裡跳出來 🏙️', tag: 'test' }, vapid(env));
    const reason = res.ok ? '' : (await res.text()).slice(0, 200);
    console.log(JSON.stringify({ event: 'test', device: device.id.slice(0, 6), status: res.status, reason }));
    return json({ ok: res.ok, status: res.status, reason }, res.ok ? 200 : 502);
  }

  if (req.method === 'DELETE' && url.pathname === '/api/device') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM reminders WHERE device_id = ?').bind(device.id),
      env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(device.id),
    ]);
    return json({ ok: true });
  }

  return json({ error: 'not found' }, 404);
}

/** Send every reminder that is due. */
export async function deliverDue(env: Env, now = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT r.device_id, r.key, r.at, r.title, r.body, d.subscription
     FROM reminders r JOIN devices d ON d.id = r.device_id
     WHERE r.at <= ? ORDER BY r.at LIMIT 200`,
  ).bind(now).all<{ device_id: string; key: string; at: number; title: string; body: string; subscription: string }>();

  let sent = 0;
  const gone = new Set<string>();
  for (const r of results) {
    if (gone.has(r.device_id)) continue;
    if (now - r.at <= STALE_MS) {
      const res = await sendPush(JSON.parse(r.subscription), { title: r.title, body: r.body, tag: r.key }, vapid(env)).catch(() => null);
      if (res?.ok) sent++;
      const reason = res && !res.ok ? (await res.text().catch(() => '')).slice(0, 200) : '';
      console.log(JSON.stringify({ event: 'push', device: r.device_id.slice(0, 6), key: r.key, status: res?.status ?? 'network-error', reason }));
      // the subscription no longer exists (app removed / permission revoked)
      if (res && (res.status === 404 || res.status === 410)) gone.add(r.device_id);
    }
    await env.DB.prepare('DELETE FROM reminders WHERE device_id = ? AND key = ?').bind(r.device_id, r.key).run();
  }
  for (const id of gone) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM reminders WHERE device_id = ?').bind(id),
      env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id),
    ]);
  }
  return sent;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const res = await handle(req, env).catch((e) => Response.json({ error: String(e) }, { status: 500 }));
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },

  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(deliverDue(env));
  },
};
