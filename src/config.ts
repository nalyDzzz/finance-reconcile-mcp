import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "./types.js";

const optionalString = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());
const optionalUrl = z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional());

const EnvSchema = z.object({
  SIMPLEFIN_ACCESS_URL: optionalUrl,
  FIREFLY_BASE_URL: optionalUrl,
  FIREFLY_PAT: optionalString,
  DEFAULT_LOOKBACK_DAYS: z.coerce.number().int().positive().max(3650).default(30),
  READONLY: z.enum(["true", "false", "1", "0"]).default("true"),
  MOCK_DATA: z.enum(["true", "false", "1", "0"]).default("false"),
  ACCOUNT_MAPPING_FILE: optionalString,
  IGNORED_FINDINGS_FILE: optionalString,
  AUDIT_HISTORY_FILE: optionalString,
  CATEGORY_RULES_FILE: optionalString
});

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function defaultAccountMappingFile(env: NodeJS.ProcessEnv): string {
  return path.join(defaultUserConfigDir(env), "finance-reconcile-mcp", "account-map.json");
}

function defaultUserConfigDir(env: NodeJS.ProcessEnv): string {
  const baseConfigDir =
    process.platform === "win32"
      ? env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
      : env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");

  return baseConfigDir;
}

function defaultUserConfigFile(fileName: string): string {
  return path.join(os.homedir(), ".config", "finance-reconcile-mcp", fileName);
}

function expandHomePath(filePath: string): string {
  if (filePath === "~") {
    return os.homedir();
  }

  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

function resolveAccountMappingFile(filePath: string): string {
  const expanded = expandHomePath(filePath);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(process.cwd(), expanded);
}

function resolveConfigFile(filePath: string): string {
  const expanded = expandHomePath(filePath);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(process.cwd(), expanded);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid configuration: ${details}`);
  }

  const readonly = parsed.data.READONLY === "true" || parsed.data.READONLY === "1";
  if (!readonly) {
    throw new Error("This MCP server is read-only and requires READONLY=true.");
  }

  const mockData = parsed.data.MOCK_DATA === "true" || parsed.data.MOCK_DATA === "1";
  if (!mockData) {
    const missing = [
      ["SIMPLEFIN_ACCESS_URL", parsed.data.SIMPLEFIN_ACCESS_URL],
      ["FIREFLY_BASE_URL", parsed.data.FIREFLY_BASE_URL],
      ["FIREFLY_PAT", parsed.data.FIREFLY_PAT]
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new Error(`Missing required configuration: ${missing.join(", ")}.`);
    }
  }

  const accountMappingFileDefaulted = !parsed.data.ACCOUNT_MAPPING_FILE;
  const accountMappingFile = resolveAccountMappingFile(
    parsed.data.ACCOUNT_MAPPING_FILE ?? defaultAccountMappingFile(env)
  );
  const ignoredFindingsFile = resolveConfigFile(
    parsed.data.IGNORED_FINDINGS_FILE ?? defaultUserConfigFile("ignored-findings.json")
  );
  const auditHistoryFile = resolveConfigFile(
    parsed.data.AUDIT_HISTORY_FILE ?? defaultUserConfigFile("audit-history.json")
  );
  const categoryRulesFile = resolveConfigFile(
    parsed.data.CATEGORY_RULES_FILE ??
      path.join(defaultUserConfigDir(env), "finance-reconcile-mcp", "category-rules.json")
  );

  return {
    simpleFinAccessUrl: parsed.data.SIMPLEFIN_ACCESS_URL ?? "https://mock.simplefin.local/simplefin",
    fireflyBaseUrl: stripTrailingSlash(parsed.data.FIREFLY_BASE_URL ?? "https://mock.firefly.local"),
    fireflyPat: parsed.data.FIREFLY_PAT ?? "mock-token",
    defaultLookbackDays: parsed.data.DEFAULT_LOOKBACK_DAYS,
    readonly: true,
    mockData,
    accountMappingFile,
    accountMappingFileDefaulted,
    ignoredFindingsFile,
    auditHistoryFile,
    categoryRulesFile
  };
}
