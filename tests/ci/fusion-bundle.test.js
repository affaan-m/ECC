"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const relative = "skills/video-editing/assets/fusion/ito-v28";
const bundle = path.join(root, relative);
const provenance = JSON.parse(fs.readFileSync(path.join(bundle, "provenance.json")));
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

for (const [name, expected] of Object.entries(provenance.files)) {
  assert.equal(digest(fs.readFileSync(path.join(bundle, name))), expected, name);
}
assert.equal(Object.keys(provenance.files).length, 4);
const rgb = fs.readFileSync(path.join(bundle, "ITO_V28_RGBDisplacement.setting"), "utf8");
assert.match(rgb, /ChannelBoolean \{/);
assert.doesNotMatch(rgb, /ChannelBooleans/);
for (const port of ["Background", "Foreground"]) {
  assert.ok(rgb.includes(`${port} = Input { SourceOp = "ITO_V28_RGBBase"`));
}
const readme = fs.readFileSync(path.join(bundle, "README.md"), "utf8");
assert.match(readme, /not recommended production defaults/);
assert.match(readme, /channel remapping/);
assert.match(readme, /static rectangular/);
assert.match(readme, /no subject detection or tracking/);
assert.match(readme, /ImportFusionComp/);
assert.match(readme, /provenance.json/);
assert.ok(JSON.parse(fs.readFileSync(path.join(root, "package.json"))).files.includes("skills/video-editing/"));
console.log("Fusion source hashes, registered wiring, scope and package ownership passed.");

const productionRelative = "skills/video-editing/assets/fusion/ito-production-v1";
const production = path.join(root, productionRelative);
const productionProvenance = JSON.parse(fs.readFileSync(path.join(production, "provenance.json")));
assert.equal(Object.keys(productionProvenance.files).length, 4);
for (const [name, expected] of Object.entries(productionProvenance.files)) {
  assert.equal(digest(fs.readFileSync(path.join(production, name))), expected, name);
}
const productionReadme = fs.readFileSync(path.join(production, "README.md"), "utf8");
assert.match(productionReadme, /no object detection or tracking/);
assert.match(productionReadme, /H264 proof renders do not contain alpha/);
assert.match(productionReadme, /provenance.json/);
console.log("Approved production source hashes and documented limits passed.");

if (process.env.ECC_TEST_NPM_PACK === "1") {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-fusion-pack-"));
  try {
    const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temp], {
      cwd: root, encoding: "utf8", timeout: 120000,
    });
    assert.equal(packed.status, 0, packed.stderr);
    const info = JSON.parse(packed.stdout)[0];
    const archive = path.join(temp, info.filename);
    const bundles = [
      { relative, bundle, provenance },
      { relative: productionRelative, bundle: production, provenance: productionProvenance },
    ];
    for (const item of bundles) {
      for (const name of [...Object.keys(item.provenance.files), "README.md", "provenance.json"]) {
        const extracted = spawnSync("tar", ["-xOf", archive, `package/${item.relative}/${name}`], {
          maxBuffer: 1024 * 1024, timeout: 30000,
        });
        assert.equal(extracted.status, 0, String(extracted.stderr));
        assert.deepEqual(extracted.stdout, fs.readFileSync(path.join(item.bundle, name)), name);
      }
    }
    console.log("Actual npm tarball contains all twelve Fusion bundle files byte-for-byte.");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
