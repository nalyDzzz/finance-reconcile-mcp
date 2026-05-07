import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AccountMapFile, AccountMapping } from "../types.js";
import type { SimpleFinAccount } from "../connectors/simplefin.js";

export const AccountMappingSchema = z.object({
  simplefin_id: z.string().min(1).optional(),
  simplefin_name: z.string().min(1).optional(),
  firefly_account_id: z.string().min(1),
  firefly_name: z.string().min(1).optional()
}).refine((mapping) => mapping.simplefin_id || mapping.simplefin_name, {
  message: "Each account mapping must include simplefin_id or simplefin_name."
});

export const AccountMapSchema = z.object({
  accounts: z.array(AccountMappingSchema).min(1)
});

export interface AccountMapInspection {
  path: string;
  exists: boolean;
  valid: boolean;
  account_count: number;
  error?: string;
  account_map?: AccountMapFile;
}

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

  return validateAccountMap(json);
}

export function validateAccountMap(value: unknown): AccountMapFile {
  const parsed = AccountMapSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid account mapping file: ${parsed.error.message}`);
  }

  return parsed.data;
}

export async function inspectAccountMap(filePath: string): Promise<AccountMapInspection> {
  let contents: string;
  try {
    contents = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        path: filePath,
        exists: false,
        valid: false,
        account_count: 0,
        error: "Account mapping file does not exist."
      };
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch {
    return {
      path: filePath,
      exists: true,
      valid: false,
      account_count: 0,
      error: "Account mapping file is not valid JSON."
    };
  }

  try {
    const accountMap = validateAccountMap(json);
    return {
      path: filePath,
      exists: true,
      valid: true,
      account_count: accountMap.accounts.length,
      account_map: accountMap
    };
  } catch (error) {
    return {
      path: filePath,
      exists: true,
      valid: false,
      account_count: 0,
      error: error instanceof Error ? error.message : "Account mapping file is invalid."
    };
  }
}

export async function saveAccountMap(
  filePath: string,
  accountMapValue: unknown,
  options: { overwrite?: boolean } = {}
): Promise<AccountMapFile> {
  const accountMap = validateAccountMap(accountMapValue);

  if (!options.overwrite) {
    try {
      await fs.access(filePath);
      throw new Error(`Account mapping file already exists at ${filePath}. Pass overwrite=true to replace it.`);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(accountMap, null, 2)}\n`, "utf8");
  return accountMap;
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
