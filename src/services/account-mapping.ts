import fs from "node:fs/promises";
import { z } from "zod";
import type { AccountMapFile, AccountMapping } from "../types.js";
import type { SimpleFinAccount } from "../connectors/simplefin.js";

const AccountMappingSchema = z.object({
  simplefin_id: z.string().min(1).optional(),
  simplefin_name: z.string().min(1).optional(),
  firefly_account_id: z.string().min(1),
  firefly_name: z.string().min(1).optional()
}).refine((mapping) => mapping.simplefin_id || mapping.simplefin_name, {
  message: "Each account mapping must include simplefin_id or simplefin_name."
});

const AccountMapSchema = z.object({
  accounts: z.array(AccountMappingSchema).min(1)
});

export async function loadAccountMap(filePath: string): Promise<AccountMapFile> {
  let contents: string;
  try {
    contents = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Account mapping file not found at ${filePath}. Create it from account-map.example.json.`);
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch {
    throw new Error(`Account mapping file ${filePath} is not valid JSON.`);
  }

  const parsed = AccountMapSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid account mapping file: ${parsed.error.message}`);
  }

  return parsed.data;
}

export function filterMappings(mappings: AccountMapping[], account?: string): AccountMapping[] {
  if (!account) {
    return mappings;
  }

  const needle = normalize(account);
  const filtered = mappings.filter((mapping) => {
    const candidates = [
      mapping.simplefin_id,
      mapping.simplefin_name,
      mapping.firefly_account_id,
      mapping.firefly_name
    ].filter(Boolean) as string[];

    return candidates.some((candidate) => normalize(candidate).includes(needle));
  });

  if (filtered.length === 0) {
    throw new Error(`No account mapping matched "${account}".`);
  }

  return filtered;
}

export function simpleFinIdsForMappings(mappings: AccountMapping[]): string[] | undefined {
  const ids = mappings.map((mapping) => mapping.simplefin_id).filter((id): id is string => Boolean(id));
  return ids.length === mappings.length ? ids : undefined;
}

export function findSimpleFinAccountForMapping(
  accounts: SimpleFinAccount[],
  mapping: AccountMapping
): SimpleFinAccount | undefined {
  if (mapping.simplefin_id) {
    const byId = accounts.find((account) => account.id === mapping.simplefin_id);
    if (byId) {
      return byId;
    }
  }

  if (mapping.simplefin_name) {
    const mappedName = normalize(mapping.simplefin_name);
    return accounts.find((account) => normalize(account.name) === mappedName);
  }

  return undefined;
}

export function accountLabel(mapping: AccountMapping): string {
  return mapping.firefly_name ?? mapping.simplefin_name ?? mapping.firefly_account_id;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
