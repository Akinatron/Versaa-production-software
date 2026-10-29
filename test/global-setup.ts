/**
 * The database tests need TEST_DATABASE_URL. Without it they used to be
 * skipped quietly and the run still looked green. Now the run stops and says
 * so, unless skipping them is asked for with SKIP_DB_TESTS=1.
 */
export default function setup() {
  if (process.env.TEST_DATABASE_URL || process.env.SKIP_DB_TESTS === "1") return;
  throw new Error(
    "TEST_DATABASE_URL is not set, so the database tests can't run. Point it at an empty PostgreSQL database (it is wiped on each run), or set SKIP_DB_TESTS=1 to run only the tests that need no database.",
  );
}
