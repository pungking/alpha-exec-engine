#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { FILES, validateShadow, validateTargets } from "./audit-paper-closeout-private-evidence.mjs";
import { sha256Canonical, ACTIVE_POSITION_LIMITED_RECOVERY_MODE } from "./lib/active-position-limited-recovery.mjs";
import { directory, readBytes, sourceJson, recipient, outputFile, encryptPayload, decryptPayload } from "./paper-exact-cache-private-export.mjs";

const SCHEMA = "paper-runtime-private-binding-v1";
const STATE = [FILES.orderLedger, FILES.orderIdempotency];
const AUX = ["fillability-report.json", "fill-state-reconciliation-audit.json", "position-lifecycle-guard-source-plan.json", "stage6-20trade-loop.json"];
const OUTPUTS = Object.freeze({ preview: [FILES.preview], performance: [FILES.performance], orderState: [FILES.orderState],
  protection: [FILES.brokerChildReconciliation, FILES.positionProtectionAudit] });
const INPUTS = Object.freeze({ preview: STATE, performance: [...STATE, FILES.preview, AUX[0], AUX[3]],
  orderState: [...STATE, FILES.preview, FILES.performance, AUX[0]],
  protection: [...STATE, FILES.preview, FILES.performance, FILES.orderState, ...AUX.slice(0, 3)] });
const ALL = [...Object.values(FILES), ...AUX];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
class BindingError extends Error {}
const requireContract = (ok, code) => { if (!ok) throw new BindingError(code); };
const isoMs = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) ? Date.parse(value) : NaN;
const SAFETY = Object.freeze({ brokerRequests: 0, sourceStateModified: false, cacheSaved: false,
  selectedCandidateCount: 0, brokerSubmitAllowed: false, currentBrokerEvidenceVerified: false,
  currentStateAuthenticityVerified: false, historicalEvidenceNormalized: false,
  stage6SourceBytesVerified: false, reportIdentityJoinVerified: false, realizedPnlVerified: false });

function context(env) {
  requireContract(["schedule", "repository_dispatch"].includes(env.GITHUB_EVENT_NAME)
    && env.GITHUB_REF === "refs/heads/main" && env.GITHUB_RUN_ATTEMPT === "1"
    && env.GITHUB_WORKFLOW === "sidecar-dry-run" && /^\d+$/.test(env.GITHUB_RUN_ID || "")
    && /^[a-f0-9]{40}$/.test(env.GITHUB_SHA || ""), "BINDING_AUTOMATIC_RUN_REQUIRED");
  requireContract(env.READ_ONLY === "true" && env.EXEC_ENABLED === "false" && env.LIVE_ORDER_SUBMIT_ENABLED === "false"
    && ["PAPER", "DRY_RUN"].includes(env.ALPHA_ENV) && env.ALPACA_BASE_URL === "https://paper-api.alpaca.markets"
    && env.POSITION_LIFECYCLE_PREVIEW_ONLY === "true" && env.MARKET_GUARD_MODE === "observe"
    && ["GUARD_EXECUTE_TIGHTEN_STOPS", "GUARD_EXECUTE_REDUCE_POSITIONS", "GUARD_EXECUTE_FLATTEN"]
      .every(key => env[key] === "false"), "BINDING_SAFETY_INVALID");
  return { runId: env.GITHUB_RUN_ID, runAttempt: 1, headSha: env.GITHUB_SHA,
    event: env.GITHUB_EVENT_NAME, executionEnvironment: env.ALPHA_ENV, brokerEnvironment: "PAPER" };
}

function snapshot(stateDirectory, names) {
  directory(stateDirectory);
  return Object.fromEntries(names.map(name => {
    const file = path.join(stateDirectory, name);
    if (!fs.existsSync(file)) return [name, null];
    const bytes = readBytes(file); sourceJson(bytes);
    return [name, sha(bytes)];
  }));
}
function receiptPath(dir, phase, suffix) {
  requireContract(Object.hasOwn(OUTPUTS, phase), "BINDING_PHASE_INVALID");
  directory(dir, true);
  return path.join(dir, `${phase}.${suffix}.json`);
}
function readReceipt(dir, phase, suffix) {
  const file = receiptPath(dir, phase, suffix);
  requireContract(fs.existsSync(file), "BINDING_RECEIPTS_INCOMPLETE");
  return sourceJson(readBytes(file, undefined, true));
}
function rejectDuplicate(dir, file) {
  if (fs.existsSync(file) || fs.existsSync(`${file}.partial`)) {
    const invalid = path.join(dir, "duplicate-attempt.json");
    if (!fs.existsSync(invalid)) outputFile(invalid, '{"status":"DUPLICATE_ATTEMPT"}');
    throw new BindingError("BINDING_PHASE_ALREADY_ATTEMPTED");
  }
}

