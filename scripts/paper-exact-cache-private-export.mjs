#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, createPublicKey, createPrivateKey, randomBytes, publicEncrypt, privateDecrypt,
  createCipheriv, createDecipheriv, constants } from "node:crypto";

export const APPROVAL = "AUTHORIZE PAPER EXACT-CACHE ENCRYPTED PRIVATE EXPORT ONE-SHOT";
export const CACHE_KEY = "sidecar-state-main-35610146111";
export const FILES = Object.freeze(["order-ledger.json", "order-idempotency.json", "last-dry-exec-preview.json"]);
const SCHEMA = "paper-exact-cache-encrypted-export-v1";
const ALGORITHM = "RSA-OAEP-SHA256+A256GCM";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
class ExportError extends Error {}
const requireContract = (ok, code) => { if (!ok) throw new ExportError(code); };

function directory(dir, privateOnly = false) {
  const stat = fs.lstatSync(dir);
  requireContract(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(dir) === path.resolve(dir), "EXPORT_DIRECTORY_INVALID");
  if (privateOnly) requireContract(stat.uid === process.getuid() && (stat.mode & 0o077) === 0, "EXPORT_PRIVATE_PERMISSIONS_INVALID");
}

function readBytes(file, maxBytes = MAX_FILE_BYTES, privateOnly = false) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    requireContract(stat.isFile() && stat.nlink === 1 && stat.size > 0 && stat.size <= maxBytes, "EXPORT_SOURCE_FILE_INVALID");
    if (privateOnly) requireContract(stat.uid === process.getuid() && (stat.mode & 0o077) === 0, "EXPORT_PRIVATE_PERMISSIONS_INVALID");
    const bytes = fs.readFileSync(fd);
    requireContract(bytes.length === stat.size, "EXPORT_SOURCE_CHANGED");
    return bytes;
  } catch (error) {
    if (error instanceof ExportError) throw error;
    throw new ExportError("EXPORT_SOURCE_FILE_INVALID");
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function sourceJson(bytes) {
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new ExportError("EXPORT_SOURCE_JSON_INVALID"); }
  requireContract(object(value), "EXPORT_SOURCE_JSON_INVALID");
  const visit = (node, depth = 0) => {
    requireContract(depth <= 100, "EXPORT_SOURCE_JSON_INVALID");
    if (!node || typeof node !== "object") return;
    for (const [key, item] of Object.entries(node)) {
      if (/^(api[-_]?key|secret[-_]?key|access[-_]?token|refresh[-_]?token|password|authorization|cookie|client[-_]?secret)$/i.test(key)) {
        requireContract(item == null || item === "", "EXPORT_SECRET_FIELD_REJECTED");
      }
      visit(item, depth + 1);
    }
  };
  visit(value);
  return value;
}

function recipient(env) {
  try {
    requireContract(typeof env.RECIPIENT_PUBLIC_KEY === "string" && env.RECIPIENT_PUBLIC_KEY.length < 4096, "EXPORT_RECIPIENT_INVALID");
    const bytes = Buffer.from(env.RECIPIENT_PUBLIC_KEY, "base64");
    requireContract(bytes.toString("base64") === env.RECIPIENT_PUBLIC_KEY && sha(bytes) === env.RECIPIENT_SHA256, "EXPORT_RECIPIENT_INVALID");
    const key = createPublicKey({ key: bytes, format: "der", type: "spki" });
    requireContract(key.asymmetricKeyType === "rsa" && key.asymmetricKeyDetails?.modulusLength >= 3072, "EXPORT_RECIPIENT_INVALID");
    return key;
  } catch { throw new ExportError("EXPORT_RECIPIENT_INVALID"); }
}

function authority(env) {
  requireContract(env.APPROVAL_PHRASE === APPROVAL, "EXPORT_APPROVAL_REQUIRED");
  requireContract(env.GITHUB_EVENT_NAME === "workflow_dispatch" && env.GITHUB_REF === "refs/heads/main", "EXPORT_DISPATCH_MAIN_ONLY");
  requireContract(env.GITHUB_RUN_ATTEMPT === "1", "EXPORT_RERUN_REJECTED");
  requireContract(/^[a-f0-9]{40}$/.test(env.EXPECTED_MAIN_SHA || "") && env.EXPECTED_MAIN_SHA === env.GITHUB_SHA, "EXPORT_COMMIT_MISMATCH");
  requireContract(/^\d+$/.test(env.GITHUB_RUN_ID || ""), "EXPORT_RUN_ID_INVALID");
  requireContract(env.READ_ONLY === "true" && env.EXEC_ENABLED === "false" && env.LIVE_ORDER_SUBMIT_ENABLED === "false", "EXPORT_SAFETY_FLAGS_INVALID");
  return recipient(env);
}

