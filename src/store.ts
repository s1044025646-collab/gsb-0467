import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Draft, RULE_VERSION, ApiError } from "./model.js";
import { Matrix } from "./weave.js";
import { FloatReport } from "./floats.js";

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL UNIQUE,
        rule_version TEXT NOT NULL,
        threading TEXT NOT NULL,
        tieup TEXT NOT NULL,
        treadling TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS matrices (
        draft_id INTEGER PRIMARY KEY REFERENCES drafts(id),
        rule_version TEXT NOT NULL,
        rows INTEGER NOT NULL,
        cols INTEGER NOT NULL,
        matrix TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        draft_id INTEGER NOT NULL REFERENCES drafts(id),
        rule_version TEXT NOT NULL,
        mode TEXT NOT NULL,
        max_float INTEGER,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  static draftHash(draft: Draft): string {
    return createHash("sha256").update(JSON.stringify(draft)).digest("hex");
  }

  importDraft(draft: Draft): { id: number; created: boolean } {
    const hash = Store.draftHash(draft);
    const existing = this.db.prepare("SELECT id FROM drafts WHERE hash = ?").get(hash) as { id: number } | undefined;
    if (existing) return { id: existing.id, created: false };
    const info = this.db
      .prepare("INSERT INTO drafts (hash, rule_version, threading, tieup, treadling) VALUES (?, ?, ?, ?, ?)")
      .run(hash, RULE_VERSION, JSON.stringify(draft.threading), JSON.stringify(draft.tieUp), JSON.stringify(draft.treadling));
    return { id: Number(info.lastInsertRowid), created: true };
  }

  getDraft(id: number): Draft {
    const row = this.db.prepare("SELECT threading, tieup, treadling FROM drafts WHERE id = ?").get(id) as
      | { threading: string; tieup: string; treadling: string }
      | undefined;
    if (!row) throw new ApiError("E_NOTFOUND", `草稿版本不存在: ${id}`);
    return {
      threading: JSON.parse(row.threading),
      tieUp: JSON.parse(row.tieup),
      treadling: JSON.parse(row.treadling),
    };
  }

  listDrafts(): unknown[] {
    const rows = this.db
      .prepare(
        `SELECT d.id, d.rule_version, d.threading, d.tieup, d.treadling, d.created_at,
                m.rows AS matrix_rows, m.cols AS matrix_cols
         FROM drafts d LEFT JOIN matrices m ON m.draft_id = d.id ORDER BY d.id`
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id,
      ruleVersion: r.rule_version,
      threading: JSON.parse(r.threading as string),
      tieUp: JSON.parse(r.tieup as string),
      treadling: JSON.parse(r.treadling as string),
      matrix: r.matrix_rows == null ? null : { rows: r.matrix_rows, cols: r.matrix_cols },
      createdAt: r.created_at,
    }));
  }

  saveMatrix(draftId: number, matrix: Matrix): void {
    this.getDraft(draftId);
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO matrices (draft_id, rule_version, rows, cols, matrix) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(draft_id) DO UPDATE SET rule_version=excluded.rule_version, rows=excluded.rows, cols=excluded.cols, matrix=excluded.matrix`
        )
        .run(draftId, RULE_VERSION, matrix.length, matrix[0].length, JSON.stringify(matrix));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  getMatrix(draftId: number): Matrix {
    const row = this.db.prepare("SELECT matrix FROM matrices WHERE draft_id = ?").get(draftId) as { matrix: string } | undefined;
    if (!row) throw new ApiError("E_NOTFOUND", `草稿 ${draftId} 尚未展开组织矩阵`);
    return JSON.parse(row.matrix);
  }

  saveReport(draftId: number, mode: string, maxFloat: number | null, report: FloatReport): number {
    this.getDraft(draftId);
    const info = this.db
      .prepare("INSERT INTO reports (draft_id, rule_version, mode, max_float, payload) VALUES (?, ?, ?, ?, ?)")
      .run(draftId, RULE_VERSION, mode, maxFloat, JSON.stringify(report));
    return Number(info.lastInsertRowid);
  }

  getReport(reportId: number): { draftId: number; ruleVersion: string; mode: string; maxFloat: number | null; payload: FloatReport; createdAt: string } {
    const row = this.db.prepare("SELECT * FROM reports WHERE id = ?").get(reportId) as Record<string, unknown> | undefined;
    if (!row) throw new ApiError("E_NOTFOUND", `报告不存在: ${reportId}`);
    return {
      draftId: row.draft_id as number,
      ruleVersion: row.rule_version as string,
      mode: row.mode as string,
      maxFloat: row.max_float as number | null,
      payload: JSON.parse(row.payload as string),
      createdAt: row.created_at as string,
    };
  }

  listReports(draftId: number): unknown[] {
    return (this.db.prepare("SELECT id, rule_version, mode, max_float, created_at FROM reports WHERE draft_id = ? ORDER BY id").all(draftId) as Record<string, unknown>[]).map(
      (r) => ({ id: r.id, ruleVersion: r.rule_version, mode: r.mode, maxFloat: r.max_float, createdAt: r.created_at })
    );
  }

  close(): void {
    this.db.close();
  }
}
