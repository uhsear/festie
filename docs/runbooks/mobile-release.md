# Mobile release

How to ship the Expo app in `packages/mobile`: when an over-the-air (OTA) update is enough, when a native build is needed, and which steps only the owner can do.

## 1. Version rule

- The app version is `version` in `packages/mobile/app.json`.
- `runtimeVersion.policy` is `appVersion`. An OTA reaches only builds that carry the same app version.
- A native change or an Expo SDK upgrade needs a new `version` and a new build. Do not publish an OTA for it.
- Check the current value in `app.json` before you plan a release. Do not copy a version from a note.

## 2. Decide: OTA or build

1. Open the output of the `mobile-release-gate.yml` workflow. It runs `packages/mobile/scripts/fingerprint-gate.mjs` against `packages/mobile/.fingerprint/baseline.json`.
2. Treat the result as advice. The gate only reports. It does not change the runtime version.
3. If only JavaScript or assets changed, ship an OTA.
4. If native code, a config plugin, a permission or a dependency with native code changed, cut a build.

## 3. Ship an OTA

1. Run the `mobile-ota.yml` workflow with inputs `branch=staging` and a `message`. The workflow also accepts `crash_threshold`. It takes `FESTIE_APPLE_SIGNIN` and `GOOGLE_IOS_URL_SCHEME` from the repository secrets and runs `bash ota.sh --check`. That check blocks an update that would hide Apple or Google sign-in.
2. To publish from your own shell instead, set both variables in that shell, then run `bash packages/mobile/ota.sh --check` and `bash packages/mobile/ota.sh <branch> "<message>"`. Never set them in the EAS environment: `ota.sh` explains why.
3. Check the update on a staging-channel build (the `staging` profile in `packages/mobile/eas.json`).
4. Promote with `eas update:republish --source-branch staging --destination-branch production`. This republishes the same bundle. The header of `mobile-ota.yml` has the full commands.

## 4. Build Android on the free lane

`android-release.yml` builds a signed AAB on a GitHub runner. It costs no EAS credits.

- Start it by hand. Inputs are `submit` (default false) and `track` (default `internal`).
- It signs with the upload key. Play App Signing re-signs the app for users.
- `versionCode` is `VERSION_CODE_OFFSET` plus the run number. The offset is set in the workflow `env` block.
- A failed run still uses up its run number, so the code can skip values. Before a submit, compare the next value (offset plus the next run number) with the highest code in Play Console. Play rejects a code that is not higher.
- `android-e2e.yml` runs a free emulator check every Sunday. Use it for Android smoke tests.

## 5. Build with EAS

EAS builds cost credits. The owner approves each build and each submit.

- Profiles in `packages/mobile/eas.json`: `production`, `staging`, `preview`, `qa-sim`. `appVersionSource` is `remote`. The `production` profile increments the build number itself.
- `submit.production` targets the Android `internal` track as a draft. It also holds the iOS App Store Connect app id.
- For one build, put `FESTIE_APPLE_SIGNIN` and `GOOGLE_IOS_URL_SCHEME` in the `env` block of that build profile in `packages/mobile/eas.json`, then revert the edit. Never create them as EAS environment variables: `ota.sh` publishes with `--environment production`, so they would reach OTAs for binaries that lack the URL scheme. Do not commit a secret value.
- iOS without a Mac: see `docs/runbooks/ios-testing.md`.

## 6. Listing and privacy sources

| Need | Source |
|------|--------|
| Play listing text | `packages/mobile/store/play/listing.en-US.json`, checked by `listing.test.ts` |
| Play listing upload | `packages/mobile/store/play/publish.py`. It reads the service-account key path from the `FESTIE_PLAY_SA_KEY` variable. |
| Privacy answers (Data safety, App Privacy) | The privacy answers file that the store-prep change adds under `packages/mobile/store/`. Until it merges, use `public/privacy.html` and `privacyManifests` in `packages/mobile/app.json`. |
| Apple privacy manifest | `privacyManifests` in `packages/mobile/app.json` |
| Public privacy policy | `public/privacy.html` |
| App Review notes | The review notes file that the store-prep change adds under `packages/mobile/store/`. |
| iOS listing text | The iOS listing folder that the iOS listing change adds under `packages/mobile/store/`. |

Every console answer must match the privacy policy and the privacy manifest. Change all three together.

## 7. Owner-only console steps

An agent cannot do these. Name the step to the owner and wait.

- Google Play Console: closed testing and production access, Data safety, content rating, app content, App Signing.
- App Store Connect: App Privacy, age rating, App Review information, submit for review.
- Google Cloud Console: Firebase API key restrictions.
- EAS: environment variables.
- GitHub: repository secrets.

Never write a secret value, a host or a key path in the repository.

## 8. Before you submit

- [ ] `app.json` `version` matches the release plan.
- [ ] The release gate result matches the choice of OTA or build.
- [ ] The next `versionCode` is higher than the highest code in Play Console.
- [ ] Privacy answers, the privacy manifest and `public/privacy.html` agree.
- [ ] Listing text passes `packages/mobile/store/play/listing.test.ts`.
- [ ] The owner approved any EAS build or submit.
