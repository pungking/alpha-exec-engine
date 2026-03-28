import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseJsonText } from "./json-utils.js";

type CliArgs = {
  previewPath: string;
  outPath: string;
  baselinePath: string | null;
  stage6Path: string | null;
  strict: boolean;
  expectNoDiff: boolean;
};

type ReplaySnapshot = {
  stage6Hash: string;
  stage6File: string;
  payloadCount: number;
  skippedCount: number;
  tuningPhase: {
    phase: string;
    gateStatus: string;
    gateProgress: string;
    gateRemainingTrades: number | null;
  };
  livePromotion: {
    status: string;
    reason: string;
    requiredMissing: string[];
  };
  nextAction: {
    status: string;
    action: string;
    reason: string;
    gateStatus: string;
    gateProgress: string;
    gateRemainingTrades: number | null;
    requiredMissing: string[];
  };
  payloadProbe: {
    status: string;
    reason: string;
  };
  alert: {
    triggered: boolean;
    reason: string;
  };
  markerAudit: {
    ok: boolean | null;
  };
  optionalStage6: {
    path: string;
    sha256: string;
    sizeBytes: number;
    candidateCount: number | null;
  } | null;
};

type ReplayResult = {
  generatedAt: string;
  inputs: {
    previewPath: string;
    outPath: string;
    baselinePath: string | null;
    stage6Path: string | null;
    strict: boolean;
    expectNoDiff: boolean;
  };
  replaySnapshot: ReplaySnapshot;
  invariants: {
    passed: boolean;
    failures: string[];
  };
  diffFromBaseline: {
    compared: boolean;
    baselinePath: string | null;
    changedFields: Array<{
      key: string;
      before: string;
      after: string;
    }>;
  };
};

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    previewPath: "state/last-dry-exec-preview.json",
    outPath: "state/replay_summary.json",
    baselinePath: null,
    stage6Path: null,
    strict: false,
    expectNoDiff: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = i + 1 < argv.length ? argv[i + 1] : null;
    if (token === "--preview" && next) {
      args.previewPath = next;
      i += 1;
      continue;
    }
    if (token === "--out" && next) {
      args.outPath = next;
      i += 1;
      continue;
    }
    if (token === "--baseline" && next) {
      args.baselinePath = next;
      i += 1;
      continue;
    }
    if (token === "--stage6" && next) {
      args.stage6Path = next;
      i += 1;
      continue;
    }
    if (token === "--strict") {
      args.strict = true;
      continue;
    }
    if (token === "--expect-no-diff") {
      args.expectNoDiff = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      console.log(
        [
          "Usage: node dist/src/replay-hf-judgement.js [options]",
          "",
          "Options:",
          "  --preview <path>   Preview JSON path (default: state/last-dry-exec-preview.json)",
          "  --out <path>       Output summary path (default: state/replay_summary.json)",
          "  --baseline <path>  Optional baseline replay summary to diff",
          "  --stage6 <path>    Optional stage6 json file for hash/size evidence",
          "  --strict           Exit non-zero when invariants fail",
          "  --expect-no-diff   Exit non-zero when baseline diff is non-empty"
        ].join("\n")
      );
      process.exit(0);
    }
  }
  return args;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = "N/A"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
}

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  return parseJsonText<unknown>(raw, `replay_json(${path})`);
}

async function describeStage6(path: string): Promise<ReplaySnapshot["optionalStage6"]> {
  const raw = await readFile(path);
  const json = parseJsonText<Record<string, unknown>>(raw.toString("utf8"), `stage6_replay(${path})`);
  const hash = createHash("sha256").update(raw).digest("hex");
  const candidateCount =
    Array.isArray(json.executablePicks) ? json.executablePicks.length :
    Array.isArray(json.candidates) ? json.candidates.length :
    Array.isArray(json.topCandidates) ? json.topCandidates.length :
    null;
  return {
    path,
    sha256: hash,
    sizeBytes: raw.byteLength,
    candidateCount
  };
}

