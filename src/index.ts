import { loadRuntimeConfig } from "../config/policy.js";

function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

type EnvCheckResult = {
  missing: string[];
  warnings: string[];
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

printStartupSummary();
