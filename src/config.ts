import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "./types.js";

const EnvSchema = z.object({
  SIMPLEFIN_ACCESS_URL: z.string().url(),
  FIREFLY_BASE_URL: z.string().url(),
  FIREFLY_PAT: z.string().min(1),
  DEFAULT_LOOKBACK_DAYS: z.coerce.number().int().positive().max(3650).default(30),
  READONLY: z.enum(["true", "false", "1", "0"]).default("true"),
  ACCOUNT_MAPPING_FILE: z.string().min(1).optional()
});

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function defaultAccountMappingFile(env: NodeJS.ProcessEnv): string {
  const baseConfigDir =
    process.platform === "win32"
      ? env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
      : env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");

  return path.join(baseConfigDir, "finance-reconcile-mcp", "account-map.json");
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

  const accountMappingFileDefaulted = !parsed.data.ACCOUNT_MAPPING_FILE;
  const accountMappingFile = resolveAccountMappingFile(
    parsed.data.ACCOUNT_MAPPING_FILE ?? defaultAccountMappingFile(env)
  );

  return {
    simpleFinAccessUrl: parsed.data.SIMPLEFIN_ACCESS_URL,
    fireflyBaseUrl: stripTrailingSlash(parsed.data.FIREFLY_BASE_URL),
    fireflyPat: parsed.data.FIREFLY_PAT,
    defaultLookbackDays: parsed.data.DEFAULT_LOOKBACK_DAYS,
    readonly: true,
    accountMappingFile,
    accountMappingFileDefaulted
  };
}