function invalidateReceiptSet(stateDirectory, receiptDirectory) {
  directory(path.dirname(receiptDirectory));
  requireContract(path.resolve(receiptDirectory) !== path.resolve(stateDirectory)
    && !path.resolve(receiptDirectory).startsWith(`${path.resolve(stateDirectory)}${path.sep}`), "BINDING_OUTPUT_OVERLAPS_STATE");
  // Keep failure evidence independent of the directory whose validation failed.
  const file = `${path.resolve(receiptDirectory)}.failed-attempt.json`;
  if (!fs.existsSync(file) && !fs.existsSync(`${file}.partial`)) outputFile(file, '{"status":"FAILED_ATTEMPT"}');
}
function rejectFailedAttempt(dir) {
  const file = `${path.resolve(dir)}.failed-attempt.json`;
  requireContract(!fs.existsSync(file) && !fs.existsSync(`${file}.partial`), "BINDING_PHASE_FAILED");
}

export function beginPhase(phase, { stateDirectory, receiptDirectory, env, now = new Date().toISOString() }) {
  try {
    rejectFailedAttempt(receiptDirectory);
    const run = context(env);
    requireContract(Object.hasOwn(OUTPUTS, phase) && Number.isFinite(isoMs(now)), "BINDING_PHASE_INVALID");
    directory(path.dirname(receiptDirectory));
    requireContract(path.resolve(receiptDirectory) !== path.resolve(stateDirectory)
      && !path.resolve(receiptDirectory).startsWith(`${path.resolve(stateDirectory)}${path.sep}`), "BINDING_OUTPUT_OVERLAPS_STATE");
    if (!fs.existsSync(receiptDirectory)) fs.mkdirSync(receiptDirectory, { mode: 0o700 });
    const file = receiptPath(receiptDirectory, phase, "begin");
    rejectDuplicate(receiptDirectory, file);
    const inputs = snapshot(stateDirectory, INPUTS[phase]);
    requireContract(INPUTS[phase].filter(n => !AUX.includes(n)).every(n => inputs[n]), "BINDING_INPUT_MISSING");
    outputFile(file, JSON.stringify({ run, phase, startedAt: now, inputs, previousOutputs: snapshot(stateDirectory, OUTPUTS[phase]) }));
  } catch (error) {
    invalidateReceiptSet(stateDirectory, receiptDirectory);
    throw error;
  }
}

export function finishPhase(phase, { stateDirectory, receiptDirectory, env, exitCode, now = new Date().toISOString() }) {
  try {
    rejectFailedAttempt(receiptDirectory);
    const run = context(env), begin = readReceipt(receiptDirectory, phase, "begin");
    requireContract(sha256Canonical(run) === sha256Canonical(begin.run), "BINDING_RUN_MISMATCH");
    const output = receiptPath(receiptDirectory, phase, "end");
    rejectDuplicate(receiptDirectory, output);
    // Record even failed attempts. No second producer attempt can reuse this receipt set.
    let result = { ...begin, finishedAt: now, producerExitCode: exitCode, status: "FAILED" };
    try {
      requireContract(exitCode === 0, "BINDING_PRODUCER_FAILED");
      requireContract(Number.isFinite(isoMs(now)) && isoMs(now) >= isoMs(begin.startedAt), "BINDING_TIME_INVALID");
      const inputs = snapshot(stateDirectory, INPUTS[phase]);
      if (phase !== "preview") requireContract(sha256Canonical(inputs) === sha256Canonical(begin.inputs), "BINDING_INPUT_CHANGED");
      const outputs = snapshot(stateDirectory, OUTPUTS[phase]);
      for (const name of OUTPUTS[phase]) {
        requireContract(outputs[name] && outputs[name] !== begin.previousOutputs[name], "BINDING_OUTPUT_NOT_CURRENT");
        const value = sourceJson(readBytes(path.join(stateDirectory, name)));
        requireContract(isoMs(value.generatedAt) >= isoMs(begin.startedAt) && isoMs(value.generatedAt) <= isoMs(now), "BINDING_OUTPUT_NOT_CURRENT");
      }
      result = { ...result, status: "COMPLETE", inputsAfter: inputs, outputs };
    } finally { outputFile(output, JSON.stringify(result)); }
  } catch (error) {
    invalidateReceiptSet(stateDirectory, receiptDirectory);
    throw error;
  }
}

