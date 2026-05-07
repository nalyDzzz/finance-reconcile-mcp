import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkStaleAccounts } from "../services/balance-reconciliation.js";
import { normalizeSimpleFinTransactions } from "../connectors/simplefin.js";
import { resolveDateRange } from "../services/date-utils.js";
import {
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

export function registerReconcileCheckStaleAccounts(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "reconcile_check_stale_accounts",
    {
      title: "Check Stale Accounts",
      description:
        "Compare latest SimpleFIN transaction dates against latest Firefly III transaction dates for mapped accounts.",
      inputSchema: dateRangeInputShape,
      annotations: readOnlyAnnotations
    },
    async (input) => {
      try {
        const range = resolveDateRange(input, deps.config.defaultLookbackDays);
        const mappings = await loadSelectedMappings(deps, input);
        const [simplefinAccounts, fireflyTransactions] = await Promise.all([
          fetchMappedSimpleFinAccounts(deps.simplefin, mappings, range, false),
          fetchFireflyTransactionsForMappings(deps.firefly, mappings, range)
        ]);
        const simplefinTransactions = simplefinAccounts.simplefinAccounts.flatMap(({ raw, mapping }) =>
          normalizeSimpleFinTransactions(raw, mapping)
        );

        const statuses = checkStaleAccounts(
          simplefinAccounts.simplefinAccounts.map((account) => account.normalized),
          simplefinTransactions,
          fireflyTransactions
        );

        return jsonToolResult({
          tool: "reconcile_check_stale_accounts",
          read_only: true,
          range: {
            start_date: range.startDate,
            end_date: range.endDate,
            days: range.days
          },
          stale_accounts: statuses.filter(
            (status) => status.status === "behind" || status.status === "no_firefly_transactions"
          ),
          checked_accounts: statuses,
          warnings: simplefinAccounts.warnings
        });
      } catch (error) {
        return jsonToolError(error);
      }
    }
  );
}
