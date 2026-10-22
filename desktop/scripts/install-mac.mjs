// Copies the freshly built Versaa.app into /Applications, replacing the old one.
// Your data is not in the app (it lives in ~/Library/Application Support/Versaa), so nothing is lost.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const folder = readdirSync(dist).find((d) => d.startsWith("mac") && existsSync(path.join(dist, d, "Versaa.app")));
if (!folder) throw new Error("No Versaa.app in desktop/dist. Run `pnpm desktop:mac` first.");
const target = "/Applications/Versaa.app";
try {
  execFileSync("osascript", ["-e", 'tell application "Versaa" to quit'], { stdio: "ignore" });
} catch {
  // Not running.
}
rmSync(target, { recursive: true, force: true });
execFileSync("ditto", [path.join(dist, folder, "Versaa.app"), target], { stdio: "inherit" });
console.log(`Installed ${target}. Open it from Applications or Launchpad.`);
