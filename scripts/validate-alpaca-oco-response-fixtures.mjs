import fs from "node:fs";
import path from "node:path";

const STATE_DIR = String(process.env.ALPACA_OCO_RESPONSE_FIXTURE_STATE_DIR || "state").trim() || "state";
const FIXTURE_DIR = String(process.env.ALPACA_OCO_RESPONSE_FIXTURE_DIR || "testdata/alpaca").trim() || "testdata/alpaca";
const OUTPUT_JSON = `${STATE_DIR}/alpaca-oco-response-fixture-report.json`;
const OUTPUT_MD = `${STATE_DIR}/alpaca-oco-response-fixture-report.md`;

const OFFICIAL_DOCS = [
  {
    topic: "oco_orders",
    url: "https://docs.alpaca.markets/us/docs/orders-at-alpaca#oco-orders",
    rules: [
      "OCO is currently supported as an exit order after the entry position exists",
      "OCO type must be limit",
      "stop_loss.stop_price must be present",
      "nested=true returns the take-profit order as parent and stop-loss as child"
    ]
  },
  {
    topic: "get_all_orders_nested",
    url: "https://docs.alpaca.markets/us/reference/getallorders-1",
    rules: [
      "GET /v2/orders supports nested=true",
      "nested=true rolls multi-leg orders under the legs field of the primary order",
      "status open/closed/all and symbols filters are supported"
    ]
  },
  {
    topic: "create_order_api_reference",
    url: "https://docs.alpaca.markets/us/reference/postorder",
    rules: [
      "A successful order submission returns an Order object",
      "qty and notional cannot be combined",
      "order_class supports oco for equities"
    ]
  }
];

const ACTIVE_STATUSES = new Set(["new", "accepted", "pending_new", "partially_filled", "held"]);
const TERMINAL_STATUSES = new Set(["filled", "canceled", "cancelled", "expired", "rejected"]);
const SENSITIVE_FIELD_PATTERN = /^(account|account_id|account_number|api_key|secret|token|authorization|apca_api_key_id|apca_api_secret_key)$/i;
const TOKEN_LIKE_PATTERN = /(APCA|Bearer\s+|sk_live|sk_test|AKIA|-----BEGIN|[A-Za-z0-9_\-]{32,}\.[A-Za-z0-9_\-]{16,})/;

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

const asArray = (value) => (Array.isArray(value) ? value : isObject(value) ? [value] : []);

const flattenOrders = (orders, depth = 0) => {
  const out = [];
  for (const order of asArray(orders)) {
    if (!isObject(order)) continue;
    out.push({ ...order, _nestedDepth: depth });
    if (Array.isArray(order.legs)) out.push(...flattenOrders(order.legs, depth + 1));
  }
  return out;
};

const collectSensitiveFindings = (value, pathParts = []) => {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => findings.push(...collectSensitiveFindings(item, [...pathParts, String(index)])));
    return findings;
  }
  if (!isObject(value)) {
    if (typeof value === "string" && TOKEN_LIKE_PATTERN.test(value)) {
      findings.push(`${pathParts.join(".") || "root"}:token_like_value`);
    }
    return findings;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (SENSITIVE_FIELD_PATTERN.test(key)) findings.push(`${childPath.join(".")}:sensitive_field_present`);
    findings.push(...collectSensitiveFindings(child, childPath));
  }
  return findings;
};

const requireEqualString = (actual, expected, field, errors) => {
  const a = String(actual ?? "").trim();
  const e = String(expected ?? "").trim();
  if (!e) return;
  if (a !== e) errors.push(`${field}:expected_${e}_got_${a || "missing"}`);
};

const requirePositiveNumber = (value, field, errors) => {
  const n = toNum(value);
  if (n == null || n <= 0) errors.push(`${field}:missing_or_non_positive`);
  return n;
};

const sameNumber = (actual, expected) => {
  const a = toNum(actual);
  const e = toNum(expected);
  if (a == null || e == null) return false;
  return Math.abs(a - e) < 0.000001;
};

