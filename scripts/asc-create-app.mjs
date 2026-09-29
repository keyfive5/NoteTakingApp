// Creates the App Store Connect app record and writes its id to .ascappid.
//
// This uses the undocumented `iris` endpoint because the public
// /v1/apps endpoint does not support creating an app. The request shape is
// fussy and was arrived at by trial across several submissions:
//
//   * The app needs BOTH an appStoreVersions and an appInfos relationship,
//     each pointing at a placeholder id defined in `included`.
//   * The appStoreVersion must itself carry an appStoreVersionLocalizations
//     relationship. Without it the whole request 409s with no useful message.
//   * The appInfo needs an appInfoLocalizations relationship carrying the name.
//
// Usage: node scripts/asc-create-app.mjs
import fs from 'fs';
import path from 'path';
import { api, ROOT } from './asc-lib.mjs';
import * as M from '../store/metadata.mjs';

const BUNDLE = 'com.hasanzafar.sift';
const SKU = 'SIFT2026';
const LOCALE = 'en-US';

/** Names to try in order; App Store names must be globally unique. */
const NAMES = [
  M.NAME,
  'Sift — Notes and Search',
  'Sift Notes — Find Anything',
  'Sift: Markdown Notes',
];

function body(name) {
  return {
    data: {
      type: 'apps',
      attributes: { bundleId: BUNDLE, name, primaryLocale: LOCALE, sku: SKU },
      relationships: {
        appStoreVersions: { data: [{ type: 'appStoreVersions', id: '${new-version}' }] },
        appInfos: { data: [{ type: 'appInfos', id: '${new-appinfo}' }] },
      },
    },
    included: [
      {
        type: 'appStoreVersions',
        id: '${new-version}',
        attributes: { platform: 'IOS', versionString: '1.0' },
        relationships: {
          appStoreVersionLocalizations: {
            data: [{ type: 'appStoreVersionLocalizations', id: '${new-vloc}' }],
          },
        },
      },
      {
        type: 'appStoreVersionLocalizations',
        id: '${new-vloc}',
        attributes: { locale: LOCALE },
      },
      {
        type: 'appInfos',
        id: '${new-appinfo}',
        relationships: {
          appInfoLocalizations: {
            data: [{ type: 'appInfoLocalizations', id: '${new-iloc}' }],
          },
        },
      },
      {
        type: 'appInfoLocalizations',
        id: '${new-iloc}',
        attributes: { locale: LOCALE, name },
      },
    ],
  };
}

// An app for this bundle may already exist from an earlier run.
const existing = await api(
  'GET',
  `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}&limit=10`,
);
if (existing.data?.length) {
  const app = existing.data[0];
  fs.writeFileSync(path.join(ROOT, '.ascappid'), app.id);
  console.log(`• app already exists: ${app.attributes.name} (${app.id})`);
  console.log('✓ .ascappid written');
  process.exit(0);
}

// iris lives on the App Store Connect web host, not on api.appstoreconnect.
// The public /v1/apps endpoint is tried as a fallback in case Apple has since
// made app creation available there.
const ENDPOINTS = [
  'https://appstoreconnect.apple.com/iris/v1/apps',
  '/v1/apps',
];

let created = null;
let lastError = null;
outer: for (const endpoint of ENDPOINTS) {
  for (const name of NAMES) {
    try {
      created = await api('POST', endpoint, body(name));
      console.log(`• created "${name}" via ${endpoint}`);
      break outer;
    } catch (e) {
      lastError = e;
      const errs = e.json?.errors ?? [];
      const text = errs.map((x) => `${x.title} ${x.detail}`).join(' | ');
      if (e.status === 404) {
        console.log(`• ${endpoint} not available here`);
        break;
      }
      if (/name|unique|already in use/i.test(text)) {
        console.log(`• "${name}" unavailable, trying the next one`);
        continue;
      }
      console.log(`• ${endpoint} rejected "${name}": ${text || e.message}`);
      break;
    }
  }
}

if (!created && lastError) throw lastError;

if (!created) throw new Error('every candidate name was unavailable');

const id = created.data.id;
fs.writeFileSync(path.join(ROOT, '.ascappid'), id);
console.log(`• app id ${id}`);
console.log(`• https://appstoreconnect.apple.com/apps/${id}`);
console.log('✓ .ascappid written');
