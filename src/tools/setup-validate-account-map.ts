import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeFireflyAccounts, validateAccountMapAgainstDiscoveredAccounts } from "../services/account-discovery.js";
import { inspectAccountMap, validateAccountMap } from "../services/account-mapping.js";
import {
  jsonToolError,
  jsonToolResult,
  readOnlyAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

const inputShape = {
  account_map: z.unknown().optional(),
  check_remote: z.boolean().optional()
};

export function registerSetupValidateAccountMap(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "setup_validate_account_map",
    {
      title: "Validate Account Map",
      description:
        "Validate an account-map JSON object or the configured account-map.json file, optionally checking live SimpleFIN and Firefly accounts.",
      inputSchema: inputShape,
      annotations: readOnlyAnnotations
    },
    async (input) => {
      try {
        const checkRemote = input.check_remote ?? true;
        const accountMap = input.account_map
          ? validateAccountMap(input.account_map)
          : await loadConfiguredAccountMapForValidation(deps.config.accountMappingFile);
        const issues = [];

        if (checkRemote) {
          const [simplefinAccountSet, fireflyRawAccounts] = await Promise.all([
            deps.simplefin.fetchAccounts({ balancesOnly: true }),
            deps.firefly.listAccounts()
          ]);
          issues.push(
            ...validateAccountMapAgainstDiscoveredAccounts(
              accountMap.accounts,
              simplefinAccountSet.accounts,
              describeFireflyAccounts(fireflyRawAccounts)
            )
          );
          issues.push(
            ...simplefinAccountSet.warnings.map((warning) => ({
              severity: "warning" as const,
              code: warning.code,
              message: warning.message,
              account: warning.account
            }))
          );
        }

        return jsonToolResult({
          tool: "setup_validate_account_map",
          read_only: true,
          checked_remote_accounts: checkRemote,
          valid: !issues.some((issue) => issue.severity === "error"),
          account_count: accountMap.accounts.length,
          issues
        });
      } catch (error) {
        return jsonToolError(error);
      }
    }
  );
}

async function loadConfiguredAccountMapForValidation(filePath: string) {
  const inspection = await inspectAccountMap(filePath);
  if (!inspection.exists) {
    throw new Error(`Account mapping file not found at ${filePath}.`);
  }

  if (!inspection.valid || !inspection.account_map) {
    throw new Error(inspection.error ?? `Account mapping file at ${filePath} is invalid.`);
  }

  return inspection.account_map;
}
