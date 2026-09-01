import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findIssue, listIssues, PUBLIC_SCOUT_DESKS } from "./catalog.mjs";
import {
  GitHubOidcError,
  verifyGitHubActionsOidc,
} from "./github-oidc.mjs";
import { canonicalJson, patchForIssue } from "./patch.mjs";
import {
  createDeliveryReceipt,
  publicReceiptKey,
  receiptSigningConfigured,
  verifyDeliveryReceipt,
} from "./receipts.mjs";
import { runScout } from "./scout.mjs";
import {
  composeEdition,
  parseComposeEditionInput,
  VELVET_DESKS,
  VELVET_EDITOR_MODEL,
  VelvetUpstreamError,
  VelvetValidationError,
} from "./velvet.mjs";

const indexPath = fileURLToPath(
  new URL("../public/index.html", import.meta.url),
);
const faviconPath = fileURLToPath(
  new URL("../public/favicon.svg", import.meta.url),
);
const installPath = fileURLToPath(
  new URL("../public/install.html", import.meta.url),
);
const benchmarkPath = fileURLToPath(
  new URL("../public/benchmark.html", import.meta.url),
);
const logPath = fileURLToPath(
  new URL("../public/log.html", import.meta.url),
);
const productLogPath = fileURLToPath(
  new URL("../data/product-log.json", import.meta.url),
);
const maximumBodyBytes = 64 * 1024;
let faviconCache;
let indexCache;
let installCache;
let benchmarkCache;
let logCache;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function openRouterConfigured() {
  return Boolean(
    process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY ??
      process.env.OPENROUTER_API_KEY,
  );
}

function tavilyConfigured() {
  return Boolean(process.env.TAVILY_API_KEY);
}

function securityHeaders(request) {
  const headers = {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), tools=(self)",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
  if (request.headers["x-forwarded-proto"] === "https") {
    headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains";
  }
  return headers;
}

function send(response, request, status, body, contentType, extraHeaders = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(status, {
    ...securityHeaders(request),
    "Content-Type": contentType,
    "Content-Length": payload.byteLength,
    ...extraHeaders,
  });
  if (request.method === "HEAD") response.end();
  else response.end(payload);
}

function sendJson(response, request, status, value) {
  send(
    response,
    request,
    status,
    JSON.stringify(value),
    "application/json; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
}

function bearerToken(request) {
  const authorization = request.headers.authorization;
  if (
    typeof authorization !== "string" ||
    !authorization.startsWith("Bearer ")
  ) {
    return null;
  }
  return authorization.slice("Bearer ".length).trim() || null;
}

function tokensMatch(received, expected) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJson(request) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBodyBytes) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) throw new HttpError(400, "A JSON request body is required.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Request body must contain valid JSON.");
  }
}

function patchContentHash(patch) {
  return createHash("sha256").update(canonicalJson(patch)).digest("hex");
}

function decorateIndex(html) {
  return html
    .replace(
      '<a href="#protocol">The protocol</a>',
      '<a href="/install">Install</a>\n        <a href="/benchmark">VS-Bench</a>\n        <a href="/log">Log</a>\n        <a href="#protocol">The protocol</a>',
    )
    .replace(
      '<a class="button ghost" href="#protocol">See how consent works</a>',
      '<a class="button ghost" href="/install">Install on your laptop</a>\n          <a class="button ghost" href="/benchmark">See VS-Bench</a>\n          <a class="button ghost" href="/log">Read the Signal Log</a>\n          <a class="button ghost" href="#protocol">See how consent works</a>',
    );
}

async function serveFavicon(request, response) {
  faviconCache ??= await readFile(faviconPath);
  send(response, request, 200, faviconCache, "image/svg+xml; charset=utf-8", {
    "Cache-Control": "public, max-age=86400",
  });
}

async function serveIndex(request, response) {
  indexCache ??= decorateIndex(await readFile(indexPath, "utf8"));
  send(response, request, 200, indexCache, "text/html; charset=utf-8", {
    "Cache-Control": "no-cache",
  });
}

async function serveInstall(request, response) {
  installCache ??= await readFile(installPath);
  send(response, request, 200, installCache, "text/html; charset=utf-8", {
    "Cache-Control": "no-cache",
  });
}

async function serveBenchmark(request, response) {
  benchmarkCache ??= await readFile(benchmarkPath);
  send(response, request, 200, benchmarkCache, "text/html; charset=utf-8", {
    "Cache-Control": "no-cache",
  });
}