function buildReplaySnapshot(previewRaw: unknown, stage6Info: ReplaySnapshot["optionalStage6"]): ReplaySnapshot {
  const preview = asObject(previewRaw);
  const tuning = asObject(preview.hfTuningPhase);
  const live = asObject(preview.hfLivePromotion);
  const next = asObject(preview.hfNextAction);
  const probe = asObject(preview.hfPayloadProbeStatus);
  const alert = asObject(preview.hfAlert);
  const tuningComment = asObject(preview.hfTuningComment);
  const markerAuditFromComment =
    typeof tuningComment.markerAuditOk === "boolean" ? tuningComment.markerAuditOk : null;
  const markerAuditSummary = asObject(preview.hfMarkerAudit);
  const markerAuditFromSummary =
    typeof markerAuditSummary.ok === "boolean" ? markerAuditSummary.ok : null;
  return {
    stage6Hash: asString(preview.stage6Hash, "N/A"),
    stage6File: asString(preview.stage6File, "N/A"),
    payloadCount: asNumberOrNull(preview.payloadCount) ?? 0,
    skippedCount: asNumberOrNull(preview.skippedCount) ?? 0,
    tuningPhase: {
      phase: asString(tuning.phase, "N/A"),
      gateStatus: asString(tuning.gateStatus, "N/A"),
      gateProgress: asString(tuning.gateProgress, "N/A"),
      gateRemainingTrades: asNumberOrNull(tuning.gateRemainingTrades)
    },
    livePromotion: {
      status: asString(live.status, "N/A"),
      reason: asString(live.reason, "N/A"),
      requiredMissing: asStringArray(live.requiredMissing)
    },
    nextAction: {
      status: asString(next.status, "N/A"),
      action: asString(next.action, "N/A"),
      reason: asString(next.reason, "N/A"),
      gateStatus: asString(next.gateStatus, "N/A"),
      gateProgress: asString(next.gateProgress, "N/A"),
      gateRemainingTrades: asNumberOrNull(next.gateRemainingTrades),
      requiredMissing: asStringArray(next.requiredMissing)
    },
    payloadProbe: {
      status: asString(probe.status, "N/A"),
      reason: asString(probe.reason, "N/A")
    },
    alert: {
      triggered: asBoolean(alert.triggered, false),
      reason: asString(alert.reason, "N/A")
    },
    markerAudit: {
      ok: markerAuditFromComment ?? markerAuditFromSummary
    },
    optionalStage6: stage6Info
  };
}

function evaluateInvariants(snapshot: ReplaySnapshot): string[] {
  const failures: string[] = [];
  if (snapshot.tuningPhase.gateStatus !== snapshot.nextAction.gateStatus) {
    failures.push("nextAction.gateStatus_mismatch");
  }
  if (snapshot.tuningPhase.gateProgress !== snapshot.nextAction.gateProgress) {
    failures.push("nextAction.gateProgress_mismatch");
  }
  if (
    snapshot.tuningPhase.gateRemainingTrades != null &&
    snapshot.nextAction.gateRemainingTrades != null &&
    snapshot.tuningPhase.gateRemainingTrades !== snapshot.nextAction.gateRemainingTrades
  ) {
    failures.push("nextAction.remainingTrades_mismatch");
  }
  if (snapshot.livePromotion.status === "PASS" && snapshot.livePromotion.requiredMissing.length > 0) {
    failures.push("livePromotion.pass_with_requiredMissing");
  }
  if (snapshot.nextAction.status === "LIVE_READY" && snapshot.livePromotion.status !== "PASS") {
    failures.push("nextAction.live_ready_without_live_pass");
  }
  if (snapshot.markerAudit.ok === false) {
    failures.push("markerAudit.not_ok");
  }
  return failures;
}

function flattenSnapshot(snapshot: ReplaySnapshot): Record<string, string> {
  const rows: Record<string, string> = {
    "stage6.hash": snapshot.stage6Hash,
    "stage6.file": snapshot.stage6File,
    "tuning.phase": snapshot.tuningPhase.phase,
    "tuning.gateStatus": snapshot.tuningPhase.gateStatus,
    "tuning.gateProgress": snapshot.tuningPhase.gateProgress,
    "tuning.gateRemainingTrades": String(snapshot.tuningPhase.gateRemainingTrades ?? "N/A"),
    "live.status": snapshot.livePromotion.status,
    "live.reason": snapshot.livePromotion.reason,
    "live.requiredMissing": snapshot.livePromotion.requiredMissing.join(",") || "none",
    "next.status": snapshot.nextAction.status,
    "next.action": snapshot.nextAction.action,
    "next.reason": snapshot.nextAction.reason,
    "next.gateStatus": snapshot.nextAction.gateStatus,
    "next.gateProgress": snapshot.nextAction.gateProgress,
    "next.gateRemainingTrades": String(snapshot.nextAction.gateRemainingTrades ?? "N/A"),
    "next.requiredMissing": snapshot.nextAction.requiredMissing.join(",") || "none",
    "probe.status": snapshot.payloadProbe.status,
    "probe.reason": snapshot.payloadProbe.reason,
    "markerAudit.ok": String(snapshot.markerAudit.ok),
    "alert.triggered": String(snapshot.alert.triggered),
    "alert.reason": snapshot.alert.reason
  };
  if (snapshot.optionalStage6) {
    rows["stage6.optional.sha256"] = snapshot.optionalStage6.sha256;
    rows["stage6.optional.candidateCount"] = String(snapshot.optionalStage6.candidateCount ?? "N/A");
  }
  return rows;
}

