import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const STATE_DIR = "state";
const OUTPUT_JSON = `${STATE_DIR}/ops-daily-report.json`;
const OUTPUT_MD = `${STATE_DIR}/ops-daily-report.md`;

const env = (name, fallback = "") => String(process.env[name] ?? fallback).trim();
const toNum = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const now = () => new Date();
const nowIso = () => now().toISOString();
const fmtPct = (num, den) => (den > 0 ? `${((num / den) * 100).toFixed(1)}%` : "N/A");
const safeJsonRead = (path) => {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const writeJson = (path, data) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
};

const writeText = (path, text) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path, text, "utf8");
};

const parseRepo = (value, fallback) => {
  const raw = value || fallback;
  const [owner, repo] = raw.split("/").map((v) => v.trim());
  if (!owner || !repo) return null;
  return { owner, repo };
};

const parseIso = (value) => {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : NaN;
};

const makeKst = (date) => {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
};

const parseCanaryVerifyMetrics = (text) => {
  const regex =
    /\[PREFLIGHT_CANARY_VERIFY\]\s+preflight_pass=(true|false)\s+attempted=(\d+)\s+submitted=(\d+)/g;
  let hit = null;
  let match = regex.exec(text);
  while (match) {
    hit = match;
    match = regex.exec(text);
  }
  if (!hit) return null;
  const preflightPass = String(hit[1]).toLowerCase() === "true";
  const attempted = Number(hit[2]);
  const submitted = Number(hit[3]);
  if (!Number.isFinite(attempted) || !Number.isFinite(submitted)) return null;
  return {
    preflightPass,
    attempted,
    submitted,
    submitPass: attempted >= 1 && submitted >= 1
  };
};

