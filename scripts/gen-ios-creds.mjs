// Generates iOS App Store signing credentials via the App Store Connect API,
// with no interactive Apple login: registers the bundle id, creates a
// distribution certificate (RSA key + CSR made locally with openssl), and an
// App Store provisioning profile. Writes credentials/ and credentials.json.
//
// EAS Build cannot create these non-interactively from env vars — it fails
// with "Distribution Certificate is not validated for non-interactive
// builds" — so they are made here and handed to EAS as local credentials.
//
// Usage: node scripts/gen-ios-creds.mjs
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CRED = path.join(ROOT, 'credentials');
const KEY_ID = 'SVTXG8P9K9';
const ISSUER = 'c46619e9-74be-420a-aaeb-746a63af1a11';
const P8 = path.join(CRED, 'asckey.p8');
const BUNDLE = 'com.hasanzafar.sift';
const BUNDLE_NAME = 'Sift';
const PROFILE_NAME = 'Sift AppStore';
const P12_PASS = 'sift' + crypto.randomBytes(6).toString('hex');
const BASE = 'https://api.appstoreconnect.apple.com';

function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
  const payload = { iss: ISSUER, iat: now - 30, exp: now + 600, aud: 'appstoreconnect-v1' };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const key = crypto.createPrivateKey(fs.readFileSync(P8));
  const sig = crypto.sign('SHA256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${sig.toString('base64url')}`;
}

async function api(method, endpoint, body) {
  const res = await fetch(BASE + endpoint, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${method} ${endpoint} -> ${res.status}\n${JSON.stringify(json, null, 2)}`);
    err.status = res.status; err.json = json;
    throw err;
  }
  return json;
}

const sh = (cmd, args) => execFileSync(cmd, args, { cwd: CRED, encoding: 'utf8' });

async function ensureBundleId() {
  const list = await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE)}&limit=200`);
  const found = (list.data || []).find((b) => b.attributes.identifier === BUNDLE);
  if (found) { console.log('• bundle id exists:', found.id); return found.id; }
  const created = await api('POST', '/v1/bundleIds', {
    data: { type: 'bundleIds', attributes: { identifier: BUNDLE, name: BUNDLE_NAME, platform: 'IOS' } },
  });
  console.log('• bundle id registered:', created.data.id);
  return created.data.id;
}

async function createCertificate() {
  sh('openssl', ['genrsa', '-out', 'dist.key', '2048']);
  sh('openssl', ['req', '-new', '-key', 'dist.key', '-out', 'dist.csr',
    '-subj', '/CN=QR Forge Distribution/O=Hasan Zafar/C=US']);
  const csr = fs.readFileSync(path.join(CRED, 'dist.csr'), 'utf8');

  let created;
  try {
    created = await api('POST', '/v1/certificates', {
      data: { type: 'certificates', attributes: { certificateType: 'IOS_DISTRIBUTION', csrContent: csr } },
    });
  } catch (e) {
    if (e.status === 409 || /maximum/i.test(JSON.stringify(e.json || {}))) {
      // At the cert limit. The old certs' private keys are not on this
      // machine, so they are useless here — revoke the oldest and retry.
      const certs = await api('GET', '/v1/certificates?filter[certificateType]=IOS_DISTRIBUTION&limit=200');
      const sorted = (certs.data || []).sort((a, b) =>
        new Date(a.attributes.expirationDate) - new Date(b.attributes.expirationDate));
      if (sorted.length) {
        console.log('• cert limit reached — revoking oldest:', sorted[0].id);
        await api('DELETE', `/v1/certificates/${sorted[0].id}`);
        created = await api('POST', '/v1/certificates', {
          data: { type: 'certificates', attributes: { certificateType: 'IOS_DISTRIBUTION', csrContent: csr } },
        });
      } else throw e;
    } else throw e;
  }

  const certId = created.data.id;
  fs.writeFileSync(path.join(CRED, 'dist.cer'), Buffer.from(created.data.attributes.certificateContent, 'base64'));
  sh('openssl', ['x509', '-inform', 'DER', '-in', 'dist.cer', '-out', 'dist.pem']);
  sh('openssl', ['pkcs12', '-export', '-legacy', '-out', 'dist.p12',
    '-inkey', 'dist.key', '-in', 'dist.pem', '-passout', `pass:${P12_PASS}`]);
  console.log('• distribution certificate created:', certId);
  return certId;
}

async function createProfile(bundleIdId, certId) {
  const existing = await api('GET', `/v1/profiles?filter[name]=${encodeURIComponent(PROFILE_NAME)}&limit=200`);
  for (const p of existing.data || []) {
    console.log('• removing stale profile:', p.id);
    await api('DELETE', `/v1/profiles/${p.id}`).catch(() => {});
  }
  const created = await api('POST', '/v1/profiles', {
    data: {
      type: 'profiles',
      attributes: { name: PROFILE_NAME, profileType: 'IOS_APP_STORE' },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundleIdId } },
        certificates: { data: [{ type: 'certificates', id: certId }] },
      },
    },
  });
  fs.writeFileSync(
    path.join(CRED, 'sift.mobileprovision'),
    Buffer.from(created.data.attributes.profileContent, 'base64'),
  );
  console.log('• provisioning profile created:', created.data.id);
}

(async () => {
  const bundleIdId = await ensureBundleId();
  const certId = await createCertificate();
  await createProfile(bundleIdId, certId);
  fs.writeFileSync(path.join(ROOT, 'credentials.json'), JSON.stringify({
    ios: {
      provisioningProfilePath: 'credentials/sift.mobileprovision',
      distributionCertificate: { path: 'credentials/dist.p12', password: P12_PASS },
    },
  }, null, 2) + '\n');
  for (const f of ['dist.csr', 'dist.cer', 'dist.pem']) {
    try { fs.unlinkSync(path.join(CRED, f)); } catch {}
  }
  console.log('\n✓ credentials.json written. p12 password stored there.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
