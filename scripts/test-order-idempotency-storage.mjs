import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import vm from "node:vm";
import ts from "typescript";
import { loadOrderIdempotencyState, saveOrderIdempotencyState } from "../dist/src/order-idempotency-storage.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "idempotency-storage-"));
const file = path.join(root, "order-idempotency.json");
const at = "2026-09-28T18:24:44.871Z";
const entry = {
  symbol: "SYNTHETIC", side: "buy", stage6Hash: "a".repeat(64), stage6File: "STAGE6_FIXTURE.json",
  firstSeenAt: at, lastSeenAt: at, clientOrderId: "synthetic-client", brokerOrderId: null, brokerStatus: null,
};
const limited = {
  ...entry, firstSeenAt: null, lastSeenAt: null, recoveryMode: "ACTIVE_POSITION_LIMITED_CONTROL",
  originalIdempotencyEvidenceStatus: "HISTORY_IRRECOVERABLE", recoveryEvidenceSha256: "b".repeat(64),
  recoveryRecordedAt: at, recoveryRecordedAtIsOriginalTimestamp: false, entryAllowed: false,
  scaleInAllowed: false, riskIncreasingActionAllowed: false, reportOnlyExitEvaluationAllowed: true,
  brokerSubmitAllowed: false, realizedPnlVerified: false, historicalEvidenceNormalized: false,
};
const state = {
  orders: { "legacy-exact-key": entry, "limited-exact-key": limited },
  releases: [{ ...entry, key: "released-key", releasedAt: at, reason: "terminal", brokerStatus: "filled" }],
  updatedAt: at, preservedExtension: { version: 1 },
};
const raw = JSON.stringify(state, null, 2);
const seed = () => fs.writeFile(file, raw, { mode: 0o600 });
let assertions = 0;
async function rejected(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.message, "ORDER_IDEMPOTENCY_" + code);
    assert.equal(error.cause, undefined);
    assert.ok(!String(error.stack).includes(raw));
    return true;
  });
  assertions++;
}
async function fault(name, replacement, body) {
  const original = fs[name];
  fs[name] = (...args) => replacement(original, ...args);
  syncBuiltinESMExports();
  try { await body(); }
  finally { fs[name] = original; syncBuiltinESMExports(); }
}