const fetchRunLogText = async ({ token, owner, repo, runId }) => {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(String(runId))}/logs`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      redirect: "follow"
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`logs_fetch_failed(${response.status}): ${String(text).slice(0, 180)}`);
  }

  const zipBuffer = Buffer.from(await response.arrayBuffer());
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-daily-canary-logs-"));
  const zipPath = path.join(tmpDir, `run-${runId}.zip`);
  try {
    fs.writeFileSync(zipPath, zipBuffer);
    const unzip = spawnSync("unzip", ["-p", zipPath], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    });
    if (unzip.status !== 0) {
      const stderr = String(unzip.stderr || "").trim();
      throw new Error(`unzip_failed:${stderr.slice(0, 180) || "unknown"}`);
    }
    return String(unzip.stdout || "");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

const collectCanaryVerificationMetrics = async ({ token, repo, completedRuns, maxInspect }) => {
  const inspectRuns = completedRuns
    .filter((run) => run?.conclusion === "success")
    .slice(0, Math.max(1, maxInspect));
  const perRun = [];
  const totals = {
    inspected: inspectRuns.length,
    parsed: 0,
    preflightPassRuns: 0,
    submitPassRuns: 0,
    attemptedTotal: 0,
    submittedTotal: 0
  };
  for (const run of inspectRuns) {
    const row = {
      id: run.id,
      runNumber: run.run_number,
      htmlUrl: run.html_url,
      parsed: false,
      preflightPass: null,
      attempted: null,
      submitted: null,
      submitPass: null,
      reason: "not_checked"
    };
    try {
      const text = await fetchRunLogText({
        token,
        owner: repo.owner,
        repo: repo.repo,
        runId: run.id
      });
      const metrics = parseCanaryVerifyMetrics(text);
      if (!metrics) {
        row.reason = "verify_marker_not_found";
      } else {
        row.parsed = true;
        row.reason = "ok";
        row.preflightPass = metrics.preflightPass;
        row.attempted = metrics.attempted;
        row.submitted = metrics.submitted;
        row.submitPass = metrics.submitPass;
        totals.parsed += 1;
        if (metrics.preflightPass) totals.preflightPassRuns += 1;
        if (metrics.submitPass) totals.submitPassRuns += 1;
        totals.attemptedTotal += metrics.attempted;
        totals.submittedTotal += metrics.submitted;
      }
    } catch (error) {
      row.reason = error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180);
    }
    perRun.push(row);
  }
  return {
    ...totals,
    preflightPassRatePct:
      totals.parsed > 0 ? Number(((totals.preflightPassRuns / totals.parsed) * 100).toFixed(2)) : null,
    submitPassRatePct:
      totals.parsed > 0 ? Number(((totals.submitPassRuns / totals.parsed) * 100).toFixed(2)) : null,
    submitSuccessRatePct:
      totals.attemptedTotal > 0
        ? Number(((totals.submittedTotal / totals.attemptedTotal) * 100).toFixed(2))
        : null,
    perRun
  };
};

const parseDryRunExecutionMetrics = (text) => {
  const preflightMatch = text.match(/\[PREFLIGHT\]\s+status=(PASS|FAIL)\s+code=([A-Z0-9_:-]+)/);
  const submitMatch = text.match(
    /\[BROKER_SUBMIT\][^\n]*attempted=(\d+)\s+submitted=(\d+)\s+failed=(\d+)\s+skipped=(\d+)/
  );
  const preflightStatus = preflightMatch ? preflightMatch[1] : null;
  const preflightCode = preflightMatch ? preflightMatch[2] : null;
  const attempted = submitMatch ? Number(submitMatch[1]) : 0;
  const submitted = submitMatch ? Number(submitMatch[2]) : 0;
  const failed = submitMatch ? Number(submitMatch[3]) : 0;
  const skipped = submitMatch ? Number(submitMatch[4]) : 0;
  const preflightPass = preflightStatus === "PASS";
  const submitPass = attempted >= 1 && submitted >= 1;
  const status = preflightPass && submitPass
    ? "READY"
    : preflightCode === "PREFLIGHT_MARKET_CLOSED"
      ? "BLOCKED_MARKET_CLOSED"
      : preflightStatus
        ? "BLOCKED_GATES"
        : "UNKNOWN";
  return {
    parsed: Boolean(preflightMatch || submitMatch),
    preflightStatus,
    preflightCode,
    preflightPass,
    attempted,
    submitted,
    failed,
    skipped,
    submitPass,
    status
  };
};

const parseGuardSummaryMetrics = (text) => {
  const lineMatch = text.match(/\[GUARD_SUMMARY\][^\n]*/);
  if (!lineMatch) {
    return {
      parsed: false,
      level: null,
      mode: null,
      source: null,
      vix: null,
      actionReason: null
    };
  }
  const line = lineMatch[0];
  const take = (regex) => {
    const hit = line.match(regex);
    return hit ? hit[1] : null;
  };
  const vixRaw = take(/vix=([0-9.\-]+)/);
  const vix = vixRaw != null && Number.isFinite(Number(vixRaw)) ? Number(vixRaw) : null;
  return {
    parsed: true,
    level: take(/level=(L[0-3])/),
    mode: take(/mode=([a-z_]+)/i),
    source: take(/source=([a-z_]+)/i),
    vix,
    actionReason: take(/action_reason=([a-z0-9_:-]+)/i)
  };
};

const collectLatestDryRunExecutionMetrics = async ({ token, repo, completedRuns }) => {
  const latest = completedRuns[0] || null;
  if (!latest) {
    return {
      inspected: false,
      runId: null,
      runNumber: null,
      htmlUrl: null,
      parsed: false,
      preflightStatus: null,
      preflightCode: null,
      preflightPass: false,
      attempted: 0,
      submitted: 0,
      failed: 0,
      skipped: 0,
      submitPass: false,
      status: "UNKNOWN",
      reason: "no_completed_dry_run"
    };
  }
  try {
    const text = await fetchRunLogText({
      token,
      owner: repo.owner,
      repo: repo.repo,
      runId: latest.id
    });
    const parsed = parseDryRunExecutionMetrics(text);
    return {
      inspected: true,
      runId: latest.id,
      runNumber: latest.run_number,
      htmlUrl: latest.html_url,
      ...parsed,
      reason: parsed.parsed ? "ok" : "markers_not_found"
    };
  } catch (error) {
    return {
      inspected: true,
      runId: latest.id,
      runNumber: latest.run_number,
      htmlUrl: latest.html_url,
      parsed: false,
      preflightStatus: null,
      preflightCode: null,
      preflightPass: false,
      attempted: 0,
      submitted: 0,
      failed: 0,
      skipped: 0,
      submitPass: false,
      status: "UNKNOWN",
      reason: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)
    };
  }
};

const collectLatestGuardSummary = async ({ token, repo, completedRuns }) => {
  const latest = completedRuns[0] || null;
  if (!latest) {
    return {
      inspected: false,
      runId: null,
      runNumber: null,
      htmlUrl: null,
      parsed: false,
      level: null,
      mode: null,
      source: null,
      vix: null,
      actionReason: null,
      reason: "no_completed_guard_run"
    };
  }
  try {
    const text = await fetchRunLogText({
      token,
      owner: repo.owner,
      repo: repo.repo,
      runId: latest.id
    });
    const parsed = parseGuardSummaryMetrics(text);
    return {
      inspected: true,
      runId: latest.id,
      runNumber: latest.run_number,
      htmlUrl: latest.html_url,
      ...parsed,
      reason: parsed.parsed ? "ok" : "guard_summary_marker_not_found"
    };
  } catch (error) {
    return {
      inspected: true,
      runId: latest.id,
      runNumber: latest.run_number,
      htmlUrl: latest.html_url,
      parsed: false,
      level: null,
      mode: null,
      source: null,
      vix: null,
      actionReason: null,
      reason: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)
    };
  }
};

const fetchRuns = async ({ token, owner, repo, workflow, perPage }) => {
  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/runs`
  );
  url.searchParams.set("per_page", String(perPage));

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message = String(data?.message || text || "unknown").slice(0, 280);
    throw new Error(`GitHub API failed (${response.status}): ${message}`);
  }

  return Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
};

