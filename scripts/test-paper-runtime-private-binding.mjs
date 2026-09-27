import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { beginPhase, finishPhase, buildRuntimeBundle, sealRuntimeBundle, decryptRuntimeBundle } from "./paper-runtime-private-binding.mjs";
import { buildLiveSummary, buildPublicDashboard } from "./build-performance-dashboard.mjs";

globalThis.fetch = () => { throw new Error("NETWORK_FORBIDDEN"); };
const sha = b => createHash("sha256").update(b).digest("hex");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-binding-test-")));
const privateMarker = "SYNTHETIC_PRIVATE_IDENTITY";
const phases = ["preview", "performance", "orderState", "protection"];
const outputs = { preview: ["last-dry-exec-preview.json"], performance: ["performance-dashboard.json"],
  orderState: ["order-state-consistency-report.json"], protection: ["broker-child-order-reconciliation.json", "position-protection-root-cause-audit.json"] };
const env = { GITHUB_RUN_ID: "12345", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: "a".repeat(40),
  GITHUB_EVENT_NAME: "schedule", GITHUB_REF: "refs/heads/main", GITHUB_WORKFLOW: "sidecar-dry-run",
  READ_ONLY: "true", EXEC_ENABLED: "false", LIVE_ORDER_SUBMIT_ENABLED: "false", ALPHA_ENV: "DRY_RUN",
  ALPACA_BASE_URL: "https://paper-api.alpaca.markets", MARKET_GUARD_MODE: "observe",
  POSITION_LIFECYCLE_PREVIEW_ONLY: "true", GUARD_EXECUTE_TIGHTEN_STOPS: "false",
  GUARD_EXECUTE_REDUCE_POSITIONS: "false", GUARD_EXECUTE_FLATTEN: "false" };
