// Attaches the processed build to the editable App Store version and files it
// for review.
//
// Usage: node scripts/asc-submit.mjs
import { api, appId, sleep } from './asc-lib.mjs';

const APP = appId();
const TARGET_VERSION = '1.0.0';
const TARGET_BUILD = '1';

const REVIEW_NOTES = `Sift is a notes app that runs entirely on the device.

No account or login is needed. The app opens straight into the notes list and
is fully usable the moment it launches.

There is nothing to purchase. No subscription, no paid tier, no advertising,
and no note limit.

The app makes no network requests of any kind. There is no server, no sync,
no analytics and no third-party SDK that transmits data. Notes are written as
plain Markdown files inside the app's own Documents directory.

Permissions:
- Face ID (NSFaceIDUsageDescription) - used only if the reviewer chooses to
  lock an individual note, via the "..." menu inside a note. iOS performs the
  check and returns only success or failure. If no biometrics are enrolled the
  app simply opens the note, so this can never block review.

Suggested walkthrough:
1. Tap the + button and type a few lines, for example "Meeting notes" then
   "- [ ] send the deck". Lists continue themselves on Return.
2. Tap the back arrow, then type a deliberately misspelled word into the
   search field, such as "meting". The note is still found, and the matching
   words are highlighted in the result.
3. Type "[[" inside a note to link it to another note, then open the
   Connections icon in the top right to see the link graph.
4. Open any note and tap the clock icon to see its full version history.

Contact: hzafar300@gmail.com
`;

