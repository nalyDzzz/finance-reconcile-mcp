import type { AuditSnapshot, AuditSnapshotFinding } from "./audit-history.js";
import { latestAuditSnapshot, loadAuditHistory } from "./audit-history.js";
import { roundScore } from "./masking.js";

export interface ReviewPlanAction {
  action_id: string;
  type: string;
  confidence: number;
  reason: string;
  would_mutate_firefly: false;
  requires_manual_review: true;
  finding_fingerprint: string;
  finding_type: string;
  proposed_action: string;
  review_item: Record<string, unknown>;
}

export interface ReviewPlan {
  status: "ready" | "no_audit_history";
  latest_audit?: {
    run_id: string;
    created_at: string;
    range: AuditSnapshot["range"];
    active_findings: number;
  };
  proposed_action_count: number;
  proposed_actions: ReviewPlanAction[];
}

export async function prepareReviewPlan(auditHistoryFile: string): Promise<ReviewPlan> {
  const history = await loadAuditHistory(auditHistoryFile);
  const latest = latestAuditSnapshot(history);
  if (!latest) {
    return {
      status: "no_audit_history",
      proposed_action_count: 0,
      proposed_actions: []
    };
  }

  const findings = activeFindingsForSnapshot(latest);
  const proposedActions = findings.map((finding) => actionForFinding(finding));

  return {
    status: "ready",
    latest_audit: {
      run_id: latest.run_id,
      created_at: latest.created_at,
      range: latest.range,
      active_findings: findings.length
    },
    proposed_action_count: proposedActions.length,
    proposed_actions: proposedActions
  };
}

function activeFindingsForSnapshot(snapshot: AuditSnapshot): AuditSnapshotFinding[] {
  if (snapshot.active_findings.length > 0) {
    return snapshot.active_findings;
  }

  return snapshot.active_finding_fingerprints.map((fingerprint) => ({
    type: findingTypeFromFingerprint(fingerprint),
    group: groupForFindingType(findingTypeFromFingerprint(fingerprint)),
    fingerprint,
    summary: {
      type: findingTypeFromFingerprint(fingerprint),
      fingerprint
    }
  }));
}

function actionForFinding(finding: AuditSnapshotFinding): ReviewPlanAction {
  const builder = actionBuilders[finding.type] ?? genericReviewAction;
  return builder(finding);
}

function missingTransactionAction(finding: AuditSnapshotFinding): ReviewPlanAction {
  const summary = finding.summary;
  const bestMatchScore = numberValue(summary.best_match_score);
  const confidence = numberValue(summary.missing_confidence) ?? 0.8;
  const reason = bestMatchScore === undefined
    ? "Latest audit found a SimpleFIN transaction without a confident Firefly III match."
    : `Latest audit found a SimpleFIN transaction below the match threshold; best match score was ${bestMatchScore}.`;

  return baseAction(finding, {
    type: "missing_transaction_review",
    confidence,
    reason,
    proposedAction: "Review the missing SimpleFIN transaction and decide whether Firefly III needs manual correction."
  });
}

function duplicateAction(finding: AuditSnapshotFinding): ReviewPlanAction {
  const summary = finding.summary;
  const confidence = numberValue(summary.confidence) ?? 0.75;
  const reasons = Array.isArray(summary.reasons) ? summary.reasons.filter((value): value is string => typeof value === "string") : [];

  return baseAction(finding, {
    type: "duplicate_review",
    confidence,
    reason: reasons[0] ?? "Latest audit found a possible duplicate Firefly III transaction group.",
    proposedAction: "Review the possible duplicate transaction group before making any manual ledger change."
  });
}

function categorySuggestionAction(finding: AuditSnapshotFinding): ReviewPlanAction {
  const summary = finding.summary;
  const merchant = stringValue(summary.merchant) ?? "unknown merchant";
  const suggestedCategory = stringValue(summary.suggested_category) ?? "Needs Review";
  const confidence = numberValue(summary.confidence) ?? 0.5;
  const suggestionReason = stringValue(summary.reason);

  return baseAction(finding, {
    type: "category_suggestion_review",
    confidence,
    reason: suggestionReason ?? `Latest audit suggested ${suggestedCategory} for uncategorized transactions from ${merchant}.`,
    proposedAction: `Review whether "${suggestedCategory}" fits uncategorized transactions from ${merchant}.`
  });
}

function staleAccountAction(finding: AuditSnapshotFinding): ReviewPlanAction {
  const summary = finding.summary;
  const daysBehind = numberValue(summary.days_behind);
  const status = stringValue(summary.status);
  const confidence = daysBehind === undefined ? 0.65 : Math.min(0.9, 0.6 + daysBehind / 100);

  return baseAction(finding, {
    type: "stale_account_review",
    confidence,
    reason: status
      ? `Latest audit marked the mapped account as ${status}.`
      : "Latest audit found a mapped account where Firefly III appears stale.",
    proposedAction: "Review the mapped account activity and decide whether the ledger needs manual attention."
  });
}

function balanceMismatchAction(finding: AuditSnapshotFinding): ReviewPlanAction {
  const summary = finding.summary;
  const difference = numberValue(summary.difference);

  return baseAction(finding, {
    type: "balance_mismatch_review",
    confidence: 0.8,
    reason: difference === undefined
      ? "Latest audit found a SimpleFIN versus Firefly III balance mismatch."
      : `Latest audit found a SimpleFIN versus Firefly III balance difference of ${difference}.`,
    proposedAction: "Review the balance mismatch for missing, duplicated, pending, or manually adjusted transactions."
  });
}

function genericReviewAction(finding: AuditSnapshotFinding): ReviewPlanAction {
  return baseAction(finding, {
    type: `${finding.type}_review`,
    confidence: 0.5,
    reason: "Latest audit found an item that requires manual review.",
    proposedAction: "Review this audit finding manually."
  });
}

function baseAction(
  finding: AuditSnapshotFinding,
  input: {
    type: string;
    confidence: number;
    reason: string;
    proposedAction: string;
  }
): ReviewPlanAction {
  return {
    action_id: `${input.type}:${finding.fingerprint}`,
    type: input.type,
    confidence: roundScore(input.confidence),
    reason: input.reason,
    would_mutate_firefly: false,
    requires_manual_review: true,
    finding_fingerprint: finding.fingerprint,
    finding_type: finding.type,
    proposed_action: input.proposedAction,
    review_item: finding.summary
  };
}

const actionBuilders: Record<string, (finding: AuditSnapshotFinding) => ReviewPlanAction> = {
  missing_transaction: missingTransactionAction,
  duplicate_group: duplicateAction,
  uncategorized_group: categorySuggestionAction,
  stale_account: staleAccountAction,
  balance_mismatch: balanceMismatchAction
};

function findingTypeFromFingerprint(fingerprint: string): string {
  return fingerprint.split(":", 1)[0] || "unknown";
}

function groupForFindingType(type: string): string {
  const groups: Record<string, string> = {
    missing_transaction: "missing_transactions",
    duplicate_group: "duplicate_groups",
    uncategorized_group: "uncategorized_groups",
    stale_account: "stale_accounts",
    balance_mismatch: "balance_mismatches"
  };

  return groups[type] ?? "unknown";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
