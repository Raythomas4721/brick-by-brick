import { IMPORTANCE, type Reminder } from '../tasks/types';
import { formatDate } from '../util';
import { PUSH_API, VAPID_PUBLIC_KEY } from './config';

export interface PushCredentials {
  deviceId: string;
  secret: string;
}

export interface PushReminder {
  key: string;
  at: number;
  title: string;
  body: string;
}

export type PushSupport = 'ok' | 'not-configured' | 'install-first' | 'unsupported';

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (!PUSH_API) return 'not-configured';
  // iOS only exposes Web Push to apps added to the Home Screen
  if (isIOS() && !isStandalone()) return 'install-first';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ok';
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function call(method: string, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${PUSH_API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(`push ${res.status}${detail.status ? ` / Apple ${detail.status}` : ''}${detail.reason ? ` ${detail.reason}` : ''}`);
  }
}

/** Ask permission, subscribe this device and register it with the backend. Must run from a tap. */
export async function enablePush(existing?: PushCredentials): Promise<PushCredentials> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('permission');
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(VAPID_PUBLIC_KEY) }));
  const creds = existing ?? { deviceId: randomHex(16), secret: randomHex(24) };
  await call('POST', '/api/subscribe', { ...creds, subscription: sub.toJSON() });
  return creds;
}

export async function disablePush(creds: PushCredentials): Promise<void> {
  await call('DELETE', '/api/device', creds).catch(() => undefined);
  const reg = await navigator.serviceWorker.getRegistration();
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
}

export function syncReminders(creds: PushCredentials, reminders: PushReminder[]): Promise<void> {
  return call('PUT', '/api/reminders', { ...creds, reminders });
}

export function sendTestPush(creds: PushCredentials): Promise<void> {
  return call('POST', '/api/test', creds);
}

/** Notification text. Titles stay off the server unless the user opts in. */
export function reminderText(r: Reminder, showTitle: boolean): { title: string; body: string } {
  const imp = IMPORTANCE[r.task.importance].label;
  const when = `${formatDate(r.date)} ${r.task.time}`;
  const lead = r.task.remindBefore > 0 ? `${when} 要做` : `現在（${when}）`;
  return showTitle
    ? { title: r.task.title.slice(0, 100), body: `${lead}・${imp}` }
    : { title: '積木城市', body: `市長，你有一件${imp}重要性的事項${lead}` };
}