const findTakeProfitParent = (orders, reference) => {
  const symbol = String(reference?.symbol || "").toUpperCase();
  const side = String(reference?.expectedExitSide || "sell").toLowerCase();
  const target = toNum(reference?.takeProfitLimitPrice);
  return orders.find((order) => {
    const orderSymbol = String(order?.symbol || "").toUpperCase();
    const orderSide = String(order?.side || "").toLowerCase();
    const type = String(order?.type || order?.order_type || "").toLowerCase();
    const orderClass = String(order?.order_class || "").toLowerCase();
    const limit = toNum(order?.limit_price);
    const depth = toNum(order?._nestedDepth) ?? 0;
    return (
      depth === 0 &&
      orderSymbol === symbol &&
      orderSide === side &&
      type === "limit" &&
      orderClass === "oco" &&
      target != null &&
      limit != null &&
      Math.abs(limit - target) < 0.000001
    );
  });
};

const findStopLossChild = (parent, flattened, reference) => {
  const symbol = String(reference?.symbol || "").toUpperCase();
  const side = String(reference?.expectedExitSide || "sell").toLowerCase();
  const stop = toNum(reference?.stopLossStopPrice);
  const parentId = String(parent?.id || "").trim();
  const parentLegs = flattenOrders(parent?.legs || [], 1);
  const candidates = parentLegs.length > 0 ? parentLegs : flattened.filter((row) => String(row?.parent_order_id || "") === parentId);
  return candidates.find((order) => {
    const orderSymbol = String(order?.symbol || "").toUpperCase();
    const orderSide = String(order?.side || "").toLowerCase();
    const type = String(order?.type || order?.order_type || "").toLowerCase();
    const orderClass = String(order?.order_class || parent?.order_class || "").toLowerCase();
    const stopPrice = toNum(order?.stop_price);
    return (
      orderSymbol === symbol &&
      orderSide === side &&
      (type === "stop" || type === "stop_limit") &&
      (orderClass === "oco" || orderClass === "") &&
      stop != null &&
      stopPrice != null &&
      Math.abs(stopPrice - stop) < 0.000001
    );
  });
};

