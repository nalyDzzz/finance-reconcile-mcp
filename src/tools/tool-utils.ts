import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { FireflyClient } from "../connectors/firefly.js";
import type { SimpleFinClient } from "../connectors/simplefin.js";
import type { AppConfig, DateRangeInput } from "../types.js";
import { filterMappings, loadAccountMap } from "../services/account-mapping.js";

export const dateRangeInputShape = {
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.number().int().positive().max(3650).optional(),
  account: z.string().min(1).optional()
};

export interface ToolDependencies {
  config: AppConfig;
  simplefin: SimpleFinClient;
  firefly: FireflyClient;
}

export async function loadSelectedMappings(deps: ToolDependencies, input: DateRangeInput) {
  const accountMap = await loadAccountMap(deps.config.accountMappingFile);
  return filterMappings(accountMap.accounts, input.account);
}

export const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
};

export function jsonToolResult(data: Record<string, unknown>): CallToolResult {
  return {
    structuredContent: data,
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

export function jsonToolError(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    isError: true,
    structuredContent: {
      error: message,
      read_only: true
    },
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error: message,
            read_only: true
          },
          null,
          2
        )
      }
    ]
  };
}
