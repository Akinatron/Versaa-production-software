/**
 * Facts about this copy of the app, written in by scripts/build.mjs.
 * See desktop/UPDATER.md.
 */
export type BuildInfo = {
  /** GitHub Actions run number of the build, or 0 for a copy built on a Mac by hand. */
  number: number;
  /** The main commit it was built from. */
  commit: string;
  /** When that commit was made (ISO). Newer commit time = newer app. */
  commitTime: string;
  builtAt: string;
  /** "owner/name" of the GitHub repository whose releases hold the updates. */
  repo: string;
};

declare const __VERSAA_BUILD__: BuildInfo;

export const build: BuildInfo = __VERSAA_BUILD__;
