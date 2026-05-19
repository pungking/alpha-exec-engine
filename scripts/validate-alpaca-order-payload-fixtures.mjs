import fs from "node:fs";
import path from "node:path";

const STATE_DIR = String(process.env.ALPACA_ORDER_FIXTURE_STATE_DIR || "state").trim() || "state";
const FIXTURE_DIR = String(process.env.ALPACA_ORDER_FIXTURE_DIR || "testdata/alpaca").trim() || "testdata/alpaca";
const OUTPUT_JSON = `${STATE_DIR}/alpaca-order-payload-schema-report.json`;
const OUTPUT_MD = `${STATE_DIR}/alpaca-order-payload-schema-report.md`;

const OFFICIAL_DOCS = [
  {
    topic: "create_order_api_reference",
    url: "https://docs.alpaca.markets/us/reference/postorder",
    rules: [
      "POST /v2/orders accepts order_class values including bracket and oco for equity trading",
      "qty and notional cannot be combined",
      "notional can only work for market order types and day time_in_force",
      "take_profit and stop_loss are nested order objects"
    ]
  },
  {
    topic: "bracket_orders",
    url: "https://docs.alpaca.markets/us/docs/orders-at-alpaca#bracket-orders",
    rules: [
      "order_class must be bracket",
      "take_profit.limit_price and stop_loss.stop_price must be present",
      "extended_hours must be false or omitted",
      "time_in_force must be day or gtc",
      "nested=true returns child orders under legs"
    ]
  },
  {
    topic: "oco_orders",
    url: "https://docs.alpaca.markets/us/docs/orders-at-alpaca#oco-orders",
    rules: [
      "order_class must be oco",
      "only exit orders are supported",
      "type must always be limit",
      "stop_loss.stop_price must be present",
      "nested=true returns take-profit parent with stop-loss child"
    ]
  },
  {
    topic: "advanced_order_stop_threshold",
    url: "https://docs.alpaca.markets/us/docs/orders-at-alpaca#threshold-on-stop-price-of-stop-loss-orders",
    rules: [
      "sell stop-loss stop_price must be at least 0.01 below the base price",
      "for OCO the base includes take_profit limit and current market price",
      "for bracket limit entries the base includes entry limit and current market price"
    ]
  },
  {
    topic: "notional_order_restrictions",
    url: "https://docs.alpaca.markets/us/docs/orders-at-alpaca#notional-order-restrictions",
    rules: [
      "notional orders cannot be replaced",
      "project repair fixtures therefore use qty, not notional"
    ]
  }
];

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { __readError: error instanceof Error ? error.message : String(error) };
  }
};

const isObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const short = (value, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const countDecimals = (value) => {
  const text = String(value ?? "").trim();
  if (!text || /e/i.test(text)) return 0;
  const decimal = text.split(".")[1] || "";
  return decimal.replace(/0+$/, "").length;
};

const isPositivePrice = (value) => {
  const n = toNum(value);
  return n != null && n > 0;
};

const isPositiveQty = (value) => {
  const n = toNum(value);
  if (n == null || n <= 0) return false;
  return Number.isInteger(n);
};

const validatePriceIncrement = (field, value, errors) => {
  const n = toNum(value);
  if (n == null || n <= 0) {
    errors.push(`${field}:price_missing_or_non_positive`);
    return;
  }
  const decimals = countDecimals(value);
  const maxDecimals = n >= 1 ? 2 : 4;
  if (decimals > maxDecimals) {
    errors.push(`${field}:sub_penny_increment(decimals=${decimals},max=${maxDecimals})`);
  }
};

const validateCommonPayload = (payload, errors, warnings) => {
  if (!isObject(payload)) {
    errors.push("payload:not_object");
    return;
  }
  const symbol = String(payload.symbol || "").trim();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) errors.push("symbol:invalid_or_not_uppercase");
  if (!["buy", "sell"].includes(payload.side)) errors.push("side:must_be_buy_or_sell");
  if (!["market", "limit", "stop", "stop_limit"].includes(payload.type)) errors.push("type:unsupported_common_type");
  if (!["day", "gtc"].includes(payload.time_in_force)) errors.push("time_in_force:must_be_day_or_gtc");
  if (payload.extended_hours === true) errors.push("extended_hours:must_be_false_or_omitted_for_advanced_orders");
  if (payload.notional !== undefined) errors.push("notional:disallowed_by_project_qty_fixture_policy");
  if (!isPositiveQty(payload.qty)) errors.push("qty:required_positive_whole_share_quantity");
  if (payload.client_order_id !== undefined && !/^[A-Za-z0-9_-]{1,48}$/.test(String(payload.client_order_id))) {
    errors.push("client_order_id:invalid_format_or_too_long");
  }
  if (payload.order_class !== "bracket" && payload.order_class !== "oco") {
    errors.push("order_class:must_be_bracket_or_oco");
  }
  if (!isObject(payload.take_profit)) errors.push("take_profit:required_object");
  if (!isObject(payload.stop_loss)) errors.push("stop_loss:required_object");
  if (isObject(payload.take_profit)) validatePriceIncrement("take_profit.limit_price", payload.take_profit.limit_price, errors);
  if (isObject(payload.stop_loss)) {
    validatePriceIncrement("stop_loss.stop_price", payload.stop_loss.stop_price, errors);
    if (payload.stop_loss.limit_price !== undefined) {
      validatePriceIncrement("stop_loss.limit_price", payload.stop_loss.limit_price, errors);
      const stop = toNum(payload.stop_loss.stop_price);
      const stopLimit = toNum(payload.stop_loss.limit_price);
      if (payload.side === "sell" && stop != null && stopLimit != null && stopLimit > stop) {
        errors.push("stop_loss.limit_price:must_not_exceed_stop_price_for_sell_stop_limit");
      }
      if (payload.side === "buy" && stop != null && stopLimit != null && stopLimit < stop) {
        errors.push("stop_loss.limit_price:must_not_be_below_stop_price_for_buy_stop_limit");
      }
    }
  }
  if (payload.qty !== undefined && typeof payload.qty === "number") {
    warnings.push("qty:numeric_qty_is_accepted_by_project_validator_but_fixture_prefers_string_like_official_examples");
  }
};

