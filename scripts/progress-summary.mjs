import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const trackerPath = resolve(process.cwd(), "docs/OVERALL_PROGRESS_TRACKER.md");

function ratio(done, total) {
  if (total <= 0) return 0;
  return (done / total) * 100;
}

async function main() {
  const raw = await readFile(trackerPath, "utf8");
  const lines = raw.split("\n");
  const checked = lines.filter((line) => /^\s*-\s*\[[xX]\]\s+/.test(line)).length;
  const unchecked = lines.filter((line) => /^\s*-\s*\[\s\]\s+/.test(line)).length;
  const total = checked + unchecked;
  const pct = ratio(checked, total).toFixed(1);

  if (total === 0) {
    console.log(`[PROGRESS] tracker=${trackerPath} completed=0 total=0 progress=0.0%`);
    return;
  }

  console.log(`[PROGRESS] tracker=${trackerPath} completed=${checked} total=${total} progress=${pct}%`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[PROGRESS] FAIL ${message}`);
  process.exit(1);
});
