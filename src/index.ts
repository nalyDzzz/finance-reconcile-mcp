#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FireflyClient } from "./connectors/firefly.js";
import { SimpleFinClient } from "./connectors/simplefin.js";
import { loadConfig } from "./config.js";
import { registerFireflyFindPossibleDuplicates } from "./tools/firefly-find-possible-duplicates.js";
import { registerFireflySummarizeUncategorized } from "./tools/firefly-summarize-uncategorized.js";
import { registerReconcileCheckBalanceMismatches } from "./tools/reconcile-check-balance-mismatches.js";
import { registerReconcileCheckStaleAccounts } from "./tools/reconcile-check-stale-accounts.js";
import { registerReconcileFindMissingTransactions } from "./tools/reconcile-find-missing-transactions.js";
import { registerReconcileRunAudit } from "./tools/reconcile-run-audit.js";
import { registerSetupGetStatus } from "./tools/setup-get-status.js";
import { registerSetupIgnoreFinding } from "./tools/setup-ignore-finding.js";
import { registerSetupListFireflyAccounts } from "./tools/setup-list-firefly-accounts.js";
import { registerSetupListIgnoredFindings } from "./tools/setup-list-ignored-findings.js";
import { registerSetupListSimpleFinAccounts } from "./tools/setup-list-simplefin-accounts.js";
import { registerSetupSaveAccountMap } from "./tools/setup-save-account-map.js";
import { registerSetupSuggestAccountMap } from "./tools/setup-suggest-account-map.js";
import { registerSetupUnignoreFinding } from "./tools/setup-unignore-finding.js";
import { registerSetupValidateAccountMap } from "./tools/setup-validate-account-map.js";
import type { ToolDependencies } from "./tools/tool-utils.js";
import { inspectAccountMap } from "./services/account-mapping.js";

async function readPackageVersion(): Promise<string> {
  const packageUrl = new URL("../package.json", import.meta.url);
  const packageJson = JSON.parse(await (await import("node:fs/promises")).readFile(packageUrl, "utf8")) as {
    version?: string;
  };
  return packageJson.version ?? "0.0.0";
}

async function handleCli(args: string[]): Promise<boolean> {
  if (args.includes("--version") || args.includes("-v")) {
    console.log(await readPackageVersion());
    return true;
  }

  if (args.includes("--check-config")) {
    try {
      const config = loadConfig();
      const accountMap = await inspectAccountMap(config.accountMappingFile);
      const valid = config.mockData || accountMap.valid;
      console.log(JSON.stringify({
        status: valid ? "ok" : "needs_attention",
        config: {
          readonly: config.readonly,
          mock_data: config.mockData,
          default_lookback_days: config.defaultLookbackDays,
          account_mapping_file: config.accountMappingFile,
          account_mapping_file_defaulted: config.accountMappingFileDefaulted,
          ignored_findings_file: config.ignoredFindingsFile,
          audit_history_file: config.auditHistoryFile,
          simplefin_configured: Boolean(config.simpleFinAccessUrl),
          firefly_configured: Boolean(config.fireflyBaseUrl && config.fireflyPat)
        },
        account_map: {
          exists: accountMap.exists,
          valid: accountMap.valid,
          account_count: accountMap.account_count,
          error: accountMap.error
        }
      }, null, 2));
      process.exitCode = valid ? 0 : 1;
    } catch (error) {
      console.log(JSON.stringify({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown configuration error"
      }, null, 2));
      process.exitCode = 1;
    }
    return true;
  }

  return false;
}

async function main(): Promise<void> {
  if (await handleCli(process.argv.slice(2))) {
    return;
  }

  const config = loadConfig();
  const deps: ToolDependencies = {
    config,
    simplefin: new SimpleFinClient(config.simpleFinAccessUrl, { mockData: config.mockData }),
    firefly: new FireflyClient(config.fireflyBaseUrl, config.fireflyPat, { mockData: config.mockData })
  };

  const server = new McpServer({
    name: "finance-reconcile-mcp",
    version: "0.2.0"
  });

  registerReconcileFindMissingTransactions(server, deps);
  registerReconcileRunAudit(server, deps);
  registerReconcileCheckStaleAccounts(server, deps);
  registerReconcileCheckBalanceMismatches(server, deps);
  registerFireflyFindPossibleDuplicates(server, deps);
  registerFireflySummarizeUncategorized(server, deps);
  registerSetupGetStatus(server, deps);
  registerSetupListSimpleFinAccounts(server, deps);
  registerSetupListFireflyAccounts(server, deps);
  registerSetupListIgnoredFindings(server, deps);
  registerSetupIgnoreFinding(server, deps);
  registerSetupUnignoreFinding(server, deps);
  registerSetupSuggestAccountMap(server, deps);
  registerSetupValidateAccountMap(server, deps);
  registerSetupSaveAccountMap(server, deps);

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(`finance-reconcile-mcp failed to start: ${message}`);
  process.exitCode = 1;
});
