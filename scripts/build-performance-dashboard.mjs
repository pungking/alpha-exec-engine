import fs from "node:fs";

const STATE_DIR = "state";
const LOOP_PATH = `${STATE_DIR}/stage6-20trade-loop.json`;
const OUTPUT_JSON = `${STATE_DIR}/performance-dashboard.json`;
const OUTPUT_MD = `${STATE_DIR}/performance-dashboard.md`;

const readJson = (path) => {
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const toIso = (value) => {
  const d = new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
};

const short = (value, max = 500) => String(value ?? "").trim().slice(0, max);

const sortByIso = (rows, key) =>
  [...rows].sort((a, b) => {
    const ax = Date.parse(a?.[key] || "");
    const bx = Date.parse(b?.[key] || "");
    if (!Number.isFinite(ax) && !Number.isFinite(bx)) return 0;
    if (!Number.isFinite(ax)) return 1;
    if (!Number.isFinite(bx)) return -1;
    return ax - bx;
  });

const normalizeLoopRows = (loop) => {
  const rowsMap = loop && typeof loop.rows === "object" ? loop.rows : {};
  return Object.values(rowsMap).map((raw) => {
    const runDate = toIso(raw?.runDate);
    const symbol = String(raw?.symbol || "").toUpperCase() || "N/A";
    const entryPlanned = toNum(raw?.entryPlanned);
    const entryFilled = toNum(raw?.entryFilled);
    const stopPlanned = toNum(raw?.stopPlanned);
    const targetPlanned = toNum(raw?.targetPlanned);
    const exitPrice = toNum(raw?.exitPrice);
    const rMultiple = toNum(raw?.RMultiple);
    const holdDaysPlanned = toNum(raw?.holdDaysPlanned);
    const holdDaysActual = toNum(raw?.holdDaysActual);
    const decisionReason = short(raw?.decisionReason || "N/A", 120);

    let status = "planned";
    if (exitPrice != null) status = "closed";
    else if (entryFilled != null) status = "open";

    const entryRef = entryFilled ?? entryPlanned;
    const returnPct = entryRef != null && exitPrice != null && entryRef > 0 ? ((exitPrice - entryRef) / entryRef) * 100 : null;
    const pnlPerUnit = entryRef != null && exitPrice != null ? exitPrice - entryRef : null;

    return {
      runDate,
      symbol,
      status,
      decisionReason,
      entryPlanned,
      entryFilled,
      stopPlanned,
      targetPlanned,
      exitPrice,
      holdDaysPlanned,
      holdDaysActual,
      rMultiple,
      returnPct,
      pnlPerUnit,
      notes: short(raw?.notes || "", 400)
    };
  });
};

const buildSimulationSummary = (loop) => {
  const rows = sortByIso(normalizeLoopRows(loop), "runDate");
  const snapshots = sortByIso(Array.isArray(loop?.snapshots) ? loop.snapshots : [], "at").map((snap) => ({
    at: toIso(snap?.at),
    tradeCount: toNum(snap?.tradeCount) ?? 0,
    filledCount: toNum(snap?.filledCount) ?? 0,
    closedCount: toNum(snap?.closedCount) ?? 0,
    fillRatePct: toNum(snap?.fillRatePct),
    avgR: toNum(snap?.avgR),
    medianHoldErrorDays: toNum(snap?.medianHoldErrorDays),
    noReasonDrift: toNum(snap?.noReasonDrift),
    kpiSource:
      typeof snap?.kpiSource === "string" && snap.kpiSource.trim()
        ? snap.kpiSource
        : "none"
  }));

  const bySymbol = new Map();
  for (const row of rows) {
    const current = bySymbol.get(row.symbol) || {
      symbol: row.symbol,
      total: 0,
      planned: 0,
      open: 0,
      closed: 0,
      latestRunDate: row.runDate,
      latest: row,
      closedReturns: [],
      closedR: []
    };
    current.total += 1;
    if (row.status === "planned") current.planned += 1;
    if (row.status === "open") current.open += 1;
    if (row.status === "closed") current.closed += 1;
    if (Date.parse(row.runDate) >= Date.parse(current.latestRunDate)) {
      current.latestRunDate = row.runDate;
      current.latest = row;
    }
    if (row.returnPct != null) current.closedReturns.push(row.returnPct);
    if (row.rMultiple != null) current.closedR.push(row.rMultiple);
    bySymbol.set(row.symbol, current);
  }

  const perSymbol = [...bySymbol.values()].map((item) => {
    const avgReturnPct =
      item.closedReturns.length > 0
        ? item.closedReturns.reduce((a, b) => a + b, 0) / item.closedReturns.length
        : null;
    const avgR = item.closedR.length > 0 ? item.closedR.reduce((a, b) => a + b, 0) / item.closedR.length : null;
    return {
      symbol: item.symbol,
      totalTrades: item.total,
      plannedTrades: item.planned,
      openTrades: item.open,
      closedTrades: item.closed,
      avgReturnPct,
      avgR,
      latestRunDate: item.latestRunDate,
      latest: item.latest
    };
  });

  const closedRows = rows.filter((row) => row.status === "closed");
  const wins = closedRows.filter((row) => (row.returnPct ?? -999) > 0).length;
  const losses = closedRows.filter((row) => (row.returnPct ?? 999) < 0).length;
  const avgClosedReturnPct =
    closedRows.length > 0
      ? closedRows.reduce((acc, row) => acc + (row.returnPct || 0), 0) / closedRows.length
      : null;
  const avgClosedR =
    closedRows.filter((row) => row.rMultiple != null).length > 0
      ? closedRows.reduce((acc, row) => acc + (row.rMultiple || 0), 0) /
      closedRows.filter((row) => row.rMultiple != null).length
      : null;

  const latestSnapshot = snapshots[snapshots.length - 1] || null;
  const latestSnapshotTradeCount =
    latestSnapshot && Number.isFinite(latestSnapshot.tradeCount) ? latestSnapshot.tradeCount : null;
  const rowVsSnapshotGap =
    latestSnapshotTradeCount != null ? rows.length - latestSnapshotTradeCount : null;
  const snapshotCoveragePct =
    latestSnapshotTradeCount != null && rows.length > 0 ? (latestSnapshotTradeCount / rows.length) * 100 : null;
  const topByReturn = [...perSymbol]
    .filter((row) => row.avgReturnPct != null)
    .sort((a, b) => (b.avgReturnPct || 0) - (a.avgReturnPct || 0));

  return {
    batchId: loop?.batchId || "N/A",
    updatedAt: toIso(loop?.updatedAt || Date.now()),
    totalRows: rows.length,
    filledRows: rows.filter((row) => row.entryFilled != null).length,
    openRows: rows.filter((row) => row.status === "open").length,
    closedRows: closedRows.length,
    wins,
    losses,
    winRatePct: closedRows.length > 0 ? (wins / closedRows.length) * 100 : null,
    avgClosedReturnPct,
    avgClosedR,
    latestSnapshot,
    latestSnapshotTradeCount,
    rowVsSnapshotGap,
    snapshotCoveragePct,
    chartSeries: snapshots,
    rows,
    perSymbol,
    topWinners: topByReturn.slice(0, 5),
    topLosers: [...topByReturn].reverse().slice(0, 5)
  };
};

const alpacaHeaders = () => ({
  "APCA-API-KEY-ID": String(process.env.ALPACA_KEY_ID || "").trim(),
  "APCA-API-SECRET-KEY": String(process.env.ALPACA_SECRET_KEY || "").trim()
});

const fetchAlpaca = async (path) => {
  const baseUrl = String(process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "");
  const headers = alpacaHeaders();
  if (!baseUrl || !headers["APCA-API-KEY-ID"] || !headers["APCA-API-SECRET-KEY"]) {
    return { ok: false, status: null, data: null, reason: "alpaca_credentials_missing" };
  }
  try {
    const response = await fetch(`${baseUrl}${path}`, { headers });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data,
        reason: `alpaca_http_${response.status}`
      };
    }
    return { ok: true, status: response.status, data, reason: "ok" };
  } catch (error) {
    return { ok: false, status: null, data: null, reason: `alpaca_network:${short(error?.message || error, 160)}` };
  }
};

