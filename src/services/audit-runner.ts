import type { FireflyClient } from "../connectors/firefly.js";
import type { SimpleFinClient } from "../connectors/simplefin.js";
import { normalizeSimpleFinTransactions } from "../connectors/simplefin.js";
import type { AppConfig, DateRangeInput } from "../types.js";
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
import { roundScore, serializeTransaction } from "./masking.js";

export interface AuditDependencies {
  config: AppConfig;
  simplefin: SimpleFinClient;
  firefly: FireflyClient;
}

export async function runReconciliationAudit(deps: AuditDependencies, input: DateRangeInput) {
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
  const duplicateGroups = findPossibleDuplicates(fireflyTransactions);
  const uncategorizedGroups = summarizeUncategorized(fireflyTransactions);

  const summary = {
    mappings_checked: mappings.length,
    simplefin_transactions: simplefinTransactions.length,
    firefly_transactions: fireflyTransactions.length,
    missing_transactions: missingFindings.length,
    stale_accounts: staleAccounts.length,
    balance_mismatches: balanceResult.mismatches.length,
    duplicate_groups: duplicateGroups.length,
    uncategorized_groups: uncategorizedGroups.length,
    uncategorized_transactions: uncategorizedGroups.reduce((sum, group) => sum + group.count, 0),
    warnings: balanceResult.warnings.length
  };

  const recommendedActions = buildRecommendedActions(summary);

  return {
    status: recommendedActions.length > 0 ? "needs_attention" : "ok",
    summary,
    recommended_actions: recommendedActions,
    details: {
      range: {
        start_date: range.startDate,
        end_date: range.endDate,
        days: range.days
      },
      missing_transactions: missingFindings.map((finding) => ({
        simplefin_transaction: serializeTransaction(finding.transaction),
        missing_confidence: roundScore(finding.missingConfidence),
        best_match_score: roundScore(finding.bestMatchScore),
        possible_matches: finding.possibleMatches.slice(0, 3).map((match) => ({
          score: roundScore(match.score.score),
          reasons: match.score.reasons,
          transaction: serializeTransaction(match.transaction)
        }))
      })),
      stale_accounts: staleAccounts,
      balance_mismatches: balanceResult.mismatches,
      duplicate_groups: duplicateGroups.map((group) => ({
        confidence: roundScore(group.confidence),
        reasons: group.reasons,
        transactions: group.transactions.map(serializeTransaction)
      })),
      uncategorized_groups: uncategorizedGroups.map((group) => ({
        merchant: group.merchant,
        suggested_category: group.suggestedCategory,
        count: group.count,
        total: group.total,
        example_transactions: group.examples.map(serializeTransaction)
      })),
      warnings: balanceResult.warnings
    }
  };
}

function buildRecommendedActions(summary: {
  missing_transactions: number;
  stale_accounts: number;
  balance_mismatches: number;
  duplicate_groups: number;
  uncategorized_transactions: number;
  warnings: number;
}): string[] {
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
