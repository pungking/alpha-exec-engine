import fs from "node:fs";

const STATE_DIR = "state";
const PREVIEW_PATH = `${STATE_DIR}/last-dry-exec-preview.json`;
const PERF_LOOP_PATH = `${STATE_DIR}/stage6-20trade-loop.json`;
const TRIGGER_STATE_PATH = `${STATE_DIR}/validation-pack-auto-trigger.json`;

const readBoolEnv = (key, fallback = false) => {
  const raw = process.env[key];
  if (raw == null || String(raw).trim() === "") return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
};

const readJson = (path) => {
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const parseProgress = (value) => {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const current = Number(match[1]);
  const required = Number(match[2]);
  if (!Number.isFinite(current) || !Number.isFinite(required) || required <= 0) return null;
  return { current, required };
};

const loadTriggerState = () => {
  const parsed = readJson(TRIGGER_STATE_PATH);
  if (!parsed || typeof parsed !== "object") {
    return { triggered: {} };
  }
  const triggered = parsed.triggered && typeof parsed.triggered === "object" ? parsed.triggered : {};
  return { triggered };
};

const saveTriggerState = (state) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(TRIGGER_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const shouldSkipByEvent = () => {
  const eventName = String(process.env.GITHUB_EVENT_NAME || "").trim();
  const inputValidationPack = readBoolEnv("RUN_VALIDATION_PACK_INPUT", false);
  const inputPayloadProbe = readBoolEnv("RUN_PAYLOAD_PROBE_INPUT", false);
  if (eventName === "workflow_dispatch" && (inputValidationPack || inputPayloadProbe)) {
    return "manual_validation_or_probe_run";
  }
  return null;
};

const buildBatchKey = (batchId, gateStatus, gateProgress) =>
  `${String(batchId || "unknown").trim()}|${String(gateStatus || "NA").trim()}|${String(gateProgress || "NA").trim()}`;

const dispatchValidationPack = async (repo, ref, token) => {
  const endpoint = `https://api.github.com/repos/${repo}/actions/workflows/dry-run.yml/dispatches`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ref,
      inputs: {
        validation_pack: "true",
        payload_probe: "false"
      }
    })
  });

  if (response.status === 204) return { ok: true, status: 204, body: "" };
  const body = await response.text();
  return { ok: false, status: response.status, body };
};

const main = async () => {
  const enabled = readBoolEnv("VALIDATION_PACK_AUTO_TRIGGER_ENABLED", false);
  if (!enabled) {
    console.log("[VALIDATION_PACK_AUTO] skipped reason=disabled");
    return;
  }

  const eventSkipReason = shouldSkipByEvent();
  if (eventSkipReason) {
    console.log(`[VALIDATION_PACK_AUTO] skipped reason=${eventSkipReason}`);
    return;
  }

  const preview = readJson(PREVIEW_PATH);
  if (!preview || typeof preview !== "object") {
    console.log(`[VALIDATION_PACK_AUTO] skipped reason=missing_preview path=${PREVIEW_PATH}`);
    return;
  }

  const tuning = preview.hfTuningPhase && typeof preview.hfTuningPhase === "object" ? preview.hfTuningPhase : {};
  const gateStatus = String(tuning.gateStatus || "").trim().toUpperCase();
  const gateProgress = String(tuning.gateProgress || "").trim();
  const progress = parseProgress(gateProgress);
  if (!progress) {
    console.log(`[VALIDATION_PACK_AUTO] skipped reason=invalid_progress value=${gateProgress || "N/A"}`);
    return;
  }

  if (progress.current < progress.required) {
    console.log(
      `[VALIDATION_PACK_AUTO] skipped reason=sample_not_complete progress=${progress.current}/${progress.required}`
    );
    return;
  }

  if (!["GO", "NO_GO"].includes(gateStatus)) {
    console.log(`[VALIDATION_PACK_AUTO] skipped reason=gate_status_not_final status=${gateStatus || "N/A"}`);
    return;
  }

  const perfLoop = readJson(PERF_LOOP_PATH);
  const batchId = String(perfLoop?.batchId || preview.stage6Hash || "unknown").trim();
  const batchKey = buildBatchKey(batchId, gateStatus, gateProgress);
  const state = loadTriggerState();

  if (state.triggered[batchKey]) {
    const prev = state.triggered[batchKey];
    console.log(
      `[VALIDATION_PACK_AUTO] skipped reason=already_triggered batch=${batchId} status=${gateStatus} progress=${gateProgress} at=${prev.triggeredAt || "N/A"}`
    );
    return;
  }

  const repo = String(process.env.GITHUB_REPOSITORY || "").trim();
  const ref = String(process.env.GITHUB_REF_NAME || "").trim();
  const token = String(process.env.GITHUB_TOKEN || "").trim();
  if (!repo || !ref || !token) {
    const missing = [
      !repo ? "GITHUB_REPOSITORY" : null,
      !ref ? "GITHUB_REF_NAME" : null,
      !token ? "GITHUB_TOKEN" : null
    ].filter(Boolean);
    console.log(`[VALIDATION_PACK_AUTO] skipped reason=missing_env missing=${missing.join(",")}`);
    return;
  }

  const dispatch = await dispatchValidationPack(repo, ref, token);
  if (!dispatch.ok) {
    console.log(
      `[VALIDATION_PACK_AUTO] warning reason=dispatch_failed status=${dispatch.status} body=${String(dispatch.body || "").slice(0, 180)}`
    );
    return;
  }

  state.triggered[batchKey] = {
    triggeredAt: new Date().toISOString(),
    batchId,
    gateStatus,
    gateProgress,
    stage6Hash: String(preview.stage6Hash || "").slice(0, 64),
    sourceRunId: String(process.env.GITHUB_RUN_ID || "").trim(),
    ref
  };
  saveTriggerState(state);
  console.log(
    `[VALIDATION_PACK_AUTO] triggered batch=${batchId} status=${gateStatus} progress=${gateProgress} repo=${repo} ref=${ref}`
  );
};

main().catch((error) => {
  console.log(`[VALIDATION_PACK_AUTO] warning reason=exception detail=${String(error?.message || error)}`);
});
