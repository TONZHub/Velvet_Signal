import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { GUIDE_ISSUES } from "./guide-issues.mjs";
import { LAUNCH_ISSUES } from "./launch-issues.mjs";

const generatedIssuesPath = fileURLToPath(
  new URL("../data/generated-issues.json", import.meta.url),
);

export const PUBLIC_SCOUT_DESKS = [
  "model-watch",
  "pantry",
  "wellbeing",
  "culture",
  "maker",
];

const requiredIssueStrings = [
  "id",
  "deskId",
  "desk",
  "issue",
  "date",
  "publishedAt",
  "title",
  "kicker",
  "dek",
  "readTime",
  "validity",
  "expires",
  "confidence",
  "scope",
  "pullquote",
];

function isNonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateGeneratedIssue(issue) {
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) return false;
  if (!requiredIssueStrings.every((field) => isNonemptyString(issue[field]))) {
    return false;
  }
  if (!PUBLIC_SCOUT_DESKS.includes(issue.deskId)) return false;
  if (!Array.isArray(issue.editorial) || issue.editorial.length < 3) return false;
  if (!issue.editorial.every(isNonemptyString)) return false;
  if (!Array.isArray(issue.sources) || issue.sources.length === 0) return false;
  if (!Array.isArray(issue.claims) || issue.claims.length === 0) return false;
  if (!Array.isArray(issue.toneNotes) || issue.toneNotes.length === 0) return false;
  if (!Array.isArray(issue.tags) || issue.tags.length === 0) return false;
  return true;
}

export async function readGeneratedCatalog() {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(generatedIssuesPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { schema_version: 1, generated_at: null, desks: {}, issues: [] };
    }
    throw error;
  }
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.filter(validateGeneratedIssue)
    : [];
  return {
    schema_version: 1,
    generated_at: isNonemptyString(parsed.generated_at)
      ? parsed.generated_at
      : null,
    desks:
      parsed.desks && typeof parsed.desks === "object" && !Array.isArray(parsed.desks)
        ? parsed.desks
        : {},
    issues,
  };
}

export async function listIssues() {
  const generated = await readGeneratedCatalog();
  const live = [...generated.issues].sort((left, right) =>
    right.publishedAt.localeCompare(left.publishedAt),
  );
  return {
    generated_at: generated.generated_at,
    scout_desks: PUBLIC_SCOUT_DESKS,
    private_desks: ["your-people"],
    issues: [...GUIDE_ISSUES, ...live, ...LAUNCH_ISSUES],
  };
}

export async function findIssue(patchId) {
  if (!isNonemptyString(patchId)) return null;
  const catalog = await listIssues();
  return catalog.issues.find((issue) => issue.id === patchId) ?? null;
}

export { generatedIssuesPath };
