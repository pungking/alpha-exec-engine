import { loadRuntimeConfig } from "../config/policy.js";
import type { LifecycleActionType, PositionLifecycleConfig } from "../config/policy.js";
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
  modelTopCandidates: Stage6CandidateSummary[];
  contractContext: Stage6ContractContext | null;
};

type Stage6ContractContext = {
  modelTop6: Stage6CandidateSummary[];
  executablePicks: Stage6CandidateSummary[];
  watchlistTop: Stage6CandidateSummary[];
  decisionCountsPrimary: Record<string, number>;
  decisionCountsTop6: Record<string, number>;
};

type Stage6CandidateSummary = {
  symbol: string;
  instrumentType: "common" | "warrant" | "unit" | "right" | "hybrid" | "unknown";
  analysisEligible: boolean | null;
  historyTier: "FULL" | "PROVISIONAL" | "ONBOARDING" | "UNKNOWN";
  symbolLifecycleState:
    | "ACTIVE"
    | "PROVISIONAL"
    | "ONBOARDING"
    | "RECOVERED"
    | "STALE"
    | "RETIRED"
    | "EXCLUDED"
    | "UNKNOWN";
  verdict: string;
  expectedReturn: string;
  expectedReturnPct: number | null;
  entry: string;
  entryValue: number | null;
  target: string;
  targetValue: number | null;
  stop: string;
  stopValue: number | null;
  conviction: string;
  qualityScore: number | null;
  modelRank: number | null;
  executionRank: number | null;
  executionScore: number | null;
  executionBucket: "EXECUTABLE" | "WATCHLIST" | "N/A";
  executionReason:
    | "VALID_EXEC"
    | "WAIT_PULLBACK_TOO_DEEP"
    | "INVALID_GEOMETRY"
    | "INVALID_DATA"
    | "N/A";
  finalDecision:
    | "EXECUTABLE_NOW"
    | "WAIT_PRICE"
    | "BLOCKED_RISK"
    | "BLOCKED_EVENT"
    | "N/A";
  decisionReason: string;
  stage6Tier: "TIER1" | "TIER2" | "NONE" | "N/A";
  stage6TierReason: string;
  stage6TierMultiplier: number | null;
  displacement: number | null;
  ictPos: number | null;
  trendAlignment: string | null;
  entryDistancePct: number | null;
  entryFeasible: boolean | null;
  tradePlanStatus: string;
  hfSentimentLabel: "positive" | "neutral" | "negative" | null;
  hfSentimentScore: number | null;
  hfSentimentStatus: "OK" | "SKIPPED" | "FAILED" | "DISABLED" | "N/A";
  hfSentimentReason: string | null;
  hfSentimentArticleCount: number | null;
  hfSentimentNewestAgeHours: number | null;
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
  idempotencyKey: string;
  actionType?: LifecycleActionType;
  actionReason?: string;
};

type DryExecSkipReason = {
  symbol: string;
  reason: string;
  actionType?: LifecycleActionType;
  actionReason?: string;
};

type RegimeProfile = "default" | "risk_off";

type RegimeQualityStatus = "high" | "medium" | "low";

type RegimeQualityGuard = {
  enabled: boolean;
  score: number;
  minScore: number;
  status: RegimeQualityStatus;
  forceRiskOff: boolean;
  reasons: string[];
};

type RegimeHysteresisMeta = {
  enabled: boolean;
  minHoldMin: number;
  previousProfile: RegimeProfile | null;
  desiredProfile: RegimeProfile;
  appliedProfile: RegimeProfile;
  holdRemainingMin: number;
  reason: string;
};

type RegimeEntryGuard = {
  blocked: boolean;
  reason: string;
};

type GuardControlState = {
  haltNewEntries?: boolean;
  source?: string;
  level?: number;
  profile?: string;
  reason?: string;
  updatedAt?: string;
};

type GuardControlGate = {
  enforce: boolean;
  maxAgeMin: number;
  ageMin: number | null;
  blocked: boolean;
  wouldBlockLive: boolean;
  reason: string;
  updatedAt: string | null;
  level: number | null;
  stale: boolean;
};

type RegimeSelection = {
  profile: RegimeProfile;
  baseProfile: RegimeProfile;
  source: "forced" | "market_snapshot" | "finnhub" | "cnbc_direct" | "cnbc_rapidapi" | "env_fallback";
  vix: number | null;
  sourcePriority: "snapshot_first" | "realtime_first";
  snapshotVix: number | null;
  snapshotAgeMin: number | null;
  riskOnThreshold: number;
  riskOffThreshold: number;
  diagnostics: string[];
  quality: RegimeQualityGuard;
  hysteresis: RegimeHysteresisMeta;
  entryGuard: RegimeEntryGuard;
};

type VixLookupResult = {
  vix: number | null;
  reason: string;
  modifiedTime?: string;
  source?: "market_snapshot" | "finnhub" | "cnbc_direct" | "cnbc_rapidapi" | "env_fallback";
};

type RegimeGuardState = {
  lastProfile: RegimeProfile;
  lastSwitchedAt: string;
  updatedAt: string;
};

type DryExecBuildResult = {
  payloads: DryExecOrderPayload[];
  skipped: DryExecSkipReason[];
  skipReasonCounts: Record<string, number>;
  actionIntent: {
    enabled: boolean;
    previewOnly: boolean;
    allowedActionTypes: LifecycleActionType[];
    counts: Record<LifecycleActionType, number>;
  };
  notionalPerOrder: number;
  maxOrders: number;
  maxTotalNotional: number;
  minConviction: number;
  minConvictionPolicy: {
    base: number;
    applied: number;
    floor: number;
    ceiling: number;
    marketTighten: number;
    qualityRelief: number;
    sampleCount: number;
    sampleQuantileQ: number;
    sampleQuantileValue: number | null;
    sampleCap: number | null;
  };
  hfSentimentGate: {
    enabled: boolean;
    scoreFloor: number;
    minArticleCount: number;
    maxNewsAgeHours: number;
    positiveReliefMax: number;
    negativeTightenMax: number;
    applied: number;
    reliefCount: number;
    tightenCount: number;
    blockedNegative: number;
    netMinConvictionDelta: number;
  };
  minStopDistancePct: number;
  maxStopDistancePct: number;
  stopDistancePolicy: {
    syncWithStage6: boolean;
    configuredMinPct: number;
    configuredMaxPct: number;
    stage6MinPct: number;
    stage6MaxPct: number;
    appliedMinPct: number;
    appliedMaxPct: number;
    strategy: "stage6_locked" | "stage6_fallback" | "configured";
  };
  entryFeasibility: {
    enforce: boolean;
    maxDistancePct: number;
    checked: number;
    blocked: number;
  };
  stage6Contract: {
    enforce: boolean;
    checked: number;
    executable: number;
    watchlist: number;
    blocked: number;
  };
  regime: RegimeSelection;
  idempotency: {
    enabled: boolean;
    enforced: boolean;
    ttlDays: number;
    newCount: number;
    duplicateCount: number;
  };
};

type PreflightStatus = "pass" | "warn" | "fail" | "skip";

type PreflightResult = {
  enabled: boolean;
  enforced: boolean;
  blocking: boolean;
  wouldBlockLive: boolean;
  simulatedLiveParity: boolean;
  status: PreflightStatus;
  code: string;
  message: string;
  requiredNotional: number;
  dailyMaxNotional: number;
  allowEntryOutsideRth: boolean;
  accountStatus: string | null;
  buyingPower: number | null;
  marketOpen: boolean | null;
  nextOpen: string | null;
};

type OrderLifecycleStatus =
  | "planned"
  | "submitted"
  | "accepted"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "expired";

type OrderLifecycleHistoryEntry = {
  at: string;
  from: OrderLifecycleStatus | null;
  to: OrderLifecycleStatus;
  reason: string;
  source: string;
};

type OrderLedgerRecord = {
  idempotencyKey: string;
  symbol: string;
  side: "buy";
  stage6Hash: string;
  stage6File: string;
  mode: string;
  clientOrderId: string;
  status: OrderLifecycleStatus;
  statusReason: string;
  preflightCode: string;
  regimeProfile: RegimeProfile;
  notional: number;
  limitPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  brokerOrderId: string | null;
  createdAt: string;
  updatedAt: string;
  history: OrderLifecycleHistoryEntry[];
};

type OrderLedgerState = {
  orders: Record<string, OrderLedgerRecord>;
  updatedAt: string;
};

type OrderLedgerUpdateResult = {
  enabled: boolean;
  targetStatus: OrderLifecycleStatus | "none";
  upserted: number;
  transitioned: number;
  unchanged: number;
  pruned: number;
};

type SidecarRunState = {
  lastStage6Sha256: string;
  lastStage6FileId: string;
  lastStage6FileName: string;
  lastMode: string;
  lastSentAt: string;
  lastForceSendKey?: string;
};

type PerformanceLoopRow = {
  rowId: string;
  runDate: string;
  stage6Hash: string;
  stage6File: string;
  symbol: string;
  modelRank: number | null;
  execRank: number | null;
  AQ: number | null;
  XS: number | null;
  decisionReason: string;
  entryPlanned: number | null;
  entryFilled: number | null;
  stopPlanned: number | null;
  targetPlanned: number | null;
  exitPrice: number | null;
  exitReason: string | null;
  holdDaysPlanned: number | null;
  holdDaysActual: number | null;
  RMultiple: number | null;
  slipPct: number | null;
  marketRegime: RegimeProfile;
  notes: string;
};

type PerformanceLoopSnapshot = {
  at: string;
  tradeCount: number;
  filledCount: number;
  closedCount: number;
  fillRatePct: number | null;
  avgR: number | null;
  medianHoldErrorDays: number | null;
  noReasonDrift: number;
};

type PerformanceLoopState = {
  batchId: string;
  createdAt: string;
  updatedAt: string;
  policyFingerprint: string;
  rows: Record<string, PerformanceLoopRow>;
  snapshots: PerformanceLoopSnapshot[];
  notifiedMilestones: number[];
};

type PerformanceLoopGateStatus = "PENDING_SAMPLE" | "GO" | "NO_GO";

type PerformanceLoopGate = {
  status: PerformanceLoopGateStatus;
  reason: string;
  progress: string;
};

type PerformanceLoopUpdateResult = {
  batchId: string;
  tradeCount: number;
  snapshotCount: number;
  gate: PerformanceLoopGate;
  latestSnapshot: PerformanceLoopSnapshot | null;
  alertMessage: string | null;
  updated: boolean;
};

type OrderIdempotencyState = {
  orders: Record<
    string,
    {
      symbol: string;
      side: "buy";
      stage6Hash: string;
      stage6File: string;
      firstSeenAt: string;
      lastSeenAt: string;
    }
  >;
  updatedAt: string;
};

const STATE_PATH = "state/last-run.json";
const DRY_EXEC_PREVIEW_PATH = "state/last-dry-exec-preview.json";
const ORDER_IDEMPOTENCY_PATH = "state/order-idempotency.json";
const ORDER_LEDGER_PATH = "state/order-ledger.json";
const REGIME_GUARD_STATE_PATH = "state/regime-guard-state.json";
const GUARD_CONTROL_STATE_PATH = "state/guard-control.json";
const PERFORMANCE_LOOP_JSON_PATH = "state/stage6-20trade-loop.json";
const PERFORMANCE_LOOP_CSV_PATH = "state/stage6-20trade-loop.csv";
const BASE_ACTIONABLE_VERDICTS = new Set(["BUY", "STRONG_BUY"]);
const NON_EXECUTABLE_DECISIONS = new Set(["WAIT_PRICE", "BLOCKED_RISK", "BLOCKED_EVENT"]);

function resolveActionableVerdicts(): Set<string> {
  const includeSpeculative = readBoolEnv("ACTIONABLE_INCLUDE_SPECULATIVE_BUY", false);
  if (!includeSpeculative) return new Set(BASE_ACTIONABLE_VERDICTS);
  return new Set([...BASE_ACTIONABLE_VERDICTS, "SPECULATIVE_BUY"]);
}

function formatActionableVerdicts(verdicts: Set<string>): string {
  return Array.from(verdicts.values()).join("/");
}

const ORDER_TRANSITIONS: Record<OrderLifecycleStatus, Set<OrderLifecycleStatus>> = {
  planned: new Set(["submitted", "accepted", "canceled", "rejected", "expired"]),
  submitted: new Set(["accepted", "partially_filled", "filled", "canceled", "rejected", "expired"]),
  accepted: new Set(["partially_filled", "filled", "canceled", "rejected", "expired"]),
  partially_filled: new Set(["partially_filled", "filled", "canceled", "rejected", "expired"]),
  filled: new Set(),
  canceled: new Set(),
  rejected: new Set(),
  expired: new Set()
};

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function normalizeStage6Verdict(raw: unknown): string {
  const key = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (!key || key === "N/A" || key === "NA" || key === "NONE" || key === "NULL" || key === "UNDEFINED" || key === "TBD") {
    return "HOLD";
  }
  if (key === "STRONGBUY") return "STRONG_BUY";
  if (key === "SPECULATIVEBUY") return "SPECULATIVE_BUY";
  if (key === "WATCH" || key === "WAIT" || key === "OBSERVE" || key === "NEUTRAL") return "HOLD";
  if (key === "SELL" || key === "EXIT" || key === "REDUCE" || key === "TRIM") return "PARTIAL_EXIT";
  if (key === "ACCUMULATE" || key === "LONG") return "BUY";
  return key;
}

function isMissingContractToken(value: unknown): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  return (
    !normalized ||
    normalized === "N/A" ||
    normalized === "NA" ||
    normalized === "NONE" ||
    normalized === "NULL" ||
    normalized === "UNDEFINED" ||
    normalized === "TBD"
  );
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

  const needsAlpacaCreds = cfg.execEnabled || !cfg.readOnly || cfg.simulationLiveParity;
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
  console.log(`LIVE_PARITY_SIM  : ${cfg.simulationLiveParity}`);
  console.log(`LIFECYCLE_ENABLE : ${cfg.positionLifecycle.enabled}`);
  console.log(`LIFECYCLE_PREVIEW: ${cfg.positionLifecycle.previewOnly}`);
  console.log(`LIFECYCLE_ACTIONS: ${cfg.positionLifecycle.allowedActionTypes.join("/")}`);
  console.log(`LIFECYCLE_SCALEUP: ${cfg.positionLifecycle.scaleUpMinConviction}`);
  console.log(`HF_SOFT_GATE_EN : ${readBoolEnv("HF_SENTIMENT_SOFT_GATE_ENABLED", false)}`);
  console.log(`HF_SOFT_SCORE_FL: ${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_SCORE_FLOOR", 0.55), 0.5, 0.95)}`);
  console.log(`HF_SOFT_MIN_ART : ${Math.max(0, Math.round(readNonNegativeNumberEnv("HF_SENTIMENT_MIN_ARTICLE_COUNT", 2)))}`);
  console.log(`HF_SOFT_MAX_AGEH: ${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_MAX_NEWS_AGE_HOURS", 24), 1, 240)}`);
  console.log(`HF_SOFT_RELIEF  : ${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_POSITIVE_RELIEF_MAX", 1.0), 0, 3)}`);
  console.log(`HF_SOFT_TIGHTEN : ${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_NEGATIVE_TIGHTEN_MAX", 2.0), 0, 4)}`);
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

function parsePriceValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    return parseNumericPrice(value.trim());
  }
  return null;
}