async function serveLog(request, response) {
  logCache ??= await readFile(logPath);
  send(response, request, 200, logCache, "text/html; charset=utf-8", {
    "Cache-Control": "no-cache",
  });
}

async function readProductLog() {
  const raw = await readFile(productLogPath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    schema_version: 1,
    updated_at: parsed.updated_at ?? null,
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
  };
}

async function handleCompose(request, response) {
  const expectedToken = process.env.VELVET_EDITOR_TOKEN;
  if (!expectedToken) {
    request.resume();
    sendJson(response, request, 503, {
      error: "editor_auth_not_configured",
      message:
        "VELVET_EDITOR_TOKEN must be configured before composing editions.",
    });
    return;
  }
  const token = bearerToken(request);
  if (!token || !tokensMatch(token, expectedToken)) {
    request.resume();
    sendJson(response, request, 401, {
      error: "unauthorized",
      message: "A valid Velvet editor token is required.",
    });
    return;
  }
  if (!openRouterConfigured()) {
    request.resume();
    sendJson(response, request, 503, {
      error: "openrouter_not_configured",
      message:
        "OPENROUTER_API_KEY must be configured before composing editions.",
    });
    return;
  }
  const input = parseComposeEditionInput(await readJson(request));
  const draft = await composeEdition(input);
  sendJson(response, request, 201, draft);
}

async function handleRelease(request, response) {
  if (!receiptSigningConfigured()) {
    request.resume();
    sendJson(response, request, 503, {
      error: "receipt_signing_not_configured",
      message:
        "VELVET_RECEIPT_SECRET must be configured before releasing patches.",
    });
    return;
  }
  const body = await readJson(request);
  const patchId =
    body && typeof body === "object" && !Array.isArray(body)
      ? body.patch_id
      : null;
  if (typeof patchId !== "string" || !patchId.trim()) {
    throw new HttpError(400, "patch_id is required.");
  }
  const issue = await findIssue(patchId.trim());
  if (!issue) {
    throw new HttpError(404, "Unknown patch ID.");
  }
  const patch = patchForIssue(issue, { deliveryStatus: "delivered" });
  const receipt = createDeliveryReceipt(patch);
  sendJson(response, request, 201, {
    delivered: true,
    receipt,
    patch,
  });
}

async function handleReceiptVerification(request, response) {
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "A patch and receipt are required.");
  }
  const result = verifyDeliveryReceipt(body.patch, body.receipt);
  const patchId = typeof body.receipt?.patch_id === "string"
    ? body.receipt.patch_id
    : null;
  const issue = patchId ? await findIssue(patchId) : null;
  const canonicalPatch = issue
    ? patchForIssue(issue, { deliveryStatus: "delivered" })
    : null;
  const canonicalContentValid = Boolean(
    canonicalPatch &&
    typeof body.receipt?.content_sha256 === "string" &&
    body.receipt.content_sha256 === patchContentHash(canonicalPatch),
  );
  const valid = result.valid && canonicalContentValid;
  sendJson(response, request, 200, {
    ...result,
    valid,
    canonical_content_valid: canonicalContentValid,
    patch_active: result.patch_active && canonicalContentValid,
    reason: valid
      ? null
      : canonicalContentValid
        ? result.reason
        : "The signed receipt is historical and no longer matches the current canonical patch.",
  });
}

async function handleScout(request, response) {
  request.resume();
  const token = bearerToken(request);
  if (!token) {
    sendJson(response, request, 401, {
      error: "unauthorized",
      message: "A GitHub Actions identity token is required.",
    });
    return;
  }
  let identity;
  try {
    identity = await verifyGitHubActionsOidc(token);
  } catch (error) {
    if (error instanceof GitHubOidcError) {
      sendJson(response, request, 401, {
        error: "unauthorized",
        message: error.message,
      });
      return;
    }
    throw error;
  }
  if (!tavilyConfigured() || !openRouterConfigured()) {
    sendJson(response, request, 503, {
      error: "scout_not_configured",
      message:
        "Render must have TAVILY_API_KEY and OPENROUTER_API_KEY before scouting.",
    });
    return;
  }
  try {
    const result = await runScout();
    sendJson(response, request, 200, {
      requested_by: identity,
      ...result,
    });
  } catch (error) {
    sendJson(response, request, 502, {
      error: "scout_failed",
      message: error instanceof Error ? error.message : "The scout failed.",
    });
  }
}

