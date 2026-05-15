import type { FireflyClient } from "../connectors/firefly.js";
import type { SimpleFinClient } from "../connectors/simplefin.js";
import { normalizeSimpleFinTransactions } from "../connectors/simplefin.js";
import type {
  AppConfig,
  AuditRunInput,
  FindingType,
  NormalizedTransaction
} from "../types.js";
import {
  appendAuditSnapshot,
  compareAuditFingerprints,
  createAuditSnapshot,
  latestAuditSnapshot,
  loadAuditHistory
} from "./audit-history.js";
import { checkStaleAccounts, reconcileBalances } from "./balance-reconciliation.js";
import { summarizeUncategorized } from "./category-summary.js";
import { findPossibleDuplicates } from "./duplicate-detection.js";
import { resolveDateRange } from "./date-utils.js";
import { filterMappings, loadAccountMap } from "./account-mapping.js";
import { MOCK_ACCOUNT_MAP } from "../fixtures/mock-data.js";
import {
  fetchFireflyAccountsForMappings,
  fetchFireflyTransactionsForMappings,
  fetchMappedSimpleFinAccounts
} from "./reconciliation-data.js";
import { findMissingTransactions } from "./transaction-matching.js";
import {
  fingerprintBalanceMismatch,
  fingerprintDuplicateGroup,
  fingerprintMissingTransaction,
  fingerprintStaleAccount,
  fingerprintUncategorizedGroup
} from "./fingerprints.js";
import {
  ignoredFindingsByFingerprint,
  loadIgnoredFindings,
  type IgnoredFinding
} from "./ignored-findings.js";
import { roundMoney, roundScore, serializeTransaction } from "./masking.js";

export interface AuditDependencies {
  config: AppConfig;
  simplefin: SimpleFinClient;
  firefly: FireflyClient;
}

interface AuditOptions {
  includeDetails: boolean;
  includeIgnored: boolean;
  maxMissing: number;
  maxDuplicates: number;
  maxUncategorizedGroups: number;
  minDuplicateConfidence?: number;
}

interface AuditFinding {
  type: FindingType;
  group:
    | "missing_transactions"
    | "stale_accounts"
    | "balance_mismatches"
    | "duplicate_groups"
    | "uncategorized_groups";
  fingerprint: string;
  summary: Record<string, unknown>;
  detail: Record<string, unknown>;
  ignored?: IgnoredFinding;
  count?: number;
}

interface AuditSummary {
  mappings_checked: number;
  simplefin_transactions: number;
  firefly_transactions: number;
  active_findings: number;
  ignored_findings: number;
  total_findings: number;
  missing_transactions: number;
  ignored_missing_transactions: number;
  stale_accounts: number;
  ignored_stale_accounts: number;
  balance_mismatches: number;
  ignored_balance_mismatches: number;
  duplicate_groups: number;
  ignored_duplicate_groups: number;
  uncategorized_groups: number;
  ignored_uncategorized_groups: number;
  uncategorized_transactions: number;
  ignored_uncategorized_transactions: number;
  warnings: number;
}

