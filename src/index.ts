import { loadRuntimeConfig } from "../config/policy.js";
import { createHash } from "node:crypto";

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

function buildSimulationMessage(result: Stage6LoadResult): string {
  const lines: string[] = [];
  lines.push("🧪 Sidecar Dry-Run Report");
  lines.push(`Stage6: ${result.fileName}`);
  lines.push(`Hash: ${result.sha256.slice(0, 12)} | MD5: ${result.md5Checksum}`);
  lines.push(`Candidates: ${result.candidateSymbols.length}`);
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
  lines.push("Mode: READ_ONLY=true, EXEC_ENABLED=false");
  return lines.join("\n");
}

async function sendSimulationTelegram(result: Stage6LoadResult): Promise<void> {
  const token = process.env.TELEGRAM_TOKEN || "";
  const chatId = process.env.TELEGRAM_SIMULATION_CHAT_ID || "";
  const text = buildSimulationMessage(result);

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
  console.log(`[TELEGRAM_SIM] sent to ${mask(chatId)}`);
}

async function main() {
  printStartupSummary();
  const stage6 = await loadLatestStage6FromDrive();
  printStage6Lock(stage6);
  await sendSimulationTelegram(stage6);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[DRY_RUN] FAIL ${message}`);
  process.exit(1);
});
