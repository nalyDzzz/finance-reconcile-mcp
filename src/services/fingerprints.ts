import crypto from "node:crypto";
import type { BalanceMismatch, StaleAccountStatus } from "./balance-reconciliation.js";
import type {
  DuplicateGroup,
  FindingType,
  MissingTransactionFinding,
  NormalizedTransaction,
  UncategorizedSummaryGroup
} from "../types.js";
import { moneyKey, normalizeDescription } from "./transaction-matching.js";

export const FINDING_TYPES = [
  "missing_transaction",
  "duplicate_group",
  "balance_mismatch",
  "stale_account",
  "uncategorized_group"
] as const satisfies readonly FindingType[];

export function fingerprintMissingTransaction(finding: MissingTransactionFinding): string {
  const transaction = finding.transaction;

  return fingerprint("missing_transaction", {
    account: transaction.mappedFireflyAccountId,
    date: transaction.date,
    amount_cents: moneyKey(transaction.amount),
    description: normalizedText(transaction.description)
  });
}

export function fingerprintDuplicateGroup(group: DuplicateGroup): string {
  const transactions = sortedTransactions(group.transactions);

  return fingerprint("duplicate_group", {
    account: stableAccountValue(transactions),
    date_range: dateRange(transactions),
    amount_cents: uniqueSorted(transactions.map((transaction) => moneyKey(transaction.amount))),
    descriptions: uniqueSorted(transactions.map((transaction) => normalizedText(transaction.description))),
    count: transactions.length
  });
}

export function fingerprintBalanceMismatch(mismatch: BalanceMismatch): string {
  return fingerprint("balance_mismatch", {
    account: mismatch.account.mapped_firefly_account_id,
    date_range: [mismatch.simplefin_balance_date ?? "unknown", mismatch.firefly_balance_date ?? "unknown"],
    difference_cents: moneyKey(mismatch.difference)
  });
}

export function fingerprintStaleAccount(status: StaleAccountStatus): string {
  return fingerprint("stale_account", {
    account: status.account.mapped_firefly_account_id,
    date_range: [
      status.latest_simplefin_transaction_date ?? "none",
      status.latest_firefly_transaction_date ?? "none"
    ],
    status: status.status
  });
}

export function fingerprintUncategorizedGroup(group: UncategorizedSummaryGroup): string {
  const transactions = sortedTransactions(group.examples);

  return fingerprint("uncategorized_group", {
    account: stableAccountValue(transactions),
    date_range: dateRange(transactions),
    amount_cents: moneyKey(group.total),
    merchant: normalizedText(group.merchant),
    suggested_category: normalizedText(group.suggestedCategory)
  });
}

function fingerprint(type: FindingType, fields: Record<string, unknown>): string {
  const payload = stableStringify({
    type,
    ...fields
  });
  const digest = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
  return `${type}:${digest}`;
}

function normalizedText(value: string): string {
  return normalizeDescription(value).replace(/\b\d{3,}\b/g, " ").replace(/\s+/g, " ").trim();
}

function stableAccountValue(transactions: NormalizedTransaction[]): string | string[] {
  const accounts = uniqueSorted(transactions.map((transaction) => transaction.mappedFireflyAccountId));
  return accounts.length === 1 ? accounts[0] : accounts;
}

function dateRange(transactions: NormalizedTransaction[]): [string, string] {
  const dates = transactions.map((transaction) => transaction.date).sort();
  return [dates[0] ?? "unknown", dates[dates.length - 1] ?? "unknown"];
}

function sortedTransactions(transactions: NormalizedTransaction[]): NormalizedTransaction[] {
  return [...transactions].sort((a, b) => {
    const accountCompare = a.mappedFireflyAccountId.localeCompare(b.mappedFireflyAccountId);
    if (accountCompare !== 0) {
      return accountCompare;
    }

    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) {
      return dateCompare;
    }

    const amountCompare = moneyKey(a.amount) - moneyKey(b.amount);
    if (amountCompare !== 0) {
      return amountCompare;
    }

    return normalizedText(a.description).localeCompare(normalizedText(b.description));
  });
}

function uniqueSorted<T extends string | number>(values: T[]): T[] {
  return [...new Set(values)].sort((a, b) => {
    if (typeof a === "number" && typeof b === "number") {
      return a - b;
    }

    return String(a).localeCompare(String(b));
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
