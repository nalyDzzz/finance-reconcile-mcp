import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prepareReviewPlan } from "../services/review-plan.js";
import {
  jsonToolError,
  jsonToolResult,
  readOnlyAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

export function registerReconcilePrepareReviewPlan(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "reconcile_prepare_review_plan",
    {
      title: "Prepare Audit Review Plan",
      description:
        "Create a compact manual review plan from the latest local audit history snapshot without mutating Firefly III or SimpleFIN.",
      annotations: readOnlyAnnotations
    },
    async () => {
      try {
        const plan = await prepareReviewPlan(deps.config.auditHistoryFile);

        return jsonToolResult({
          tool: "reconcile_prepare_review_plan",
          read_only: true,
          financial_data_mutated: false,
          ...plan
        });
      } catch (error) {
        return jsonToolError(error);
      }
    }
  );
}