async function requestHandler(request, response) {
  try {
    const url = new URL(request.url ?? "/", "http://velvet-signal.local");
    const method = request.method ?? "GET";

    if (
      (method === "GET" || method === "HEAD") &&
      url.pathname === "/api/healthz"
    ) {
      sendJson(response, request, 200, { status: "ok" });
      return;
    }
    if (
      (method === "GET" || method === "HEAD") &&
      url.pathname === "/api/velvet/status"
    ) {
      const catalog = await listIssues();
      sendJson(response, request, 200, {
        status: "ok",
        openrouter_configured: openRouterConfigured(),
        tavily_configured: tavilyConfigured(),
        editor_auth_configured: Boolean(process.env.VELVET_EDITOR_TOKEN),
        receipt_signing_configured: receiptSigningConfigured(),
        model: VELVET_EDITOR_MODEL,
        desks: VELVET_DESKS,
        scout_desks: PUBLIC_SCOUT_DESKS,
        scout_mode: "github-actions-oidc-to-render",
        scout_provider_keys: "render-only",
        deployment_commit: process.env.RENDER_GIT_COMMIT ?? null,
        scout_last_published_at: catalog.generated_at,
        private_context_policy: "explicit-cloud-consent-required",
      });
      return;
    }
    if (
      (method === "GET" || method === "HEAD") &&
      url.pathname === "/api/velvet/issues"
    ) {
      sendJson(response, request, 200, await listIssues());
      return;
    }
    if (
      (method === "GET" || method === "HEAD") &&
      url.pathname === "/api/velvet/log"
    ) {
      sendJson(response, request, 200, await readProductLog());
      return;
    }
    if (
      (method === "GET" || method === "HEAD") &&
      url.pathname === "/api/velvet/receipt-key"
    ) {
      if (!receiptSigningConfigured()) {
        sendJson(response, request, 503, {
          error: "receipt_signing_not_configured",
        });
      } else {
        sendJson(response, request, 200, publicReceiptKey());
      }
      return;
    }
    if (method === "POST" && url.pathname === "/api/velvet/compose") {
      await handleCompose(request, response);
      return;
    }
    if (method === "POST" && url.pathname === "/api/velvet/scout") {
      await handleScout(request, response);
      return;
    }
    if (method === "POST" && url.pathname === "/api/velvet/release") {
      await handleRelease(request, response);
      return;
    }
    if (
      method === "POST" &&
      url.pathname === "/api/velvet/verify-receipt"
    ) {
      await handleReceiptVerification(request, response);
      return;
    }
    if (
      (method === "GET" || method === "HEAD") &&
      (url.pathname === "/" || url.pathname === "/index.html")
    ) {
      await serveIndex(request, response);
      return;
    }
    if (
      (method === "GET" || method === "HEAD") &&
      (url.pathname === "/install" || url.pathname === "/install.html")
    ) {
      await serveInstall(request, response);
      return;
    }
    if (
      (method === "GET" || method === "HEAD") &&
      (url.pathname === "/benchmark" || url.pathname === "/benchmark.html")
    ) {
      await serveBenchmark(request, response);
      return;
    }
    if (
      (method === "GET" || method === "HEAD") &&
      (url.pathname === "/log" || url.pathname === "/log.html")
    ) {
      await serveLog(request, response);
      return;
    }
    if ((method === "GET" || method === "HEAD") && url.pathname === "/favicon.svg") {
      await serveFavicon(request, response);
      return;
    }
    if (method === "GET" && url.pathname === "/favicon.ico") {
      send(response, request, 204, "", "image/x-icon");
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      sendJson(response, request, 404, { error: "not_found" });
      return;
    }
    sendJson(response, request, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, request, error.status, {
        error: "invalid_request",
        message: error.message,
      });
      return;
    }
    if (error instanceof VelvetValidationError) {
      sendJson(response, request, 400, {
        error: "invalid_request",
        message: error.message,
      });
      return;
    }
    if (error instanceof VelvetUpstreamError) {
      sendJson(response, request, 502, {
        error: "openrouter_error",
        message: error.message,
      });
      return;
    }
    console.error("Unexpected Velvet Signal request error", error);
    if (!response.headersSent) {
      sendJson(response, request, 500, {
        error: "internal_error",
        message: "The request could not be completed.",
      });
    } else {
      response.end();
    }
  }
}

export function createVelvetServer() {
  return createServer(requestHandler);
}

export function startVelvetServer() {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const server = createVelvetServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Velvet Signal listening on port ${port}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return server;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) startVelvetServer();
