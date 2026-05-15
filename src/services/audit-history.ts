import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export interface AuditSnapshot {
  run_id: string;
  created_at: string;
  range: {
    start_date: string;
    end_date: string;
    days: number;
  };
  summary: Record<string, unknown>;
  active_finding_fingerprints: string[];
  active_findings: AuditSnapshotFinding[];
}

export interface AuditSnapshotFinding {
  type: string;
  group: string;
  fingerprint: string;
  summary: Record<string, unknown>;
}

export interface AuditHistoryFile {
  snapshots: AuditSnapshot[];
}

export interface SinceLastAudit {
  new_findings: number;
  resolved_findings: number;
  unchanged_findings: number;
}

const AuditSnapshotSchema = z.object({
  run_id: z.string().min(1),
  created_at: z.string().datetime(),
  range: z.object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    days: z.number().int().nonnegative()
  }),
  summary: z.record(z.unknown()),
  active_finding_fingerprints: z.array(z.string().min(1)),
  active_findings: z.array(z.object({
    type: z.string().min(1),
    group: z.string().min(1),
    fingerprint: z.string().min(1),
    summary: z.record(z.unknown())
  })).default([])
});

const AuditHistoryFileSchema = z.object({
  snapshots: z.array(AuditSnapshotSchema).default([])
});

export async function loadAuditHistory(filePath: string): Promise<AuditHistoryFile> {
  let contents: string;
  try {
    contents = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { snapshots: [] };
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch {
    throw new Error(`Audit history file ${filePath} is not valid JSON.`);
  }

  const parsed = AuditHistoryFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid audit history file: ${parsed.error.message}`);
  }

  return {
    snapshots: parsed.data.snapshots
  };
}

export async function appendAuditSnapshot(
  filePath: string,
  snapshot: AuditSnapshot,
  options: { maxSnapshots?: number } = {}
): Promise<AuditHistoryFile> {
  const history = await loadAuditHistory(filePath);
  const maxSnapshots = options.maxSnapshots ?? 100;
  const snapshots = [...history.snapshots, snapshot].slice(-maxSnapshots);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify({ snapshots }, null, 2)}\n`, "utf8");

  return { snapshots };
}

export function latestAuditSnapshot(history: AuditHistoryFile): AuditSnapshot | undefined {
  return history.snapshots.at(-1);
}

export function compareAuditFingerprints(
  previous: AuditSnapshot | undefined,
  currentFingerprints: string[]
): SinceLastAudit {
  const current = new Set(currentFingerprints);
  const previousSet = new Set(previous?.active_finding_fingerprints ?? []);

  let newFindings = 0;
  let unchangedFindings = 0;
  for (const fingerprint of current) {
    if (previousSet.has(fingerprint)) {
      unchangedFindings += 1;
    } else {
      newFindings += 1;
    }
  }

  let resolvedFindings = 0;
  for (const fingerprint of previousSet) {
    if (!current.has(fingerprint)) {
      resolvedFindings += 1;
    }
  }

  return {
    new_findings: newFindings,
    resolved_findings: resolvedFindings,
    unchanged_findings: unchangedFindings
  };
}

export function createAuditSnapshot(input: {
  range: AuditSnapshot["range"];
  summary: Record<string, unknown>;
  activeFindingFingerprints: string[];
  activeFindings?: AuditSnapshotFinding[];
  now?: Date;
}): AuditSnapshot {
  return {
    run_id: crypto.randomUUID(),
    created_at: (input.now ?? new Date()).toISOString(),
    range: input.range,
    summary: input.summary,
    active_finding_fingerprints: [...new Set(input.activeFindingFingerprints)].sort(),
    active_findings: input.activeFindings ?? []
  };
}
