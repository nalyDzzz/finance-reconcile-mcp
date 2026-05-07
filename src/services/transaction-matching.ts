import type {
  MatchScore,
  MissingTransactionFinding,
  NormalizedTransaction,
  TransactionMatch
} from "../types.js";
import { diffDays } from "./date-utils.js";
import { roundScore } from "./masking.js";

const MATCH_THRESHOLD = 0.76;
const POSSIBLE_MATCH_FLOOR = 0.4;

export interface MatchOptions {
  maxDateDistanceDays?: number;
  matchThreshold?: number;
}

export function scoreTransactionMatch(
  source: NormalizedTransaction,
  candidate: NormalizedTransaction,
  options: MatchOptions = {}
): MatchScore {
  const maxDateDistanceDays = options.maxDateDistanceDays ?? 2;
  const reasons: string[] = [];

  if (source.mappedFireflyAccountId !== candidate.mappedFireflyAccountId) {
    return {
      score: 0,
      amountScore: 0,
      dateScore: 0,
      descriptionScore: 0,
      externalIdScore: 0,
      dateDistanceDays: Number.POSITIVE_INFINITY,
      reasons: ["different mapped account"]
    };
  }

  const externalIdScore = hasSharedExternalId(source, candidate) ? 1 : 0;
  if (externalIdScore === 1) {
    reasons.push("shared external transaction id");
  }

  const amountScore = moneyKey(source.amount) === moneyKey(candidate.amount) ? 1 : 0;
  if (amountScore === 1) {
    reasons.push("exact signed amount match");
  }

  const dateDistanceDays = Math.abs(diffDays(source.date, candidate.date));
  const dateScore = scoreDateDistance(dateDistanceDays, maxDateDistanceDays);
  if (dateScore > 0) {
    reasons.push(dateDistanceDays === 0 ? "same posted date" : `posted dates within ${dateDistanceDays} day(s)`);
  }

  const descriptionScore = descriptionSimilarity(source.description, candidate.description);
  if (descriptionScore >= 0.75) {
    reasons.push("high description similarity");
  } else if (descriptionScore >= 0.45) {
    reasons.push("partial description similarity");
  }

  if (externalIdScore === 1) {
    const score = amountScore === 1 || dateScore > 0 ? 0.99 : 0.9;
    return {
      score,
      amountScore,
      dateScore,
      descriptionScore: roundScore(descriptionScore),
      externalIdScore,
      dateDistanceDays,
      reasons
    };
  }

  const score = amountScore * 0.4 + dateScore * 0.35 + descriptionScore * 0.25;

  return {
    score: roundScore(score),
    amountScore,
    dateScore: roundScore(dateScore),
    descriptionScore: roundScore(descriptionScore),
    externalIdScore,
    dateDistanceDays,
    reasons
  };
}

export function findBestMatches(
  source: NormalizedTransaction,
  candidates: NormalizedTransaction[],
  options: MatchOptions = {}
): TransactionMatch[] {
  return candidates
    .filter((candidate) => candidate.mappedFireflyAccountId === source.mappedFireflyAccountId)
    .map((candidate) => ({
      transaction: candidate,
      score: scoreTransactionMatch(source, candidate, options)
    }))
    .filter((match) => match.score.score >= POSSIBLE_MATCH_FLOOR)
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, 5);
}

export function findMissingTransactions(
  sourceTransactions: NormalizedTransaction[],
  ledgerTransactions: NormalizedTransaction[],
  options: MatchOptions = {}
): MissingTransactionFinding[] {
  const threshold = options.matchThreshold ?? MATCH_THRESHOLD;

  return sourceTransactions
    .map((transaction) => {
      const possibleMatches = findBestMatches(transaction, ledgerTransactions, options);
      const bestMatchScore = possibleMatches[0]?.score.score ?? 0;

      return {
        transaction,
        missingConfidence: roundScore(1 - bestMatchScore),
        bestMatchScore,
        possibleMatches
      };
    })
    .filter((finding) => finding.bestMatchScore < threshold)
    .sort((a, b) => {
      if (a.transaction.date === b.transaction.date) {
        return Math.abs(b.transaction.amount) - Math.abs(a.transaction.amount);
      }
      return a.transaction.date.localeCompare(b.transaction.date);
    });
}

export function descriptionSimilarity(a: string, b: string): number {
  const aNormalized = normalizeDescription(a);
  const bNormalized = normalizeDescription(b);

  if (!aNormalized || !bNormalized) {
    return 0;
  }

  if (aNormalized === bNormalized) {
    return 1;
  }

  const tokenScore = jaccard(tokens(aNormalized), tokens(bNormalized));
  const editScore = normalizedLevenshtein(aNormalized, bNormalized);
  return roundScore(tokenScore * 0.6 + editScore * 0.4);
}

export function normalizeDescription(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(x{2,}|\*{2,})\d{2,}\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(pos|debit|card|purchase|transaction|online|payment|auth|sq|tst)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function moneyKey(amount: number): number {
  return Math.round(amount * 100);
}

function hasSharedExternalId(a: NormalizedTransaction, b: NormalizedTransaction): boolean {
  const aIds = new Set(a.externalIds.map((id) => id.trim()).filter(Boolean));
  return b.externalIds.some((id) => aIds.has(id.trim()));
}

function scoreDateDistance(distance: number, maxDistance: number): number {
  if (!Number.isFinite(distance) || distance > maxDistance) {
    return 0;
  }

  if (distance === 0) {
    return 1;
  }

  if (distance === 1) {
    return 0.85;
  }

  if (distance === 2) {
    return 0.65;
  }

  return Math.max(0, 1 - distance / (maxDistance + 1));
}

function tokens(value: string): Set<string> {
  return new Set(value.split(" ").filter((token) => token.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }

  return intersection / (a.size + b.size - intersection);
}

function normalizedLevenshtein(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) {
    return 1;
  }

  const distance = levenshteinDistance(a, b);
  return Math.max(0, 1 - distance / maxLength);
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}
