import { loadRuntimeConfig } from "../config/policy.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

type EnvCheckResult = {
  missing: string[];
  warnings: string[];
};

type DriveListResponse = {
  files?: Array<{
    id: string;
    name: string;
    modifiedTime?: string;
    size?: string;
    md5Checksum?: string;
  }>;
};

type Stage6LoadResult = {
  fileId: string;
  fileName: string;
  modifiedTime: string;
  md5Checksum: string;
  sha256: string;
  candidateSymbols: string[];
  candidates: Stage6CandidateSummary[];
};

type Stage6CandidateSummary = {
  symbol: string;
  verdict: string;
  expectedReturn: string;
  entry: string;
  target: string;
  stop: string;
  conviction: string;
};

type DryExecOrderPayload = {
  symbol: string;
  side: "buy";
  type: "limit";
  time_in_force: "day";
  order_class: "bracket";
  limit_price: number;
  notional: number;
  take_profit: { limit_price: number };
  stop_loss: { stop_price: number };
  client_order_id: string;
};

type DryExecSkipReason = {
  symbol: string;
  reason: string;
};

type DryExecBuildResult = {
  payloads: DryExecOrderPayload[];
  skipped: DryExecSkipReason[];
  notionalPerOrder: number;
  maxOrders: number;
  maxTotalNotional: number;
  minConviction: number;
  minStopDistancePct: number;
  maxStopDistancePct: number;
};

type SidecarRunState = {
  lastStage6Sha256: string;
  lastStage6FileId: string;
  lastStage6FileName: string;
  lastMode: string;
  lastSentAt: string;
};

const STATE_PATH = "state/last-run.json";
const DRY_EXEC_PREVIEW_PATH = "state/last-dry-exec-preview.json";
const ACTIONABLE_VERDICTS = new Set(["BUY", "STRONG_BUY"]);

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function runEnvGuard(): EnvCheckResult {
  const cfg = loadRuntimeConfig();
  const missing: string[] = [];
  const warnings: string[] = [];

  const requiredAlways = [
    "ALPACA_BASE_URL",
    "GDRIVE_CLIENT_ID",
    "GDRIVE_CLIENT_SECRET",
    "GDRIVE_REFRESH_TOKEN",
    "GDRIVE_ROOT_FOLDER_ID",
    "GDRIVE_STAGE6_FOLDER",
    "GDRIVE_REPORT_FOLDER",
    "TELEGRAM_TOKEN",
    "TELEGRAM_PRIMARY_CHAT_ID",
    "TELEGRAM_SIMULATION_CHAT_ID"
  ];

  for (const key of requiredAlways) {
    if (!hasValue(process.env[key])) missing.push(key);
  }

  const needsAlpacaCreds = cfg.execEnabled || !cfg.readOnly;
  if (needsAlpacaCreds) {
    for (const key of ["ALPACA_KEY_ID", "ALPACA_SECRET_KEY"]) {
      if (!hasValue(process.env[key])) missing.push(key);
    }
  } else {
    if (!hasValue(process.env.ALPACA_KEY_ID) || !hasValue(process.env.ALPACA_SECRET_KEY)) {
      warnings.push("ALPACA_KEY_ID/ALPACA_SECRET_KEY unset (allowed in READ_ONLY dry-run)");
    }
  }

  return { missing, warnings };
}

function printStartupSummary() {
  const cfg = loadRuntimeConfig();
  const now = new Date().toISOString();
  const check = runEnvGuard();

  console.log("=== alpha-exec-engine bootstrap ===");
  console.log(`timestamp        : ${now}`);
  console.log(`policyVersion    : ${cfg.policyVersion}`);
  console.log(`timezone         : ${cfg.timezone}`);
  console.log(`EXEC_ENABLED     : ${cfg.execEnabled}`);
  console.log(`READ_ONLY        : ${cfg.readOnly}`);
  console.log(`ALPACA_BASE_URL  : ${process.env.ALPACA_BASE_URL || "(unset)"}`);
  console.log(`TELEGRAM_PRIMARY : ${mask(process.env.TELEGRAM_PRIMARY_CHAT_ID || "")}`);
  console.log(`TELEGRAM_SIM     : ${mask(process.env.TELEGRAM_SIMULATION_CHAT_ID || "")}`);
  console.log(`GDRIVE_ROOT      : ${mask(process.env.GDRIVE_ROOT_FOLDER_ID || "")}`);
  console.log(`GDRIVE_STAGE6    : ${mask(process.env.GDRIVE_STAGE6_FOLDER || "")}`);
  console.log(`GDRIVE_REPORT    : ${mask(process.env.GDRIVE_REPORT_FOLDER || "")}`);

  if (!cfg.readOnly && !cfg.execEnabled) {
    console.warn("[WARN] READ_ONLY is false but EXEC_ENABLED is false. No orders will run.");
  }

  if (!cfg.readOnly && cfg.execEnabled) {
    console.warn("[WARN] Execution mode enabled. Ensure this is intended.");
  }

  if (check.warnings.length > 0) {
    for (const warning of check.warnings) {
      console.warn(`[WARN] ${warning}`);
    }
  }

  if (check.missing.length > 0) {
    console.error(`[ENV_GUARD] FAIL missing=${check.missing.join(", ")}`);
    process.exit(1);
  }

  console.log("[ENV_GUARD] OK");
  console.log("bootstrap status : OK");
}

