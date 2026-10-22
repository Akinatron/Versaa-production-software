// Builds everything the desktop app needs into desktop/build:
//   server/   the Next.js app as a self-contained server (next build, output "standalone")
//   drizzle/  the database migrations
//   main.cjs  the desktop shell (src/main.ts and what it imports, bundled)
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "..");
const out = path.join(desktop, "build");

console.log("1/3 Building the app (next build)…");
// Its own build folder, so a `pnpm dev` running from the same checkout is left alone.
const dist = ".next-desktop";
execSync("pnpm build", { cwd: root, stdio: "inherit", env: { ...process.env, NEXT_OUTPUT: "standalone", NEXT_DIST_DIR: dist } });

console.log("2/3 Copying the server and migrations…");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// verbatimSymlinks keeps pnpm's relative links inside node_modules working after the copy.
cpSync(path.join(root, dist, "standalone"), path.join(out, "server"), { recursive: true, verbatimSymlinks: true });
cpSync(path.join(root, dist, "static"), path.join(out, "server", dist, "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(out, "server/public"), { recursive: true });
cpSync(path.join(root, "drizzle"), path.join(out, "drizzle"), { recursive: true });

console.log("3/3 Bundling the desktop shell…");
await build({
  entryPoints: [path.join(desktop, "src/main.ts")],
  outfile: path.join(out, "main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  tsconfig: path.join(root, "tsconfig.json"),
  external: ["electron", "@electric-sql/pglite", "@electric-sql/pglite-socket"],
  logLevel: "warning",
});
console.log("Done: desktop/build");