export async function runReconciliationAudit(deps: AuditDependencies, input: AuditRunInput) {
  const options = normalizeAuditOptions(input);
  const range = resolveDateRange(input, deps.config.defaultLookbackDays);
  const accountMap = deps.config.mockData ? MOCK_ACCOUNT_MAP : await loadAccountMap(deps.config.accountMappingFile);
  const mappings = filterMappings(accountMap.accounts, input.account);

  const [simplefinAccounts, fireflyTransactions, fireflyAccounts] = await Promise.all([
    fetchMappedSimpleFinAccounts(deps.simplefin, mappings, range, false),
    fetchFireflyTransactionsForMappings(deps.firefly, mappings, range),
    fetchFireflyAccountsForMappings(deps.firefly, mappings, range.endDate)
  ]);
  const simplefinTransactions = simplefinAccounts.simplefinAccounts.flatMap(({ raw, mapping }) =>
    normalizeSimpleFinTransactions(raw, mapping)
  );

  const missingFindings = findMissingTransactions(simplefinTransactions, fireflyTransactions, {
    maxDateDistanceDays: 2,
    matchThreshold: 0.76
  });
  const staleStatuses = checkStaleAccounts(
    simplefinAccounts.simplefinAccounts.map((account) => account.normalized),
    simplefinTransactions,
    fireflyTransactions
  );
  const staleAccounts = staleStatuses.filter(
    (status) => status.status === "behind" || status.status === "no_firefly_transactions"
  );
  const balanceResult = reconcileBalances(
    simplefinAccounts.simplefinAccounts.map((account) => account.normalized),
    fireflyAccounts,
    fireflyTransactions,
    0.01,
    [...simplefinAccounts.warnings]
  );
  const duplicateGroups = findPossibleDuplicates(fireflyTransactions, {
    minConfidence: options.minDuplicateConfidence
  });
  const uncategorizedGroups = summarizeUncategorized(fireflyTransactions);

  const ignoredFile = await loadIgnoredFindings(deps.config.ignoredFindingsFile);
  const ignoredByFingerprint = ignoredFindingsByFingerprint(ignoredFile.ignored);
  const allFindings = applyIgnoredFindings([
    ...missingFindings.map((finding): AuditFinding => {
      const fingerprint = fingerprintMissingTransaction(finding);
      return {
        type: "missing_transaction",
        group: "missing_transactions",
        fingerprint,
        summary: compactMissingTransaction(finding),
        detail: detailedMissingTransaction(finding)
      };
    }),
    ...staleAccounts
      .sort(compareStaleAccounts)
      .map((status): AuditFinding => {
        const fingerprint = fingerprintStaleAccount(status);
        return {
          type: "stale_account",
          group: "stale_accounts",
          fingerprint,
          summary: { ...status },
          detail: { ...status }
        };
      }),
    ...balanceResult.mismatches
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
      .map((mismatch): AuditFinding => {
        const fingerprint = fingerprintBalanceMismatch(mismatch);
        return {
          type: "balance_mismatch",
          group: "balance_mismatches",
          fingerprint,
          summary: { ...mismatch },
          detail: { ...mismatch }
        };
      }),
    ...duplicateGroups.map((group): AuditFinding => {
      const fingerprint = fingerprintDuplicateGroup(group);
      return {
        type: "duplicate_group",
        group: "duplicate_groups",
        fingerprint,
        summary: compactDuplicateGroup(group.transactions, group.confidence, group.reasons),
        detail: {
          confidence: roundScore(group.confidence),
          reasons: group.reasons,
          transactions: group.transactions.map(serializeTransaction)
        }
      };
    }),
    ...uncategorizedGroups.map((group): AuditFinding => {
      const fingerprint = fingerprintUncategorizedGroup(group);
      return {
        type: "uncategorized_group",
        group: "uncategorized_groups",
        fingerprint,
        summary: {
          merchant: group.merchant,
          suggested_category: group.suggestedCategory,
          count: group.count,
          total: group.total,
          example_transactions: group.examples.slice(0, 2).map(compactTransaction)
        },
        detail: {
          merchant: group.merchant,
          suggested_category: group.suggestedCategory,
          count: group.count,
          total: group.total,
          example_transactions: group.examples.map(serializeTransaction)
        },
        count: group.count
      };
    })
  ], ignoredByFingerprint);

  const activeFindings = allFindings.filter((finding) => !finding.ignored);
  const ignoredFindings = allFindings.filter((finding) => finding.ignored);
  const summary = buildSummary({
    mappingsChecked: mappings.length,
    simplefinTransactionCount: simplefinTransactions.length,
    fireflyTransactionCount: fireflyTransactions.length,
    activeFindings,
    ignoredFindings,
    warningCount: balanceResult.warnings.length
  });
  const recommendedActions = buildRecommendedActions(summary);
  const activeFindingFingerprints = activeFindings.map((finding) => finding.fingerprint).sort();
  const history = await loadAuditHistory(deps.config.auditHistoryFile);
  const sinceLastAudit = compareAuditFingerprints(latestAuditSnapshot(history), activeFindingFingerprints);
  const snapshot = createAuditSnapshot({
    range: {
      start_date: range.startDate,
      end_date: range.endDate,
      days: range.days
    },
    summary: summary as unknown as Record<string, unknown>,
    activeFindingFingerprints: activeFindingFingerprints
  });
  await appendAuditSnapshot(deps.config.auditHistoryFile, snapshot);

  const output: Record<string, unknown> = {
    status: recommendedActions.length > 0 ? "needs_attention" : "ok",
    summary,
    since_last_audit: sinceLastAudit,
    recommended_actions: recommendedActions,
    top_findings: buildFindingsOutput(activeFindings, options, false)
  };

  if (options.includeDetails) {
    output.details = {
      range: {
        start_date: range.startDate,
        end_date: range.endDate,
        days: range.days
      },
      ...buildFindingsOutput(activeFindings, options, true),
      warnings: balanceResult.warnings
    };
  }

  if (options.includeIgnored) {
    output.ignored_findings = buildFindingsOutput(ignoredFindings, options, options.includeDetails);
  }

  return output;
}

