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
  idempotencyKey: string;
};

type DryExecSkipReason = {
  symbol: string;
  reason: string;
};

type RegimeProfile = "default" | "risk_off";

type RegimeSelection = {
  profile: RegimeProfile;
  source: "forced" | "market_snapshot" | "finnhub" | "cnbc_direct" | "cnbc_rapidapi" | "env_fallback";
  vix: number | null;
  riskOnThreshold: number;
  riskOffThreshold: number;
  diagnostics: string[];
};

type VixLookupResult = {
  vix: number | null;
  reason: string;
  modifiedTime?: string;
  source?: "market_snapshot" | "finnhub" | "cnbc_direct" | "cnbc_rapidapi" | "env_fallback";
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
  regime: RegimeSelection;
  idempotency: {
    enabled: boolean;
    enforced: boolean;
    ttlDays: number;
    newCount: number;
    duplicateCount: number;
  };
};

type SidecarRunState = {
  lastStage6Sha256: string;
  lastStage6FileId: string;
  lastStage6FileName: string;
  lastMode: string;
  lastSentAt: string;
  lastForceSendKey?: string;
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

function readNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function parseConviction(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
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

async function resolveRegimeSelection(accessToken: string): Promise<RegimeSelection> {
  const forced = (process.env.REGIME_FORCE_PROFILE || "auto").trim().toLowerCase();
  const sourcePriorityRaw = (process.env.REGIME_VIX_SOURCE_PRIORITY || "realtime_first").trim().toLowerCase();
  const sourcePriority = sourcePriorityRaw === "snapshot_first" ? "snapshot_first" : "realtime_first";
  const riskOffThreshold = readPositiveNumberEnv("VIX_RISK_OFF_THRESHOLD", 25);
  const riskOnThresholdRaw = readPositiveNumberEnv("VIX_RISK_ON_THRESHOLD", 22);
  const riskOnThreshold = Math.min(riskOnThresholdRaw, riskOffThreshold);
  const snapshotMaxAgeMin = Math.max(0, readNumberEnv("REGIME_SNAPSHOT_MAX_AGE_MIN", 10));
  const diagnostics: string[] = [];

  if (forced === "default" || forced === "risk_off") {
    return {
      profile: forced,
      source: "forced",
      vix: null,
      riskOnThreshold,
      riskOffThreshold,
      diagnostics: [`forced profile=${forced}`]
    };
  }

  if (!readBoolEnv("REGIME_AUTO_ENABLED", false)) {
    return {
      profile: "default",
      source: "env_fallback",
      vix: null,
      riskOnThreshold,
      riskOffThreshold,
      diagnostics: ["regime auto disabled (REGIME_AUTO_ENABLED=false)"]
    };
  }

  diagnostics.push(`auto source priority=${sourcePriority} snapshotMaxAge=${snapshotMaxAgeMin}m`);

  const snapshot = await fetchLatestMarketSnapshotVix(accessToken);
  if (snapshot.reason) diagnostics.push(`snapshot: ${snapshot.reason}`);
  const snapshotFresh = evaluateSnapshotFreshness(snapshot, snapshotMaxAgeMin);
  if (snapshotFresh.diag) diagnostics.push(snapshotFresh.diag);

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
    return {
      profile: "default",
      source,
      vix: null,
      riskOnThreshold,
      riskOffThreshold,
      diagnostics
    };
  }

  const profile: RegimeProfile = vix >= riskOffThreshold ? "risk_off" : "default";
  return {
    profile,
    source,
    vix,
    riskOnThreshold,
    riskOffThreshold,
    diagnostics
  };
}

async function loadLatestStage6FromDrive(accessToken: string): Promise<Stage6LoadResult> {
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

function buildDryExecPayloads(
  actionable: Stage6CandidateSummary[],
  stage6Hash: string,
  regime: RegimeSelection
): DryExecBuildResult {
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
  const minConviction = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MIN_CONVICTION",
    "DRY_RISK_OFF_MIN_CONVICTION",
    "DRY_MIN_CONVICTION",
    70
  );
  const minStopDistancePct = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MIN_STOP_DISTANCE_PCT",
    "DRY_RISK_OFF_MIN_STOP_DISTANCE_PCT",
    "DRY_MIN_STOP_DISTANCE_PCT",
    2
  );
  const maxStopDistancePct = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MAX_STOP_DISTANCE_PCT",
    "DRY_RISK_OFF_MAX_STOP_DISTANCE_PCT",
    "DRY_MAX_STOP_DISTANCE_PCT",
    25
  );
  const payloads: DryExecOrderPayload[] = [];
  const skipped: DryExecSkipReason[] = [];
  let allocatedNotional = 0;

  actionable.forEach((row) => {
    // Quality gate first: keep skip reasons deterministic and diagnosis-friendly.
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

    // Capacity / exposure gate after quality checks.
    if (payloads.length >= maxOrders) {
      skipped.push({ symbol: row.symbol, reason: "max_orders_reached" });
      return;
    }
    if (allocatedNotional + notionalPerOrder > maxTotalNotional) {
      skipped.push({ symbol: row.symbol, reason: "max_total_notional_reached" });
      return;
    }

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
      idempotencyKey: buildOrderIdempotencyKey(stage6Hash, row.symbol, "buy")
    };
    const normalized = validateAndNormalizePayload(candidatePayload);
    if (!normalized.ok) {
      skipped.push({ symbol: row.symbol, reason: normalized.reason });
      return;
    }
    payloads.push(normalized.payload);
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
    maxStopDistancePct,
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

function buildSimulationMessage(
  result: Stage6LoadResult,
  actionable: Stage6CandidateSummary[],
  dryExec: DryExecBuildResult
): string {
  const cfg = loadRuntimeConfig();
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
    `Regime: ${dryExec.regime.profile.toUpperCase()} | source=${dryExec.regime.source} | vix=${dryExec.regime.vix?.toFixed(2) ?? "N/A"} | on<=${dryExec.regime.riskOnThreshold} off>=${dryExec.regime.riskOffThreshold}`
  );
  lines.push(
    `Gate: Conv>=${dryExec.minConviction} | StopDist ${dryExec.minStopDistancePct}%~${dryExec.maxStopDistancePct}%`
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
        `${index + 1}) ${order.symbol} | LIMIT ${order.limit_price} | TP ${order.take_profit.limit_price} | SL ${order.stop_loss.stop_price} | Notional $${order.notional.toFixed(2)}`
      );
    });
  }
  if (dryExec.skipped.length > 0) {
    const skippedLog = dryExec.skipped.map((s) => `${s.symbol}:${s.reason}`).join(", ");
    lines.push(`Skipped: ${skippedLog}`);
  }
  lines.push(
    `Order Idempotency: enabled=${dryExec.idempotency.enabled} enforce=${dryExec.idempotency.enforced} ttlDays=${dryExec.idempotency.ttlDays} new=${dryExec.idempotency.newCount} duplicate=${dryExec.idempotency.duplicateCount}`
  );

  lines.push("");
  lines.push(`Mode: READ_ONLY=${cfg.readOnly}, EXEC_ENABLED=${cfg.execEnabled}`);
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

