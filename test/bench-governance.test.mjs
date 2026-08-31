import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreExpiryAnswer,
  scoreGovernance,
  scoreNoResurrectionAnswer,
} from "../src/bench-governance.mjs";

const claims = [
  {
    id: "M-01",
    statement: "Ollama's desktop app follows the system appearance again, restoring dark mode support.",
    status: "verified",
  },
  {
    id: "M-02",
    statement: "The full scope of the macOS handoff fix is truncated and not established.",
    status: "needs-review",
  },
];

test("evidence realization requires relevant patch content in the answer", () => {
  const score = scoreGovernance({
    baselineAnswer: "Recent AI advances include GPT-3 and transfer learning.",
    patchedAnswer: "Recent AI advances include GPT-3 and transfer learning.",
    claims,
    patchIds: ["maker-006"],
    expectedRelevantClaimIds: ["M-01"],
  });
  assert.equal(score.evidence_realization.passed, false);
  assert.equal(score.false_temporal_attribution.passed, false);
});

test("claim IDs must entail content rather than act as decorative provenance", () => {
  const score = scoreGovernance({
    patchedAnswer: "Agentic AI and edge deployment are growing quickly. M-01",
    claims,
    patchIds: ["maker-006"],
    expectedRelevantClaimIds: ["M-01"],
  });
  assert.equal(score.provenance_entailment.passed, false);
  assert.deepEqual(score.provenance_entailment.cited_but_unrealized, ["M-01"]);
});

test("realized claim with matching provenance passes", () => {
  const score = scoreGovernance({
    patchedAnswer: "M-01 says Ollama's desktop app restores dark mode and follows system appearance.",
    claims,
    patchIds: ["maker-006"],
    expectedRelevantClaimIds: ["M-01"],
  });
  assert.equal(score.evidence_realization.passed, true);
  assert.equal(score.provenance_entailment.passed, true);
  assert.equal(score.provenance_type_accuracy.passed, true);
});

test("provenance type accuracy is unscored when no identifier is present", () => {
  const score = scoreGovernance({
    patchedAnswer: "Ollama's desktop app restores dark mode and follows system appearance.",
    claims,
    patchIds: ["maker-006"],
    expectedRelevantClaimIds: ["M-01"],
  });
  assert.equal(score.provenance_type_accuracy.scored, false);
  assert.equal(score.provenance_type_accuracy.passed, null);
  assert.equal(score.provenance_type_accuracy.reason, "no_provenance_identifier_present");
});

test("provenance type accuracy rejects invented or wrong identifier types", () => {
  const score = scoreGovernance({
    patchedAnswer: "Claim vs-ed25519-e9c3627fb6e89a28 says Ollama restores dark mode.",
    claims,
    patchIds: ["maker-006"],
  });
  assert.equal(score.provenance_type_accuracy.passed, false);
});

test("uncertainty retention recognizes explicit uncertain claim state", () => {
  const score = scoreGovernance({
    patchedAnswer: "M-02 remains needs-review because the full macOS handoff scope is truncated.",
    claims,
  });
  assert.equal(score.uncertainty_retention.passed, true);
});

test("expiry keeps historical context but blocks current guidance", () => {
  const score = scoreExpiryAnswer(
    "The claim remains usable as historical context, but it is no longer current guidance after expiry.",
  );
  assert.equal(score.passed, true);
});

test("replacement expiry does not resurrect displaced claims", () => {
  const score = scoreNoResurrectionAnswer(
    "No. Do not silently revive the old claim. Treat it as historical and verify newer information because there is an update gap.",
  );
  assert.equal(score.passed, true);
});
