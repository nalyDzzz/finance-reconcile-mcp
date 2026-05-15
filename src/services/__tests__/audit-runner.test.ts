import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FireflyClient } from "../../connectors/firefly.js";
import { SimpleFinClient } from "../../connectors/simplefin.js";
import { loadAuditHistory } from "../audit-history.js";
import { runReconciliationAudit, type AuditDependencies } from "../audit-runner.js";
import { ignoreFinding } from "../ignored-findings.js";

interface AuditOutput {
  status: string;
  summary: Record<string, number>;
  since_last_audit: {
    new_findings: number;
    resolved_findings: number;
    unchanged_findings: number;
  };
  recommended_actions: string[];
  top_findings: Record<string, Array<Record<string, unknown>>>;
  details?: Record<string, unknown>;
  ignored_findings?: Record<string, Array<Record<string, unknown>>>;
}

let tempDirs: string[] = [];

async function mockDeps(): Promise<AuditDependencies> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "finance-mcp-audit-"));
  tempDirs.push(dir);

  return {
    config: {
      simpleFinAccessUrl: "https://mock.simplefin.local/simplefin",
      fireflyBaseUrl: "https://mock.firefly.local",
      fireflyPat: "mock-token",
      defaultLookbackDays: 30,
      readonly: true,
      mockData: true,
      accountMappingFile: path.join(dir, "account-map.json"),
      accountMappingFileDefaulted: false,
      ignoredFindingsFile: path.join(dir, "ignored-findings.json"),
      auditHistoryFile: path.join(dir, "audit-history.json")
    },
    simplefin: new SimpleFinClient("https://mock.simplefin.local/simplefin", { mockData: true }),
    firefly: new FireflyClient("https://mock.firefly.local", "mock-token", { mockData: true })
  };
}

function asAuditOutput(value: Awaited<ReturnType<typeof runReconciliationAudit>>): AuditOutput {
  return value as unknown as AuditOutput;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("runReconciliationAudit", () => {
  it("returns compact output by default and saves a compact history snapshot", async () => {
    const deps = await mockDeps();
    const audit = asAuditOutput(await runReconciliationAudit(deps, { days: 30 }));

    expect(audit.status).toBe("needs_attention");
    expect(audit.details).toBeUndefined();
    expect(audit.top_findings.missing_transactions).toHaveLength(1);
    expect(audit.top_findings.missing_transactions[0]).not.toHaveProperty("possible_matches");
    expect(audit.summary.active_findings).toBe(7);
    expect(audit.since_last_audit).toEqual({
      new_findings: 7,
      resolved_findings: 0,
      unchanged_findings: 0
    });

    const history = await loadAuditHistory(deps.config.auditHistoryFile);
    expect(history.snapshots).toHaveLength(1);
    expect(history.snapshots[0].active_finding_fingerprints).toHaveLength(7);
    expect(history.snapshots[0].summary).toMatchObject({
      active_findings: 7,
      ignored_findings: 0
    });
  });

  it("includes full details only when requested", async () => {
    const deps = await mockDeps();
    const audit = asAuditOutput(await runReconciliationAudit(deps, {
      days: 30,
      include_details: true
    }));

    expect(audit.details).toBeDefined();
    const details = audit.details as Record<string, Array<Record<string, unknown>>>;
    expect(details.missing_transactions[0]).toHaveProperty("simplefin_transaction");
    expect(details.duplicate_groups[0]).toHaveProperty("transactions");
    expect(audit.top_findings.duplicate_groups[0]).toHaveProperty("example_transactions");
    expect(audit.top_findings.duplicate_groups[0]).not.toHaveProperty("transactions");
  });

  it("applies output limits without changing summary counts", async () => {
    const deps = await mockDeps();
    const audit = asAuditOutput(await runReconciliationAudit(deps, {
      days: 30,
      max_missing: 0,
      max_duplicates: 0,
      max_uncategorized_groups: 1
    }));

    expect(audit.summary.missing_transactions).toBe(1);
    expect(audit.summary.duplicate_groups).toBe(1);
    expect(audit.summary.uncategorized_groups).toBe(3);
    expect(audit.top_findings.missing_transactions).toHaveLength(0);
    expect(audit.top_findings.duplicate_groups).toHaveLength(0);
    expect(audit.top_findings.uncategorized_groups).toHaveLength(1);
  });

  it("excludes ignored findings from active counts and can include them separately", async () => {
    const deps = await mockDeps();
    const firstAudit = asAuditOutput(await runReconciliationAudit(deps, { days: 30 }));
    const missing = firstAudit.top_findings.missing_transactions[0];
    const fingerprint = String(missing.fingerprint);

    await ignoreFinding(deps.config.ignoredFindingsFile, {
      fingerprint,
      type: "missing_transaction",
      reason: "Known historical import gap",
      createdAt: "2026-05-14T12:00:00.000Z"
    });

    const compactAudit = asAuditOutput(await runReconciliationAudit(deps, { days: 30 }));
    expect(compactAudit.summary.missing_transactions).toBe(0);
    expect(compactAudit.summary.ignored_missing_transactions).toBe(1);
    expect(compactAudit.summary.active_findings).toBe(6);
    expect(compactAudit.summary.ignored_findings).toBe(1);
    expect(compactAudit.top_findings.missing_transactions).toHaveLength(0);
    expect(compactAudit.ignored_findings).toBeUndefined();
    expect(compactAudit.since_last_audit).toEqual({
      new_findings: 0,
      resolved_findings: 1,
      unchanged_findings: 6
    });

    const withIgnored = asAuditOutput(await runReconciliationAudit(deps, {
      days: 30,
      include_ignored: true
    }));
    expect(withIgnored.ignored_findings?.missing_transactions).toHaveLength(1);
    expect(withIgnored.ignored_findings?.missing_transactions[0]).toMatchObject({
      fingerprint,
      ignored: true,
      ignore_reason: "Known historical import gap"
    });
  });
});
