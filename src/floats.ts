import { FloatLineResult, FloatWitness, Mode } from "./model.js";
import { Matrix } from "./weave.js";

function analyzeLine(values: number[], target: 0 | 1, mode: Mode, index: number, maxFloat: number | null): FloatLineResult {
  const n = values.length;
  const count = values.filter((v) => v === target).length;

  if (count === 0) {
    return { index, maxFloat: 0, witness: null, exceeds: false };
  }

  if (mode === "cyclic" && count === n) {
    const witness: FloatWitness = {
      start: 0,
      indices: Array.from({ length: n }, (_, i) => i),
      wraps: n > 1,
      fullCycle: true,
    };
    return { index, maxFloat: n, witness, exceeds: true };
  }

  let bestLen = 0;
  let bestStart = -1;

  if (mode === "single") {
    let run = 0;
    let runStart = 0;
    for (let i = 0; i < n; i++) {
      if (values[i] === target) {
        if (run === 0) runStart = i;
        run++;
        if (run > bestLen) {
          bestLen = run;
          bestStart = runStart;
        }
      } else {
        run = 0;
      }
    }
  } else {
    const dbl = values.concat(values);
    let run = 0;
    for (let i = 0; i < 2 * n; i++) {
      if (dbl[i] === target) {
        run++;
        const capped = Math.min(run, n);
        const cappedStart = i - capped + 1;
        const startMod = cappedStart % n;
        if (capped > bestLen || (capped === bestLen && bestLen > 0 && startMod < bestStart)) {
          bestLen = capped;
          bestStart = startMod;
        }
      } else {
        run = 0;
      }
    }
  }

  const indices = Array.from({ length: bestLen }, (_, k) => (bestStart + k) % n);
  const witness: FloatWitness = {
    start: bestStart,
    indices,
    wraps: mode === "cyclic" && bestStart + bestLen - 1 >= n,
    fullCycle: false,
  };
  const exceeds = maxFloat !== null && bestLen > maxFloat;
  return { index, maxFloat: bestLen, witness, exceeds };
}

export interface FloatReport {
  mode: Mode;
  maxFloat: number | null;
  warpFloats: FloatLineResult[];
  weftFloats: FloatLineResult[];
  violations: { kind: "warp" | "weft"; index: number; maxFloat: number; witness: FloatWitness | null }[];
}

export function analyzeFloats(matrix: Matrix, mode: Mode, maxFloat: number | null): FloatReport {
  const picks = matrix.length;
  const warps = matrix[0].length;

  const warpFloats: FloatLineResult[] = [];
  for (let w = 0; w < warps; w++) {
    const col = matrix.map((row) => row[w]);
    warpFloats.push(analyzeLine(col, 1, mode, w, maxFloat));
  }

  const weftFloats: FloatLineResult[] = [];
  for (let p = 0; p < picks; p++) {
    weftFloats.push(analyzeLine(matrix[p], 0, mode, p, maxFloat));
  }

  const violations: FloatReport["violations"] = [];
  for (const r of warpFloats) {
    if (r.exceeds) violations.push({ kind: "warp", index: r.index, maxFloat: r.maxFloat, witness: r.witness });
  }
  for (const r of weftFloats) {
    if (r.exceeds) violations.push({ kind: "weft", index: r.index, maxFloat: r.maxFloat, witness: r.witness });
  }

  return { mode, maxFloat, warpFloats, weftFloats, violations };
}