try {
  await rejected(loadOrderIdempotencyState(file), "READ_FAILED");
  await seed();
  await fault("readFile", () => { throw new Error("private-account synthetic-client secret"); }, async () => {
    await rejected(loadOrderIdempotencyState(file), "READ_FAILED");
  });
  for (const invalid of ["", "{private-account", raw.slice(0, -2), raw.replace('"version": 1', '"version": NaN')]) {
    await fs.writeFile(file, invalid);
    await rejected(loadOrderIdempotencyState(file), "JSON_INVALID");
    assert.equal(await fs.readFile(file, "utf8"), invalid);
  }
  const invalidUtf8 = Buffer.concat([Buffer.from(raw.slice(0, -1) + ',"encodingProbe":"'), Buffer.from([0xff]), Buffer.from('"}')]);
  await fs.writeFile(file, invalidUtf8);
  await rejected(loadOrderIdempotencyState(file), "JSON_INVALID");
  assert.deepEqual(await fs.readFile(file), invalidUtf8);
  // Different bytes with identical lossy decoding must not pass optimistic concurrency.
  await fs.writeFile(file, invalidUtf8.toString("utf8"));
  const encodingDrift = await loadOrderIdempotencyState(file);
  await fs.writeFile(file, invalidUtf8);
  await rejected(saveOrderIdempotencyState(file, encodingDrift), "WRITE_FAILED");
  assert.deepEqual(await fs.readFile(file), invalidUtf8);
  const invalidStates = [null, [], {}, { ...state, orders: [] }, { ...state, orders: null },
    { ...state, releases: {} }, { ...state, updatedAt: "" }, { ...state, orders: { bad: null } },
    { ...state, orders: { bad: { ...entry, symbol: null } } },
    { ...state, orders: { bad: { ...entry, firstSeenAt: "invalid" } } },
    { ...state, orders: { bad: { ...entry, firstSeenAt: "2026-02-30T00:00:00.000Z" } } },
    { ...state, orders: { bad: { ...entry, actionType: ["ENTRY_NEW"] } } },
    { ...state, orders: { bad: { ...limited, brokerSubmitAllowed: true } } },
    { ...state, orders: { bad: { ...limited, recoveryMode: "UNKNOWN" } } },
    { ...state, orders: { bad: { ...limited, recoveryMode: undefined } } },
    { ...state, orders: { bad: { ...limited, entryAllowed: undefined } } },
    { ...state, releases: [null] },
    { ...state, releases: [{ ...state.releases[0], brokerStatus: undefined }] }];
  for (const invalid of invalidStates) {
    const bytes = JSON.stringify(invalid);
    await fs.writeFile(file, bytes);
    await rejected(loadOrderIdempotencyState(file), "SCHEMA_INVALID");
    assert.equal(await fs.readFile(file, "utf8"), bytes);
  }
  // Explicitly initialized empty state is valid; missing state is never initialization.
  await fs.writeFile(file, JSON.stringify({ orders: {}, releases: [], updatedAt: "" }));
  assert.equal(Object.keys((await loadOrderIdempotencyState(file)).orders).length, 0);
  await seed();
  await rejected(saveOrderIdempotencyState(file, structuredClone(state)), "UNLOADED_STATE");
  const loaded = await loadOrderIdempotencyState(file);
  assert.deepEqual(loaded, state);
  loaded.updatedAt = "2026-09-28T18:25:00.000Z";
  await saveOrderIdempotencyState(file, loaded);
  const first = await fs.readFile(file, "utf8");
  await saveOrderIdempotencyState(file, loaded);
  assert.equal(await fs.readFile(file, "utf8"), first);
  assert.deepEqual((await loadOrderIdempotencyState(file)).orders, state.orders);
  assert.deepEqual((await loadOrderIdempotencyState(file)).releases, state.releases);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(root), ["order-idempotency.json"]);

  for (const operation of ["create", "write", "sync", "readback", "rename"]) {
    await seed();
    const next = await loadOrderIdempotencyState(file);
    next.updatedAt = "2026-09-28T18:26:00.000Z";
    const io = operation === "rename" ? "rename" : operation === "readback" ? "readFile" : "open";
    await fault(io, async (original, ...args) => {
      if (operation === "rename") throw new Error("private rename failure");
      if (String(args[0]).endsWith(".tmp")) {
        if (operation === "readback") return Buffer.from("{}");
        if (operation === "create") throw new Error("private create failure");
        const handle = await original(...args);
        if (operation === "write") handle.writeFile = async () => {
          await handle.write("partial");
          throw new Error("private disk full");
        };
        else handle.sync = async () => { throw new Error("private sync failure"); };
        return handle;
      }
      return original(...args);
    }, async () => { await rejected(saveOrderIdempotencyState(file, next), "WRITE_FAILED"); });
    assert.equal(await fs.readFile(file, "utf8"), raw);
    assert.deepEqual(await fs.readdir(root), ["order-idempotency.json"]);
  }
  await seed();
  const stale = await loadOrderIdempotencyState(file);
  const fresh = await loadOrderIdempotencyState(file);
  fresh.orders["new-dedup-key"] = { ...entry };
  await saveOrderIdempotencyState(file, fresh);
  const freshBytes = await fs.readFile(file, "utf8");
  await rejected(saveOrderIdempotencyState(file, stale), "WRITE_FAILED");
  assert.equal(await fs.readFile(file, "utf8"), freshBytes);
  const invalidWrite = await loadOrderIdempotencyState(file);
  invalidWrite.orders["new-dedup-key"].submittedQty = NaN;
  await rejected(saveOrderIdempotencyState(file, invalidWrite), "SCHEMA_INVALID");
  assert.equal(await fs.readFile(file, "utf8"), freshBytes);
  const deleted = await loadOrderIdempotencyState(file);
  await fs.unlink(file);
  await rejected(saveOrderIdempotencyState(file, deleted), "WRITE_FAILED");
  await assert.rejects(fs.stat(file), { code: "ENOENT" });

  await seed();
  const uncertain = await loadOrderIdempotencyState(file);
  uncertain.updatedAt = "2026-09-28T18:27:00.000Z";
  await fault("open", async (original, ...args) => {
    const handle = await original(...args);
    if (args[0] === root) handle.sync = async () => { throw new Error("synthetic directory sync failure"); };
    return handle;
  }, async () => { await rejected(saveOrderIdempotencyState(file, uncertain), "COMMIT_UNCERTAIN"); });
  assert.equal(await fs.readFile(file, "utf8"), JSON.stringify(uncertain, null, 2));
  await rejected(loadOrderIdempotencyState(file), "LOCK_UNAVAILABLE");
  await fs.unlink(file + ".lock"); // Synthetic fixture only, never a runtime recovery.

  // Kill a writer before rename: preserve old bytes and require explicit lock recovery.
  await seed();
  const beforeCrash = await loadOrderIdempotencyState(file);
  const storageUrl = new URL("../dist/src/order-idempotency-storage.js", import.meta.url).href;
  const childCode = [
    "import fs from 'node:fs/promises';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "import { loadOrderIdempotencyState, saveOrderIdempotencyState } from " + JSON.stringify(storageUrl) + ";",
    "const file = " + JSON.stringify(file) + ";",
    "const state = await loadOrderIdempotencyState(file);",
    "fs.rename = async () => { process.send('before-rename'); await new Promise(() => {}); };",
    "syncBuiltinESMExports(); setInterval(() => {}, 1000);",
    "await saveOrderIdempotencyState(file, state);",
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", childCode],
    { env: { PATH: process.env.PATH }, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
  try {
    const event = await Promise.race([once(child, "message"), once(child, "exit").then(() => { throw new Error("fixture child exited early"); })]);
    assert.equal(event[0], "before-rename");
    const exit = once(child, "exit");
    child.kill("SIGKILL");
    await exit;
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); }
  assert.equal(await fs.readFile(file, "utf8"), raw);
  await rejected(loadOrderIdempotencyState(file), "LOCK_UNAVAILABLE");
  await rejected(saveOrderIdempotencyState(file, beforeCrash), "LOCK_UNAVAILABLE");
  assert.equal((await fs.stat(file + ".lock")).mode & 0o777, 0o600);
  // Test-only cleanup of the synthetic crash; runtime never removes an abandoned lock.
  for (const name of await fs.readdir(root)) if (name !== "order-idempotency.json") await fs.unlink(path.join(root, name));

  // Real shared wrappers/apply logic, isolated from the network-bearing index.main().
  const source = await fs.readFile("src/index.ts", "utf8");
  const ast = ts.createSourceFile("index.ts", source, ts.ScriptTarget.ES2022, true);
  let submitCatch;
  function findSubmitCatch(node) {
    if (ts.isCatchClause(node) && node.block.getText(ast).includes("row.submitted = false;")) submitCatch = node.getText(ast);
    ts.forEachChild(node, findSubmitCatch);
  }
  findSubmitCatch(ast);
  assert.ok(submitCatch);
  let storageError;
  await fs.writeFile(file, "{private-corrupt-state");
  try { await loadOrderIdempotencyState(file); } catch (error) { storageError = error; }
  let downstreamWrites = 0;
  const catchContext = vm.createContext({
    storageError, Error, OrderIdempotencyStorageError: storageError.constructor,
    LifecycleExitPreSubmitBlockedError: class extends Error {},
    row: { actionType: "EXIT_FULL" }, summary: { failed: 0 }, effectiveActionType: "EXIT_FULL",
    isLifecycleExitAction: () => true, console: { warn() {} },
    afterSubmit: () => { downstreamWrites++; },
  });
  vm.runInContext(ts.transpileModule(
    "async function invoke() { try { throw storageError; } " + submitCatch + " afterSubmit(); }",
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText, catchContext);
  await rejected(catchContext.invoke(), "JSON_INVALID");
  assert.equal(downstreamWrites, 0);
  const names = new Set(["loadOrderIdempotencyState", "saveOrderIdempotencyState", "applyOrderIdempotency",
    "isActivePositionLimitedRecoveryEvidence", "activeLimitedRecoveryPayloadBlockReason"]);
  const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
  assert.equal(functions.length, 5);
  let payloadChecks = 0;
  const context = vm.createContext({
    readOrderIdempotencyState: loadOrderIdempotencyState, writeOrderIdempotencyState: saveOrderIdempotencyState,
    ORDER_IDEMPOTENCY_PATH: file, console: { log() {} }, process: { env: {} },
    loadRuntimeConfig: () => ({ execEnabled: false, readOnly: true }),
    readBoolEnv: (key, fallback) => key === "ORDER_IDEMPOTENCY_ENFORCE_DRY_RUN" ? true
      : key === "ORDER_IDEMPOTENCY_ENTRY_RESET_DAILY" ? false : fallback,
    readPositiveNumberEnv: (_key, fallback) => fallback,
    buildOrderIdempotencyBrokerReconcilePolicy: () => ({ enabled: false }),
    pruneOrderIdempotencyState: () => { payloadChecks++; throw new Error("must not reach payload processing"); },
  });
  vm.runInContext(ts.transpileModule(functions.map((node) => node.getText(ast)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context);
  await fs.writeFile(file, "{private-corrupt-state");
  await rejected(context.applyOrderIdempotency({}, { payloads: [], skipped: [] }), "JSON_INVALID");
  assert.equal(payloadChecks, 0);
  await seed();
  const plain = structuredClone(state);
  plain.orders["limited-exact-key"].symbol = "SYNTHETIC_LIMITED";
  await fs.writeFile(file, JSON.stringify(plain));
  Object.assign(context, {
    pruneOrderIdempotencyState: () => 0, toTimeZoneDayKey: () => "fixture-session",
    shouldPassThroughIdempotencyForOpenOrderReprice: () => false,
    findLatestOrderIdempotencyReleaseForKey: () => null, shouldBlockTerminalReentrySameHash: () => false,
    isLifecycleExitActionType: () => false, buildSkipReasonCounts: () => ({}),
    reconcileDecisionAuditWithDryExec: () => [], rebuildActionIntentSummary: () => ({}),
  });
  const stage6 = { sha256: entry.stage6Hash, fileName: entry.stage6File };
  const duplicate = { symbol: entry.symbol, side: "buy", actionType: "ENTRY_NEW", idempotencyKey: "legacy-exact-key" };
  const beforeDedup = await fs.readFile(file, "utf8");
  for (let i = 0; i < 2; i++) {
    const result = await context.applyOrderIdempotency(stage6, { payloads: [duplicate], skipped: [] });
    assert.equal(result.payloads.length, 0);
    assert.equal(result.skipped[0].reason, "idempotency_duplicate");
  }
  assert.equal(await fs.readFile(file, "utf8"), beforeDedup);
  for (const actionType of ["ENTRY_NEW", "SCALE_UP", "EXIT_FULL"]) {
    const result = await context.applyOrderIdempotency(stage6, {
      payloads: [{ ...duplicate, symbol: "SYNTHETIC_LIMITED", actionType, idempotencyKey: "limited-exact-key" }], skipped: [],
    });
    assert.equal(result.payloads.length, 0);
    assert.match(result.skipped[0].reason, /^active_position_limited_control_/);
  }
  await fault("rename", () => { throw new Error("synthetic storage failure"); }, async () => {
    await rejected(context.applyOrderIdempotency(stage6, {
      payloads: [{ ...duplicate, idempotencyKey: "new-key", client_order_id: "synthetic-new-client" }], skipped: [],
    }), "WRITE_FAILED");
  });
  assert.equal(await fs.readFile(file, "utf8"), beforeDedup);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log("[ORDER_IDEMPOTENCY_STORAGE] PASS rejectionCases=" + assertions + " brokerRequests=0 productionStateMutation=0");