const summarizeRuns = (runs, sinceMs) => {
  const scoped = runs.filter((run) => {
    const createdMs = parseIso(run?.created_at);
    return Number.isFinite(createdMs) && createdMs >= sinceMs;
  });

  const completed = scoped.filter((run) => run?.status === "completed");
  const success = completed.filter((run) => run?.conclusion === "success");
  const failed = completed.filter((run) => run?.conclusion && run?.conclusion !== "success");

  return {
    scanned: runs.length,
    inWindow: scoped.length,
    completed: completed.length,
    success: success.length,
    failed: failed.length,
    successRatePct: completed.length > 0 ? Number(((success.length / completed.length) * 100).toFixed(2)) : null,
    latest: scoped.slice(0, 5).map((run) => ({
      id: run.id,
      runNumber: run.run_number,
      status: run.status,
      conclusion: run.conclusion,
      event: run.event,
      createdAt: run.created_at,
      htmlUrl: run.html_url,
      displayTitle: run.display_title || ""
    }))
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Ops Daily Report (Auto)");
  lines.push(`- generatedAtUTC: \`${report.generatedAt}\``);
  lines.push(`- generatedAtKST: \`${report.generatedAtKst}\``);
  lines.push(`- windowHours: \`${report.windowHours}\``);
  lines.push(`- windowStartUTC: \`${report.windowStartUtc}\``);
  lines.push(`- overallStatus: \`${report.status.toUpperCase()}\``);
  if (report.reason) lines.push(`- reason: \`${report.reason}\``);
  lines.push("");

  lines.push("### GitHub Workflow KPIs");
  lines.push(
    `- canary: success \`${report.canary.success}/${report.canary.completed}\` (${fmtPct(report.canary.success, report.canary.completed)}) | inWindow=\`${report.canary.inWindow}\``
  );
  lines.push(
    `- dryrun: success \`${report.dryRun.success}/${report.dryRun.completed}\` (${fmtPct(report.dryRun.success, report.dryRun.completed)}) | inWindow=\`${report.dryRun.inWindow}\``
  );
  lines.push(
    `- canary_verify: parsed=\`${report.canaryVerify.parsed}/${report.canaryVerify.inspected}\` preflight_pass=\`${report.canaryVerify.preflightPassRuns}/${report.canaryVerify.parsed || 0}\` submit_pass=\`${report.canaryVerify.submitPassRuns}/${report.canaryVerify.parsed || 0}\` attempted=\`${report.canaryVerify.attemptedTotal}\` submitted=\`${report.canaryVerify.submittedTotal}\``
  );
  lines.push(
    `- canary_freshness: \`${report.canaryFreshness.status}\` latestAgeMin=\`${report.canaryFreshness.latestAgeMin ?? "N/A"}\` threshold=\`${report.canaryFreshness.maxAllowedAgeMin}\``
  );
  lines.push(
    `- exec_readiness_now: \`${report.execReadinessNow.status}\` preflight=\`${report.execReadinessNow.preflightStatus ?? "n/a"}:${report.execReadinessNow.preflightCode ?? "n/a"}\` attempted=\`${report.execReadinessNow.attempted}\` submitted=\`${report.execReadinessNow.submitted}\``
  );
  lines.push(
    `- latest_guard: mode=\`${report.latestGuard.mode ?? "n/a"}\` level=\`${report.latestGuard.level ?? "n/a"}\` source=\`${report.latestGuard.source ?? "n/a"}\` action=\`${report.latestGuard.actionReason ?? "n/a"}\``
  );
  lines.push("");

  lines.push("### Notion Audit Snapshot");
  lines.push(`- status: \`${report.notionAudit.status}\``);
  lines.push(`- rowsChecked: \`${report.notionAudit.rowsChecked}\``);
  lines.push(`- missingRows: \`${report.notionAudit.requiredFieldMissingRows}\``);
  lines.push(`- duplicateRunKeys: \`${report.notionAudit.duplicateRunKeyCount}\``);
  lines.push(`- staleLatestMinutes: \`${report.notionAudit.staleLatestMinutes ?? "N/A"}\``);
  lines.push("");

  const appendRuns = (title, items) => {
    lines.push(`### ${title}`);
    if (!items.length) {
      lines.push("- N/A");
      lines.push("");
      return;
    }
    for (const row of items) {
      lines.push(
        `- #${row.runNumber} \`${row.status}/${row.conclusion || "n/a"}\` ${row.displayTitle ? `- ${row.displayTitle} ` : ""}(${row.htmlUrl})`
      );
    }
    lines.push("");
  };

  appendRuns("Latest Canary Runs", report.canary.latest);
  appendRuns("Latest Dry-Run Runs", report.dryRun.latest);
  appendRuns("Latest Market-Guard Runs", report.marketGuard.latest);

  lines.push("### Canary Verify Sample");
  if (!report.canaryVerify.perRun.length) {
    lines.push("- N/A");
  } else {
    report.canaryVerify.perRun.slice(0, 5).forEach((row) => {
      lines.push(
        `- #${row.runNumber} parsed=${row.parsed} preflight=${row.preflightPass ?? "n/a"} attempted=${row.attempted ?? "n/a"} submitted=${row.submitted ?? "n/a"} submitPass=${row.submitPass ?? "n/a"} reason=${row.reason} (${row.htmlUrl})`
      );
    });
  }
  lines.push("");

  lines.push("### Latest Dry-Run Readiness");
  if (!report.execReadinessNow.inspected) {
    lines.push(`- status=${report.execReadinessNow.status} reason=${report.execReadinessNow.reason}`);
  } else {
    lines.push(
      `- run=#${report.execReadinessNow.runNumber} status=${report.execReadinessNow.status} preflight=${report.execReadinessNow.preflightStatus ?? "n/a"}:${report.execReadinessNow.preflightCode ?? "n/a"} attempted=${report.execReadinessNow.attempted} submitted=${report.execReadinessNow.submitted} failed=${report.execReadinessNow.failed} skipped=${report.execReadinessNow.skipped} reason=${report.execReadinessNow.reason} (${report.execReadinessNow.htmlUrl || "n/a"})`
    );
  }
  lines.push("");

  lines.push("### Latest Guard Provenance");
  if (!report.latestGuard.inspected) {
    lines.push(`- status=n/a reason=${report.latestGuard.reason}`);
  } else {
    lines.push(
      `- run=#${report.latestGuard.runNumber} parsed=${report.latestGuard.parsed} mode=${report.latestGuard.mode ?? "n/a"} level=${report.latestGuard.level ?? "n/a"} source=${report.latestGuard.source ?? "n/a"} vix=${report.latestGuard.vix ?? "n/a"} actionReason=${report.latestGuard.actionReason ?? "n/a"} reason=${report.latestGuard.reason} (${report.latestGuard.htmlUrl || "n/a"})`
    );
  }
  lines.push("");

  lines.push("### Decision");
  lines.push(`- automatedSummary: ${report.decision}`);

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const token = env("GITHUB_TOKEN");
  const canaryRepo = parseRepo(env("OPS_REPORT_CANARY_REPO"), "pungking/US_Alpha_Seeker");
  const dryRunRepo = parseRepo(env("OPS_REPORT_DRYRUN_REPO"), "pungking/alpha-exec-engine");
  const canaryWorkflow = env("OPS_REPORT_CANARY_WORKFLOW", "sidecar-preflight-canary-recheck.yml");
  const dryRunWorkflow = env("OPS_REPORT_DRYRUN_WORKFLOW", "dry-run.yml");
  const marketGuardWorkflow = env("OPS_REPORT_GUARD_WORKFLOW", "market-guard.yml");
  const guardRepo = parseRepo(env("OPS_REPORT_GUARD_REPO"), "pungking/alpha-exec-engine");
  const windowHours = Math.max(1, Math.min(168, toNum(env("OPS_REPORT_LOOKBACK_HOURS", "24"), 24)));
  const perPage = Math.max(10, Math.min(100, toNum(env("OPS_REPORT_MAX_RUNS", "30"), 30)));
  const canaryVerifyInspectRuns = Math.max(
    1,
    Math.min(20, toNum(env("OPS_REPORT_CANARY_VERIFY_MAX_RUNS", "8"), 8))
  );
  const canaryFreshMaxMin = Math.max(30, Math.min(1440, toNum(env("OPS_REPORT_CANARY_FRESH_MAX_MIN", "360"), 360)));

  if (!canaryRepo || !dryRunRepo || !guardRepo) {
    throw new Error("invalid OPS_REPORT_*_REPO format (expected owner/repo)");
  }

  const current = now();
  const sinceMs = current.getTime() - windowHours * 60 * 60 * 1000;

  const notionAudit = safeJsonRead(`${STATE_DIR}/notion-ops-audit.json`) || {
    status: "missing",
    rowsChecked: 0,
    requiredFieldMissingRows: 0,
    duplicateRunKeyCount: 0,
    staleLatestMinutes: null
  };

  if (!token) {
    const skipped = {
      generatedAt: nowIso(),
      generatedAtKst: makeKst(current),
      status: "skip",
      reason: "missing_github_token",
      windowHours,
      windowStartUtc: new Date(sinceMs).toISOString(),
      canary: { scanned: 0, inWindow: 0, completed: 0, success: 0, failed: 0, successRatePct: null, latest: [] },
      dryRun: { scanned: 0, inWindow: 0, completed: 0, success: 0, failed: 0, successRatePct: null, latest: [] },
      marketGuard: {
        scanned: 0,
        inWindow: 0,
        completed: 0,
        success: 0,
        failed: 0,
        successRatePct: null,
        latest: []
      },
      canaryVerify: {
        inspected: 0,
        parsed: 0,
        preflightPassRuns: 0,
        submitPassRuns: 0,
        attemptedTotal: 0,
        submittedTotal: 0,
        preflightPassRatePct: null,
        submitPassRatePct: null,
        submitSuccessRatePct: null,
        perRun: []
      },
      canaryFreshness: {
        status: "unknown",
        latestAgeMin: null,
        maxAllowedAgeMin: canaryFreshMaxMin
      },
      execReadinessNow: {
        inspected: false,
        status: "UNKNOWN",
        preflightStatus: null,
        preflightCode: null,
        attempted: 0,
        submitted: 0,
        failed: 0,
        skipped: 0,
        reason: "missing_github_token"
      },
      latestGuard: {
        inspected: false,
        parsed: false,
        runNumber: null,
        htmlUrl: null,
        mode: null,
        level: null,
        source: null,
        vix: null,
        actionReason: null,
        reason: "missing_github_token"
      },
      notionAudit,
      decision: "GitHub token missing; cannot compute workflow KPIs."
    };
    writeJson(OUTPUT_JSON, skipped);
    writeText(OUTPUT_MD, buildMarkdown(skipped));
    console.log("[OPS_DAILY] skipped missing github token");
    return;
  }

  const [canaryRuns, dryRunRuns, marketGuardRuns] = await Promise.all([
    fetchRuns({
      token,
      owner: canaryRepo.owner,
      repo: canaryRepo.repo,
      workflow: canaryWorkflow,
      perPage
    }),
    fetchRuns({
      token,
      owner: dryRunRepo.owner,
      repo: dryRunRepo.repo,
      workflow: dryRunWorkflow,
      perPage
    }),
    fetchRuns({
      token,
      owner: guardRepo.owner,
      repo: guardRepo.repo,
      workflow: marketGuardWorkflow,
      perPage
    })
  ]);

  const canary = summarizeRuns(canaryRuns, sinceMs);
  const dryRun = summarizeRuns(dryRunRuns, sinceMs);
  const marketGuard = summarizeRuns(marketGuardRuns, sinceMs);
  const latestCanaryCreatedMs = parseIso(canary.latest[0]?.createdAt || "");
  const canaryLatestAgeMin =
    Number.isFinite(latestCanaryCreatedMs)
      ? Number(((Date.now() - latestCanaryCreatedMs) / 60000).toFixed(1))
      : null;
  const canaryFreshness = {
    status:
      canaryLatestAgeMin == null
        ? "unknown"
        : canaryLatestAgeMin <= canaryFreshMaxMin
          ? "fresh"
          : "stale",
    latestAgeMin: canaryLatestAgeMin,
    maxAllowedAgeMin: canaryFreshMaxMin
  };
  const latestDryRunExecution = await collectLatestDryRunExecutionMetrics({
    token,
    repo: dryRunRepo,
    completedRuns: dryRunRuns.filter((run) => {
      const createdMs = parseIso(run?.created_at);
      return Number.isFinite(createdMs) && createdMs >= sinceMs && run?.status === "completed";
    })
  });
  const latestGuard = await collectLatestGuardSummary({
    token,
    repo: guardRepo,
    completedRuns: marketGuardRuns.filter((run) => {
      const createdMs = parseIso(run?.created_at);
      return Number.isFinite(createdMs) && createdMs >= sinceMs && run?.status === "completed";
    })
  });
  const canaryVerify = await collectCanaryVerificationMetrics({
    token,
    repo: canaryRepo,
    completedRuns: canaryRuns.filter((run) => {
      const createdMs = parseIso(run?.created_at);
      return Number.isFinite(createdMs) && createdMs >= sinceMs && run?.status === "completed";
    }),
    maxInspect: canaryVerifyInspectRuns
  });

  let status = "pass";
  let reason = "healthy";
  if (canary.completed === 0 || dryRun.completed === 0 || marketGuard.completed === 0) {
    status = "warn";
    reason = "insufficient_completed_runs";
  }
  if (canaryVerify.inspected > 0 && canaryVerify.parsed === 0) {
    status = "warn";
    reason = reason === "healthy" ? "canary_verify_unavailable" : `${reason}+canary_verify_unavailable`;
  }
  if (canaryVerify.parsed > 0 && canaryVerify.submitPassRuns < canaryVerify.parsed) {
    status = "warn";
    reason = reason === "healthy" ? "canary_submit_gate_partial" : `${reason}+canary_submit_gate_partial`;
  }
  if (canary.failed > 0 || dryRun.failed > 0 || marketGuard.failed > 0) {
    status = "warn";
    reason = "failed_runs_detected";
  }
  if (canaryFreshness.status === "stale") {
    status = "warn";
    reason = reason === "healthy" ? "canary_stale" : `${reason}+canary_stale`;
  }
  if (String(notionAudit.status || "").toLowerCase() !== "pass") {
    status = "warn";
    reason = reason === "healthy" ? "notion_audit_not_pass" : `${reason}+notion_audit_not_pass`;
  }

  const decision =
    status === "pass"
      ? "No immediate blocker in lookback window. Continue baseline/tuning workflow."
      : "Investigate failed runs, canary freshness, or Notion audit warnings before changing policy thresholds.";

  const report = {
    generatedAt: nowIso(),
    generatedAtKst: makeKst(current),
    status,
    reason,
    windowHours,
    windowStartUtc: new Date(sinceMs).toISOString(),
    canary,
    dryRun,
    marketGuard,
    canaryVerify,
    canaryFreshness,
    execReadinessNow: latestDryRunExecution,
    latestGuard,
    notionAudit: {
      status: notionAudit.status || "missing",
      rowsChecked: notionAudit.rowsChecked ?? 0,
      requiredFieldMissingRows: notionAudit.requiredFieldMissingRows ?? 0,
      duplicateRunKeyCount: notionAudit.duplicateRunKeyCount ?? 0,
      staleLatestMinutes: notionAudit.staleLatestMinutes ?? null
    },
    decision
  };

  writeJson(OUTPUT_JSON, report);
  writeText(OUTPUT_MD, buildMarkdown(report));

  console.log(
    `[OPS_DAILY] status=${report.status} reason=${report.reason} canary=${report.canary.success}/${report.canary.completed} dryrun=${report.dryRun.success}/${report.dryRun.completed} guard=${report.marketGuard.success}/${report.marketGuard.completed} canaryVerify=${report.canaryVerify.parsed}/${report.canaryVerify.inspected} canaryFresh=${report.canaryFreshness.status} execReadiness=${report.execReadinessNow.status} guardMode=${report.latestGuard.mode ?? "n/a"} attempted=${report.canaryVerify.attemptedTotal} submitted=${report.canaryVerify.submittedTotal}`
  );
};

main().catch((error) => {
  console.error("[OPS_DAILY] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
