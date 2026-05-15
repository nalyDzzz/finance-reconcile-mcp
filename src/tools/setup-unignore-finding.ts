import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { unignoreFinding } from "../services/ignored-findings.js";
import {
  jsonToolError,
  jsonToolResult,
  localConfigWriteAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

const inputShape = {
  fingerprint: z.string().min(1)
};

export function registerSetupUnignoreFinding(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "setup_unignore_finding",
    {
      title: "Unignore Finding",
      description:
        "Remove a finding fingerprint from the local ignored-findings file. This never mutates Firefly III or SimpleFIN.",
      inputSchema: inputShape,
      annotations: localConfigWriteAnnotations
    },
    async (input) => {
      try {
        const result = await unignoreFinding(deps.config.ignoredFindingsFile, input.fingerprint);

        return jsonToolResult({
          tool: "setup_unignore_finding",
          read_only: false,
          financial_data_mutated: false,
          wrote_local_config: result.removed,
          ignored_findings_file: deps.config.ignoredFindingsFile,
          removed: result.removed,
          ignored_count: result.ignored.length
        });
      } catch (error) {
        return jsonToolError(error, false);
      }
    }
  );
}
