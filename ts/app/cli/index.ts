import { openCommand } from "./open";
import { validateCommand } from "./validate";

const USAGE = `Usage:
  fh-builder open [file.json]        Open the workflow builder; optionally pre-load a workflow.
  fh-builder validate <file.json>    Validate a workflow JSON file. Exits non-zero on errors.
`;

const [, , command, ...args] = process.argv;

try {
  switch (command) {
    case "open":
      await openCommand(args[0]);
      break;
    case "validate":
      await validateCommand(args[0]);
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
