export const RULE_VERSION = "rising-shed-v1";
export const MAX_SHAFTS = 8;
export const MAX_PEDALS = 8;
export const MAX_WARPS = 256;
export const MAX_PICKS = 256;

export interface Draft {
  threading: number[];
  tieUp: number[][];
  treadling: number[][];
}

export type Mode = "single" | "cyclic";

export interface FloatWitness {
  start: number;
  indices: number[];
  wraps: boolean;
  fullCycle: boolean;
}

export interface FloatLineResult {
  index: number;
  maxFloat: number;
  witness: FloatWitness | null;
  exceeds: boolean;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

function isIntArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => Number.isInteger(x));
}

export function validateDraft(input: unknown): Draft {
  if (typeof input !== "object" || input === null) {
    throw new ApiError("E_SCHEMA", "请求体必须是对象，包含 threading/tieUp/treadling");
  }
  const d = input as Record<string, unknown>;

  if (!isIntArray(d.threading) || d.threading.length === 0) {
    throw new ApiError("E_THREADING", "threading 必须是非空整数数组");
  }
  if (d.threading.length > MAX_WARPS) {
    throw new ApiError("E_LIMIT", `经纱数超过上限 ${MAX_WARPS}`, { warps: d.threading.length });
  }
  for (const s of d.threading) {
    if (s < 0 || s >= MAX_SHAFTS) {
      throw new ApiError("E_RANGE", `综框编号越界: ${s}（允许 0..${MAX_SHAFTS - 1}，不自动取模）`);
    }
  }

  if (!Array.isArray(d.tieUp) || d.tieUp.length === 0 || d.tieUp.length > MAX_PEDALS) {
    throw new ApiError("E_TIEUP", `tieUp 必须是 1..${MAX_PEDALS} 个踏板的数组`);
  }
  d.tieUp.forEach((pedal, i) => {
    if (!isIntArray(pedal)) throw new ApiError("E_TIEUP", `tieUp[${i}] 必须是整数数组`);
    const seen = new Set<number>();
    for (const s of pedal) {
      if (s < 0 || s >= MAX_SHAFTS) {
        throw new ApiError("E_RANGE", `tieUp[${i}] 中综框编号越界: ${s}`);
      }
      if (seen.has(s)) {
        throw new ApiError("E_DUP", `tieUp[${i}] 中综框 ${s} 重复`);
      }
      seen.add(s);
    }
  });

  if (!Array.isArray(d.treadling) || d.treadling.length === 0) {
    throw new ApiError("E_TREADLING", "treadling 必须是非空数组（每次投纬一个踏板数组，可为空数组）");
  }
  if (d.treadling.length > MAX_PICKS) {
    throw new ApiError("E_LIMIT", `投纬次数超过上限 ${MAX_PICKS}`, { picks: d.treadling.length });
  }
  const pedalCount = (d.tieUp as number[][]).length;
  d.treadling.forEach((pick, i) => {
    if (!isIntArray(pick)) throw new ApiError("E_TREADLING", `treadling[${i}] 必须是整数数组（允许空数组表示不踩踏板）`);
    const seen = new Set<number>();
    for (const p of pick) {
      if (p < 0 || p >= pedalCount) {
        throw new ApiError("E_RANGE", `treadling[${i}] 中踏板编号越界: ${p}（共 ${pedalCount} 个踏板）`);
      }
      if (seen.has(p)) {
        throw new ApiError("E_DUP", `treadling[${i}] 中踏板 ${p} 重复`);
      }
      seen.add(p);
    }
  });

  return {
    threading: [...d.threading],
    tieUp: (d.tieUp as number[][]).map((p) => [...p]),
    treadling: (d.treadling as number[][]).map((p) => [...p]),
  };
}

export function validateMode(v: unknown): Mode {
  if (v === "single" || v === "cyclic") return v;
  throw new ApiError("E_MODE", "mode 必须是 single 或 cyclic");
}

export function validateMaxFloat(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (!Number.isInteger(v) || (v as number) < 1) {
    throw new ApiError("E_MAXFLOAT", "maxFloat 必须是 >= 1 的整数");
  }
  return v as number;
}
