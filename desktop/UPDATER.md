# Check for updates (development only)

While Versaa is being built, the Mac app can update itself from GitHub (on Windows the button only says to install the new version by hand): **Settings → Developer mode → Check for updates**. It is meant for development and is easy to leave out or remove before the app goes to other people.

## How it works

1. When something lands on `main` and the **Check** workflow passes, `.github/workflows/desktop-release.yml` builds Versaa.app on a GitHub Mac and publishes it as a release named `desktop-<build number>`, with the zipped app and an `update.json` (commit, date, file checksum, recent changes). Only the last 5 builds are kept.
2. The button asks GitHub for the latest release. If it comes from a later commit of `main` than the running copy, Settings shows the notice and the list of changes.
3. **Update now**:
   - backs up the database and the uploaded documents to `backups/before-update-<date>/` in the data folder (the last 3 are kept);
   - downloads the new app and checks its checksum against `update.json`;
   - quits, keeps the old app in `updater/previous/` in the data folder, puts the new one where the old one was and opens it.
4. The new app runs the database migrations when it opens, as always. If it can't start, it puts the database back from the backup, moves the failed attempt to `backups/failed-update-<date>/`, and reopens the previous app with a message.

The data folder (`~/Library/Application Support/Versaa/data`) is never inside the app, so swapping the app never touches it. As a general safety rule (not only for the updater), an older copy of Versaa refuses to open a database that a newer copy has already migrated.

No token, password or key is stored anywhere: the app reads public releases, so **the repository must be public** while this is used. With a private repository the button says it can't find a published version.

The builds are for Apple silicon Macs (GitHub's `macos-latest` runners).

## The first time

The copy installed now has no updater. Build and install it once by hand on the Mac (`pnpm desktop:mac`, as in the README). From then on use the button.

## Leaving it out of a build

```sh
VERSAA_UPDATER=0 pnpm desktop:mac
```

That build contains no updater code and no bridge to the page; developer mode says "This copy can't update itself" where the button was.

To leave out developer mode as a whole (Check for updates, Mock data and Delete database), build with `VERSAA_DEVTOOLS=0` too:

```sh
VERSAA_UPDATER=0 VERSAA_DEVTOOLS=0 pnpm desktop:mac
```

For the web version, set `VERSAA_DEVTOOLS=0` in the server's environment.

## Removing it completely

1. Delete `desktop/src/updater/`, `desktop/scripts/release-manifest.mjs`, `.github/workflows/desktop-release.yml`, `src/app/settings/app-updates.tsx`, `test/desktop-updater.test.ts` and this file.
2. In `src/app/settings/page.tsx`, remove the `AppUpdates` import and `<AppUpdates />` (in the developer mode section), and the "Check for updates" line of the developer mode notice in `src/app/settings/developer-dialogs.tsx`.
3. In `desktop/src/main.ts`, remove the lines that mention `updater` (`__VERSAA_UPDATER__`, `preload: updater?.preloadPath`, `setupUpdater`, `markStarted`, `recoverFromFailedStart`).
4. In `desktop/scripts/build.mjs`, remove the `updater` / `buildInfo` lines, the `define` entry and the preload build. In `desktop/package.json`, remove `build/preload.cjs` from `files`. In `desktop/.gitignore`, remove `release/`.
5. On GitHub, delete the `desktop-*` releases and tags.

`git grep -i updater` should then find nothing. The downgrade check in `desktop/src/database.ts` is not part of the updater; keep it.