async function getGoogleAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: process.env.GDRIVE_CLIENT_ID || "",
    client_secret: process.env.GDRIVE_CLIENT_SECRET || "",
    refresh_token: process.env.GDRIVE_REFRESH_TOKEN || "",
    grant_type: "refresh_token"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token refresh failed (${response.status}): ${text.slice(0, 240)}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Google token refresh response missing access_token");
  }
  return data.access_token;
}

async function fetchLatestStage6Metadata(accessToken: string) {
  const folderId = process.env.GDRIVE_STAGE6_FOLDER || "";
  const query = [
    `'${folderId}' in parents`,
    "trashed=false",
    "name contains 'STAGE6_ALPHA_FINAL_'"
  ].join(" and ");

  const params = new URLSearchParams({
    q: query,
    orderBy: "modifiedTime desc",
    pageSize: "1",
    fields: "files(id,name,modifiedTime,size,md5Checksum)"
  });

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Drive list failed (${response.status}): ${text.slice(0, 240)}`);
  }

  const data = (await response.json()) as DriveListResponse;
  const file = data.files?.[0];
  if (!file?.id || !file.name) {
    throw new Error("No STAGE6_ALPHA_FINAL_* file found in GDRIVE_STAGE6_FOLDER");
  }
  return {
    id: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime || "unknown",
    md5Checksum: file.md5Checksum || "n/a"
  };
}

async function downloadStage6Json(accessToken: string, fileId: string): Promise<string> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Drive download failed (${response.status}): ${text.slice(0, 240)}`);
  }
  return response.text();
}

function extractCandidateSymbols(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const raw = root.alpha_candidates;
  if (!Array.isArray(raw)) return [];

  const symbols = raw
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const node = item as Record<string, unknown>;
      const symbol = node.symbol ?? node.ticker;
      return typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
    })
    .filter((s) => s.length > 0);

  return Array.from(new Set(symbols));
}

function parsePrice(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return `$${value.toFixed(2)}`;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return "N/A";
}

function parseNumericPrice(label: string): number | null {
  if (!label || label === "N/A") return null;
  const normalized = label.replace(/[^0-9.-]/g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function readPositiveNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const n = Math.floor(readPositiveNumberEnv(key, fallback));
  if (n <= 0) return fallback;
  return n;
}

function readBoolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function parseConviction(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseCandidateSummaries(payload: unknown): Stage6CandidateSummary[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const raw = root.alpha_candidates;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const node = item as Record<string, unknown>;
      const symbol = typeof node.symbol === "string" ? node.symbol.trim().toUpperCase() : "";
      if (!symbol) return null;
      const verdictRaw = node.finalVerdict ?? node.aiVerdict ?? node.verdict;
      const convictionRaw = node.convictionScore ?? node.rawConvictionScore;
      const expectedReturnRaw = node.expectedReturn ?? node.gatedExpectedReturn ?? node.rawExpectedReturn;
      const entryRaw = node.entryPrice ?? node.otePrice ?? node.supportLevel;
      const targetRaw = node.targetPrice ?? node.targetMeanPrice ?? node.resistanceLevel;
      const stopRaw = node.stopLoss ?? node.ictStopLoss;

      return {
        symbol,
        verdict: typeof verdictRaw === "string" && verdictRaw.trim() ? verdictRaw.trim().toUpperCase() : "N/A",
        expectedReturn:
          typeof expectedReturnRaw === "string" && expectedReturnRaw.trim() ? expectedReturnRaw.trim() : "N/A",
        entry: parsePrice(entryRaw),
        target: parsePrice(targetRaw),
        stop: parsePrice(stopRaw),
        conviction:
          typeof convictionRaw === "number" && Number.isFinite(convictionRaw)
            ? convictionRaw.toFixed(0)
            : typeof convictionRaw === "string" && convictionRaw.trim()
              ? convictionRaw.trim()
              : "N/A"
      };
    })
    .filter((row): row is Stage6CandidateSummary => row !== null)
    .slice(0, 6);
}