function normalizePercentValue(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function formatExpectedReturnLabel(raw: unknown, fallbackPct: number | null): string {
  if (typeof raw === "string" && raw.trim()) return raw.trim();

  const rawNumeric = parseFiniteNumber(raw);
  if (rawNumeric != null) {
    const pct = normalizePercentValue(rawNumeric);
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
  }

  if (fallbackPct != null) {
    const pct = normalizePercentValue(fallbackPct);
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
  }
  return "N/A";
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }
  return null;
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

function readNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function readNonNegativeNumberEnv(key: string, fallback: number): number {
  const n = readNumberEnv(key, fallback);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeAgeMinutes(isoTs: string | null | undefined): number | null {
  if (!isoTs) return null;
  const ts = Date.parse(isoTs);
  if (!Number.isFinite(ts)) return null;
  return (Date.now() - ts) / 60000;
}

function parseConviction(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q = clamp(quantile, 0, 1);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const weight = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * weight;
}

function mapStage6ExecutionReasonToSkip(
  reason: Stage6CandidateSummary["executionReason"]
): DryExecSkipReason["reason"] {
  if (reason === "WAIT_PULLBACK_TOO_DEEP") return "stage6_wait_pullback_too_deep";
  if (reason === "INVALID_GEOMETRY") return "stage6_invalid_geometry";
  if (reason === "INVALID_DATA") return "stage6_invalid_data";
  if (reason === "VALID_EXEC") return "stage6_valid_exec_but_blocked";
  return "stage6_watchlist";
}

function mapStage6DecisionReasonToSkip(
  reason: string
): DryExecSkipReason["reason"] {
  const key = String(reason || "").trim().toLowerCase();
  if (!key || key === "n/a") return "stage6_watchlist";
  if (key === "wait_pullback_not_reached") return "stage6_wait_pullback_too_deep";
  if (key === "wait_earnings_data_missing") return "stage6_wait_earnings_data_missing";
  if (key === "wait_insufficient_history") return "stage6_wait_insufficient_history";
  if (key === "wait_state_verdict_conflict") return "stage6_wait_state_verdict_conflict";
  if (key === "blocked_symbol_stale") return "stage6_symbol_stale";
  if (key === "blocked_invalid_geometry") return "stage6_invalid_geometry";
  if (key === "blocked_missing_trade_box") return "stage6_invalid_data";
  if (key === "blocked_quality_missing_expected_return") return "stage6_quality_missing_expected_return";
  if (key === "blocked_quality_conviction_floor") return "stage6_quality_conviction_floor";
  if (key === "blocked_quality_verdict_unusable") return "stage6_quality_verdict_unusable";
  if (key === "blocked_stop_too_tight") return "stage6_stop_too_tight";
  if (key === "blocked_stop_too_wide") return "stage6_stop_too_wide";
  if (key === "blocked_target_too_close") return "stage6_target_too_close";
  if (key === "blocked_anchor_exec_gap") return "stage6_anchor_exec_gap";
  if (key === "blocked_rr_below_min") return "stage6_rr_below_min";
  if (key === "blocked_ev_non_positive") return "stage6_ev_non_positive";
  if (key === "blocked_earnings_data_missing") return "stage6_earnings_missing";
  if (key === "blocked_earnings_window") return "stage6_earnings_blackout";
  if (key === "blocked_state_verdict_conflict") return "stage6_state_verdict_conflict";
  if (key === "blocked_verdict_risk_off") return "stage6_risk_off_verdict";
  return `stage6_${key}`;
}

function buildSkipReasonCounts(skipped: DryExecSkipReason[]): Record<string, number> {
  return skipped.reduce<Record<string, number>>((acc, row) => {
    const key = String(row?.reason || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function formatSkipReasonCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "none";
  return entries.map(([reason, count]) => `${reason}:${count}`).join(",");
}

function createEmptyActionIntentCounts(): Record<LifecycleActionType, number> {
  return {
    ENTRY_NEW: 0,
    HOLD_WAIT: 0,
    SCALE_UP: 0,
    SCALE_DOWN: 0,
    EXIT_PARTIAL: 0,
    EXIT_FULL: 0
  };
}

function isActionTypeAllowed(
  actionType: LifecycleActionType,
  lifecycleConfig: PositionLifecycleConfig
): boolean {
  return lifecycleConfig.allowedActionTypes.includes(actionType);
}

function rebuildActionIntentSummary(dryExec: DryExecBuildResult): DryExecBuildResult["actionIntent"] {
  if (!dryExec.actionIntent.enabled) {
    return {
      ...dryExec.actionIntent,
      counts: createEmptyActionIntentCounts()
    };
  }
  const counts = createEmptyActionIntentCounts();
  dryExec.payloads.forEach((row) => {
    if (row.actionType) counts[row.actionType] += 1;
  });
  dryExec.skipped.forEach((row) => {
    if (row.actionType) counts[row.actionType] += 1;
  });
  return {
    ...dryExec.actionIntent,
    counts
  };
}

function sumNotional(payloads: DryExecOrderPayload[]): number {
  return payloads.reduce((acc, row) => acc + row.notional, 0);
}

function isTransitionAllowed(from: OrderLifecycleStatus, to: OrderLifecycleStatus): boolean {
  if (from === to) return true;
  return ORDER_TRANSITIONS[from].has(to);
}

function buildOrderIdempotencyKey(stage6Hash: string, symbol: string, side: "buy"): string {
  return `${stage6Hash}:${symbol}:${side}`;
}

function roundToCent(value: number): number {
  return Number(value.toFixed(2));
}

function validateAndNormalizePayload(payload: DryExecOrderPayload): { ok: true; payload: DryExecOrderPayload } | { ok: false; reason: string } {
  const limit = roundToCent(payload.limit_price);
  const takeProfit = roundToCent(payload.take_profit.limit_price);
  const stopLoss = roundToCent(payload.stop_loss.stop_price);
  const notional = roundToCent(payload.notional);

  if (![limit, takeProfit, stopLoss, notional].every((n) => Number.isFinite(n))) {
    return { ok: false, reason: "payload_invalid_non_finite_number" };
  }
  if (limit <= 0 || takeProfit <= 0 || stopLoss <= 0) {
    return { ok: false, reason: "payload_invalid_non_positive_price" };
  }
  if (notional < 1) {
    return { ok: false, reason: "payload_invalid_notional_too_small" };
  }
  if (!(takeProfit > limit && stopLoss < limit)) {
    return { ok: false, reason: "payload_invalid_price_geometry" };
  }
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(payload.client_order_id)) {
    return { ok: false, reason: "payload_invalid_client_order_id" };
  }

  return {
    ok: true,
    payload: {
      ...payload,
      limit_price: limit,
      notional,
      take_profit: { limit_price: takeProfit },
      stop_loss: { stop_price: stopLoss }
    }
  };
}

function readProfilePositiveNumber(
  profile: RegimeProfile,
  defaultKey: string,
  riskOffKey: string,
  legacyKey: string,
  fallback: number
): number {
  const legacy = readPositiveNumberEnv(legacyKey, fallback);
  const scopedKey = profile === "risk_off" ? riskOffKey : defaultKey;
  return readPositiveNumberEnv(scopedKey, legacy);
}

function readProfilePositiveInt(
  profile: RegimeProfile,
  defaultKey: string,
  riskOffKey: string,
  legacyKey: string,
  fallback: number
): number {
  const legacy = readPositiveIntEnv(legacyKey, fallback);
  const scopedKey = profile === "risk_off" ? riskOffKey : defaultKey;
  return readPositiveIntEnv(scopedKey, legacy);
}

function toFinitePositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function getNestedValue(obj: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function extractVixFromMarketSnapshot(payload: unknown): number | null {
  const paths = [
    ["benchmarks", "vix", "close"],
    ["data", "benchmarks", "vix", "close"],
    ["snapshot", "benchmarks", "vix", "close"],
    ["marketPulse", "vix", "price"],
    ["marketPulse", "vix"],
    ["vix"]
  ];

  for (const path of paths) {
    const candidate = getNestedValue(payload, path);
    const parsed = toFinitePositiveNumber(candidate);
    if (parsed != null) return parsed;
  }
  return null;
}

function parseCandidateSummaries(payload: unknown): Stage6CandidateSummary[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  return parseCandidateSummariesFromRaw(root.alpha_candidates);
}

function normalizeStage6InstrumentType(value: unknown): Stage6CandidateSummary["instrumentType"] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "common") return "common";
  if (normalized === "warrant") return "warrant";
  if (normalized === "unit") return "unit";
  if (normalized === "right") return "right";
  if (normalized === "hybrid") return "hybrid";
  return "unknown";
}

function normalizeStage6HistoryTier(value: unknown): Stage6CandidateSummary["historyTier"] {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized === "FULL") return "FULL";
  if (normalized === "PROVISIONAL") return "PROVISIONAL";
  if (normalized === "ONBOARDING") return "ONBOARDING";
  return "UNKNOWN";
}

function normalizeStage6LifecycleState(value: unknown): Stage6CandidateSummary["symbolLifecycleState"] {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized === "ACTIVE") return "ACTIVE";
  if (normalized === "PROVISIONAL") return "PROVISIONAL";
  if (normalized === "ONBOARDING") return "ONBOARDING";
  if (normalized === "RECOVERED") return "RECOVERED";
  if (normalized === "STALE") return "STALE";
  if (normalized === "RETIRED") return "RETIRED";
  if (normalized === "EXCLUDED") return "EXCLUDED";
  return "UNKNOWN";
}

function parseCandidateSummariesFromRaw(raw: unknown): Stage6CandidateSummary[] {
  if (!Array.isArray(raw)) return [];
  const actionableVerdicts = resolveActionableVerdicts();

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const node = item as Record<string, unknown>;
      const symbol = typeof node.symbol === "string" ? node.symbol.trim().toUpperCase() : "";
      if (!symbol) return null;
      const verdictRaw = node.verdictFinal ?? node.finalVerdict ?? node.aiVerdict ?? node.verdict;
      const convictionRaw =
        node.convictionScore ??
        node.gatedConvictionScore ??
        node.rawConvictionScore ??
        node.convictionAiRaw ??
        node.conviction;
      const expectedReturnRaw = node.expectedReturn ?? node.gatedExpectedReturn ?? node.rawExpectedReturn;
      const expectedReturnPctRaw = parseFiniteNumber(
        node.expectedReturnPct ?? node.gatedExpectedReturnPct ?? node.rawExpectedReturnPct
      );
      const entryRaw = node.entryExecPrice ?? node.entryExecPriceShadow ?? node.entryPrice ?? node.otePrice ?? node.supportLevel;
      const targetRaw = node.targetPrice ?? node.targetMeanPrice ?? node.resistanceLevel;
      const stopRaw = node.stopPrice ?? node.stopLoss ?? node.ictStopLoss;
      const entryValueRaw = parsePriceValue(entryRaw);
      const targetValueRaw = parsePriceValue(targetRaw);
      const stopValueRaw = parsePriceValue(stopRaw);
      const entryDistanceRaw = node.entryDistancePct ?? node.entryDistancePctShadow;
      const entryFeasibleRaw = node.entryFeasible ?? node.entryFeasibleShadow;
      const tradePlanStatusRaw = node.tradePlanStatus ?? node.tradePlanStatusShadow;
      const qualityScoreRaw = parseFiniteNumber(node.qualityScore ?? node.convictionScore);
      const modelRankRaw = parseFiniteNumber(node.modelRank);
      const executionRankRaw = parseFiniteNumber(node.executionRank);
      const executionScoreRaw = parseFiniteNumber(node.executionScore);
      const executionBucketRaw = typeof node.executionBucket === "string" ? node.executionBucket.trim().toUpperCase() : "";
      const executionReasonRaw = typeof node.executionReason === "string" ? node.executionReason.trim().toUpperCase() : "";
      const finalDecisionRaw = typeof node.finalDecision === "string" ? node.finalDecision.trim().toUpperCase() : "";
      const decisionReasonRaw = typeof node.decisionReason === "string" ? node.decisionReason.trim().toLowerCase() : "";
      const stage6TierRaw = typeof node.stage6Tier === "string" ? node.stage6Tier.trim().toUpperCase() : "";
      const stage6TierReasonRaw = typeof node.stage6TierReason === "string" ? node.stage6TierReason.trim().toLowerCase() : "";
      const stage6TierMultiplierRaw = parseFiniteNumber(node.stage6TierMultiplier);
      const displacementRaw = parseFiniteNumber(node.displacement ?? getNestedValue(node, ["ictMetrics", "displacement"]));
      const ictPosRaw = parseFiniteNumber(node.ictPos ?? node.stage6IctPos);
      const trendAlignmentRaw =
        typeof node.trendAlignment === "string"
          ? node.trendAlignment.trim().toUpperCase()
          : typeof getNestedValue(node, ["techMetrics", "trendAlignment"]) === "string"
            ? String(getNestedValue(node, ["techMetrics", "trendAlignment"])).trim().toUpperCase()
            : null;
      const hfSentimentLabelRaw = typeof node.hfSentimentLabel === "string" ? node.hfSentimentLabel.trim().toLowerCase() : "";
      const hfSentimentStatusRaw =
        typeof node.hfSentimentStatus === "string" ? node.hfSentimentStatus.trim().toUpperCase() : "";
      const hfSentimentReasonRaw =
        typeof node.hfSentimentReason === "string" ? node.hfSentimentReason.trim().toLowerCase() : "";
      const hfSentimentScoreRaw = parseFiniteNumber(node.hfSentimentScore);
      const hfSentimentArticleCountRaw = parseFiniteNumber(node.hfSentimentArticleCount);
      const hfSentimentNewestAgeHoursRaw = parseFiniteNumber(node.hfSentimentNewestAgeHours);
      const instrumentType = normalizeStage6InstrumentType(node.instrumentType);
      const historyTier = normalizeStage6HistoryTier(node.historyTier);
      const symbolLifecycleState = normalizeStage6LifecycleState(node.symbolLifecycleState);
      const analysisEligibleRaw = parseBooleanValue(node.analysisEligible);
      const analysisEligible =
        analysisEligibleRaw != null ? analysisEligibleRaw : instrumentType === "common" ? true : null;
      let executionBucket: Stage6CandidateSummary["executionBucket"] =
        executionBucketRaw === "EXECUTABLE" ? "EXECUTABLE" : executionBucketRaw === "WATCHLIST" ? "WATCHLIST" : "N/A";
      const executionReason: Stage6CandidateSummary["executionReason"] =
        executionReasonRaw === "VALID_EXEC"
          ? "VALID_EXEC"
          : executionReasonRaw === "WAIT_PULLBACK_TOO_DEEP"
            ? "WAIT_PULLBACK_TOO_DEEP"
            : executionReasonRaw === "INVALID_GEOMETRY"
              ? "INVALID_GEOMETRY"
            : executionReasonRaw === "INVALID_DATA"
                ? "INVALID_DATA"
                : "N/A";
      let finalDecision: Stage6CandidateSummary["finalDecision"] =
        finalDecisionRaw === "EXECUTABLE_NOW"
          ? "EXECUTABLE_NOW"
          : finalDecisionRaw === "WAIT_PRICE"
            ? "WAIT_PRICE"
            : finalDecisionRaw === "BLOCKED_RISK"
              ? "BLOCKED_RISK"
              : finalDecisionRaw === "BLOCKED_EVENT"
                ? "BLOCKED_EVENT"
                : executionBucket === "EXECUTABLE"
                  ? "EXECUTABLE_NOW"
                  : executionBucket === "WATCHLIST"
                    ? "WAIT_PRICE"
                    : "N/A";
      let decisionReason =
        decisionReasonRaw ||
        (executionReason === "WAIT_PULLBACK_TOO_DEEP"
          ? "wait_pullback_not_reached"
          : executionReason === "INVALID_GEOMETRY"
            ? "blocked_invalid_geometry"
            : executionReason === "INVALID_DATA"
              ? "blocked_missing_trade_box"
              : executionReason === "VALID_EXEC"
                ? "executable_pullback"
                : "n/a");
      const stage6Tier: Stage6CandidateSummary["stage6Tier"] =
        stage6TierRaw === "TIER1"
          ? "TIER1"
          : stage6TierRaw === "TIER2"
            ? "TIER2"
            : stage6TierRaw === "NONE"
              ? "NONE"
              : "N/A";
      const verdict = normalizeStage6Verdict(verdictRaw);

      // Stage6 execution contract invariant:
      // - EXECUTABLE_NOW must be paired with configured actionable verdicts
      // - non-executable decisions are always treated as watchlist on sidecar
      if (finalDecision === "EXECUTABLE_NOW" && !actionableVerdicts.has(verdict)) {
        finalDecision = "WAIT_PRICE";
        executionBucket = "WATCHLIST";
        if (!decisionReason || decisionReason === "n/a" || decisionReason === "executable_pullback") {
          decisionReason = "blocked_quality_verdict_unusable";
        }
      } else if (NON_EXECUTABLE_DECISIONS.has(finalDecision)) {
        executionBucket = "WATCHLIST";
      } else if (finalDecision === "EXECUTABLE_NOW") {
        executionBucket = "EXECUTABLE";
      }

      return {
        symbol,
        instrumentType,
        analysisEligible,
        historyTier,
        symbolLifecycleState,
        verdict,
        expectedReturn: formatExpectedReturnLabel(expectedReturnRaw, expectedReturnPctRaw),
        expectedReturnPct:
          expectedReturnPctRaw != null ? Number(normalizePercentValue(expectedReturnPctRaw).toFixed(2)) : null,
        entry: parsePrice(entryRaw),
        entryValue: entryValueRaw != null ? Number(entryValueRaw.toFixed(6)) : null,
        target: parsePrice(targetRaw),
        targetValue: targetValueRaw != null ? Number(targetValueRaw.toFixed(6)) : null,
        stop: parsePrice(stopRaw),
        stopValue: stopValueRaw != null ? Number(stopValueRaw.toFixed(6)) : null,
        conviction:
          typeof convictionRaw === "number" && Number.isFinite(convictionRaw)
            ? convictionRaw.toFixed(0)
            : typeof convictionRaw === "string" && convictionRaw.trim()
              ? convictionRaw.trim()
              : "N/A",
        qualityScore: qualityScoreRaw != null ? Number(qualityScoreRaw.toFixed(1)) : null,
        modelRank: modelRankRaw != null ? Math.round(modelRankRaw) : null,
        executionRank: executionRankRaw != null ? Math.round(executionRankRaw) : null,
        executionScore: executionScoreRaw != null ? Number(executionScoreRaw.toFixed(1)) : null,
        executionBucket,
        executionReason,
        finalDecision,
        decisionReason,
        stage6Tier,
        stage6TierReason: stage6TierReasonRaw || "tier_none",
        stage6TierMultiplier: stage6TierMultiplierRaw != null ? Number(stage6TierMultiplierRaw.toFixed(3)) : null,
        displacement: displacementRaw != null ? Number(displacementRaw.toFixed(2)) : null,
        ictPos: ictPosRaw != null ? Number(ictPosRaw.toFixed(4)) : null,
        trendAlignment: trendAlignmentRaw,
        entryDistancePct: parseFiniteNumber(entryDistanceRaw),
        entryFeasible: parseBooleanValue(entryFeasibleRaw),
        tradePlanStatus:
          typeof tradePlanStatusRaw === "string" && tradePlanStatusRaw.trim()
            ? tradePlanStatusRaw.trim().toUpperCase()
            : "N/A",
        hfSentimentLabel:
          hfSentimentLabelRaw === "positive"
            ? "positive"
            : hfSentimentLabelRaw === "negative"
              ? "negative"
              : hfSentimentLabelRaw === "neutral"
                ? "neutral"
                : null,
        hfSentimentScore:
          hfSentimentScoreRaw != null ? Number(clamp(hfSentimentScoreRaw, 0, 1).toFixed(4)) : null,
        hfSentimentStatus:
          hfSentimentStatusRaw === "OK"
            ? "OK"
            : hfSentimentStatusRaw === "SKIPPED"
              ? "SKIPPED"
              : hfSentimentStatusRaw === "FAILED"
                ? "FAILED"
                : hfSentimentStatusRaw === "DISABLED"
                  ? "DISABLED"
                : "N/A",
        hfSentimentReason: hfSentimentReasonRaw || null,
        hfSentimentArticleCount:
          hfSentimentArticleCountRaw != null ? Math.max(0, Math.round(hfSentimentArticleCountRaw)) : null,
        hfSentimentNewestAgeHours:
          hfSentimentNewestAgeHoursRaw != null ? Number(Math.max(0, hfSentimentNewestAgeHoursRaw).toFixed(2)) : null
      };
    })
    .filter((row): row is Stage6CandidateSummary => row !== null)
    .slice(0, 6);
}

function parseStage6DecisionCounts(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, number>>((acc, [key, value]) => {
    const parsed = parseFiniteNumber(value);
    if (!Number.isFinite(parsed)) return acc;
    const safeKey = String(key || "").trim();
    if (!safeKey) return acc;
    acc[safeKey] = Number(parsed);
    return acc;
  }, {});
}

function parseStage6ContractContext(payload: unknown): Stage6ContractContext | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const raw = root.execution_contract;
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;

  const modelTop6 = parseCandidateSummariesFromRaw(node.modelTop6);
  const executablePicks = parseCandidateSummariesFromRaw(node.executablePicks);
  const watchlistTop = parseCandidateSummariesFromRaw(node.watchlistTop);
  const decisionCountsPrimary = parseStage6DecisionCounts(node.decisionCountsPrimary);
  const decisionCountsTop6 = parseStage6DecisionCounts(node.decisionCountsTop6);

  if (modelTop6.length === 0 && executablePicks.length === 0 && watchlistTop.length === 0) return null;

  return {
    modelTop6,
    executablePicks,
    watchlistTop,
    decisionCountsPrimary,
    decisionCountsTop6
  };
}

async function fetchLatestMarketSnapshotVix(accessToken: string): Promise<VixLookupResult> {
  const explicitFolderId = process.env.GDRIVE_MARKET_SNAPSHOT_FOLDER_ID?.trim() || "";
  const fallbackFolderId = process.env.GDRIVE_ROOT_FOLDER_ID || "";
  const folderId = explicitFolderId || fallbackFolderId;
  if (!folderId) {
    return { vix: null, reason: "snapshot folder not configured (set GDRIVE_MARKET_SNAPSHOT_FOLDER_ID)" };
  }

  const query = [
    `'${folderId}' in parents`,
    "trashed=false",
    "name contains 'MARKET_REGIME_SNAPSHOT'"
  ].join(" and ");

  const params = new URLSearchParams({
    q: query,
    orderBy: "modifiedTime desc",
    pageSize: "1",
    fields: "files(id,name,modifiedTime)"
  });

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const text = await response.text();
    return {
      vix: null,
      reason: `snapshot list failed (${response.status}) in folder ${folderId}: ${text.slice(0, 120)}`,
      source: "market_snapshot"
    };
  }

  const data = (await response.json()) as DriveListResponse;
  const file = data.files?.[0];
  if (!file?.id) {
    return { vix: null, reason: `snapshot not found in folder ${folderId}`, source: "market_snapshot" };
  }

  try {
    const raw = await downloadStage6Json(accessToken, file.id);
    const parsed = JSON.parse(raw) as unknown;
    const vix = extractVixFromMarketSnapshot(parsed);
    if (vix == null) {
      return {
        vix: null,
        reason: `snapshot parse miss: VIX field not found in ${file.name}`,
        modifiedTime: file.modifiedTime,
        source: "market_snapshot"
      };
    }
    return {
      vix,
      reason: `snapshot ok: ${file.name}`,
      modifiedTime: file.modifiedTime,
      source: "market_snapshot"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      vix: null,
      reason: `snapshot parse/download failed for ${file.name}: ${message.slice(0, 120)}`,
      modifiedTime: file.modifiedTime,
      source: "market_snapshot"
    };
  }
}

