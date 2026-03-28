import { loadRuntimeConfig } from "../config/policy.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseJsonText } from "./json-utils.js";

type GuardLevel = 0 | 1 | 2 | 3;
type GuardActionStatus =
  | "planned"
  | "executed"
  | "failed"
  | "skipped_not_applicable"
  | "skipped_policy"
  | "blocked_safety_mode"
  | "execution_not_implemented";

type VixSource = "finnhub" | "cnbc_direct" | "cnbc_rapidapi" | "market_snapshot" | "env_fallback" | "forced";

type VixLookupResult = {
  vix: number | null;
  source: VixSource;
  reason: string;
  modifiedTime?: string;
};

type MarketSignals = {
  vix: number | null;
  vixSource: VixSource;
  vixReasons: string[];
  snapshotVix: number | null;
  snapshotAgeMin: number | null;
  indexWorstDropPct: number | null;
  indexRows: Array<{ symbol: string; changePct: number }>;
  diagnostics: string[];
};

type QualityStatus = "high" | "medium" | "low";

type GuardQuality = {
  enabled: boolean;
  minScore: number;
  score: number;
  status: QualityStatus;
  forceEscalate: boolean;
  reasons: string[];
};

type GuardThresholds = {
  l1Vix: number;
  l2Vix: number;
  l3Vix: number;
  l2IndexDropPct: number;
  l3IndexDropPct: number;
  notes: string[];
};

type GuardDecision = {
  mode: "observe" | "active";
  profile: "default" | "risk_off";
  useIndexDrop: boolean;
  sourcePriority: "realtime_first" | "snapshot_first";
  vix: number | null;
  vixSource: VixSource;
  indexWorstDropPct: number | null;
  quality: GuardQuality;
  thresholds: GuardThresholds;
  vixLevel: GuardLevel;
  indexLevel: GuardLevel;
  rawLevel: GuardLevel;
  forcedLevel: GuardLevel | null;
  desiredLevel: GuardLevel;
  appliedLevel: GuardLevel;
  levelReason: string;
  holdRemainingMin: number;
  marketOpen: boolean | null;
  nextOpen: string | null;
  allowOutsideRth: boolean;
  cooldownMin: number;
  shouldRunActions: boolean;
  actionReason: string;
  actions: string[];
  diagnostics: string[];
};

type MarketGuardState = {
  lastLevel: GuardLevel;
  lastLevelChangedAt: string;
  lastEvaluatedAt: string;
  lastActionLevel: GuardLevel;
  lastActionAt: string;
  cooldownUntil: string;
  lastSignature: string;
  lastForceSendKey?: string;
};

type GuardActionLedgerRecord = {
  key: string;
  level: GuardLevel;
  action: string;
  mode: "observe" | "active";
  status: GuardActionStatus;
  reason: string;
  detail?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
};

type GuardActionLedgerState = {
  actions: Record<string, GuardActionLedgerRecord>;
  updatedAt: string;
};

type CnbcQuoteRow = Record<string, unknown>;

type CnbcQuoteFetchResult = {
  ok: boolean;
  rows: Record<string, CnbcQuoteRow>;
  reason: string;
};

const MARKET_GUARD_STATE_PATH = "state/market-guard-state.json";
const GUARD_ACTION_LEDGER_PATH = "state/guard-action-ledger.json";
const LAST_MARKET_GUARD_PATH = "state/last-market-guard.json";
const GUARD_CONTROL_STATE_PATH = "state/guard-control.json";

function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
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
  return Number.isFinite(n) ? n : fallback;
}

function readPositiveNumberEnv(key: string, fallback: number): number {
  const n = readNumberEnv(key, fallback);
  return n > 0 ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.replace(/[^0-9.-]/g, "");
    if (!normalized) return null;
    const n = Number(normalized);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toFinitePositiveNumber(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n != null && n > 0 ? n : null;
}

function computeAgeMinutes(isoTs: string | null | undefined): number | null {
  if (!isoTs) return null;
  const ts = Date.parse(isoTs);
  if (!Number.isFinite(ts)) return null;
  return (Date.now() - ts) / 60000;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function parseForceLevel(raw: string | undefined): GuardLevel | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized === "auto") return null;
  if (["0", "l0", "none"].includes(normalized)) return 0;
  if (["1", "l1"].includes(normalized)) return 1;
  if (["2", "l2"].includes(normalized)) return 2;
  if (["3", "l3"].includes(normalized)) return 3;
  return null;
}

function runEnvGuard() {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const key of ["TELEGRAM_TOKEN", "TELEGRAM_SIMULATION_CHAT_ID"]) {
    if (!hasValue(process.env[key])) missing.push(key);
  }

  if (!hasValue(process.env.ALPACA_BASE_URL)) {
    warnings.push("ALPACA_BASE_URL missing (clock-based RTH guard may fail)");
  }
  if (!hasValue(process.env.ALPACA_KEY_ID) || !hasValue(process.env.ALPACA_SECRET_KEY)) {
    warnings.push("ALPACA_KEY_ID/ALPACA_SECRET_KEY missing (clock/account checks may fail)");
  }

  return { missing, warnings };
}

function printStartupSummary() {
  const cfg = loadRuntimeConfig();
  const now = new Date().toISOString();
  const check = runEnvGuard();

  console.log("=== alpha-exec-engine market-guard ===");
  console.log(`timestamp        : ${now}`);
  console.log(`policyVersion    : ${cfg.policyVersion}`);
  console.log(`timezone         : ${cfg.timezone}`);
  console.log(`EXEC_ENABLED     : ${cfg.execEnabled}`);
  console.log(`READ_ONLY        : ${cfg.readOnly}`);
  console.log(`ALPACA_BASE_URL  : ${process.env.ALPACA_BASE_URL || "(unset)"}`);
  console.log(`TELEGRAM_SIM     : ${mask(process.env.TELEGRAM_SIMULATION_CHAT_ID || "")}`);

  for (const warning of check.warnings) {
    console.warn(`[WARN] ${warning}`);
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
    throw new Error(`Google token refresh failed (${response.status}): ${text.slice(0, 200)}`);
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Google token response missing access_token");
  return data.access_token;
}

async function downloadDriveJson(accessToken: string, fileId: string): Promise<string> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Drive download failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.text();
}

async function fetchSnapshotVix(accessToken: string): Promise<VixLookupResult> {
  const folderId = process.env.GDRIVE_MARKET_SNAPSHOT_FOLDER_ID?.trim() || process.env.GDRIVE_ROOT_FOLDER_ID || "";
  if (!folderId) {
    return { vix: null, source: "market_snapshot", reason: "snapshot folder not configured" };
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
    return { vix: null, source: "market_snapshot", reason: `snapshot list failed (${response.status}): ${text.slice(0, 120)}` };
  }

  const data = (await response.json()) as { files?: Array<{ id: string; name: string; modifiedTime?: string }> };
  const file = data.files?.[0];
  if (!file?.id) return { vix: null, source: "market_snapshot", reason: "snapshot file not found" };

  try {
    const raw = await downloadDriveJson(accessToken, file.id);
    const payload = parseJsonText<unknown>(raw, `market_snapshot(${file.name || file.id})`);
    const vix = extractVixFromMarketSnapshot(payload);
    if (vix == null) {
      return {
        vix: null,
        source: "market_snapshot",
        reason: `snapshot parse miss: ${file.name}`,
        modifiedTime: file.modifiedTime
      };
    }
    return {
      vix,
      source: "market_snapshot",
      reason: `snapshot ok: ${file.name}`,
      modifiedTime: file.modifiedTime
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      vix: null,
      source: "market_snapshot",
      reason: `snapshot parse failed: ${message.slice(0, 120)}`,
      modifiedTime: file.modifiedTime
    };
  }
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
    const parsed = toFinitePositiveNumber(getNestedValue(payload, path));
    if (parsed != null) return parsed;
  }
  return null;
}