async function loadLatestStage6FromDrive(): Promise<Stage6LoadResult> {
  const accessToken = await getGoogleAccessToken();
  const meta = await fetchLatestStage6Metadata(accessToken);
  const jsonText = await downloadStage6Json(accessToken, meta.id);
  const parsed = JSON.parse(jsonText) as unknown;
  const symbols = extractCandidateSymbols(parsed);
  const candidates = parseCandidateSummaries(parsed);
  const sha256 = createHash("sha256").update(jsonText).digest("hex");

  return {
    fileId: meta.id,
    fileName: meta.name,
    modifiedTime: meta.modifiedTime,
    md5Checksum: meta.md5Checksum,
    sha256,
    candidateSymbols: symbols,
    candidates
  };
}

function printStage6Lock(result: Stage6LoadResult) {
  const symbolLog = result.candidateSymbols.length > 0 ? result.candidateSymbols.join(",") : "(none)";
  console.log(
    `[STAGE6_LOCK] ${result.fileName} | fileId=${result.fileId} | modified=${result.modifiedTime} | md5=${result.md5Checksum} | sha256=${result.sha256.slice(0, 12)}`
  );
  console.log(`[STAGE6_CANDIDATES] count=${result.candidateSymbols.length} | symbols=${symbolLog}`);
}

function getActionableCandidates(candidates: Stage6CandidateSummary[]): Stage6CandidateSummary[] {
  return candidates.filter((row) => ACTIONABLE_VERDICTS.has(row.verdict));
}

function buildDryExecPayloads(actionable: Stage6CandidateSummary[], stage6Hash: string): DryExecBuildResult {
  const notionalPerOrder = readPositiveNumberEnv("DRY_NOTIONAL_PER_TRADE", 1000);
  const maxOrders = readPositiveIntEnv("DRY_MAX_ORDERS", 3);
  const maxTotalNotional = readPositiveNumberEnv("DRY_MAX_TOTAL_NOTIONAL", notionalPerOrder * maxOrders);
  const minConviction = readPositiveNumberEnv("DRY_MIN_CONVICTION", 70);
  const minStopDistancePct = readPositiveNumberEnv("DRY_MIN_STOP_DISTANCE_PCT", 2);
  const maxStopDistancePct = readPositiveNumberEnv("DRY_MAX_STOP_DISTANCE_PCT", 25);
  const payloads: DryExecOrderPayload[] = [];
  const skipped: DryExecSkipReason[] = [];
  let allocatedNotional = 0;

  actionable.forEach((row) => {
    if (payloads.length >= maxOrders) {
      skipped.push({ symbol: row.symbol, reason: "max_orders_reached" });
      return;
    }

    const conviction = parseConviction(row.conviction);
    if (conviction == null || conviction < minConviction) {
      skipped.push({ symbol: row.symbol, reason: "conviction_below_floor" });
      return;
    }

    const entry = parseNumericPrice(row.entry);
    const target = parseNumericPrice(row.target);
    const stop = parseNumericPrice(row.stop);

    if (!entry || !target || !stop) {
      skipped.push({ symbol: row.symbol, reason: "missing_or_invalid_price" });
      return;
    }
    if (!(target > entry && stop < entry)) {
      skipped.push({ symbol: row.symbol, reason: "invalid_price_geometry" });
      return;
    }
    const stopDistancePct = ((entry - stop) / entry) * 100;
    if (stopDistancePct < minStopDistancePct || stopDistancePct > maxStopDistancePct) {
      skipped.push({ symbol: row.symbol, reason: "stop_distance_out_of_range" });
      return;
    }
    if (allocatedNotional + notionalPerOrder > maxTotalNotional) {
      skipped.push({ symbol: row.symbol, reason: "max_total_notional_reached" });
      return;
    }

    payloads.push({
      symbol: row.symbol,
      side: "buy",
      type: "limit",
      time_in_force: "day",
      order_class: "bracket",
      limit_price: Number(entry.toFixed(2)),
      notional: Number(notionalPerOrder.toFixed(2)),
      take_profit: { limit_price: Number(target.toFixed(2)) },
      stop_loss: { stop_price: Number(stop.toFixed(2)) },
      client_order_id: `dry_${stage6Hash.slice(0, 8)}_${row.symbol.toLowerCase()}`
    });
    allocatedNotional += notionalPerOrder;
  });

  return {
    payloads,
    skipped,
    notionalPerOrder,
    maxOrders,
    maxTotalNotional,
    minConviction,
    minStopDistancePct,
    maxStopDistancePct
  };
}