async function fetchFinnhubVix(): Promise<VixLookupResult> {
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) return { vix: null, reason: "FINNHUB_API_KEY missing", source: "finnhub" };

  const candidates = ["VIX", "^VIX", "CBOE:VIX"];
  const attempts: string[] = [];
  for (const symbol of candidates) {
    try {
      const params = new URLSearchParams({ symbol, token });
      const response = await fetch(`https://finnhub.io/api/v1/quote?${params.toString()}`);
      if (!response.ok) {
        attempts.push(`${symbol}:${response.status}`);
        continue;
      }
      const data = (await response.json()) as { c?: unknown };
      const parsed = toFinitePositiveNumber(data.c);
      if (parsed != null) return { vix: parsed, reason: `finnhub ok: ${symbol}`, source: "finnhub" };
      attempts.push(`${symbol}:invalid_quote`);
    } catch {
      attempts.push(`${symbol}:network_error`);
    }
  }
  return { vix: null, reason: `finnhub failed (${attempts.join(", ") || "no candidates"})`, source: "finnhub" };
}

async function fetchCnbcDirectVix(): Promise<VixLookupResult> {
  const symbols = ".VIX";
  const url =
    `https://quote.cnbc.com/quote-html-webservice/quote.htm?partnerId=2&requestMethod=quick&` +
    `exthrs=1&noform=1&fund=1&output=json&players=null&symbols=${encodeURIComponent(symbols)}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        vix: null,
        reason: `cnbc direct failed (${response.status}): ${text.slice(0, 120)}`,
        source: "cnbc_direct"
      };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const quickQuoteResult = data.QuickQuoteResult as Record<string, unknown> | undefined;
    const rawQuotes = quickQuoteResult?.QuickQuote;
    const quotes = Array.isArray(rawQuotes) ? rawQuotes : [];
    const vixRow = quotes.find((row) => {
      if (!row || typeof row !== "object") return false;
      const symbol = String((row as Record<string, unknown>).symbol || "").toUpperCase();
      return symbol === ".VIX" || symbol === "VIX";
    }) as Record<string, unknown> | undefined;
    if (!vixRow) {
      return { vix: null, reason: "cnbc direct parse miss: .VIX not found", source: "cnbc_direct" };
    }

    const vix = toFinitePositiveNumber(vixRow.last ?? vixRow.last_trade ?? vixRow.price);
    if (vix == null) {
      return { vix: null, reason: "cnbc direct parse miss: invalid VIX value", source: "cnbc_direct" };
    }
    return { vix, reason: "cnbc direct ok: .VIX", source: "cnbc_direct" };
  } catch {
    return { vix: null, reason: "cnbc direct network error", source: "cnbc_direct" };
  }
}

async function fetchCnbcRapidApiVix(): Promise<VixLookupResult> {
  const rapidEnabled = readBoolEnv("CNBC_RAPIDAPI_ENABLED", false);
  if (!rapidEnabled) {
    return { vix: null, reason: "cnbc rapidapi disabled", source: "cnbc_rapidapi" };
  }

  const key = process.env.CNBC_RAPIDAPI_KEY?.trim() || process.env.RAPID_API_KEY?.trim() || "";
  if (!key) {
    return { vix: null, reason: "CNBC_RAPIDAPI_KEY/RAPID_API_KEY missing", source: "cnbc_rapidapi" };
  }

  const host = process.env.CNBC_RAPIDAPI_HOST?.trim() || "cnbc.p.rapidapi.com";
  const endpoint = process.env.CNBC_RAPIDAPI_ENDPOINT?.trim() || "/market/get-quote";
  const symbols = ".VIX";
  const symbolParam = process.env.CNBC_RAPIDAPI_SYMBOL_PARAM?.trim() || "symbol";
  const params = new URLSearchParams();
  params.set(symbolParam, symbols);
  params.set("requestMethod", "quick");
  params.set("exthrs", "1");
  params.set("noform", "1");
  params.set("fund", "1");
  params.set("output", "json");

  try {
    const response = await fetch(`https://${host}${endpoint}?${params.toString()}`, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": host
      }
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        vix: null,
        reason: `cnbc rapidapi failed (${response.status}) host=${host} endpoint=${endpoint}: ${text.slice(0, 120)}`,
        source: "cnbc_rapidapi"
      };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const quickQuoteResult = data.QuickQuoteResult as Record<string, unknown> | undefined;
    const rawQuotes = quickQuoteResult?.QuickQuote;
    const quotes = Array.isArray(rawQuotes) ? rawQuotes : [];
    const vixRow = quotes.find((row) => {
      if (!row || typeof row !== "object") return false;
      const symbol = String((row as Record<string, unknown>).symbol || "").toUpperCase();
      return symbol === ".VIX" || symbol === "VIX";
    }) as Record<string, unknown> | undefined;
    if (!vixRow) {
      return { vix: null, reason: "cnbc rapidapi parse miss: .VIX not found", source: "cnbc_rapidapi" };
    }

    const vix = toFinitePositiveNumber(vixRow.last ?? vixRow.last_trade ?? vixRow.price);
    if (vix == null) {
      return { vix: null, reason: "cnbc rapidapi parse miss: invalid VIX value", source: "cnbc_rapidapi" };
    }
    return { vix, reason: "cnbc rapidapi ok: .VIX", source: "cnbc_rapidapi" };
  } catch {
    return { vix: null, reason: "cnbc rapidapi network error", source: "cnbc_rapidapi" };
  }
}

function evaluateSnapshotFreshness(
  snapshot: VixLookupResult,
  maxAgeMin: number
): { usableVix: number | null; diag?: string } {
  if (snapshot.vix == null) return { usableVix: null };
  if (maxAgeMin <= 0) return { usableVix: snapshot.vix };
  if (!snapshot.modifiedTime) {
    return { usableVix: null, diag: `snapshot stale guard: modifiedTime missing (maxAge=${maxAgeMin}m)` };
  }

  const modifiedTs = Date.parse(snapshot.modifiedTime);
  if (!Number.isFinite(modifiedTs)) {
    return { usableVix: null, diag: `snapshot stale guard: invalid modifiedTime (${snapshot.modifiedTime})` };
  }

  const ageMin = (Date.now() - modifiedTs) / 60000;
  if (ageMin <= maxAgeMin) {
    return { usableVix: snapshot.vix };
  }
  return {
    usableVix: null,
    diag: `snapshot stale guard: age=${ageMin.toFixed(1)}m > max=${maxAgeMin}m`
  };
}

async function loadRegimeGuardState(): Promise<RegimeGuardState | null> {
  try {
    const raw = await readFile(REGIME_GUARD_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<RegimeGuardState>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.lastProfile !== "default" && parsed.lastProfile !== "risk_off") return null;
    if (typeof parsed.lastSwitchedAt !== "string" || typeof parsed.updatedAt !== "string") return null;
    return {
      lastProfile: parsed.lastProfile,
      lastSwitchedAt: parsed.lastSwitchedAt,
      updatedAt: parsed.updatedAt
    };
  } catch {
    return null;
  }
}

async function saveRegimeGuardState(state: RegimeGuardState): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(REGIME_GUARD_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  console.log(`[STATE] saved ${REGIME_GUARD_STATE_PATH}`);
}

function evaluateRegimeQuality(selection: RegimeSelection): RegimeQualityGuard {
  const enabled = readBoolEnv("REGIME_QUALITY_GUARD_ENABLED", true);
  const minScore = readPositiveNumberEnv("REGIME_QUALITY_MIN_SCORE", 60);
  const vixMismatchPct = readPositiveNumberEnv("REGIME_VIX_MISMATCH_PCT", 8);
  const reasons: string[] = [];
  let score = 100;

  if (selection.vix == null) {
    score -= 65;
    reasons.push("vix_missing");
  }

  if (selection.source === "market_snapshot") {
    score -= 20;
    reasons.push("realtime_source_unavailable");
  } else if (selection.source === "env_fallback") {
    score -= 35;
    reasons.push("all_vix_sources_unavailable");
  }

  if (selection.snapshotAgeMin != null && selection.snapshotAgeMin > 30) {
    score -= 10;
    reasons.push(`snapshot_age_high:${selection.snapshotAgeMin.toFixed(1)}m`);
  }

  if (selection.snapshotVix != null && selection.vix != null && selection.snapshotAgeMin != null && selection.snapshotAgeMin <= 30) {
    const mismatchPct = (Math.abs(selection.vix - selection.snapshotVix) / Math.max(selection.snapshotVix, 0.01)) * 100;
    if (mismatchPct >= vixMismatchPct) {
      score -= 15;
      reasons.push(`vix_source_mismatch:${mismatchPct.toFixed(1)}%`);
    }
  }

  if (selection.diagnostics.some((line) => line.includes("snapshot stale guard"))) {
    score -= 10;
    reasons.push("snapshot_stale");
  }
  if (selection.diagnostics.some((line) => line.includes("finnhub failed"))) {
    score -= 5;
    reasons.push("finnhub_unavailable");
  }
  if (selection.diagnostics.some((line) => line.includes("cnbc-direct") && line.includes("failed"))) {
    score -= 10;
    reasons.push("cnbc_direct_unavailable");
  }
  if (selection.diagnostics.some((line) => line.includes("cnbc rapidapi failed"))) {
    score -= 5;
    reasons.push("cnbc_rapidapi_unavailable");
  }

  score = clamp(Math.round(score), 0, 100);
  const status: RegimeQualityStatus = score >= 80 ? "high" : score >= minScore ? "medium" : "low";
  const forceRiskOff = enabled && score < minScore;

  return {
    enabled,
    score,
    minScore,
    status,
    forceRiskOff,
    reasons
  };
}

async function applyRegimeGuards(base: RegimeSelection): Promise<RegimeSelection> {
  const quality = evaluateRegimeQuality(base);
  const hysteresisEnabled = readBoolEnv("REGIME_HYSTERESIS_ENABLED", true);
  const minHoldMin = Math.max(0, readNonNegativeNumberEnv("REGIME_MIN_HOLD_MIN", 30));
  const nowIso = new Date().toISOString();
  const state = await loadRegimeGuardState();
  const previousProfile = state?.lastProfile ?? null;

  let desiredProfile = base.profile;
  let entryGuard: RegimeEntryGuard = { blocked: false, reason: "none" };

  if (quality.forceRiskOff) {
    desiredProfile = "risk_off";
    entryGuard = {
      blocked: true,
      reason: `data_quality_low(score=${quality.score}<${quality.minScore})`
    };
  }

  // Hysteresis band: while in risk_off, recover only below riskOn threshold.
  if (base.vix != null && previousProfile === "risk_off" && desiredProfile === "default" && base.vix > base.riskOnThreshold) {
    desiredProfile = "risk_off";
  }

  let appliedProfile = desiredProfile;
  let holdRemainingMin = 0;
  let hysteresisReason = "none";

  const shouldBypassHold = quality.forceRiskOff && desiredProfile === "risk_off";
  if (hysteresisEnabled && previousProfile && previousProfile !== desiredProfile && !shouldBypassHold) {
    const switchedAt = Date.parse(state?.lastSwitchedAt || "");
    if (Number.isFinite(switchedAt)) {
      const elapsedMin = (Date.now() - switchedAt) / 60000;
      if (elapsedMin < minHoldMin) {
        appliedProfile = previousProfile;
        holdRemainingMin = Math.max(0, minHoldMin - elapsedMin);
        hysteresisReason = "min_hold";
      } else {
        hysteresisReason = "min_hold_satisfied";
      }
    }
  }

  if (hysteresisEnabled && previousProfile === "risk_off" && desiredProfile === "default" && appliedProfile === "risk_off") {
    if (hysteresisReason === "none") hysteresisReason = "hysteresis_band";
  }

  const shouldSave =
    !state ||
    state.lastProfile !== appliedProfile ||
    !state.lastSwitchedAt ||
    !state.updatedAt ||
    (computeAgeMinutes(state.updatedAt) ?? 9999) > 60;

  if (shouldSave) {
    await saveRegimeGuardState({
      lastProfile: appliedProfile,
      lastSwitchedAt: !state || state.lastProfile !== appliedProfile ? nowIso : state.lastSwitchedAt,
      updatedAt: nowIso
    });
  }

  return {
    ...base,
    baseProfile: base.profile,
    profile: appliedProfile,
    quality,
    hysteresis: {
      enabled: hysteresisEnabled,
      minHoldMin,
      previousProfile,
      desiredProfile,
      appliedProfile,
      holdRemainingMin: Number(holdRemainingMin.toFixed(1)),
      reason: hysteresisReason
    },
    entryGuard
  };
}

