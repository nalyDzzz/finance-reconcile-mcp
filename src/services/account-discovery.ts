import type { FireflyResource } from "../connectors/firefly.js";
import type { SimpleFinAccount } from "../connectors/simplefin.js";
import type { AccountMapping } from "../types.js";
import { descriptionSimilarity } from "./transaction-matching.js";
import { maskIdentifier, roundMoney, roundScore } from "./masking.js";

export interface DiscoveredSimpleFinAccount {
  simplefin_id: string;
  simplefin_id_masked: string;
  simplefin_name: string;
  currency?: string;
  balance?: number;
  balance_date?: string;
}

export interface DiscoveredFireflyAccount {
  firefly_account_id: string;
  firefly_name: string;
  type?: string;
  currency?: string;
  current_balance?: number;
}

export interface SuggestedAccountMapping {
  confidence: number;
  reasons: string[];
  mapping: AccountMapping;
  simplefin_account: DiscoveredSimpleFinAccount;
  firefly_account: DiscoveredFireflyAccount;
}

export function describeSimpleFinAccounts(accounts: SimpleFinAccount[]): DiscoveredSimpleFinAccount[] {
  return accounts
    .map((account) => ({
      simplefin_id: account.id,
      simplefin_id_masked: maskIdentifier(account.id) ?? "**",
      simplefin_name: account.name,
      currency: account.currency,
      balance: parseAmount(account.balance),
      balance_date:
        typeof account["balance-date"] === "number"
          ? new Date(account["balance-date"] * 1000).toISOString().slice(0, 10)
          : undefined
    }))
    .sort((a, b) => a.simplefin_name.localeCompare(b.simplefin_name));
}

export function describeFireflyAccounts(accounts: FireflyResource[]): DiscoveredFireflyAccount[] {
  return accounts
    .map((account) => {
      const attributes = account.attributes;
      return {
        firefly_account_id: account.id,
        firefly_name: stringAttr(attributes, "name") ?? account.id,
        type: stringAttr(attributes, "type"),
        currency: stringAttr(attributes, "currency_code") ?? stringAttr(attributes, "primary_currency_code"),
        current_balance: parseAmount(attributes.current_balance) ?? parseAmount(attributes.balance)
      };
    })
    .filter((account) => account.type === undefined || ["asset", "liabilities", "liability"].includes(account.type))
    .sort((a, b) => a.firefly_name.localeCompare(b.firefly_name));
}

export function suggestAccountMappings(
  simplefinAccounts: DiscoveredSimpleFinAccount[],
  fireflyAccounts: DiscoveredFireflyAccount[]
): SuggestedAccountMapping[] {
  const suggestions: SuggestedAccountMapping[] = [];
  const usedFireflyIds = new Set<string>();

  for (const simplefinAccount of simplefinAccounts) {
    const candidates = fireflyAccounts
      .filter((account) => !usedFireflyIds.has(account.firefly_account_id))
      .map((fireflyAccount) => scoreAccountPair(simplefinAccount, fireflyAccount))
      .sort((a, b) => b.confidence - a.confidence);

    const best = candidates[0];
    if (!best || best.confidence < 0.35) {
      continue;
    }

    usedFireflyIds.add(best.firefly_account.firefly_account_id);
    suggestions.push(best);
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

export function buildAccountMapDraft(suggestions: SuggestedAccountMapping[]): { accounts: AccountMapping[] } {
  return {
    accounts: suggestions.map((suggestion) => suggestion.mapping)
  };
}

function scoreAccountPair(
  simplefinAccount: DiscoveredSimpleFinAccount,
  fireflyAccount: DiscoveredFireflyAccount
): SuggestedAccountMapping {
  const reasons: string[] = [];
  const nameScore = descriptionSimilarity(simplefinAccount.simplefin_name, fireflyAccount.firefly_name);
  if (nameScore >= 0.75) {
    reasons.push("high account name similarity");
  } else if (nameScore >= 0.45) {
    reasons.push("partial account name similarity");
  }

  const currencyScore =
    simplefinAccount.currency && fireflyAccount.currency && simplefinAccount.currency === fireflyAccount.currency ? 1 : 0;
  if (currencyScore === 1) {
    reasons.push("same currency");
  }

  const balanceScore = scoreBalance(simplefinAccount.balance, fireflyAccount.current_balance);
  if (balanceScore === 1) {
    reasons.push("same current balance");
  } else if (balanceScore >= 0.75) {
    reasons.push("nearby current balance");
  } else if (balanceScore >= 0.55) {
    reasons.push("balance may match with opposite sign");
  }

  const confidence = roundScore(nameScore * 0.55 + currencyScore * 0.15 + balanceScore * 0.3);

  return {
    confidence,
    reasons,
    mapping: {
      simplefin_id: simplefinAccount.simplefin_id,
      simplefin_name: simplefinAccount.simplefin_name,
      firefly_account_id: fireflyAccount.firefly_account_id,
      firefly_name: fireflyAccount.firefly_name
    },
    simplefin_account: {
      ...simplefinAccount,
      balance: simplefinAccount.balance === undefined ? undefined : roundMoney(simplefinAccount.balance)
    },
    firefly_account: {
      ...fireflyAccount,
      current_balance:
        fireflyAccount.current_balance === undefined ? undefined : roundMoney(fireflyAccount.current_balance)
    }
  };
}

function scoreBalance(simplefinBalance?: number, fireflyBalance?: number): number {
  if (simplefinBalance === undefined || fireflyBalance === undefined) {
    return 0;
  }

  const difference = Math.abs(simplefinBalance - fireflyBalance);
  if (difference <= 0.01) {
    return 1;
  }

  const oppositeSignDifference = Math.abs(simplefinBalance + fireflyBalance);
  if (oppositeSignDifference <= 0.01) {
    return 0.6;
  }

  const scale = Math.max(1, Math.abs(simplefinBalance), Math.abs(fireflyBalance));
  const relativeDifference = difference / scale;
  if (relativeDifference <= 0.01) {
    return 0.85;
  }

  if (relativeDifference <= 0.05) {
    return 0.7;
  }

  return 0;
}

function stringAttr(attributes: Record<string, unknown>, key: string): string | undefined {
  const value = attributes[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseAmount(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
