import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandDraft, explainCell } from "../src/expansion.js";
import { calculateFloats } from "../src/floats.js";
import { LoomStore } from "../src/store.js";
import { DraftInput } from "../src/types.js";
import { validateDraft } from "../src/validation.js";

const plainWeave: DraftInput = {
  shaftCount: 2,
  treadleCount: 2,
  threading: [0, 1, 0, 1],
  tieUp: [[0], [1]],
  treadling: [[0], [1]],
};

function independentExpand(draft: DraftInput): number[][] {
  return draft.treadling.map((pressed) => {
    const lifted = new Set<number>();
    for (const treadle of pressed) for (const shaft of draft.tieUp[treadle]!) lifted.add(shaft);
    return draft.threading.map((shaft) => (lifted.has(shaft) ? 1 : 0));
  });
}

describe("组织展开", () => {
  it("按上升梭口模型生成平纹矩阵", () => {
    assert.deepEqual(expandDraft(plainWeave).matrix, [[1, 0, 1, 0], [0, 1, 0, 1]]);
  });

  it("与独立集合枚举一致", () => {
    const draft: DraftInput = {
      shaftCount: 3,
      treadleCount: 3,
      threading: [0, 1, 2, 0],
      tieUp: [[0], [1, 2], []],
      treadling: [[], [0, 1], [1, 2], [2]],
    };
    assert.deepEqual(expandDraft(draft).matrix, independentExpand(draft));
  });

  it("多个踏板提综集合取并集，允许未使用综框和空踏板", () => {
    const draft: DraftInput = { shaftCount: 3, treadleCount: 2, threading: [0, 1, 2], tieUp: [[0], [1]], treadling: [[0, 1], []] };
    assert.deepEqual(expandDraft(draft).matrix, [[1, 1, 0], [0, 0, 0]]);
  });

  it("单元解释保留来源且零值不伪装来源", () => {
    const lifted = explainCell(plainWeave, 0, 0);
    const lowered = explainCell(plainWeave, 0, 1);
    assert.equal(lifted.value, 1);
    assert.deepEqual(lifted.liftingTreadles, [0]);
    assert.equal(lowered.value, 0);
    assert.deepEqual(lowered.liftingTreadles, []);
    assert.match(lowered.reason, /未被任何已踩踏板/);
  });

  it("拒绝重复编号且越界不取模", () => {
    assert.throws(() => validateDraft({ ...plainWeave, treadling: [[0, 0]] }), (error: unknown) => (error as { code?: string }).code === "DRAFT_VALIDATION_FAILED");
    assert.throws(() => validateDraft({ ...plainWeave, threading: [2] }), (error: unknown) => (error as { code?: string }).code === "DRAFT_VALIDATION_FAILED");
    assert.throws(() => validateDraft({ ...plainWeave, tieUp: [[0, 0], [1]] }), (error: unknown) => (error as { code?: string }).code === "DRAFT_VALIDATION_FAILED");
  });
});

describe("浮长统计", () => {
  it("平纹经浮长和纬浮长均为一", () => {
    const report = calculateFloats(expandDraft(plainWeave).matrix, "periodic", "rule");
    assert.ok(report.warpFloatsByEnd.every((run) => run.maxLength === 1));
    assert.ok(report.weftFloatsByPick.every((run) => run.maxLength === 1));
  });

  it("零行单片截断、周期首尾相接", () => {
    const single = calculateFloats([[0, 0, 1, 0]], "single", "rule");
    const periodic = calculateFloats([[0, 0, 1, 0]], "periodic", "rule");
    assert.equal(single.weftFloatsByPick[0]!.maxLength, 2);
    assert.deepEqual(single.weftFloatsByPick[0]!.witness, [0, 1]);
    assert.equal(periodic.weftFloatsByPick[0]!.maxLength, 3);
    assert.deepEqual(periodic.weftFloatsByPick[0]!.witness, [3, 0, 1]);
    assert.equal(periodic.weftFloatsByPick[0]!.crossesPeriodSeam, true);
  });

  it("全一列和全零行返回周期长度和持续标志而不是 Infinity", () => {
    const fullOneColumn = calculateFloats([[1, 0], [1, 0]], "periodic", "rule", 99);
    assert.deepEqual(fullOneColumn.warpFloatsByEnd[0], { maxLength: 2, witness: [0, 1], crossesPeriodSeam: true, uniformAcrossPeriod: true });
    assert.equal(fullOneColumn.violations.warp.some((item) => item.end === 0), true);
    const fullZeroRow = calculateFloats([[0, 0]], "periodic", "rule", 99);
    assert.deepEqual(fullZeroRow.weftFloatsByPick[0], { maxLength: 2, witness: [0, 1], crossesPeriodSeam: true, uniformAcrossPeriod: true });
    assert.equal(fullZeroRow.violations.weft.length, 1);
    assert.equal(JSON.stringify({ fullOneColumn, fullZeroRow }).includes("Infinity"), false);
  });

  it("无目标值最大长度为零且见证为空", () => {
    const allOne = calculateFloats([[1, 1]], "single", "rule");
    assert.deepEqual(allOne.weftFloatsByPick[0], { maxLength: 0, witness: [], crossesPeriodSeam: false, uniformAcrossPeriod: false });
    const allZero = calculateFloats([[0, 0]], "single", "rule");
    assert.deepEqual(allZero.warpFloatsByEnd[0], { maxLength: 0, witness: [], crossesPeriodSeam: false, uniformAcrossPeriod: false });
  });

  it("单行单列和门槛等值不超限，严格大于才超限", () => {
    assert.equal(calculateFloats([[1]], "periodic", "rule", 1).violations.warp.length, 1);
    const normal = calculateFloats([[0, 0, 1]], "single", "rule", 2);
    assert.equal(normal.violations.weft.length, 0);
    assert.equal(calculateFloats([[0, 0, 0, 1]], "single", "rule", 2).violations.weft.length, 1);
  });
});

describe("SQLite 持久化", () => {
  it("相同草图去重，改变穿综或提综产生新版本，报告绑定旧版本", () => {
    const db = join(mkdtempSync(join(tmpdir(), "loom-")), "loom.db");
    const store = new LoomStore(db);
    const first = store.importDraft(plainWeave);
    assert.equal(store.importDraft(plainWeave).version.id, first.version.id);
    const report = calculateFloats(first.version.expanded.matrix, "periodic", first.version.expanded.ruleVersion, 1);
    const reportId = store.saveReport(first.version.id, report);
    const changed = store.importDraft({ ...plainWeave, threading: [0, 0, 1, 1] });
    assert.notEqual(changed.version.id, first.version.id);
    const stored = store.getReport(reportId)!;
    assert.equal(stored.versionId, first.version.id);
    assert.deepEqual(stored.report.matrix, report.matrix);
    store.close();
    const reopened = new LoomStore(db);
    assert.deepEqual(reopened.getReport(reportId)!.report.matrix, report.matrix);
  });
});
