// Turns pnpm's node_modules (packages in .pnpm, reached through symlinks)
// into a plain one: every package once, as a real folder, at the top.
//
// Why: the Windows installer (NSIS) can't store symlinks. It copies what they
// point to instead, so node_modules/next became a copy outside .pnpm and could
// no longer find its own dependencies (@swc/helpers): the installed app didn't
// start. A plain node_modules has no symlinks, so it survives any installer.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

/** The package folders inside one .pnpm/<id>/node_modules, scoped ones (@scope/name) included. */
function packagesIn(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry.startsWith("@")) {
      for (const sub of readdirSync(full)) found.push({ name: `${entry}/${sub}`, dir: path.join(full, sub) });
    } else if (entry !== ".bin") {
      found.push({ name: entry, dir: full });
    }
  }
  return found;
}

function findSymlinks(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) out.push(full);
    else if (stat.isDirectory()) findSymlinks(full, out);
  }
  return out;
}

/** Flattens `<serverDir>/node_modules` in place. Fails the build if it can't be done safely. */
export function flattenNodeModules(serverDir) {
  const modules = path.join(serverDir, "node_modules");
  const store = path.join(modules, ".pnpm");
  if (!existsSync(store)) return { packages: 0 };

  // Each package's real folder lives in .pnpm/<id>/node_modules/<name>; the
  // other entries there are symlinks to its dependencies.
  const real = new Map();
  for (const id of readdirSync(store)) {
    const inner = path.join(store, id, "node_modules");
    if (id === "node_modules" || !existsSync(inner)) continue;
    for (const pkg of packagesIn(inner)) {
      if (lstatSync(pkg.dir).isSymbolicLink()) continue;
      const { version } = JSON.parse(readFileSync(path.join(pkg.dir, "package.json"), "utf8"));
      const seen = real.get(pkg.name);
      if (seen && seen.version !== version) {
        throw new Error(
          `The desktop server needs two versions of ${pkg.name} (${seen.version} and ${version}), so its node_modules can't be made plain. ` +
            `Make the app use one version of it.`,
        );
      }
      if (!seen) real.set(pkg.name, { version, dir: pkg.dir });
    }
  }

  // Remove the top-level symlinks (next, react, react-dom), then move each real package to the top.
  for (const pkg of packagesIn(modules)) {
    if (pkg.name !== ".pnpm" && lstatSync(pkg.dir).isSymbolicLink()) rmSync(pkg.dir);
  }
  for (const [name, { dir }] of real) {
    const to = path.join(modules, name);
    if (existsSync(to)) throw new Error(`The desktop server has ${name} twice in node_modules.`);
    mkdirSync(path.dirname(to), { recursive: true });
    renameSync(dir, to);
  }
  rmSync(store, { recursive: true, force: true });

  const left = findSymlinks(serverDir);
  if (left.length) throw new Error(`The desktop server still has symlinks, which the Windows installer would break:\n${left.join("\n")}`);
  return { packages: real.size };
}
