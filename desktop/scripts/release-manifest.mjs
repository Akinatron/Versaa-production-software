// Used by .github/workflows/desktop-release.yml (part of "Check for updates", see UPDATER.md).
// Zips desktop/dist/mac-*/Versaa.app into desktop/release/ and writes update.json next to it,
// which the app reads to know whether it is out of date and to check the download.
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(desktop, "dist");
const folder = readdirSync(dist).find((d) => d.startsWith("mac") && existsSync(path.join(dist, d, "Versaa.app")));
if (!folder) throw new Error("No Versaa.app in desktop/dist.");
const arch = folder === "mac" ? "x64" : folder.replace(/^mac-/, "");

const out = path.join(desktop, "release");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const zipName = `Versaa-mac-${arch}.zip`;
const zip = path.join(out, zipName);
// ditto keeps the app's symlinks and signature intact, which a plain zip does not.
execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", path.join(dist, folder, "Versaa.app"), zip], { stdio: "inherit" });

const git = (args) => execSync(`git ${args}`, { encoding: "utf8" }).trim();
// Recent changes on main: for a merged pull request its title, otherwise the commit subject.
const notes = git("log --first-parent -n 40 --format=%cI%x1f%s%x1f%b%x1e")
  .split("\x1e")
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => {
    const [time, subject, body] = r.split("\x1f");
    const merged = /^Merge pull request #(\d+)/.exec(subject);
    const title = merged ? (body ?? "").split("\n")[0].trim() : subject;
    return { time, text: merged && title ? `${title} (#${merged[1]})` : subject };
  });

const manifest = {
  number: Number(process.env.VERSAA_BUILD_NUMBER) || 0,
  commit: git("rev-parse HEAD"),
  commitTime: git("log -1 --format=%cI"),
  builtAt: new Date().toISOString(),
  zip: zipName,
  sha256: createHash("sha256").update(readFileSync(zip)).digest("hex"),
  size: statSync(zip).size,
  arch,
  notes,
};
writeFileSync(path.join(out, "update.json"), JSON.stringify(manifest, null, 2));
writeFileSync(
  path.join(out, "notes.md"),
  notes
    .slice(0, 15)
    .map((n) => `- ${n.text}`)
    .join("\n") + "\n",
);
console.log(`release/${zipName} (${(manifest.size / 1e6).toFixed(0)} MB) and update.json for build ${manifest.number}`);