export function preflight(env, history, caches) {
  authority(env);
  requireContract(history?.total_count === 1 && Array.isArray(history.workflow_runs) && history.workflow_runs.length === 1
    && String(history.workflow_runs[0].id) === env.GITHUB_RUN_ID && history.workflow_runs[0].run_attempt === 1
    && history.workflow_runs[0].event === "workflow_dispatch" && history.workflow_runs[0].head_branch === "main"
    && history.workflow_runs[0].head_sha === env.GITHUB_SHA, "EXPORT_PREVIOUS_OR_CONCURRENT_ATTEMPT");
  requireContract(Array.isArray(caches?.actions_caches) && caches.total_count === 1 && caches.actions_caches.length === 1,
    "EXPORT_EXACT_CACHE_UNAVAILABLE");
  const cache = caches.actions_caches[0];
  requireContract(cache.key === CACHE_KEY && cache.ref === "refs/heads/main" && String(cache.id) === env.EXPECTED_CACHE_ID
    && /^[a-f0-9]{64}$/.test(env.EXPECTED_CACHE_VERSION || "") && cache.version === env.EXPECTED_CACHE_VERSION, "EXPORT_EXACT_CACHE_UNAVAILABLE");
}

function outputFile(file, bytes) {
  directory(path.dirname(path.resolve(file)));
  requireContract(!fs.existsSync(file) && !fs.existsSync(`${file}.partial`), "EXPORT_OUTPUT_EXISTS");
  fs.writeFileSync(`${file}.partial`, bytes, { flag: "wx", mode: 0o600 });
  fs.renameSync(`${file}.partial`, file);
}

export function encryptSource(sourceDirectory, output, env) {
  const publicKey = authority(env);
  requireContract(env.CACHE_HIT === "true" && env.CACHE_MATCHED_KEY === CACHE_KEY, "EXPORT_EXACT_CACHE_MISS");
  directory(sourceDirectory);
  requireContract(!path.resolve(output).startsWith(`${path.resolve(sourceDirectory)}${path.sep}`), "EXPORT_OUTPUT_OVERLAPS_SOURCE");
  requireContract(!fs.existsSync(output) && !fs.existsSync(`${output}.partial`), "EXPORT_OUTPUT_EXISTS");
  const context = { sourceCacheKey: CACHE_KEY, sourceRunId: "35610146111", exportRunId: env.GITHUB_RUN_ID,
    exportCommit: env.GITHUB_SHA, recipientSha256: env.RECIPIENT_SHA256 };
  const files = FILES.map(name => {
    const bytes = readBytes(path.join(sourceDirectory, name)); sourceJson(bytes);
    return { name, sha256: sha(bytes), bytes: bytes.toString("base64") };
  });
  const plaintext = Buffer.from(JSON.stringify({ context, evidenceBasis: "UNVERIFIED_CACHE_SNAPSHOT", files }));
  const key = randomBytes(32), iv = randomBytes(12);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(context)));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = { schemaVersion: SCHEMA, algorithm: ALGORITHM, context,
      wrappedKey: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key).toString("base64"),
      iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
    for (const file of files) requireContract(sha(readBytes(path.join(sourceDirectory, file.name))) === file.sha256, "EXPORT_SOURCE_CHANGED");
    const bytes = Buffer.from(`${JSON.stringify(envelope)}\n`);
    outputFile(output, bytes);
    return { status: "ENCRYPTED_PRIVATE_EXPORT_CREATED", envelopeSha256: sha(bytes), fileCount: FILES.length,
      brokerRequests: 0, cacheSaved: false, sourceStateModified: false, plaintextPublished: false };
  } finally { key.fill(0); plaintext.fill(0); }
}

