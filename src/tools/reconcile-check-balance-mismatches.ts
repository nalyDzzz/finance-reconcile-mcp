import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { reconcileBalances } from "../services/balance-reconciliation.js";
import { resolveDateRange } from "../services/date-utils.js";
import {
  fetchFireflyAccountsForMappings,
  fetchFireflyTransactionsForMappings,
  fetchMappedSimpleFinAccounts
} from "../services/reconciliation-data.js";
import {
  dateRangeInputShape,
  jsonToolError,
  jsonToolResult,
  loadSelectedMappings,
  readOnlyAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

const balanceInputShape = {
  ...dateRangeInputShape,
  tolerance: z.number().nonnegative().max(1_000_000).optional()
};

export function registerReconcileCheckBalanceMismatches(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "reconcile_check_balance_mismatches",
    {
      title: "Check Balance Mismatches",
      description: "Compare mapped SimpleFIN account balances against Firefly III account balances.",
      inputSchema: balanceInputShape,
      annotations: readOnlyAnnotations
    },
    async (input) => {
      try {
        const range = resolveDateRange(input, deps.config.defaultLookbackDays);
        const mappings = await loadSelectedMappings(deps, input);
        const [simplefinAccounts, fireflyAccounts, fireflyTransactions] = await Promise.all([
          fetchMappedSimpleFinAccounts(deps.simplefin, mappings, range, true),
          fetchFireflyAccountsForMappings(deps.firefly, mappings, range.endDate),
          fetchFireflyTransactionsForMappings(deps.firefly, mappings, range)
        ]);

        const result = reconcileBalances(
          simplefinAccounts.simplefinAccounts.map((account) => account.normalized),
          fireflyAccounts,
          fireflyTransactions,
          input.tolerance ?? 0.01,
          simplefinAccounts.warnings
        );

        return jsonToolResult({
          tool: "reconcile_check_balance_mismatches",
          read_only: true,
          as_of_date: range.endDate,
          tolerance: input.tolerance ?? 0.01,
          ...result
        });
      } catch (error) {
        return jsonToolError(error);
      }
    }
  );
}
