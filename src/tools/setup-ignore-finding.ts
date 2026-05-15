import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FINDING_TYPES } from "../services/fingerprints.js";
import { ignoreFinding } from "../services/ignored-findings.js";
import {
  jsonToolError,
  jsonToolResult,
  localConfigWriteAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

const inputShape = {
  fingerprint: z.string().min(1),
  type: z.enum(FINDING_TYPES),
  reason: z.string().trim().min(1).max(500)
};

export function registerSetupIgnoreFinding(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "setup_ignore_finding",
    {
      title: "Ignore Finding",
      description:
        "Add a finding fingerprint to the local ignored-findings file. This never mutates Firefly III or SimpleFIN.",
      inputSchema: inputShape,
      annotations: localConfigWriteAnnotations
    },
    async (input) => {
      try {
        const result = await ignoreFinding(deps.config.ignoredFindingsFile, input);

        return jsonToolResult({
          tool: "setup_ignore_finding",
          read_only: false,
          financial_data_mutated: false,
          wrote_local_config: result.created,
          ignored_findings_file: deps.config.ignoredFindingsFile,
          ignored: result.ignored,
          created: result.created,
          next_steps: [
            "Run reconcile_run_audit again; ignored findings are excluded from active counts by default.",
            "Pass include_ignored=true to reconcile_run_audit to inspect ignored findings."
          ]
        });
      } catch (error) {
        return jsonToolError(error, false);
      }
    }
  );
}
