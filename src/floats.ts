import { FloatReport, Mode, RunStats } from "./types.js";

function emptyRun(): RunStats {
  return { maxLength: 0, witness: [], crossesPeriodSeam: false, uniformAcrossPeriod: false };
}

function targetStats(values: number[], target: 0 | 1, mode: Mode): RunStats {
  const periodLength = values.length;
  if (periodLength === 0 || !values.includes(target)) return emptyRun();
  if (mode === "single") {
    let bestStart = -1;
    let bestLength = 0;
    let start = -1;
    for (let i = 0; i < periodLength; i += 1) {
      if (values[i] === target) {
        if (start === -1) start = i;
        const length = i - start + 1;
        if (length > bestLength) {
          bestLength = length;
          bestStart = start;
        }
      } else {
        start = -1;
      }
    }
    return {
      maxLength: bestLength,
      witness: bestStart === -1 ? [] : Array.from({ length: bestLength }, (_, offset) => bestStart + offset),
      crossesPeriodSeam: false,
      uniformAcrossPeriod: false,
    };
  }

  if (values.every((value) => value === target)) {
    return {
      maxLength: periodLength,
      witness: Array.from({ length: periodLength }, (_, index) => index),
      crossesPeriodSeam: periodLength > 1,
      uniformAcrossPeriod: true,
    };
  }

  const doubled = values.concat(values);
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let scanIndex = 0; scanIndex < doubled.length; scanIndex += 1) {
    if (doubled[scanIndex] === target) {
      if (runStart === -1) runStart = scanIndex;
      const length = scanIndex - runStart + 1;
      const validStart = runStart >= 0 && runStart < periodLength && length <= periodLength - 1;
      if (validStart && length > bestLength) {
        bestLength = length;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
    }
  }
  if (bestStart === -1) return emptyRun();
  return {
    maxLength: bestLength,
    witness: Array.from({ length: bestLength }, (_, offset) => (bestStart + offset) % periodLength),
    crossesPeriodSeam: bestStart + bestLength > periodLength,
    uniformAcrossPeriod: false,
  };
}

function column(matrix: number[][], end: number): number[] {
  return matrix.map((row) => row[end] as number);
}

export function calculateFloats(
  matrix: number[][],
  mode: Mode,
  ruleVersion: string,
  threshold?: number,
): FloatReport {
  const endCount = matrix[0]?.length ?? 0;
  const warpFloatsByEnd = Array.from({ length: endCount }, (_, end) => targetStats(column(matrix, end), 1, mode));
  const weftFloatsByPick = matrix.map((row) => targetStats(row, 0, mode));
  const violations = {
    warp: warpFloatsByEnd.flatMap((run, end) => {
      const exceeds = run.uniformAcrossPeriod || (threshold !== undefined && run.maxLength > threshold);
      return exceeds ? [{ end, ...run }] : [];
    }),
    weft: weftFloatsByPick.flatMap((run, pick) => {
      const exceeds = run.uniformAcrossPeriod || (threshold !== undefined && run.maxLength > threshold);
      return exceeds ? [{ pick, ...run }] : [];
    }),
  };
  return { ruleVersion, mode, matrix, warpFloatsByEnd, weftFloatsByPick, ...(threshold === undefined ? {} : { threshold }), violations };
}
