import type { FireflyClient } from "../connectors/firefly.js";
import {
  normalizeFireflyAccount,
  normalizeFireflyTransactions
} from "../connectors/firefly.js";
import type { SimpleFinAccount, SimpleFinClient } from "../connectors/simplefin.js";
import {
  normalizeSimpleFinAccount,
  normalizeSimpleFinTransactions
} from "../connectors/simplefin.js";
import type {
  AccountMapping,
  DateRange,
  NormalizedAccount,
  NormalizedTransaction,
  ServiceWarning
} from "../types.js";
import {
  accountLabel,
  findSimpleFinAccountForMapping,
  simpleFinIdsForMappings
} from "./account-mapping.js";

export interface SimpleFinMappedAccount {
  mapping: AccountMapping;
  raw: SimpleFinAccount;
  normalized: NormalizedAccount;
}

export interface MappedAccountData {
  simplefinAccounts: SimpleFinMappedAccount[];
  warnings: ServiceWarning[];
}

export async function fetchMappedSimpleFinAccounts(
  simplefin: SimpleFinClient,
  mappings: AccountMapping[],
  range?: DateRange,
  balancesOnly = false
): Promise<MappedAccountData> {
  const accountIds = simpleFinIdsForMappings(mappings);
  const accountSet = await simplefin.fetchAccounts({
    startDate: range?.startDate,
    endDate: range?.endDate,
    accountIds,
    balancesOnly
  });

  const warnings = [...accountSet.warnings];
  const simplefinAccounts: SimpleFinMappedAccount[] = [];

  for (const mapping of mappings) {
    const account = findSimpleFinAccountForMapping(accountSet.accounts, mapping);
    if (!account) {
      warnings.push({
        code: "mapping.simplefin_account_not_found",
        message: `No SimpleFIN account matched mapping for ${accountLabel(mapping)}.`,
        account: accountLabel(mapping)
      });
      continue;
    }

    simplefinAccounts.push({
      mapping,
      raw: account,
      normalized: normalizeSimpleFinAccount(account, mapping)
    });
  }

  if (simplefinAccounts.length === 0) {
    throw new Error("No mapped SimpleFIN accounts were found. Check account-map.json.");
  }

  return {
    simplefinAccounts,
    warnings
  };
}

export async function fetchSimpleFinTransactionsForMappings(
  simplefin: SimpleFinClient,
  mappings: AccountMapping[],
  range: DateRange
): Promise<{ transactions: NormalizedTransaction[]; warnings: ServiceWarning[] }> {
  const data = await fetchMappedSimpleFinAccounts(simplefin, mappings, range, false);
  return {
    transactions: data.simplefinAccounts.flatMap(({ raw, mapping }) => normalizeSimpleFinTransactions(raw, mapping)),
    warnings: data.warnings
  };
}

export async function fetchFireflyTransactionsForMappings(
  firefly: FireflyClient,
  mappings: AccountMapping[],
  range: DateRange
): Promise<NormalizedTransaction[]> {
  const transactionGroups = await Promise.all(
    mappings.map(async (mapping) => ({
      mapping,
      groups: await firefly.listAccountTransactions(mapping.firefly_account_id, {
        startDate: range.startDate,
        endDate: range.endDate
      })
    }))
  );

  return transactionGroups.flatMap(({ mapping, groups }) => normalizeFireflyTransactions(groups, mapping));
}

export async function fetchFireflyAccountsForMappings(
  firefly: FireflyClient,
  mappings: AccountMapping[],
  date?: string
): Promise<NormalizedAccount[]> {
  const accounts = await Promise.all(
    mappings.map(async (mapping) => normalizeFireflyAccount(await firefly.getAccount(mapping.firefly_account_id, date), mapping))
  );

  return accounts;
}
