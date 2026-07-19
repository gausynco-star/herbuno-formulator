// Web Crypto helpers — identical API in Cloudflare Workers and Node 16+ (globalThis.crypto.subtle).
// No Node-only modules, so this runs unchanged in the Worker.

const enc = new TextEncoder();
const dec = new TextDecoder();

async function importKey(secret, usage) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}

export async function hmacHex(secret, message) {
  const sig = await crypto.subtle.sign('HMAC', await importKey(secret, ['sign']), enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacB64url(secret, message) {
  const sig = await crypto.subtle.sign('HMAC', await importKey(secret, ['sign']), enc.encode(message));
  return bytesToB64url(new Uint8Array(sig));
}

// Verification via crypto.subtle.verify — the platform primitive is constant-time and not defeated by
// JIT (unlike a hand-written equal-length loop). Malformed signature encodings verify as false.
export async function hmacVerifyHex(secret, message, sigHex) {
  if (typeof sigHex !== 'string' || !/^[0-9a-fA-F]*$/.test(sigHex) || sigHex.length % 2) return false;
  const bytes = new Uint8Array(sigHex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(sigHex.substr(i * 2, 2), 16);
  try { return await crypto.subtle.verify('HMAC', await importKey(secret, ['verify']), bytes, enc.encode(message)); }
  catch { return false; }
}
export async function hmacVerifyB64url(secret, message, sigB64url) {
  const bytes = b64urlToBytes(sigB64url);
  if (!bytes) return false;
  try { return await crypto.subtle.verify('HMAC', await importKey(secret, ['verify']), bytes, enc.encode(message)); }
  catch { return false; }
}

function b64urlToBytes(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9\-_]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch { return null; }
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
