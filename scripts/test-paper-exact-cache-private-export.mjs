import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const implementation = path.resolve("scripts/paper-exact-cache-private-export.mjs");
assert.ok(fs.existsSync(implementation), "Missing exact-cache encrypted export implementation");
const { APPROVAL, CACHE_KEY, FILES, preflight, encryptSource, decryptSource } = await import(pathToFileURL(implementation));
const sha = b => createHash("sha256").update(b).digest("hex");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "encrypted-export-test-")));
const pair = generateKeyPairSync("rsa", { modulusLength: 3072 });
const der = pair.publicKey.export({ type: "spki", format: "der" });
const keyFile = path.join(root, "private.pem");
fs.writeFileSync(keyFile, pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
const env = { APPROVAL_PHRASE: APPROVAL, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "12345", GITHUB_SHA: "a".repeat(40), EXPECTED_MAIN_SHA: "a".repeat(40),
  RECIPIENT_PUBLIC_KEY: der.toString("base64"), RECIPIENT_SHA256: sha(der), EXPECTED_CACHE_ID: "789", EXPECTED_CACHE_VERSION: "b".repeat(64),
  CACHE_HIT: "true", CACHE_MATCHED_KEY: CACHE_KEY, READ_ONLY: "true", EXEC_ENABLED: "false", LIVE_ORDER_SUBMIT_ENABLED: "false" };
const history = { total_count: 1, workflow_runs: [{ id: 12345, run_attempt: 1, event: "workflow_dispatch", head_branch: "main", head_sha: env.GITHUB_SHA }] };
const caches = { total_count: 1, actions_caches: [{ id: 789, key: CACHE_KEY, ref: "refs/heads/main", version: env.EXPECTED_CACHE_VERSION }] };
let cases = 0;
function check(fn) { fn(); cases++; }
function rejected(fn, code) { check(() => assert.throws(fn, error => error.message === code)); }
function fixture(label) {
  const dir = path.join(root, label); fs.mkdirSync(dir, { mode: 0o700 });
  for (const name of FILES) fs.writeFileSync(path.join(dir, name), JSON.stringify({ marker: "SYNTHETIC_PRIVATE_IDENTIFIER_DO_NOT_PRINT", originalTimestamp: "2026-01-01T00:00:00Z" }) + "\n");
  return dir;
}
try {
  check(() => preflight(env, history, caches));
  for (const [key, value, code] of [
    ["APPROVAL_PHRASE", "", "EXPORT_APPROVAL_REQUIRED"], ["GITHUB_EVENT_NAME", "push", "EXPORT_DISPATCH_MAIN_ONLY"],
    ["GITHUB_REF", "refs/heads/feature", "EXPORT_DISPATCH_MAIN_ONLY"], ["GITHUB_RUN_ATTEMPT", "2", "EXPORT_RERUN_REJECTED"],
    ["EXPECTED_MAIN_SHA", "c".repeat(40), "EXPORT_COMMIT_MISMATCH"], ["RECIPIENT_SHA256", "d".repeat(64), "EXPORT_RECIPIENT_INVALID"],
    ["READ_ONLY", "false", "EXPORT_SAFETY_FLAGS_INVALID"], ["EXEC_ENABLED", "true", "EXPORT_SAFETY_FLAGS_INVALID"],
    ["LIVE_ORDER_SUBMIT_ENABLED", "true", "EXPORT_SAFETY_FLAGS_INVALID"]
  ]) rejected(() => preflight({ ...env, [key]: value }, history, caches), code);
  rejected(() => preflight(env, { ...history, total_count: 2 }, caches), "EXPORT_PREVIOUS_OR_CONCURRENT_ATTEMPT");
  rejected(() => preflight(env, history, { ...caches, actions_caches: [] }), "EXPORT_EXACT_CACHE_UNAVAILABLE");
  rejected(() => preflight(env, history, { ...caches, actions_caches: [caches.actions_caches[0], caches.actions_caches[0]] }), "EXPORT_EXACT_CACHE_UNAVAILABLE");
  rejected(() => preflight({ ...env, EXPECTED_CACHE_ID: "790" }, history, caches), "EXPORT_EXACT_CACHE_UNAVAILABLE");
  rejected(() => preflight({ ...env, EXPECTED_CACHE_VERSION: "c".repeat(64) }, history, caches), "EXPORT_EXACT_CACHE_UNAVAILABLE");
  const weak = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "der" });
  rejected(() => preflight({ ...env, RECIPIENT_PUBLIC_KEY: weak.toString("base64"), RECIPIENT_SHA256: sha(weak) }, history, caches), "EXPORT_RECIPIENT_INVALID");
  const source = fixture("source");
  const before = FILES.map(n => sha(fs.readFileSync(path.join(source, n))));
  fs.writeFileSync(path.join(source, "extra-private.json"), '{"doNotExport":true}');
  const sealed = path.join(root, "envelope.json");
  check(() => encryptSource(source, sealed, env));
  const bytes = fs.readFileSync(sealed), envelope = JSON.parse(bytes);
  check(() => assert.ok(!bytes.includes("SYNTHETIC_PRIVATE_IDENTIFIER_DO_NOT_PRINT")));
  check(() => assert.deepEqual(FILES.map(n => sha(fs.readFileSync(path.join(source, n)))), before));
  const output = path.join(root, "decrypted");
  check(() => decryptSource(sealed, keyFile, output, sha(bytes), env.GITHUB_RUN_ID, env.GITHUB_SHA));
  check(() => assert.deepEqual(FILES.map(n => sha(fs.readFileSync(path.join(output, "source", n)))), before));
  check(() => assert.equal(fs.statSync(path.join(output, "source")).mode & 0o777, 0o700));
  check(() => assert.ok(FILES.every(n => (fs.statSync(path.join(output, "source", n)).mode & 0o777) === 0o600)));
  check(() => assert.ok(!fs.existsSync(path.join(output, "source", "extra-private.json"))));
  rejected(() => decryptSource(sealed, keyFile, output, sha(bytes), env.GITHUB_RUN_ID, env.GITHUB_SHA), "EXPORT_OUTPUT_EXISTS");
  rejected(() => decryptSource(sealed, keyFile, path.join(root, "bad-hash"), "f".repeat(64), env.GITHUB_RUN_ID, env.GITHUB_SHA), "EXPORT_ENVELOPE_HASH_MISMATCH");
  rejected(() => decryptSource(sealed, keyFile, path.join(root, "bad-run"), sha(bytes), "999", env.GITHUB_SHA), "EXPORT_CONTEXT_MISMATCH");
  rejected(() => decryptSource(sealed, keyFile, path.join(root, "bad-commit"), sha(bytes), env.GITHUB_RUN_ID, "c".repeat(40)), "EXPORT_CONTEXT_MISMATCH");
  fs.chmodSync(keyFile, 0o644);
  rejected(() => decryptSource(sealed, keyFile, path.join(root, "bad-key-mode"), sha(bytes), env.GITHUB_RUN_ID, env.GITHUB_SHA), "EXPORT_PRIVATE_PERMISSIONS_INVALID");
  fs.chmodSync(keyFile, 0o600);
  for (const field of ["ciphertext", "tag", "wrappedKey"]) {
    const altered = structuredClone(envelope); const b = Buffer.from(altered[field], "base64"); b[0] ^= 1; altered[field] = b.toString("base64");
    const file = path.join(root, `tampered-${field}.json`); fs.writeFileSync(file, JSON.stringify(altered));
    rejected(() => decryptSource(file, keyFile, path.join(root, `reject-${field}`), sha(fs.readFileSync(file)), env.GITHUB_RUN_ID, env.GITHUB_SHA), "EXPORT_DECRYPTION_FAILED");
  }
  const missing = fixture("missing"); fs.unlinkSync(path.join(missing, FILES[0]));
  rejected(() => encryptSource(missing, path.join(root, "missing-sealed"), env), "EXPORT_SOURCE_FILE_INVALID");
  const linked = fixture("linked"); fs.unlinkSync(path.join(linked, FILES[0])); fs.symlinkSync(path.join(source, FILES[0]), path.join(linked, FILES[0]));
  rejected(() => encryptSource(linked, path.join(root, "linked-sealed"), env), "EXPORT_SOURCE_FILE_INVALID");
  const invalid = fixture("invalid"); fs.writeFileSync(path.join(invalid, FILES[0]), 'invalid-private-content');
  rejected(() => encryptSource(invalid, path.join(root, "invalid-sealed"), env), "EXPORT_SOURCE_JSON_INVALID");
  const secret = fixture("secret"); fs.writeFileSync(path.join(secret, FILES[0]), '{"accessToken":"SYNTHETIC_SECRET"}');
  rejected(() => encryptSource(secret, path.join(root, "secret-sealed"), env), "EXPORT_SECRET_FIELD_REJECTED");
  const cli = spawnSync(process.execPath, [implementation, "encrypt", secret, path.join(root, "cli-sealed")], { env, encoding: "utf8" });
  check(() => { assert.equal(cli.status, 1); assert.equal(cli.stderr, ""); assert.equal(JSON.parse(cli.stdout).status, "EXPORT_SECRET_FIELD_REJECTED");
    assert.ok(!cli.stdout.includes("SYNTHETIC_SECRET") && !cli.stdout.includes(root)); });
  rejected(() => encryptSource(source, path.join(root, "cache-miss"), { ...env, CACHE_HIT: "false" }), "EXPORT_EXACT_CACHE_MISS");
  rejected(() => encryptSource(source, path.join(root, "cache-prefix"), { ...env, CACHE_MATCHED_KEY: `${CACHE_KEY}-other` }), "EXPORT_EXACT_CACHE_MISS");
  rejected(() => encryptSource(source, path.join(source, "envelope.json"), env), "EXPORT_OUTPUT_OVERLAPS_SOURCE");
  rejected(() => encryptSource(source, sealed, env), "EXPORT_OUTPUT_EXISTS");
  const again = path.join(root, "again.json"); encryptSource(source, again, env);
  check(() => assert.notEqual(sha(fs.readFileSync(again)), sha(bytes))); // Fresh GCM nonce; original-byte hashes remain deterministic.
  const wf = fs.readFileSync(".github/workflows/paper-exact-cache-private-export.yml", "utf8");
  check(() => assert.ok(wf.includes("workflow_dispatch:") && !/^  (push|pull_request|schedule|repository_dispatch):/m.test(wf)));
  check(() => assert.ok(wf.includes("actions/cache/restore@") && wf.includes("fail-on-cache-miss: true")));
  check(() => assert.ok(!/restore-keys:|actions\/cache\/save|secrets\.|ALPACA|npm (ci|install)|npm run start/.test(wf)));
  check(() => assert.ok(wf.includes("path: ${{ runner.temp }}/paper-export/envelope.json") && !wf.includes("path: state\n          retention")));
  console.log(JSON.stringify({ status: "PASS", cases, brokerRequests: 0, runtimeCacheRestores: 0, productionStateWrites: 0 }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