function buildSimulationMessage(
  result: Stage6LoadResult,
  actionable: Stage6CandidateSummary[],
  dryExec: DryExecBuildResult
): string {
  const lines: string[] = [];
  lines.push("🧪 Sidecar Dry-Run Report");
  lines.push(`Stage6: ${result.fileName}`);
  lines.push(`Hash: ${result.sha256.slice(0, 12)} | MD5: ${result.md5Checksum}`);
  lines.push(`Candidates: ${result.candidateSymbols.length}`);
  lines.push(
    `Policy Gate: raw ${result.candidates.length} -> actionable ${actionable.length} (BUY/STRONG_BUY only)`
  );
  lines.push("");

  if (result.candidates.length === 0) {
    lines.push("Top6 summary: N/A");
  } else {
    lines.push("Top6 Summary");
    result.candidates.forEach((row, index) => {
      lines.push(
        `${index + 1}) ${row.symbol} | ${row.verdict} | ER ${row.expectedReturn} | Conv ${row.conviction} | ${row.entry}→${row.target} / ${row.stop}`
      );
    });
  }

  lines.push("");
  lines.push("Actionable Candidates");
  if (actionable.length === 0) {
    lines.push("N/A (all filtered by policy gate)");
  } else {
    actionable.forEach((row, index) => {
      lines.push(`${index + 1}) ${row.symbol} | ${row.verdict} | ${row.entry}→${row.target} / ${row.stop}`);
    });
  }

  lines.push("");
  lines.push("Dry-Exec Payload Preview");
  lines.push(
    `Gate: Conv>=${dryExec.minConviction} | StopDist ${dryExec.minStopDistancePct}%~${dryExec.maxStopDistancePct}%`
  );
  lines.push(
    `Orders: ${dryExec.payloads.length} | Notional/Order: $${dryExec.notionalPerOrder.toFixed(2)} | MaxOrders: ${dryExec.maxOrders} | MaxTotalNotional: $${dryExec.maxTotalNotional.toFixed(2)}`
  );
  if (dryExec.payloads.length === 0) {
    lines.push("N/A (no payload generated)");
  } else {
    dryExec.payloads.forEach((order, index) => {
      lines.push(
        `${index + 1}) ${order.symbol} | LIMIT ${order.limit_price} | TP ${order.take_profit.limit_price} | SL ${order.stop_loss.stop_price} | Notional $${order.notional.toFixed(2)}`
      );
    });
  }
  if (dryExec.skipped.length > 0) {
    const skippedLog = dryExec.skipped.map((s) => `${s.symbol}:${s.reason}`).join(", ");
    lines.push(`Skipped: ${skippedLog}`);
  }

  lines.push("");
  lines.push("Mode: READ_ONLY=true, EXEC_ENABLED=false");
  return lines.join("\n");
}

async function sendSimulationTelegram(
  result: Stage6LoadResult,
  actionable: Stage6CandidateSummary[],
  dryExec: DryExecBuildResult
): Promise<void> {
  const token = process.env.TELEGRAM_TOKEN || "";
  const chatId = process.env.TELEGRAM_SIMULATION_CHAT_ID || "";
  const text = buildSimulationMessage(result, actionable, dryExec);

  await sendTelegramMessage(token, chatId, text, "TELEGRAM_SIM");
}

async function sendHeartbeatOnDedupe(stage6: Stage6LoadResult, mode: string): Promise<void> {
  const enabled = readBoolEnv("TELEGRAM_HEARTBEAT_ON_DEDUPE", false);
  if (!enabled) return;
  const token = process.env.TELEGRAM_TOKEN || "";
  const chatId = process.env.TELEGRAM_SIMULATION_CHAT_ID || "";
  const text = [
    "💓 Sidecar Heartbeat",
    `Dedupe skip: same hash/mode`,
    `Stage6: ${stage6.fileName}`,
    `Hash: ${stage6.sha256.slice(0, 12)}`,
    `Mode: ${mode}`
  ].join("\n");

  await sendTelegramMessage(token, chatId, text, "TELEGRAM_HEARTBEAT");
}