async function loadGuardControlState(): Promise<GuardControlState | null> {
  try {
    const raw = await readFile(GUARD_CONTROL_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as GuardControlState;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function resolveGuardControlGate(): Promise<GuardControlGate> {
  const enforce = readBoolEnv("GUARD_CONTROL_ENFORCE", false);
  const maxAgeMin = Math.max(0, readNonNegativeNumberEnv("GUARD_CONTROL_MAX_AGE_MIN", 180));

  if (!enforce) {
    return {
      enforce: false,
      maxAgeMin,
      ageMin: null,
      blocked: false,
      wouldBlockLive: false,
      reason: "disabled",
      updatedAt: null,
      level: null,
      stale: false
    };
  }

  const state = await loadGuardControlState();
  if (!state) {
    return {
      enforce: true,
      maxAgeMin,
      ageMin: null,
      blocked: false,
      wouldBlockLive: false,
      reason: "state_missing",
      updatedAt: null,
      level: null,
      stale: false
    };
  }

  const cfg = loadRuntimeConfig();
  const updatedAt = typeof state.updatedAt === "string" && state.updatedAt ? state.updatedAt : null;
  const levelRaw = typeof state.level === "number" && Number.isFinite(state.level) ? state.level : null;
  const level = levelRaw != null ? Math.max(0, Math.floor(levelRaw)) : null;
  const ageMin = computeAgeMinutes(updatedAt);
  const stale = maxAgeMin > 0 && ageMin != null && ageMin > maxAgeMin;
  const liveMode = !cfg.readOnly && cfg.execEnabled;
  const simulationLiveParity = cfg.simulationLiveParity;
  const liveParityGuard = liveMode || simulationLiveParity;
  const lastLevelDangerous = level != null ? level >= 2 : Boolean(state.haltNewEntries);

  if (stale) {
    const keepHaltConservative = liveParityGuard && lastLevelDangerous;
    let reason = `stale(age=${ageMin.toFixed(1)}m>${maxAgeMin}m)`;
    if (lastLevelDangerous) reason += ",halt_level_dangerous";
    if (keepHaltConservative && !liveMode) reason += ",simulated_live_parity";
    return {
      enforce: true,
      maxAgeMin,
      ageMin,
      blocked: keepHaltConservative,
      wouldBlockLive: lastLevelDangerous,
      reason,
      updatedAt,
      level,
      stale: true
    };
  }

  if (!state.haltNewEntries) {
    return {
      enforce: true,
      maxAgeMin,
      ageMin,
      blocked: false,
      wouldBlockLive: false,
      reason: "halt_new_entries_false",
      updatedAt,
      level,
      stale: false
    };
  }

  if (!liveParityGuard) {
    return {
      enforce: true,
      maxAgeMin,
      ageMin,
      blocked: false,
      wouldBlockLive: true,
      reason: `non_live_mode(readOnly=${cfg.readOnly},execEnabled=${cfg.execEnabled})`,
      updatedAt,
      level,
      stale: false
    };
  }

  const levelLabel = level != null ? `L${level}` : "unknown";
  return {
    enforce: true,
    maxAgeMin,
    ageMin,
    blocked: true,
    wouldBlockLive: true,
    reason: `guard_control_halt_new_entries(level=${levelLabel})${!liveMode ? ",simulated_live_parity" : ""}`,
    updatedAt,
    level,
    stale: false
  };
}

function applyEntryGuardToDryExec(dryExec: DryExecBuildResult, regime: RegimeSelection): DryExecBuildResult {
  if (!regime.entryGuard.blocked || dryExec.payloads.length === 0) return dryExec;
  const capacityReasons = new Set(["max_orders_reached", "max_total_notional_reached"]);
  const remappedSkips = dryExec.skipped.map((row) =>
    capacityReasons.has(row.reason)
      ? { ...row, reason: `entry_blocked:${regime.entryGuard.reason}` }
      : row
  );
  const blockedSkips: DryExecSkipReason[] = dryExec.payloads.map((row) => ({
    symbol: row.symbol,
    reason: `entry_blocked:${regime.entryGuard.reason}`,
    ...(dryExec.actionIntent.enabled && dryExec.actionIntent.allowedActionTypes.includes("HOLD_WAIT")
      ? { actionType: "HOLD_WAIT" as const, actionReason: "entry_guard_blocked" }
      : {})
  }));
  const skipped = [...remappedSkips, ...blockedSkips];
  const nextDryExec: DryExecBuildResult = {
    ...dryExec,
    payloads: [],
    skipped,
    skipReasonCounts: buildSkipReasonCounts(skipped)
  };

  return {
    ...nextDryExec,
    actionIntent: rebuildActionIntentSummary(nextDryExec)
  };
}

function applyGuardControlGateToDryExec(dryExec: DryExecBuildResult, gate: GuardControlGate): DryExecBuildResult {
  if (!gate.blocked || dryExec.payloads.length === 0) return dryExec;
  const capacityReasons = new Set(["max_orders_reached", "max_total_notional_reached"]);
  const remappedSkips = dryExec.skipped.map((row) =>
    capacityReasons.has(row.reason)
      ? { ...row, reason: `entry_blocked:${gate.reason}` }
      : row
  );
  const blockedSkips: DryExecSkipReason[] = dryExec.payloads.map((row) => ({
    symbol: row.symbol,
    reason: `entry_blocked:${gate.reason}`,
    ...(dryExec.actionIntent.enabled && dryExec.actionIntent.allowedActionTypes.includes("HOLD_WAIT")
      ? { actionType: "HOLD_WAIT" as const, actionReason: "guard_control_blocked" }
      : {})
  }));
  const skipped = [...remappedSkips, ...blockedSkips];
  const nextDryExec: DryExecBuildResult = {
    ...dryExec,
    payloads: [],
    skipped,
    skipReasonCounts: buildSkipReasonCounts(skipped)
  };

  return {
    ...nextDryExec,
    actionIntent: rebuildActionIntentSummary(nextDryExec)
  };
}

function applyPreflightGateToDryExec(
  dryExec: DryExecBuildResult,
  preflight: PreflightResult
): DryExecBuildResult {
  if (!preflight.blocking || dryExec.payloads.length === 0) return dryExec;
  const blockedSkips: DryExecSkipReason[] = dryExec.payloads.map((row) => ({
    symbol: row.symbol,
    reason: `preflight_blocked:${preflight.code}`,
    ...(dryExec.actionIntent.enabled && dryExec.actionIntent.allowedActionTypes.includes("HOLD_WAIT")
      ? { actionType: "HOLD_WAIT" as const, actionReason: "preflight_blocked" }
      : {})
  }));
  const skipped = [...dryExec.skipped, ...blockedSkips];
  const nextDryExec: DryExecBuildResult = {
    ...dryExec,
    payloads: [],
    skipped,
    skipReasonCounts: buildSkipReasonCounts(skipped)
  };

  return {
    ...nextDryExec,
    actionIntent: rebuildActionIntentSummary(nextDryExec)
  };
}

async function resolveRegimeSelection(accessToken: string): Promise<RegimeSelection> {
  const forced = (process.env.REGIME_FORCE_PROFILE || "auto").trim().toLowerCase();
  const sourcePriorityRaw = (process.env.REGIME_VIX_SOURCE_PRIORITY || "realtime_first").trim().toLowerCase();
  const sourcePriority = sourcePriorityRaw === "snapshot_first" ? "snapshot_first" : "realtime_first";
  const riskOffThreshold = readPositiveNumberEnv("VIX_RISK_OFF_THRESHOLD", 25);
  const riskOnThresholdRaw = readPositiveNumberEnv("VIX_RISK_ON_THRESHOLD", 22);
  const riskOnThreshold = Math.min(riskOnThresholdRaw, riskOffThreshold);
  const snapshotMaxAgeMin = Math.max(0, readNumberEnv("REGIME_SNAPSHOT_MAX_AGE_MIN", 10));
  const diagnostics: string[] = [];

  const buildSelection = (
    profile: RegimeProfile,
    source: RegimeSelection["source"],
    vix: number | null,
    snapshotVix: number | null,
    snapshotAgeMin: number | null,
    diag: string[]
  ): RegimeSelection => ({
    profile,
    baseProfile: profile,
    source,
    vix,
    sourcePriority,
    snapshotVix,
    snapshotAgeMin,
    riskOnThreshold,
    riskOffThreshold,
    diagnostics: diag,
    quality: {
      enabled: readBoolEnv("REGIME_QUALITY_GUARD_ENABLED", true),
      score: 100,
      minScore: readPositiveNumberEnv("REGIME_QUALITY_MIN_SCORE", 60),
      status: "high",
      forceRiskOff: false,
      reasons: []
    },
    hysteresis: {
      enabled: readBoolEnv("REGIME_HYSTERESIS_ENABLED", true),
      minHoldMin: Math.max(0, readNonNegativeNumberEnv("REGIME_MIN_HOLD_MIN", 30)),
      previousProfile: null,
      desiredProfile: profile,
      appliedProfile: profile,
      holdRemainingMin: 0,
      reason: "none"
    },
    entryGuard: {
      blocked: false,
      reason: "none"
    }
  });

  if (forced === "default" || forced === "risk_off") {
    return buildSelection(forced, "forced", null, null, null, [`forced profile=${forced}`]);
  }

  if (!readBoolEnv("REGIME_AUTO_ENABLED", false)) {
    return buildSelection("default", "env_fallback", null, null, null, [
      "regime auto disabled (REGIME_AUTO_ENABLED=false)"
    ]);
  }

  diagnostics.push(`auto source priority=${sourcePriority} snapshotMaxAge=${snapshotMaxAgeMin}m`);

  const snapshot = await fetchLatestMarketSnapshotVix(accessToken);
  if (snapshot.reason) diagnostics.push(`snapshot: ${snapshot.reason}`);
  const snapshotFresh = evaluateSnapshotFreshness(snapshot, snapshotMaxAgeMin);
  if (snapshotFresh.diag) diagnostics.push(snapshotFresh.diag);
  const snapshotAgeMin = computeAgeMinutes(snapshot.modifiedTime);

  const resolveRealtimeVix = async (): Promise<VixLookupResult> => {
    const finnhub = await fetchFinnhubVix();
    diagnostics.push(`finnhub: ${finnhub.reason}`);
    if (finnhub.vix != null) return finnhub;

    const cnbcDirect = await fetchCnbcDirectVix();
    diagnostics.push(`cnbc-direct: ${cnbcDirect.reason}`);
    if (cnbcDirect.vix != null) return cnbcDirect;

    const cnbc = await fetchCnbcRapidApiVix();
    diagnostics.push(`cnbc: ${cnbc.reason}`);
    if (cnbc.vix != null) return cnbc;
    return { vix: null, reason: "realtime providers exhausted", source: "env_fallback" };
  };

  let vix: number | null = null;
  let source: RegimeSelection["source"] = "env_fallback";

  if (sourcePriority === "snapshot_first") {
    if (snapshotFresh.usableVix != null) {
      vix = snapshotFresh.usableVix;
      source = "market_snapshot";
    } else {
      const realtime = await resolveRealtimeVix();
      vix = realtime.vix;
      if (
        realtime.source === "finnhub" ||
        realtime.source === "cnbc_direct" ||
        realtime.source === "cnbc_rapidapi"
      ) {
        source = realtime.source;
      }
    }
  } else {
    const realtime = await resolveRealtimeVix();
    if (
      realtime.vix != null &&
      (realtime.source === "finnhub" || realtime.source === "cnbc_direct" || realtime.source === "cnbc_rapidapi")
    ) {
      vix = realtime.vix;
      source = realtime.source;
    } else if (snapshotFresh.usableVix != null) {
      vix = snapshotFresh.usableVix;
      source = "market_snapshot";
    }
  }

  if (vix == null) {
    return buildSelection("default", source, null, snapshot.vix ?? null, snapshotAgeMin, diagnostics);
  }

  const profile: RegimeProfile = vix >= riskOffThreshold ? "risk_off" : "default";
  return buildSelection(profile, source, vix, snapshot.vix ?? null, snapshotAgeMin, diagnostics);
}

async function loadLatestStage6FromDrive(accessToken: string): Promise<Stage6LoadResult> {
  const meta = await fetchLatestStage6Metadata(accessToken);
  const jsonText = await downloadStage6Json(accessToken, meta.id);
  const parsed = JSON.parse(jsonText) as unknown;
  const contractContext = parseStage6ContractContext(parsed);
  const fallbackCandidates = parseCandidateSummaries(parsed);
  const candidates =
    contractContext && contractContext.executablePicks.length > 0
      ? contractContext.executablePicks
      : fallbackCandidates;
  const modelTopCandidates =
    contractContext && contractContext.modelTop6.length > 0
      ? contractContext.modelTop6
      : fallbackCandidates;
  const symbols = Array.from(new Set(candidates.map((row) => row.symbol).filter(Boolean)));
  const sha256 = createHash("sha256").update(jsonText).digest("hex");

  return {
    fileId: meta.id,
    fileName: meta.name,
    modifiedTime: meta.modifiedTime,
    md5Checksum: meta.md5Checksum,
    sha256,
    candidateSymbols: symbols,
    candidates,
    modelTopCandidates,
    contractContext
  };
}

function printStage6Lock(result: Stage6LoadResult) {
  const symbolLog = result.candidateSymbols.length > 0 ? result.candidateSymbols.join(",") : "(none)";
  console.log(
    `[STAGE6_LOCK] ${result.fileName} | fileId=${result.fileId} | modified=${result.modifiedTime} | md5=${result.md5Checksum} | sha256=${result.sha256.slice(0, 12)}`
  );
  console.log(`[STAGE6_CANDIDATES] count=${result.candidateSymbols.length} | symbols=${symbolLog}`);
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function validateTriggerContext(stage6: Stage6LoadResult): void {
  const eventName = (process.env.WORKFLOW_EVENT_NAME || process.env.GITHUB_EVENT_NAME || "")
    .trim()
    .toLowerCase();
  if (eventName !== "repository_dispatch") return;

  const triggerHashRaw = (process.env.TRIGGER_STAGE6_HASH || "").trim();
  const triggerFile = (process.env.TRIGGER_STAGE6_FILE || "").trim();
  const triggerSourceRun = (process.env.TRIGGER_STAGE6_SOURCE_RUN || "").trim();

  const fail = (reason: string): never => {
    console.error(`[TRIGGER_VALIDATE] fail ${reason}`);
    throw new Error(`[TRIGGER_VALIDATE] ${reason}`);
  };

  if (!triggerHashRaw) {
    fail("missing TRIGGER_STAGE6_HASH for repository_dispatch event");
  }
  if (!isSha256Hex(triggerHashRaw)) {
    fail(`invalid TRIGGER_STAGE6_HASH format (expected=64-hex gotLength=${triggerHashRaw.length})`);
  }

  const expectedHash = triggerHashRaw.toLowerCase();
  const actualHash = stage6.sha256.toLowerCase();
  if (expectedHash !== actualHash) {
    fail(
      `stage6 hash mismatch expected=${expectedHash.slice(0, 12)}(len=${expectedHash.length}) actual=${actualHash.slice(0, 12)}(len=${actualHash.length})`
    );
  }

  if (triggerFile && triggerFile !== stage6.fileName) {
    fail(`stage6 file mismatch expected=${triggerFile} actual=${stage6.fileName}`);
  }

  console.log(
    `[TRIGGER_VALIDATE] ok hash=${actualHash.slice(0, 12)} file=${stage6.fileName} sourceRun=${triggerSourceRun || "N/A"}`
  );
}

function getActionableCandidates(
  candidates: Stage6CandidateSummary[],
  actionableVerdicts: Set<string>
): Stage6CandidateSummary[] {
  return candidates.filter(
    (row) =>
      actionableVerdicts.has(row.verdict) &&
      (row.finalDecision === "EXECUTABLE_NOW" || row.executionBucket === "EXECUTABLE")
  );
}

type HfSoftGatePolicy = {
  enabled: boolean;
  scoreFloor: number;
  minArticleCount: number;
  maxNewsAgeHours: number;
  positiveReliefMax: number;
  negativeTightenMax: number;
};

type HfSoftGateAdjustment = {
  applied: boolean;
  delta: number;
  mode: "none" | "relief" | "tighten";
};

function computeHfSoftGateAdjustment(
  row: Stage6CandidateSummary,
  policy: HfSoftGatePolicy
): HfSoftGateAdjustment {
  if (!policy.enabled) return { applied: false, delta: 0, mode: "none" };
  if (row.hfSentimentStatus !== "OK") return { applied: false, delta: 0, mode: "none" };
  const label = row.hfSentimentLabel;
  if (label !== "positive" && label !== "negative") return { applied: false, delta: 0, mode: "none" };
  const score = row.hfSentimentScore;
  if (score == null || !Number.isFinite(score) || score < policy.scoreFloor) {
    return { applied: false, delta: 0, mode: "none" };
  }
  const articleCount = row.hfSentimentArticleCount;
  if (articleCount == null || articleCount < policy.minArticleCount) {
    return { applied: false, delta: 0, mode: "none" };
  }
  const newestAgeHours = row.hfSentimentNewestAgeHours;
  if (newestAgeHours == null || newestAgeHours > policy.maxNewsAgeHours) {
    return { applied: false, delta: 0, mode: "none" };
  }
  const confidenceScale = Math.max(1 - policy.scoreFloor, 0.0001);
  const confidence = clamp((score - policy.scoreFloor) / confidenceScale, 0, 1);
  if (label === "positive") {
    const rawRelief = policy.positiveReliefMax * confidence;
    const delta = Number((-rawRelief).toFixed(2));
    return Math.abs(delta) > 0 ? { applied: true, delta, mode: "relief" } : { applied: false, delta: 0, mode: "none" };
  }
  const rawTighten = policy.negativeTightenMax * confidence;
  const delta = Number(rawTighten.toFixed(2));
  return delta > 0 ? { applied: true, delta, mode: "tighten" } : { applied: false, delta: 0, mode: "none" };
}

function buildDryExecPayloads(
  actionable: Stage6CandidateSummary[],
  stage6Hash: string,
  regime: RegimeSelection
): DryExecBuildResult {
  const runtimeCfg = loadRuntimeConfig();
  const lifecycle = runtimeCfg.positionLifecycle;
  const actionIntentCounts = createEmptyActionIntentCounts();
  const notionalPerOrder = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_NOTIONAL_PER_TRADE",
    "DRY_RISK_OFF_NOTIONAL_PER_TRADE",
    "DRY_NOTIONAL_PER_TRADE",
    1000
  );
  const maxOrders = readProfilePositiveInt(
    regime.profile,
    "DRY_DEFAULT_MAX_ORDERS",
    "DRY_RISK_OFF_MAX_ORDERS",
    "DRY_MAX_ORDERS",
    3
  );
  const maxTotalNotional = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MAX_TOTAL_NOTIONAL",
    "DRY_RISK_OFF_MAX_TOTAL_NOTIONAL",
    "DRY_MAX_TOTAL_NOTIONAL",
    notionalPerOrder * maxOrders
  );
  const baseMinConviction = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MIN_CONVICTION",
    "DRY_RISK_OFF_MIN_CONVICTION",
    "DRY_MIN_CONVICTION",
    70
  );
  const minConvictionFloorRaw = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MIN_CONVICTION_FLOOR",
    "DRY_RISK_OFF_MIN_CONVICTION_FLOOR",
    "DRY_MIN_CONVICTION_FLOOR",
    regime.profile === "risk_off" ? 58 : 55
  );
  const minConvictionCeilingRaw = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MIN_CONVICTION_CEILING",
    "DRY_RISK_OFF_MIN_CONVICTION_CEILING",
    "DRY_MIN_CONVICTION_CEILING",
    90
  );
  const minConvictionFloor = Math.min(minConvictionFloorRaw, minConvictionCeilingRaw - 0.1);
  const minConvictionCeiling =
    minConvictionCeilingRaw > minConvictionFloor
      ? minConvictionCeilingRaw
      : minConvictionFloor + 0.1;
  const convictionSamples = actionable
    .map((row) => parseConviction(row.conviction))
    .filter((value): value is number => value != null);
  const sampleQuantileQ = regime.profile === "risk_off" ? 0.35 : 0.25;
  const sampleQuantileValue = percentile(convictionSamples, sampleQuantileQ);
  const sampleCap = sampleQuantileValue == null ? null : sampleQuantileValue + (regime.profile === "risk_off" ? 6 : 8);
  const vixRef = regime.vix ?? regime.snapshotVix;
  const marketTighten =
    vixRef == null
      ? 0
      : regime.profile === "risk_off"
        ? clamp((vixRef - 24) / 2, 0, 3)
        : clamp((vixRef - 20) / 4, 0, 2);
  const qualityRelief = clamp((regime.quality.score - 70) / 5, 0, 3);
  let adaptiveMinConviction = baseMinConviction + marketTighten - qualityRelief;
  if (sampleCap != null) adaptiveMinConviction = Math.min(adaptiveMinConviction, sampleCap);
  const minConviction = Number(clamp(adaptiveMinConviction, minConvictionFloor, minConvictionCeiling).toFixed(1));
  const minConvictionPolicy = {
    base: Number(baseMinConviction.toFixed(1)),
    applied: minConviction,
    floor: Number(minConvictionFloor.toFixed(1)),
    ceiling: Number(minConvictionCeiling.toFixed(1)),
    marketTighten: Number(marketTighten.toFixed(2)),
    qualityRelief: Number(qualityRelief.toFixed(2)),
    sampleCount: convictionSamples.length,
    sampleQuantileQ,
    sampleQuantileValue: sampleQuantileValue != null ? Number(sampleQuantileValue.toFixed(2)) : null,
    sampleCap: sampleCap != null ? Number(sampleCap.toFixed(2)) : null
  };
  const hfSoftGatePolicy: HfSoftGatePolicy = {
    enabled: readBoolEnv("HF_SENTIMENT_SOFT_GATE_ENABLED", false),
    scoreFloor: clamp(readNonNegativeNumberEnv("HF_SENTIMENT_SCORE_FLOOR", 0.55), 0.5, 0.95),
    minArticleCount: Math.max(0, Math.round(readNonNegativeNumberEnv("HF_SENTIMENT_MIN_ARTICLE_COUNT", 2))),
    maxNewsAgeHours: clamp(readNonNegativeNumberEnv("HF_SENTIMENT_MAX_NEWS_AGE_HOURS", 24), 1, 240),
    positiveReliefMax: clamp(readNonNegativeNumberEnv("HF_SENTIMENT_POSITIVE_RELIEF_MAX", 1.0), 0, 3),
    negativeTightenMax: clamp(readNonNegativeNumberEnv("HF_SENTIMENT_NEGATIVE_TIGHTEN_MAX", 2.0), 0, 4)
  };
  let hfSoftApplied = 0;
  let hfSoftReliefCount = 0;
  let hfSoftTightenCount = 0;
  let hfSoftBlockedNegative = 0;
  let hfSoftNetConvictionDelta = 0;
  const configuredMinStopDistancePct = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MIN_STOP_DISTANCE_PCT",
    "DRY_RISK_OFF_MIN_STOP_DISTANCE_PCT",
    "DRY_MIN_STOP_DISTANCE_PCT",
    2
  );
  const configuredMaxStopDistancePctRaw = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MAX_STOP_DISTANCE_PCT",
    "DRY_RISK_OFF_MAX_STOP_DISTANCE_PCT",
    "DRY_MAX_STOP_DISTANCE_PCT",
    25
  );
  const configuredMaxStopDistancePct =
    configuredMaxStopDistancePctRaw > configuredMinStopDistancePct
      ? configuredMaxStopDistancePctRaw
      : configuredMinStopDistancePct + 0.1;
  const stage6MinStopDistancePct = readPositiveNumberEnv("VITE_STAGE6_MIN_STOP_DISTANCE_PCT", 1.5);
  const stage6MaxStopDistancePctRaw = readPositiveNumberEnv("VITE_STAGE6_MAX_STOP_DISTANCE_PCT", 22);
  const stage6MaxStopDistancePct =
    stage6MaxStopDistancePctRaw > stage6MinStopDistancePct
      ? stage6MaxStopDistancePctRaw
      : stage6MinStopDistancePct + 0.1;
  const syncStopDistanceWithStage6 = readBoolEnv("DRY_STOP_DISTANCE_STAGE6_SYNC", true);
  let minStopDistancePct = configuredMinStopDistancePct;
  let maxStopDistancePct = configuredMaxStopDistancePct;
  let stopDistancePolicyStrategy: "stage6_locked" | "stage6_fallback" | "configured" = "configured";
  if (syncStopDistanceWithStage6) {
    minStopDistancePct = stage6MinStopDistancePct;
    maxStopDistancePct = stage6MaxStopDistancePct;
    stopDistancePolicyStrategy = "stage6_locked";
  }
  const entryFeasibilityEnforce = readBoolEnv("ENTRY_FEASIBILITY_ENFORCE", false);
  const entryMaxDistancePct = Math.max(0, readNonNegativeNumberEnv("ENTRY_MAX_DISTANCE_PCT", 15));
  const stage6ExecutionBucketEnforce = readBoolEnv("STAGE6_EXECUTION_BUCKET_ENFORCE", true);
  const payloads: DryExecOrderPayload[] = [];
  const skipped: DryExecSkipReason[] = [];
  let allocatedNotional = 0;
  let entryFeasibilityChecked = 0;
  let entryFeasibilityBlocked = 0;
  let stage6ContractChecked = 0;
  let stage6ContractExecutable = 0;
  let stage6ContractWatchlist = 0;
  let stage6ContractBlocked = 0;

  const pushSkip = (
    symbol: string,
    reason: string,
    actionType?: LifecycleActionType,
    actionReason?: string
  ) => {
    const row: DryExecSkipReason = { symbol, reason };
    if (lifecycle.enabled && actionType && isActionTypeAllowed(actionType, lifecycle)) {
      actionIntentCounts[actionType] += 1;
      row.actionType = actionType;
      row.actionReason = actionReason || reason;
    }
    skipped.push(row);
  };

  actionable.forEach((row) => {
    const hasBucketSignal =
      !isMissingContractToken(row.executionBucket) || !isMissingContractToken(row.executionReason);
    const hasDecisionSignal =
      !isMissingContractToken(row.finalDecision) || !isMissingContractToken(row.decisionReason);
    const effectiveExecutable =
      row.executionBucket === "EXECUTABLE" || row.finalDecision === "EXECUTABLE_NOW";
    const effectiveWatchlist =
      row.executionBucket === "WATCHLIST" ||
      row.finalDecision === "WAIT_PRICE" ||
      row.finalDecision === "BLOCKED_RISK" ||
      row.finalDecision === "BLOCKED_EVENT";

    if (hasBucketSignal || hasDecisionSignal) {
      stage6ContractChecked += 1;
      if (effectiveExecutable) stage6ContractExecutable += 1;
      if (effectiveWatchlist) stage6ContractWatchlist += 1;
    }

    const isExplicitlyNonCommon = row.instrumentType !== "unknown" && row.instrumentType !== "common";
    const isInstrumentIneligible = row.analysisEligible === false || isExplicitlyNonCommon;
    if (isInstrumentIneligible) {
      pushSkip(row.symbol, "instrument_type_ineligible");
      stage6ContractBlocked += 1;
      return;
    }
    const isLifecycleIneligible =
      row.symbolLifecycleState === "STALE" ||
      row.symbolLifecycleState === "RETIRED" ||
      row.symbolLifecycleState === "EXCLUDED";
    if (isLifecycleIneligible) {
      pushSkip(row.symbol, "symbol_state_ineligible");
      stage6ContractBlocked += 1;
      return;
    }

    if (stage6ExecutionBucketEnforce && effectiveWatchlist) {
      pushSkip(
        row.symbol,
        row.decisionReason && !isMissingContractToken(row.decisionReason)
          ? mapStage6DecisionReasonToSkip(row.decisionReason)
          : mapStage6ExecutionReasonToSkip(row.executionReason),
        "HOLD_WAIT",
        "watchlist_or_blocked"
      );
      stage6ContractBlocked += 1;
      return;
    }

    if (
      stage6ExecutionBucketEnforce &&
      effectiveExecutable &&
      !isMissingContractToken(row.executionReason) &&
      row.executionReason !== "VALID_EXEC"
    ) {
      pushSkip(
        row.symbol,
        mapStage6ExecutionReasonToSkip(row.executionReason),
        "HOLD_WAIT",
        "stage6_execution_reason_blocked"
      );
      stage6ContractBlocked += 1;
      return;
    }

    // Quality gate first: keep skip reasons deterministic and diagnosis-friendly.
    const conviction = parseConviction(row.conviction);
    const hfAdjustment = computeHfSoftGateAdjustment(row, hfSoftGatePolicy);
    const convictionFloorWithHf = Number(
      clamp(minConviction + hfAdjustment.delta, minConvictionFloor, minConvictionCeiling).toFixed(1)
    );
    if (hfAdjustment.applied) {
      hfSoftApplied += 1;
      hfSoftNetConvictionDelta = Number((hfSoftNetConvictionDelta + hfAdjustment.delta).toFixed(2));
      if (hfAdjustment.mode === "relief") hfSoftReliefCount += 1;
      if (hfAdjustment.mode === "tighten") hfSoftTightenCount += 1;
    }
    if (conviction == null || conviction < convictionFloorWithHf) {
      const skipReason =
        hfAdjustment.mode === "tighten" ? "conviction_below_floor_hf_negative" : "conviction_below_floor";
      if (hfAdjustment.mode === "tighten") hfSoftBlockedNegative += 1;
      pushSkip(row.symbol, skipReason, "HOLD_WAIT", "conviction_gate_not_passed");
      return;
    }

    const entry = row.entryValue ?? parseNumericPrice(row.entry);
    const target = row.targetValue ?? parseNumericPrice(row.target);
    const stop = row.stopValue ?? parseNumericPrice(row.stop);

    if (!entry || !target || !stop) {
      pushSkip(row.symbol, "missing_or_invalid_price");
      return;
    }
    if (!(target > entry && stop < entry)) {
      pushSkip(row.symbol, "invalid_price_geometry");
      return;
    }
    const stopDistancePct = ((entry - stop) / entry) * 100;
    if (stopDistancePct < minStopDistancePct || stopDistancePct > maxStopDistancePct) {
      pushSkip(row.symbol, "stop_distance_out_of_range");
      return;
    }
    if (entryFeasibilityEnforce) {
      entryFeasibilityChecked += 1;
      if (row.tradePlanStatus === "INVALID_DATA") {
        pushSkip(row.symbol, "entry_data_missing", "HOLD_WAIT", "entry_data_not_ready");
        entryFeasibilityBlocked += 1;
        return;
      }
      if (row.tradePlanStatus === "INVALID_GEOMETRY") {
        pushSkip(row.symbol, "entry_invalid_geometry", "HOLD_WAIT", "entry_geometry_not_ready");
        entryFeasibilityBlocked += 1;
        return;
      }
      if (row.entryFeasible === false) {
        const reason = row.tradePlanStatus === "WAIT_PULLBACK_TOO_DEEP" ? "entry_too_far_from_market" : "entry_feasibility_false";
        pushSkip(row.symbol, reason, "HOLD_WAIT", "entry_feasibility_not_ready");
        entryFeasibilityBlocked += 1;
        return;
      }
      if (row.entryDistancePct != null && row.entryDistancePct > entryMaxDistancePct) {
        pushSkip(row.symbol, "entry_too_far_from_market", "HOLD_WAIT", "entry_distance_over_limit");
        entryFeasibilityBlocked += 1;
        return;
      }
    }

    // Capacity / exposure gate after quality checks.
    if (payloads.length >= maxOrders) {
      pushSkip(row.symbol, "max_orders_reached");
      return;
    }
    if (allocatedNotional + notionalPerOrder > maxTotalNotional) {
      pushSkip(row.symbol, "max_total_notional_reached");
      return;
    }

    const actionType =
      lifecycle.enabled && isActionTypeAllowed("ENTRY_NEW", lifecycle) ? "ENTRY_NEW" : undefined;

    const candidatePayload: DryExecOrderPayload = {
      symbol: row.symbol,
      side: "buy",
      type: "limit",
      time_in_force: "day",
      order_class: "bracket",
      limit_price: entry,
      notional: notionalPerOrder,
      take_profit: { limit_price: target },
      stop_loss: { stop_price: stop },
      client_order_id: `dry_${stage6Hash.slice(0, 8)}_${row.symbol.toLowerCase()}`,
      idempotencyKey: buildOrderIdempotencyKey(stage6Hash, row.symbol, "buy"),
      actionType,
      actionReason: actionType ? "stage6_executable_now" : undefined
    };
    const normalized = validateAndNormalizePayload(candidatePayload);
    if (!normalized.ok) {
      pushSkip(row.symbol, normalized.reason);
      return;
    }
    payloads.push(normalized.payload);
    if (actionType) {
      actionIntentCounts[actionType] += 1;
    }
    allocatedNotional += notionalPerOrder;
  });

  return {
    payloads,
    skipped,
    skipReasonCounts: buildSkipReasonCounts(skipped),
    actionIntent: {
      enabled: lifecycle.enabled,
      previewOnly: lifecycle.previewOnly,
      allowedActionTypes: [...lifecycle.allowedActionTypes],
      counts: actionIntentCounts
    },
    notionalPerOrder,
    maxOrders,
    maxTotalNotional,
    minConviction,
    minConvictionPolicy,
    hfSentimentGate: {
      enabled: hfSoftGatePolicy.enabled,
      scoreFloor: Number(hfSoftGatePolicy.scoreFloor.toFixed(2)),
      minArticleCount: hfSoftGatePolicy.minArticleCount,
      maxNewsAgeHours: Number(hfSoftGatePolicy.maxNewsAgeHours.toFixed(1)),
      positiveReliefMax: Number(hfSoftGatePolicy.positiveReliefMax.toFixed(2)),
      negativeTightenMax: Number(hfSoftGatePolicy.negativeTightenMax.toFixed(2)),
      applied: hfSoftApplied,
      reliefCount: hfSoftReliefCount,
      tightenCount: hfSoftTightenCount,
      blockedNegative: hfSoftBlockedNegative,
      netMinConvictionDelta: Number(hfSoftNetConvictionDelta.toFixed(2))
    },
    minStopDistancePct,
    maxStopDistancePct,
    stopDistancePolicy: {
      syncWithStage6: syncStopDistanceWithStage6,
      configuredMinPct: configuredMinStopDistancePct,
      configuredMaxPct: configuredMaxStopDistancePct,
      stage6MinPct: stage6MinStopDistancePct,
      stage6MaxPct: stage6MaxStopDistancePct,
      appliedMinPct: minStopDistancePct,
      appliedMaxPct: maxStopDistancePct,
      strategy: stopDistancePolicyStrategy
    },
    entryFeasibility: {
      enforce: entryFeasibilityEnforce,
      maxDistancePct: entryMaxDistancePct,
      checked: entryFeasibilityChecked,
      blocked: entryFeasibilityBlocked
    },
    stage6Contract: {
      enforce: stage6ExecutionBucketEnforce,
      checked: stage6ContractChecked,
      executable: stage6ContractExecutable,
      watchlist: stage6ContractWatchlist,
      blocked: stage6ContractBlocked
    },
    regime,
    idempotency: {
      enabled: false,
      enforced: false,
      ttlDays: 0,
      newCount: 0,
      duplicateCount: 0
    }
  };
}

