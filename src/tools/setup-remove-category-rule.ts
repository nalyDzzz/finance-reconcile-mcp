import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { removeCategoryRule } from "../services/category-rules.js";
import {
  jsonToolError,
  jsonToolResult,
  localConfigWriteAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

const inputShape = {
  id: z.string().min(1)
};

export function registerSetupRemoveCategoryRule(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "setup_remove_category_rule",
    {
      title: "Remove Category Rule",
      description:
        "Remove a local category suggestion rule. This only writes local config and never mutates Firefly III or SimpleFIN.",
      inputSchema: inputShape,
      annotations: localConfigWriteAnnotations
    },
    async (input) => {
      try {
        const result = await removeCategoryRule(deps.config.categoryRulesFile, input.id);

        return jsonToolResult({
          tool: "setup_remove_category_rule",
          read_only: false,
          financial_data_mutated: false,
          wrote_local_config: result.removed,
          category_rules_file: deps.config.categoryRulesFile,
          removed: result.removed,
          rule_count: result.rules.length,
          rules: result.rules
        });
      } catch (error) {
        return jsonToolError(error, false);
      }
    }
  );
}
