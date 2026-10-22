import { createECDH, randomBytes } from 'node:crypto';
// @ts-expect-error - no type definitions for http_ece
import ece from 'http_ece';
import worker, { deliverDue, type Env } from './index';
import { bytesToB64url } from './webpush';

/** In-memory stand-in for the handful of D1 queries the worker issues. */
function fakeD1() {
  const devices = new Map<string, { id: string; secret_hash: string; subscription: string }>();
  const reminders = new Map<string, { device_id: string; key: string; at: number; title: string; body: string }>();
  const stats = { maxParams: 0 };
  function statement(sql: string, args: any[] = []): any {
    const q = sql.replace(/\s+/g, ' ').trim();
    return {
      bind: (...a: any[]) => {
        stats.maxParams = Math.max(stats.maxParams, a.length);
        return statement(sql, a);
      },
      async first() {
        const d = devices.get(args[0]);
        return d ?? null;
      },
      async all() {
        const results = [...reminders.values()]
          .filter((r) => r.at <= args[0] && devices.has(r.device_id))
          .sort((a, b) => a.at - b.at)
          .map((r) => ({ ...r, subscription: devices.get(r.device_id)!.subscription }));
        return { results };
      },
      async run() {
        if (q.startsWith('INSERT INTO devices')) {
          const old = devices.get(args[0]);
          devices.set(args[0], { id: args[0], secret_hash: old?.secret_hash ?? args[1], subscription: args[2] });
        } else if (q.startsWith('INSERT OR REPLACE INTO reminders')) {
          for (let i = 0; i < args.length; i += 5) {
            const [device_id, key, at, title, body] = args.slice(i, i + 5);
            reminders.set(`${device_id}|${key}`, { device_id, key, at, title, body });
          }
        } else if (q === 'DELETE FROM reminders WHERE device_id = ? AND key = ?') {
          reminders.delete(`${args[0]}|${args[1]}`);
        } else if (q === 'DELETE FROM reminders WHERE device_id = ?') {
          for (const k of [...reminders.keys()]) if (k.startsWith(`${args[0]}|`)) reminders.delete(k);
        } else if (q === 'DELETE FROM devices WHERE id = ?') {
          devices.delete(args[0]);
        } else throw new Error(`unexpected SQL: ${q}`);
        return {};
      },
    };
  }
  return {
    devices,
    reminders,
    get maxParams() {
      return stats.maxParams;
    },
    db: { prepare: (sql: string) => statement(sql), batch: async (s: any[]) => Promise.all(s.map((x) => x.run())) } as unknown as D1Database,
  };
}