async function fetchFinnhubVix(): Promise<VixLookupResult> {
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) return { vix: null, source: "finnhub", reason: "FINNHUB_API_KEY missing" };

  const symbols = ["VIX", "^VIX", "CBOE:VIX", ".VIX"];
  const attempts: string[] = [];
  for (const symbol of symbols) {
    try {
      const params = new URLSearchParams({ symbol, token });
      const response = await fetch(`https://finnhub.io/api/v1/quote?${params.toString()}`);
      if (!response.ok) {
        attempts.push(`${symbol}:${response.status}`);
        continue;
      }
      const data = (await response.json()) as { c?: unknown; t?: unknown; error?: unknown };
      if (typeof data.error === "string" && data.error.trim()) {
        attempts.push(`${symbol}:${data.error.slice(0, 60)}`);
        continue;
      }
      const vix = toFinitePositiveNumber(data.c);
      if (vix != null) return { vix, source: "finnhub", reason: `finnhub ok: ${symbol}` };
      const ts = toFinitePositiveNumber(data.t);
      if (ts == null || ts <= 0) {
        attempts.push(`${symbol}:no_subscription_or_zero_quote`);
      } else {
        attempts.push(`${symbol}:invalid_quote`);
      }
    } catch {
      attempts.push(`${symbol}:network_error`);
    }
  }
  return { vix: null, source: "finnhub", reason: `finnhub failed (${attempts.join(", ") || "no candidates"})` };
}

