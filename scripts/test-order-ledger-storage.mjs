import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { syncBuiltinESMExports } from "node:module";
import { loadOrderLedgerState, saveOrderLedgerState, OrderLedgerStorageError } from "../dist/src/order-ledger-storage.js";
import { OrderIdempotencyStorageError } from "../dist/src/order-idempotency-storage.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "order-ledger-storage-"));
const file = path.join(root, "order-ledger.json");
const source = await fs.readFile("src/index.ts", "utf8");
const ast = ts.createSourceFile("index.ts", source, ts.ScriptTarget.ES2022, true);
const functions = (...names) => ast.statements.filter((node) =>
  ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map((node) => node.getText(ast)).join("\n");
const run = (code, context) => vm.runInContext(ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText, context);
const context = vm.createContext({
  ORDER_LEDGER_PATH: file, readOrderLedgerState: loadOrderLedgerState,
  writeOrderLedgerState: saveOrderLedgerState, console: { log() {} },
});
run(functions("loadOrderLedgerState", "saveOrderLedgerState"), context);
const at = "2026-09-28T18:24:44.871Z";
const row = {
  idempotencyKey: "synthetic-key", symbol: "SYNTHETIC", side: "buy", executionSide: "sell",
  actionType: "EXIT_FULL", submittedQty: null, stage6Hash: "a".repeat(64), stage6File: "STAGE6_FIXTURE.json",
  mode: "DRY_RUN", clientOrderId: "synthetic-client", status: "planned", statusReason: "fixture",
  preflightCode: "fixture", regimeProfile: "default", notional: 100, limitPrice: 10,
  takeProfitPrice: 11, stopLossPrice: 9, brokerOrderId: null, createdAt: at, updatedAt: at,
  history: [{ at, from: null, to: "planned", reason: "fixture", source: "fixture" }],
};
const state = { orders: { [row.idempotencyKey]: row }, updatedAt: at, preservedExtension: { version: 1 } };
const raw = JSON.stringify(state, null, 2);
const seed = () => fs.writeFile(file, raw, { mode: 0o600 });
let rejectedCases = 0;
async function rejected(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof OrderLedgerStorageError);
    assert.equal(error.message, "ORDER_LEDGER_" + code);
    assert.equal(error.cause, undefined);
    assert.ok(!error.stack.includes("synthetic-client"));
    assert.ok(!error.message.includes(root));
    return true;
  });
  rejectedCases++;
}
async function fault(name, replacement, body) {
  const original = fs[name];
  fs[name] = (...args) => replacement(original, ...args);
  syncBuiltinESMExports();
  try { await body(); }
  finally { fs[name] = original; syncBuiltinESMExports(); }
}
try {
  await rejected(context.loadOrderLedgerState(), "READ_FAILED");
  await assert.rejects(fs.stat(file), { code: "ENOENT" });
  await seed();
  await fault("readFile", () => { throw new Error("private-account synthetic-client secret"); }, async () => {
    await rejected(context.loadOrderLedgerState(), "READ_FAILED");
  });
  for (const invalid of ["", "{private-corruption", raw.slice(0, -2), raw.replace('"notional": 100', '"notional": NaN'),
    Buffer.concat([Buffer.from(raw.slice(0, -1) + ',"utf8":"'), Buffer.from([0xff]), Buffer.from('"}')])]) {
    await fs.writeFile(file, invalid);
    await rejected(context.loadOrderLedgerState(), "JSON_INVALID");
    assert.deepEqual(await fs.readFile(file), Buffer.from(invalid));
  }
  const invalidRows = [null, [], { ...row, idempotencyKey: "other-key" }, { ...row, symbol: "" },
    { ...row, status: "invented" }, { ...row, side: "sell" }, { ...row, clientOrderId: null },
    { ...row, brokerOrderId: undefined }, { ...row, actionType: ["EXIT_FULL"] },
    { ...row, submittedQty: "1" }, { ...row, executionSide: "short" }, { ...row, regimeProfile: "invented" },
    { ...row, createdAt: "2026-02-30T00:00:00Z" }, { ...row, updatedAt: "invalid" },
    { ...row, notional: null }, { ...row, limitPrice: "10" }, { ...row, history: {} },
    { ...row, history: [null] }, { ...row, history: [{ ...row.history[0], to: "invented" }] }];
  for (const invalid of [null, [], {}, { ...state, orders: [] }, { ...state, updatedAt: "" },
    ...invalidRows.map((entry) => ({ ...state, orders: { [row.idempotencyKey]: entry } }))]) {
    const bytes = JSON.stringify(invalid);
    await fs.writeFile(file, bytes);
    await rejected(context.loadOrderLedgerState(), "SCHEMA_INVALID");
    assert.equal(await fs.readFile(file, "utf8"), bytes);
  }
  await fs.writeFile(file, JSON.stringify({ orders: {}, updatedAt: "" }));
  assert.equal(Object.keys((await context.loadOrderLedgerState()).orders).length, 0);
  await seed();
  await rejected(saveOrderLedgerState(file, structuredClone(state)), "UNLOADED_STATE");
  const loaded = await context.loadOrderLedgerState();
  assert.deepEqual(loaded, state);
  await context.saveOrderLedgerState(loaded);
  const saved = await fs.readFile(file);
  await context.saveOrderLedgerState(loaded);
  assert.deepEqual(await fs.readFile(file), saved);
  assert.deepEqual(await context.loadOrderLedgerState(), state);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  loaded.orders[row.idempotencyKey].notional = NaN;
  await rejected(context.saveOrderLedgerState(loaded), "SCHEMA_INVALID");
  assert.deepEqual(await fs.readFile(file), saved);

  for (const operation of ["create", "write", "sync", "readback", "rename"]) {
    await seed();
    const next = await context.loadOrderLedgerState();
    next.updatedAt = "2026-09-28T18:25:00.000Z";
    const method = operation === "readback" ? "readFile" : operation === "rename" ? "rename" : "open";
    await fault(method, async (original, target, ...args) => {
      if (operation === "rename") throw new Error("private synthetic failure");
      if (String(target).endsWith(".tmp")) {
        if (operation === "create") throw new Error("private synthetic failure");
        if (operation === "readback") return Buffer.from("{corrupt temporary bytes");
        const handle = await original(target, ...args);
        handle[operation === "write" ? "writeFile" : "sync"] = async () => { throw new Error("private failure"); };
        return handle;
      }
      return original(target, ...args);
    }, async () => { await rejected(context.saveOrderLedgerState(next), "WRITE_FAILED"); });
    assert.equal(await fs.readFile(file, "utf8"), raw);
    assert.deepEqual(await fs.readdir(root), ["order-ledger.json"]);
  }
  const beforeDrift = await context.loadOrderLedgerState();
  await fs.writeFile(file, raw + "\n");
  await rejected(context.saveOrderLedgerState(beforeDrift), "WRITE_FAILED");
  assert.equal(await fs.readFile(file, "utf8"), raw + "\n");
  await fs.writeFile(file + ".lock", "", { mode: 0o600 });
  await rejected(context.loadOrderLedgerState(), "LOCK_UNAVAILABLE");
  await rejected(context.saveOrderLedgerState(beforeDrift), "LOCK_UNAVAILABLE");
  await fs.unlink(file + ".lock"); // Synthetic fixture cleanup only.
  await seed();
  const uncertain = await context.loadOrderLedgerState();
  await fault("open", async (original, target, ...args) => {
    const handle = await original(target, ...args);
    if (target === root) handle.sync = async () => { throw new Error("private failure"); };
    return handle;
  }, async () => { await rejected(context.saveOrderLedgerState(uncertain), "COMMIT_UNCERTAIN"); });
  await rejected(context.loadOrderLedgerState(), "LOCK_UNAVAILABLE");
  await fs.unlink(file + ".lock");

  // Exercise the real callers/catches without importing the network-bearing main module.
  const failure = new OrderLedgerStorageError("READ_FAILED");
  let downstream = 0;
  const isolated = vm.createContext({
    loadRuntimeConfig: () => ({ execEnabled: true, readOnly: false }),
    runLifecycleSelfTestIfEnabled() {}, readBoolEnv: () => false,
    loadOrderLedgerState: async () => { throw failure; },
    printStartupSummary: () => { downstream++; },
    getGoogleAccessToken: () => { downstream++; throw new Error("must not request"); },
  });
  run(functions("main"), isolated);
  await rejected(isolated.main(), "READ_FAILED");
  assert.equal(downstream, 0);
  Object.assign(isolated, {
    readBoolEnv: (_name, fallback) => fallback,
    readPositiveNumberEnv: (_name, fallback) => fallback,
    pruneOrderLedgerState: () => { downstream++; },
  });
  run(functions("updateOrderLedger"), isolated);
  await rejected(isolated.updateOrderLedger({}, "DRY_RUN", {}, {}, { submitted: 0 }), "READ_FAILED");
  assert.equal(downstream, 0);
  Object.assign(isolated, {
    readBoolEnv: (name, fallback) => name === "LIVE_ORDER_SUBMIT_ENABLED" ? true : fallback,
    resolveWorkflowDispatchBrokerMutationGate: () => ({ allowed: true }),
    loadOrderIdempotencyState: () => { downstream++; throw new Error("must not proceed"); },
  });
  run(functions("submitOrdersToBroker"), isolated);
  await rejected(isolated.submitOrdersToBroker({ payloads: [{ idempotencyKey: row.idempotencyKey }] }, { blocking: false }), "READ_FAILED");
  assert.equal(downstream, 0);
  const catchMarkers = ["row.submitted = false;", "held_position_load_failed=", 'summary.reason = "position_fetch_failed";', "[HELD_POSITION_READ]"];
  const catches = [];
  const visit = (node) => {
    if (ts.isCatchClause(node) && catchMarkers.some((marker) => node.getText(ast).includes(marker))) catches.push(node.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(catches.length, 4);
  for (const clause of catches) {
    const scope = vm.createContext({ failure, OrderLedgerStorageError, OrderIdempotencyStorageError,
      afterFailure: () => { downstream++; } });
    run("async function invoke() { try { throw failure; } " + clause + " afterFailure(); }", scope);
    await rejected(scope.invoke(), "READ_FAILED");
  }
  assert.equal(downstream, 0);

  // Existing update semantics and optional legacy fields remain compatible.
  await seed();
  Object.assign(context, {
    readBoolEnv: (_name, fallback) => fallback, readPositiveNumberEnv: (_name, fallback) => fallback,
    pruneOrderLedgerState: () => 0, isTransitionAllowed: () => true,
    isLifecycleExitActionType: () => false,
    loadOrderIdempotencyState: async () => ({ orders: {}, releases: [], updatedAt: at }),
    reconcileOrderLedgerWithIdempotency: () => 0,
  });
  run(functions("updateOrderLedger"), context);
  const stage6 = { sha256: row.stage6Hash, fileName: row.stage6File };
  const payload = { idempotencyKey: row.idempotencyKey, symbol: row.symbol, side: "buy", actionType: "ENTRY_NEW",
    client_order_id: row.clientOrderId, notional: 100, limit_price: 10, take_profit: { limit_price: 11 }, stop_loss: { stop_price: 9 } };
  const dryExec = { regime: { profile: "default" }, payloads: [payload] };
  const brokerSubmit = { submitted: 0, active: false, reason: "submit_disabled", orders: {} };
  for (let i = 0; i < 2; i++) {
    const result = await context.updateOrderLedger(stage6, "DRY_RUN", dryExec, { code: "fixture" }, brokerSubmit);
    assert.equal(result.unchanged, 1);
    assert.equal(result.upserted, 0);
    assert.equal(await fs.readFile(file, "utf8"), raw);
  }
  const newDryExec = { ...dryExec, payloads: [{ ...payload, idempotencyKey: "new-synthetic-key" }] };
  await fault("rename", () => { throw new Error("private failure"); }, async () => {
    await rejected(context.updateOrderLedger(stage6, "DRY_RUN", newDryExec, { code: "fixture" }, brokerSubmit), "WRITE_FAILED");
  });
  assert.equal(await fs.readFile(file, "utf8"), raw);
  const result = await context.updateOrderLedger(stage6, "DRY_RUN", newDryExec, { code: "fixture" }, brokerSubmit);
  assert.equal(result.upserted, 1);
  const post = await context.loadOrderLedgerState();
  assert.deepEqual(post.orders[row.idempotencyKey], row);
  assert.equal(post.orders["new-synthetic-key"].status, "planned");
  const legacy = structuredClone(state);
  for (const field of ["actionType", "executionSide", "submittedQty"]) delete legacy.orders[row.idempotencyKey][field];
  await fs.writeFile(file, JSON.stringify(legacy));
  assert.deepEqual(await context.loadOrderLedgerState(), legacy);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log("[ORDER_LEDGER_STORAGE] PASS rejectionCases=" + rejectedCases + " brokerRequests=0 productionStateMutation=0");
