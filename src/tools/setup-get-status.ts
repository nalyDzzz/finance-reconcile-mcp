import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { inspectAccountMap } from "../services/account-mapping.js";
import {
  jsonToolError,
  jsonToolResult,
  readOnlyAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

export function registerSetupGetStatus(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "setup_get_status",
    {
      title: "Get Setup Status",
      description: "Show finance-reconcile-mcp setup status, including the account-map path and validation state.",
      annotations: readOnlyAnnotations
    },
    async () => {
      try {
        const accountMap = await inspectAccountMap(deps.config.accountMappingFile);
        const nextSteps: string[] = [];

        if (!accountMap.exists) {
          nextSteps.push("Run setup_suggest_account_map, review the draft, then save it with setup_save_account_map.");
        } else if (!accountMap.valid) {
          nextSteps.push("Fix account-map.json or replace it with a validated draft.");
        } else {
          nextSteps.push("Run reconcile_find_missing_transactions with a days or date range input.");
        }

        return jsonToolResult({
          tool: "setup_get_status",
          read_only: true,
          config: {
            account_mapping_file: deps.config.accountMappingFile,
            account_mapping_file_defaulted: deps.config.accountMappingFileDefaulted,
            default_lookback_days: deps.config.defaultLookbackDays,
            readonly: deps.config.readonly,
            simplefin_configured: true,
            firefly_configured: true
          },
          account_map: {
            path: accountMap.path,
            exists: accountMap.exists,
            valid: accountMap.valid,
            account_count: accountMap.account_count,
            error: accountMap.error
          },
          next_steps: nextSteps
        });
      } catch (error) {
        return jsonToolError(error);
      }
    }
  );
}