async function saveDryExecPreview(result: Stage6LoadResult, dryExec: DryExecBuildResult): Promise<void> {
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
    minStopDistancePct: dryExec.minStopDistancePct,
    maxStopDistancePct: dryExec.maxStopDistancePct,
    idempotency: dryExec.idempotency,
    payloadCount: dryExec.payloads.length,
    skippedCount: dryExec.skipped.length,
    payloads: dryExec.payloads,
    skipped: dryExec.skipped
  };
  await writeFile(DRY_EXEC_PREVIEW_PATH, JSON.stringify(preview, null, 2), "utf8");
  console.log(`[DRY_EXEC] payloads=${dryExec.payloads.length} skipped=${dryExec.skipped.length}`);
  console.log(`[STATE] saved ${DRY_EXEC_PREVIEW_PATH}`);
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

  return {
    ...dryExec,
    payloads,
    skipped,
    idempotency: {
      enabled,
      enforced,
      ttlDays,
      newCount,
      duplicateCount
    }
  };
}

function buildRunModeLabel(dryExec: DryExecBuildResult): string {
  const cfg = loadRuntimeConfig();
  const heartbeatOnDedupe = readBoolEnv("TELEGRAM_HEARTBEAT_ON_DEDUPE", false);
  const sourcePriorityRaw = (process.env.REGIME_VIX_SOURCE_PRIORITY || "realtime_first").trim().toLowerCase();
  const sourcePriority = sourcePriorityRaw === "snapshot_first" ? "snapshot_first" : "realtime_first";
  const snapshotMaxAgeMin = Math.max(0, readNumberEnv("REGIME_SNAPSHOT_MAX_AGE_MIN", 10));
  const idempotencyEnabled = readBoolEnv("ORDER_IDEMPOTENCY_ENABLED", true);
  const idempotencyEnforceDryRun = readBoolEnv("ORDER_IDEMPOTENCY_ENFORCE_DRY_RUN", false);
  const idempotencyTtlDays = Math.max(1, readPositiveNumberEnv("ORDER_IDEMPOTENCY_TTL_DAYS", 30));
  return [
    `READ_ONLY=${cfg.readOnly}`,
    `EXEC_ENABLED=${cfg.execEnabled}`,
    `PROFILE=${dryExec.regime.profile}`,
    `NOTIONAL=${dryExec.notionalPerOrder}`,
    `MAX_ORDERS=${dryExec.maxOrders}`,
    `MAX_TOTAL_NOTIONAL=${dryExec.maxTotalNotional}`,
    `MIN_CONV=${dryExec.minConviction}`,
    `STOP_MIN=${dryExec.minStopDistancePct}`,
    `STOP_MAX=${dryExec.maxStopDistancePct}`,
    `SOURCE_PRIORITY=${sourcePriority}`,
    `SNAPSHOT_MAX_AGE_MIN=${snapshotMaxAgeMin}`,
    `ORDER_IDEMP_ENABLED=${idempotencyEnabled}`,
    `ORDER_IDEMP_ENFORCE_DRY_RUN=${idempotencyEnforceDryRun}`,
    `ORDER_IDEMP_TTL_DAYS=${idempotencyTtlDays}`,
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
  dryExec: DryExecBuildResult
): void {
  console.log(
    `[RUN_SUMMARY] event=${event} stage6=${stage6.fileName} hash=${stage6.sha256.slice(0, 12)} profile=${dryExec.regime.profile} source=${dryExec.regime.source} vix=${formatVix(dryExec.regime.vix)} actionable=${actionableCount} payloads=${dryExec.payloads.length} skipped=${dryExec.skipped.length} idemp_new=${dryExec.idempotency.newCount} idemp_dup=${dryExec.idempotency.duplicateCount} idemp_enforced=${dryExec.idempotency.enforced}`
  );
}

function shouldSend(state: SidecarRunState | null, result: Stage6LoadResult, mode: string): boolean {
  if (!state) return true;
  return !(state.lastStage6Sha256 === result.sha256 && state.lastMode === mode);
}

async function main() {
  printStartupSummary();
  const accessToken = await getGoogleAccessToken();
  const stage6 = await loadLatestStage6FromDrive(accessToken);
  printStage6Lock(stage6);
  const regime = await resolveRegimeSelection(accessToken);
  const regimeVix = regime.vix == null ? "N/A" : regime.vix.toFixed(2);
  console.log(
    `[REGIME] profile=${regime.profile.toUpperCase()} source=${regime.source} vix=${regimeVix} on<=${regime.riskOnThreshold} off>=${regime.riskOffThreshold}`
  );
  if (regime.diagnostics.length > 0) {
    regime.diagnostics.forEach((line) => console.log(`[REGIME_DIAG] ${line}`));
  }
  const actionable = getActionableCandidates(stage6.candidates);
  const dryExec = buildDryExecPayloads(actionable, stage6.sha256, regime);
  const mode = buildRunModeLabel(dryExec);
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
    printRunSummary("dedupe", stage6, actionable.length, dryExec);
    return;
  }
  const finalDryExec = await applyOrderIdempotency(stage6, dryExec);
  await sendSimulationTelegram(stage6, actionable, finalDryExec);
  await saveDryExecPreview(stage6, finalDryExec);
  await saveRunState(stage6, mode, priorState, forceSendBypassDedupe ? forceSendKey : undefined);
  printRunSummary("sent", stage6, actionable.length, finalDryExec);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[DRY_RUN] FAIL ${message}`);
  process.exit(1);
});