function normalizeAuditOptions(input: AuditRunInput): AuditOptions {
  return {
    includeDetails: input.include_details ?? false,
    includeIgnored: input.include_ignored ?? false,
    maxMissing: normalizeLimit(input.max_missing, 10),
    maxDuplicates: normalizeLimit(input.max_duplicates, 10),
    maxUncategorizedGroups: normalizeLimit(input.max_uncategorized_groups, 10),
    minDuplicateConfidence: normalizeConfidence(input.min_duplicate_confidence)
  };
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
}

function normalizeConfidence(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.min(1, value));
}

function applyIgnoredFindings(
  findings: AuditFinding[],
  ignoredByFingerprint: Map<string, IgnoredFinding>
): AuditFinding[] {
  return findings.map((finding) => ({
    ...finding,
    ignored: ignoredByFingerprint.get(finding.fingerprint)
  }));
}

function buildSummary(input: {
  mappingsChecked: number;
  simplefinTransactionCount: number;
  fireflyTransactionCount: number;
  activeFindings: AuditFinding[];
  ignoredFindings: AuditFinding[];
  warningCount: number;
}): AuditSummary {
  const active = countFindings(input.activeFindings);
  const ignored = countFindings(input.ignoredFindings);

  return {
    mappings_checked: input.mappingsChecked,
    simplefin_transactions: input.simplefinTransactionCount,
    firefly_transactions: input.fireflyTransactionCount,
    active_findings: input.activeFindings.length,
    ignored_findings: input.ignoredFindings.length,
    total_findings: input.activeFindings.length + input.ignoredFindings.length,
    missing_transactions: active.missing_transactions,
    ignored_missing_transactions: ignored.missing_transactions,
    stale_accounts: active.stale_accounts,
    ignored_stale_accounts: ignored.stale_accounts,
    balance_mismatches: active.balance_mismatches,
    ignored_balance_mismatches: ignored.balance_mismatches,
    duplicate_groups: active.duplicate_groups,
    ignored_duplicate_groups: ignored.duplicate_groups,
    uncategorized_groups: active.uncategorized_groups,
    ignored_uncategorized_groups: ignored.uncategorized_groups,
    uncategorized_transactions: active.uncategorized_transactions,
    ignored_uncategorized_transactions: ignored.uncategorized_transactions,
    warnings: input.warningCount
  };
}

function countFindings(findings: AuditFinding[]) {
  return {
    missing_transactions: findings.filter((finding) => finding.group === "missing_transactions").length,
    stale_accounts: findings.filter((finding) => finding.group === "stale_accounts").length,
    balance_mismatches: findings.filter((finding) => finding.group === "balance_mismatches").length,
    duplicate_groups: findings.filter((finding) => finding.group === "duplicate_groups").length,
    uncategorized_groups: findings.filter((finding) => finding.group === "uncategorized_groups").length,
    uncategorized_transactions: findings
      .filter((finding) => finding.group === "uncategorized_groups")
      .reduce((sum, finding) => sum + (finding.count ?? 0), 0)
  };
}

function buildFindingsOutput(
  findings: AuditFinding[],
  options: AuditOptions,
  includeDetails: boolean
): Record<AuditFinding["group"], Record<string, unknown>[]> {
  const output = {
    missing_transactions: limitFindings(findings, "missing_transactions", options.maxMissing),
    stale_accounts: limitFindings(findings, "stale_accounts"),
    balance_mismatches: limitFindings(findings, "balance_mismatches"),
    duplicate_groups: limitFindings(findings, "duplicate_groups", options.maxDuplicates),
    uncategorized_groups: limitFindings(findings, "uncategorized_groups", options.maxUncategorizedGroups)
  };

  return Object.fromEntries(
    Object.entries(output).map(([group, groupFindings]) => [
      group,
      groupFindings.map((finding) => serializeFinding(finding, includeDetails))
    ])
  ) as Record<AuditFinding["group"], Record<string, unknown>[]>;
}

