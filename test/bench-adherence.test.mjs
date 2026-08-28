import assert from "node:assert/strict";
import test from "node:test";
import {
  scoreGenerationAdherence,
  summarizeGenerationAdherence,
} from "../src/bench-adherence.mjs";

test("five-day chicken passes when the model applies the retrieved limit", () => {
  const scored = scoreGenerationAdherence(
    "five-day-chicken",
    "Cooked leftovers keep for 3 to 4 days. Five days is beyond that limit, so do not eat it.",
  );
  assert.equal(scored.scored, true);
  assert.equal(scored.passed, true);
});

test("no-current-context requires explicit Velvet separation", () => {
  assert.equal(
    scoreGenerationAdherence(
      "no-current-context",
      "As of my last update, France won the 1998 World Cup.",
    ).passed,
    false,
  );
  assert.equal(
    scoreGenerationAdherence(
      "no-current-context",
      "Outside the current Velvet Signal context, my general knowledge says France won the 1998 World Cup.",
    ).passed,
    true,
  );
});

test("tiny-context adherence catches a retrieved smell guardrail being ignored", () => {
  assert.equal(
    scoreGenerationAdherence(
      "tiny-context-budget",
      "The smell question is outside the current Velvet Signal context.",
    ).passed,
    false,
  );
  assert.equal(
    scoreGenerationAdherence(
      "tiny-context-budget",
      "Do not rely on smell to decide whether old food is safe.",
    ).passed,
    true,
  );
});

test("update-gap adherence requires the gap and refuses resurrection", () => {
  assert.equal(
    scoreGenerationAdherence(
      "synthetic-update-gap",
      "The current Velvet Signal context has an update gap; revision one was displaced and is not current.",
    ).passed,
    true,
  );
  assert.equal(
    scoreGenerationAdherence(
      "synthetic-update-gap",
      "Revision one is the active synthetic policy.",
    ).passed,
    false,
  );
});

test("adherence summary stays separate from retrieval check totals", () => {
  const summary = summarizeGenerationAdherence([
    { generation_adherence: { scored: true, passed: true } },
    { generation_adherence: { scored: true, passed: false } },
    { generation_adherence: { scored: false, passed: null } },
  ]);
  assert.deepEqual(summary, {
    scored: 2,
    passed: 1,
    failed: 1,
    unscored: 1,
  });
});
