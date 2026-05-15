import type { FireflyResource } from "../connectors/firefly.js";
import type { SimpleFinAccount } from "../connectors/simplefin.js";
import type { AccountMapFile } from "../types.js";

const DAY = 86_400;

function epoch(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00.000Z`).getTime() / 1000);
}

function split(params: {
  journal: string;
  date: string;
  amount: string;
  description: string;
  sourceId: string;
  sourceName: string;
  destinationId: string;
  destinationName: string;
  category?: string;
  externalId?: string;
}) {
  return {
    transaction_journal_id: params.journal,
    type: "withdrawal",
    date: `${params.date}T12:00:00+00:00`,
    amount: params.amount,
    description: params.description,
    source_id: params.sourceId,
    source_name: params.sourceName,
    destination_id: params.destinationId,
    destination_name: params.destinationName,
    category_name: params.category ?? "",
    currency_code: "USD",
    external_id: params.externalId
  };
}

export const MOCK_ACCOUNT_MAP: AccountMapFile = {
  accounts: [
    {
      simplefin_id: "sf-checking",
      simplefin_name: "MOCK CHECKING (...1111)",
      firefly_account_id: "ff-checking",
      firefly_name: "Mock Checking"
    },
    {
      simplefin_id: "sf-savings",
      simplefin_name: "MOCK SAVINGS (...2222)",
      firefly_account_id: "ff-savings",
      firefly_name: "Mock Savings"
    }
  ]
};

export const MOCK_SIMPLEFIN_ACCOUNTS: SimpleFinAccount[] = [
  {
    id: "sf-checking",
    name: "MOCK CHECKING (...1111)",
    currency: "USD",
    balance: "900.00",
    "available-balance": "900.00",
    "balance-date": epoch("2026-05-14"),
    transactions: [
      {
        id: "sf-coffee",
        posted: epoch("2026-05-10"),
        amount: "-4.50",
        description: "Coffee Shop",
        extra: { external_id: "ext-coffee" }
      },
      {
        id: "sf-missing-bookstore",
        posted: epoch("2026-05-11"),
        amount: "-23.45",
        description: "Book Store Missing",
        extra: { external_id: "ext-missing-bookstore" }
      },
      {
        id: "sf-grocery",
        posted: epoch("2026-05-12"),
        amount: "-67.89",
        description: "Grocery Market",
        extra: { external_id: "ext-grocery" }
      },
      {
        id: "sf-streaming",
        posted: epoch("2026-05-09"),
        amount: "-15.99",
        description: "Streaming Service",
        extra: { external_id: "ext-streaming" }
      }
    ]
  },
  {
    id: "sf-savings",
    name: "MOCK SAVINGS (...2222)",
    currency: "USD",
    balance: "5000.00",
    "available-balance": "5000.00",
    "balance-date": epoch("2026-05-14"),
    transactions: [
      {
        id: "sf-payroll",
        posted: epoch("2026-05-13"),
        amount: "1000.00",
        description: "Payroll Deposit",
        extra: { external_id: "ext-payroll" }
      }
    ]
  }
];

export const MOCK_FIREFLY_ACCOUNTS: FireflyResource[] = [
  {
    id: "ff-checking",
    type: "accounts",
    attributes: {
      name: "Mock Checking",
      type: "asset",
      currency_code: "USD",
      current_balance: "876.55",
      current_balance_date: "2026-05-14T00:00:00+00:00"
    }
  },
  {
    id: "ff-savings",
    type: "accounts",
    attributes: {
      name: "Mock Savings",
      type: "asset",
      currency_code: "USD",
      current_balance: "5000.00",
      current_balance_date: "2026-05-14T00:00:00+00:00"
    }
  }
];

export const MOCK_FIREFLY_TRANSACTION_GROUPS: FireflyResource[] = [
  {
    id: "ff-group-coffee",
    type: "transactions",
    attributes: {
      transactions: [
        split({
          journal: "ff-coffee",
          date: "2026-05-10",
          amount: "4.50",
          description: "Coffee Shop",
          sourceId: "ff-checking",
          sourceName: "Mock Checking",
          destinationId: "expense-coffee",
          destinationName: "Coffee Shop",
          category: "",
          externalId: "ext-coffee"
        })
      ]
    }
  },
  {
    id: "ff-group-grocery",
    type: "transactions",
    attributes: {
      transactions: [
        split({
          journal: "ff-grocery-1",
          date: "2026-05-12",
          amount: "67.89",
          description: "Grocery Market",
          sourceId: "ff-checking",
          sourceName: "Mock Checking",
          destinationId: "expense-grocery",
          destinationName: "Grocery Market",
          category: "Groceries",
          externalId: "ext-grocery"
        })
      ]
    }
  },
  {
    id: "ff-group-grocery-duplicate",
    type: "transactions",
    attributes: {
      transactions: [
        split({
          journal: "ff-grocery-2",
          date: "2026-05-12",
          amount: "67.89",
          description: "Grocery Market",
          sourceId: "ff-checking",
          sourceName: "Mock Checking",
          destinationId: "expense-grocery",
          destinationName: "Grocery Market",
          category: "Groceries",
          externalId: "ext-grocery-duplicate"
        })
      ]
    }
  },
  {
    id: "ff-group-streaming",
    type: "transactions",
    attributes: {
      transactions: [
        split({
          journal: "ff-streaming",
          date: "2026-05-09",
          amount: "15.99",
          description: "Streaming Service",
          sourceId: "ff-checking",
          sourceName: "Mock Checking",
          destinationId: "expense-streaming",
          destinationName: "Streaming Service",
          category: "",
          externalId: "ext-streaming"
        })
      ]
    }
  },
  {
    id: "ff-group-savings-payroll",
    type: "transactions",
    attributes: {
      transactions: [
        {
          transaction_journal_id: "ff-savings-payroll",
          type: "deposit",
          date: "2026-05-11T12:00:00+00:00",
          amount: "1000.00",
          description: "Payroll Deposit",
          source_id: "revenue-payroll",
          source_name: "Payroll",
          destination_id: "ff-savings",
          destination_name: "Mock Savings",
          category_name: "Income",
          currency_code: "USD",
          external_id: "ext-payroll-ledger"
        }
      ]
    }
  },
  {
    id: "ff-group-old-savings-interest",
    type: "transactions",
    attributes: {
      transactions: [
        {
          transaction_journal_id: "ff-savings-interest",
          type: "deposit",
          date: "2026-05-01T12:00:00+00:00",
          amount: "5.00",
          description: "Interest Deposit",
          source_id: "revenue-interest",
          source_name: "Interest",
          destination_id: "ff-savings",
          destination_name: "Mock Savings",
          category_name: "",
          currency_code: "USD",
          external_id: "ext-interest"
        }
      ]
    }
  }
];

export function inEpochRange(value: number, startDate?: string, endDate?: string): boolean {
  const start = startDate ? epoch(startDate) : Number.NEGATIVE_INFINITY;
  const end = endDate ? epoch(endDate) + DAY : Number.POSITIVE_INFINITY;
  return value >= start && value < end;
}
