import { openCommand } from "./open";
import { updateCommand } from "./update";
import { validateCommand } from "./validate";
import { checkSchemaCommand } from "./check-schema";

const USAGE = `Usage:
  fh-builder open [file.json]            Open the workflow builder; optionally pre-load a workflow.
  fh-builder check-schema <file.json>    Structural schema check against the contract. Exits non-zero on mismatch.
  fh-builder validate <file.json>        Semantic validation of a workflow (references, wiring, types). Exits non-zero on errors.
  fh-builder update <file.json> [out]    Migrate a workflow to the current schema version.
`;

const [, , command, ...args] = process.argv;

try {
  switch (command) {
    case "open":
      await openCommand(args[0]);
      break;
    case "check-schema":
      await checkSchemaCommand(args[0]);
      break;
    case "validate":
      await validateCommand(args[0]);
      break;
    case "update":
      await updateCommand(args[0], args[1]);
      break;
    case undefined:
    case "--help":
    case "-h":
    case "help":
      process.stdout.write(USAGE);
      break;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      process.exit(1);
  }
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
