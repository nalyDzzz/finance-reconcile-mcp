import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findPossibleDuplicates } from "../services/duplicate-detection.js";
import { resolveDateRange } from "../services/date-utils.js";
import { fetchFireflyTransactionsForMappings } from "../services/reconciliation-data.js";
import { roundScore, serializeTransaction } from "../services/masking.js";
import {
  dateRangeInputShape,
  jsonToolError,
  jsonToolResult,
  loadSelectedMappings,
  readOnlyAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

export function registerFireflyFindPossibleDuplicates(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "firefly_find_possible_duplicates",
    {
      title: "Find Firefly Duplicates",
      description:
        "Find possible duplicate Firefly III transactions using same mapped account, amount, nearby date, and description similarity.",
      inputSchema: dateRangeInputShape,
      annotations: readOnlyAnnotations
    },
    async (input) => {
      try {
        const range = resolveDateRange(input, deps.config.defaultLookbackDays);
        const mappings = await loadSelectedMappings(deps, input);
        const fireflyTransactions = await fetchFireflyTransactionsForMappings(deps.firefly, mappings, range);
        const duplicateGroups = findPossibleDuplicates(fireflyTransactions);

        return jsonToolResult({
          tool: "firefly_find_possible_duplicates",
          read_only: true,
          range: {
            start_date: range.startDate,
            end_date: range.endDate,
            days: range.days
          },
          duplicate_group_count: duplicateGroups.length,
          duplicate_groups: duplicateGroups.map((group) => ({
            confidence: roundScore(group.confidence),
            reasons: group.reasons,
            transactions: group.transactions.map(serializeTransaction)
          }))
        });
      } catch (error) {
        return jsonToolError(error);
      }
    }
  );
}
