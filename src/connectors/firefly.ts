import { z } from "zod";
import type { AccountMapping, NormalizedAccount, NormalizedTransaction } from "../types.js";
import { MOCK_FIREFLY_ACCOUNTS, MOCK_FIREFLY_TRANSACTION_GROUPS } from "../fixtures/mock-data.js";
import { coerceDateTimeToDate } from "../services/date-utils.js";

const FireflyResourceSchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  attributes: z.record(z.unknown()).default({})
}).passthrough();

const FireflySingleSchema = z.object({
  data: FireflyResourceSchema
}).passthrough();

const FireflyArraySchema = z.object({
  data: z.array(FireflyResourceSchema).default([]),
  meta: z.object({
    pagination: z.object({
      current_page: z.number().optional(),
      total_pages: z.number().optional()
    }).passthrough().optional()
  }).passthrough().optional(),
  links: z.object({
    next: z.string().nullable().optional()
  }).passthrough().optional()
}).passthrough();

export type FireflyResource = z.infer<typeof FireflyResourceSchema>;

export interface FireflyListTransactionsOptions {
  startDate?: string;
  endDate?: string;
  type?: string;
}

export interface FireflyListAccountsOptions {
  type?: string;
}

export class FireflyClient {
  private readonly apiBaseUrl: string;

  constructor(
    baseUrl: string,
    private readonly personalAccessToken: string,
    private readonly options: { mockData?: boolean } = {}
  ) {
    const stripped = baseUrl.replace(/\/+$/, "");
    this.apiBaseUrl = stripped.endsWith("/api/v1") ? stripped : `${stripped}/api/v1`;
  }

  async getAccount(accountId: string, date?: string): Promise<FireflyResource> {
    if (this.options.mockData) {
      const account = MOCK_FIREFLY_ACCOUNTS.find((item) => item.id === accountId);
      if (!account) {
        throw new Error(`Mock Firefly III account not found: ${accountId}.`);
      }
      return structuredClone(account);
    }

    const params = date ? { date } : undefined;
    const json = await this.request(`/accounts/${encodeURIComponent(accountId)}`, params);
    const parsed = FireflySingleSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`Firefly III account response had an unexpected shape: ${parsed.error.message}`);
    }

    return parsed.data.data;
  }

  async listAccounts(options: FireflyListAccountsOptions = {}): Promise<FireflyResource[]> {
    if (this.options.mockData) {
      return structuredClone(MOCK_FIREFLY_ACCOUNTS).filter((account) => {
        const type = account.attributes.type;
        return !options.type || type === options.type;
      });
    }

    const params: Record<string, string> = {};
    if (options.type) {
      params.type = options.type;
    }

    return this.paginated("/accounts", params);
  }

  async listAccountTransactions(
    accountId: string,
    options: FireflyListTransactionsOptions = {}
  ): Promise<FireflyResource[]> {
    if (this.options.mockData) {
      return filterMockTransactionGroups(options).filter((group) =>
        groupTouchesAccount(group, accountId)
      );
    }

    return this.paginated(`/accounts/${encodeURIComponent(accountId)}/transactions`, dateParams(options));
  }

  async listTransactions(options: FireflyListTransactionsOptions = {}): Promise<FireflyResource[]> {
    if (this.options.mockData) {
      return filterMockTransactionGroups(options);
    }

    return this.paginated("/transactions", dateParams(options));
  }

  private async paginated(path: string, params: Record<string, string> = {}): Promise<FireflyResource[]> {
    const results: FireflyResource[] = [];
    let page = 1;
    let totalPages: number | undefined;

    do {
      const json = await this.request(path, { ...params, page: `${page}`, limit: "100" });
      const parsed = FireflyArraySchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(`Firefly III list response had an unexpected shape: ${parsed.error.message}`);
      }

      results.push(...parsed.data.data);

      totalPages = parsed.data.meta?.pagination?.total_pages;
      const currentPage = parsed.data.meta?.pagination?.current_page ?? page;
      const hasNext = Boolean(parsed.data.links?.next);
      page = currentPage + 1;

      if (!totalPages && !hasNext) {
        break;
      }

      if (page > 1000) {
        throw new Error("Firefly III pagination exceeded 1000 pages; refusing to continue.");
      }
    } while (totalPages ? page <= totalPages : true);

    return results;
  }

  private async request(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${this.apiBaseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "accept": "application/vnd.api+json, application/json",
        "authorization": `Bearer ${this.personalAccessToken}`,
        "user-agent": "finance-reconcile-mcp/0.1"
      }
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error("Firefly III authentication failed. Check FIREFLY_PAT permissions.");
    }

    if (!response.ok) {
      throw new Error(`Firefly III request failed with HTTP ${response.status}.`);
    }

    const body = await response.text();
    if (!body.trim()) {
      return {};
    }

    try {
      return JSON.parse(body);
    } catch {
      throw new Error("Firefly III returned a non-JSON response.");
    }
  }
}