async function fetchAlpacaJson(path: string): Promise<unknown> {
  const baseUrl = (process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "");
  const keyId = (process.env.ALPACA_KEY_ID || "").trim();
  const secret = (process.env.ALPACA_SECRET_KEY || "").trim();

  if (!baseUrl) throw new Error("ALPACA_BASE_URL missing");
  if (!keyId || !secret) throw new Error("ALPACA_KEY_ID/ALPACA_SECRET_KEY missing");

  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "APCA-API-KEY-ID": keyId,
      "APCA-API-SECRET-KEY": secret
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`alpaca ${path} failed (${response.status}): ${text.slice(0, 160)}`);
  }
  return response.json();
}

async function runPreflightGate(dryExec: DryExecBuildResult): Promise<PreflightResult> {
  const cfg = loadRuntimeConfig();
  const enabled = readBoolEnv("PREFLIGHT_ENABLED", true);
  const simulatedLiveParity = cfg.simulationLiveParity && !cfg.execEnabled;
  const enforced = enabled && (cfg.execEnabled || simulatedLiveParity);
  const allowEntryOutsideRth = readBoolEnv("ALLOW_ENTRY_OUTSIDE_RTH", false);
  const dailyMaxNotional = readNonNegativeNumberEnv("DAILY_MAX_NOTIONAL", 5000);
  const requiredNotional = roundToCent(sumNotional(dryExec.payloads));

  const makeResult = (
    status: PreflightStatus,
    code: string,
    message: string,
    patch?: Partial<PreflightResult>
  ): PreflightResult => ({
    enabled,
    enforced,
    blocking: status === "fail" && enforced,
    wouldBlockLive: status === "fail",
    simulatedLiveParity,
    status,
    code,
    message,
    requiredNotional,
    dailyMaxNotional,
    allowEntryOutsideRth,
    accountStatus: null,
    buyingPower: null,
    marketOpen: null,
    nextOpen: null,
    ...(patch || {})
  });

  const failOrWarn = (
    code: string,
    message: string,
    patch?: Partial<PreflightResult>
  ): PreflightResult => makeResult(enforced ? "fail" : "warn", code, message, {
    ...patch,
    wouldBlockLive: true
  });

  if (!enabled) {
    return makeResult("skip", "PREFLIGHT_DISABLED", "preflight disabled by env");
  }

  if (requiredNotional <= 0) {
    return makeResult("skip", "PREFLIGHT_NO_PAYLOAD", "no payload to preflight");
  }

  if (dailyMaxNotional > 0 && requiredNotional > dailyMaxNotional) {
    return failOrWarn(
      "PREFLIGHT_DAILY_NOTIONAL_LIMIT",
      `required notional ${requiredNotional.toFixed(2)} exceeds daily max ${dailyMaxNotional.toFixed(2)}`
    );
  }

  let account: Record<string, unknown>;
  try {
    account = (await fetchAlpacaJson("/v2/account")) as Record<string, unknown>;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return failOrWarn("PREFLIGHT_ACCOUNT_FETCH_FAILED", msg);
  }

  const accountStatusRaw = String(account.status ?? "").trim();
  const accountStatus = accountStatusRaw ? accountStatusRaw.toUpperCase() : "UNKNOWN";
  const isTradingBlocked = account.trading_blocked === true || account.account_blocked === true;
  const isSuspended = account.trade_suspended_by_user === true || account.trading_suspended_by_user === true;
  const isStatusBlocked = accountStatus !== "ACTIVE";

  if (isTradingBlocked || isSuspended || isStatusBlocked) {
    return failOrWarn("PREFLIGHT_ACCOUNT_BLOCKED", `account not tradable (status=${accountStatus})`, {
      accountStatus
    });
  }

  const buyingPower = toFinitePositiveNumber(account.buying_power);
  if (buyingPower == null) {
    return failOrWarn("PREFLIGHT_BUYING_POWER_MISSING", "buying_power unavailable", {
      accountStatus
    });
  }
  if (requiredNotional > buyingPower) {
    return failOrWarn(
      "PREFLIGHT_BUYING_POWER_SHORT",
      `required ${requiredNotional.toFixed(2)} exceeds buying power ${buyingPower.toFixed(2)}`,
      { accountStatus, buyingPower }
    );
  }

  if (!allowEntryOutsideRth) {
    let clock: Record<string, unknown>;
    try {
      clock = (await fetchAlpacaJson("/v2/clock")) as Record<string, unknown>;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return failOrWarn("PREFLIGHT_CLOCK_FETCH_FAILED", msg, { accountStatus, buyingPower });
    }

    const marketOpen = clock.is_open === true;
    const nextOpen = typeof clock.next_open === "string" ? clock.next_open : null;

    if (!marketOpen) {
      return failOrWarn("PREFLIGHT_MARKET_CLOSED", "market is closed for new entry", {
        accountStatus,
        buyingPower,
        marketOpen,
        nextOpen
      });
    }

    return makeResult("pass", "PREFLIGHT_PASS", "preflight passed", {
      accountStatus,
      buyingPower,
      marketOpen,
      nextOpen
    });
  }

  return makeResult("pass", "PREFLIGHT_PASS", "preflight passed (RTH guard disabled)", {
    accountStatus,
    buyingPower,
    marketOpen: null,
    nextOpen: null
  });
}

function buildSimulationMessage(
  result: Stage6LoadResult,
  actionable: Stage6CandidateSummary[],
  actionableVerdicts: Set<string>,
  dryExec: DryExecBuildResult,
  preflight: PreflightResult,
  ledger: OrderLedgerUpdateResult,
  guardControl: GuardControlGate
): string {
  const cfg = loadRuntimeConfig();
  const formatTierMeta = (row: Stage6CandidateSummary) => {
    const tier = row.stage6Tier && row.stage6Tier !== "N/A" ? row.stage6Tier : "NONE";
    const disp = row.displacement != null ? row.displacement.toFixed(1) : "-";
    const pos = row.ictPos != null ? row.ictPos.toFixed(3) : "-";
    return `Tier ${tier} | Disp ${disp} | ictPos ${pos}`;
  };
  const lines: string[] = [];
  lines.push("🧪 Sidecar Dry-Run Report");
  lines.push(`Stage6: ${result.fileName}`);
  lines.push(`Hash: ${result.sha256.slice(0, 12)} | MD5: ${result.md5Checksum}`);
  lines.push(`Candidates: ${result.candidateSymbols.length}`);
  lines.push(
    `Policy Gate: raw ${result.candidates.length} -> actionable ${actionable.length} (${formatActionableVerdicts(actionableVerdicts)} only)`
  );
  if (result.contractContext) {
    lines.push(
      `Contract Source: modelTop6=${result.contractContext.modelTop6.length} executablePicks=${result.contractContext.executablePicks.length} watchlistTop=${result.contractContext.watchlistTop.length}`
    );
  }
  lines.push("");

  if (result.modelTopCandidates.length === 0) {
    lines.push("Top6 summary: N/A");
  } else {
    lines.push("Top6 Summary");
    result.modelTopCandidates.forEach((row, index) => {
      lines.push(
        `${index + 1}) ${row.symbol} | ${row.verdict} | ER ${row.expectedReturn} | Conv ${row.conviction} | M#${row.modelRank ?? "-"} E#${row.executionRank ?? "-"} XS#${row.executionScore ?? "-"} | ${formatTierMeta(row)} | ${row.executionBucket}/${row.executionReason} | D=${row.finalDecision}/${row.decisionReason} | ${row.entry}→${row.target} / ${row.stop}`
      );
    });
  }

  lines.push("");
  lines.push("Actionable Candidates");
  if (actionable.length === 0) {
    lines.push("N/A (all filtered by policy gate)");
  } else {
    actionable.forEach((row, index) => {
      lines.push(
        `${index + 1}) ${row.symbol} | ${row.verdict} | XS#${row.executionScore ?? "-"} | ${formatTierMeta(row)} | ${row.executionBucket}/${row.executionReason} | D=${row.finalDecision}/${row.decisionReason} | ${row.entry}→${row.target} / ${row.stop}`
      );
    });
  }

  lines.push("");
  lines.push("Dry-Exec Payload Preview");
  lines.push(
    `Regime: ${dryExec.regime.profile.toUpperCase()} (base=${dryExec.regime.baseProfile.toUpperCase()}) | source=${dryExec.regime.source} | vix=${dryExec.regime.vix?.toFixed(2) ?? "N/A"} | on<=${dryExec.regime.riskOnThreshold} off>=${dryExec.regime.riskOffThreshold}`
  );
  lines.push(
    `Regime Guard: quality=${dryExec.regime.quality.status.toUpperCase()}(${dryExec.regime.quality.score}/${dryExec.regime.quality.minScore}) forceRiskOff=${dryExec.regime.quality.forceRiskOff} | hysteresis=${dryExec.regime.hysteresis.reason} holdRemain=${dryExec.regime.hysteresis.holdRemainingMin}m | entryBlocked=${dryExec.regime.entryGuard.blocked}`
  );
  if (dryExec.regime.entryGuard.blocked) {
    lines.push(`Entry Guard Reason: ${dryExec.regime.entryGuard.reason}`);
  }
  lines.push(
    `Guard Control: enforce=${guardControl.enforce} blocked=${guardControl.blocked} wouldBlockLive=${guardControl.wouldBlockLive} level=${guardControl.level != null ? `L${guardControl.level}` : "N/A"} stale=${guardControl.stale} age=${guardControl.ageMin != null ? `${guardControl.ageMin.toFixed(1)}m` : "N/A"} maxAge=${guardControl.maxAgeMin}m reason=${guardControl.reason} updatedAt=${guardControl.updatedAt ?? "N/A"}`
  );
  lines.push(
    `Gate: Conv>=${dryExec.minConviction} (base=${dryExec.minConvictionPolicy.base}, vix+${dryExec.minConvictionPolicy.marketTighten}, quality-${dryExec.minConvictionPolicy.qualityRelief}, sampleCap=${dryExec.minConvictionPolicy.sampleCap ?? "N/A"}) | StopDist ${dryExec.minStopDistancePct}%~${dryExec.maxStopDistancePct}%`
  );
  lines.push(
    `HF Soft Gate: enabled=${dryExec.hfSentimentGate.enabled} scoreFloor=${dryExec.hfSentimentGate.scoreFloor} minArticles=${dryExec.hfSentimentGate.minArticleCount} maxNewsAgeH=${dryExec.hfSentimentGate.maxNewsAgeHours} reliefMax=${dryExec.hfSentimentGate.positiveReliefMax} tightenMax=${dryExec.hfSentimentGate.negativeTightenMax} applied=${dryExec.hfSentimentGate.applied} relief=${dryExec.hfSentimentGate.reliefCount} tighten=${dryExec.hfSentimentGate.tightenCount} blockedNegative=${dryExec.hfSentimentGate.blockedNegative} netConvDelta=${dryExec.hfSentimentGate.netMinConvictionDelta}`
  );
  lines.push(
    `StopDist Policy: syncStage6=${dryExec.stopDistancePolicy.syncWithStage6} strategy=${dryExec.stopDistancePolicy.strategy} configured=${dryExec.stopDistancePolicy.configuredMinPct}%~${dryExec.stopDistancePolicy.configuredMaxPct}% stage6=${dryExec.stopDistancePolicy.stage6MinPct}%~${dryExec.stopDistancePolicy.stage6MaxPct}% applied=${dryExec.stopDistancePolicy.appliedMinPct}%~${dryExec.stopDistancePolicy.appliedMaxPct}%`
  );
  lines.push(
    `Entry Feasibility Gate: enforce=${dryExec.entryFeasibility.enforce} maxDistancePct=${dryExec.entryFeasibility.maxDistancePct} checked=${dryExec.entryFeasibility.checked} blocked=${dryExec.entryFeasibility.blocked}`
  );
  lines.push(
    `Stage6 Contract Gate: enforce=${dryExec.stage6Contract.enforce} checked=${dryExec.stage6Contract.checked} executable=${dryExec.stage6Contract.executable} watchlist=${dryExec.stage6Contract.watchlist} blocked=${dryExec.stage6Contract.blocked}`
  );
  lines.push(
    `Action Intent: enabled=${dryExec.actionIntent.enabled} previewOnly=${dryExec.actionIntent.previewOnly} allowed=${dryExec.actionIntent.allowedActionTypes.join("/")} counts=ENTRY_NEW:${dryExec.actionIntent.counts.ENTRY_NEW},HOLD_WAIT:${dryExec.actionIntent.counts.HOLD_WAIT},SCALE_UP:${dryExec.actionIntent.counts.SCALE_UP},SCALE_DOWN:${dryExec.actionIntent.counts.SCALE_DOWN},EXIT_PARTIAL:${dryExec.actionIntent.counts.EXIT_PARTIAL},EXIT_FULL:${dryExec.actionIntent.counts.EXIT_FULL}`
  );
  lines.push("Payload Validation: price/notional finite check + geometry + client_order_id format");
  lines.push(
    `Orders: ${dryExec.payloads.length} | Notional/Order: $${dryExec.notionalPerOrder.toFixed(2)} | MaxOrders: ${dryExec.maxOrders} | MaxTotalNotional: $${dryExec.maxTotalNotional.toFixed(2)}`
  );
  if (dryExec.payloads.length === 0) {
    lines.push("N/A (no payload generated)");
  } else {
    dryExec.payloads.forEach((order, index) => {
      lines.push(
        `${index + 1}) ${order.symbol} | A=${order.actionType ?? "N/A"} | LIMIT ${order.limit_price} | TP ${order.take_profit.limit_price} | SL ${order.stop_loss.stop_price} | Notional $${order.notional.toFixed(2)}`
      );
    });
  }
  if (dryExec.skipped.length > 0) {
    const skippedLog = dryExec.skipped
      .map((s) => `${s.symbol}:${s.reason}${s.actionType ? `(${s.actionType})` : ""}`)
      .join(", ");
    lines.push(`Skipped: ${skippedLog}`);
  }
  lines.push(
    `Order Idempotency: enabled=${dryExec.idempotency.enabled} enforce=${dryExec.idempotency.enforced} ttlDays=${dryExec.idempotency.ttlDays} new=${dryExec.idempotency.newCount} duplicate=${dryExec.idempotency.duplicateCount}`
  );
  lines.push(
    `Order Lifecycle: enabled=${ledger.enabled} target=${ledger.targetStatus} upserted=${ledger.upserted} transitioned=${ledger.transitioned} unchanged=${ledger.unchanged} pruned=${ledger.pruned}`
  );
  lines.push("");
  lines.push("Preflight Gate");
  lines.push(
    `Status: ${preflight.status.toUpperCase()} | code=${preflight.code} | enforced=${preflight.enforced} | blocking=${preflight.blocking} | wouldBlockLive=${preflight.wouldBlockLive} | liveParity=${preflight.simulatedLiveParity}`
  );
  lines.push(`Message: ${preflight.message}`);
  lines.push(
    `Required: $${preflight.requiredNotional.toFixed(2)} | DailyMax: $${preflight.dailyMaxNotional.toFixed(2)} | BuyingPower: ${preflight.buyingPower != null ? `$${preflight.buyingPower.toFixed(2)}` : "N/A"}`
  );
  lines.push(
    `RTH Guard: ${!preflight.allowEntryOutsideRth} | MarketOpen: ${preflight.marketOpen == null ? "N/A" : preflight.marketOpen} | NextOpen: ${preflight.nextOpen ?? "N/A"}`
  );
  lines.push(`Account: ${preflight.accountStatus ?? "N/A"}`);

  lines.push("");
  lines.push(
    `Mode: READ_ONLY=${cfg.readOnly}, EXEC_ENABLED=${cfg.execEnabled}, SIMULATION_LIVE_PARITY=${cfg.simulationLiveParity}`
  );
  return lines.join("\n");
}

