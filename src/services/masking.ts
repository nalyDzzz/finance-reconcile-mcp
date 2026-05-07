export function maskIdentifier(value: string | undefined, visible = 4): string | undefined {
  if (!value) {
    return undefined;
  }

  const compact = value.trim();
  if (compact.length <= visible) {
    return compact.length <= 2 ? "**" : `...${compact.slice(-visible)}`;
  }

  return `...${compact.slice(-visible)}`;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

export function serializeTransaction(transaction: {
  id: string;
  externalIds: string[];
  source: string;
  mappedFireflyAccountId: string;
  accountDisplayName: string;
  sourceAccountId: string;
  sourceAccountName: string;
  date: string;
  amount: number;
  currency?: string;
  description: string;
  pending?: boolean;
  category?: string | null;
}): Record<string, unknown> {
  return {
    source: transaction.source,
    id_masked: maskIdentifier(transaction.id),
    external_ids_masked: transaction.externalIds.map((id) => maskIdentifier(id)).filter(Boolean),
    date: transaction.date,
    amount: roundMoney(transaction.amount),
    currency: transaction.currency,
    description: transaction.description,
    pending: transaction.pending ?? false,
    category: transaction.category ?? null,
    account: {
      mapped_firefly_account_id: transaction.mappedFireflyAccountId,
      display_name: transaction.accountDisplayName,
      source_account_id_masked: maskIdentifier(transaction.sourceAccountId),
      source_account_name: transaction.sourceAccountName
    }
  };
}
