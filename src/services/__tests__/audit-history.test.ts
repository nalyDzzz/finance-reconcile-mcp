import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendAuditSnapshot,
  compareAuditFingerprints,
  createAuditSnapshot,
  loadAuditHistory
} from "../audit-history.js";

let tempDirs: string[] = [];

async function tempFile(fileName: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "finance-mcp-history-"));
  tempDirs.push(dir);
  return path.join(dir, fileName);
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("audit history", () => {
  it("compares current fingerprints with the previous snapshot", () => {
    const previous = createAuditSnapshot({
      range: { start_date: "2026-05-01", end_date: "2026-05-14", days: 14 },
      summary: { active_findings: 3 },
      activeFindingFingerprints: ["a", "b", "c"],
      now: new Date("2026-05-14T12:00:00.000Z")
    });

    expect(compareAuditFingerprints(previous, ["b", "c", "d"])).toEqual({
      new_findings: 1,
      resolved_findings: 1,
      unchanged_findings: 2
    });
  });

  it("persists compact audit snapshots locally", async () => {
    const filePath = await tempFile("audit-history.json");
    const snapshot = createAuditSnapshot({
      range: { start_date: "2026-05-01", end_date: "2026-05-14", days: 14 },
      summary: { active_findings: 1 },
      activeFindingFingerprints: ["finding:1"],
      now: new Date("2026-05-14T12:00:00.000Z")
    });

    await appendAuditSnapshot(filePath, snapshot);
    const history = await loadAuditHistory(filePath);

    expect(history.snapshots).toHaveLength(1);
    expect(history.snapshots[0]).toMatchObject({
      run_id: snapshot.run_id,
      created_at: "2026-05-14T12:00:00.000Z",
      active_finding_fingerprints: ["finding:1"]
    });
  });
});
