import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { expandDraft } from "./expansion.js";
import { FloatReport } from "./types.js";
import { DraftInput, ExpandedDraft } from "./types.js";

export interface DraftVersion {
  id: number;
  content_hash: string;
  name: string | null;
  draft: DraftInput;
  expanded: ExpandedDraft;
  created_at: string;
}

interface DraftRow {
  id: number;
  content_hash: string;
  name: string | null;
  payload: string;
  matrix: string;
  created_at: string;
}

export function draftHash(input: DraftInput): string {
  const canonical = JSON.stringify({
    shaftCount: input.shaftCount,
    treadleCount: input.treadleCount,
    threading: input.threading,
    tieUp: input.tieUp,
    treadling: input.treadling,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export class LoomStore {
  readonly db: DatabaseSync;

  constructor(dbPath = "data/loom.db") {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS draft_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_hash TEXT NOT NULL UNIQUE,
        name TEXT,
        shaft_count INTEGER NOT NULL,
        treadle_count INTEGER NOT NULL,
        end_count INTEGER NOT NULL,
        pick_count INTEGER NOT NULL,
        rule_version TEXT NOT NULL,
        payload TEXT NOT NULL,
        matrix TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        draft_version_id INTEGER NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('single', 'periodic')),
        threshold INTEGER,
        rule_version TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (draft_version_id) REFERENCES draft_versions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_reports_version ON reports(draft_version_id);
    `);
  }

  importDraft(input: DraftInput): { version: DraftVersion; created: boolean } {
    const expanded = expandDraft(input);
    const hash = draftHash(input);
    const existing = this.db.prepare("SELECT * FROM draft_versions WHERE content_hash = ?").get(hash) as unknown as DraftRow | undefined;
    if (existing) return { version: this.toVersion(existing), created: false };

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare(`INSERT INTO draft_versions
          (content_hash, name, shaft_count, treadle_count, end_count, pick_count, rule_version, payload, matrix)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          hash,
          input.name ?? null,
          input.shaftCount,
          input.treadleCount,
          input.threading.length,
          input.treadling.length,
          expanded.ruleVersion,
          JSON.stringify(input),
          JSON.stringify(expanded.matrix),
        );
      const row = this.db.prepare("SELECT * FROM draft_versions WHERE id = ?").get(Number(result.lastInsertRowid)) as unknown as DraftRow;
      this.db.exec("COMMIT");
      return { version: this.toVersion(row), created: true };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  saveReport(versionId: number, report: FloatReport): number {
    const existing = this.db
      .prepare("SELECT id FROM reports WHERE draft_version_id = ? AND mode = ? AND threshold IS ?")
      .get(versionId, report.mode, report.threshold ?? null) as unknown as { id: number } | undefined;
    if (existing) return existing.id;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare("INSERT INTO reports (draft_version_id, mode, threshold, rule_version, payload) VALUES (?, ?, ?, ?, ?)")
        .run(versionId, report.mode, report.threshold ?? null, report.ruleVersion, JSON.stringify(report));
      this.db.exec("COMMIT");
      return Number(result.lastInsertRowid);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getVersion(id: number): DraftVersion | null {
    const row = this.db.prepare("SELECT * FROM draft_versions WHERE id = ?").get(id) as unknown as DraftRow | undefined;
    return row ? this.toVersion(row) : null;
  }

  listVersions(): Array<{ id: number; name: string | null; created_at: string }> {
    return this.db.prepare("SELECT id, name, created_at FROM draft_versions ORDER BY id").all() as unknown as Array<{ id: number; name: string | null; created_at: string }>;
  }

  getReport(id: number): { versionId: number; report: FloatReport } | null {
    const row = this.db.prepare("SELECT draft_version_id, payload FROM reports WHERE id = ?").get(id) as unknown as { draft_version_id: number; payload: string } | undefined;
    return row ? { versionId: row.draft_version_id, report: JSON.parse(row.payload) as FloatReport } : null;
  }

  close(): void {
    this.db.close();
  }

  private toVersion(row: DraftRow): DraftVersion {
    const draft = JSON.parse(row.payload) as DraftInput;
    return {
      id: row.id,
      content_hash: row.content_hash,
      name: row.name,
      draft,
      expanded: expandDraft(draft),
      created_at: row.created_at,
    };
  }
}




