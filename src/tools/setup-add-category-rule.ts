import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addCategoryRule } from "../services/category-rules.js";
import {
  jsonToolError,
  jsonToolResult,
  localConfigWriteAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

const inputShape = {
  match: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100)
};

export function registerSetupAddCategoryRule(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "setup_add_category_rule",
    {
      title: "Add Category Rule",
      description:
        "Add or update a local category suggestion rule. This only writes local config and never mutates Firefly III or SimpleFIN.",
      inputSchema: inputShape,
      annotations: localConfigWriteAnnotations
    },
    async (input) => {
      try {
        const result = await addCategoryRule(deps.config.categoryRulesFile, input);

        return jsonToolResult({
          tool: "setup_add_category_rule",
          read_only: false,
          financial_data_mutated: false,
          wrote_local_config: true,
          category_rules_file: deps.config.categoryRulesFile,
          created: result.created,
          rule: result.rule,
          rule_count: result.rules.length,
          next_steps: [
            "Run firefly_summarize_uncategorized to see category suggestions that use this rule.",
            "Run reconcile_run_audit, then reconcile_prepare_review_plan to include reviewable category suggestion items."
          ]
        });
      } catch (error) {
        return jsonToolError(error, false);
      }
    }
  );
}
