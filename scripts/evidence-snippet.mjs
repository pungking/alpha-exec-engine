import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const args = {
    preview: resolve(process.cwd(), "state/last-dry-exec-preview.json"),
    log: resolve(process.cwd(), "state/last-run-output.log")
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = i + 1 < argv.length ? argv[i + 1] : null;
    if (token === "--preview" && next) {
      args.preview = resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (token === "--log" && next) {
      args.log = resolve(process.cwd(), next);
      i += 1;
    }
  }
  return args;
}

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

async function loadJson(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadText(path) {
  if (!existsSync(path)) return "";
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function grepLine(text, pattern) {
  const lines = text.split("\n");
  const found = lines.find((line) => pattern.test(line));
  return found ? found.trim() : "N/A";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const previewRaw = await loadJson(args.preview);
  const logRaw = await loadText(args.log);

  const preview = asObject(previewRaw);
  const hfPayloadProbeStatus = asObject(preview.hfPayloadProbeStatus);
  const hfPayloadProbeForced = asObject(preview.hfPayloadProbeForced);
  const hfVerifyGateLine = grepLine(logRaw, /\bhf_verify_gate:/i);
  const validationPackLine = grepLine(logRaw, /\[PACK\]\s+(OFF|ON|STRICT)/);
  const payloadProbeLine = grepLine(logRaw, /\[HF_PAYLOAD_PROBE_STATUS\]|\[HF_PAYLOAD_PROBE\]/);

  console.log("## Validation-pack evidence snippet");
  console.log(`- artifact/log path: \`${args.log}\``);
  console.log(`- summary snippet: \`${hfVerifyGateLine}\``);
  console.log(`- pack trace: \`${validationPackLine}\``);
  console.log("");
  console.log("## Payload-probe evidence snippet");
  console.log(`- artifact/preview path: \`${args.preview}\``);
  if (Object.keys(hfPayloadProbeStatus).length > 0) {
    console.log(
      `- summary snippet: \`status=${String(hfPayloadProbeStatus.status || "N/A")} reason=${String(hfPayloadProbeStatus.reason || "N/A")} payloads=${String(hfPayloadProbeStatus.payloads ?? "N/A")} tighten=${String(hfPayloadProbeStatus.tighten ?? "N/A")} sizeReduced=${String(hfPayloadProbeStatus.sizeReduced ?? "N/A")}\``
    );
  } else {
    console.log(`- summary snippet: \`${payloadProbeLine}\``);
  }
  if (Object.keys(hfPayloadProbeForced).length > 0) {
    console.log(
      `- forced snippet: \`mode=${String(hfPayloadProbeForced.mode || "N/A")} active=${String(hfPayloadProbeForced.active ?? "N/A")} modified=${String(hfPayloadProbeForced.modified ?? "N/A")} reason=${String(hfPayloadProbeForced.reason || "N/A")}\``
    );
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[EVIDENCE_SNIPPET] FAIL ${message}`);
  process.exit(1);
});
