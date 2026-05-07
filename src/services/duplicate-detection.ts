import type { DuplicateGroup, NormalizedTransaction } from "../types.js";
import { diffDays } from "./date-utils.js";
import { roundScore } from "./masking.js";
import { descriptionSimilarity, moneyKey, scoreTransactionMatch } from "./transaction-matching.js";

export interface DuplicateDetectionOptions {
  maxDateDistanceDays?: number;
  minConfidence?: number;
}

export function findPossibleDuplicates(
  transactions: NormalizedTransaction[],
  options: DuplicateDetectionOptions = {}
): DuplicateGroup[] {
  const maxDateDistanceDays = options.maxDateDistanceDays ?? 2;
  const minConfidence = options.minConfidence ?? 0.76;
  const groups = new UnionFind(transactions.length);

  for (let i = 0; i < transactions.length; i += 1) {
    for (let j = i + 1; j < transactions.length; j += 1) {
      const a = transactions[i];
      const b = transactions[j];

      if (a.mappedFireflyAccountId !== b.mappedFireflyAccountId) {
        continue;
      }

      if (moneyKey(a.amount) !== moneyKey(b.amount)) {
        continue;
      }

      if (Math.abs(diffDays(a.date, b.date)) > maxDateDistanceDays) {
        continue;
      }

      const score = scoreTransactionMatch(a, b, { maxDateDistanceDays });
      if (score.score >= minConfidence) {
        groups.union(i, j);
      }
    }
  }

  const byRoot = new Map<number, NormalizedTransaction[]>();
  transactions.forEach((transaction, index) => {
    const root = groups.find(index);
    const list = byRoot.get(root) ?? [];
    list.push(transaction);
    byRoot.set(root, list);
  });

  return [...byRoot.values()]
    .filter((group) => group.length > 1)
    .map((group) => summarizeGroup(group, maxDateDistanceDays))
    .sort((a, b) => b.confidence - a.confidence);
}

function summarizeGroup(transactions: NormalizedTransaction[], maxDateDistanceDays: number): DuplicateGroup {
  let totalScore = 0;
  let pairs = 0;
  const reasons = new Set<string>();

  for (let i = 0; i < transactions.length; i += 1) {
    for (let j = i + 1; j < transactions.length; j += 1) {
      const score = scoreTransactionMatch(transactions[i], transactions[j], { maxDateDistanceDays });
      totalScore += score.score;
      pairs += 1;
      score.reasons.forEach((reason) => reasons.add(reason));
      if (descriptionSimilarity(transactions[i].description, transactions[j].description) >= 0.75) {
        reasons.add("similar merchant descriptions");
      }
    }
  }

  return {
    confidence: roundScore(totalScore / Math.max(1, pairs)),
    reasons: [...reasons],
    transactions
  };
}

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    if (this.parent[index] !== index) {
      this.parent[index] = this.find(this.parent[index]);
    }
    return this.parent[index];
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent[rootB] = rootA;
    }
  }
}
