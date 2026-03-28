import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const SRC_DIR = resolve(process.cwd(), "src");
const ALLOWLIST = new Set([
  resolve(SRC_DIR, "json-utils.ts")
]);

async function walkTsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkTsFiles(fullPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts")) continue;
    files.push(fullPath);
  }
  return files;
}

function findJsonParseUsages(text) {
  const lines = text.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes("JSON.parse(")) {
      hits.push({ line: i + 1, snippet: lines[i].trim() });
    }
  }
  return hits;
}

async function main() {
  const files = await walkTsFiles(SRC_DIR);
  const violations = [];

  for (const file of files) {
    if (ALLOWLIST.has(file)) continue;
    const text = await readFile(file, "utf8");
    const hits = findJsonParseUsages(text);
    for (const hit of hits) {
      violations.push({
        file,
        line: hit.line,
        snippet: hit.snippet
      });
    }
  }

  if (violations.length > 0) {
    console.error(`[JSON_PARSE_GUARD] FAIL violations=${violations.length}`);
    for (const row of violations) {
      console.error(` - ${row.file}:${row.line} ${row.snippet}`);
    }
    process.exit(1);
  }

  console.log(`[JSON_PARSE_GUARD] OK scanned=${files.length} allowlist=${ALLOWLIST.size}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[JSON_PARSE_GUARD] FAIL error=${message}`);
  process.exit(1);
});
