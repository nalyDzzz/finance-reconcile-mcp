import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { saveAccountMap } from "../services/account-mapping.js";
import {
  jsonToolError,
  jsonToolResult,
  localConfigWriteAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

const inputShape = {
  account_map: z.unknown(),
  overwrite: z.boolean().optional(),
  confirm_write: z.boolean()
};

export function registerSetupSaveAccountMap(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "setup_save_account_map",
    {
      title: "Save Account Map",
      description:
        "Write account-map.json to the configured local account mapping path. This only writes local config and never mutates Firefly III or SimpleFIN.",
      inputSchema: inputShape,
      annotations: localConfigWriteAnnotations
    },
    async (input) => {
      try {
        if (!input.confirm_write) {
          throw new Error("confirm_write must be true to write account-map.json.");
        }

        const accountMap = await saveAccountMap(deps.config.accountMappingFile, input.account_map, {
          overwrite: input.overwrite ?? false
        });

        return jsonToolResult({
          tool: "setup_save_account_map",
          read_only: false,
          financial_data_mutated: false,
          wrote_local_config: true,
          account_mapping_file: deps.config.accountMappingFile,
          account_count: accountMap.accounts.length,
          next_steps: [
            "Run setup_validate_account_map to verify the saved map.",
            "Run reconcile_find_missing_transactions with a days or date range input."
          ]
        });
      } catch (error) {
        return jsonToolError(error, false);
      }
    }
  );
}
