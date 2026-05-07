import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findMissingTransactions } from "../services/transaction-matching.js";
import { resolveDateRange } from "../services/date-utils.js";
import {
  fetchFireflyTransactionsForMappings,
  fetchSimpleFinTransactionsForMappings
} from "../services/reconciliation-data.js";
import { roundScore, serializeTransaction } from "../services/masking.js";
import {
  dateRangeInputShape,
  jsonToolError,
  jsonToolResult,
  loadSelectedMappings,
  readOnlyAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

export function registerReconcileFindMissingTransactions(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "reconcile_find_missing_transactions",
    {
      title: "Find Missing Transactions",
      description:
        "Compare mapped SimpleFIN and Firefly III accounts, returning SimpleFIN transactions that appear absent from Firefly III.",
      inputSchema: dateRangeInputShape,
      annotations: readOnlyAnnotations
    },
    async (input) => {
      try {
        const range = resolveDateRange(input, deps.config.defaultLookbackDays);
        const mappings = await loadSelectedMappings(deps, input);
        const [simplefinData, fireflyTransactions] = await Promise.all([
          fetchSimpleFinTransactionsForMappings(deps.simplefin, mappings, range),
          fetchFireflyTransactionsForMappings(deps.firefly, mappings, range)
        ]);

        const findings = findMissingTransactions(simplefinData.transactions, fireflyTransactions, {
          maxDateDistanceDays: 2,
          matchThreshold: 0.76
        });

        return jsonToolResult({
          tool: "reconcile_find_missing_transactions",
          read_only: true,
          range: {
            start_date: range.startDate,
            end_date: range.endDate,
            days: range.days
          },
          mappings_checked: mappings.length,
          source_counts: {
            simplefin_transactions: simplefinData.transactions.length,
            firefly_transactions: fireflyTransactions.length
          },
          missing_count: findings.length,
          missing_transactions: findings.map((finding) => ({
            simplefin_transaction: serializeTransaction(finding.transaction),
            missing_confidence: roundScore(finding.missingConfidence),
            best_match_score: roundScore(finding.bestMatchScore),
            possible_matches: finding.possibleMatches.slice(0, 3).map((match) => ({
              score: roundScore(match.score.score),
              reasons: match.score.reasons,
              transaction: serializeTransaction(match.transaction)
            }))
          })),
          warnings: simplefinData.warnings
        });
      } catch (error) {
        return jsonToolError(error);
      }
    }
  );
}
