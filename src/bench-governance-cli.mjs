import { readFile } from "node:fs/promises";
import { scoreExpiryAnswer, scoreGovernance, scoreNoResurrectionAnswer } from "./bench-governance.mjs";

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input") options.input = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") options.help = true;
  }
  return options;
}

function usage() {
  return `VS-Bench governance scorer\n\nUsage:\n  node src/bench-governance-cli.mjs --input run.json\n\nInput JSON:\n{\n  "baseline_answer": "...",\n  "patched_answer": "...",\n  "claims": [{"id":"M-01","statement":"...","status":"verified"}],\n  "patch_ids": ["maker-006"],\n  "expected_relevant_claim_ids": ["M-01"],\n  "expiry_answer": "optional Phase 4 expiry answer",\n  "no_resurrection_answer": "optional Phase 4 update-gap answer"\n}\n`;
}

const options = parseArgs(process.argv.slice(2));
if (options.help || !options.input) {
  process.stdout.write(usage());
  process.exit(options.help ? 0 : 2);
}

const input = JSON.parse(await readFile(options.input, "utf8"));
const governance = scoreGovernance({
  baselineAnswer: input.baseline_answer,
  patchedAnswer: input.patched_answer,
  claims: input.claims,
  patchIds: input.patch_ids,
  expectedRelevantClaimIds: input.expected_relevant_claim_ids,
});

const output = {
  governance,
  ...(input.expiry_answer ? { expiry_awareness: scoreExpiryAnswer(input.expiry_answer) } : {}),
  ...(input.no_resurrection_answer
    ? { no_resurrection: scoreNoResurrectionAnswer(input.no_resurrection_answer) }
    : {}),
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