async function sendSimulationTelegram(
  result: Stage6LoadResult,
  actionable: Stage6CandidateSummary[],
  actionableVerdicts: Set<string>,
  dryExec: DryExecBuildResult,
  preflight: PreflightResult,
  ledger: OrderLedgerUpdateResult,
  guardControl: GuardControlGate
): Promise<void> {
  const token = process.env.TELEGRAM_TOKEN || "";
  const chatId = process.env.TELEGRAM_SIMULATION_CHAT_ID || "";
  const text = buildSimulationMessage(result, actionable, actionableVerdicts, dryExec, preflight, ledger, guardControl);

  await sendTelegramMessage(token, chatId, text, "TELEGRAM_SIM");
}

async function sendPerformanceLoopMilestoneAlert(
  perfLoop: PerformanceLoopUpdateResult
): Promise<void> {
  if (!perfLoop.alertMessage) return;
  const token = process.env.TELEGRAM_TOKEN || "";
  const chatId = process.env.TELEGRAM_SIMULATION_CHAT_ID || "";
  await sendTelegramMessage(token, chatId, perfLoop.alertMessage, "TELEGRAM_PERF_LOOP");
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

function splitTelegramText(text: string, maxLen: number): string[] {
  if (!text) return [""];
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  const flushCurrent = () => {
    if (!current) return;
    chunks.push(current);
    current = "";
  };

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxLen) {
      current = candidate;
      continue;
    }

    flushCurrent();

    if (line.length <= maxLen) {
      current = line;
      continue;
    }

    for (let idx = 0; idx < line.length; idx += maxLen) {
      chunks.push(line.slice(idx, idx + maxLen));
    }
  }

  flushCurrent();
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

async function sendTelegramMessage(token: string, chatId: string, text: string, tag: string): Promise<void> {
  const maxLen = Math.max(500, Math.floor(readPositiveNumberEnv("TELEGRAM_MAX_MESSAGE_LENGTH", 3900)));
  const chunks = splitTelegramText(text, maxLen);

  for (let idx = 0; idx < chunks.length; idx++) {
    const body = new URLSearchParams({
      chat_id: chatId,
      text: chunks[idx],
      disable_web_page_preview: "true"
    });

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(
        `Telegram send failed (${response.status}) chunk=${idx + 1}/${chunks.length}: ${raw.slice(0, 240)}`
      );
    }
  }
  console.log(`[${tag}] sent to ${mask(chatId)} chunks=${chunks.length}`);
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

async function saveRunState(
  result: Stage6LoadResult,
  mode: string,
  previous: SidecarRunState | null,
  consumedForceSendKey?: string
): Promise<void> {
  await mkdir("state", { recursive: true });
  const nextState: SidecarRunState = {
    lastStage6Sha256: result.sha256,
    lastStage6FileId: result.fileId,
    lastStage6FileName: result.fileName,
    lastMode: mode,
    lastSentAt: new Date().toISOString(),
    lastForceSendKey: consumedForceSendKey ?? previous?.lastForceSendKey ?? ""
  };
  await writeFile(STATE_PATH, JSON.stringify(nextState, null, 2), "utf8");
  console.log(`[STATE] saved ${STATE_PATH}`);
}

async function saveDryExecPreview(
  result: Stage6LoadResult,
  dryExec: DryExecBuildResult,
  preflight: PreflightResult,
  ledger: OrderLedgerUpdateResult,
  guardControl: GuardControlGate
): Promise<void> {
  const cfg = loadRuntimeConfig();
  await mkdir("state", { recursive: true });
  const preview = {
    stage6File: result.fileName,
    stage6FileId: result.fileId,
    stage6Hash: result.sha256,
    generatedAt: new Date().toISOString(),
    regime: dryExec.regime,
    notionalPerOrder: dryExec.notionalPerOrder,
    maxOrders: dryExec.maxOrders,
    maxTotalNotional: dryExec.maxTotalNotional,
    minConviction: dryExec.minConviction,
    minConvictionPolicy: dryExec.minConvictionPolicy,
    hfSentimentGate: dryExec.hfSentimentGate,
    minStopDistancePct: dryExec.minStopDistancePct,
    maxStopDistancePct: dryExec.maxStopDistancePct,
    stopDistancePolicy: dryExec.stopDistancePolicy,
    entryFeasibility: dryExec.entryFeasibility,
    stage6Contract: dryExec.stage6Contract,
    idempotency: dryExec.idempotency,
    orderLifecycle: ledger,
    preflight,
    guardControl,
    mode: {
      readOnly: cfg.readOnly,
      execEnabled: cfg.execEnabled,
      liveMode: !cfg.readOnly && cfg.execEnabled,
      simulationLiveParity: cfg.simulationLiveParity
    },
    payloadCount: dryExec.payloads.length,
    skippedCount: dryExec.skipped.length,
    skipReasonCounts: dryExec.skipReasonCounts,
    payloads: dryExec.payloads,
    skipped: dryExec.skipped
  };
  await writeFile(DRY_EXEC_PREVIEW_PATH, JSON.stringify(preview, null, 2), "utf8");
  console.log(`[DRY_EXEC] payloads=${dryExec.payloads.length} skipped=${dryExec.skipped.length}`);
  console.log(`[SKIP_REASONS] ${formatSkipReasonCounts(dryExec.skipReasonCounts)}`);
  console.log(
    `[STAGE6_CONTRACT] enforce=${dryExec.stage6Contract.enforce} checked=${dryExec.stage6Contract.checked} executable=${dryExec.stage6Contract.executable} watchlist=${dryExec.stage6Contract.watchlist} blocked=${dryExec.stage6Contract.blocked}`
  );
  console.log(
    `[CONV_POLICY] base=${dryExec.minConvictionPolicy.base} applied=${dryExec.minConvictionPolicy.applied} floor=${dryExec.minConvictionPolicy.floor} ceiling=${dryExec.minConvictionPolicy.ceiling} vix+${dryExec.minConvictionPolicy.marketTighten} quality-${dryExec.minConvictionPolicy.qualityRelief} sampleN=${dryExec.minConvictionPolicy.sampleCount} q${Math.round(dryExec.minConvictionPolicy.sampleQuantileQ * 100)}=${dryExec.minConvictionPolicy.sampleQuantileValue ?? "N/A"} cap=${dryExec.minConvictionPolicy.sampleCap ?? "N/A"}`
  );
  console.log(
    `[HF_SOFT_GATE] enabled=${dryExec.hfSentimentGate.enabled} floor=${dryExec.hfSentimentGate.scoreFloor} minArticles=${dryExec.hfSentimentGate.minArticleCount} maxNewsAgeH=${dryExec.hfSentimentGate.maxNewsAgeHours} reliefMax=${dryExec.hfSentimentGate.positiveReliefMax} tightenMax=${dryExec.hfSentimentGate.negativeTightenMax} applied=${dryExec.hfSentimentGate.applied} relief=${dryExec.hfSentimentGate.reliefCount} tighten=${dryExec.hfSentimentGate.tightenCount} blockedNegative=${dryExec.hfSentimentGate.blockedNegative} netConvDelta=${dryExec.hfSentimentGate.netMinConvictionDelta}`
  );
  console.log(`[STATE] saved ${DRY_EXEC_PREVIEW_PATH}`);
}

function makeDefaultBatchId(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `stage6-${yyyy}${mm}${dd}`;
}

function sanitizeBatchId(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 48);
}

function buildPerformancePolicyFingerprint(dryExec: DryExecBuildResult): string {
  return [
    `profile=${dryExec.regime.profile}`,
    `conv=${dryExec.minConviction}`,
    `convBase=${dryExec.minConvictionPolicy.base}`,
    `convQCap=${dryExec.minConvictionPolicy.sampleCap ?? "n/a"}`,
    `hfSoft=${dryExec.hfSentimentGate.enabled ? "on" : "off"}`,
    `hfSoftDelta=${dryExec.hfSentimentGate.netMinConvictionDelta}`,
    `stopMin=${dryExec.minStopDistancePct}`,
    `stopMax=${dryExec.maxStopDistancePct}`,
    `entryEnf=${dryExec.entryFeasibility.enforce}`,
    `entryMaxDist=${dryExec.entryFeasibility.maxDistancePct}`,
    `bucketEnf=${dryExec.stage6Contract.enforce}`
  ].join(";");
}

function csvCell(value: string | number | null): string {
  const raw = value == null ? "" : String(value);
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, "\"\"")}"`;
  return raw;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(4));
  }
  return Number(sorted[mid].toFixed(4));
}

function deriveTradeMetrics(row: PerformanceLoopRow): Pick<PerformanceLoopRow, "RMultiple" | "slipPct"> {
  const entryFilled = parseFiniteNumber(row.entryFilled);
  const entryPlanned = parseFiniteNumber(row.entryPlanned);
  const stopPlanned = parseFiniteNumber(row.stopPlanned);
  const exitPrice = parseFiniteNumber(row.exitPrice);

  let rMultiple: number | null = null;
  if (entryFilled != null && stopPlanned != null && exitPrice != null) {
    const risk = entryFilled - stopPlanned;
    if (risk > 0) {
      rMultiple = Number(((exitPrice - entryFilled) / risk).toFixed(4));
    }
  }

  let slipPct: number | null = null;
  if (entryFilled != null && entryPlanned != null && entryPlanned > 0) {
    slipPct = Number((Math.abs(entryFilled - entryPlanned) / entryPlanned * 100).toFixed(4));
  }

  return { RMultiple: rMultiple, slipPct };
}

function normalizeLoopRow(row: PerformanceLoopRow): PerformanceLoopRow {
  const derived = deriveTradeMetrics(row);
  return {
    ...row,
    RMultiple: derived.RMultiple,
    slipPct: derived.slipPct
  };
}

function buildPerformanceSnapshot(rows: PerformanceLoopRow[]): PerformanceLoopSnapshot {
  const tradeCount = rows.length;
  const filledCount = rows.filter((row) => parseFiniteNumber(row.entryFilled) != null).length;
  const closedRows = rows.filter((row) => parseFiniteNumber(row.exitPrice) != null);
  const closedCount = closedRows.length;

  const fillRatePct = tradeCount > 0 ? Number(((filledCount / tradeCount) * 100).toFixed(2)) : null;
  const rValues = closedRows
    .map((row) => parseFiniteNumber(row.RMultiple))
    .filter((value): value is number => value != null);
  const avgR =
    rValues.length > 0
      ? Number((rValues.reduce((acc, value) => acc + value, 0) / rValues.length).toFixed(4))
      : null;

  const holdErrors = closedRows
    .map((row) => {
      const planned = parseFiniteNumber(row.holdDaysPlanned);
      const actual = parseFiniteNumber(row.holdDaysActual);
      if (planned == null || actual == null) return null;
      return Math.abs(actual - planned);
    })
    .filter((value): value is number => value != null);
  const medianHoldErrorDays = median(holdErrors);

  // Optional marker for manual post-trade QA. Keep at 0 unless explicitly flagged in notes.
  const noReasonDrift = rows.filter((row) => row.notes.includes("[REASON_DRIFT]")).length;

  return {
    at: new Date().toISOString(),
    tradeCount,
    filledCount,
    closedCount,
    fillRatePct,
    avgR,
    medianHoldErrorDays,
    noReasonDrift
  };
}

function toPerformanceCsv(rows: PerformanceLoopRow[]): string {
  const header = [
    "runDate",
    "symbol",
    "modelRank",
    "execRank",
    "AQ",
    "XS",
    "decisionReason",
    "entryPlanned",
    "entryFilled",
    "stopPlanned",
    "targetPlanned",
    "exitPrice",
    "exitReason",
    "holdDaysPlanned",
    "holdDaysActual",
    "RMultiple",
    "slipPct",
    "marketRegime",
    "notes"
  ];

  const ordered = [...rows].sort((a, b) => {
    const tsA = Date.parse(a.runDate);
    const tsB = Date.parse(b.runDate);
    if (Number.isFinite(tsA) && Number.isFinite(tsB) && tsA !== tsB) return tsA - tsB;
    return a.symbol.localeCompare(b.symbol);
  });

  const body = ordered.map((row) =>
    [
      row.runDate,
      row.symbol,
      row.modelRank,
      row.execRank,
      row.AQ,
      row.XS,
      row.decisionReason,
      row.entryPlanned,
      row.entryFilled,
      row.stopPlanned,
      row.targetPlanned,
      row.exitPrice,
      row.exitReason,
      row.holdDaysPlanned,
      row.holdDaysActual,
      row.RMultiple,
      row.slipPct,
      row.marketRegime,
      row.notes
    ]
      .map((value) => csvCell(value as string | number | null))
      .join(",")
  );

  return [header.join(","), ...body].join("\n");
}

function evaluatePerformanceLoopGate(
  latestSnapshot: PerformanceLoopSnapshot | null,
  tradeCount: number
): PerformanceLoopGate {
  const requiredTrades = 20;
  const observedTrades =
    latestSnapshot && Number.isFinite(Number(latestSnapshot.tradeCount))
      ? Number(latestSnapshot.tradeCount)
      : tradeCount;

  if (observedTrades < requiredTrades) {
    return {
      status: "PENDING_SAMPLE",
      reason: `sample_insufficient(trades=${observedTrades},required>=${requiredTrades})`,
      progress: `${Math.min(observedTrades, requiredTrades)}/${requiredTrades}`
    };
  }

  const passFill = Number(latestSnapshot?.fillRatePct) >= 60;
  const passAvgR = Number(latestSnapshot?.avgR) > 0;
  const passDrift = Number(latestSnapshot?.noReasonDrift) === 0;
  const failReasons: string[] = [];
  if (!passFill) failReasons.push("fill_rate_below_60");
  if (!passAvgR) failReasons.push("avgR_not_positive");
  if (!passDrift) failReasons.push("reason_drift_detected");

  return {
    status: failReasons.length === 0 ? "GO" : "NO_GO",
    reason: failReasons.length === 0 ? "all_must_pass_checks_ok" : failReasons.join("|"),
    progress: `${requiredTrades}/${requiredTrades}`
  };
}

function buildPerformanceLoopAlertMessage(
  result: PerformanceLoopUpdateResult,
  milestone: number
): string {
  const snapshot = result.latestSnapshot;
  const fillRate =
    snapshot && Number.isFinite(Number(snapshot.fillRatePct))
      ? `${Number(snapshot.fillRatePct).toFixed(2)}%`
      : "N/A";
  const avgR =
    snapshot && Number.isFinite(Number(snapshot.avgR))
      ? Number(snapshot.avgR).toFixed(4)
      : "N/A";
  const holdErr =
    snapshot && Number.isFinite(Number(snapshot.medianHoldErrorDays))
      ? Number(snapshot.medianHoldErrorDays).toFixed(2)
      : "N/A";
  const drift =
    snapshot && Number.isFinite(Number(snapshot.noReasonDrift))
      ? Number(snapshot.noReasonDrift)
      : "N/A";

  const statusIcon =
    result.gate.status === "GO"
      ? "✅"
      : result.gate.status === "NO_GO"
        ? "⚠️"
        : "ℹ️";

  return [
    `${statusIcon} Stage6 Performance Loop Milestone`,
    `Batch: ${result.batchId}`,
    `Milestone: ${milestone} trades`,
    `Gate: ${result.gate.status} (${result.gate.reason})`,
    `Progress: ${result.gate.progress}`,
    `KPI: fillRate=${fillRate} avgR=${avgR} holdErrMedian=${holdErr} noReasonDrift=${drift}`
  ].join("\n");
}

