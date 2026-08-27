import { createPublicKey, verify } from "node:crypto";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const CLOCK_SKEW_SECONDS = 30;
const MAX_TOKEN_LIFETIME_SECONDS = 10 * 60;

let keyCache = { expiresAt: 0, keys: [] };

export class GitHubOidcError extends Error {}

function parseSegment(segment, label) {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new GitHubOidcError(`GitHub OIDC ${label} is invalid.`);
  }
}

function audienceMatches(actual, expected) {
  if (typeof actual === "string") return actual === expected;
  return Array.isArray(actual) && actual.includes(expected);
}

async function signingKeys(fetchImpl, nowMs) {
  if (keyCache.expiresAt > nowMs && keyCache.keys.length) return keyCache.keys;
  const response = await fetchImpl(GITHUB_OIDC_JWKS, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new GitHubOidcError("GitHub OIDC signing keys are unavailable.");
  }
  const payload = await response.json();
  if (!Array.isArray(payload.keys) || !payload.keys.length) {
    throw new GitHubOidcError("GitHub OIDC returned no signing keys.");
  }
  keyCache = { expiresAt: nowMs + 6 * 60 * 60 * 1000, keys: payload.keys };
  return keyCache.keys;
}

export async function verifyGitHubActionsOidc(token, options = {}) {
  if (typeof token !== "string" || token.length > 20_000) {
    throw new GitHubOidcError("A valid GitHub Actions identity token is required.");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new GitHubOidcError("GitHub OIDC token structure is invalid.");
  }
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = parseSegment(encodedHeader, "header");
  const claims = parseSegment(encodedClaims, "claims");
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new GitHubOidcError("GitHub OIDC token algorithm is not accepted.");
  }
  if (header.typ !== undefined && header.typ !== "JWT") {
    throw new GitHubOidcError("GitHub OIDC token type is not accepted.");
  }

  const now = options.now ?? (() => new Date());
  const nowMs = now().getTime();
  const nowSeconds = Math.floor(nowMs / 1000);
  const fetchImpl = options.fetchImpl ?? fetch;
  const keys = options.keys ?? (await signingKeys(fetchImpl, nowMs));
  const jwk = keys.find((candidate) => candidate?.kid === header.kid);
  if (!jwk) throw new GitHubOidcError("GitHub OIDC signing key is unknown.");

  let signatureValid = false;
  try {
    signatureValid = verify(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(encodedSignature, "base64url"),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    throw new GitHubOidcError("GitHub OIDC signature verification failed.");
  }

  const expectedAudience =
    options.audience ?? "https://velvetsignal.lol/api/velvet/scout";
  const expectedRepository = options.repository ?? "TONZHub/Velvet_Signal";
  const expectedRepositoryId = options.repositoryId ?? "1348233751";
  const expectedWorkflow =
    options.workflowRef ??
    "TONZHub/Velvet_Signal/.github/workflows/refresh-editions.yml@refs/heads/main";
  const permittedEvents = options.permittedEvents ?? ["schedule", "workflow_dispatch"];
  const temporalClaimsValid =
    Number.isFinite(claims.iat) &&
    Number.isFinite(claims.nbf) &&
    Number.isFinite(claims.exp) &&
    claims.iat <= nowSeconds + CLOCK_SKEW_SECONDS &&
    claims.nbf <= nowSeconds + CLOCK_SKEW_SECONDS &&
    claims.exp >= nowSeconds - CLOCK_SKEW_SECONDS &&
    claims.exp - claims.iat <= MAX_TOKEN_LIFETIME_SECONDS;
  const identityValid =
    claims.iss === GITHUB_OIDC_ISSUER &&
    audienceMatches(claims.aud, expectedAudience) &&
    claims.repository === expectedRepository &&
    String(claims.repository_id) === String(expectedRepositoryId) &&
    claims.ref === "refs/heads/main" &&
    claims.workflow_ref === expectedWorkflow &&
    claims.runner_environment === "github-hosted" &&
    permittedEvents.includes(claims.event_name);

  if (!temporalClaimsValid || !identityValid) {
    throw new GitHubOidcError("GitHub OIDC claims do not authorize this scout run.");
  }
  return {
    repository: claims.repository,
    workflow_ref: claims.workflow_ref,
    event_name: claims.event_name,
    run_id: claims.run_id,
    actor: claims.actor,
  };
}

export function clearGitHubOidcKeyCache() {
  keyCache = { expiresAt: 0, keys: [] };
}