function limitFindings(findings: AuditFinding[], group: AuditFinding["group"], limit?: number): AuditFinding[] {
  const grouped = findings.filter((finding) => finding.group === group);
  return limit === undefined ? grouped : grouped.slice(0, limit);
}

function serializeFinding(finding: AuditFinding, includeDetails: boolean): Record<string, unknown> {
  return {
    type: finding.type,
    fingerprint: finding.fingerprint,
    ignored: Boolean(finding.ignored),
    ...(finding.ignored
      ? {
          ignore_reason: finding.ignored.reason,
          ignored_at: finding.ignored.created_at
        }
      : {}),
    ...(includeDetails ? finding.detail : finding.summary)
  };
}

function compactMissingTransaction(finding: ReturnType<typeof findMissingTransactions>[number]): Record<string, unknown> {
  return {
    transaction: compactTransaction(finding.transaction),
    missing_confidence: roundScore(finding.missingConfidence),
    best_match_score: roundScore(finding.bestMatchScore)
  };
}

function detailedMissingTransaction(finding: ReturnType<typeof findMissingTransactions>[number]): Record<string, unknown> {
  return {
    simplefin_transaction: serializeTransaction(finding.transaction),
    missing_confidence: roundScore(finding.missingConfidence),
    best_match_score: roundScore(finding.bestMatchScore),
    possible_matches: finding.possibleMatches.slice(0, 3).map((match) => ({
      score: roundScore(match.score.score),
      reasons: match.score.reasons,
      transaction: serializeTransaction(match.transaction)
    }))
  };
}

function compactDuplicateGroup(
  transactions: NormalizedTransaction[],
  confidence: number,
  reasons: string[]
): Record<string, unknown> {
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  const dates = sorted.map((transaction) => transaction.date).sort();

  return {
    confidence: roundScore(confidence),
    reasons,
    transaction_count: transactions.length,
    date_range: {
      start_date: dates[0] ?? null,
      end_date: dates[dates.length - 1] ?? null
    },
    amount: transactions[0] ? roundMoney(transactions[0].amount) : null,
    account: transactions[0]
      ? {
          mapped_firefly_account_id: transactions[0].mappedFireflyAccountId,
          display_name: transactions[0].accountDisplayName
        }
      : null,
    example_transactions: sorted.slice(0, 2).map(compactTransaction)
  };
}

function compactTransaction(transaction: NormalizedTransaction): Record<string, unknown> {
  return {
    date: transaction.date,
    amount: roundMoney(transaction.amount),
    currency: transaction.currency,
    description: transaction.description,
    pending: transaction.pending ?? false,
    category: transaction.category ?? null,
    account: {
      mapped_firefly_account_id: transaction.mappedFireflyAccountId,
      display_name: transaction.accountDisplayName
    }
  };
}

function compareStaleAccounts(a: ReturnType<typeof checkStaleAccounts>[number], b: ReturnType<typeof checkStaleAccounts>[number]) {
  const aDays = a.days_behind ?? -1;
  const bDays = b.days_behind ?? -1;
  return bDays - aDays;
}

function buildRecommendedActions(summary: AuditSummary): string[] {
  const actions: string[] = [];
  if (summary.missing_transactions > 0) {
    actions.push("Review missing SimpleFIN transactions and decide whether Firefly III needs manual import or correction.");
  }
  if (summary.stale_accounts > 0) {
    actions.push("Review stale accounts where Firefly III appears behind SimpleFIN.");
  }
  if (summary.balance_mismatches > 0) {
    actions.push("Investigate balance mismatches for missing, duplicated, pending, or manually adjusted transactions.");
  }
  if (summary.duplicate_groups > 0) {
    actions.push("Review possible duplicate Firefly III transaction groups before making any manual changes.");
  }
  if (summary.uncategorized_transactions > 0) {
    actions.push("Review uncategorized Firefly III transactions and suggested category labels.");
  }
  if (summary.warnings > 0) {
    actions.push("Review connector and mapping warnings in the audit details.");
  }
  return actions;
}
