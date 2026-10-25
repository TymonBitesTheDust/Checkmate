// Tokens the connector hands out are sealed (AES-GCM) with a key made from the
// secret in CONFIG, so the connector needs no database of its own: a token carries
// everything it needs and can't be read or changed by anyone without the secret.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64u(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const sha256 = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));

let cache = null;
async function keys(secret) {
  if (cache && cache.secret === secret) return cache;
  const aes = await crypto.subtle.importKey('raw', await sha256(`checkmate-connector/aes/${secret}`), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const mac = await crypto.subtle.importKey('raw', await sha256(`checkmate-connector/mac/${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  cache = { secret, aes, mac };
  return cache;
}

const PREFIX = { access: 'cma_', refresh: 'cmr_', code: 'cmc_', request: 'cmq_' };

export async function seal(secret, kind, payload) {
  const { aes } = await keys(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = enc.encode(JSON.stringify({ ...payload, k: kind }));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(kind) }, aes, body));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return PREFIX[kind] + b64u(out);
}

// Returns the payload, or null if the token is not one of ours (or was tampered with).
// An expired token comes back with expired: true so callers can say why.
export async function unseal(secret, kind, token) {
  if (typeof token !== 'string' || !token.startsWith(PREFIX[kind]) || token.length > 16000) return null;
  try {
    const { aes } = await keys(secret);
    const raw = unb64u(token.slice(PREFIX[kind].length));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: enc.encode(kind) }, aes, raw.subarray(12));
    const p = JSON.parse(dec.decode(plain));
    if (p.k !== kind) return null;
    if (p.exp && p.exp < Date.now()) return { ...p, expired: true };
    return p;
  } catch {
    return null;
  }
}

export async function mac(secret, text) {
  const { mac: key } = await keys(secret);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

export async function pkceOk(verifier, challenge) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return b64u(await sha256(verifier)) === challenge;
}

export const randomId = (bytes = 16) => b64u(crypto.getRandomValues(new Uint8Array(bytes)));

// Same length, constant-time compare for secrets.
export function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
