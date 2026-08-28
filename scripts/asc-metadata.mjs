// Pushes the listing copy from store/metadata.mjs into App Store Connect:
// name and subtitle on the app info localization, everything else on the
// version localization. Also sets the categories and the age rating.
//
// Usage: node scripts/asc-metadata.mjs
import { api, appId } from './asc-lib.mjs';
import * as M from '../store/metadata.mjs';

const APP = appId();

async function versionLocalization() {
  const versions = await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=10`);
  const editable = versions.data.find((v) =>
    ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'].includes(
      v.attributes.appStoreState,
    ),
  ) ?? versions.data[0];
  if (!editable) throw new Error('no editable app store version');
  console.log(`• version ${editable.attributes.versionString} (${editable.attributes.appStoreState})`);

  const locs = await api('GET', `/v1/appStoreVersions/${editable.id}/appStoreVersionLocalizations?limit=20`);
  const en = locs.data.find((l) => l.attributes.locale === 'en-US');
  if (!en) throw new Error('no en-US version localization');

  const attributes = {
    description: M.DESCRIPTION,
    keywords: M.KEYWORDS,
    promotionalText: M.PROMOTIONAL_TEXT,
    supportUrl: M.SUPPORT_URL,
    marketingUrl: M.MARKETING_URL,
  };
  // "What's new" does not exist on a first version and 409s if sent.
  if (editable.attributes.versionString !== '1.0') attributes.whatsNew = M.WHATS_NEW;

  await api('PATCH', `/v1/appStoreVersionLocalizations/${en.id}`, {
    data: { type: 'appStoreVersionLocalizations', id: en.id, attributes },
  });
  console.log('• description, keywords, promo text and URLs set');

  await api('PATCH', `/v1/appStoreVersions/${editable.id}`, {
    data: {
      type: 'appStoreVersions',
      id: editable.id,
      attributes: { copyright: M.COPYRIGHT, releaseType: 'AFTER_APPROVAL' },
    },
  });
  console.log('• copyright set, release after approval');
  return { versionId: editable.id, localizationId: en.id };
}

async function appInfo() {
  const infos = await api('GET', `/v1/apps/${APP}/appInfos?limit=10`);
  const editable = infos.data.find((i) =>
    ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'].includes(
      i.attributes.appStoreState,
    ),
  ) ?? infos.data[0];
  if (!editable) throw new Error('no editable app info');

  const locs = await api('GET', `/v1/appInfos/${editable.id}/appInfoLocalizations?limit=20`);
  const en = locs.data.find((l) => l.attributes.locale === 'en-US');
  await api('PATCH', `/v1/appInfoLocalizations/${en.id}`, {
    data: {
      type: 'appInfoLocalizations',
      id: en.id,
      attributes: { name: M.NAME, subtitle: M.SUBTITLE, privacyPolicyUrl: M.PRIVACY_URL },
    },
  });
  console.log('• name, subtitle and privacy policy URL set');

  // Categories.
  try {
    await api('PATCH', `/v1/appInfos/${editable.id}`, {
      data: {
        type: 'appInfos',
        id: editable.id,
        relationships: {
          primaryCategory: { data: { type: 'appCategories', id: 'UTILITIES' } },
          secondaryCategory: { data: { type: 'appCategories', id: 'PRODUCTIVITY' } },
        },
      },
    });
    console.log('• categories set: Utilities / Productivity');
  } catch (e) {
    console.log('• categories not set:', e.message.split('\n')[0]);
  }
  return editable.id;
}

/** Keys Apple treats as yes/no rather than a frequency enum. */
const BOOLEAN_KEYS = new Set([
  'advertising', 'ageAssurance', 'gambling', 'healthOrWellnessTopics', 'lootBox',
  'messagingAndChat', 'parentalControls', 'socialMedia', 'socialMediaAgeRestricted',
  'unrestrictedWebAccess', 'userGeneratedContent',
]);

/** Keys that must not be sent at all — set elsewhere or free-form. */
const SKIP_KEYS = new Set([
  'kidsAgeBand', 'ageRatingOverride', 'ageRatingOverrideV2', 'koreaAgeRatingOverride',
  'developerAgeRatingInfoUrl',
]);

async function ageRating(appInfoId) {
  // The declaration hangs off appInfos and mixes boolean and enum attributes,
  // and Apple has changed which is which more than once. Rather than hard-code
  // the split, send a best guess and let the API's own type errors correct it.
  const current = await api('GET', `/v1/appInfos/${appInfoId}/ageRatingDeclaration`);
  const id = current.data.id;
  const attrs = current.data.attributes ?? {};

  const asBoolean = new Set([...BOOLEAN_KEYS]);
  const build = () => {
    const out = {};
    for (const key of Object.keys(attrs)) {
      if (SKIP_KEYS.has(key)) continue;
      out[key] = asBoolean.has(key) ? false : 'NONE';
    }
    return out;
  };

  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await api('PATCH', `/v1/ageRatingDeclarations/${id}`, {
        data: { type: 'ageRatingDeclarations', id, attributes: build() },
      });
      console.log('• age rating declared: no objectionable content (4+)');
      return;
    } catch (e) {
      const errors = e.json?.errors ?? [];
      let corrected = false;
      for (const err of errors) {
        const key = (err.source?.pointer ?? '').split('/').pop();
        if (!key) continue;
        if (/Expected a BOOLEAN/i.test(err.detail ?? '')) {
          asBoolean.add(key);
          corrected = true;
        } else if (/Expected a STRING|Expected an? ENUM/i.test(err.detail ?? '')) {
          asBoolean.delete(key);
          corrected = true;
        } else {
          SKIP_KEYS.add(key);
          corrected = true;
        }
      }
      if (!corrected) throw e;
      console.log(`  (attempt ${attempt}: adjusted ${errors.length} attribute type(s))`);
    }
  }
  throw new Error('could not settle the age rating attribute types');
}

(async () => {
  console.log(`App ${APP}`);
  const infoId = await appInfo();
  await versionLocalization();
  await ageRating(infoId);
  console.log('\n✓ metadata pushed');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
