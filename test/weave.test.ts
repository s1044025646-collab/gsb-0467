import test from "node:test";
import assert from "node:assert/strict";
import { validateDraft, ApiError } from "../src/model.js";
import { expandDraft, explainCell, Matrix } from "../src/weave.js";
import { analyzeFloats } from "../src/floats.js";

const plain = { threading: [0, 1, 0, 1], tieUp: [[0], [1]], treadling: [[0], [1]] };

test("演示: 双综框平纹展开为 [1,0,1,0]/[0,1,0,1]，浮长均为 1", () => {
  const draft = validateDraft(plain);
  const m = expandDraft(draft);
  assert.deepEqual(m, [
    [1, 0, 1, 0],
    [0, 1, 0, 1],
  ]);
  const report = analyzeFloats(m, "cyclic", 1);
  for (const r of [...report.warpFloats, ...report.weftFloats]) {
    assert.equal(r.maxFloat, 1);
    assert.equal(r.exceeds, false);
  }
  assert.equal(report.violations.length, 0);
});

test("独立集合枚举核对组织矩阵", () => {
  const draft = validateDraft({
    threading: [0, 1, 2, 0, 1, 2],
    tieUp: [[0, 2], [1], []],
    treadling: [[0], [1], [0, 1], [], [2]],
  });
  const m = expandDraft(draft);
  for (let p = 0; p < draft.treadling.length; p++) {
    const lifted = new Set<number>();
    for (const pedal of draft.treadling[p]) for (const s of draft.tieUp[pedal]) lifted.add(s);
    for (let w = 0; w < draft.threading.length; w++) {
      assert.equal(m[p][w], lifted.has(draft.threading[w]) ? 1 : 0, `p=${p} w=${w}`);
    }
  }
});

test("空投纬（不踩踏板）整行为 0；同时踩两踏板取并集", () => {
  const draft = validateDraft({ threading: [0, 1], tieUp: [[0], [1]], treadling: [[], [0, 1]] });
  const m = expandDraft(draft);
  assert.deepEqual(m[0], [0, 0]);
  assert.deepEqual(m[1], [1, 1]);
  const cell = explainCell(draft, 0, 0);
  assert.equal(cell.value, 0);
  assert.match(cell.message, /未踩任何踏板/);
});

test("单元解释: 未提起时列出已踩踏板且不含空来源", () => {
  const draft = validateDraft(plain);
  const c1 = explainCell(draft, 0, 0);
  assert.equal(c1.value, 1);
  assert.deepEqual(c1.pedalsLiftingShaft, [0]);
  const c0 = explainCell(draft, 0, 1);
  assert.equal(c0.value, 0);
  assert.deepEqual(c0.pedalsPressed, [0]);
  assert.deepEqual(c0.pedalsLiftingShaft, []);
  assert.match(c0.message, /未被任何已踩踏板/);
});

test("校验: 重复综框/重复踏板/越界拒绝，不取模", () => {
  assert.throws(() => validateDraft({ threading: [0], tieUp: [[0, 0]], treadling: [[0]] }), (e: ApiError) => e.code === "E_DUP");
  assert.throws(() => validateDraft({ threading: [0], tieUp: [[0]], treadling: [[0, 0]] }), (e: ApiError) => e.code === "E_DUP");
  assert.throws(() => validateDraft({ threading: [8], tieUp: [[0]], treadling: [[0]] }), (e: ApiError) => e.code === "E_RANGE");
  assert.throws(() => validateDraft({ threading: [0], tieUp: [[0]], treadling: [[1]] }), (e: ApiError) => e.code === "E_RANGE");
  assert.throws(() => validateDraft({ threading: [0], tieUp: [[9]], treadling: [[0]] }), (e: ApiError) => e.code === "E_RANGE");
});

test("纬浮长: 行 [0,0,1,0] 单片为 2，周期为 3 且见证 [3,0,1]", () => {
  const m: Matrix = [[0, 0, 1, 0]];
  const single = analyzeFloats(m, "single", null);
  assert.equal(single.weftFloats[0].maxFloat, 2);
  assert.deepEqual(single.weftFloats[0].witness!.indices, [0, 1]);
  const cyclic = analyzeFloats(m, "cyclic", null);
  assert.equal(cyclic.weftFloats[0].maxFloat, 3);
  assert.deepEqual(cyclic.weftFloats[0].witness!.indices, [3, 0, 1]);
  assert.equal(cyclic.weftFloats[0].witness!.wraps, true);
});