const validateLongGeometry = ({ payload, reference, errors, warnings, requireEntryLimit = false, requireCurrentPrice = false }) => {
  const takeProfit = toNum(payload?.take_profit?.limit_price);
  const stop = toNum(payload?.stop_loss?.stop_price);
  const entry = toNum(payload?.limit_price ?? reference?.entryPrice);
  const current = toNum(reference?.currentPrice);
  if (takeProfit != null && stop != null && !(takeProfit > stop)) {
    errors.push("geometry:take_profit_must_exceed_stop_loss_for_long_side_sell_exits");
  }
  if (requireEntryLimit) {
    validatePriceIncrement("limit_price", payload.limit_price, errors);
    if (entry != null && takeProfit != null && !(takeProfit > entry)) errors.push("geometry:take_profit_not_above_entry");
    if (entry != null && stop != null && !(stop < entry)) errors.push("geometry:stop_loss_not_below_entry");
    if (entry != null && stop != null && entry - stop < 0.01) {
      errors.push("advanced_order_threshold:stop_less_than_0_01_below_entry_base");
    }
  }
  if (requireCurrentPrice) {
    if (current == null || current <= 0) errors.push("reference.currentPrice:required_for_oco_repair_fixture");
    if (current != null && takeProfit != null && !(takeProfit > current)) errors.push("geometry:take_profit_not_above_current_price");
    if (current != null && stop != null && !(stop < current)) errors.push("geometry:stop_loss_not_below_current_price");
    if (current != null && stop != null && current - stop < 0.01) {
      errors.push("advanced_order_threshold:stop_less_than_0_01_below_current_base");
    }
  }
  if (takeProfit != null && stop != null && takeProfit - stop < 0.01) {
    errors.push("advanced_order_threshold:stop_less_than_0_01_below_take_profit_base");
  }
  if (takeProfit != null && stop != null && takeProfit > 0 && (takeProfit - stop) / takeProfit < 0.005) {
    warnings.push("geometry:very_tight_target_stop_spread_review_before_paper_submit");
  }
};

const validateBracketEntryLong = (fixture, errors, warnings) => {
  const payload = fixture.payload;
  validateCommonPayload(payload, errors, warnings);
  if (payload?.order_class !== "bracket") errors.push("order_class:bracket_required_for_entry_fixture");
  if (payload?.side !== "buy") errors.push("side:buy_required_for_long_entry_bracket");
  if (!["limit", "market"].includes(payload?.type)) errors.push("type:bracket_entry_must_be_limit_or_market");
  if (payload?.type === "limit") validateLongGeometry({ payload, reference: fixture.reference, errors, warnings, requireEntryLimit: true });
  else validateLongGeometry({ payload, reference: fixture.reference, errors, warnings });
};

const validateOcoExitLongRepair = (fixture, errors, warnings) => {
  const payload = fixture.payload;
  validateCommonPayload(payload, errors, warnings);
  if (payload?.order_class !== "oco") errors.push("order_class:oco_required_for_repair_fixture");
  if (payload?.side !== "sell") errors.push("side:sell_required_to_exit_long_position");
  if (payload?.type !== "limit") errors.push("type:oco_must_always_be_limit");
  if (payload?.time_in_force !== "gtc") errors.push("time_in_force:gtc_required_for_persistent_repair_fixture");
  validateLongGeometry({ payload, reference: fixture.reference, errors, warnings, requireCurrentPrice: true });
};

