// Lockstep release for the published @foresthubai packages.
// workflow-core and workflow-builder always ship one shared version; the builder
// pins core to that exact version. The private @foresthubai/app is skipped —
// `npm publish --workspaces` ignores packages marked "private".
//
//   npm run release -- <x.y.z>
//
// Registry + access come from each package's publishConfig; this script is
// registry-agnostic on purpose.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const tsRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version ?? "")) {
  console.error("usage: npm run release -- <x.y.z>");
  process.exit(1);
}

const corePath = join(tsRoot, "workflow-core/package.json");
const builderPath = join(tsRoot, "workflow-builder/package.json");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const write = (p, pkg) => writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");

const core = read(corePath);
const builder = read(builderPath);

core.version = version;
builder.version = version;
builder.dependencies[core.name] = version; // exact pin — they ship together

write(corePath, core);
write(builderPath, builder);

const npm = (args) =>
  execFileSync("npm", args, { cwd: tsRoot, stdio: "inherit", shell: true });

npm(["install"]); // refresh the lockfile to the new versions
npm(["publish", "--workspaces"]); // private @foresthubai/app is skipped
