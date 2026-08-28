# Shipping Sift to the App Store

Everything here is scripted. The only manual step is the first one, because the
signing key cannot be copied automatically.

## 0. Put the credentials in place (manual, one line)

The App Store Connect API key and the Expo auth token live in the QR Forge
project. Copy them across:

```bash
cp "C:/Users/Hasan/Desktop/fable 5/QR-Code-Generator/credentials/asckey.p8" "D:/Note Taking App/credentials/asckey.p8" && cp "C:/Users/Hasan/Desktop/fable 5/QR-Code-Generator/.expotoken" "D:/Note Taking App/.expotoken"
```

Both are gitignored and must never be committed.

## 1. Signing credentials

Registers the bundle id `com.hasanzafar.sift`, creates a distribution
certificate and an App Store provisioning profile, and writes
`credentials.json`. No interactive Apple login.

```bash
node scripts/gen-ios-creds.mjs
```

EAS Build cannot create these non-interactively from environment variables — it
fails with "Distribution Certificate is not validated for non-interactive
builds" — which is why they are made here and handed to EAS as local
credentials.

## 2. EAS project

```bash
npx eas-cli@latest init --non-interactive --force
```

Then put the returned project id into `app.json` under
`expo.extra.eas.projectId` (it is currently a placeholder of zeros).

## 3. Build

```bash
npx eas-cli@latest build --platform ios --profile production --non-interactive
```

## 4. Create the App Store record

```bash
node scripts/asc-metadata.mjs
```

Writes the app record, the listing copy from `store/metadata.mjs`, the
categories and the age rating. Check the copy first:

```bash
node scripts/check-metadata.mjs
```

## 5. Availability — do not skip this

```bash
node scripts/asc-availability.mjs
```

A newly created app has **no** `appAvailabilities` record at all, and setting a
price does not create one. Without this step the app can be approved, sit at
READY_FOR_SALE, and still be on sale in zero territories with every storefront
reporting "not available in this region". Nothing in the submit flow warns you.
Verify with `GET /v2/appAvailabilities/{appId}` — a 404 means on sale nowhere.

## 6. Screenshots

```bash
npx expo start --web --port 8097
```

```bash
node scripts/make-screenshots.mjs && node scripts/asc-screenshots.mjs
```

The screenshots are captured from the real running app, driven with real clicks
and typing. Note that there is no `APP_IPHONE_69` display type — the 1320×2868
assets go into `APP_IPHONE_67`.

## 7. Submit

```bash
npx eas-cli@latest submit --platform ios --profile production --non-interactive
```

```bash
node scripts/asc-submit.mjs
```

## Known gotchas, learned the hard way

- `whatsNew` returns 409 on a first version; only send it when the version
  string is not `1.0`.
- `ageRatingDeclaration` attributes are all null on a fresh app and mix boolean
  and enum types. `asc-metadata.mjs` self-corrects from the API's own type
  errors, retrying up to six times.
- Submission blockers surface only as `associatedErrors` on
  `POST /v1/reviewSubmissionItems`: app pricing, `contentRightsDeclaration`, and
  the four review contact fields.
- Price points live at `/v1/apps/{id}/appPricePoints?filter[territory]=USA`.
  `GET /v1/apps/{id}/appPriceSchedule` returns a stub for every app, so check
  `appPriceSchedules/{id}/manualPrices` to know whether a price is really set.
- Guideline 2.3.7: no price references outside the description. The description
  is the only place the word "free" may appear. `check-metadata.mjs` enforces
  this.
