import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendAuditSnapshot,
  createAuditSnapshot,
  type AuditSnapshotFinding
} from "../audit-history.js";
import { prepareReviewPlan } from "../review-plan.js";

let tempDirs: string[] = [];

async function tempFile(fileName: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "finance-mcp-review-plan-"));
  tempDirs.push(dir);
  return path.join(dir, fileName);
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("prepareReviewPlan", () => {
  it("returns compact review actions for the latest audit snapshot", async () => {
    const filePath = await tempFile("audit-history.json");
    const activeFindings: AuditSnapshotFinding[] = [
      {
        type: "missing_transaction",
        group: "missing_transactions",
        fingerprint: "missing_transaction:abc",
        summary: { missing_confidence: 0.91, best_match_score: 0.09 }
      },
      {
        type: "duplicate_group",
        group: "duplicate_groups",
        fingerprint: "duplicate_group:def",
        summary: { confidence: 0.87, reasons: ["same amount and date"] }
      },
      {
        type: "uncategorized_group",
        group: "uncategorized_groups",
        fingerprint: "uncategorized_group:ghi",
        summary: {
          merchant: "king soopers",
          suggested_category: "Groceries",
          confidence: 0.95,
          reason: "Matched local category rule \"king soopers\"."
        }
      },
      {
        type: "stale_account",
        group: "stale_accounts",
        fingerprint: "stale_account:jkl",
        summary: { status: "behind", days_behind: 4 }
      },
      {
        type: "balance_mismatch",
        group: "balance_mismatches",
        fingerprint: "balance_mismatch:mno",
        summary: { difference: -23.45 }
      }
    ];
    const snapshot = createAuditSnapshot({
      range: { start_date: "2026-05-01", end_date: "2026-05-14", days: 14 },
      summary: { active_findings: activeFindings.length },
      activeFindingFingerprints: activeFindings.map((finding) => finding.fingerprint),
      activeFindings,
      now: new Date("2026-05-14T12:00:00.000Z")
    });
    await appendAuditSnapshot(filePath, snapshot);

    const plan = await prepareReviewPlan(filePath);

    expect(plan.status).toBe("ready");
    expect(plan.latest_audit).toMatchObject({
      run_id: snapshot.run_id,
      active_findings: 5
    });
    expect(plan.proposed_action_count).toBe(5);
    expect(plan.proposed_actions.map((action) => action.type)).toEqual([
      "missing_transaction_review",
      "duplicate_review",
      "category_suggestion_review",
      "stale_account_review",
      "balance_mismatch_review"
    ]);
    expect(plan.proposed_actions[2]).toMatchObject({
      confidence: 0.95,
      reason: "Matched local category rule \"king soopers\".",
      finding_fingerprint: "uncategorized_group:ghi"
    });
  });

  it("marks every proposed action as manual review without Firefly mutation", async () => {
    const filePath = await tempFile("audit-history.json");
    const snapshot = createAuditSnapshot({
      range: { start_date: "2026-05-01", end_date: "2026-05-14", days: 14 },
      summary: { active_findings: 1 },
      activeFindingFingerprints: ["uncategorized_group:abc"],
      activeFindings: [
        {
          type: "uncategorized_group",
          group: "uncategorized_groups",
          fingerprint: "uncategorized_group:abc",
          summary: {
            merchant: "coffee shop",
            suggested_category: "Dining",
            confidence: 0.7
          }
        }
      ],
      now: new Date("2026-05-14T12:00:00.000Z")
    });
    await appendAuditSnapshot(filePath, snapshot);

    const plan = await prepareReviewPlan(filePath);

    expect(plan.proposed_actions).toHaveLength(1);
    for (const action of plan.proposed_actions) {
      expect(action.would_mutate_firefly).toBe(false);
      expect(action.requires_manual_review).toBe(true);
      expect(action.proposed_action.toLowerCase()).not.toMatch(/\b(create|update|delete|categorize|merge|apply)\b/);
    }
  });
});
