import type { NormalizedTransaction, UncategorizedSummaryGroup } from "../types.js";
import { roundMoney } from "./masking.js";
import { normalizeDescription } from "./transaction-matching.js";

export function summarizeUncategorized(transactions: NormalizedTransaction[]): UncategorizedSummaryGroup[] {
  const uncategorized = transactions.filter((transaction) => !transaction.category?.trim());
  const groups = new Map<string, NormalizedTransaction[]>();

  for (const transaction of uncategorized) {
    const merchant = merchantKey(transaction.description);
    const list = groups.get(merchant) ?? [];
    list.push(transaction);
    groups.set(merchant, list);
  }

  return [...groups.entries()]
    .map(([merchant, group]) => ({
      merchant,
      suggestedCategory: suggestCategory(merchant),
      count: group.length,
      total: roundMoney(group.reduce((sum, transaction) => sum + transaction.amount, 0)),
      examples: group
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 3)
    }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

function merchantKey(description: string): string {
  const normalized = normalizeDescription(description);
  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.slice(0, 4).join(" ") || "unknown merchant";
}

function suggestCategory(merchant: string): string {
  const rules: Array<[RegExp, string]> = [
    [/\b(costco|kroger|safeway|whole foods|trader joes|grocery|market)\b/, "Groceries"],
    [/\b(starbucks|coffee|cafe|restaurant|pizza|burger|taco|doordash|ubereats|grubhub)\b/, "Dining"],
    [/\b(shell|chevron|exxon|bp|gas|fuel)\b/, "Fuel"],
    [/\b(uber|lyft|transit|parking|airline|delta|united|southwest)\b/, "Transportation"],
    [/\b(amazon|target|walmart|etsy|shop|store)\b/, "Shopping"],
    [/\b(netflix|spotify|hulu|apple|google|microsoft|subscription)\b/, "Subscriptions"],
    [/\b(power|electric|water|utility|internet|comcast|xfinity|phone|verizon|att)\b/, "Utilities"],
    [/\b(pharmacy|cvs|walgreens|doctor|medical|health)\b/, "Medical"],
    [/\b(payroll|salary|deposit|interest)\b/, "Income"]
  ];

  return rules.find(([pattern]) => pattern.test(merchant))?.[1] ?? "Needs Review";
}
