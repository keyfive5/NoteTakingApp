// Uploads store/screenshots/*.png to the app's en-US version localization.
//
// Apple's flow: reserve an appScreenshot (which hands back a set of upload
// operations), PUT the bytes to each operation, then mark it uploaded with an
// MD5 of the source file so the service can verify what it received.
//
// Usage: node scripts/asc-screenshots.mjs
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { api, appId, upload, ROOT, sleep } from './asc-lib.mjs';

const DIR = path.join(ROOT, 'store', 'screenshots');

// The API has no 6.9-inch slot: the 1320x2868 assets belong to APP_IPHONE_67,
// which is the modern large-iPhone bucket and accepts that resolution.
const SETS = [
  { prefix: '6.9', displayType: 'APP_IPHONE_67', label: 'large iPhone (6.7 / 6.9 inch)' },
  { prefix: '6.5', displayType: 'APP_IPHONE_65', label: '6.5-inch iPhone' },
];

async function editableLocalization() {
  const versions = await api('GET', `/v1/apps/${appId()}/appStoreVersions?limit=10`);
  const version = versions.data.find((v) =>
    ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'].includes(
      v.attributes.appStoreState,
    ),
  ) ?? versions.data[0];
  const locs = await api('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=20`);
  const en = locs.data.find((l) => l.attributes.locale === 'en-US');
  if (!en) throw new Error('no en-US localization');
  return en.id;
}

async function ensureSet(localizationId, displayType) {
  const existing = await api(
    'GET',
    `/v1/appStoreVersionLocalizations/${localizationId}/appScreenshotSets?limit=50`,
  );
  const found = existing.data.find((s) => s.attributes.screenshotDisplayType === displayType);
  if (found) {
    // Clear it out so re-running is idempotent rather than additive.
    const shots = await api('GET', `/v1/appScreenshotSets/${found.id}/appScreenshots?limit=50`);
    for (const s of shots.data) {
      await api('DELETE', `/v1/appScreenshots/${s.id}`).catch(() => {});
    }
    return found.id;
  }
  const created = await api('POST', '/v1/appScreenshotSets', {
    data: {
      type: 'appScreenshotSets',
      attributes: { screenshotDisplayType: displayType },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: 'appStoreVersionLocalizations', id: localizationId },
        },
      },
    },
  });
  return created.data.id;
}

async function uploadOne(setId, file) {
  const bytes = fs.readFileSync(file);
  const fileName = path.basename(file);

  const reserved = await api('POST', '/v1/appScreenshots', {
    data: {
      type: 'appScreenshots',
      attributes: { fileSize: bytes.length, fileName },
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } },
    },
  });

  const id = reserved.data.id;
  for (const op of reserved.data.attributes.uploadOperations ?? []) {
    await upload(op, bytes.subarray(op.offset, op.offset + op.length));
  }

  await api('PATCH', `/v1/appScreenshots/${id}`, {
    data: {
      type: 'appScreenshots',
      id,
      attributes: {
        uploaded: true,
        sourceFileChecksum: crypto.createHash('md5').update(bytes).digest('hex'),
      },
    },
  });
  return id;
}

(async () => {
  const localizationId = await editableLocalization();
  const uploaded = [];

  for (const set of SETS) {
    const files = fs
      .readdirSync(DIR)
      .filter((f) => f.startsWith(set.prefix + '-') && f.endsWith('.png'))
      .sort();
    if (!files.length) {
      console.log(`• ${set.label}: no files, skipped`);
      continue;
    }
    const setId = await ensureSet(localizationId, set.displayType);
    console.log(`• ${set.label} (${set.displayType}) — ${files.length} screenshots`);
    for (const f of files) {
      const id = await uploadOne(setId, path.join(DIR, f));
      uploaded.push(id);
      console.log(`   uploaded ${f}`);
    }
  }

  // Apple processes asynchronously; a screenshot stuck in a failed state
  // blocks submission, so confirm they all cleared.
  console.log('\nwaiting for Apple to process…');
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(6000);
    const states = [];
    for (const id of uploaded) {
      const s = await api('GET', `/v1/appScreenshots/${id}`);
      states.push(s.data.attributes.assetDeliveryState?.state ?? 'UNKNOWN');
    }
    const pending = states.filter((s) => s === 'UPLOAD_COMPLETE' || s === 'AWAITING_UPLOAD').length;
    const failed = states.filter((s) => s === 'FAILED').length;
    if (failed) throw new Error(`${failed} screenshots failed processing`);
    if (!pending) {
      console.log(`✓ all ${uploaded.length} screenshots are ${[...new Set(states)].join(', ')}`);
      return;
    }
    process.stdout.write('.');
  }
  console.log('\n(still processing — check App Store Connect before submitting)');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
