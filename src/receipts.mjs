import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { canonicalJson } from "./patch.mjs";

const ed25519Pkcs8SeedPrefix = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);

function hashHex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function signingMaterial(secret) {
  if (typeof secret !== "string" || secret.length < 16) {
    throw new Error("VELVET_RECEIPT_SECRET must contain at least 16 characters.");
  }
  const seed = createHash("sha256").update(secret).digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([ed25519Pkcs8SeedPrefix, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey);
  const publicJwk = publicKey.export({ format: "jwk" });
  const keyId = `vs-ed25519-${hashHex(canonicalJson(publicJwk)).slice(0, 16)}`;
  return { privateKey, publicKey, publicJwk, keyId };
}

function configuredSecret(options = {}) {
  return options.secret ?? process.env.VELVET_RECEIPT_SECRET;
}

export function receiptSigningConfigured(options = {}) {
  const secret = configuredSecret(options);
  return typeof secret === "string" && secret.length >= 16;
}

export function publicReceiptKey(options = {}) {
  const material = signingMaterial(configuredSecret(options));
  return {
    issuer:
      options.issuer ??
      process.env.VELVET_PUBLIC_URL ??
      "https://velvetsignal.lol",
    key_id: material.keyId,
    algorithm: "Ed25519",
    public_key_jwk: material.publicJwk,
  };
}

export function createDeliveryReceipt(patch, options = {}) {
  const material = signingMaterial(configuredSecret(options));
  const now = options.now ?? (() => new Date());
  const issuer =
    options.issuer ??
    process.env.VELVET_PUBLIC_URL ??
    "https://velvetsignal.lol";
  const claims = {
    type: "velvet-signal.delivery-receipt.v1",
    issuer,
    key_id: material.keyId,
    algorithm: "Ed25519",
    patch_id: patch.patch_id,
    version: patch.version,
    content_sha256: hashHex(canonicalJson(patch)),
    delivered_at: now().toISOString(),
    approval_method: "explicit-release-request",
    approver_identity: "not-collected",
  };
  const signature = sign(
    null,
    Buffer.from(canonicalJson(claims)),
    material.privateKey,
  ).toString("base64url");
  return { ...claims, signature };
}

export function verifyDeliveryReceipt(patch, receipt, options = {}) {
  if (!patch || typeof patch !== "object" || !receipt || typeof receipt !== "object") {
    return {
      valid: false,
      signature_valid: false,
      content_hash_valid: false,
      reason: "A patch and receipt are required.",
    };
  }
  let material;
  try {
    material = signingMaterial(configuredSecret(options));
  } catch {
    return {
      valid: false,
      signature_valid: false,
      content_hash_valid: false,
      reason: "Receipt verification is not configured.",
    };
  }
  const { signature, ...claims } = receipt;
  const contentHashValid =
    typeof receipt.content_sha256 === "string" &&
    receipt.content_sha256 === hashHex(canonicalJson(patch));
  const identityValid =
    receipt.patch_id === patch.patch_id &&
    receipt.version === patch.version &&
    receipt.key_id === material.keyId &&
    receipt.algorithm === "Ed25519";
  let signatureValid = false;
  if (typeof signature === "string") {
    try {
      signatureValid = verify(
        null,
        Buffer.from(canonicalJson(claims)),
        material.publicKey,
        Buffer.from(signature, "base64url"),
      );
    } catch {
      signatureValid = false;
    }
  }
  const now = options.now ?? (() => new Date());
  const active =
    typeof patch.valid_until === "string" &&
    Date.parse(`${patch.valid_until}T23:59:59.999Z`) >= now().getTime();
  const valid = signatureValid && contentHashValid && identityValid;
  return {
    valid,
    signature_valid: signatureValid,
    content_hash_valid: contentHashValid,
    identity_valid: identityValid,
    patch_active: active,
    key_id: material.keyId,
    reason: valid ? null : "The receipt does not verify against this canonical patch.",
  };
}
