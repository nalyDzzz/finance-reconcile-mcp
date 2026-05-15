import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { FindingType } from "../types.js";
import { FINDING_TYPES } from "./fingerprints.js";

export interface IgnoredFinding {
  fingerprint: string;
  type: FindingType;
  reason: string;
  created_at: string;
}

export interface IgnoredFindingsFile {
  ignored: IgnoredFinding[];
}

const IgnoredFindingSchema = z.object({
  fingerprint: z.string().min(1),
  type: z.enum(FINDING_TYPES),
  reason: z.string().min(1),
  created_at: z.string().datetime()
});

const IgnoredFindingsFileSchema = z.object({
  ignored: z.array(IgnoredFindingSchema).default([])
});

export async function loadIgnoredFindings(filePath: string): Promise<IgnoredFindingsFile> {
  let contents: string;
  try {
    contents = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { ignored: [] };
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch {
    throw new Error(`Ignored findings file ${filePath} is not valid JSON.`);
  }

  const parsed = IgnoredFindingsFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid ignored findings file: ${parsed.error.message}`);
  }

  return {
    ignored: sortIgnoredFindings(dedupeIgnoredFindings(parsed.data.ignored))
  };
}

export async function saveIgnoredFindings(filePath: string, ignored: IgnoredFinding[]): Promise<IgnoredFindingsFile> {
  const file = {
    ignored: sortIgnoredFindings(dedupeIgnoredFindings(ignored))
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  return file;
}

export async function ignoreFinding(
  filePath: string,
  input: {
    fingerprint: string;
    type: FindingType;
    reason: string;
    createdAt?: string;
  }
): Promise<{ ignored: IgnoredFinding; created: boolean }> {
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Ignored finding reason must not be empty.");
  }

  if (!input.fingerprint.startsWith(`${input.type}:`)) {
    throw new Error(`Fingerprint ${input.fingerprint} does not match finding type ${input.type}.`);
  }

  const file = await loadIgnoredFindings(filePath);
  const existing = file.ignored.find((entry) => entry.fingerprint === input.fingerprint);
  if (existing) {
    return { ignored: existing, created: false };
  }

  const ignored: IgnoredFinding = {
    fingerprint: input.fingerprint,
    type: input.type,
    reason,
    created_at: input.createdAt ?? new Date().toISOString()
  };

  await saveIgnoredFindings(filePath, [...file.ignored, ignored]);
  return { ignored, created: true };
}

export async function unignoreFinding(
  filePath: string,
  fingerprint: string
): Promise<{ removed: boolean; ignored: IgnoredFinding[] }> {
  const file = await loadIgnoredFindings(filePath);
  const remaining = file.ignored.filter((entry) => entry.fingerprint !== fingerprint);
  const removed = remaining.length !== file.ignored.length;

  if (removed) {
    await saveIgnoredFindings(filePath, remaining);
  }

  return {
    removed,
    ignored: remaining
  };
}

export function ignoredFindingsByFingerprint(ignored: IgnoredFinding[]): Map<string, IgnoredFinding> {
  return new Map(ignored.map((entry) => [entry.fingerprint, entry]));
}

function dedupeIgnoredFindings(ignored: IgnoredFinding[]): IgnoredFinding[] {
  const byFingerprint = new Map<string, IgnoredFinding>();

  for (const entry of ignored) {
    if (!byFingerprint.has(entry.fingerprint)) {
      byFingerprint.set(entry.fingerprint, entry);
    }
  }

  return [...byFingerprint.values()];
}

function sortIgnoredFindings(ignored: IgnoredFinding[]): IgnoredFinding[] {
  return [...ignored].sort((a, b) => {
    const typeCompare = a.type.localeCompare(b.type);
    if (typeCompare !== 0) {
      return typeCompare;
    }

    return a.fingerprint.localeCompare(b.fingerprint);
  });
}