export function decryptSource(input, privateKeyFile, outputDirectory, envelopeSha256, expectedRunId, expectedCommit) {
  directory(path.dirname(path.resolve(outputDirectory)), true);
  requireContract(!fs.existsSync(outputDirectory), "EXPORT_OUTPUT_EXISTS");
  const raw = readBytes(input, 64 * 1024 * 1024);
  requireContract(/^[a-f0-9]{64}$/.test(envelopeSha256 || "") && sha(raw) === envelopeSha256, "EXPORT_ENVELOPE_HASH_MISMATCH");
  const envelope = JSON.parse(raw.toString("utf8"));
  requireContract(envelope.schemaVersion === SCHEMA && envelope.algorithm === ALGORITHM && object(envelope.context), "EXPORT_ENVELOPE_INVALID");
  const keyObject = createPrivateKey(readBytes(privateKeyFile, 16384, true));
  const recipientSha256 = sha(createPublicKey(keyObject).export({ type: "spki", format: "der" }));
  const context = { sourceCacheKey: CACHE_KEY, sourceRunId: "35610146111", exportRunId: expectedRunId,
    exportCommit: expectedCommit, recipientSha256 };
  requireContract(JSON.stringify(envelope.context) === JSON.stringify(context), "EXPORT_CONTEXT_MISMATCH");
  let plaintext, key;
  try {
    key = privateDecrypt({ key: keyObject, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(envelope.wrappedKey, "base64"));
    const iv = Buffer.from(envelope.iv, "base64"), tag = Buffer.from(envelope.tag, "base64");
    requireContract(key.length === 32 && iv.length === 12 && tag.length === 16, "EXPORT_DECRYPTION_FAILED");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(JSON.stringify(context))); decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
  } catch { throw new ExportError("EXPORT_DECRYPTION_FAILED"); }
  finally { key?.fill(0); }
  let payload;
  try { payload = JSON.parse(plaintext.toString("utf8")); } finally { plaintext.fill(0); }
  requireContract(JSON.stringify(payload.context) === JSON.stringify(context) && payload.evidenceBasis === "UNVERIFIED_CACHE_SNAPSHOT"
    && Array.isArray(payload.files) && payload.files.length === FILES.length
    && payload.files.every((f, i) => f.name === FILES[i]), "EXPORT_FILE_SET_INVALID");
  const files = payload.files.map(f => {
    const bytes = Buffer.from(f.bytes, "base64");
    requireContract(bytes.length > 0 && bytes.length <= MAX_FILE_BYTES && bytes.toString("base64") === f.bytes && sha(bytes) === f.sha256, "EXPORT_FILE_HASH_MISMATCH");
    sourceJson(bytes); return { ...f, data: bytes };
  });
  // Publish a complete private directory only after authentication and all file hashes pass.
  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  const staged = path.join(outputDirectory, "incomplete"); fs.mkdirSync(staged, { mode: 0o700 });
  for (const f of files) fs.writeFileSync(path.join(staged, f.name), f.data, { flag: "wx", mode: 0o600 });
  const manifest = { schemaVersion: "paper-cache-export-manifest-v1", ...context, envelopeSha256,
    evidenceBasis: "UNVERIFIED_CACHE_SNAPSHOT", files: Object.fromEntries(files.map(f => [f.name, f.sha256])),
    currentBrokerEvidenceVerified: false, selectedCandidateCount: 0, brokerRequests: 0, sourceStateModified: false };
  outputFile(path.join(staged, "export-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const f of files) requireContract(sha(readBytes(path.join(staged, f.name), MAX_FILE_BYTES, true)) === f.sha256, "EXPORT_FILE_HASH_MISMATCH");
  fs.renameSync(staged, path.join(outputDirectory, "source"));
  return { status: "PRIVATE_SOURCE_EXPORTED_HASH_VERIFIED", fileCount: FILES.length, envelopeSha256,
    sourceStateModified: false, brokerRequests: 0, currentBrokerEvidenceVerified: false, selectedCandidateCount: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    let result;
    if (command === "preflight" && args.length === 2) {
      preflight(process.env, JSON.parse(readBytes(args[0])), JSON.parse(readBytes(args[1])));
      result = { status: "EXACT_CACHE_EXPORT_PREFLIGHT_PASS" };
    } else if (command === "encrypt" && args.length === 2) result = encryptSource(args[0], args[1], process.env);
    else if (command === "decrypt" && args.length === 6) result = decryptSource(...args);
    else throw new ExportError("EXPORT_ARGUMENTS_INVALID");
    console.log(JSON.stringify(result));
  } catch (error) {
    console.log(JSON.stringify({ status: error instanceof ExportError ? error.message : "EXPORT_INPUT_UNAVAILABLE", brokerRequests: 0, plaintextPublished: false }));
    process.exitCode = 1;
  }
}