test("全一列与全零行: 周期模式全周期持续，非 Infinity，总超限", () => {
  const m: Matrix = [
    [1, 0],
    [1, 0],
    [1, 0],
  ];
  const r = analyzeFloats(m, "cyclic", 5);
  assert.equal(r.warpFloats[0].maxFloat, 3);
  assert.equal(r.warpFloats[0].witness!.fullCycle, true);
  assert.deepEqual(r.warpFloats[0].witness!.indices, [0, 1, 2]);
  assert.equal(r.warpFloats[0].exceeds, true);
  assert.equal(r.warpFloats[1].maxFloat, 0);
  assert.equal(r.warpFloats[1].witness, null);
  assert.equal(r.weftFloats[0].maxFloat, 1);
  assert.equal(r.weftFloats[0].witness!.fullCycle, false);
  assert.equal(r.weftFloats[0].exceeds, false);
});

test("门槛等值不算超限，严格超过才超限", () => {
  const m: Matrix = [[1, 1, 0]];
  const r = analyzeFloats(m, "single", 2);
  assert.equal(r.warpFloats[0].maxFloat, 1);
  assert.equal(r.warpFloats[0].exceeds, false);
  const r2 = analyzeFloats(m, "single", 1);
  const col1 = r2.warpFloats[0];
  assert.equal(col1.maxFloat, 1);
  assert.equal(col1.exceeds, false);
});

test("单行单列矩阵", () => {
  const one: Matrix = [[1]];
  const r = analyzeFloats(one, "cyclic", null);
  assert.equal(r.warpFloats[0].maxFloat, 1);
  assert.equal(r.warpFloats[0].witness!.fullCycle, true);
  assert.equal(r.weftFloats[0].maxFloat, 0);
  const zero: Matrix = [[0]];
  const r2 = analyzeFloats(zero, "cyclic", null);
  assert.equal(r2.weftFloats[0].witness!.fullCycle, true);
  assert.equal(r2.warpFloats[0].maxFloat, 0);
});

test("从不使用的综框: 对应经纱列全为 0", () => {
  const draft = validateDraft({ threading: [0, 3], tieUp: [[0]], treadling: [[0]] });
  const m = expandDraft(draft);
  assert.deepEqual(m, [[1, 0]]);
});

function referenceLine(values: number[], target: 0 | 1, mode: "single" | "cyclic") {
  const n = values.length;
  const count = values.filter((v) => v === target).length;
  if (count === 0) return { max: 0, indices: [] as number[], fullCycle: false };
  if (mode === "cyclic" && count === n) {
    return { max: n, indices: Array.from({ length: n }, (_, i) => i), fullCycle: true };
  }
  const ext = mode === "cyclic" ? values.concat(values) : values;
  let best = 0;
  let bestStart = 0;
  let run = 0;
  let runStart = 0;
  for (let i = 0; i < ext.length; i++) {
    if (ext[i] === target) {
      if (run === 0) runStart = i;
      run++;
      const capped = Math.min(run, n);
      const start = (i - capped + 1) % n;
      if (capped > best || (capped === best && start < bestStart)) {
        best = capped;
        bestStart = start;
      }
    } else run = 0;
  }
  return { max: best, indices: Array.from({ length: best }, (_, k) => (bestStart + k) % n), fullCycle: false };
}

test("两倍周期扫描 + 全周期专门判断 交叉核对随机矩阵", () => {
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 200; t++) {
    const rows = 1 + Math.floor(rand() * 6);
    const cols = 1 + Math.floor(rand() * 6);
    const m: Matrix = Array.from({ length: rows }, () => Array.from({ length: cols }, () => (rand() < 0.5 ? 0 : 1)));
    for (const mode of ["single", "cyclic"] as const) {
      const r = analyzeFloats(m, mode, null);
      for (let w = 0; w < cols; w++) {
        const ref = referenceLine(m.map((row) => row[w]), 1, mode);
        const got = r.warpFloats[w];
        assert.equal(got.maxFloat, ref.max, `warp ${w} mode=${mode} m=${JSON.stringify(m)}`);
        if (ref.max === 0) assert.equal(got.witness, null);
        else assert.deepEqual(got.witness!.indices, ref.indices);
        assert.equal(got.witness?.fullCycle ?? false, ref.fullCycle);
      }
      for (let p = 0; p < rows; p++) {
        const ref = referenceLine(m[p], 0, mode);
        const got = r.weftFloats[p];
        assert.equal(got.maxFloat, ref.max, `weft ${p} mode=${mode}`);
        if (ref.max === 0) assert.equal(got.witness, null);
        else assert.deepEqual(got.witness!.indices, ref.indices);
      }
    }
  }
});