const buildLiveSummary = async () => {
  const accountRes = await fetchAlpaca("/v2/account");
  const positionsRes = await fetchAlpaca("/v2/positions");
  const ordersRes = await fetchAlpaca("/v2/orders?status=open&nested=false&direction=desc&limit=500");

  if (!accountRes.ok || !positionsRes.ok || !ordersRes.ok) {
    return {
      available: false,
      reason: [accountRes.reason, positionsRes.reason, ordersRes.reason].join("|")
    };
  }

  const account = accountRes.data && typeof accountRes.data === "object" ? accountRes.data : {};
  const positions = Array.isArray(positionsRes.data) ? positionsRes.data : [];
  const openOrders = Array.isArray(ordersRes.data) ? ordersRes.data : [];

  const orderBySymbol = new Map();
  for (const order of openOrders) {
    const symbol = String(order?.symbol || "").toUpperCase();
    const side = String(order?.side || "").toLowerCase();
    if (!symbol || side !== "sell") continue;
    const type = String(order?.type || "").toLowerCase();
    const stop = toNum(order?.stop_price);
    const limit = toNum(order?.limit_price);
    const current = orderBySymbol.get(symbol) || { stopPrice: null, targetPrice: null };
    if (type === "stop" || type === "stop_limit" || type === "trailing_stop") {
      current.stopPrice = stop ?? current.stopPrice;
    }
    if (type === "limit") {
      current.targetPrice = limit ?? current.targetPrice;
    }
    orderBySymbol.set(symbol, current);
  }

  const normalizedPositions = positions.map((pos) => {
    const symbol = String(pos?.symbol || "").toUpperCase();
    const qty = toNum(pos?.qty) ?? 0;
    const avgEntry = toNum(pos?.avg_entry_price);
    const currentPrice = toNum(pos?.current_price);
    const marketValue = currentPrice != null ? qty * currentPrice : null;
    const costBasis = avgEntry != null ? qty * avgEntry : null;
    const unrealizedPl = toNum(pos?.unrealized_pl);
    const unrealizedPlPctRaw = toNum(pos?.unrealized_plpc);
    const unrealizedPlPct = unrealizedPlPctRaw != null ? unrealizedPlPctRaw * 100 : null;
    const guard = orderBySymbol.get(symbol) || { stopPrice: null, targetPrice: null };
    return {
      symbol,
      qty,
      avgEntry,
      currentPrice,
      stopPrice: guard.stopPrice,
      targetPrice: guard.targetPrice,
      marketValue,
      costBasis,
      unrealizedPl,
      unrealizedPlPct,
      holdDays: null
    };
  });

  const totalUnrealizedPl = normalizedPositions.reduce((acc, row) => acc + (row.unrealizedPl || 0), 0);
  const totalCostBasis = normalizedPositions.reduce((acc, row) => acc + (row.costBasis || 0), 0);
  const totalMarketValue = normalizedPositions.reduce((acc, row) => acc + (row.marketValue || 0), 0);

  return {
    available: true,
    account: {
      accountNumber: short(account?.account_number || "", 50),
      status: short(account?.status || "N/A", 40),
      equity: toNum(account?.equity),
      cash: toNum(account?.cash),
      buyingPower: toNum(account?.buying_power),
      daytradeCount: toNum(account?.daytrade_count)
    },
    totals: {
      positionCount: normalizedPositions.length,
      totalUnrealizedPl,
      totalCostBasis,
      totalMarketValue,
      totalReturnPct: totalCostBasis > 0 ? (totalUnrealizedPl / totalCostBasis) * 100 : null
    },
    positions: normalizedPositions.sort((a, b) => (b.unrealizedPl || 0) - (a.unrealizedPl || 0))
  };
};