function verifyReceipts(receipts, run, hashes, completedAt) {
  let previousEnd = -Infinity;
  for (const phase of Object.keys(OUTPUTS)) {
    const r = receipts[phase];
    requireContract(r?.phase === phase && r.status === "COMPLETE" && r.producerExitCode === 0, "BINDING_RECEIPTS_INCOMPLETE");
    requireContract(sha256Canonical(r.run) === sha256Canonical(run), "BINDING_RUN_MISMATCH");
    requireContract(isoMs(r.startedAt) >= previousEnd && isoMs(r.finishedAt) >= isoMs(r.startedAt)
      && isoMs(r.finishedAt) <= isoMs(completedAt), "BINDING_TIME_INVALID");
    previousEnd = isoMs(r.finishedAt);
    for (const name of INPUTS[phase]) {
      requireContract(Object.hasOwn(r.inputsAfter, name) && r.inputsAfter[name] === hashes[name], "BINDING_FINAL_HASH_MISMATCH");
      if (phase !== "preview") requireContract(r.inputs[name] === r.inputsAfter[name], "BINDING_INPUT_CHANGED");
    }
    for (const name of OUTPUTS[phase]) requireContract(r.outputs[name] && r.outputs[name] === hashes[name]
      && r.previousOutputs[name] !== r.outputs[name], "BINDING_FINAL_HASH_MISMATCH");
  }
}

function uniqueSymbols(rows) {
  requireContract(Array.isArray(rows) && rows.every(r => typeof r?.symbol === "string" && r.symbol.trim()), "BINDING_PORTFOLIO_INCOMPLETE");
  const symbols = rows.map(r => r.symbol.toUpperCase());
  requireContract(new Set(symbols).size === symbols.length, "BINDING_PORTFOLIO_AMBIGUOUS");
  return symbols.sort();
}
function validateReports(values) {
  const preview = values[FILES.preview], performance = values[FILES.performance], shadow = preview.paperExitShadowIntent;
  requireContract(preview.mode?.readOnly === true && preview.mode.execEnabled === false && preview.mode.liveMode === false
    && preview.actionIntent?.previewOnly === true && preview.brokerSubmission?.attempted === 0 && preview.brokerSubmission.submitted === 0
    && shadow?.mode === "REPORT_ONLY_SHADOW" && ["wouldCreateBrokerPayload", "brokerMutationAttempted", "brokerMutationSubmitted",
      "stateMutationAttempted", "stateMutationSubmitted"].every(k => shadow[k] === false), "BINDING_SHADOW_SAFETY_INVALID");
  validateShadow(shadow);
  requireContract(performance.live?.available === true, "BINDING_BROKER_EVIDENCE_UNAVAILABLE");
  requireContract(/^[a-f0-9]{64}$/.test(performance.live.account?.identitySha256 || ""), "BINDING_ACCOUNT_IDENTITY_MISSING");
  const symbols = uniqueSymbols(performance.live.positions);
  for (const rows of [shadow.rows, values[FILES.brokerChildReconciliation].rows, values[FILES.positionProtectionAudit].rows])
    requireContract(JSON.stringify(uniqueSymbols(rows)) === JSON.stringify(symbols), "BINDING_PORTFOLIO_INCOMPLETE");
  const orderSymbols = uniqueSymbols(values[FILES.orderState].rows);
  requireContract(symbols.every(s => orderSymbols.includes(s)), "BINDING_PORTFOLIO_INCOMPLETE");
  const ledger = values[FILES.orderLedger], idem = values[FILES.orderIdempotency];
  requireContract(ledger?.orders && idem?.orders && Array.isArray(idem.releases), "BINDING_STATE_INVALID");
  const targets = Object.entries(idem.orders).filter(([, r]) => r?.recoveryMode === ACTIVE_POSITION_LIMITED_RECOVERY_MODE).map(([key, row]) => {
    const matches = Object.entries(ledger.orders).filter(([, l]) => l?.idempotencyKey === key);
    requireContract(matches.length === 1, "BINDING_IDENTITY_AMBIGUOUS");
    return { ledgerKey: matches[0][0], idempotencyKey: key, ledgerRecordSha256: sha256Canonical(matches[0][1]), idempotencyRecordSha256: sha256Canonical(row) };
  }).sort((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey));
  if (targets.length) validateTargets(targets, { orderLedger: ledger, orderIdempotency: idem });
  return { targets, positionRows: symbols.length };
}

