import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describeSimpleFinAccounts } from "../services/account-discovery.js";
import {
  jsonToolError,
  jsonToolResult,
  readOnlyAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

export function registerSetupListSimpleFinAccounts(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "setup_list_simplefin_accounts",
    {
      title: "List SimpleFIN Accounts",
      description: "List SimpleFIN accounts for building account-map.json. Returns balances only, no transactions.",
      annotations: readOnlyAnnotations
    },
    async () => {
      try {
        const accountSet = await deps.simplefin.fetchAccounts({ balancesOnly: true });
        const accounts = describeSimpleFinAccounts(accountSet.accounts);

        return jsonToolResult({
          tool: "setup_list_simplefin_accounts",
          read_only: true,
          account_count: accounts.length,
          accounts,
          warnings: accountSet.warnings
        });
      } catch (error) {
        return jsonToolError(error);
      }
    }
  );
}
