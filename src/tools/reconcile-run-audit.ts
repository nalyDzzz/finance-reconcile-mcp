import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runReconciliationAudit } from "../services/audit-runner.js";
import {
  dateRangeInputShape,
  jsonToolResult,
  readOnlyAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

export function registerReconcileRunAudit(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "reconcile_run_audit",
    {
      title: "Run Reconciliation Audit",
      description:
        "Run the full read-only reconciliation audit: missing transactions, stale accounts, balance mismatches, duplicates, and uncategorized summaries.",
      inputSchema: dateRangeInputShape,
      annotations: readOnlyAnnotations
    },
    async (input) => {
      try {
        const audit = await runReconciliationAudit(deps, input);
        return jsonToolResult({
          tool: "reconcile_run_audit",
          read_only: true,
          ...audit
        });
      } catch (error) {
        return jsonToolResult({
          tool: "reconcile_run_audit",
          read_only: true,
          status: "error",
          summary: {},
          recommended_actions: ["Fix the configuration or connector error, then run the audit again."],
          details: {
            error: error instanceof Error ? error.message : "Unknown error"
          }
        });
      }
    }
  );
}