export function buildRuntimeBundle({ stateDirectory, receiptDirectory, env, now = new Date().toISOString() }) {
  const run = context(env);
  requireContract(fs.existsSync(receiptDirectory), "BINDING_RECEIPTS_INCOMPLETE");
  requireContract(!fs.existsSync(path.join(receiptDirectory, "duplicate-attempt.json")), "BINDING_PHASE_ALREADY_ATTEMPTED");
  rejectFailedAttempt(receiptDirectory);
  const receipts = Object.fromEntries(Object.keys(OUTPUTS).map(p => [p, readReceipt(receiptDirectory, p, "end")]));
  const hashes = snapshot(stateDirectory, ALL);
  verifyReceipts(receipts, run, hashes, now);
  requireContract(Object.values(FILES).every(n => hashes[n]), "BINDING_FILE_SET_INCOMPLETE");
  const files = ALL.filter(n => hashes[n]).map(name => {
    const bytes = readBytes(path.join(stateDirectory, name));
    requireContract(sha(bytes) === hashes[name], "BINDING_FINAL_HASH_MISMATCH");
    return { name, sha256: hashes[name], bytes: bytes.toString("base64") };
  });
  requireContract(files.reduce((sum, f) => sum + Buffer.byteLength(f.bytes), 0) <= 86 * 1024 * 1024, "BINDING_BUNDLE_TOO_LARGE");
  const { targets, positionRows } = validateReports(Object.fromEntries(files.map(f => [f.name, sourceJson(Buffer.from(f.bytes, "base64"))])));
  const manifest = { schemaVersion: SCHEMA, run, completedAt: now, evidenceBasis: "SAME_RUN_PRODUCER_RECEIPTS",
    stateBasis: "RUNTIME_STATE_OBSERVED_NOT_ORIGINAL_HISTORY_VERIFIED", receipts, fileHashes: hashes, targets,
    inputHash: sha256Canonical({ run, receipts, hashes }), sameRunBindingVerified: true, positionRows, ...SAFETY };
  return { manifest, files };
}

export function sealRuntimeBundle({ output, ...options }) {
  const publicKey = recipient(options.env);
  requireContract(!path.resolve(output).startsWith(`${path.resolve(options.stateDirectory)}${path.sep}`), "BINDING_OUTPUT_OVERLAPS_STATE");
  const bundle = buildRuntimeBundle(options);
  const context = { runId: bundle.manifest.run.runId, headSha: bundle.manifest.run.headSha, recipientSha256: options.env.RECIPIENT_SHA256 };
  const bytes = encryptPayload(bundle, context, publicKey, SCHEMA);
  requireContract(sha256Canonical(snapshot(options.stateDirectory, ALL)) === sha256Canonical(bundle.manifest.fileHashes), "BINDING_FINAL_HASH_MISMATCH");
  outputFile(output, bytes);
  return { status: "PAPER_RUNTIME_PRIVATE_BINDING_ENCRYPTED", schemaVersion: SCHEMA, runId: context.runId, headSha: context.headSha,
    envelopeSha256: sha(bytes), bindingSha256: bundle.manifest.inputHash, fileCount: bundle.files.length,
    sameRunBindingVerified: true, plaintextPublished: false, ...SAFETY };
}