function filterMockTransactionGroups(options: FireflyListTransactionsOptions): FireflyResource[] {
  return structuredClone(MOCK_FIREFLY_TRANSACTION_GROUPS).filter((group) => {
    const splits = Array.isArray(group.attributes.transactions) ? group.attributes.transactions : [];
    return splits.some((splitValue) => {
      if (!splitValue || typeof splitValue !== "object") {
        return false;
      }
      const date = coerceDateTimeToDate((splitValue as Record<string, unknown>).date);
      return date ? inDateRange(date, options.startDate, options.endDate) : false;
    });
  });
}

function groupTouchesAccount(group: FireflyResource, accountId: string): boolean {
  const splits = Array.isArray(group.attributes.transactions) ? group.attributes.transactions : [];
  return splits.some((splitValue) => {
    if (!splitValue || typeof splitValue !== "object") {
      return false;
    }
    const split = splitValue as Record<string, unknown>;
    return split.source_id === accountId || split.destination_id === accountId;
  });
}

function inDateRange(date: string, startDate?: string, endDate?: string): boolean {
  if (startDate && date < startDate) {
    return false;
  }
  if (endDate && date > endDate) {
    return false;
  }
  return true;
}

function dateParams(options: FireflyListTransactionsOptions): Record<string, string> {
  const params: Record<string, string> = {};
  if (options.startDate) {
    params.start = options.startDate;
  }
  if (options.endDate) {
    params.end = options.endDate;
  }
  if (options.type) {
    params.type = options.type;
  }
  return params;
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

function collectExternalIds(split: Record<string, unknown>): string[] {
  const keys = [
    "external_id",
    "import_hash_v2",
    "internal_reference",
    "sepa_ct_id",
    "sepa_db",
    "fit_id"
  ];

  return keys
    .map((key) => split[key])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function normalizeFireflyAccount(account: FireflyResource, mapping: AccountMapping): NormalizedAccount {
  const attributes = account.attributes;
  const balance = parseAmount(attributes.current_balance) ?? parseAmount(attributes.balance);

  return {
    source: "firefly",
    sourceAccountId: account.id,
    sourceAccountName: stringAttr(attributes, "name") ?? mapping.firefly_name ?? account.id,
    mappedFireflyAccountId: mapping.firefly_account_id,
    displayName: mapping.firefly_name ?? stringAttr(attributes, "name") ?? account.id,
    currency: stringAttr(attributes, "currency_code") ?? stringAttr(attributes, "primary_currency_code"),
    balance,
    balanceDate:
      coerceDateTimeToDate(attributes.current_balance_date) ??
      coerceDateTimeToDate(attributes.updated_at) ??
      undefined,
    type: stringAttr(attributes, "type")
  };
}

export function normalizeFireflyTransactions(
  groups: FireflyResource[],
  mapping: AccountMapping
): NormalizedTransaction[] {
  const accountId = mapping.firefly_account_id;
  const normalized: NormalizedTransaction[] = [];

  for (const group of groups) {
    const splits = Array.isArray(group.attributes.transactions) ? group.attributes.transactions : [];

    splits.forEach((splitValue, index) => {
      if (!splitValue || typeof splitValue !== "object") {
        return;
      }

      const split = splitValue as Record<string, unknown>;
      const sourceId = stringAttr(split, "source_id");
      const destinationId = stringAttr(split, "destination_id");
      const touchesMappedAccount = sourceId === accountId || destinationId === accountId;
      if (!touchesMappedAccount) {
        return;
      }

      const amount = parseAmount(split.amount);
      const date = coerceDateTimeToDate(split.date);
      if (amount === undefined || !date) {
        return;
      }

      const signedAmount = destinationId === accountId ? amount : -amount;
      const description =
        stringAttr(split, "description") ??
        stringAttr(group.attributes, "group_title") ??
        "Undescribed transaction";
      const journalId = stringAttr(split, "transaction_journal_id") ?? `${index}`;

      normalized.push({
        source: "firefly",
        id: `${group.id}:${journalId}`,
        externalIds: collectExternalIds(split),
        sourceAccountId: accountId,
        sourceAccountName:
          (sourceId === accountId ? stringAttr(split, "source_name") : stringAttr(split, "destination_name")) ??
          mapping.firefly_name ??
          accountId,
        mappedFireflyAccountId: accountId,
        accountDisplayName: mapping.firefly_name ?? accountId,
        date,
        amount: signedAmount,
        currency: stringAttr(split, "currency_code") ?? stringAttr(split, "foreign_currency_code"),
        description,
        category: stringAttr(split, "category_name") ?? null,
        metadata: {
          type: stringAttr(split, "type"),
          source_id: sourceId,
          destination_id: destinationId,
          transaction_journal_id: journalId,
          group_id: group.id
        }
      });
    });
  }

  return normalized;
}
