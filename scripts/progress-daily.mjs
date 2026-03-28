import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const trackerPath = resolve(process.cwd(), "docs/OVERALL_PROGRESS_TRACKER.md");
const evidencePath = resolve(process.cwd(), "docs/OVERALL_PROGRESS_EVIDENCE.md");

function parseChecklist(lines) {
  const checked = [];
  const unchecked = [];
  for (const line of lines) {
    const checkedMatch = line.match(/^\s*-\s*\[[xX]\]\s+(.+)$/);
    if (checkedMatch) {
      checked.push(checkedMatch[1].trim());
      continue;
    }
    const uncheckedMatch = line.match(/^\s*-\s*\[\s\]\s+(.+)$/);
    if (uncheckedMatch) {
      unchecked.push(uncheckedMatch[1].trim());
    }
  }
  return { checked, unchecked };
}

function pct(done, total) {
  if (total <= 0) return "0.0";
  return ((done / total) * 100).toFixed(1);
}

async function main() {
  const trackerRaw = await readFile(trackerPath, "utf8");
  const evidenceRaw = await readFile(evidencePath, "utf8");

  const tracker = parseChecklist(trackerRaw.split("\n"));
  const evidence = parseChecklist(evidenceRaw.split("\n"));
  const total = tracker.checked.length + tracker.unchecked.length;

  console.log(
    `[PROGRESS_DAILY] overall=${tracker.checked.length}/${total} (${pct(tracker.checked.length, total)}%) ` +
      `pending=${tracker.unchecked.length}`
  );

  if (tracker.unchecked.length > 0) {
    console.log("[PROGRESS_DAILY] pending_items:");
    for (const item of tracker.unchecked) {
      console.log(` - ${item}`);
    }
  }

  const evidenceTotal = evidence.checked.length + evidence.unchecked.length;
  console.log(
    `[PROGRESS_DAILY] evidence=${evidence.checked.length}/${evidenceTotal} (${pct(evidence.checked.length, evidenceTotal)}%)`
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[PROGRESS_DAILY] FAIL ${message}`);
  process.exit(1);
});