async function editableVersion() {
  const versions = await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=10`);
  const version =
    versions.data.find((v) =>
      ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'].includes(
        v.attributes.appStoreState,
      ),
    ) ?? versions.data[0];
  if (!version) throw new Error('no app store version to work with');
  return version;
}

/** The store version string must equal the binary's CFBundleShortVersionString. */
async function alignVersionString(version) {
  if (version.attributes.versionString === TARGET_VERSION) return version;
  await api('PATCH', `/v1/appStoreVersions/${version.id}`, {
    data: {
      type: 'appStoreVersions',
      id: version.id,
      attributes: { versionString: TARGET_VERSION },
    },
  });
  console.log(`• version string ${version.attributes.versionString} -> ${TARGET_VERSION}`);
  return (await api('GET', `/v1/appStoreVersions/${version.id}`)).data;
}

async function waitForBuild() {
  // Two distinct not-ready states: Apple has not ingested the build at all
  // yet, and Apple has it but is still processing. Both need waiting out.
  for (let attempt = 0; attempt < 60; attempt++) {
    const builds = await api(
      'GET',
      `/v1/builds?filter[app]=${APP}&limit=20&sort=-uploadedDate`,
    );
    const match = builds.data.find(
      (b) => b.attributes.version === TARGET_BUILD,
    );
    if (!match) {
      process.stdout.write(attempt === 0 ? '• no builds ingested yet ' : '.');
    } else if (match.attributes.processingState === 'VALID') {
      console.log(`\n• build ${match.attributes.version} is VALID (${match.id})`);
      return match;
    } else if (match.attributes.processingState === 'FAILED') {
      throw new Error('Apple rejected the build during processing');
    } else {
      process.stdout.write(attempt === 0 ? `• build ${match.attributes.processingState} ` : '.');
    }
    await sleep(20000);
  }
  throw new Error('timed out waiting for Apple to process the build');
}

async function attach(versionId, buildId) {
  await api('PATCH', `/v1/appStoreVersions/${versionId}`, {
    data: {
      type: 'appStoreVersions',
      id: versionId,
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    },
  });
  console.log('• build attached to the version');
}

/** Apple blocks submission until the app declares it owns its content. */
async function contentRights() {
  await api('PATCH', `/v1/apps/${APP}`, {
    data: {
      type: 'apps',
      id: APP,
      attributes: { contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' },
    },
  });
  console.log('• content rights declared');
}

/** A price schedule is required even when the price is zero. */
async function freePriceSchedule() {
  // The appPriceSchedule endpoint returns a stub for every app, so its mere
  // existence proves nothing — look for an actual manual price instead.
  const priced = await api(`GET`, `/v1/appPriceSchedules/${APP}/manualPrices?limit=1`)
    .then((r) => (r.data ?? []).length > 0)
    .catch(() => false);
  if (priced) {
    console.log('• price schedule already set');
    return;
  }

  const points = await api(
    'GET',
    `/v1/apps/${APP}/appPricePoints?filter[territory]=USA&limit=200`,
  );
  const free = points.data.find((p) => Number(p.attributes.customerPrice) === 0);
  if (!free) throw new Error('no zero-price point available for USA');

  await api('POST', '/v1/appPriceSchedules', {
    data: {
      type: 'appPriceSchedules',
      relationships: {
        app: { data: { type: 'apps', id: APP } },
        baseTerritory: { data: { type: 'territories', id: 'USA' } },
        manualPrices: { data: [{ type: 'appPrices', id: '${price}' }] },
      },
    },
    included: [
      {
        type: 'appPrices',
        id: '${price}',
        attributes: { startDate: null, endDate: null },
        relationships: {
          appPricePoint: { data: { type: 'appPricePoints', id: free.id } },
        },
      },
    ],
  });
  console.log('• price schedule set: free, all territories');
}

async function reviewDetails(versionId) {
  const existing = await api('GET', `/v1/appStoreVersions/${versionId}/appStoreReviewDetail`)
    .catch(() => null);
  // Same contact details Apple already has on file for this account's other
  // submissions; App Review requires all four fields.
  const attributes = {
    notes: REVIEW_NOTES,
    demoAccountRequired: false,
    contactFirstName: 'Muhammad Hasan',
    contactLastName: 'Zafar',
    contactEmail: 'hzafar300@gmail.com',
    contactPhone: '+19052992752',
  };
  if (existing?.data?.id) {
    await api('PATCH', `/v1/appStoreReviewDetails/${existing.data.id}`, {
      data: { type: 'appStoreReviewDetails', id: existing.data.id, attributes },
    });
  } else {
    await api('POST', '/v1/appStoreReviewDetails', {
      data: {
        type: 'appStoreReviewDetails',
        attributes,
        relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
        },
      },
    });
  }
  console.log('• review notes set');
}

async function fileForReview(versionId) {
  // Reuse an in-progress submission if one exists, otherwise open one.
  const open = await api(
    'GET',
    `/v1/reviewSubmissions?filter[app]=${APP}&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES&limit=10`,
  ).catch(() => ({ data: [] }));

  let submission = open.data?.[0];
  if (!submission) {
    const created = await api('POST', '/v1/reviewSubmissions', {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: 'IOS' },
        relationships: { app: { data: { type: 'apps', id: APP } } },
      },
    });
    submission = created.data;
    console.log('• review submission opened:', submission.id);
  } else {
    console.log('• reusing open review submission:', submission.id, submission.attributes.state);
  }

  const items = await api(
    'GET',
    `/v1/reviewSubmissions/${submission.id}/items?limit=20`,
  ).catch(() => ({ data: [] }));
  const alreadyIncluded = (items.data ?? []).some(
    (i) => i.relationships?.appStoreVersion?.data?.id === versionId,
  );
  if (!alreadyIncluded) {
    await api('POST', '/v1/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.id } },
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
        },
      },
    });
    console.log('• version added to the submission');
  }

  const final = await api('PATCH', `/v1/reviewSubmissions/${submission.id}`, {
    data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } },
  });
  console.log('• submitted, state:', final.data.attributes.state);
  return final.data;
}

(async () => {
  console.log(`App ${APP}`);
  let version = await editableVersion();
  version = await alignVersionString(version);
  const build = await waitForBuild();
  await attach(version.id, build.id);
  await contentRights();
  await freePriceSchedule();
  await reviewDetails(version.id);
  const submission = await fileForReview(version.id);
  console.log(`\n✓ ${submission.attributes.state}`);
  console.log(`  https://appstoreconnect.apple.com/apps/${APP}/distribution`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
