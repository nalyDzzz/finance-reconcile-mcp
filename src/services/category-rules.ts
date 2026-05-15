import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  CategoryRule,
  CategoryRulesFile,
  CategorySuggestion,
  NormalizedTransaction
} from "../types.js";
import { normalizeDescription } from "./transaction-matching.js";

const CategoryRuleSchema = z.object({
  id: z.string().min(1),
  match: z.string().trim().min(1),
  category: z.string().trim().min(1),
  created_at: z.string().datetime()
});

const CategoryRulesFileSchema = z.object({
  rules: z.array(CategoryRuleSchema).default([])
});

export async function loadCategoryRules(filePath: string): Promise<CategoryRulesFile> {
  let contents: string;
  try {
    contents = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { rules: [] };
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch {
    throw new Error(`Category rules file ${filePath} is not valid JSON.`);
  }

  const parsed = CategoryRulesFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid category rules file: ${parsed.error.message}`);
  }

  return {
    rules: sortCategoryRules(dedupeCategoryRules(parsed.data.rules))
  };
}

export async function saveCategoryRules(filePath: string, rules: CategoryRule[]): Promise<CategoryRulesFile> {
  const parsed = CategoryRulesFileSchema.safeParse({
    rules: sortCategoryRules(dedupeCategoryRules(rules.map(cleanCategoryRule)))
  });
  if (!parsed.success) {
    throw new Error(`Invalid category rules file: ${parsed.error.message}`);
  }

  const file = {
    rules: parsed.data.rules
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return file;
}

export async function addCategoryRule(
  filePath: string,
  input: {
    match: string;
    category: string;
    createdAt?: string;
  }
): Promise<{ rule: CategoryRule; created: boolean; rules: CategoryRule[] }> {
  const match = input.match.trim();
  const category = input.category.trim();
  if (!match) {
    throw new Error("Category rule match must not be empty.");
  }
  if (!category) {
    throw new Error("Category rule category must not be empty.");
  }

  const file = await loadCategoryRules(filePath);
  const normalizedMatch = normalizeRuleText(match);
  if (!normalizedMatch) {
    throw new Error("Category rule match must include searchable text.");
  }

  const existing = file.rules.find((rule) => normalizeRuleText(rule.match) === normalizedMatch);
  const rule: CategoryRule = existing
    ? {
        ...existing,
        match,
        category
      }
    : {
        id: createCategoryRuleId(normalizedMatch),
        match,
        category,
        created_at: input.createdAt ?? new Date().toISOString()
      };

  const rules = existing
    ? file.rules.map((entry) => entry.id === existing.id ? rule : entry)
    : [...file.rules, rule];

  const saved = await saveCategoryRules(filePath, rules);
  return {
    rule,
    created: !existing,
    rules: saved.rules
  };
}

export async function removeCategoryRule(
  filePath: string,
  id: string
): Promise<{ removed: boolean; rules: CategoryRule[] }> {
  const file = await loadCategoryRules(filePath);
  const remaining = file.rules.filter((rule) => rule.id !== id);
  const removed = remaining.length !== file.rules.length;

  if (removed) {
    const saved = await saveCategoryRules(filePath, remaining);
    return {
      removed,
      rules: saved.rules
    };
  }

  return {
    removed,
    rules: file.rules
  };
}

export function suggestCategoryForTransaction(
  transaction: NormalizedTransaction,
  rules: CategoryRule[] = []
): CategorySuggestion {
  const candidates = normalizedTransactionCandidates(transaction);
  const matchingRule = findMatchingRule(candidates, rules);
  if (matchingRule) {
    return {
      category: matchingRule.category,
      confidence: 0.95,
      reason: `Matched local category rule "${matchingRule.match}".`,
      matchingRuleId: matchingRule.id
    };
  }

  return builtInCategorySuggestion(candidates);
}

export function normalizeCategoryRuleText(value: string): string {
  return normalizeRuleText(value);
}

function cleanCategoryRule(rule: CategoryRule): CategoryRule {
  return {
    id: rule.id.trim(),
    match: rule.match.trim(),
    category: rule.category.trim(),
    created_at: rule.created_at
  };
}

function createCategoryRuleId(normalizedMatch: string): string {
  const digest = crypto.createHash("sha256").update(normalizedMatch).digest("hex").slice(0, 16);
  return `category_rule:${digest}`;
}

function findMatchingRule(candidates: string[], rules: CategoryRule[]): CategoryRule | undefined {
  const sortedRules = [...rules].sort((a, b) => normalizeRuleText(b.match).length - normalizeRuleText(a.match).length);

  return sortedRules.find((rule) => {
    const normalizedMatch = normalizeRuleText(rule.match);
    return normalizedMatch && candidates.some((candidate) => candidate.includes(normalizedMatch));
  });
}

function builtInCategorySuggestion(candidates: string[]): CategorySuggestion {
  const haystack = candidates.join(" ");
  const rules: Array<[RegExp, string, string]> = [
    [/\b(costco|kroger|safeway|whole foods|trader joes|grocery|market)\b/, "Groceries", "Matched built-in grocery keyword."],
    [/\b(starbucks|coffee|cafe|restaurant|pizza|burger|taco|doordash|ubereats|grubhub)\b/, "Dining", "Matched built-in dining keyword."],
    [/\b(shell|chevron|exxon|bp|gas|fuel)\b/, "Fuel", "Matched built-in fuel keyword."],
    [/\b(uber|lyft|transit|parking|airline|delta|united|southwest)\b/, "Transportation", "Matched built-in transportation keyword."],
    [/\b(amazon|target|walmart|etsy|shop|store)\b/, "Shopping", "Matched built-in shopping keyword."],
    [/\b(netflix|spotify|hulu|apple|google|microsoft|subscription|streaming)\b/, "Subscriptions", "Matched built-in subscription keyword."],
    [/\b(power|electric|water|utility|internet|comcast|xfinity|phone|verizon|att)\b/, "Utilities", "Matched built-in utility keyword."],
    [/\b(pharmacy|cvs|walgreens|doctor|medical|health)\b/, "Medical", "Matched built-in medical keyword."],
    [/\b(payroll|salary|deposit|interest)\b/, "Income", "Matched built-in income keyword."]
  ];

  const match = rules.find(([pattern]) => pattern.test(haystack));
  if (match) {
    return {
      category: match[1],
      confidence: 0.7,
      reason: match[2]
    };
  }

  return {
    category: "Needs Review",
    confidence: 0.2,
    reason: "No local category rule or built-in keyword matched."
  };
}

function normalizedTransactionCandidates(transaction: NormalizedTransaction): string[] {
  const metadata = transaction.metadata ?? {};
  const merchantFields = [
    metadata.merchant,
    metadata.merchant_name,
    metadata.payee,
    metadata.source_name,
    metadata.destination_name,
    metadata.counterparty_name
  ];
  const values = [
    transaction.description,
    ...merchantFields.filter((value): value is string => typeof value === "string")
  ];
  const normalized = values.map(normalizeRuleText).filter(Boolean);
  return [...new Set(normalized)];
}

function normalizeRuleText(value: string): string {
  return normalizeDescription(value).replace(/\s+/g, " ").trim();
}

function dedupeCategoryRules(rules: CategoryRule[]): CategoryRule[] {
  const byNormalizedMatch = new Map<string, CategoryRule>();

  for (const rule of rules) {
    const normalizedMatch = normalizeRuleText(rule.match);
    if (normalizedMatch && !byNormalizedMatch.has(normalizedMatch)) {
      byNormalizedMatch.set(normalizedMatch, rule);
    }
  }

  return [...byNormalizedMatch.values()];
}

function sortCategoryRules(rules: CategoryRule[]): CategoryRule[] {
  return [...rules].sort((a, b) => {
    const matchCompare = normalizeRuleText(a.match).localeCompare(normalizeRuleText(b.match));
    if (matchCompare !== 0) {
      return matchCompare;
    }

    return a.id.localeCompare(b.id);
  }).map((rule) => ({
    ...rule,
    match: rule.match.trim(),
    category: rule.category.trim()
  }));
}