async function setup() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
  const store = fakeD1();
  const env: Env = {
    DB: store.db,
    VAPID_PUBLIC_KEY: bytesToB64url(await crypto.subtle.exportKey('raw', pair.publicKey)),
    VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
    VAPID_SUBJECT: 'https://example.com/',
    ALLOWED_ORIGINS: 'https://raythomas4721.github.io,http://localhost:5173',
  };
  const phone = createECDH('prime256v1');
  phone.generateKeys();
  const auth = randomBytes(16);
  const subscription = {
    endpoint: 'https://web.push.apple.com/QGfake',
    keys: { p256dh: phone.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  };
  const creds = { deviceId: 'a'.repeat(32), secret: 'b'.repeat(48) };
  const call = (method: string, path: string, body: unknown, origin = 'https://raythomas4721.github.io') =>
    worker.fetch(new Request(`https://push.test${path}`, { method, headers: { Origin: origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
  return { env, store, phone, auth, subscription, creds, call };
}

afterEach(() => vi.unstubAllGlobals());

describe('push worker', () => {
  it('subscribes a device and rejects someone else reusing its id', async () => {
    const { call, creds, subscription, store } = await setup();
    expect((await call('POST', '/api/subscribe', { ...creds, subscription })).status).toBe(200);
    expect(store.devices.size).toBe(1);
    const hijack = await call('POST', '/api/subscribe', { ...creds, secret: 'c'.repeat(48), subscription });
    expect(hijack.status).toBe(403);
  });

  it('replaces the reminder list and validates input', async () => {
    const { call, creds, subscription, store } = await setup();
    await call('POST', '/api/subscribe', { ...creds, subscription });
    const now = Date.now();
    const r = (key: string, at: number) => ({ key, at, title: '積木城市', body: '你有一件事項要做' });
    expect((await call('PUT', '/api/reminders', { ...creds, reminders: [r('a_1', now + 60_000), r('b_1', now + 120_000), r('old', now - 1000)] })).status).toBe(200);
    expect([...store.reminders.values()].map((x) => x.key).sort()).toEqual(['a_1', 'b_1']); // past ones dropped
    await call('PUT', '/api/reminders', { ...creds, reminders: [r('c_1', now + 60_000)] });
    expect([...store.reminders.values()].map((x) => x.key)).toEqual(['c_1']); // whole list replaced
    expect((await call('PUT', '/api/reminders', { ...creds, secret: 'c'.repeat(48), reminders: [] })).status).toBe(403);
    expect((await call('PUT', '/api/reminders', { ...creds, reminders: [{ key: 'bad key!', at: 1, title: '', body: '' }] })).status).toBe(400);
  });

  it('stores large reminder lists in batches of 20 rows', async () => {
    const { call, creds, subscription, store } = await setup();
    await call('POST', '/api/subscribe', { ...creds, subscription });
    const now = Date.now();
    const reminders = Array.from({ length: 450 }, (_, i) => ({ key: `w_${i}`, at: now + 60_000 + i * 1000, title: 't', body: 'b' }));
    expect((await call('PUT', '/api/reminders', { ...creds, reminders })).status).toBe(200);
    expect(store.reminders.size).toBe(450);
    expect(store.maxParams).toBeLessThanOrEqual(100);
    const tooMany = Array.from({ length: 1001 }, (_, i) => ({ key: `w_${i}`, at: now + 60_000, title: 't', body: 'b' }));
    expect((await call('PUT', '/api/reminders', { ...creds, reminders: tooMany })).status).toBe(400);
  });

  it('sends due reminders as encrypted pushes the phone can read', async () => {
    const { call, creds, subscription, store, env, phone, auth } = await setup();
    await call('POST', '/api/subscribe', { ...creds, subscription });
    const now = Date.now();
    await call('PUT', '/api/reminders', {
      ...creds,
      reminders: [
        { key: 'eng_20261021', at: now + 1000, title: '練習英文', body: '21:00 要做・中' },
        { key: 'gym_20261022', at: now + 86_400_000, title: '健身', body: '明天' },
      ],
    });
    const sent: Request[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      sent.push(new Request(url, init));
      return new Response(null, { status: 201 });
    });
    expect(await deliverDue(env, now + 2000)).toBe(1);
    expect(sent).toHaveLength(1);
    const req = sent[0];
    expect(req.url).toBe(subscription.endpoint);
    expect(req.headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(req.headers.get('TTL')).toBe('86400');
    expect(req.headers.get('Authorization')).toMatch(/^vapid t=.+, k=.+$/);
    const plain = ece.decrypt(Buffer.from(await req.arrayBuffer()), { version: 'aes128gcm', privateKey: phone, authSecret: auth });
    expect(JSON.parse(plain.toString('utf8'))).toEqual({ title: '練習英文', body: '21:00 要做・中', tag: 'eng_20261021' });
    expect([...store.reminders.values()].map((x) => x.key)).toEqual(['gym_20261022']);
  });

  it('forgets devices whose subscription is gone', async () => {
    const { call, creds, subscription, store, env } = await setup();
    await call('POST', '/api/subscribe', { ...creds, subscription });
    const now = Date.now();
    await call('PUT', '/api/reminders', { ...creds, reminders: [{ key: 'x_1', at: now + 1000, title: 't', body: 'b' }, { key: 'y_1', at: now + 5000, title: 't', body: 'b' }] });
    vi.stubGlobal('fetch', async () => new Response(null, { status: 410 }));
    await deliverDue(env, now + 10_000);
    expect(store.devices.size).toBe(0);
    expect(store.reminders.size).toBe(0);
  });

  it('skips reminders that are hours late instead of sending them', async () => {
    const { call, creds, subscription, store, env } = await setup();
    await call('POST', '/api/subscribe', { ...creds, subscription });
    const now = Date.now();
    await call('PUT', '/api/reminders', { ...creds, reminders: [{ key: 'x_1', at: now + 1000, title: 't', body: 'b' }] });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await deliverDue(env, now + 7 * 3600_000)).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.reminders.size).toBe(0);
  });

  it('only answers CORS for the app’s own origins', async () => {
    const { env } = await setup();
    const pre = (origin: string) => worker.fetch(new Request('https://push.test/api/reminders', { method: 'OPTIONS', headers: { Origin: origin } }), env);
    expect((await pre('https://raythomas4721.github.io')).headers.get('Access-Control-Allow-Origin')).toBe('https://raythomas4721.github.io');
    expect((await pre('https://evil.example')).headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