const at = n => `2026-01-02T15:00:${String(n).padStart(2, "0")}.000Z`;
let cases = 0;
const check = fn => { fn(); cases++; };
const rejected = (fn, code) => check(() => assert.throws(fn, e => e.message === code));
const write = (dir, name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value), { mode: 0o600 });
function fixture() {
  const dir = fs.mkdtempSync(path.join(root, "case-"));
  const stateDirectory = path.join(dir, "state"); fs.mkdirSync(stateDirectory, { mode: 0o700 });
  const receiptDirectory = path.join(dir, "receipts");
  const data = {
    "order-ledger.json": { orders: {} }, "order-idempotency.json": { orders: {}, releases: [] },
    "last-dry-exec-preview.json": { stage6File: "fixture.json", stage6Hash: "b".repeat(64),
      mode: { readOnly: true, execEnabled: false, liveMode: false }, brokerSubmission: { attempted: 0, submitted: 0 },
      actionIntent: { previewOnly: true }, payloads: [], paperExitShadowIntent: { mode: "REPORT_ONLY_SHADOW",
        wouldCreateBrokerPayload: false, brokerMutationAttempted: false, brokerMutationSubmitted: false,
        stateMutationAttempted: false, stateMutationSubmitted: false, evaluatedPositionRows: 1,
        exitNotDueRows: 0, scaleDownDueRows: 0, exitPartialDueRows: 0, exitFullDueRows: 0,
        evidenceIncompleteRows: 1, unknownOrUnclassifiedRows: 0,
        marketSessionEvidence: { status: "MARKET_SESSION_CLOSED", marketOpen: false, source: "ALPACA_CLOCK" },
        rows: [{ symbol: privateMarker, actionType: null, evaluationStatus: "STAGE6_LINEAGE_MISSING" }] } },
    "performance-dashboard.json": { live: { available: true, account: { identitySha256: sha(privateMarker) }, positions: [{ symbol: privateMarker, qty: 1 }] } },
    "order-state-consistency-report.json": { rows: [{ symbol: privateMarker }] },
    "broker-child-order-reconciliation.json": { rows: [{ symbol: privateMarker }] },
    "position-protection-root-cause-audit.json": { rows: [{ symbol: privateMarker }] },
  };
  for (const [name, value] of Object.entries(data)) write(stateDirectory, name, { ...value, generatedAt: at(0) });
  return { dir, stateDirectory, receiptDirectory, env, data };
}
function complete(f, mutate = () => {}) {
  phases.forEach((phase, i) => {
    const second = i * 4 + 1;
    beginPhase(phase, { ...f, now: at(second) });
    for (const name of outputs[phase]) write(f.stateDirectory, name, { ...f.data[name], generatedAt: at(second + 1) });
    mutate(f, phase, second);
    finishPhase(phase, { ...f, now: at(second + 2), exitCode: 0 });
  });
  return buildRuntimeBundle({ ...f, now: at(20) });
}
try {
  const reads = [];
  const live = await buildLiveSummary(async route => {
    reads.push(route); return { ok: true, data: route === "/v2/account" ? { id: privateMarker } : [] };
  }, { ledger: { orders: {} }, idempotency: { orders: {}, releases: [] }, fillability: {} });
  check(() => assert.equal(live.account.identitySha256, sha(privateMarker)));
  check(() => assert.equal(reads.length, 3, "reuse existing reads only"));
  check(() => assert.ok(!JSON.stringify(buildPublicDashboard({ live })).includes(sha(privateMarker))));
  const f = fixture(), bundle = complete(f);
  check(() => assert.equal(bundle.manifest.evidenceBasis, "SAME_RUN_PRODUCER_RECEIPTS"));
  check(() => assert.equal(bundle.manifest.sameRunBindingVerified, true));
  check(() => assert.equal(bundle.manifest.selectedCandidateCount, 0));
  check(() => assert.equal(bundle.manifest.currentBrokerEvidenceVerified, false));
  check(() => assert.deepEqual(buildRuntimeBundle({ ...f, now: at(20) }), bundle));
  const dup = fixture(); complete(dup);
  rejected(() => beginPhase("preview", { ...dup, now: at(21) }), "BINDING_PHASE_ALREADY_ATTEMPTED");
  rejected(() => buildRuntimeBundle({ ...dup, now: at(22) }), "BINDING_PHASE_ALREADY_ATTEMPTED");
  const repaired = fixture();
  fs.unlinkSync(path.join(repaired.stateDirectory, "order-ledger.json"));
  rejected(() => beginPhase("preview", { ...repaired, now: at(1) }), "BINDING_INPUT_MISSING");
  write(repaired.stateDirectory, "order-ledger.json", repaired.data["order-ledger.json"]);
  rejected(() => complete(repaired), "BINDING_PHASE_FAILED");
  for (const operation of [beginPhase, finishPhase]) {
    const invalidAttempt = fixture(); complete(invalidAttempt);
    rejected(() => operation("preview", { ...invalidAttempt, env: { ...env, READ_ONLY: "false" }, exitCode: 0, now: at(21) }), "BINDING_SAFETY_INVALID");
    rejected(() => buildRuntimeBundle({ ...invalidAttempt, now: at(22) }), "BINDING_PHASE_FAILED");
    for (const mode of [0o755, 0o555]) {
      const permissions = fixture(); complete(permissions);
      fs.chmodSync(permissions.receiptDirectory, mode);
      rejected(() => operation("preview", { ...permissions, exitCode: 0, now: at(21) }), "EXPORT_PRIVATE_PERMISSIONS_INVALID");
      fs.chmodSync(permissions.receiptDirectory, 0o700);
      rejected(() => buildRuntimeBundle({ ...permissions, now: at(22) }), "BINDING_PHASE_FAILED");
    }
  }
  for (const [key, value] of [["GITHUB_RUN_ID", "777"], ["GITHUB_SHA", "c".repeat(40)]])
    rejected(() => buildRuntimeBundle({ ...f, env: { ...env, [key]: value }, now: at(20) }), "BINDING_RUN_MISMATCH");
  for (const [key, value] of [["GITHUB_EVENT_NAME", "workflow_dispatch"], ["GITHUB_RUN_ATTEMPT", "2"],
    ["GITHUB_REF", "refs/heads/other"], ["GITHUB_WORKFLOW", "sidecar-market-guard"]])
    rejected(() => beginPhase("preview", { ...fixture(), env: { ...env, [key]: value }, now: at(1) }), "BINDING_AUTOMATIC_RUN_REQUIRED");
  for (const [key, value] of [["EXEC_ENABLED", "true"], ["READ_ONLY", "false"], ["ALPACA_BASE_URL", "https://api.alpaca.markets"],
    ["POSITION_LIFECYCLE_PREVIEW_ONLY", "false"]])
    rejected(() => beginPhase("preview", { ...fixture(), env: { ...env, [key]: value }, now: at(1) }), "BINDING_SAFETY_INVALID");
  const stale = fixture(); beginPhase("preview", { ...stale, now: at(1) });
  rejected(() => finishPhase("preview", { ...stale, now: at(3), exitCode: 0 }), "BINDING_OUTPUT_NOT_CURRENT");
  const failed = fixture(); beginPhase("preview", { ...failed, now: at(1) });
  rejected(() => finishPhase("preview", { ...failed, now: at(3), exitCode: 1 }), "BINDING_PRODUCER_FAILED");
  rejected(() => buildRuntimeBundle({ ...fixture(), now: at(20) }), "BINDING_RECEIPTS_INCOMPLETE");
  rejected(() => complete(fixture(), (x, phase, second) => {
    if (phase === "preview") write(x.stateDirectory, outputs.preview[0], { ...x.data[outputs.preview[0]], generatedAt: at(second + 3) });
  }), "BINDING_OUTPUT_NOT_CURRENT");
  rejected(() => complete(fixture(), (x, phase) => {
    if (phase === "performance") write(x.stateDirectory, "order-ledger.json", { orders: {}, drift: true });
  }), "BINDING_INPUT_CHANGED");
  fs.appendFileSync(path.join(f.stateDirectory, "order-idempotency.json"), " ");
  rejected(() => buildRuntimeBundle({ ...f, now: at(20) }), "BINDING_FINAL_HASH_MISMATCH");
  const missing = fixture(); complete(missing); fs.unlinkSync(path.join(missing.stateDirectory, outputs.performance[0]));
  rejected(() => buildRuntimeBundle({ ...missing, now: at(20) }), "BINDING_FINAL_HASH_MISMATCH");
  const duplicate = fixture(); duplicate.data[outputs.performance[0]].live.positions.push({ symbol: privateMarker, qty: 2 });
  rejected(() => complete(duplicate), "BINDING_PORTFOLIO_AMBIGUOUS");
  const pair = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const der = pair.publicKey.export({ type: "spki", format: "der" });
  const privateFile = path.join(root, "key.pem"); fs.writeFileSync(privateFile, pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const sealed = fixture(); complete(sealed);
  const sealEnv = { ...env, RECIPIENT_PUBLIC_KEY: der.toString("base64"), RECIPIENT_SHA256: sha(der) };
  const output = path.join(sealed.dir, "envelope.json");
  const before = fs.readdirSync(sealed.stateDirectory).map(n => sha(fs.readFileSync(path.join(sealed.stateDirectory, n))));
  const result = sealRuntimeBundle({ ...sealed, env: sealEnv, now: at(20), output });
  check(() => assert.equal(result.brokerRequests, 0));
  check(() => assert.ok(!fs.readFileSync(output).includes(privateMarker)));
  check(() => assert.ok(!JSON.stringify(result).includes(privateMarker)));
  const decrypted = path.join(sealed.dir, "decrypted");
  check(() => decryptRuntimeBundle(output, privateFile, decrypted, result.envelopeSha256, env.GITHUB_RUN_ID, env.GITHUB_SHA));
  check(() => assert.equal(fs.readFileSync(path.join(decrypted, outputs.preview[0]), "utf8"), fs.readFileSync(path.join(sealed.stateDirectory, outputs.preview[0]), "utf8")));
  check(() => assert.deepEqual(fs.readdirSync(sealed.stateDirectory).map(n => sha(fs.readFileSync(path.join(sealed.stateDirectory, n)))), before));
  rejected(() => sealRuntimeBundle({ ...sealed, env: sealEnv, now: at(20), output }), "EXPORT_OUTPUT_EXISTS");
  rejected(() => decryptRuntimeBundle(output, privateFile, path.join(sealed.dir, "wrong-run"), result.envelopeSha256, "777", env.GITHUB_SHA), "BINDING_RUN_MISMATCH");
  rejected(() => decryptRuntimeBundle(output, privateFile, path.join(sealed.dir, "wrong-hash"), "f".repeat(64), env.GITHUB_RUN_ID, env.GITHUB_SHA), "BINDING_ENVELOPE_HASH_MISMATCH");
  const tampered = JSON.parse(fs.readFileSync(output));
  const ciphertext = Buffer.from(tampered.ciphertext, "base64"); ciphertext[0] ^= 1; tampered.ciphertext = ciphertext.toString("base64");
  const badEnvelope = path.join(sealed.dir, "bad-envelope.json"); write(sealed.dir, "bad-envelope.json", tampered);
  rejected(() => decryptRuntimeBundle(badEnvelope, privateFile, path.join(sealed.dir, "bad-decrypt"), sha(fs.readFileSync(badEnvelope)), env.GITHUB_RUN_ID, env.GITHUB_SHA), "EXPORT_DECRYPTION_FAILED");
  check(() => assert.ok(!fs.existsSync(path.join(sealed.dir, "bad-decrypt"))));
  const sourceLink = fixture(); fs.unlinkSync(path.join(sourceLink.stateDirectory, "order-ledger.json"));
  fs.symlinkSync(path.join(sealed.stateDirectory, "order-ledger.json"), path.join(sourceLink.stateDirectory, "order-ledger.json"));
  rejected(() => beginPhase("preview", { ...sourceLink, now: at(1) }), "EXPORT_SOURCE_FILE_INVALID");
  const overlap = fixture();
  rejected(() => beginPhase("preview", { ...overlap, receiptDirectory: overlap.stateDirectory, now: at(1) }), "BINDING_OUTPUT_OVERLAPS_STATE");
  const secret = fixture(); secret.data[outputs.preview[0]].accessToken = privateMarker;
  rejected(() => complete(secret), "EXPORT_SECRET_FIELD_REJECTED");
  const unsafe = fixture(); unsafe.data[outputs.preview[0]].brokerSubmission.submitted = 1;
  rejected(() => complete(unsafe), "BINDING_SHADOW_SAFETY_INVALID");
  const unavailable = fixture(); unavailable.data[outputs.performance[0]].live.available = false;
  rejected(() => complete(unavailable), "BINDING_BROKER_EVIDENCE_UNAVAILABLE");
  const omitted = fixture(); omitted.data[outputs.protection[0]].rows = [];
  rejected(() => complete(omitted), "BINDING_PORTFOLIO_INCOMPLETE");

  // Actual workflow shell boundary, with synthetic producers and network denied.
  const wrapped = fixture();
  fs.symlinkSync(path.resolve("scripts"), path.join(wrapped.dir, "scripts"), "dir");
  const offline = path.join(wrapped.dir, "offline.cjs");
  fs.writeFileSync(offline, `const deny=()=>{throw Error('NETWORK_FORBIDDEN')};globalThis.fetch=deny;for(const n of ['http','https']){const m=require('node:'+n);m.request=deny;m.get=deny;}for(const n of ['net','tls']){const m=require('node:'+n);m.connect=deny;m.createConnection=deny;}`);
  const shellEnv = { PATH: process.env.PATH, ...sealEnv, RUNNER_TEMP: wrapped.dir, NODE_OPTIONS: `--require=${offline}`,
    GITHUB_STEP_SUMMARY: path.join(wrapped.dir, "public.md"), GITHUB_OUTPUT: path.join(wrapped.dir, "github-output") };
  for (const phase of phases) {
    const step = path.join(wrapped.dir, `${phase}.sh`);
    fs.writeFileSync(step, `node --input-type=module <<'NODE'\nimport fs from 'node:fs';\nconst data=${JSON.stringify(wrapped.data)};\nfor(const name of ${JSON.stringify(outputs[phase])}) fs.writeFileSync('state/'+name,JSON.stringify({...data[name],generatedAt:new Date().toISOString()}));\nconsole.log('${privateMarker}');\nNODE\n`);
    const r = spawnSync("bash", [path.resolve("scripts/run-private-sidecar-step.sh"), step], { cwd: wrapped.dir, env: { ...shellEnv, PAPER_EVIDENCE_PHASE: phase }, encoding: "utf8" });
    check(() => { assert.equal(r.status, 0); assert.ok(!`${r.stdout}${r.stderr}`.includes(privateMarker)); });
  }
  const implementation = path.resolve("scripts/paper-runtime-private-binding.mjs");
  const runSeal = e => spawnSync(process.execPath, [implementation, "seal"], { cwd: wrapped.dir, env: e, encoding: "utf8" });
  const shellResult = runSeal(shellEnv);
  check(() => { assert.equal(shellResult.status, 0, shellResult.stdout); assert.ok(!`${shellResult.stdout}${shellResult.stderr}`.includes(privateMarker)); });
  check(() => assert.equal(fs.readFileSync(shellEnv.GITHUB_OUTPUT, "utf8"), "encrypted=true\n"));
  check(() => assert.equal(JSON.parse(fs.readFileSync(path.join(wrapped.dir, "paper-runtime-binding-safe.json"))).sameRunBindingVerified, true));
  const noKey = fixture();
  const noKeyResult = runSeal({ ...env, RUNNER_TEMP: noKey.dir, GITHUB_OUTPUT: path.join(noKey.dir, "output") });
  check(() => assert.equal(JSON.parse(noKeyResult.stdout).status, "BINDING_RECIPIENT_NOT_CONFIGURED"));
  check(() => assert.ok(!fs.existsSync(path.join(noKey.dir, "output")) && !fs.existsSync(path.join(noKey.dir, "paper-runtime-encrypted"))));
  const wf = fs.readFileSync(".github/workflows/dry-run.yml", "utf8");
  check(() => assert.deepEqual([...wf.matchAll(/PAPER_EVIDENCE_PHASE: (\w+)/g)].map(m => m[1]), phases));
  check(() => assert.ok(wf.includes("github.run_attempt == 1") && wf.includes("steps.paper_binding.outputs.encrypted == 'true'")));
  const legacy = fs.readFileSync(".github/workflows/paper-exact-cache-private-export.yml", "utf8");
  check(() => assert.ok(!legacy.includes("paper-runtime-private-binding")));
  console.log(JSON.stringify({ status: "PASS", cases, brokerRequests: 0, productionStateWrites: 0 }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
