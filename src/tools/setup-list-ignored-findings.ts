import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadIgnoredFindings } from "../services/ignored-findings.js";
import {
  jsonToolError,
  jsonToolResult,
  readOnlyAnnotations,
  type ToolDependencies
} from "./tool-utils.js";

export function registerSetupListIgnoredFindings(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "setup_list_ignored_findings",
    {
      title: "List Ignored Findings",
      description:
        "List locally ignored audit finding fingerprints. This only reads local config and never mutates Firefly III or SimpleFIN.",
      annotations: readOnlyAnnotations
    },
    async () => {
      try {
        const ignored = await loadIgnoredFindings(deps.config.ignoredFindingsFile);

        return jsonToolResult({
          tool: "setup_list_ignored_findings",
          read_only: true,
          financial_data_mutated: false,
          ignored_findings_file: deps.config.ignoredFindingsFile,
          ignored_count: ignored.ignored.length,
          ignored: ignored.ignored
        });
      } catch (error) {
        return jsonToolError(error);
      }
    }
  );
}