async function loadPerformanceLoopState(
  policyFingerprint: string
): Promise<PerformanceLoopState> {
  const now = new Date().toISOString();
  const batchOverride = sanitizeBatchId(process.env.STAGE6_PERF_BATCH_ID || "");

  const buildEmpty = (batchId: string): PerformanceLoopState => ({
    batchId,
    createdAt: now,
    updatedAt: now,
    policyFingerprint,
    rows: {},
    snapshots: [],
    notifiedMilestones: []
  });

  try {
    const raw = await readFile(PERFORMANCE_LOOP_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<PerformanceLoopState>;
    const currentBatchRaw = typeof parsed.batchId === "string" ? parsed.batchId : "";
    const currentBatch = sanitizeBatchId(currentBatchRaw);
    const resolvedBatch = batchOverride || currentBatch || makeDefaultBatchId();

    if (batchOverride && currentBatch && currentBatch !== batchOverride) {
      return buildEmpty(batchOverride);
    }

    const rows =
      parsed && typeof parsed.rows === "object" && parsed.rows
        ? (parsed.rows as Record<string, PerformanceLoopRow>)
        : {};
    const snapshots = Array.isArray(parsed?.snapshots)
      ? (parsed.snapshots as PerformanceLoopSnapshot[])
      : [];
    const notifiedMilestones = Array.isArray(parsed?.notifiedMilestones)
      ? Array.from(
          new Set(
            parsed.notifiedMilestones
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && value > 0)
              .map((value) => Math.round(value))
          )
        )
      : [];

    return {
      batchId: resolvedBatch,
      createdAt:
        typeof parsed?.createdAt === "string" && parsed.createdAt
          ? parsed.createdAt
          : now,
      updatedAt:
        typeof parsed?.updatedAt === "string" && parsed.updatedAt
          ? parsed.updatedAt
          : now,
      policyFingerprint:
        typeof parsed?.policyFingerprint === "string" && parsed.policyFingerprint
          ? parsed.policyFingerprint
          : policyFingerprint,
      rows,
      snapshots,
      notifiedMilestones
    };
  } catch {
    return buildEmpty(batchOverride || makeDefaultBatchId());
  }
}

async function savePerformanceLoopState(state: PerformanceLoopState): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(PERFORMANCE_LOOP_JSON_PATH, JSON.stringify(state, null, 2), "utf8");
  await writeFile(PERFORMANCE_LOOP_CSV_PATH, toPerformanceCsv(Object.values(state.rows)), "utf8");
  console.log(`[STATE] saved ${PERFORMANCE_LOOP_JSON_PATH}`);
  console.log(`[STATE] saved ${PERFORMANCE_LOOP_CSV_PATH}`);
}

async function updatePerformanceLoop(
  stage6: Stage6LoadResult,
  actionable: Stage6CandidateSummary[],
  dryExec: DryExecBuildResult,
  preflight: PreflightResult
): Promise<PerformanceLoopUpdateResult> {
  const policyFingerprint = buildPerformancePolicyFingerprint(dryExec);
  const state = await loadPerformanceLoopState(policyFingerprint);
  const now = new Date().toISOString();
  const candidateMap = new Map<string, Stage6CandidateSummary>();
  [...stage6.modelTopCandidates, ...stage6.candidates, ...actionable].forEach((row) => {
    if (row?.symbol) candidateMap.set(row.symbol, row);
  });

  let upserted = 0;
  let touched = 0;
  let latestSnapshot: PerformanceLoopSnapshot | null =
    state.snapshots.length > 0 ? state.snapshots[state.snapshots.length - 1] : null;
  let alertMessage: string | null = null;

  for (const payload of dryExec.payloads) {
    const rowId =
      payload.idempotencyKey || buildOrderIdempotencyKey(stage6.sha256, payload.symbol, payload.side);
    const stage6Row = candidateMap.get(payload.symbol);
    const existing = state.rows[rowId];

    const baseRow: PerformanceLoopRow = {
      rowId,
      runDate: now,
      stage6Hash: stage6.sha256,
      stage6File: stage6.fileName,
      symbol: payload.symbol,
      modelRank: stage6Row?.modelRank ?? null,
      execRank: stage6Row?.executionRank ?? null,
      AQ: stage6Row?.qualityScore ?? null,
      XS: stage6Row?.executionScore ?? null,
      decisionReason: stage6Row?.decisionReason ?? "n/a",
      entryPlanned: payload.limit_price,
      entryFilled: null,
      stopPlanned: payload.stop_loss.stop_price,
      targetPlanned: payload.take_profit.limit_price,
      exitPrice: null,
      exitReason: null,
      holdDaysPlanned: null,
      holdDaysActual: null,
      RMultiple: null,
      slipPct: null,
      marketRegime: dryExec.regime.profile,
      notes: `preflight=${preflight.code};stage6=${stage6.sha256.slice(0, 12)}`
    };

    if (!existing) {
      state.rows[rowId] = normalizeLoopRow(baseRow);
      upserted += 1;
      touched += 1;
      continue;
    }

    // Preserve post-trade manual/actual fields while refreshing latest signal metadata.
    const merged: PerformanceLoopRow = {
      ...existing,
      ...baseRow,
      entryFilled: existing.entryFilled,
      exitPrice: existing.exitPrice,
      exitReason: existing.exitReason,
      holdDaysPlanned: existing.holdDaysPlanned,
      holdDaysActual: existing.holdDaysActual,
      notes: existing.notes || baseRow.notes
    };
    state.rows[rowId] = normalizeLoopRow(merged);
    touched += 1;
  }

  if (touched === 0) {
    const currentTradeCount = Object.keys(state.rows).length;
    const lastSnapshotTradeCount =
      state.snapshots.length > 0
        ? Number(state.snapshots[state.snapshots.length - 1]?.tradeCount ?? 0)
        : 0;
    const previousMilestoneBucket = Math.floor(lastSnapshotTradeCount / 10);
    const currentMilestoneBucket = Math.floor(currentTradeCount / 10);
    const crossedMilestones: number[] = [];
    if (currentTradeCount > 0 && currentMilestoneBucket > previousMilestoneBucket) {
      for (let bucket = previousMilestoneBucket + 1; bucket <= currentMilestoneBucket; bucket += 1) {
        crossedMilestones.push(bucket * 10);
      }
    }

    if (crossedMilestones.length > 0) {
      const snapshot = buildPerformanceSnapshot(Object.values(state.rows));
      state.snapshots.push(snapshot);
      latestSnapshot = snapshot;
      const alertMessages: string[] = [];
      const milestoneCandidates = crossedMilestones.filter((milestone) => [10, 20].includes(milestone));
      for (const milestone of milestoneCandidates) {
        const alreadyNotified = state.notifiedMilestones.includes(milestone);
        if (alreadyNotified) continue;
        const gate = evaluatePerformanceLoopGate(snapshot, currentTradeCount);
        state.notifiedMilestones.push(milestone);
        alertMessages.push(
          buildPerformanceLoopAlertMessage(
            {
              batchId: state.batchId,
              tradeCount: currentTradeCount,
              snapshotCount: state.snapshots.length,
              gate,
              latestSnapshot: snapshot,
              alertMessage: null,
              updated: true
            },
            milestone
          )
        );
      }
      state.updatedAt = now;
      await savePerformanceLoopState(state);
      const gate = evaluatePerformanceLoopGate(latestSnapshot, currentTradeCount);
      console.log(
        `[PERF_LOOP] batch=${state.batchId} backfill milestones=${crossedMilestones.join(",")} totalTrades=${currentTradeCount} snapshots=${state.snapshots.length} gate=${gate.status} reason=${gate.reason} progress=${gate.progress}`
      );
      return {
        batchId: state.batchId,
        tradeCount: currentTradeCount,
        snapshotCount: state.snapshots.length,
        gate,
        latestSnapshot,
        alertMessage: alertMessages.length > 0 ? alertMessages.join("\n\n") : null,
        updated: true
      };
    }

    const gate = evaluatePerformanceLoopGate(latestSnapshot, Object.keys(state.rows).length);
    console.log(
      `[PERF_LOOP] batch=${state.batchId} no-op (payloads=0) totalTrades=${Object.keys(state.rows).length}`
    );
    return {
      batchId: state.batchId,
      tradeCount: Object.keys(state.rows).length,
      snapshotCount: state.snapshots.length,
      gate,
      latestSnapshot,
      alertMessage: null,
      updated: false
    };
  }

  state.updatedAt = now;
  state.policyFingerprint = policyFingerprint;

  const currentTradeCount = Object.keys(state.rows).length;
  const lastSnapshotTradeCount =
    state.snapshots.length > 0
      ? Number(state.snapshots[state.snapshots.length - 1]?.tradeCount ?? 0)
      : 0;
  const previousMilestoneBucket = Math.floor(lastSnapshotTradeCount / 10);
  const currentMilestoneBucket = Math.floor(currentTradeCount / 10);
  const crossedMilestones: number[] = [];
  if (currentTradeCount > 0 && currentMilestoneBucket > previousMilestoneBucket) {
    for (let bucket = previousMilestoneBucket + 1; bucket <= currentMilestoneBucket; bucket += 1) {
      crossedMilestones.push(bucket * 10);
    }
  }

  if (crossedMilestones.length > 0) {
    const snapshot = buildPerformanceSnapshot(Object.values(state.rows));
    state.snapshots.push(snapshot);
    latestSnapshot = snapshot;
    console.log(
      `[PERF_LOOP_KPI] trades=${snapshot.tradeCount} fillRatePct=${snapshot.fillRatePct ?? "N/A"} avgR=${snapshot.avgR ?? "N/A"} holdErrMedian=${snapshot.medianHoldErrorDays ?? "N/A"} noReasonDrift=${snapshot.noReasonDrift}`
    );

    const alertMessages: string[] = [];
    const milestoneCandidates = crossedMilestones.filter((milestone) => [10, 20].includes(milestone));
    for (const milestone of milestoneCandidates) {
      const alreadyNotified = state.notifiedMilestones.includes(milestone);
      if (alreadyNotified) continue;
      const gate = evaluatePerformanceLoopGate(snapshot, currentTradeCount);
      state.notifiedMilestones.push(milestone);
      alertMessages.push(
        buildPerformanceLoopAlertMessage(
          {
            batchId: state.batchId,
            tradeCount: currentTradeCount,
            snapshotCount: state.snapshots.length,
            gate,
            latestSnapshot: snapshot,
            alertMessage: null,
            updated: true
          },
          milestone
        )
      );
    }
    if (alertMessages.length > 0) {
      alertMessage = alertMessages.join("\n\n");
    }
  }

  await savePerformanceLoopState(state);
  const gate = evaluatePerformanceLoopGate(latestSnapshot, currentTradeCount);
  console.log(
    `[PERF_LOOP] batch=${state.batchId} upserted=${upserted} touched=${touched} totalTrades=${currentTradeCount} snapshots=${state.snapshots.length} gate=${gate.status} reason=${gate.reason} progress=${gate.progress}`
  );
  return {
    batchId: state.batchId,
    tradeCount: currentTradeCount,
    snapshotCount: state.snapshots.length,
    gate,
    latestSnapshot,
    alertMessage,
    updated: true
  };
}

async function loadOrderIdempotencyState(): Promise<OrderIdempotencyState> {
  try {
    const raw = await readFile(ORDER_IDEMPOTENCY_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<OrderIdempotencyState>;
    const orders =
      parsed && typeof parsed === "object" && parsed.orders && typeof parsed.orders === "object"
        ? (parsed.orders as OrderIdempotencyState["orders"])
        : {};
    const updatedAt = typeof parsed?.updatedAt === "string" ? parsed.updatedAt : "";
    return { orders, updatedAt };
  } catch {
    return { orders: {}, updatedAt: "" };
  }
}

async function saveOrderIdempotencyState(state: OrderIdempotencyState): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(ORDER_IDEMPOTENCY_PATH, JSON.stringify(state, null, 2), "utf8");
  console.log(`[STATE] saved ${ORDER_IDEMPOTENCY_PATH}`);
}

function pruneOrderIdempotencyState(state: OrderIdempotencyState, ttlDays: number): number {
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - ttlMs;
  let removed = 0;
  for (const [key, entry] of Object.entries(state.orders)) {
    const ts = Date.parse(entry.lastSeenAt);
    if (!Number.isFinite(ts) || ts < cutoff) {
      delete state.orders[key];
      removed += 1;
    }
  }
  return removed;
}

async function applyOrderIdempotency(
  stage6: Stage6LoadResult,
  dryExec: DryExecBuildResult
): Promise<DryExecBuildResult> {
  const cfg = loadRuntimeConfig();
  const enabled = readBoolEnv("ORDER_IDEMPOTENCY_ENABLED", true);
  const enforceDryRun = readBoolEnv("ORDER_IDEMPOTENCY_ENFORCE_DRY_RUN", false);
  const ttlDays = Math.max(1, readPositiveNumberEnv("ORDER_IDEMPOTENCY_TTL_DAYS", 30));
  const enforced = enabled && (cfg.execEnabled || enforceDryRun);

  if (!enabled) {
    return {
      ...dryExec,
      idempotency: {
        enabled,
        enforced,
        ttlDays,
        newCount: 0,
        duplicateCount: 0
      }
    };
  }

  const state = await loadOrderIdempotencyState();
  const pruned = pruneOrderIdempotencyState(state, ttlDays);
  const now = new Date().toISOString();
  const payloads: DryExecOrderPayload[] = [];
  const skipped = [...dryExec.skipped];
  let duplicateCount = 0;
  let newCount = 0;
  let changed = pruned > 0;

  for (const payload of dryExec.payloads) {
    const key = payload.idempotencyKey || buildOrderIdempotencyKey(stage6.sha256, payload.symbol, payload.side);
    payload.idempotencyKey = key;
    const existing = state.orders[key];
    if (existing) {
      duplicateCount += 1;
      if (enforced) {
        skipped.push({ symbol: payload.symbol, reason: "idempotency_duplicate" });
        continue;
      }
      payloads.push(payload);
      continue;
    }

    newCount += 1;
    payloads.push(payload);
    state.orders[key] = {
      symbol: payload.symbol,
      side: payload.side,
      stage6Hash: stage6.sha256,
      stage6File: stage6.fileName,
      firstSeenAt: now,
      lastSeenAt: now
    };
    changed = true;
  }

  if (changed) {
    state.updatedAt = now;
    await saveOrderIdempotencyState(state);
  }
  console.log(
    `[ORDER_IDEMP] enabled=${enabled} enforce=${enforced} ttlDays=${ttlDays} new=${newCount} duplicate=${duplicateCount} pruned=${pruned}`
  );

  const nextDryExec: DryExecBuildResult = {
    ...dryExec,
    payloads,
    skipped,
    skipReasonCounts: buildSkipReasonCounts(skipped),
    idempotency: {
      enabled,
      enforced,
      ttlDays,
      newCount,
      duplicateCount
    }
  };
  return {
    ...nextDryExec,
    actionIntent: rebuildActionIntentSummary(nextDryExec)
  };
}

async function loadOrderLedgerState(): Promise<OrderLedgerState> {
  try {
    const raw = await readFile(ORDER_LEDGER_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<OrderLedgerState>;
    const orders =
      parsed && typeof parsed === "object" && parsed.orders && typeof parsed.orders === "object"
        ? (parsed.orders as Record<string, OrderLedgerRecord>)
        : {};
    return {
      orders,
      updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : ""
    };
  } catch {
    return { orders: {}, updatedAt: "" };
  }
}

async function saveOrderLedgerState(state: OrderLedgerState): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(ORDER_LEDGER_PATH, JSON.stringify(state, null, 2), "utf8");
  console.log(`[STATE] saved ${ORDER_LEDGER_PATH}`);
}

function pruneOrderLedgerState(state: OrderLedgerState, ttlDays: number): number {
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - ttlMs;
  let removed = 0;
  for (const [key, row] of Object.entries(state.orders)) {
    const ts = Date.parse(row.updatedAt);
    if (!Number.isFinite(ts) || ts < cutoff) {
      delete state.orders[key];
      removed += 1;
    }
  }
  return removed;
}

async function updateOrderLedger(
  stage6: Stage6LoadResult,
  mode: string,
  dryExec: DryExecBuildResult,
  preflight: PreflightResult
): Promise<OrderLedgerUpdateResult> {
  const cfg = loadRuntimeConfig();
  const enabled = readBoolEnv("ORDER_LIFECYCLE_ENABLED", true);
  const ttlDays = Math.max(1, readPositiveNumberEnv("ORDER_LEDGER_TTL_DAYS", 90));
  const targetStatus: OrderLifecycleStatus = cfg.execEnabled ? "submitted" : "planned";
  const source = cfg.execEnabled ? "execution_pipeline" : "dry_run_pipeline";
  const reason = cfg.execEnabled ? "order_submitted_to_broker" : "dry_run_payload_prepared";

  if (!enabled) {
    return { enabled, targetStatus: "none", upserted: 0, transitioned: 0, unchanged: 0, pruned: 0 };
  }

  const state = await loadOrderLedgerState();
  const now = new Date().toISOString();
  const pruned = pruneOrderLedgerState(state, ttlDays);
  let upserted = 0;
  let transitioned = 0;
  let unchanged = 0;
  let changed = pruned > 0;

  for (const payload of dryExec.payloads) {
    const key = payload.idempotencyKey;
    const existing = state.orders[key];
    if (!existing) {
      upserted += 1;
      changed = true;
      state.orders[key] = {
        idempotencyKey: key,
        symbol: payload.symbol,
        side: payload.side,
        stage6Hash: stage6.sha256,
        stage6File: stage6.fileName,
        mode,
        clientOrderId: payload.client_order_id,
        status: targetStatus,
        statusReason: reason,
        preflightCode: preflight.code,
        regimeProfile: dryExec.regime.profile,
        notional: payload.notional,
        limitPrice: payload.limit_price,
        takeProfitPrice: payload.take_profit.limit_price,
        stopLossPrice: payload.stop_loss.stop_price,
        brokerOrderId: null,
        createdAt: now,
        updatedAt: now,
        history: [
          {
            at: now,
            from: null,
            to: targetStatus,
            reason,
            source
          }
        ]
      };
      continue;
    }

    const canTransition = isTransitionAllowed(existing.status, targetStatus);
    const shouldTransition = canTransition && existing.status !== targetStatus;

    if (shouldTransition) {
      transitioned += 1;
      changed = true;
      existing.history.push({
        at: now,
        from: existing.status,
        to: targetStatus,
        reason,
        source
      });
      existing.status = targetStatus;
      existing.statusReason = reason;
    } else {
      unchanged += 1;
      if (!canTransition) {
        console.warn(
          `[ORDER_LEDGER] invalid transition key=${key} from=${existing.status} to=${targetStatus} (ignored)`
        );
      }
    }

    existing.stage6Hash = stage6.sha256;
    existing.stage6File = stage6.fileName;
    existing.mode = mode;
    existing.clientOrderId = payload.client_order_id;
    existing.preflightCode = preflight.code;
    existing.regimeProfile = dryExec.regime.profile;
    existing.notional = payload.notional;
    existing.limitPrice = payload.limit_price;
    existing.takeProfitPrice = payload.take_profit.limit_price;
    existing.stopLossPrice = payload.stop_loss.stop_price;
    existing.updatedAt = now;
  }

  if (changed) {
    state.updatedAt = now;
    await saveOrderLedgerState(state);
  }

  console.log(
    `[ORDER_LEDGER] enabled=${enabled} target=${targetStatus} ttlDays=${ttlDays} upserted=${upserted} transitioned=${transitioned} unchanged=${unchanged} pruned=${pruned}`
  );

  return { enabled, targetStatus, upserted, transitioned, unchanged, pruned };
}

