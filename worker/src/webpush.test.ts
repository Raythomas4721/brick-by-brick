import { createECDH, randomBytes } from 'node:crypto';
// @ts-expect-error - no type definitions for http_ece
import ece from 'http_ece';
import { b64urlToBytes, bytesToB64url, encryptPayload, vapidAuthorization } from './webpush';

/** A fake browser subscription: receiver key pair + auth secret. */
function receiver() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}

describe('web push', () => {
  it('encrypts payloads that an independent aes128gcm implementation can decrypt', async () => {
    const r = receiver();
    const message = JSON.stringify({ title: '積木城市', body: '練習英文的時間到了' });
    const body = await encryptPayload(new TextEncoder().encode(message), r.keys);
    const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: r.ecdh, authSecret: r.auth });
    expect(plain.toString('utf8')).toBe(message);
  });

  it('writes the aes128gcm header: salt, record size 4096, 65-byte sender key', async () => {
    const r = receiver();
    const body = await encryptPayload(new Uint8Array([1, 2, 3]), r.keys);
    expect(body.length).toBe(16 + 4 + 1 + 65 + 3 + 1 + 16);
    expect([...body.slice(16, 21)]).toEqual([0, 0, 16, 0, 65]);
  });

  it('signs a VAPID JWT that verifies with the public key', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = bytesToB64url(await crypto.subtle.exportKey('raw', pair.publicKey));
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const auth = await vapidAuthorization('https://web.push.apple.com/abc', { publicKey, privateJwk, subject: 'https://example.com/' }, 1_000_000);
    const [, jwt, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(publicKey);
    const [h, c, s] = jwt.split('.');
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(c)));
    expect(claims).toEqual({ aud: 'https://web.push.apple.com', exp: 1000 + 3600, sub: 'https://example.com/' });
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      b64urlToBytes(s),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });
});
