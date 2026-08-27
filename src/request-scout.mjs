import { rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generatedIssuesPath } from "./catalog.mjs";

export async function waitForRenderDeployment(options = {}) {
  const expectedCommit = Object.hasOwn(options, "expectedCommit")
    ? options.expectedCommit
    : process.env.GITHUB_SHA;
  if (!expectedCommit) return null;
  const scoutUrl =
    options.scoutUrl ??
    process.env.VELVET_SCOUT_URL ??
    "https://velvetsignal.lol/api/velvet/scout";
  const statusUrl = new URL("/api/velvet/status", scoutUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const delayImpl =
    options.delayImpl ??
    ((milliseconds) =>
      new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)));
  const attempts = options.deploymentAttempts ?? 36;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(statusUrl, {
        headers: { accept: "application/json" },
      });
      if (response.ok) {
        const status = await response.json();
        if (status.deployment_commit === expectedCommit) return status;
      }
    } catch {
      // Render may briefly change instances during a zero-downtime deploy.
    }
    if (attempt < attempts - 1) await delayImpl(10_000);
  }
  throw new Error(
    `Render did not report GitHub commit ${expectedCommit.slice(0, 12)} before the scout deadline.`,
  );
}

export async function requestRenderScout(options = {}) {
  const scoutUrl =
    options.scoutUrl ??
    process.env.VELVET_SCOUT_URL ??
    "https://velvetsignal.lol/api/velvet/scout";
  const requestUrl =
    options.oidcRequestUrl ?? process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken =
    options.oidcRequestToken ?? process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) {
    throw new Error("GitHub Actions OIDC is unavailable. Grant id-token: write.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  await waitForRenderDeployment({ ...options, scoutUrl, fetchImpl });
  const identityUrl = new URL(requestUrl);
  identityUrl.searchParams.set("audience", scoutUrl);
  const identityResponse = await fetchImpl(identityUrl, {
    headers: {
      Authorization: `Bearer ${requestToken}`,
      accept: "application/json",
    },
  });
  if (!identityResponse.ok) {
    throw new Error(`GitHub OIDC token request returned ${identityResponse.status}.`);
  }
  const identity = await identityResponse.json();
  if (typeof identity.value !== "string" || !identity.value) {
    throw new Error("GitHub OIDC token response was empty.");
  }

  const scoutResponse = await fetchImpl(scoutUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${identity.value}`,
      accept: "application/json",
    },
  });
  const payload = await scoutResponse.json().catch(() => ({}));
  if (!scoutResponse.ok) {
    throw new Error(
      `Render scout returned ${scoutResponse.status}: ${payload.message ?? payload.error ?? "unknown error"}`,
    );
  }
  if (!payload.catalog || !Array.isArray(payload.catalog.issues)) {
    throw new Error("Render scout response did not contain a catalog.");
  }

  const outputPath = options.outputPath ?? generatedIssuesPath;
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload.catalog, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  return payload;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  requestRenderScout()
    .then(({ changed, summary }) => {
      console.log(JSON.stringify({ changed, ...summary }, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
