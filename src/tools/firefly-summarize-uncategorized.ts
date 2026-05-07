import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { summarizeUncategorized } from "../services/category-summary.js";
import { resolveDateRange } from "../services/date-utils.js";
import { fetchFireflyTransactionsForMappings } from "../services/reconciliation-data.js";
import { serializeTransaction } from "../services/masking.js";
import {
  dateRangeInputShape,
  jsonToolError,
  jsonToolResult,
  loadSelectedMappings,
  readOnlyAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

export function registerFireflySummarizeUncategorized(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "firefly_summarize_uncategorized",
    {
      title: "Summarize Uncategorized Firefly Transactions",
      description:
        "Group Firefly III transactions with missing categories by likely merchant and suggest category labels without applying them.",
      inputSchema: dateRangeInputShape,
      annotations: readOnlyAnnotations
    },
    async (input) => {
      try {
        const range = resolveDateRange(input, deps.config.defaultLookbackDays);
        const mappings = await loadSelectedMappings(deps, input);
        const fireflyTransactions = await fetchFireflyTransactionsForMappings(deps.firefly, mappings, range);
        const groups = summarizeUncategorized(fireflyTransactions);

        return jsonToolResult({
          tool: "firefly_summarize_uncategorized",
          read_only: true,
          range: {
            start_date: range.startDate,
            end_date: range.endDate,
            days: range.days
          },
          uncategorized_transaction_count: groups.reduce((sum, group) => sum + group.count, 0),
          summary_groups: groups.map((group) => ({
            merchant: group.merchant,
            suggested_category: group.suggestedCategory,
            count: group.count,
            total: group.total,
            example_transactions: group.examples.map(serializeTransaction)
          }))
        });
      } catch (error) {
        return jsonToolError(error);
      }
    }
  );
}