async function fetchCnbcDirectQuotes(symbols: string[]): Promise<CnbcQuoteFetchResult> {
  // CNBC quote endpoint expects "|" as the multi-symbol separator.
  const symbolExpr = symbols.join("|");
  const url =
    `https://quote.cnbc.com/quote-html-webservice/quote.htm?partnerId=2&requestMethod=quick&` +
    `exthrs=1&noform=1&fund=1&output=json&players=null&symbols=${encodeURIComponent(symbolExpr)}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok) {
      const text = await response.text();
      return { ok: false, rows: {}, reason: `cnbc direct failed (${response.status}): ${text.slice(0, 120)}` };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const quickQuoteResult = data.QuickQuoteResult as Record<string, unknown> | undefined;
    const raw = quickQuoteResult?.QuickQuote;
    const list = Array.isArray(raw) ? raw : [];
    const rows: Record<string, CnbcQuoteRow> = {};
    const rejected: string[] = [];
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const symbol = String((row as Record<string, unknown>).symbol || "").toUpperCase();
      if (!symbol) continue;
      const code = String((row as Record<string, unknown>).code ?? "0");
      if (code !== "0" && code.toLowerCase() !== "success") {
        rejected.push(`${symbol}:code_${code}`);
        continue;
      }
      rows[symbol] = row as CnbcQuoteRow;
    }

    if (Object.keys(rows).length === 0 && rejected.length > 0) {
      return { ok: false, rows: {}, reason: `cnbc direct parse rejected (${rejected.join(", ")})` };
    }

    return { ok: true, rows, reason: `cnbc direct ok (${Object.keys(rows).length} quotes)` };
  } catch {
    return { ok: false, rows: {}, reason: "cnbc direct network error" };
  }
}

async function fetchCnbcRapidApiVix(): Promise<VixLookupResult> {
  const rapidEnabled = readBoolEnv("CNBC_RAPIDAPI_ENABLED", false);
  if (!rapidEnabled) {
    return { vix: null, source: "cnbc_rapidapi", reason: "cnbc rapidapi disabled" };
  }

  const key = process.env.CNBC_RAPIDAPI_KEY?.trim() || process.env.RAPID_API_KEY?.trim() || "";
  if (!key) {
    return { vix: null, source: "cnbc_rapidapi", reason: "CNBC_RAPIDAPI_KEY/RAPID_API_KEY missing" };
  }

  const host = process.env.CNBC_RAPIDAPI_HOST?.trim() || "cnbc.p.rapidapi.com";
  const endpoint = process.env.CNBC_RAPIDAPI_ENDPOINT?.trim() || "/market/get-quote";
  const symbolParam = process.env.CNBC_RAPIDAPI_SYMBOL_PARAM?.trim() || "symbol";
  const params = new URLSearchParams();
  params.set(symbolParam, ".VIX");
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
        source: "cnbc_rapidapi",
        reason: `cnbc rapidapi failed (${response.status}): ${text.slice(0, 120)}`
      };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const quickQuoteResult = data.QuickQuoteResult as Record<string, unknown> | undefined;
    const raw = quickQuoteResult?.QuickQuote;
    const rows = Array.isArray(raw) ? raw : [];
    const vixRow = rows.find((row) => {
      if (!row || typeof row !== "object") return false;
      const symbol = String((row as Record<string, unknown>).symbol || "").toUpperCase();
      return symbol === ".VIX" || symbol === "VIX";
    }) as Record<string, unknown> | undefined;
    if (!vixRow) return { vix: null, source: "cnbc_rapidapi", reason: "cnbc rapidapi parse miss: .VIX not found" };
    const vix = toFinitePositiveNumber(vixRow.last ?? vixRow.last_trade ?? vixRow.price);
    if (vix == null) return { vix: null, source: "cnbc_rapidapi", reason: "cnbc rapidapi parse miss: invalid value" };
    return { vix, source: "cnbc_rapidapi", reason: "cnbc rapidapi ok: .VIX" };
  } catch {
    return { vix: null, source: "cnbc_rapidapi", reason: "cnbc rapidapi network error" };
  }
}

function computeQuoteChangePct(row: CnbcQuoteRow): number | null {
  const percentFields = [
    "change_pct",
    "change_pct_t",
    "percent_change",
    "change_percent",
    "changePct",
    "changePercent"
  ];
  for (const field of percentFields) {
    const parsed = toFiniteNumber(row[field]);
    if (parsed != null && Math.abs(parsed) <= 100) return parsed;
  }

  const last = toFinitePositiveNumber(row.last ?? row.last_trade ?? row.price ?? row.close);
  const prev = toFinitePositiveNumber(
    row.previous_close ?? row.previous_day_closing ?? row.prev_close ?? row.close_prev
  );
  if (last != null && prev != null && prev > 0) {
    return ((last - prev) / prev) * 100;
  }
  return null;
}

function extractVixFromQuoteRows(rows: Record<string, CnbcQuoteRow>): number | null {
  const candidates = [rows[".VIX"], rows["VIX"]];
  for (const row of candidates) {
    if (!row) continue;
    const vix = toFinitePositiveNumber(row.last ?? row.last_trade ?? row.price);
    if (vix != null) return vix;
  }
  return null;
}

function extractIndexDrops(rows: Record<string, CnbcQuoteRow>): {
  worstDropPct: number | null;
  parsedRows: Array<{ symbol: string; changePct: number }>;
} {
  const symbolMap: Record<string, string[]> = {
    NASDAQ: [".IXIC", "IXIC", "COMP", "NASDAQ"],
    SPX: [".INX", "INX", ".SPX", "SPX"],
    DOW: [".DJI", "DJI", "DOW"]
  };
  const parsedRows: Array<{ symbol: string; changePct: number }> = [];

  for (const [label, aliases] of Object.entries(symbolMap)) {
    const row = aliases.map((alias) => rows[alias]).find(Boolean);
    if (!row) continue;
    const pct = computeQuoteChangePct(row);
    if (pct == null) continue;
    parsedRows.push({ symbol: label, changePct: round2(pct) });
  }

  if (parsedRows.length === 0) return { worstDropPct: null, parsedRows: [] };
  const worstDropPct = parsedRows.reduce((acc, row) => Math.min(acc, row.changePct), Number.POSITIVE_INFINITY);
  return { worstDropPct: Number.isFinite(worstDropPct) ? round2(worstDropPct) : null, parsedRows };
}

function evaluateSnapshotFreshness(snapshot: VixLookupResult, maxAgeMin: number): {
  usableVix: number | null;
  ageMin: number | null;
  diag?: string;
} {
  const ageMin = computeAgeMinutes(snapshot.modifiedTime);
  if (snapshot.vix == null) return { usableVix: null, ageMin };
  if (maxAgeMin <= 0) return { usableVix: snapshot.vix, ageMin };
  if (ageMin == null) return { usableVix: null, ageMin, diag: "snapshot stale guard: modifiedTime missing" };
  if (ageMin <= maxAgeMin) return { usableVix: snapshot.vix, ageMin };
  return { usableVix: null, ageMin, diag: `snapshot stale guard: age=${ageMin.toFixed(1)}m > max=${maxAgeMin}m` };
}

async function resolveMarketSignals(): Promise<MarketSignals> {
  const sourcePriorityRaw = (process.env.REGIME_VIX_SOURCE_PRIORITY || "realtime_first").trim().toLowerCase();
  const sourcePriority = sourcePriorityRaw === "snapshot_first" ? "snapshot_first" : "realtime_first";
  const snapshotMaxAgeMin = Math.max(0, readNumberEnv("REGIME_SNAPSHOT_MAX_AGE_MIN", 10));
  const diagnostics: string[] = [`auto source priority=${sourcePriority} snapshotMaxAge=${snapshotMaxAgeMin}m`];
  const vixReasons: string[] = [];

  let snapshot: VixLookupResult = { vix: null, source: "market_snapshot", reason: "snapshot skipped" };
  let snapshotVix: number | null = null;
  let snapshotAgeMin: number | null = null;

  if (hasValue(process.env.GDRIVE_CLIENT_ID) && hasValue(process.env.GDRIVE_CLIENT_SECRET) && hasValue(process.env.GDRIVE_REFRESH_TOKEN)) {
    try {
      const accessToken = await getGoogleAccessToken();
      snapshot = await fetchSnapshotVix(accessToken);
      diagnostics.push(`snapshot: ${snapshot.reason}`);
      const freshness = evaluateSnapshotFreshness(snapshot, snapshotMaxAgeMin);
      snapshotVix = snapshot.vix;
      snapshotAgeMin = freshness.ageMin;
      if (freshness.diag) diagnostics.push(freshness.diag);
      snapshot = { ...snapshot, vix: freshness.usableVix };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push(`snapshot auth/load failed: ${message.slice(0, 140)}`);
    }
  } else {
    diagnostics.push("snapshot skipped: gdrive oauth env missing");
  }

  const cnbcDirect = await fetchCnbcDirectQuotes([".VIX", ".IXIC", ".INX", ".DJI"]);
  diagnostics.push(`cnbc-direct: ${cnbcDirect.reason}`);
  const directVix = cnbcDirect.ok ? extractVixFromQuoteRows(cnbcDirect.rows) : null;
  const directIndex = cnbcDirect.ok ? extractIndexDrops(cnbcDirect.rows) : { worstDropPct: null, parsedRows: [] };

  const finnhub = await fetchFinnhubVix();
  diagnostics.push(`finnhub: ${finnhub.reason}`);

  const cnbcRapid = await fetchCnbcRapidApiVix();
  diagnostics.push(`cnbc-rapidapi: ${cnbcRapid.reason}`);

  let vix: number | null = null;
  let vixSource: VixSource = "env_fallback";

  if (sourcePriority === "snapshot_first") {
    if (snapshot.vix != null) {
      vix = snapshot.vix;
      vixSource = "market_snapshot";
      vixReasons.push("snapshot_first: snapshot selected");
    } else if (finnhub.vix != null) {
      vix = finnhub.vix;
      vixSource = "finnhub";
      vixReasons.push("snapshot_first: finnhub fallback selected");
    } else if (directVix != null) {
      vix = directVix;
      vixSource = "cnbc_direct";
      vixReasons.push("snapshot_first: cnbc_direct fallback selected");
    } else if (cnbcRapid.vix != null) {
      vix = cnbcRapid.vix;
      vixSource = "cnbc_rapidapi";
      vixReasons.push("snapshot_first: cnbc_rapidapi fallback selected");
    }
  } else {
    if (finnhub.vix != null) {
      vix = finnhub.vix;
      vixSource = "finnhub";
      vixReasons.push("realtime_first: finnhub selected");
    } else if (directVix != null) {
      vix = directVix;
      vixSource = "cnbc_direct";
      vixReasons.push("realtime_first: cnbc_direct fallback selected");
    } else if (cnbcRapid.vix != null) {
      vix = cnbcRapid.vix;
      vixSource = "cnbc_rapidapi";
      vixReasons.push("realtime_first: cnbc_rapidapi fallback selected");
    } else if (snapshot.vix != null) {
      vix = snapshot.vix;
      vixSource = "market_snapshot";
      vixReasons.push("realtime_first: snapshot fallback selected");
    }
  }

  if (vix == null) {
    vixReasons.push("all sources unavailable");
  }

  return {
    vix,
    vixSource,
    vixReasons,
    snapshotVix,
    snapshotAgeMin,
    indexWorstDropPct: directIndex.worstDropPct,
    indexRows: directIndex.parsedRows,
    diagnostics
  };
}

function evaluateQuality(signals: MarketSignals): GuardQuality {
  const enabled = readBoolEnv("REGIME_QUALITY_GUARD_ENABLED", true);
  const qualityMinScore = readPositiveNumberEnv(
    "GUARD_QUALITY_MIN_SCORE",
    readPositiveNumberEnv("REGIME_QUALITY_MIN_SCORE", 60)
  );
  const mismatchPctThreshold = readPositiveNumberEnv("REGIME_VIX_MISMATCH_PCT", 8);
  const useIndexDrop = readBoolEnv("GUARD_USE_INDEX_DROP", true);
  const qualityEscalateEnabled = readBoolEnv("GUARD_QUALITY_ESCALATE_ENABLED", true);
  const reasons: string[] = [];
  let score = 100;

  if (signals.vix == null) {
    score -= 60;
    reasons.push("vix_missing");
  }
  if (signals.vixSource === "market_snapshot") {
    score -= 20;
    reasons.push("realtime_source_unavailable");
  }
  if (signals.vixSource === "env_fallback") {
    score -= 35;
    reasons.push("all_vix_sources_unavailable");
  }
  if (signals.snapshotAgeMin != null && signals.snapshotAgeMin > 30) {
    score -= 10;
    reasons.push(`snapshot_age_high:${signals.snapshotAgeMin.toFixed(1)}m`);
  }
  if (useIndexDrop && signals.indexWorstDropPct == null) {
    score -= 15;
    reasons.push("index_drop_missing");
  }
  if (signals.snapshotVix != null && signals.vix != null && signals.snapshotAgeMin != null && signals.snapshotAgeMin <= 30) {
    const mismatchPct = (Math.abs(signals.vix - signals.snapshotVix) / Math.max(signals.snapshotVix, 0.01)) * 100;
    if (mismatchPct >= mismatchPctThreshold) {
      score -= 10;
      reasons.push(`vix_source_mismatch:${mismatchPct.toFixed(1)}%`);
    }
  }

  if (signals.diagnostics.some((line) => line.includes("finnhub failed"))) {
    score -= 5;
    reasons.push("finnhub_unavailable");
  }
  if (signals.diagnostics.some((line) => line.includes("snapshot stale guard"))) {
    score -= 10;
    reasons.push("snapshot_stale");
  }

  score = clamp(Math.round(score), 0, 100);
  const status: QualityStatus = score >= 80 ? "high" : score >= qualityMinScore ? "medium" : "low";
  const forceEscalate = enabled && qualityEscalateEnabled && score < qualityMinScore;

  return {
    enabled,
    minScore: qualityMinScore,
    score,
    status,
    forceEscalate,
    reasons
  };
}

function deriveProfile(vix: number | null): "default" | "risk_off" {
  const riskOffThreshold = readPositiveNumberEnv("VIX_RISK_OFF_THRESHOLD", 24);
  if (vix != null && vix >= riskOffThreshold) return "risk_off";
  return "default";
}

function deriveThresholds(profile: "default" | "risk_off", quality: GuardQuality): GuardThresholds {
  let l1Vix = readPositiveNumberEnv("GUARD_L1_VIX", 24);
  let l2Vix = readPositiveNumberEnv("GUARD_L2_VIX", 27);
  let l3Vix = readPositiveNumberEnv("GUARD_L3_VIX", 30);
  let l2Drop = readPositiveNumberEnv("GUARD_L2_INDEX_DROP_PCT", 1.8);
  let l3Drop = readPositiveNumberEnv("GUARD_L3_INDEX_DROP_PCT", 3.0);
  const notes: string[] = [];

  if (profile === "risk_off") {
    l1Vix -= 1;
    l2Vix -= 1;
    l3Vix -= 1;
    l2Drop = Math.max(0.5, l2Drop - 0.3);
    l3Drop = Math.max(0.8, l3Drop - 0.3);
    notes.push("profile=risk_off auto-tightening applied");
  }

  if (quality.forceEscalate) {
    l1Vix -= 1;
    l2Vix -= 1;
    l3Vix -= 1;
    l2Drop = Math.max(0.5, l2Drop - 0.2);
    l3Drop = Math.max(0.8, l3Drop - 0.2);
    notes.push("quality low escalation tightening applied");
  }

  l1Vix = clamp(round2(l1Vix), 10, 80);
  l2Vix = clamp(round2(Math.max(l2Vix, l1Vix + 1)), l1Vix + 1, 90);
  l3Vix = clamp(round2(Math.max(l3Vix, l2Vix + 1)), l2Vix + 1, 100);
  l2Drop = round2(clamp(l2Drop, 0.5, 20));
  l3Drop = round2(Math.max(l3Drop, l2Drop + 0.5));

  return {
    l1Vix,
    l2Vix,
    l3Vix,
    l2IndexDropPct: l2Drop,
    l3IndexDropPct: l3Drop,
    notes
  };
}

function computeVixLevel(vix: number | null, thresholds: GuardThresholds): GuardLevel {
  if (vix == null) return 0;
  if (vix >= thresholds.l3Vix) return 3;
  if (vix >= thresholds.l2Vix) return 2;
  if (vix >= thresholds.l1Vix) return 1;
  return 0;
}

function computeIndexLevel(indexWorstDropPct: number | null, thresholds: GuardThresholds, enabled: boolean): GuardLevel {
  if (!enabled || indexWorstDropPct == null) return 0;
  if (indexWorstDropPct <= -thresholds.l3IndexDropPct) return 3;
  if (indexWorstDropPct <= -thresholds.l2IndexDropPct) return 2;
  return 0;
}

function readCooldownMin(level: GuardLevel): number {
  const base = Math.max(1, readPositiveNumberEnv("GUARD_ACTION_COOLDOWN_MIN", 15));
  if (level >= 3) return Math.max(2, Math.floor(base / 2));
  if (level === 2) return base;
  if (level === 1) return Math.max(base, 15);
  return 0;
}

function actionsForLevel(level: GuardLevel): string[] {
  if (level === 0) return [];
  if (level === 1) return ["warn_risk_rising"];
  if (level === 2) return ["halt_new_entries", "cancel_open_entries", "tighten_stops"];
  return ["halt_new_entries", "cancel_open_entries", "tighten_stops", "reduce_positions_50", "flatten_if_triggered"];
}

async function fetchAlpacaClock(): Promise<{ marketOpen: boolean | null; nextOpen: string | null; reason: string }> {
  const baseUrl = (process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "");
  const keyId = (process.env.ALPACA_KEY_ID || "").trim();
  const secret = (process.env.ALPACA_SECRET_KEY || "").trim();
  if (!baseUrl || !keyId || !secret) {
    return { marketOpen: null, nextOpen: null, reason: "clock skipped: alpaca credentials missing" };
  }

  try {
    const response = await fetch(`${baseUrl}/v2/clock`, {
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secret
      }
    });
    if (!response.ok) {
      const text = await response.text();
      return { marketOpen: null, nextOpen: null, reason: `clock failed (${response.status}): ${text.slice(0, 120)}` };
    }
    const clock = (await response.json()) as Record<string, unknown>;
    const marketOpen = clock.is_open === true;
    const nextOpen = typeof clock.next_open === "string" ? clock.next_open : null;
    return { marketOpen, nextOpen, reason: "clock ok" };
  } catch {
    return { marketOpen: null, nextOpen: null, reason: "clock network error" };
  }
}

type AlpacaOrder = {
  id?: unknown;
  symbol?: unknown;
  side?: unknown;
  type?: unknown;
  status?: unknown;
  stop_price?: unknown;
};

type AlpacaPosition = {
  symbol?: unknown;
  qty?: unknown;
  current_price?: unknown;
};

function isLiveExecutionAllowed(decision: GuardDecision): { allowed: boolean; reason: string } {
  const cfg = loadRuntimeConfig();
  if (decision.mode !== "active") return { allowed: false, reason: "observe_mode" };
  if (!cfg.execEnabled) return { allowed: false, reason: "exec_disabled" };
  if (cfg.readOnly) return { allowed: false, reason: "read_only" };
  return { allowed: true, reason: "allowed" };
}

function normalizeOrderTimeInForce(raw: string, fallback: "day" | "gtc"): "day" | "gtc" {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "day" || normalized === "gtc") return normalized;
  return fallback;
}

function toQtyString(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = value.toFixed(6).replace(/\.?0+$/, "");
  if (!rounded || rounded === "0") return null;
  return rounded;
}

function orderSymbol(order: AlpacaOrder): string {
  return String(order.symbol || "").trim().toUpperCase();
}

function orderSide(order: AlpacaOrder): "buy" | "sell" | "" {
  const side = String(order.side || "").trim().toLowerCase();
  return side === "buy" || side === "sell" ? side : "";
}

function orderType(order: AlpacaOrder): string {
  return String(order.type || "").trim().toLowerCase();
}

function orderStopPrice(order: AlpacaOrder): number | null {
  return toFinitePositiveNumber(order.stop_price);
}

function positionSymbol(position: AlpacaPosition): string {
  return String(position.symbol || "").trim().toUpperCase();
}

function positionQty(position: AlpacaPosition): number | null {
  return toFiniteNumber(position.qty);
}

function positionCurrentPrice(position: AlpacaPosition): number | null {
  return toFinitePositiveNumber(position.current_price);
}

async function alpacaRequest(
  path: string,
  init: { method?: string; body?: Record<string, unknown>; expectedStatuses?: number[] } = {}
): Promise<{ status: number; data: unknown }> {
  const baseUrl = (process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "");
  const keyId = (process.env.ALPACA_KEY_ID || "").trim();
  const secret = (process.env.ALPACA_SECRET_KEY || "").trim();
  if (!baseUrl) throw new Error("ALPACA_BASE_URL missing");
  if (!keyId || !secret) throw new Error("ALPACA_KEY_ID/ALPACA_SECRET_KEY missing");

  const headers: Record<string, string> = {
    "APCA-API-KEY-ID": keyId,
    "APCA-API-SECRET-KEY": secret
  };
  if (init.body) headers["Content-Type"] = "application/json";

  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method || "GET",
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined
  });

  const text = await response.text();
  const expected = init.expectedStatuses || [200];
  if (!expected.includes(response.status)) {
    throw new Error(`alpaca ${path} failed (${response.status}): ${text.slice(0, 180)}`);
  }

  if (!text) return { status: response.status, data: null };
  try {
    return { status: response.status, data: parseJsonText<unknown>(text, `alpaca_response(${path})`) };
  } catch {
    return { status: response.status, data: text };
  }
}

async function listOpenOrders(): Promise<AlpacaOrder[]> {
  const response = await alpacaRequest("/v2/orders?status=open&nested=false&direction=desc&limit=500");
  return Array.isArray(response.data) ? (response.data as AlpacaOrder[]) : [];
}

async function listPositions(): Promise<AlpacaPosition[]> {
  const response = await alpacaRequest("/v2/positions");
  return Array.isArray(response.data) ? (response.data as AlpacaPosition[]) : [];
}

async function cancelOrder(orderId: string): Promise<void> {
  await alpacaRequest(`/v2/orders/${encodeURIComponent(orderId)}`, { method: "DELETE", expectedStatuses: [200, 204] });
}

async function patchOrder(orderId: string, patch: Record<string, unknown>): Promise<void> {
  await alpacaRequest(`/v2/orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    body: patch,
    expectedStatuses: [200]
  });
}

