export type SourceSystem = "simplefin" | "firefly";

export interface AppConfig {
  simpleFinAccessUrl: string;
  fireflyBaseUrl: string;
  fireflyPat: string;
  defaultLookbackDays: number;
  readonly: true;
  accountMappingFile: string;
  accountMappingFileDefaulted: boolean;
}

export interface AccountMapping {
  simplefin_id?: string;
  simplefin_name?: string;
  firefly_account_id: string;
  firefly_name?: string;
}

export interface AccountMapFile {
  accounts: AccountMapping[];
}

export interface DateRange {
  startDate: string;
  endDate: string;
  days: number;
}

export interface DateRangeInput {
  start_date?: string;
  end_date?: string;
  days?: number;
  account?: string;
}

export interface NormalizedAccount {
  source: SourceSystem;
  sourceAccountId: string;
  sourceAccountName: string;
  mappedFireflyAccountId: string;
  displayName: string;
  currency?: string;
  balance?: number;
  balanceDate?: string;
  type?: string;
}

export interface NormalizedTransaction {
  source: SourceSystem;
  id: string;
  externalIds: string[];
  sourceAccountId: string;
  sourceAccountName: string;
  mappedFireflyAccountId: string;
  accountDisplayName: string;
  date: string;
  amount: number;
  currency?: string;
  description: string;
  pending?: boolean;
  category?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MatchScore {
  score: number;
  amountScore: number;
  dateScore: number;
  descriptionScore: number;
  externalIdScore: number;
  dateDistanceDays: number;
  reasons: string[];
}

export interface TransactionMatch {
  transaction: NormalizedTransaction;
  score: MatchScore;
}

export interface MissingTransactionFinding {
  transaction: NormalizedTransaction;
  missingConfidence: number;
  bestMatchScore: number;
  possibleMatches: TransactionMatch[];
}

export interface DuplicateGroup {
  confidence: number;
  reasons: string[];
  transactions: NormalizedTransaction[];
}

export interface UncategorizedSummaryGroup {
  merchant: string;
  suggestedCategory: string;
  count: number;
  total: number;
  examples: NormalizedTransaction[];
}

export interface ServiceWarning {
  code: string;
  message: string;
  account?: string;
}