const validateFixture = (filePath) => {
  const fixture = readJson(filePath);
  const errors = [];
  const warnings = [];
  if (fixture.__readError) errors.push(`fixture:json_parse_failed:${short(fixture.__readError, 160)}`);
  if (!isObject(fixture)) errors.push("fixture:not_object");
  if (fixture.schemaVersion !== "alpaca-paper-response-fixture-v1") {
    errors.push("schemaVersion:must_be_alpaca-paper-response-fixture-v1");
  }
  if (fixture.fixtureType !== "oco_repair_nested_open_long") {
    errors.push(`fixtureType:unsupported:${fixture.fixtureType || "missing"}`);
  }
  const docsUrls = Array.isArray(fixture?.docs?.sourceUrls) ? fixture.docs.sourceUrls : [];
  if (!docsUrls.some((url) => String(url).includes("docs.alpaca.markets"))) {
    errors.push("docs.sourceUrls:official_alpaca_doc_required");
  }
  const sensitive = collectSensitiveFindings(fixture);
  if (sensitive.length > 0) errors.push(...sensitive.slice(0, 10));
  const reference = fixture.reference || {};
  const responseOrders = asArray(fixture.response);
  if (responseOrders.length === 0) errors.push("response:missing_order_or_order_array");
  const flattened = flattenOrders(responseOrders);
  const parent = findTakeProfitParent(flattened, reference);
  if (!parent) errors.push("oco_parent_take_profit:missing_from_nested_response");
  const child = parent ? findStopLossChild(parent, flattened, reference) : null;
  if (parent && !child) errors.push("oco_stop_loss_child:missing_from_parent_legs_or_parent_order_id");

  if (parent) {
    requireEqualString(parent.symbol, reference.symbol, "parent.symbol", errors);
    requireEqualString(parent.side, reference.expectedExitSide || "sell", "parent.side", errors);
    requireEqualString(parent.type || parent.order_type, "limit", "parent.type", errors);
    requireEqualString(parent.order_class, "oco", "parent.order_class", errors);
    requireEqualString(parent.time_in_force, "gtc", "parent.time_in_force", errors);
    if (!sameNumber(parent.qty, reference.qty)) errors.push("parent.qty:does_not_match_reference_qty");
    if (!sameNumber(parent.limit_price, reference.takeProfitLimitPrice)) {
      errors.push("parent.limit_price:does_not_match_reference_take_profit");
    }
    const status = String(parent.status || "").toLowerCase();
    if (!ACTIVE_STATUSES.has(status)) errors.push(`parent.status:not_active_for_open_oco(${status || "missing"})`);
    if (TERMINAL_STATUSES.has(status)) errors.push(`parent.status:terminal_unexpected(${status})`);
    if (parent.extended_hours === true) errors.push("parent.extended_hours:must_be_false_or_omitted");
    requirePositiveNumber(parent.id ? 1 : null, "parent.id", errors);
  }

  if (child) {
    requireEqualString(child.symbol, reference.symbol, "child.symbol", errors);
    requireEqualString(child.side, reference.expectedExitSide || "sell", "child.side", errors);
    const childType = String(child.type || child.order_type || "").toLowerCase();
    if (childType !== "stop" && childType !== "stop_limit") errors.push(`child.type:must_be_stop_or_stop_limit(${childType || "missing"})`);
    requireEqualString(child.time_in_force, "gtc", "child.time_in_force", errors);
    if (!sameNumber(child.qty, reference.qty)) errors.push("child.qty:does_not_match_reference_qty");
    if (!sameNumber(child.stop_price, reference.stopLossStopPrice)) {
      errors.push("child.stop_price:does_not_match_reference_stop_loss");
    }
    const status = String(child.status || "").toLowerCase();
    if (!ACTIVE_STATUSES.has(status)) errors.push(`child.status:not_active_for_open_oco(${status || "missing"})`);
    if (child.extended_hours === true) errors.push("child.extended_hours:must_be_false_or_omitted");
    if (parent?.id && child.parent_order_id && String(child.parent_order_id) !== String(parent.id)) {
      errors.push("child.parent_order_id:does_not_match_parent_id");
    }
  }

  const target = toNum(reference.takeProfitLimitPrice);
  const stop = toNum(reference.stopLossStopPrice);
  if (target != null && stop != null && !(target > stop)) errors.push("geometry:take_profit_must_exceed_stop_loss_for_long_exit");
  if (target != null && stop != null && target - stop < 0.01) errors.push("threshold:stop_less_than_0_01_below_take_profit_base");

  return {
    file: filePath,
    name: path.basename(filePath),
    fixtureType: fixture.fixtureType || null,
    symbol: reference.symbol || null,
    qty: reference.qty || null,
    parentId: parent?.id || null,
    childId: child?.id || null,
    parentStatus: parent?.status || null,
    childStatus: child?.status || null,
    nestedLegCount: parent && Array.isArray(parent.legs) ? parent.legs.length : 0,
    flattenedOrderCount: flattened.length,
    status: errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    errors,
    warnings
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Alpaca OCO Response Fixture Validation");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(`- mode: \`${report.executionPolicy.mode}\``);
  lines.push(
    `- summary: \`fixtures=${report.summary.fixtureCount} pass=${report.summary.passCount} warn=${report.summary.warnCount} fail=${report.summary.failCount} nestedOco=${report.summary.nestedOcoLongCount}\``
  );
  lines.push("- safety: `response fixture validation only; no broker endpoint calls; no repair submit` ");
  lines.push("- official_docs:");
  for (const doc of report.officialDocs) lines.push(`  - ${doc.topic}: ${doc.url}`);
  lines.push("| Fixture | Symbol | Qty | Parent | Child | Parent Status | Child Status | Legs | Status | Errors | Warnings |");
  lines.push("| --- | --- | ---: | --- | --- | --- | --- | ---: | --- | --- | --- |");
  for (const row of report.rows) {
    lines.push(
      `| ${row.name} | ${row.symbol || "N/A"} | ${row.qty ?? "N/A"} | ${short(row.parentId, 24) || "N/A"} | ${short(row.childId, 24) || "N/A"} | ${row.parentStatus || "N/A"} | ${row.childStatus || "N/A"} | ${row.nestedLegCount ?? "N/A"} | ${row.status.toUpperCase()} | ${short(row.errors.join(","), 180) || "none"} | ${short(row.warnings.join(","), 180) || "none"} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const fixturePaths = fs.existsSync(FIXTURE_DIR)
    ? fs.readdirSync(FIXTURE_DIR)
      .filter((name) => name.endsWith(".paper-response.fixture.json"))
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
      mode: "response_fixture_validation_only",
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
      nestedOcoLongCount: rows.filter((row) => row.fixtureType === "oco_repair_nested_open_long").length,
      brokerMutationAllowed: false
    },
    rows
  };
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[ALPACA_OCO_RESPONSE_FIXTURES] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${report.overall} fixtures=${rows.length} fail=${failCount} warn=${warnCount}`
  );
  if (report.overall === "fail") process.exitCode = 1;
};

main();
