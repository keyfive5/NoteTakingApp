// Sets territory availability for the app.
//
// A new app record has NO appAvailabilities resource at all. Pricing being
// set is not enough: without this, an approved app goes READY_FOR_SALE and
// still shows "Removed from App Store", and every storefront answers "not
// available in this region". Creating the record with every territory marked
// available is what actually puts it on sale.
//
// Usage: node scripts/asc-availability.mjs [--dry]
import { api, appId } from './asc-lib.mjs';

const APP = appId();
const DRY = process.argv.includes('--dry');

async function currentAvailability() {
  return api('GET', `/v2/appAvailabilities/${APP}?include=territoryAvailabilities&limit[territoryAvailabilities]=1`)
    .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
}

async function allTerritories() {
  const ids = [];
  let url = '/v1/territories?limit=200';
  while (url) {
    const page = await api('GET', url);
    for (const t of page.data) ids.push(t.id);
    url = page.links?.next ?? null;
  }
  return ids;
}

(async () => {
  const existing = await currentAvailability();
  if (existing) {
    const total = existing.data.relationships?.territoryAvailabilities?.meta?.paging?.total ?? 0;
    console.log(`• availability record exists: ${total} territories, ` +
      `availableInNewTerritories=${existing.data.attributes.availableInNewTerritories}`);
    if (total > 0) {
      console.log('  nothing to do');
      return;
    }
  } else {
    console.log('• no availability record — the app is on sale nowhere');
  }

  const territories = await allTerritories();
  console.log(`• ${territories.length} territories available to this account`);
  if (DRY) {
    console.log('  (dry run, not writing)');
    return;
  }

  const ref = (t) => `\${ta-${t}}`;
  await api('POST', '/v2/appAvailabilities', {
    data: {
      type: 'appAvailabilities',
      attributes: { availableInNewTerritories: true },
      relationships: {
        app: { data: { type: 'apps', id: APP } },
        territoryAvailabilities: {
          data: territories.map((t) => ({ type: 'territoryAvailabilities', id: ref(t) })),
        },
      },
    },
    included: territories.map((t) => ({
      type: 'territoryAvailabilities',
      id: ref(t),
      attributes: { available: true },
      relationships: { territory: { data: { type: 'territories', id: t } } },
    })),
  });

  const after = await currentAvailability();
  const total = after?.data?.relationships?.territoryAvailabilities?.meta?.paging?.total ?? 0;
  console.log(`\n✓ on sale in ${total} territories, and in new ones automatically`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
