// Lockstep release for the published @foresthubai packages.
// workflow-core, workflow-builder, and workflow-cli always ship one shared
// version; the builder pins core to that exact version. workflow-cli needs no
// pin — it bundles core/builder from source at build time (they're devDeps).
//
//   npm run release -- <x.y.z>
//
// Registry + access come from each package's publishConfig (all → public
// npmjs), so a single `npm publish --workspaces` fans out correctly; this
// script is registry-agnostic on purpose.
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
const cliPath = join(tsRoot, "workflow-cli/package.json");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const write = (p, pkg) => writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");

const core = read(corePath);
const builder = read(builderPath);
const cli = read(cliPath);

core.version = version;
builder.version = version;
builder.dependencies[core.name] = version; // exact pin — they ship together
cli.version = version;

write(corePath, core);
write(builderPath, builder);
write(cliPath, cli);

const npm = (args) =>
  execFileSync("npm", args, { cwd: tsRoot, stdio: "inherit", shell: true });

npm(["install"]); // refresh the lockfile to the new versions
npm(["publish", "--workspaces"]); // publishes core/builder + workflow-cli
