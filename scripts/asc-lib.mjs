// Shared App Store Connect API helpers: ES256 JWT signing and a thin fetch
// wrapper. Every asc-*.mjs script reads the app id from .ascappid.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const KEY_ID = 'SVTXG8P9K9';
export const ISSUER = 'c46619e9-74be-420a-aaeb-746a63af1a11';
const P8 = path.join(ROOT, 'credentials', 'asckey.p8');
export const BASE = 'https://api.appstoreconnect.apple.com';

export function appId() {
  return fs.readFileSync(path.join(ROOT, '.ascappid'), 'utf8').trim();
}

export function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput =
    `${b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.` +
    `${b64({ iss: ISSUER, iat: now - 30, exp: now + 900, aud: 'appstoreconnect-v1' })}`;
  const key = crypto.createPrivateKey(fs.readFileSync(P8));
  const sig = crypto.sign('SHA256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${sig.toString('base64url')}`;
}

export async function api(method, endpoint, body, extraHeaders = {}) {
  const res = await fetch(endpoint.startsWith('http') ? endpoint : BASE + endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${jwt()}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${method} ${endpoint} -> ${res.status}\n${JSON.stringify(json, null, 2)}`);
    err.status = res.status;
    err.json = json;
    throw err;
  }
  return json;
}

/** Raw binary PUT, used for the screenshot upload operations. */
export async function upload(operation, buffer) {
  const headers = {};
  for (const h of operation.requestHeaders ?? []) headers[h.name] = h.value;
  const res = await fetch(operation.url, { method: operation.method, headers, body: buffer });
  if (!res.ok) throw new Error(`upload -> ${res.status} ${await res.text()}`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