async function sendTelegramMessage(token: string, chatId: string, text: string, tag: string): Promise<void> {
  const body = new URLSearchParams({
    chat_id: chatId,
    text,
    disable_web_page_preview: "true"
  });

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Telegram send failed (${response.status}): ${raw.slice(0, 240)}`);
  }
  console.log(`[${tag}] sent to ${mask(chatId)}`);
}

async function loadRunState(): Promise<SidecarRunState | null> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as SidecarRunState;
    if (!parsed?.lastStage6Sha256) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveRunState(result: Stage6LoadResult, mode: string): Promise<void> {
  await mkdir("state", { recursive: true });
  const nextState: SidecarRunState = {
    lastStage6Sha256: result.sha256,
    lastStage6FileId: result.fileId,
    lastStage6FileName: result.fileName,
    lastMode: mode,
    lastSentAt: new Date().toISOString()
  };
  await writeFile(STATE_PATH, JSON.stringify(nextState, null, 2), "utf8");
  console.log(`[STATE] saved ${STATE_PATH}`);
}

async function saveDryExecPreview(result: Stage6LoadResult, dryExec: DryExecBuildResult): Promise<void> {
  await mkdir("state", { recursive: true });
  const preview = {
    stage6File: result.fileName,
    stage6FileId: result.fileId,
    stage6Hash: result.sha256,
    generatedAt: new Date().toISOString(),
    notionalPerOrder: dryExec.notionalPerOrder,
    maxOrders: dryExec.maxOrders,
    payloadCount: dryExec.payloads.length,
    skippedCount: dryExec.skipped.length,
    payloads: dryExec.payloads,
    skipped: dryExec.skipped
  };
  await writeFile(DRY_EXEC_PREVIEW_PATH, JSON.stringify(preview, null, 2), "utf8");
  console.log(`[DRY_EXEC] payloads=${dryExec.payloads.length} skipped=${dryExec.skipped.length}`);
  console.log(`[STATE] saved ${DRY_EXEC_PREVIEW_PATH}`);
}

function buildRunModeLabel(): string {
  const cfg = loadRuntimeConfig();
  const notional = readPositiveNumberEnv("DRY_NOTIONAL_PER_TRADE", 1000);
  const maxOrders = readPositiveIntEnv("DRY_MAX_ORDERS", 3);
  const maxTotalNotional = readPositiveNumberEnv("DRY_MAX_TOTAL_NOTIONAL", notional * maxOrders);
  const minConviction = readPositiveNumberEnv("DRY_MIN_CONVICTION", 70);
  const minStopDistancePct = readPositiveNumberEnv("DRY_MIN_STOP_DISTANCE_PCT", 2);
  const maxStopDistancePct = readPositiveNumberEnv("DRY_MAX_STOP_DISTANCE_PCT", 25);
  const heartbeatOnDedupe = readBoolEnv("TELEGRAM_HEARTBEAT_ON_DEDUPE", false);
  return [
    `READ_ONLY=${cfg.readOnly}`,
    `EXEC_ENABLED=${cfg.execEnabled}`,
    `NOTIONAL=${notional}`,
    `MAX_ORDERS=${maxOrders}`,
    `MAX_TOTAL_NOTIONAL=${maxTotalNotional}`,
    `MIN_CONV=${minConviction}`,
    `STOP_MIN=${minStopDistancePct}`,
    `STOP_MAX=${maxStopDistancePct}`,
    `HEARTBEAT=${heartbeatOnDedupe}`
  ].join(";");
}

function shouldSend(state: SidecarRunState | null, result: Stage6LoadResult, mode: string): boolean {
  if (!state) return true;
  return !(state.lastStage6Sha256 === result.sha256 && state.lastMode === mode);
}

async function main() {
  printStartupSummary();
  const stage6 = await loadLatestStage6FromDrive();
  printStage6Lock(stage6);
  const actionable = getActionableCandidates(stage6.candidates);
  const dryExec = buildDryExecPayloads(actionable, stage6.sha256);
  const mode = buildRunModeLabel();
  const priorState = await loadRunState();
  if (!shouldSend(priorState, stage6, mode)) {
    console.log(`[DEDUPE] SKIP send (same hash/mode) sha256=${stage6.sha256.slice(0, 12)} mode=${mode}`);
    await sendHeartbeatOnDedupe(stage6, mode);
    return;
  }
  await sendSimulationTelegram(stage6, actionable, dryExec);
  await saveDryExecPreview(stage6, dryExec);
  await saveRunState(stage6, mode);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[DRY_RUN] FAIL ${message}`);
  process.exit(1);
});
