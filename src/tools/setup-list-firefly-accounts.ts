import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeFireflyAccounts } from "../services/account-discovery.js";
import {
  jsonToolError,
  jsonToolResult,
  readOnlyAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

const inputShape = {
  type: z.string().min(1).optional()
};

export function registerSetupListFireflyAccounts(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "setup_list_firefly_accounts",
    {
      title: "List Firefly Accounts",
      description: "List Firefly III asset/liability accounts for building account-map.json.",
      inputSchema: inputShape,
      annotations: readOnlyAnnotations
    },
    async (input) => {
      try {
        const rawAccounts = await deps.firefly.listAccounts({ type: input.type });
        const accounts = describeFireflyAccounts(rawAccounts);

        return jsonToolResult({
          tool: "setup_list_firefly_accounts",
          read_only: true,
          account_count: accounts.length,
          accounts
        });
      } catch (error) {
        return jsonToolError(error);
      }
    }
  );
}
