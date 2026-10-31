// electron-builder leaves node_modules folders out of extraResources, and the
// Next.js server needs its own. So the server is copied in here, after packing
// and before signing. Its node_modules has no symlinks (see flatten-node-modules.mjs).
const { cpSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  cpSync(path.join(__dirname, "..", "build", "server"), path.join(resources, "server"), { recursive: true });
};
