import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runReconciliationAudit } from "../services/audit-runner.js";
import {
  dateRangeInputShape,
  jsonToolResult,
  localAuditPersistenceAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

const inputSchema = {
  ...dateRangeInputShape,
  include_details: z.boolean().optional(),
  max_missing: z.number().int().nonnegative().max(1000).optional(),
  max_duplicates: z.number().int().nonnegative().max(1000).optional(),
  max_uncategorized_groups: z.number().int().nonnegative().max(1000).optional(),
  min_duplicate_confidence: z.number().min(0).max(1).optional(),
  include_ignored: z.boolean().optional()
};

export function registerReconcileRunAudit(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "reconcile_run_audit",
    {
      title: "Run Reconciliation Audit",
      description:
        "Run the full reconciliation audit without mutating financial systems. Saves a compact local audit-history snapshot.",
      inputSchema,
      annotations: localAuditPersistenceAnnotations
    },
    async (input) => {
      try {
        const audit = await runReconciliationAudit(deps, input);
        return jsonToolResult({
          tool: "reconcile_run_audit",
          read_only: true,
          financial_data_mutated: false,
          wrote_local_audit_history: true,
          ...audit
        });
      } catch (error) {
        return jsonToolResult({
          tool: "reconcile_run_audit",
          read_only: true,
          financial_data_mutated: false,
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
