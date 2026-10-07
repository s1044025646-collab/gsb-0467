import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { validateDraft } from "../src/model.js";
import { expandDraft } from "../src/weave.js";
import { analyzeFloats } from "../src/floats.js";
import { startServer } from "../src/server.js";

const plain = { threading: [0, 1, 0, 1], tieUp: [[0], [1]], treadling: [[0], [1]] };

function tmpDb(): { dir: string; db: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "loom-"));
  return { dir, db: path.join(dir, "loom.db") };
}

test("草稿版本: 相同内容复用 id，改穿综或提综生成新版本", () => {
  const { dir, db } = tmpDb();
  const store = new Store(db);
  const a = store.importDraft(validateDraft(plain));
  const b = store.importDraft(validateDraft(plain));
  assert.equal(a.id, b.id);
  assert.equal(b.created, false);
  const c = store.importDraft(validateDraft({ ...plain, threading: [1, 0, 1, 0] }));
  assert.notEqual(c.id, a.id);
  const d = store.importDraft(validateDraft({ ...plain, tieUp: [[1], [0]] }));
  assert.notEqual(d.id, a.id);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("重启后矩阵与报告保持一致", () => {
  const { dir, db } = tmpDb();
  let store = new Store(db);
  const draft = validateDraft(plain);
  const { id } = store.importDraft(draft);
  const matrix = expandDraft(draft);
  store.saveMatrix(id, matrix);
  const report = analyzeFloats(matrix, "cyclic", 1);
  const reportId = store.saveReport(id, "cyclic", 1, report);
  store.close();

  store = new Store(db);
  assert.deepEqual(store.getMatrix(id), matrix);
  const rec = store.getReport(reportId);
  assert.equal(rec.draftId, id);
  assert.deepEqual(rec.payload.warpFloats[0].witness, report.warpFloats[0].witness);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("HTTP API 端到端: 导入/展开/单元/浮长/违规/导出", async () => {
  const { dir, db } = tmpDb();
  const { server, port } = await startServer(db, 0);
  const base = `http://127.0.0.1:${port}`;
  try {
    const bad = await fetch(`${base}/drafts`, {
      method: "POST",
      body: JSON.stringify({ threading: [0], tieUp: [[0, 0]], treadling: [[0]] }),
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, "E_DUP");

    const imp = await (await fetch(`${base}/drafts`, { method: "POST", body: JSON.stringify(plain) })).json();
    assert.equal(imp.created, true);

    const exp = await (await fetch(`${base}/drafts/${imp.id}/expand`, { method: "POST" })).json();
    assert.deepEqual(exp.matrix, [
      [1, 0, 1, 0],
      [0, 1, 0, 1],
    ]);

    const cell = await (await fetch(`${base}/drafts/${imp.id}/cell?p=0&w=1`)).json();
    assert.equal(cell.value, 0);
    assert.deepEqual(cell.pedalsPressed, [0]);

    const fl = await (
      await fetch(`${base}/drafts/${imp.id}/floats`, {
        method: "POST",
        body: JSON.stringify({ mode: "cyclic", maxFloat: 1 }),
      })
    ).json();
    assert.equal(fl.violations.length, 0);
    assert.ok(fl.reportId > 0);

    const vio = await (await fetch(`${base}/drafts/${imp.id}/violations?mode=cyclic&maxFloat=1`)).json();
    assert.equal(vio.violations.length, 0);

    const csv = await (await fetch(`${base}/reports/${fl.reportId}/export?format=csv`)).text();
    assert.match(csv, /^kind,index,maxFloat/);
    assert.match(csv, /warp,0,1,false/);

    const json = await (await fetch(`${base}/reports/${fl.reportId}/export?format=json`)).json();
    assert.equal(json.ruleVersion, "rising-shed-v1");

    const notFound = await fetch(`${base}/drafts/999/cell?p=0&w=0`);
    assert.equal(notFound.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
