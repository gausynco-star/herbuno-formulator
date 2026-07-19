// Web Crypto helpers — identical API in Cloudflare Workers and Node 16+ (globalThis.crypto.subtle).
// No Node-only modules, so this runs unchanged in the Worker.

const enc = new TextEncoder();
const dec = new TextDecoder();

async function importKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function hmacHex(secret, message) {
  const sig = await crypto.subtle.sign('HMAC', await importKey(secret), enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacB64url(secret, message) {
  const sig = await crypto.subtle.sign('HMAC', await importKey(secret), enc.encode(message));
  return bytesToB64url(new Uint8Array(sig));
}

// constant-time string compare (equal length assumed; length leak is not sensitive here)
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlEncode(str) {
  return bytesToB64url(enc.encode(str));
}
export function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}
