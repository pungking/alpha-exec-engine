import fs from "node:fs";

const STATE_DIR = String(process.env.ORDER_STATE_CONSISTENCY_STATE_DIR || "state").trim() || "state";
const FILES = {
  ledger: `${STATE_DIR}/order-ledger.json`,
  idempotency: `${STATE_DIR}/order-idempotency.json`,
  fillability: `${STATE_DIR}/fillability-report.json`,
  performance: `${STATE_DIR}/performance-dashboard.json`
};
const OUTPUT_JSON = `${STATE_DIR}/order-state-consistency-report.json`;
const OUTPUT_MD = `${STATE_DIR}/order-state-consistency-report.md`;

const readJson = (path) => {
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const short = (value, max = 180) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const toMs = (value) => {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : 0;
};

const normalizeFillState = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "filled") return "filled";
  if (text === "partially_filled" || text === "submitted" || text === "accepted") return "open";
  if (text.startsWith("open_") || text === "idempotency_held") return "open";
  if (text === "canceled" || text === "cancelled") return "canceled";
  if (text === "expired") return "expired";
  if (text === "rejected") return "rejected";
  if (text === "terminal_unfilled") return "unfilled_terminal";
  return text;
};

const latestBySymbol = (rows, mapper) => {
  const out = new Map();
  for (const raw of rows) {
    const row = mapper(raw);
    if (!row.symbol) continue;
    const prev = out.get(row.symbol);
    if (!prev || toMs(row.at) >= toMs(prev.at)) out.set(row.symbol, row);
  }
  return out;
};

const collectRows = ({ ledger, idempotency, fillability, performance }) => {
  const ledgerBySymbol = latestBySymbol(Object.values(ledger?.orders || {}), (row) => ({
    symbol: String(row?.symbol || "").toUpperCase(),
    status: row?.status || null,
    normalized: normalizeFillState(row?.status),
    at: row?.updatedAt || row?.createdAt || null,
    reason: row?.statusReason || null
  }));
  const idempotencyBySymbol = latestBySymbol(Object.values(idempotency?.orders || {}), (row) => ({
    symbol: String(row?.symbol || "").toUpperCase(),
    status: row?.brokerStatus || null,
    normalized: normalizeFillState(row?.brokerStatus),
    at: row?.brokerCheckedAt || row?.lastSeenAt || row?.firstSeenAt || null,
    reason: row?.brokerCheckedAt ? "broker_checked" : "idempotency_state"
  }));
  const fillabilityBySymbol = latestBySymbol(Array.isArray(fillability?.rows) ? fillability.rows : [], (row) => ({
    symbol: String(row?.symbol || "").toUpperCase(),
    status: row?.status || null,
    normalized: normalizeFillState(row?.status),
    at: fillability?.generatedAt || null,
    reason: row?.reason || null
  }));
  const performanceBySymbol = latestBySymbol(Array.isArray(performance?.live?.positions) ? performance.live.positions : [], (row) => ({
    symbol: String(row?.symbol || "").toUpperCase(),
    status: row?.normalizedFillState || null,
    normalized: normalizeFillState(row?.normalizedFillState),
    at: performance?.generatedAt || null,
    reason: row?.positionStatus || null
  }));

  const symbols = new Set([
    ...ledgerBySymbol.keys(),
    ...idempotencyBySymbol.keys(),
    ...fillabilityBySymbol.keys(),
    ...performanceBySymbol.keys()
  ]);

  return [...symbols].sort().map((symbol) => {
    const states = {
      ledger: ledgerBySymbol.get(symbol) || null,
      idempotency: idempotencyBySymbol.get(symbol) || null,
      fillability: fillabilityBySymbol.get(symbol) || null,
      performance: performanceBySymbol.get(symbol) || null
    };
    const observed = Object.values(states).map((row) => row?.normalized).filter(Boolean);
    const unique = [...new Set(observed)];
    const hasFilledEvidence = observed.includes("filled");
    const missingFilledSources = hasFilledEvidence
      ? Object.entries(states)
        .filter(([, row]) => row && row.normalized !== "filled")
        .map(([source]) => source)
      : [];
    const status =
      hasFilledEvidence && (unique.length > 1 || missingFilledSources.length > 0)
        ? "FAIL"
        : unique.length > 1
          ? "WARN"
          : unique.length === 1
            ? "PASS"
            : "WARN";
    return {
      symbol,
      status,
      normalized: unique.length === 1 ? unique[0] : unique.length > 1 ? "mixed" : null,
      ledger: states.ledger?.status || null,
      idempotency: states.idempotency?.status || null,
      fillability: states.fillability?.status || null,
      performance: states.performance?.status || null,
      reasons: Object.entries(states)
        .filter(([, row]) => row?.reason)
        .map(([source, row]) => `${source}:${short(row.reason, 80)}`)
    };
  });
};

const inspectAccountRedaction = (performance) => {
  const accountNumber = performance?.live?.account?.accountNumber;
  if (!accountNumber) return { status: "PASS", detail: "account number absent or unavailable" };
  const text = String(accountNumber).trim();
  if (text.includes("*")) return { status: "PASS", detail: "account number redacted" };
  return { status: "FAIL", detail: "performance-dashboard accountNumber is not redacted" };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Order State Consistency");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${report.overall}\``);
  lines.push(
    `- files: \`ledger=${report.files.ledger ? "ok" : "missing"} idempotency=${report.files.idempotency ? "ok" : "missing"} fillability=${report.files.fillability ? "ok" : "missing"} performance=${report.files.performance ? "ok" : "missing"}\``
  );
  lines.push(`- account_redaction: \`${report.accountRedaction.status} ${report.accountRedaction.detail}\``);
  lines.push("| Symbol | Overall | Normalized | Ledger | Idempotency | Fillability | Performance | Reasons |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.rows.slice(0, 40)) {
    lines.push(
      `| ${row.symbol} | ${row.status} | ${row.normalized || "N/A"} | ${row.ledger || "N/A"} | ${row.idempotency || "N/A"} | ${row.fillability || "N/A"} | ${row.performance || "N/A"} | ${short(row.reasons.join("; "), 220) || "N/A"} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const ledger = readJson(FILES.ledger);
  const idempotency = readJson(FILES.idempotency);
  const fillability = readJson(FILES.fillability);
  const performance = readJson(FILES.performance);
  const rows = collectRows({ ledger, idempotency, fillability, performance });
  const accountRedaction = inspectAccountRedaction(performance);
  const files = {
    ledger: Boolean(ledger),
    idempotency: Boolean(idempotency),
    fillability: Boolean(fillability),
    performance: Boolean(performance)
  };
  const hardFails = rows.filter((row) => row.status === "FAIL");
  const warnRows = rows.filter((row) => row.status === "WARN");
  const missingCore = !files.ledger || !files.idempotency || !files.fillability || !files.performance;
  const overall =
    accountRedaction.status === "FAIL" || hardFails.length > 0
      ? "FAIL"
      : missingCore
        ? "WARN"
        : "PASS";
  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    files,
    accountRedaction,
    summary: {
      symbols: rows.length,
      failures: hardFails.length,
      warnings: warnRows.length + (missingCore ? 1 : 0)
    },
    rows
  };
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(`[ORDER_STATE] overall=${overall} symbols=${rows.length} failures=${hardFails.length} accountRedaction=${accountRedaction.status}`);
  if (overall === "FAIL") process.exit(1);
};

main();