async function submitOrder(order: Record<string, unknown>): Promise<void> {
  await alpacaRequest("/v2/orders", { method: "POST", body: order, expectedStatuses: [200] });
}

async function writeGuardControlState(decision: GuardDecision): Promise<void> {
  const payload = {
    haltNewEntries: decision.appliedLevel >= 2,
    source: "market_guard",
    level: decision.appliedLevel,
    profile: decision.profile,
    reason: `${decision.levelReason}|${decision.actionReason}`,
    mode: decision.mode,
    shouldRunActions: decision.shouldRunActions,
    updatedAt: new Date().toISOString()
  };
  await mkdir("state", { recursive: true });
  await writeFile(GUARD_CONTROL_STATE_PATH, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[STATE] saved ${GUARD_CONTROL_STATE_PATH}`);
}

async function executeWarnRiskRising(): Promise<{ status: GuardActionStatus; detail: string }> {
  return { status: "executed", detail: "notification_only" };
}

async function executeHaltNewEntries(_decision: GuardDecision): Promise<{ status: GuardActionStatus; detail: string }> {
  return { status: "executed", detail: "guard_control_synced" };
}

async function executeCancelOpenEntries(): Promise<{ status: GuardActionStatus; detail: string }> {
  const openOrders = await listOpenOrders();
  const buyOrders = openOrders.filter((order) => orderSide(order) === "buy");
  if (buyOrders.length === 0) {
    return { status: "skipped_not_applicable", detail: "no_open_buy_orders" };
  }

  let canceled = 0;
  let failed = 0;
  for (const order of buyOrders) {
    const id = String(order.id || "").trim();
    if (!id) {
      failed += 1;
      continue;
    }
    try {
      await cancelOrder(id);
      canceled += 1;
    } catch {
      failed += 1;
    }
  }

  if (failed > 0) {
    return { status: "failed", detail: `open_buy_orders canceled=${canceled} failed=${failed}` };
  }
  return { status: "executed", detail: `open_buy_orders canceled=${canceled}` };
}

async function executeTightenStops(level: GuardLevel): Promise<{ status: GuardActionStatus; detail: string }> {
  if (!readBoolEnv("GUARD_EXECUTE_TIGHTEN_STOPS", false)) {
    return { status: "skipped_policy", detail: "GUARD_EXECUTE_TIGHTEN_STOPS=false" };
  }

  const positions = await listPositions();
  if (positions.length === 0) return { status: "skipped_not_applicable", detail: "no_positions" };
  const openOrders = await listOpenOrders();

  const tightenPctL2 = readPositiveNumberEnv("GUARD_TIGHTEN_STOP_PCT_L2", 4);
  const tightenPctL3 = readPositiveNumberEnv("GUARD_TIGHTEN_STOP_PCT_L3", 2);
  const tightenPct = level >= 3 ? tightenPctL3 : tightenPctL2;
  const tif = normalizeOrderTimeInForce(process.env.GUARD_STOP_ORDER_TIF || "day", "day");

  let patched = 0;
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const position of positions) {
    const symbol = positionSymbol(position);
    const qty = positionQty(position);
    const price = positionCurrentPrice(position);
    if (!symbol || qty == null || qty === 0 || price == null) {
      skipped += 1;
      continue;
    }

    const absQty = Math.abs(qty);
    const qtyStr = toQtyString(absQty);
    if (!qtyStr) {
      skipped += 1;
      continue;
    }

    const side: "buy" | "sell" = qty > 0 ? "sell" : "buy";
    const candidate =
      qty > 0 ? round2(Math.max(0.01, price * (1 - tightenPct / 100))) : round2(Math.max(0.01, price * (1 + tightenPct / 100)));

    const existing = openOrders
      .filter((order) => orderSymbol(order) === symbol && orderSide(order) === side)
      .filter((order) => ["stop", "stop_limit"].includes(orderType(order)))
      .filter((order) => orderStopPrice(order) != null)
      .map((order) => ({ order, stop: orderStopPrice(order) as number }));

    try {
      if (existing.length > 0) {
        const selected =
          qty > 0
            ? existing.reduce((acc, cur) => (cur.stop > acc.stop ? cur : acc))
            : existing.reduce((acc, cur) => (cur.stop < acc.stop ? cur : acc));
        const currentStop = selected.stop;
        const shouldPatch = qty > 0 ? candidate > currentStop + 0.01 : candidate < currentStop - 0.01;
        if (!shouldPatch) {
          skipped += 1;
          continue;
        }
        const orderId = String(selected.order.id || "").trim();
        if (!orderId) {
          failed += 1;
          continue;
        }
        await patchOrder(orderId, { stop_price: candidate.toFixed(2) });
        patched += 1;
      } else {
        await submitOrder({
          symbol,
          side,
          type: "stop",
          qty: qtyStr,
          stop_price: candidate.toFixed(2),
          time_in_force: tif
        });
        created += 1;
      }
    } catch {
      failed += 1;
    }
  }

  if (patched + created === 0 && failed === 0) {
    return { status: "skipped_not_applicable", detail: `tighten_pct=${tightenPct} no_updates` };
  }
  if (failed > 0) {
    return {
      status: "failed",
      detail: `tighten_pct=${tightenPct} patched=${patched} created=${created} skipped=${skipped} failed=${failed}`
    };
  }
  return {
    status: "executed",
    detail: `tighten_pct=${tightenPct} patched=${patched} created=${created} skipped=${skipped}`
  };
}

async function executeReducePositions50(): Promise<{ status: GuardActionStatus; detail: string }> {
  if (!readBoolEnv("GUARD_EXECUTE_REDUCE_POSITIONS", false)) {
    return { status: "skipped_policy", detail: "GUARD_EXECUTE_REDUCE_POSITIONS=false" };
  }

  const positions = await listPositions();
  if (positions.length === 0) return { status: "skipped_not_applicable", detail: "no_positions" };
  const tif = normalizeOrderTimeInForce(process.env.GUARD_MARKET_ORDER_TIF || "day", "day");

  let submitted = 0;
  let skipped = 0;
  let failed = 0;
  for (const position of positions) {
    const symbol = positionSymbol(position);
    const qty = positionQty(position);
    if (!symbol || qty == null || qty === 0) {
      skipped += 1;
      continue;
    }

    const reduceQty = Math.abs(qty) * 0.5;
    const qtyStr = toQtyString(reduceQty);
    if (!qtyStr) {
      skipped += 1;
      continue;
    }
    const side: "buy" | "sell" = qty > 0 ? "sell" : "buy";

    try {
      await submitOrder({
        symbol,
        side,
        type: "market",
        qty: qtyStr,
        time_in_force: tif
      });
      submitted += 1;
    } catch {
      failed += 1;
    }
  }

  if (submitted === 0 && failed === 0) {
    return { status: "skipped_not_applicable", detail: "no_reducible_positions" };
  }
  if (failed > 0) {
    return { status: "failed", detail: `reduce_50 submitted=${submitted} skipped=${skipped} failed=${failed}` };
  }
  return { status: "executed", detail: `reduce_50 submitted=${submitted} skipped=${skipped}` };
}

async function executeFlattenIfTriggered(): Promise<{ status: GuardActionStatus; detail: string }> {
  if (!readBoolEnv("GUARD_EXECUTE_FLATTEN", false)) {
    return { status: "skipped_policy", detail: "GUARD_EXECUTE_FLATTEN=false" };
  }
  const response = await alpacaRequest("/v2/positions?cancel_orders=true", {
    method: "DELETE",
    expectedStatuses: [200, 207]
  });
  const closedCount = Array.isArray(response.data) ? response.data.length : 0;
  return { status: "executed", detail: `close_all_positions requested count=${closedCount}` };
}

async function executeAction(
  action: string,
  decision: GuardDecision,
  safety: { allowed: boolean; reason: string }
): Promise<{ status: GuardActionStatus; detail: string }> {
  if (decision.mode === "observe") return { status: "planned", detail: "observe_mode" };
  if (!safety.allowed) return { status: "blocked_safety_mode", detail: safety.reason };

  if (action === "warn_risk_rising") return executeWarnRiskRising();
  if (action === "halt_new_entries") return executeHaltNewEntries(decision);
  if (action === "cancel_open_entries") return executeCancelOpenEntries();
  if (action === "tighten_stops") return executeTightenStops(decision.appliedLevel);
  if (action === "reduce_positions_50") return executeReducePositions50();
  if (action === "flatten_if_triggered") return executeFlattenIfTriggered();
  return { status: "execution_not_implemented", detail: "unknown_action" };
}

async function loadMarketGuardState(): Promise<MarketGuardState | null> {
  try {
    const raw = await readFile(MARKET_GUARD_STATE_PATH, "utf8");
    const parsed = parseJsonText<Partial<MarketGuardState>>(raw, "market_guard_state");
    if (!parsed || typeof parsed !== "object") return null;
    const level = Number(parsed.lastLevel);
    if (!Number.isInteger(level) || level < 0 || level > 3) return null;
    return {
      lastLevel: level as GuardLevel,
      lastLevelChangedAt: typeof parsed.lastLevelChangedAt === "string" ? parsed.lastLevelChangedAt : "",
      lastEvaluatedAt: typeof parsed.lastEvaluatedAt === "string" ? parsed.lastEvaluatedAt : "",
      lastActionLevel:
        Number.isInteger(Number(parsed.lastActionLevel)) && Number(parsed.lastActionLevel) >= 0 && Number(parsed.lastActionLevel) <= 3
          ? (Number(parsed.lastActionLevel) as GuardLevel)
          : 0,
      lastActionAt: typeof parsed.lastActionAt === "string" ? parsed.lastActionAt : "",
      cooldownUntil: typeof parsed.cooldownUntil === "string" ? parsed.cooldownUntil : "",
      lastSignature: typeof parsed.lastSignature === "string" ? parsed.lastSignature : "",
      lastForceSendKey: typeof parsed.lastForceSendKey === "string" ? parsed.lastForceSendKey : ""
    };
  } catch {
    return null;
  }
}

async function saveMarketGuardState(state: MarketGuardState): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(MARKET_GUARD_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  console.log(`[STATE] saved ${MARKET_GUARD_STATE_PATH}`);
}

async function loadActionLedger(): Promise<GuardActionLedgerState> {
  try {
    const raw = await readFile(GUARD_ACTION_LEDGER_PATH, "utf8");
    const parsed = parseJsonText<Partial<GuardActionLedgerState>>(raw, "guard_action_ledger");
    const actions =
      parsed && typeof parsed === "object" && parsed.actions && typeof parsed.actions === "object"
        ? (parsed.actions as GuardActionLedgerState["actions"])
        : {};
    return {
      actions,
      updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : ""
    };
  } catch {
    return { actions: {}, updatedAt: "" };
  }
}

function pruneActionLedger(state: GuardActionLedgerState, ttlDays: number): number {
  const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const [key, row] of Object.entries(state.actions)) {
    const ts = Date.parse(row.lastSeenAt);
    if (!Number.isFinite(ts) || ts < cutoff) {
      delete state.actions[key];
      removed += 1;
    }
  }
  return removed;
}

async function saveActionLedger(state: GuardActionLedgerState): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(GUARD_ACTION_LEDGER_PATH, JSON.stringify(state, null, 2), "utf8");
  console.log(`[STATE] saved ${GUARD_ACTION_LEDGER_PATH}`);
}

function buildSignature(decision: GuardDecision): string {
  return [
    `level=${decision.appliedLevel}`,
    `mode=${decision.mode}`,
    `profile=${decision.profile}`,
    `source=${decision.vixSource}`,
    `vix=${decision.vix == null ? "N/A" : decision.vix.toFixed(2)}`,
    `drop=${decision.indexWorstDropPct == null ? "N/A" : decision.indexWorstDropPct.toFixed(2)}`,
    `q=${decision.quality.score}`,
    `open=${decision.marketOpen == null ? "N/A" : decision.marketOpen}`
  ].join(";");
}

function buildDecision(
  signals: MarketSignals,
  state: MarketGuardState | null,
  marketOpen: boolean | null,
  nextOpen: string | null
): GuardDecision {
  const modeRaw = (process.env.MARKET_GUARD_MODE || "observe").trim().toLowerCase();
  const mode: "observe" | "active" = modeRaw === "active" ? "active" : "observe";
  const sourcePriorityRaw = (process.env.REGIME_VIX_SOURCE_PRIORITY || "realtime_first").trim().toLowerCase();
  const sourcePriority = sourcePriorityRaw === "snapshot_first" ? "snapshot_first" : "realtime_first";
  const allowOutsideRth = readBoolEnv("GUARD_ALLOW_OUTSIDE_RTH", false);
  const useIndexDrop = readBoolEnv("GUARD_USE_INDEX_DROP", true);
  const quality = evaluateQuality(signals);
  const profile = deriveProfile(signals.vix);
  const thresholds = deriveThresholds(profile, quality);
  const vixLevel = computeVixLevel(signals.vix, thresholds);
  const indexLevel = computeIndexLevel(signals.indexWorstDropPct, thresholds, useIndexDrop);
  let rawLevel = Math.max(vixLevel, indexLevel) as GuardLevel;

  if (quality.forceEscalate && rawLevel < 2) {
    rawLevel = 2;
  }

  const forcedLevel = parseForceLevel(process.env.GUARD_FORCE_LEVEL);
  let desiredLevel = (forcedLevel ?? rawLevel) as GuardLevel;
  let appliedLevel = desiredLevel;
  let levelReason = forcedLevel != null ? "forced_level" : "signal_level";
  let holdRemainingMin = 0;

  const deEscHoldMin = Math.max(0, readNumberEnv("GUARD_DEESCALATE_HOLD_MIN", 20));
  const previousLevel = state?.lastLevel ?? 0;
  const changedAtTs = Date.parse(state?.lastLevelChangedAt || "");
  const elapsedMin = Number.isFinite(changedAtTs) ? (Date.now() - changedAtTs) / 60000 : Number.POSITIVE_INFINITY;
  if (desiredLevel < previousLevel && elapsedMin < deEscHoldMin) {
    appliedLevel = previousLevel;
    holdRemainingMin = Math.max(0, deEscHoldMin - elapsedMin);
    levelReason = "deescalate_hold";
  } else if (desiredLevel > previousLevel) {
    levelReason = "escalation";
  } else if (desiredLevel < previousLevel) {
    levelReason = "deescalation";
  }

  const cooldownMin = readCooldownMin(appliedLevel);
  const cooldownUntilTs = Date.parse(state?.cooldownUntil || "");
  const cooldownActive = Number.isFinite(cooldownUntilTs) && Date.now() < cooldownUntilTs;
  const actions = actionsForLevel(appliedLevel);
  let shouldRunActions = actions.length > 0;
  let actionReason = "actions_allowed";

  if (!allowOutsideRth && marketOpen === false) {
    shouldRunActions = false;
    actionReason = "market_closed_guard";
  } else if (actions.length === 0) {
    shouldRunActions = false;
    actionReason = "level_zero";
  } else if (appliedLevel === previousLevel && cooldownActive) {
    shouldRunActions = false;
    actionReason = "cooldown_active";
  } else if (appliedLevel < previousLevel && levelReason === "deescalate_hold") {
    shouldRunActions = false;
    actionReason = "deescalate_hold";
  }

  return {
    mode,
    profile,
    useIndexDrop,
    sourcePriority,
    vix: signals.vix,
    vixSource: signals.vixSource,
    indexWorstDropPct: signals.indexWorstDropPct,
    quality,
    thresholds,
    vixLevel,
    indexLevel,
    rawLevel,
    forcedLevel,
    desiredLevel,
    appliedLevel,
    levelReason,
    holdRemainingMin: round2(holdRemainingMin),
    marketOpen,
    nextOpen,
    allowOutsideRth,
    cooldownMin,
    shouldRunActions,
    actionReason,
    actions,
    diagnostics: [
      ...signals.diagnostics,
      ...signals.vixReasons,
      ...thresholds.notes
    ]
  };
}

async function applyActionLedger(decision: GuardDecision): Promise<{
  upserted: number;
  updated: number;
  pruned: number;
  records: GuardActionLedgerRecord[];
}> {
  const ttlDays = Math.max(1, readPositiveNumberEnv("GUARD_ACTION_LEDGER_TTL_DAYS", 30));
  const state = await loadActionLedger();
  const pruned = pruneActionLedger(state, ttlDays);
  const now = new Date().toISOString();
  let upserted = 0;
  let updated = 0;
  const records: GuardActionLedgerRecord[] = [];
  const safety = isLiveExecutionAllowed(decision);

  if (decision.shouldRunActions) {
    for (const action of decision.actions) {
      const outcome = await executeAction(action, decision, safety);
      const key = `${decision.appliedLevel}:${action}`;
      const existing = state.actions[key];
      if (!existing) {
        const record: GuardActionLedgerRecord = {
          key,
          level: decision.appliedLevel,
          action,
          mode: decision.mode,
          status: outcome.status,
          reason: decision.actionReason,
          detail: outcome.detail,
          firstSeenAt: now,
          lastSeenAt: now,
          count: 1
        };
        state.actions[key] = record;
        upserted += 1;
        records.push(record);
      } else {
        existing.lastSeenAt = now;
        existing.count += 1;
        existing.mode = decision.mode;
        existing.status = outcome.status;
        existing.reason = decision.actionReason;
        existing.detail = outcome.detail;
        updated += 1;
        records.push(existing);
      }
    }
    state.updatedAt = now;
    await saveActionLedger(state);
  } else if (pruned > 0) {
    state.updatedAt = now;
    await saveActionLedger(state);
  }

  const executedCount = records.filter((row) => row.status === "executed").length;
  const failedCount = records.filter((row) => row.status === "failed").length;
  const blockedCount = records.filter((row) => row.status === "blocked_safety_mode").length;
  console.log(
    `[GUARD_LEDGER] upserted=${upserted} updated=${updated} pruned=${pruned} ttlDays=${ttlDays} actions=${decision.actions.length} exec_allowed=${safety.allowed} executed=${executedCount} failed=${failedCount} blocked=${blockedCount}`
  );
  return { upserted, updated, pruned, records };
}

function buildGuardMessage(decision: GuardDecision, actionResult: { records: GuardActionLedgerRecord[] }): string {
  const severity = decision.appliedLevel >= 3 ? "CRITICAL" : decision.appliedLevel >= 1 ? "WARN" : "INFO";
  const lines: string[] = [];
  lines.push("🛡️ Sidecar Market Guard");
  lines.push(`Severity: ${severity}`);
  lines.push(
    `Level: L${decision.appliedLevel} (vix=L${decision.vixLevel}, index=L${decision.indexLevel}, raw=L${decision.rawLevel}${decision.forcedLevel != null ? `, forced=L${decision.forcedLevel}` : ""})`
  );
  lines.push(
    `Reason: ${decision.levelReason} | action=${decision.actionReason} | mode=${decision.mode.toUpperCase()}`
  );
  lines.push(
    `Profile: ${decision.profile.toUpperCase()} | Source: ${decision.vixSource} | VIX: ${decision.vix == null ? "N/A" : decision.vix.toFixed(2)}`
  );
  lines.push(
    `IndexWorstDrop: ${decision.indexWorstDropPct == null ? "N/A" : `${decision.indexWorstDropPct.toFixed(2)}%`} | useIndex=${decision.useIndexDrop}`
  );
  lines.push(
    `Thresholds: VIX L1/L2/L3=${decision.thresholds.l1Vix}/${decision.thresholds.l2Vix}/${decision.thresholds.l3Vix} | IDX L2/L3=-${decision.thresholds.l2IndexDropPct}%/-${decision.thresholds.l3IndexDropPct}%`
  );
  lines.push(
    `Quality: ${decision.quality.status.toUpperCase()} (${decision.quality.score}/${decision.quality.minScore}) | forceEscalate=${decision.quality.forceEscalate}`
  );
  if (decision.quality.reasons.length > 0) {
    lines.push(`QualityReasons: ${decision.quality.reasons.join(", ")}`);
  }
  lines.push(
    `RTH: ${decision.marketOpen == null ? "N/A" : decision.marketOpen} | allowOutsideRth=${decision.allowOutsideRth} | nextOpen=${decision.nextOpen || "N/A"}`
  );
  lines.push(`Cooldown: ${decision.cooldownMin}m | holdRemaining=${decision.holdRemainingMin}m`);

  lines.push("");
  lines.push("Actions");
  if (!decision.shouldRunActions) {
    lines.push(`- none (${decision.actionReason})`);
  } else {
    for (const row of actionResult.records) {
      lines.push(`- ${row.action} | status=${row.status} | count=${row.count}${row.detail ? ` | ${row.detail}` : ""}`);
    }
  }
  return lines.join("\n");
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
        `Telegram send failed (${response.status}) chunk=${idx + 1}/${chunks.length}: ${raw.slice(0, 200)}`
      );
    }
  }
  console.log(`[${tag}] sent to ${mask(chatId)} chunks=${chunks.length}`);
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

async function sendHeartbeatOnDedupe(signature: string): Promise<void> {
  const enabled = readBoolEnv("TELEGRAM_HEARTBEAT_ON_DEDUPE", false);
  if (!enabled) return;
  const token = process.env.TELEGRAM_TOKEN || "";
  const chatId = process.env.TELEGRAM_SIMULATION_CHAT_ID || "";
  const text = ["💓 Sidecar Guard Heartbeat", "Dedupe skip: no level/action change", `Signature: ${signature}`].join("\n");
  await sendTelegramMessage(token, chatId, text, "GUARD_HEARTBEAT");
}

async function saveLastGuardRun(
  decision: GuardDecision,
  actionResult: { upserted: number; updated: number; pruned: number; records: GuardActionLedgerRecord[] },
  signature: string
): Promise<void> {
  const payload = {
    generatedAt: new Date().toISOString(),
    level: decision.appliedLevel,
    rawLevel: decision.rawLevel,
    vixLevel: decision.vixLevel,
    indexLevel: decision.indexLevel,
    levelReason: decision.levelReason,
    vix: decision.vix,
    vixSource: decision.vixSource,
    indexWorstDropPct: decision.indexWorstDropPct,
    quality: decision.quality,
    thresholds: decision.thresholds,
    marketOpen: decision.marketOpen,
    nextOpen: decision.nextOpen,
    mode: decision.mode,
    actionReason: decision.actionReason,
    shouldRunActions: decision.shouldRunActions,
    actions: decision.actions,
    actionResult,
    signature,
    diagnostics: decision.diagnostics
  };
  await mkdir("state", { recursive: true });
  await writeFile(LAST_MARKET_GUARD_PATH, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[STATE] saved ${LAST_MARKET_GUARD_PATH}`);
}