const fmt = (value, digits = 2) => {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return Number(value).toFixed(digits);
};

const buildMarkdown = ({ generatedAt, simulation, live }) => {
  const lines = [];
  lines.push("## Trading Performance Dashboard");
  lines.push(`- generatedAt: \`${generatedAt}\``);
  lines.push(
    `- simulation: \`rows=${simulation.totalRows} filled=${simulation.filledRows} open=${simulation.openRows} closed=${simulation.closedRows} winRate=${fmt(simulation.winRatePct)}% avgClosedR=${fmt(simulation.avgClosedR, 4)} avgClosedReturn=${fmt(simulation.avgClosedReturnPct)}%\``
  );
  lines.push(
    `- simulation_scope: \`simRows(cumulative_loop_rows)=${simulation.totalRows} snapshotTradeCount(latest_kpi_snapshot)=${simulation.latestSnapshotTradeCount ?? "N/A"} rowSnapshotGap=${fmt(simulation.rowVsSnapshotGap, 0)} snapshotCoveragePct=${fmt(simulation.snapshotCoveragePct)}%\``
  );
  if (simulation.latestSnapshot) {
    lines.push(
      `- simulation_latest_snapshot: \`source=${simulation.latestSnapshot.kpiSource ?? "none"} tradeCount=${simulation.latestSnapshot.tradeCount} fillRatePct=${fmt(simulation.latestSnapshot.fillRatePct)} avgR=${fmt(simulation.latestSnapshot.avgR, 4)} noReasonDrift=${fmt(simulation.latestSnapshot.noReasonDrift, 0)}\``
    );
  }

  const topWinners = simulation.topWinners
    .slice(0, 3)
    .map((row) => `${row.symbol}:${fmt(row.avgReturnPct)}%`)
    .join(", ");
  const topLosers = simulation.topLosers
    .slice(0, 3)
    .map((row) => `${row.symbol}:${fmt(row.avgReturnPct)}%`)
    .join(", ");
  lines.push(`- simulation_top_winners: \`${topWinners || "N/A"}\``);
  lines.push(`- simulation_top_losers: \`${topLosers || "N/A"}\``);

  if (live?.available) {
    lines.push(
      `- live_totals: \`positions=${live.totals.positionCount} unrealizedPl=${fmt(live.totals.totalUnrealizedPl)} returnPct=${fmt(live.totals.totalReturnPct)} equity=${fmt(live.account.equity)}\``
    );
    const topLive = (live.positions || [])
      .slice(0, 5)
      .map((row) => `${row.symbol}(qty=${fmt(row.qty, 3)} uPnL=${fmt(row.unrealizedPl)} ${fmt(row.unrealizedPlPct)}%)`)
      .join(", ");
    lines.push(`- live_positions_top: \`${topLive || "N/A"}\``);
  } else {
    lines.push(`- live_totals: \`N/A (${live?.reason || "not_available"})\``);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const loop = readJson(LOOP_PATH) || {};
  const simulation = buildSimulationSummary(loop);
  const live = await buildLiveSummary();
  const generatedAt = new Date().toISOString();

  const output = {
    generatedAt,
    simulation,
    live
  };

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(output), "utf8");
  console.log(
    `[PERF_DASHBOARD] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} simRows=${simulation.totalRows} liveAvailable=${live.available}`
  );
};

main().catch((error) => {
  console.error(`[PERF_DASHBOARD] failed: ${error?.message || error}`);
  process.exit(1);
});
