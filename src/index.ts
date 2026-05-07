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
import { registerSetupListFireflyAccounts } from "./tools/setup-list-firefly-accounts.js";
import { registerSetupListSimpleFinAccounts } from "./tools/setup-list-simplefin-accounts.js";
import { registerSetupSuggestAccountMap } from "./tools/setup-suggest-account-map.js";
import type { ToolDependencies } from "./tools/tool-utils.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const deps: ToolDependencies = {
    config,
    simplefin: new SimpleFinClient(config.simpleFinAccessUrl),
    firefly: new FireflyClient(config.fireflyBaseUrl, config.fireflyPat)
  };

  const server = new McpServer({
    name: "finance-reconcile-mcp",
    version: "0.1.0"
  });

  registerReconcileFindMissingTransactions(server, deps);
  registerReconcileCheckStaleAccounts(server, deps);
  registerReconcileCheckBalanceMismatches(server, deps);
  registerFireflyFindPossibleDuplicates(server, deps);
  registerFireflySummarizeUncategorized(server, deps);
  registerSetupListSimpleFinAccounts(server, deps);
  registerSetupListFireflyAccounts(server, deps);
  registerSetupSuggestAccountMap(server, deps);

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(`finance-reconcile-mcp failed to start: ${message}`);
  process.exitCode = 1;
});