function formatNum(value: number | null): string {
  return value == null ? "N/A" : value.toFixed(2);
}

function printGuardSummary(event: "sent" | "dedupe", decision: GuardDecision, actionResult: {
  upserted: number;
  updated: number;
  pruned: number;
}): void {
  console.log(
    `[GUARD_SUMMARY] event=${event} level=L${decision.appliedLevel} raw=L${decision.rawLevel} vixLevel=L${decision.vixLevel} indexLevel=L${decision.indexLevel} source=${decision.vixSource} vix=${formatNum(decision.vix)} indexDrop=${formatNum(decision.indexWorstDropPct)} profile=${decision.profile} quality=${decision.quality.status}:${decision.quality.score}/${decision.quality.minScore} mode=${decision.mode} actions=${decision.shouldRunActions ? decision.actions.length : 0} action_reason=${decision.actionReason} ledger_upserted=${actionResult.upserted} ledger_updated=${actionResult.updated} ledger_pruned=${actionResult.pruned}`
  );
}

async function main() {
  printStartupSummary();

  const enabled = readBoolEnv("MARKET_GUARD_ENABLED", true);
  if (!enabled) {
    console.log("[MARKET_GUARD] disabled by MARKET_GUARD_ENABLED=false");
    return;
  }

  const forceSendOnce = readBoolEnv("MARKET_GUARD_FORCE_SEND_ONCE", false);

  const previous = await loadMarketGuardState();
  const intervalMin = Math.max(1, readPositiveNumberEnv("MARKET_GUARD_INTERVAL_MIN", 5));
  const lastEvalAge = computeAgeMinutes(previous?.lastEvaluatedAt);
  if (lastEvalAge != null && lastEvalAge < intervalMin && !forceSendOnce) {
    console.log(
      `[GUARD_INTERVAL] skip: lastEvaluatedAge=${lastEvalAge.toFixed(1)}m < interval=${intervalMin}m`
    );
    return;
  }

  const signals = await resolveMarketSignals();
  const clock = await fetchAlpacaClock();
  console.log(`[GUARD_CLOCK] ${clock.reason}`);

  const decision = buildDecision(signals, previous, clock.marketOpen, clock.nextOpen);
  await writeGuardControlState(decision);
  console.log(
    `[GUARD_LEVEL] applied=L${decision.appliedLevel} raw=L${decision.rawLevel} vix=L${decision.vixLevel} index=L${decision.indexLevel} reason=${decision.levelReason} action=${decision.actionReason}`
  );
  for (const line of decision.diagnostics) {
    console.log(`[GUARD_DIAG] ${line}`);
  }

  const signature = buildSignature(decision);
  const forceKey = signature;
  const forceAlreadyConsumed = previous?.lastForceSendKey === forceKey;
  const bypassDedupe = forceSendOnce && !forceAlreadyConsumed;
  if (forceSendOnce) {
    if (bypassDedupe) console.warn("[GUARD_FORCE_SEND_ONCE] bypass dedupe for one run");
    else console.warn("[GUARD_FORCE_SEND_ONCE] already consumed for current signature");
  }

  const isDedupe = previous?.lastSignature === signature && !decision.shouldRunActions && !bypassDedupe;
  if (isDedupe) {
    console.log(`[GUARD_DEDUPE] skip notify signature=${signature}`);
    await sendHeartbeatOnDedupe(signature);
    await saveLastGuardRun(
      decision,
      { upserted: 0, updated: 0, pruned: 0, records: [] },
      signature
    );
    printGuardSummary("dedupe", decision, { upserted: 0, updated: 0, pruned: 0 });
    return;
  }

  const actionResult = await applyActionLedger(decision);
  const token = process.env.TELEGRAM_TOKEN || "";
  const chatId = process.env.TELEGRAM_SIMULATION_CHAT_ID || "";
  const message = buildGuardMessage(decision, actionResult);
  await sendTelegramMessage(token, chatId, message, "GUARD_TELEGRAM");
  await saveLastGuardRun(decision, actionResult, signature);

  const nowIso = new Date().toISOString();
  const changed = !previous || previous.lastLevel !== decision.appliedLevel;
  const cooldownUntil =
    decision.shouldRunActions && decision.cooldownMin > 0
      ? new Date(Date.now() + decision.cooldownMin * 60000).toISOString()
      : previous?.cooldownUntil || "";

  const nextState: MarketGuardState = {
    lastLevel: decision.appliedLevel,
    lastLevelChangedAt: changed ? nowIso : previous?.lastLevelChangedAt || nowIso,
    lastEvaluatedAt: nowIso,
    lastActionLevel: decision.shouldRunActions ? decision.appliedLevel : previous?.lastActionLevel || 0,
    lastActionAt: decision.shouldRunActions ? nowIso : previous?.lastActionAt || "",
    cooldownUntil,
    lastSignature: signature,
    lastForceSendKey: bypassDedupe ? forceKey : previous?.lastForceSendKey || ""
  };
  await saveMarketGuardState(nextState);
  printGuardSummary("sent", decision, actionResult);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[MARKET_GUARD] FAIL ${message}`);
  process.exit(1);
});
