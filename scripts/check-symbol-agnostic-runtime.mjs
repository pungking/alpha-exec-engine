import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src", "scripts", ".github/workflows"];
const DEFAULT_PROOF_SYMBOLS = ["BZ", "QFIN", "ACAD", "TSLA", "JHG", "INVA", "MLI"];
const forbiddenSymbols = String(process.env.SYMBOL_AGNOSTIC_FORBIDDEN_SYMBOLS || DEFAULT_PROOF_SYMBOLS.join(","))
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);

const SELF = path.normalize("scripts/check-symbol-agnostic-runtime.mjs");
const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".json", ".yml", ".yaml"]);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const symbolRegex = forbiddenSymbols.length
  ? new RegExp(`\\b(${forbiddenSymbols.map(escapeRegex).join("|")})\\b`, "g")
  : null;

const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
};

const findings = [];
if (symbolRegex) {
  for (const root of ROOTS) {
    for (const filePath of walk(root)) {
      const normalized = path.normalize(filePath);
      if (normalized === SELF) continue;
      if (!TEXT_EXTENSIONS.has(path.extname(filePath))) continue;
      const text = fs.readFileSync(filePath, "utf8");
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        symbolRegex.lastIndex = 0;
        const matches = [...lines[index].matchAll(symbolRegex)].map((match) => match[1]);
        if (matches.length) {
          findings.push({ filePath, line: index + 1, symbols: [...new Set(matches)], text: lines[index].trim().slice(0, 240) });
        }
      }
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  overall: findings.length === 0 ? "pass" : "fail",
  scope: "runtime_code_and_workflows_only_docs_and_testdata_excluded",
  forbiddenSymbols,
  checkedRoots: ROOTS,
  findings,
  invariant: "runtime selection must be driven by Stage6, broker positions, ledgers, and submit artifacts; current proof symbols must not be hard-coded"
};

fs.mkdirSync("state", { recursive: true });
fs.writeFileSync("state/symbol-agnostic-runtime-check.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
const md = [
  "## Symbol-Agnostic Runtime Check",
  `- generatedAt: \`${report.generatedAt}\``,
  `- overall: \`${report.overall.toUpperCase()}\``,
  `- scope: \`${report.scope}\``,
  `- forbiddenSymbols: \`${forbiddenSymbols.join(",") || "N/A"}\``,
  `- findings: \`${findings.length}\``,
  "- invariant: runtime must not hard-code current proof symbols; docs/testdata may still use examples.",
  ...findings.map((row) => `  - ${row.filePath}:${row.line} symbols=${row.symbols.join(",")} text=${row.text}`),
  ""
].join("\n");
fs.writeFileSync("state/symbol-agnostic-runtime-check.md", `${md}\n`, "utf8");
console.log(`[SYMBOL_AGNOSTIC_RUNTIME_CHECK] overall=${report.overall} findings=${findings.length}`);
if (findings.length) process.exitCode = 1;
