import type { NormalizedAccount, NormalizedTransaction, ServiceWarning } from "../types.js";
import { diffDays, latestDate } from "./date-utils.js";
import { roundMoney } from "./masking.js";

export interface BalanceMismatch {
  account: {
    mapped_firefly_account_id: string;
    display_name: string;
  };
  simplefin_balance: number;
  simplefin_balance_date?: string;
  firefly_balance: number;
  firefly_balance_date?: string;
  difference: number;
  likely_reason: string;
}

export interface BalanceReconciliationResult {
  mismatches: BalanceMismatch[];
  matched_count: number;
  checked_count: number;
  warnings: ServiceWarning[];
}

export interface StaleAccountStatus {
  account: {
    mapped_firefly_account_id: string;
    display_name: string;
  };
  latest_simplefin_transaction_date?: string;
  latest_firefly_transaction_date?: string;
  days_behind: number | null;
  status: "current" | "behind" | "no_recent_simplefin_transactions" | "no_firefly_transactions";
}

export function reconcileBalances(
  simplefinAccounts: NormalizedAccount[],
  fireflyAccounts: NormalizedAccount[],
  fireflyTransactions: NormalizedTransaction[],
  tolerance = 0.01,
  warnings: ServiceWarning[] = []
): BalanceReconciliationResult {
  const mismatches: BalanceMismatch[] = [];
  let matchedCount = 0;

  for (const simplefinAccount of simplefinAccounts) {
    const fireflyAccount = fireflyAccounts.find(
      (account) => account.mappedFireflyAccountId === simplefinAccount.mappedFireflyAccountId
    );

    if (!fireflyAccount || simplefinAccount.balance === undefined || fireflyAccount.balance === undefined) {
      warnings.push({
        code: "balance.account_balance_missing",
        message: `Could not compare balances for ${simplefinAccount.displayName}.`,
        account: simplefinAccount.displayName
      });
      continue;
    }

    const difference = roundMoney(simplefinAccount.balance - fireflyAccount.balance);
    if (Math.abs(difference) <= tolerance) {
      matchedCount += 1;
      continue;
    }

    mismatches.push({
      account: {
        mapped_firefly_account_id: simplefinAccount.mappedFireflyAccountId,
        display_name: simplefinAccount.displayName
      },
      simplefin_balance: roundMoney(simplefinAccount.balance),
      simplefin_balance_date: simplefinAccount.balanceDate,
      firefly_balance: roundMoney(fireflyAccount.balance),
      firefly_balance_date: fireflyAccount.balanceDate,
      difference,
      likely_reason: inferBalanceReason(simplefinAccount, fireflyAccount, fireflyTransactions, tolerance)
    });
  }

  return {
    mismatches,
    matched_count: matchedCount,
    checked_count: simplefinAccounts.length,
    warnings
  };
}

export function checkStaleAccounts(
  simplefinAccounts: NormalizedAccount[],
  simplefinTransactions: NormalizedTransaction[],
  fireflyTransactions: NormalizedTransaction[]
): StaleAccountStatus[] {
  return simplefinAccounts.map((account) => {
    const latestSimpleFin = latestDate(
      simplefinTransactions
        .filter((transaction) => transaction.mappedFireflyAccountId === account.mappedFireflyAccountId)
        .map((transaction) => transaction.date)
    );
    const latestFirefly = latestDate(
      fireflyTransactions
        .filter((transaction) => transaction.mappedFireflyAccountId === account.mappedFireflyAccountId)
        .map((transaction) => transaction.date)
    );

    if (!latestSimpleFin) {
      return {
        account: {
          mapped_firefly_account_id: account.mappedFireflyAccountId,
          display_name: account.displayName
        },
        latest_simplefin_transaction_date: latestSimpleFin,
        latest_firefly_transaction_date: latestFirefly,
        days_behind: null,
        status: "no_recent_simplefin_transactions"
      };
    }

    if (!latestFirefly) {
      return {
        account: {
          mapped_firefly_account_id: account.mappedFireflyAccountId,
          display_name: account.displayName
        },
        latest_simplefin_transaction_date: latestSimpleFin,
        latest_firefly_transaction_date: latestFirefly,
        days_behind: null,
        status: "no_firefly_transactions"
      };
    }

    const daysBehind = diffDays(latestSimpleFin, latestFirefly);

    return {
      account: {
        mapped_firefly_account_id: account.mappedFireflyAccountId,
        display_name: account.displayName
      },
      latest_simplefin_transaction_date: latestSimpleFin,
      latest_firefly_transaction_date: latestFirefly,
      days_behind: Math.max(0, daysBehind),
      status: daysBehind > 0 ? "behind" : "current"
    };
  });
}

function inferBalanceReason(
  simplefinAccount: NormalizedAccount,
  fireflyAccount: NormalizedAccount,
  fireflyTransactions: NormalizedTransaction[],
  tolerance: number
): string {
  const simplefinBalance = simplefinAccount.balance ?? 0;
  const fireflyBalance = fireflyAccount.balance ?? 0;

  if (Math.abs(simplefinBalance + fireflyBalance) <= tolerance) {
    return "Balances appear to use opposite signs.";
  }

  const latestFireflyTransaction = latestDate(
    fireflyTransactions
      .filter((transaction) => transaction.mappedFireflyAccountId === simplefinAccount.mappedFireflyAccountId)
      .map((transaction) => transaction.date)
  );

  if (simplefinAccount.balanceDate && latestFireflyTransaction) {
    const behind = diffDays(simplefinAccount.balanceDate, latestFireflyTransaction);
    if (behind > 0) {
      return `Firefly III latest transaction is ${behind} day(s) behind the SimpleFIN balance date.`;
    }
  }

  if (!latestFireflyTransaction) {
    return "No Firefly III transactions were found in the lookback window.";
  }

  if (simplefinAccount.currency && fireflyAccount.currency && simplefinAccount.currency !== fireflyAccount.currency) {
    return `Currency differs (${simplefinAccount.currency} vs ${fireflyAccount.currency}).`;
  }

  return "Balances differ; likely missing, duplicated, pending, or manually adjusted transactions.";
}