const validateFixture = (filePath) => {
  const fixture = readJson(filePath);
  const errors = [];
  const warnings = [];
  if (fixture.__readError) {
    errors.push(`fixture:json_parse_failed:${short(fixture.__readError, 160)}`);
  }
  if (!isObject(fixture)) errors.push("fixture:not_object");
  if (fixture.schemaVersion !== "alpaca-paper-fixture-v1") errors.push("schemaVersion:must_be_alpaca-paper-fixture-v1");
  if (!isObject(fixture.docs) || !String(fixture.docs?.sourceUrl || "").includes("docs.alpaca.markets")) {
    errors.push("docs.sourceUrl:official_alpaca_doc_required");
  }
  if (!isObject(fixture.reference)) warnings.push("reference:missing_project_reference_context");

  const fixtureType = String(fixture.fixtureType || "").trim();
  if (fixtureType === "bracket_entry_long") validateBracketEntryLong(fixture, errors, warnings);
  else if (fixtureType === "oco_exit_long_repair") validateOcoExitLongRepair(fixture, errors, warnings);
  else errors.push(`fixtureType:unsupported:${fixtureType || "missing"}`);

  return {
    file: filePath,
    name: path.basename(filePath),
    fixtureType: fixtureType || null,
    orderClass: fixture?.payload?.order_class || null,
    symbol: fixture?.payload?.symbol || null,
    side: fixture?.payload?.side || null,
    type: fixture?.payload?.type || null,
    timeInForce: fixture?.payload?.time_in_force || null,
    qty: fixture?.payload?.qty ?? null,
    takeProfit: fixture?.payload?.take_profit?.limit_price ?? null,
    stopLoss: fixture?.payload?.stop_loss?.stop_price ?? null,
    status: errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    errors,
    warnings
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Alpaca Order Payload Schema Fixtures");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- mode: \`${report.executionPolicy.mode}\``);
  lines.push(
    `- summary: \`fixtures=${report.summary.fixtureCount} pass=${report.summary.passCount} warn=${report.summary.warnCount} fail=${report.summary.failCount} bracket=${report.summary.bracketEntryLongCount} ocoRepair=${report.summary.ocoExitLongRepairCount}\``
  );
  lines.push("- safety: `fixture validation only; no broker endpoint calls; no order payload emitted to Alpaca` ");
  lines.push("- official_docs:");
  for (const doc of report.officialDocs) {
    lines.push(`  - ${doc.topic}: ${doc.url}`);
  }
  lines.push("| Fixture | Type | Class | Side | Qty | TP | SL | Status | Errors | Warnings |");
  lines.push("| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |");
  for (const row of report.rows) {
    lines.push(
      `| ${row.name} | ${row.fixtureType || "N/A"} | ${row.orderClass || "N/A"} | ${row.side || "N/A"} | ${row.qty ?? "N/A"} | ${row.takeProfit ?? "N/A"} | ${row.stopLoss ?? "N/A"} | ${row.status.toUpperCase()} | ${short(row.errors.join(","), 180) || "none"} | ${short(row.warnings.join(","), 180) || "none"} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const fixturePaths = fs.existsSync(FIXTURE_DIR)
    ? fs.readdirSync(FIXTURE_DIR)
      .filter((name) => name.endsWith(".paper.fixture.json"))
      .sort()
      .map((name) => path.join(FIXTURE_DIR, name))
    : [];
  const rows = fixturePaths.map(validateFixture);
  const failCount = rows.filter((row) => row.status === "fail").length;
  const warnCount = rows.filter((row) => row.status === "warn").length;
  const passCount = rows.filter((row) => row.status === "pass").length;
  const report = {
    generatedAt: new Date().toISOString(),
    overall: fixturePaths.length === 0 || failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass",
    fixtureDir: FIXTURE_DIR,
    officialDocs: OFFICIAL_DOCS,
    executionPolicy: {
      mode: "fixture_validation_only",
      brokerMutationAllowed: false,
      autoRepairEnabled: false,
      emitsBrokerPayload: false,
      callsBrokerApi: false,
      requiresSeparateApprovalForMutation: true
    },
    summary: {
      fixtureCount: rows.length,
      passCount,
      warnCount,
      failCount,
      bracketEntryLongCount: rows.filter((row) => row.fixtureType === "bracket_entry_long").length,
      ocoExitLongRepairCount: rows.filter((row) => row.fixtureType === "oco_exit_long_repair").length,
      brokerMutationAllowed: false
    },
    rows
  };
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[ALPACA_PAYLOAD_FIXTURES] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${report.overall} fixtures=${rows.length} fail=${failCount} warn=${warnCount}`
  );
  if (report.overall === "fail") {
    process.exitCode = 1;
  }
};

main();
