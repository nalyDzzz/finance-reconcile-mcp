import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadCategoryRules } from "../services/category-rules.js";
import {
  jsonToolError,
  jsonToolResult,
  readOnlyAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

export function registerSetupListCategoryRules(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "setup_list_category_rules",
    {
      title: "List Category Rules",
      description:
        "List local category suggestion rules. This only reads local config and never mutates Firefly III or SimpleFIN.",
      annotations: readOnlyAnnotations
    },
    async () => {
      try {
        const file = await loadCategoryRules(deps.config.categoryRulesFile);

        return jsonToolResult({
          tool: "setup_list_category_rules",
          read_only: true,
          financial_data_mutated: false,
          category_rules_file: deps.config.categoryRulesFile,
          rule_count: file.rules.length,
          rules: file.rules
        });
      } catch (error) {
        return jsonToolError(error);
      }
    }
  );
}
