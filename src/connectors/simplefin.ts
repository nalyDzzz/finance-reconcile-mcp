import { z } from "zod";
import type { AccountMapping, NormalizedAccount, NormalizedTransaction, ServiceWarning } from "../types.js";
import { addDays, epochSecondsToDate, toEpochSeconds } from "../services/date-utils.js";

const SimpleFinErrorSchema = z.object({
  code: z.string().optional(),
  msg: z.string().optional(),
  message: z.string().optional(),
  conn_id: z.string().optional(),
  account_id: z.string().optional()
}).passthrough();

const SimpleFinTransactionSchema = z.object({
  id: z.string(),
  posted: z.number(),
  amount: z.string(),
  description: z.string(),
  transacted_at: z.number().optional(),
  pending: z.boolean().optional(),
  extra: z.record(z.unknown()).optional()
}).passthrough();

const SimpleFinAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  conn_id: z.string().optional(),
  conn_name: z.string().optional(),
  currency: z.string().optional(),
  balance: z.string(),
  "available-balance": z.string().optional(),
  "balance-date": z.number(),
  transactions: z.array(SimpleFinTransactionSchema).optional(),
  extra: z.record(z.unknown()).optional()
}).passthrough();

const SimpleFinAccountSetSchema = z.object({
  errlist: z.array(SimpleFinErrorSchema).optional().default([]),
  errors: z.array(z.string()).optional().default([]),
  accounts: z.array(SimpleFinAccountSchema).default([]),
  connections: z.array(z.record(z.unknown())).optional().default([])
}).passthrough();

export type SimpleFinAccount = z.infer<typeof SimpleFinAccountSchema>;
export type SimpleFinTransaction = z.infer<typeof SimpleFinTransactionSchema>;

export interface SimpleFinFetchAccountsOptions {
  startDate?: string;
  endDate?: string;
  accountIds?: string[];
  balancesOnly?: boolean;
  includePending?: boolean;
}

export interface SimpleFinAccountSet {
  accounts: SimpleFinAccount[];
  warnings: ServiceWarning[];
}

export class SimpleFinClient {
  constructor(private readonly accessUrl: string) {}

  async fetchAccounts(options: SimpleFinFetchAccountsOptions = {}): Promise<SimpleFinAccountSet> {
    const url = this.buildAccountsUrl(options);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "accept": "application/json",
        "user-agent": "finance-reconcile-mcp/0.1"
      }
    });

    if (response.status === 403) {
      throw new Error("SimpleFIN authentication failed or access was revoked.");
    }

    if (response.status === 402) {
      throw new Error("SimpleFIN returned payment required for this Access URL.");
    }

    if (!response.ok) {
      throw new Error(`SimpleFIN request failed with HTTP ${response.status}.`);
    }

    const body = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error("SimpleFIN returned a non-JSON response.");
    }

    const parsed = SimpleFinAccountSetSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`SimpleFIN returned an unexpected response shape: ${parsed.error.message}`);
    }

    const warnings = [
      ...parsed.data.errlist.map(simpleFinErrorToWarning),
      ...parsed.data.errors.map((message) => ({ code: "simplefin.deprecated_error", message }))
    ];

    const blocking = warnings.find((warning) =>
      ["gen.auth", "con.auth"].includes(warning.code) || warning.code.startsWith("gen.")
    );
    if (blocking) {
      throw new Error(`SimpleFIN reported ${blocking.code}: ${blocking.message}`);
    }

    return {
      accounts: parsed.data.accounts,
      warnings
    };
  }

  private buildAccountsUrl(options: SimpleFinFetchAccountsOptions): URL {
    const url = new URL(this.accessUrl);
    if (!url.pathname.endsWith("/accounts")) {
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/accounts`;
    }

    if (options.startDate) {
      url.searchParams.set("start-date", `${toEpochSeconds(options.startDate)}`);
    }

    if (options.endDate) {
      url.searchParams.set("end-date", `${toEpochSeconds(addDays(options.endDate, 1))}`);
    }

    if (options.includePending) {
      url.searchParams.set("pending", "1");
    }

    if (options.balancesOnly) {
      url.searchParams.set("balances-only", "1");
    }

    url.searchParams.set("version", "2");

    for (const accountId of options.accountIds ?? []) {
      url.searchParams.append("account", accountId);
    }

    return url;
  }
}

function simpleFinErrorToWarning(error: z.infer<typeof SimpleFinErrorSchema>): ServiceWarning {
  return {
    code: error.code ?? "simplefin.error",
    message: error.msg ?? error.message ?? "SimpleFIN reported an unspecified error.",
    account: error.account_id
  };
}

function parseAmount(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid SimpleFIN amount: ${value}`);
  }

  return parsed;
}

function collectExternalIds(transaction: SimpleFinTransaction): string[] {
  const extra = transaction.extra ?? {};
  const candidates = [
    transaction.id,
    extra.fit_id,
    extra.external_id,
    extra.transaction_id
  ];

  return candidates.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function normalizeSimpleFinAccount(account: SimpleFinAccount, mapping: AccountMapping): NormalizedAccount {
  return {
    source: "simplefin",
    sourceAccountId: account.id,
    sourceAccountName: account.name,
    mappedFireflyAccountId: mapping.firefly_account_id,
    displayName: mapping.firefly_name ?? mapping.simplefin_name ?? account.name,
    currency: account.currency,
    balance: parseAmount(account.balance),
    balanceDate: epochSecondsToDate(account["balance-date"])
  };
}

export function normalizeSimpleFinTransactions(
  account: SimpleFinAccount,
  mapping: AccountMapping
): NormalizedTransaction[] {
  return (account.transactions ?? []).map((transaction) => {
    const posted = transaction.posted || transaction.transacted_at;
    const date = posted ? epochSecondsToDate(posted) : "1970-01-01";

    return {
      source: "simplefin",
      id: transaction.id,
      externalIds: collectExternalIds(transaction),
      sourceAccountId: account.id,
      sourceAccountName: account.name,
      mappedFireflyAccountId: mapping.firefly_account_id,
      accountDisplayName: mapping.firefly_name ?? mapping.simplefin_name ?? account.name,
      date,
      amount: parseAmount(transaction.amount),
      currency: account.currency,
      description: transaction.description,
      pending: transaction.pending ?? false,
      metadata: {
        transacted_at: transaction.transacted_at,
        posted: transaction.posted
      }
    };
  });
}
