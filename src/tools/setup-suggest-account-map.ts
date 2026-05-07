import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildAccountMapDraft,
  describeFireflyAccounts,
  describeSimpleFinAccounts,
  suggestAccountMappings
} from "../services/account-discovery.js";
import {
  jsonToolError,
  jsonToolResult,
  readOnlyAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

export function registerSetupSuggestAccountMap(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "setup_suggest_account_map",
    {
      title: "Suggest Account Map",
      description:
        "Fetch SimpleFIN and Firefly III accounts and return a suggested account-map.json draft. Does not write files.",
      annotations: readOnlyAnnotations
    },
    async () => {
      try {
        const [simplefinAccountSet, fireflyRawAccounts] = await Promise.all([
          deps.simplefin.fetchAccounts({ balancesOnly: true }),
          deps.firefly.listAccounts()
        ]);

        const simplefinAccounts = describeSimpleFinAccounts(simplefinAccountSet.accounts);
        const fireflyAccounts = describeFireflyAccounts(fireflyRawAccounts);
        const suggestions = suggestAccountMappings(simplefinAccounts, fireflyAccounts);
        const mappedSimpleFinIds = new Set(suggestions.map((suggestion) => suggestion.simplefin_account.simplefin_id));
        const mappedFireflyIds = new Set(
          suggestions.map((suggestion) => suggestion.firefly_account.firefly_account_id)
        );

        return jsonToolResult({
          tool: "setup_suggest_account_map",
          read_only: true,
          suggested_mapping_count: suggestions.length,
          account_map_json_draft: buildAccountMapDraft(suggestions),
          suggestions,
          unmatched_simplefin_accounts: simplefinAccounts.filter(
            (account) => !mappedSimpleFinIds.has(account.simplefin_id)
          ),
          unmatched_firefly_accounts: fireflyAccounts.filter(
            (account) => !mappedFireflyIds.has(account.firefly_account_id)
          ),
          warnings: simplefinAccountSet.warnings
        });
      } catch (error) {
        return jsonToolError(error);
      }
    }
  );
}