export function decryptRuntimeBundle(input, privateKeyFile, output, pin, runId, headSha) {
  directory(path.dirname(output), true);
  requireContract(!fs.existsSync(output), "BINDING_OUTPUT_EXISTS");
  const raw = readBytes(input, 128 * 1024 * 1024);
  requireContract(/^[a-f0-9]{64}$/.test(pin || "") && sha(raw) === pin, "BINDING_ENVELOPE_HASH_MISMATCH");
  const envelope = sourceJson(raw);
  requireContract(envelope.schemaVersion === SCHEMA && envelope.algorithm === "RSA-OAEP-SHA256+A256GCM", "BINDING_ENVELOPE_INVALID");
  const privateKey = createPrivateKey(readBytes(privateKeyFile, 16384, true));
  const context = { runId, headSha, recipientSha256: sha(createPublicKey(privateKey).export({ type: "spki", format: "der" })) };
  requireContract(JSON.stringify(context) === JSON.stringify(envelope.context), "BINDING_RUN_MISMATCH");
  const bundle = decryptPayload(envelope, privateKey, context), m = bundle.manifest;
  requireContract(m?.schemaVersion === SCHEMA && m.run?.runId === runId && m.run.headSha === headSha
    && m.evidenceBasis === "SAME_RUN_PRODUCER_RECEIPTS" && m.sameRunBindingVerified === true
    && Object.entries(SAFETY).every(([key, v]) => m[key] === v), "BINDING_MANIFEST_INVALID");
  requireContract(Array.isArray(bundle.files) && bundle.files.length === new Set(bundle.files.map(f => f.name)).size
    && bundle.files.every(f => ALL.includes(f.name)) && Object.values(FILES).every(n => bundle.files.some(f => f.name === n)), "BINDING_FILE_SET_INCOMPLETE");
  const hashes = Object.fromEntries(ALL.map(n => [n, null])), values = {};
  const files = bundle.files.map(f => {
    const bytes = Buffer.from(f.bytes, "base64");
    requireContract(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024 && bytes.toString("base64") === f.bytes
      && sha(bytes) === f.sha256 && f.sha256 === m.fileHashes[f.name], "BINDING_FINAL_HASH_MISMATCH");
    hashes[f.name] = f.sha256; values[f.name] = sourceJson(bytes); return { ...f, data: bytes };
  });
  verifyReceipts(m.receipts, m.run, hashes, m.completedAt);
  requireContract(m.inputHash === sha256Canonical({ run: m.run, receipts: m.receipts, hashes }), "BINDING_FINAL_HASH_MISMATCH");
  const result = validateReports(values);
  requireContract(sha256Canonical(result.targets) === sha256Canonical(m.targets) && result.positionRows === m.positionRows, "BINDING_MANIFEST_INVALID");
  const staged = `${output}.incomplete`;
  fs.mkdirSync(staged, { mode: 0o700 });
  for (const f of files) outputFile(path.join(staged, f.name), f.data);
  outputFile(path.join(staged, "manifest.json"), `${JSON.stringify(m, null, 2)}\n`);
  fs.renameSync(staged, output);
  return { status: "PAPER_RUNTIME_PRIVATE_BINDING_VERIFIED", sameRunBindingVerified: true, ...SAFETY };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const publishSafe = result => {
    if (process.argv[2] === "seal" && process.env.RUNNER_TEMP) {
      outputFile(path.join(process.env.RUNNER_TEMP, "paper-runtime-binding-safe.json"), `${JSON.stringify(result)}\n`);
      if (result.status === "PAPER_RUNTIME_PRIVATE_BINDING_ENCRYPTED" && process.env.GITHUB_OUTPUT)
        fs.appendFileSync(process.env.GITHUB_OUTPUT, "encrypted=true\n");
    }
    console.log(JSON.stringify(result));
  };
  try {
    const [command, phase, code, ...rest] = process.argv.slice(2);
    let result;
    if (command === "decrypt") result = decryptRuntimeBundle(phase, code, ...rest);
    else {
      requireContract(process.env.RUNNER_TEMP, "BINDING_TEMP_REQUIRED");
      const options = { stateDirectory: path.resolve("state"), receiptDirectory: path.join(process.env.RUNNER_TEMP, "paper-runtime-binding"), env: process.env };
      if (command === "begin") beginPhase(phase, options);
      else if (command === "finish") finishPhase(phase, { ...options, exitCode: Number(code) });
      else if (command === "seal") {
        if (!process.env.RECIPIENT_PUBLIC_KEY && !process.env.RECIPIENT_SHA256) result = { status: "BINDING_RECIPIENT_NOT_CONFIGURED", ...SAFETY };
        else {
          const dir = path.join(process.env.RUNNER_TEMP, "paper-runtime-encrypted");
          fs.mkdirSync(dir, { mode: 0o700 });
          result = sealRuntimeBundle({ ...options, output: path.join(dir, "envelope.json") });
        }
      } else throw new BindingError("BINDING_ARGUMENTS_INVALID");
    }
    publishSafe(result || { status: "BINDING_RECEIPT_RECORDED", ...SAFETY });
  } catch (error) {
    const result = { status: error instanceof BindingError ? error.message : "BINDING_INPUT_REJECTED", ...SAFETY };
    try { publishSafe(result); } catch { console.log(JSON.stringify({ status: "BINDING_PUBLICATION_FAILED", ...SAFETY })); }
    process.exitCode = 1;
  }
}