function buildRunModeLabel(dryExec: DryExecBuildResult, guardControl: GuardControlGate): string {
  const cfg = loadRuntimeConfig();
  const heartbeatOnDedupe = readBoolEnv("TELEGRAM_HEARTBEAT_ON_DEDUPE", false);
  const sourcePriorityRaw = (process.env.REGIME_VIX_SOURCE_PRIORITY || "realtime_first").trim().toLowerCase();
  const sourcePriority = sourcePriorityRaw === "snapshot_first" ? "snapshot_first" : "realtime_first";
  const snapshotMaxAgeMin = Math.max(0, readNumberEnv("REGIME_SNAPSHOT_MAX_AGE_MIN", 10));
  const idempotencyEnabled = readBoolEnv("ORDER_IDEMPOTENCY_ENABLED", true);
  const idempotencyEnforceDryRun = readBoolEnv("ORDER_IDEMPOTENCY_ENFORCE_DRY_RUN", false);
  const idempotencyTtlDays = Math.max(1, readPositiveNumberEnv("ORDER_IDEMPOTENCY_TTL_DAYS", 30));
  const preflightEnabled = readBoolEnv("PREFLIGHT_ENABLED", true);
  const allowEntryOutsideRth = readBoolEnv("ALLOW_ENTRY_OUTSIDE_RTH", false);
  const dailyMaxNotional = readNonNegativeNumberEnv("DAILY_MAX_NOTIONAL", 5000);
  const orderLifecycleEnabled = readBoolEnv("ORDER_LIFECYCLE_ENABLED", true);
  const orderLedgerTtlDays = Math.max(1, readPositiveNumberEnv("ORDER_LEDGER_TTL_DAYS", 90));
  const stage6ExecutionBucketEnforce = readBoolEnv("STAGE6_EXECUTION_BUCKET_ENFORCE", true);
  const actionableVerdicts = resolveActionableVerdicts();
  const regimeQualityEnabled = readBoolEnv("REGIME_QUALITY_GUARD_ENABLED", true);
  const regimeQualityMinScore = readPositiveNumberEnv("REGIME_QUALITY_MIN_SCORE", 60);
  const regimeHysteresisEnabled = readBoolEnv("REGIME_HYSTERESIS_ENABLED", true);
  const regimeMinHoldMin = Math.max(0, readNonNegativeNumberEnv("REGIME_MIN_HOLD_MIN", 30));
  const regimeVixMismatchPct = readPositiveNumberEnv("REGIME_VIX_MISMATCH_PCT", 8);
  return [
    `READ_ONLY=${cfg.readOnly}`,
    `EXEC_ENABLED=${cfg.execEnabled}`,
    `SIMULATION_LIVE_PARITY=${cfg.simulationLiveParity}`,
    `PROFILE=${dryExec.regime.profile}`,
    `NOTIONAL=${dryExec.notionalPerOrder}`,
    `MAX_ORDERS=${dryExec.maxOrders}`,
    `MAX_TOTAL_NOTIONAL=${dryExec.maxTotalNotional}`,
    `MIN_CONV=${dryExec.minConviction}`,
    `STOP_MIN=${dryExec.minStopDistancePct}`,
    `STOP_MAX=${dryExec.maxStopDistancePct}`,
    `STOP_POLICY_SYNC_STAGE6=${dryExec.stopDistancePolicy.syncWithStage6}`,
    `STOP_POLICY=${dryExec.stopDistancePolicy.strategy}`,
    `STOP_CONFIG=${dryExec.stopDistancePolicy.configuredMinPct}~${dryExec.stopDistancePolicy.configuredMaxPct}`,
    `STOP_STAGE6=${dryExec.stopDistancePolicy.stage6MinPct}~${dryExec.stopDistancePolicy.stage6MaxPct}`,
    `ENTRY_FEAS_ENFORCE=${dryExec.entryFeasibility.enforce}`,
    `ENTRY_MAX_DISTANCE_PCT=${dryExec.entryFeasibility.maxDistancePct}`,
    `STAGE6_EXEC_BUCKET_ENFORCE=${stage6ExecutionBucketEnforce}`,
    `ACTIONABLE_VERDICTS=${formatActionableVerdicts(actionableVerdicts)}`,
    `POSITION_LIFECYCLE_ENABLED=${cfg.positionLifecycle.enabled}`,
    `POSITION_LIFECYCLE_PREVIEW_ONLY=${cfg.positionLifecycle.previewOnly}`,
    `POSITION_LIFECYCLE_ACTION_TYPES=${cfg.positionLifecycle.allowedActionTypes.join("/")}`,
    `POSITION_LIFECYCLE_SCALE_UP_MIN_CONVICTION=${cfg.positionLifecycle.scaleUpMinConviction}`,
    `HF_SENTIMENT_SOFT_GATE_ENABLED=${readBoolEnv("HF_SENTIMENT_SOFT_GATE_ENABLED", false)}`,
    `HF_SENTIMENT_SCORE_FLOOR=${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_SCORE_FLOOR", 0.55), 0.5, 0.95)}`,
    `HF_SENTIMENT_MIN_ARTICLE_COUNT=${Math.max(0, Math.round(readNonNegativeNumberEnv("HF_SENTIMENT_MIN_ARTICLE_COUNT", 2)))}`,
    `HF_SENTIMENT_MAX_NEWS_AGE_HOURS=${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_MAX_NEWS_AGE_HOURS", 24), 1, 240)}`,
    `HF_SENTIMENT_POSITIVE_RELIEF_MAX=${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_POSITIVE_RELIEF_MAX", 1.0), 0, 3)}`,
    `HF_SENTIMENT_NEGATIVE_TIGHTEN_MAX=${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_NEGATIVE_TIGHTEN_MAX", 2.0), 0, 4)}`,
    `SOURCE_PRIORITY=${sourcePriority}`,
    `SNAPSHOT_MAX_AGE_MIN=${snapshotMaxAgeMin}`,
    `ORDER_IDEMP_ENABLED=${idempotencyEnabled}`,
    `ORDER_IDEMP_ENFORCE_DRY_RUN=${idempotencyEnforceDryRun}`,
    `ORDER_IDEMP_TTL_DAYS=${idempotencyTtlDays}`,
    `PREFLIGHT_ENABLED=${preflightEnabled}`,
    `ALLOW_ENTRY_OUTSIDE_RTH=${allowEntryOutsideRth}`,
    `DAILY_MAX_NOTIONAL=${dailyMaxNotional}`,
    `ORDER_LIFECYCLE_ENABLED=${orderLifecycleEnabled}`,
    `ORDER_LEDGER_TTL_DAYS=${orderLedgerTtlDays}`,
    `REGIME_QUALITY_GUARD_ENABLED=${regimeQualityEnabled}`,
    `REGIME_QUALITY_MIN_SCORE=${regimeQualityMinScore}`,
    `REGIME_HYSTERESIS_ENABLED=${regimeHysteresisEnabled}`,
    `REGIME_MIN_HOLD_MIN=${regimeMinHoldMin}`,
    `REGIME_VIX_MISMATCH_PCT=${regimeVixMismatchPct}`,
    `GUARD_CONTROL_ENFORCE=${guardControl.enforce}`,
    `GUARD_CONTROL_MAX_AGE_MIN=${guardControl.maxAgeMin}`,
    `GUARD_CONTROL_AGE_MIN=${guardControl.ageMin != null ? guardControl.ageMin.toFixed(1) : "N/A"}`,
    `GUARD_CONTROL_BLOCKED=${guardControl.blocked}`,
    `GUARD_CONTROL_LEVEL=${guardControl.level != null ? `L${guardControl.level}` : "N/A"}`,
    `GUARD_CONTROL_STALE=${guardControl.stale}`,
    `HEARTBEAT=${heartbeatOnDedupe}`
  ].join(";");
}

function formatVix(vix: number | null): string {
  return vix == null ? "N/A" : vix.toFixed(2);
}

function printRunSummary(
  event: "sent" | "dedupe",
  stage6: Stage6LoadResult,
  actionableCount: number,
  dryExec: DryExecBuildResult,
  preflight: PreflightResult,
  ledger: OrderLedgerUpdateResult
): void {
  const actionIntentSummary = `enabled:${dryExec.actionIntent.enabled}|preview:${dryExec.actionIntent.previewOnly}|entry_new:${dryExec.actionIntent.counts.ENTRY_NEW}|hold_wait:${dryExec.actionIntent.counts.HOLD_WAIT}|scale_up:${dryExec.actionIntent.counts.SCALE_UP}|scale_down:${dryExec.actionIntent.counts.SCALE_DOWN}|exit_partial:${dryExec.actionIntent.counts.EXIT_PARTIAL}|exit_full:${dryExec.actionIntent.counts.EXIT_FULL}`;
  console.log(
    `[RUN_SUMMARY] event=${event} stage6=${stage6.fileName} hash=${stage6.sha256.slice(0, 12)} profile=${dryExec.regime.profile} source=${dryExec.regime.source} vix=${formatVix(dryExec.regime.vix)} actionable=${actionableCount} payloads=${dryExec.payloads.length} skipped=${dryExec.skipped.length} skip_reasons=${formatSkipReasonCounts(dryExec.skipReasonCounts)} stage6_contract_enforce=${dryExec.stage6Contract.enforce} stage6_contract_checked=${dryExec.stage6Contract.checked} stage6_contract_blocked=${dryExec.stage6Contract.blocked} entry_feas_enforce=${dryExec.entryFeasibility.enforce} entry_feas_checked=${dryExec.entryFeasibility.checked} entry_feas_blocked=${dryExec.entryFeasibility.blocked} hf_soft_enabled=${dryExec.hfSentimentGate.enabled} hf_soft_applied=${dryExec.hfSentimentGate.applied} hf_soft_blocked_negative=${dryExec.hfSentimentGate.blockedNegative} hf_soft_net_delta=${dryExec.hfSentimentGate.netMinConvictionDelta} action_intent=${actionIntentSummary} idemp_new=${dryExec.idempotency.newCount} idemp_dup=${dryExec.idempotency.duplicateCount} idemp_enforced=${dryExec.idempotency.enforced} preflight=${preflight.status}:${preflight.code} preflight_blocking=${preflight.blocking} preflight_would_block_live=${preflight.wouldBlockLive} ledger_target=${ledger.targetStatus} ledger_upserted=${ledger.upserted} ledger_transitioned=${ledger.transitioned} ledger_unchanged=${ledger.unchanged}`
  );
}

function shouldSend(state: SidecarRunState | null, result: Stage6LoadResult, mode: string): boolean {
  if (!state) return true;
  return !(state.lastStage6Sha256 === result.sha256 && state.lastMode === mode);
}

async function main() {
  printStartupSummary();
  const cfg = loadRuntimeConfig();
  const accessToken = await getGoogleAccessToken();
  const stage6 = await loadLatestStage6FromDrive(accessToken);
  printStage6Lock(stage6);
  validateTriggerContext(stage6);
  const baseRegime = await resolveRegimeSelection(accessToken);
  const regime = await applyRegimeGuards(baseRegime);
  const regimeVix = regime.vix == null ? "N/A" : regime.vix.toFixed(2);
  console.log(
    `[REGIME] profile=${regime.profile.toUpperCase()} base=${regime.baseProfile.toUpperCase()} source=${regime.source} vix=${regimeVix} on<=${regime.riskOnThreshold} off>=${regime.riskOffThreshold}`
  );
  console.log(
    `[REGIME_QUALITY] score=${regime.quality.score} status=${regime.quality.status.toUpperCase()} min=${regime.quality.minScore} forceRiskOff=${regime.quality.forceRiskOff} reasons=${regime.quality.reasons.join("|") || "none"}`
  );
  console.log(
    `[REGIME_HYST] prev=${regime.hysteresis.previousProfile ?? "none"} desired=${regime.hysteresis.desiredProfile} applied=${regime.hysteresis.appliedProfile} holdRemainingMin=${regime.hysteresis.holdRemainingMin} reason=${regime.hysteresis.reason}`
  );
  if (regime.entryGuard.blocked) {
    console.warn(`[ENTRY_GUARD] blocked=true reason=${regime.entryGuard.reason}`);
  }
  const guardControl = await resolveGuardControlGate();
  if (guardControl.enforce) {
    const levelLabel = guardControl.level != null ? `L${guardControl.level}` : "N/A";
    console.log(
      `[GUARD_CONTROL] enforce=true blocked=${guardControl.blocked} wouldBlockLive=${guardControl.wouldBlockLive} stale=${guardControl.stale} ageMin=${guardControl.ageMin != null ? guardControl.ageMin.toFixed(1) : "N/A"} maxAgeMin=${guardControl.maxAgeMin} reason=${guardControl.reason} level=${levelLabel} updatedAt=${guardControl.updatedAt ?? "N/A"}`
    );
  }
  if (guardControl.blocked) {
    console.warn(`[ENTRY_GUARD] blocked=true reason=${guardControl.reason}`);
  }
  if (regime.diagnostics.length > 0) {
    regime.diagnostics.forEach((line) => console.log(`[REGIME_DIAG] ${line}`));
  }
  const actionableVerdicts = resolveActionableVerdicts();
  console.log(
    `[ACTIONABLE_POLICY] includeSpeculative=${actionableVerdicts.has("SPECULATIVE_BUY")} verdicts=${formatActionableVerdicts(actionableVerdicts)}`
  );
  const actionable = getActionableCandidates(stage6.candidates, actionableVerdicts);
  const dryExecBase = buildDryExecPayloads(actionable, stage6.sha256, regime);
  console.log(
    `[STAGE6_CONTRACT] enforce=${dryExecBase.stage6Contract.enforce} checked=${dryExecBase.stage6Contract.checked} executable=${dryExecBase.stage6Contract.executable} watchlist=${dryExecBase.stage6Contract.watchlist} blocked=${dryExecBase.stage6Contract.blocked}`
  );
  console.log(
    `[ENTRY_FEASIBILITY] enforce=${dryExecBase.entryFeasibility.enforce} maxDistancePct=${dryExecBase.entryFeasibility.maxDistancePct} checked=${dryExecBase.entryFeasibility.checked} blocked=${dryExecBase.entryFeasibility.blocked}`
  );
  console.log(
    `[ACTION_INTENT] enabled=${dryExecBase.actionIntent.enabled} previewOnly=${dryExecBase.actionIntent.previewOnly} allowed=${dryExecBase.actionIntent.allowedActionTypes.join("/")} counts=ENTRY_NEW:${dryExecBase.actionIntent.counts.ENTRY_NEW},HOLD_WAIT:${dryExecBase.actionIntent.counts.HOLD_WAIT},SCALE_UP:${dryExecBase.actionIntent.counts.SCALE_UP},SCALE_DOWN:${dryExecBase.actionIntent.counts.SCALE_DOWN},EXIT_PARTIAL:${dryExecBase.actionIntent.counts.EXIT_PARTIAL},EXIT_FULL:${dryExecBase.actionIntent.counts.EXIT_FULL}`
  );
  const dryExecAfterRegime = applyEntryGuardToDryExec(dryExecBase, regime);
  const dryExec = applyGuardControlGateToDryExec(dryExecAfterRegime, guardControl);
  const mode = buildRunModeLabel(dryExec, guardControl);
  const priorState = await loadRunState();
  const forceSendOnce = readBoolEnv("FORCE_SEND_ONCE", false);
  const forceSendKey = `${stage6.sha256}:${mode}`;
  const forceSendAlreadyConsumed = priorState?.lastForceSendKey === forceSendKey;
  const forceSendBypassDedupe = forceSendOnce && !forceSendAlreadyConsumed;

  if (forceSendOnce) {
    if (forceSendBypassDedupe) {
      console.warn(
        `[FORCE_SEND_ONCE] bypassing dedupe for one run key=${stage6.sha256.slice(0, 12)} (hash/mode scope)`
      );
    } else {
      console.warn(
        `[FORCE_SEND_ONCE] already consumed for current hash/mode key=${stage6.sha256.slice(0, 12)}`
      );
    }
  }

  if (!shouldSend(priorState, stage6, mode) && !forceSendBypassDedupe) {
    console.log(`[DEDUPE] SKIP send (same hash/mode) sha256=${stage6.sha256.slice(0, 12)} mode=${mode}`);
    await sendHeartbeatOnDedupe(stage6, mode);
    const dedupePreflight: PreflightResult = {
      enabled: readBoolEnv("PREFLIGHT_ENABLED", true),
      enforced: false,
      blocking: false,
      wouldBlockLive: false,
      simulatedLiveParity: cfg.simulationLiveParity && !cfg.execEnabled,
      status: "skip",
      code: "PREFLIGHT_NOT_RUN_DEDUPE",
      message: "dedupe skip: preflight not executed",
      requiredNotional: roundToCent(sumNotional(dryExec.payloads)),
      dailyMaxNotional: readNonNegativeNumberEnv("DAILY_MAX_NOTIONAL", 5000),
      allowEntryOutsideRth: readBoolEnv("ALLOW_ENTRY_OUTSIDE_RTH", false),
      accountStatus: null,
      buyingPower: null,
      marketOpen: null,
      nextOpen: null
    };
    const dedupeLedger: OrderLedgerUpdateResult = {
      enabled: readBoolEnv("ORDER_LIFECYCLE_ENABLED", true),
      targetStatus: "none",
      upserted: 0,
      transitioned: 0,
      unchanged: 0,
      pruned: 0
    };
    printRunSummary("dedupe", stage6, actionable.length, dryExec, dedupePreflight, dedupeLedger);
    return;
  }
  const finalDryExec = await applyOrderIdempotency(stage6, dryExec);
  const preflight = await runPreflightGate(finalDryExec);
  console.log(
    `[PREFLIGHT] status=${preflight.status.toUpperCase()} code=${preflight.code} enforced=${preflight.enforced} blocking=${preflight.blocking} wouldBlockLive=${preflight.wouldBlockLive} liveParity=${preflight.simulatedLiveParity} required=${preflight.requiredNotional.toFixed(2)} buyingPower=${preflight.buyingPower != null ? preflight.buyingPower.toFixed(2) : "N/A"}`
  );
  if (preflight.blocking && cfg.execEnabled) {
    throw new Error(`Preflight blocked execution: ${preflight.code} | ${preflight.message}`);
  }
  const postPreflightDryExec = applyPreflightGateToDryExec(finalDryExec, preflight);

  const ledger = await updateOrderLedger(stage6, mode, postPreflightDryExec, preflight);
  await sendSimulationTelegram(stage6, actionable, actionableVerdicts, postPreflightDryExec, preflight, ledger, guardControl);
  await saveDryExecPreview(stage6, postPreflightDryExec, preflight, ledger, guardControl);
  const perfLoop = await updatePerformanceLoop(stage6, actionable, postPreflightDryExec, preflight);
  await sendPerformanceLoopMilestoneAlert(perfLoop);
  await saveRunState(stage6, mode, priorState, forceSendBypassDedupe ? forceSendKey : undefined);
  printRunSummary("sent", stage6, actionable.length, postPreflightDryExec, preflight, ledger);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[DRY_RUN] FAIL ${message}`);
  process.exit(1);
});