function extractBaselineSnapshot(raw: unknown): ReplaySnapshot | null {
  const obj = asObject(raw);
  if (obj.replaySnapshot && typeof obj.replaySnapshot === "object") {
    return obj.replaySnapshot as ReplaySnapshot;
  }
  if (obj.stage6Hash && obj.tuningPhase && obj.livePromotion && obj.nextAction) {
    return obj as ReplaySnapshot;
  }
  return null;
}

function diffSnapshots(current: ReplaySnapshot, baseline: ReplaySnapshot): ReplayResult["diffFromBaseline"]["changedFields"] {
  const currentFlat = flattenSnapshot(current);
  const baselineFlat = flattenSnapshot(baseline);
  const keys = new Set([...Object.keys(currentFlat), ...Object.keys(baselineFlat)]);
  const changed: ReplayResult["diffFromBaseline"]["changedFields"] = [];
  for (const key of keys) {
    const before = baselineFlat[key] ?? "N/A";
    const after = currentFlat[key] ?? "N/A";
    if (before !== after) changed.push({ key, before, after });
  }
  return changed.sort((a, b) => a.key.localeCompare(b.key));
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const previewPath = resolve(process.cwd(), args.previewPath);
  const outPath = resolve(process.cwd(), args.outPath);
  const baselinePath = args.baselinePath ? resolve(process.cwd(), args.baselinePath) : null;
  const stage6Path = args.stage6Path ? resolve(process.cwd(), args.stage6Path) : null;

  const preview = await readJson(previewPath);
  const stage6Info = stage6Path ? await describeStage6(stage6Path) : null;
  const replaySnapshot = buildReplaySnapshot(preview, stage6Info);
  const failures = evaluateInvariants(replaySnapshot);

  let changedFields: ReplayResult["diffFromBaseline"]["changedFields"] = [];
  if (baselinePath) {
    const baselineRaw = await readJson(baselinePath);
    const baselineSnapshot = extractBaselineSnapshot(baselineRaw);
    if (baselineSnapshot) {
      changedFields = diffSnapshots(replaySnapshot, baselineSnapshot);
    } else {
      changedFields = [{ key: "baseline", before: "unreadable", after: "unreadable" }];
    }
  }

  const result: ReplayResult = {
    generatedAt: new Date().toISOString(),
    inputs: {
      previewPath,
      outPath,
      baselinePath,
      stage6Path,
      strict: args.strict,
      expectNoDiff: args.expectNoDiff
    },
    replaySnapshot,
    invariants: {
      passed: failures.length === 0,
      failures
    },
    diffFromBaseline: {
      compared: baselinePath != null,
      baselinePath,
      changedFields
    }
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(result, null, 2), "utf8");

  console.log(
    `[REPLAY_HF] preview=${previewPath} out=${outPath} stage6Hash=${replaySnapshot.stage6Hash} gate=${replaySnapshot.tuningPhase.gateStatus}/${replaySnapshot.tuningPhase.gateProgress}`
  );
  console.log(
    `[REPLAY_HF] invariants=${result.invariants.passed ? "PASS" : "FAIL"} failures=${result.invariants.failures.length}`
  );
  if (result.diffFromBaseline.compared) {
    console.log(
      `[REPLAY_HF] baseline=${baselinePath} changed=${result.diffFromBaseline.changedFields.length}`
    );
  }
  console.log(`[REPLAY_HF] summary_saved=${outPath}`);

  if (args.expectNoDiff && !baselinePath) {
    console.error("[REPLAY_HF_ERR] --expect-no-diff requires --baseline");
    process.exitCode = 3;
    return;
  }
  if (args.expectNoDiff && result.diffFromBaseline.changedFields.length > 0) {
    console.error(
      `[REPLAY_HF_ERR] baseline_diff_detected changed=${result.diffFromBaseline.changedFields.length}`
    );
    process.exitCode = 3;
    return;
  }

  if (!result.invariants.passed) {
    console.warn(`[REPLAY_HF_WARN] ${result.invariants.failures.join(",")}`);
    if (args.strict) process.exitCode = 2;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[REPLAY_HF_ERR] ${message}`);
  process.exitCode = 1;
});
