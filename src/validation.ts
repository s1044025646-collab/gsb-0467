import {
  DraftInput,
  DraftValidationError,
  MAX_DIMENSION,
  MAX_HARDWARE,
  MIN_HARDWARE,
  ValidationIssue,
} from "./types.js";

function issue(
  code: ValidationIssue["code"],
  path: string,
  message: string,
  extra: { index?: number; value?: unknown } = {},
): ValidationIssue {
  return { code, path, message, ...(extra.index === undefined ? {} : { index: extra.index }), ...(extra.value === undefined ? {} : { value: extra.value }) };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function validateDraft(input: unknown): DraftInput {
  const issues: ValidationIssue[] = [];
  if (typeof input !== "object" || input === null) {
    throw new DraftValidationError([issue("SHAFT_COUNT_INVALID", "$", "请求体必须是对象")]);
  }
  const candidate = input as Record<string, unknown>;
  const shaftCount = candidate.shaftCount;
  const treadleCount = candidate.treadleCount;
  if (!isNonNegativeInteger(shaftCount) || shaftCount < MIN_HARDWARE || shaftCount > MAX_HARDWARE) {
    issues.push(issue("SHAFT_COUNT_INVALID", "shaftCount", `综框数量必须是 ${MIN_HARDWARE} 到 ${MAX_HARDWARE} 的整数`, { value: shaftCount }));
  }
  if (!isNonNegativeInteger(treadleCount) || treadleCount < MIN_HARDWARE || treadleCount > MAX_HARDWARE) {
    issues.push(issue("TREADLE_COUNT_INVALID", "treadleCount", `踏板数量必须是 ${MIN_HARDWARE} 到 ${MAX_HARDWARE} 的整数`, { value: treadleCount }));
  }
  if (issues.length > 0) throw new DraftValidationError(issues);

  const shafts = shaftCount as number;
  const treadles = treadleCount as number;
  const threading = candidate.threading;
  const tieUp = candidate.tieUp;
  const treadling = candidate.treadling;

  if (!Array.isArray(threading) || threading.length === 0) {
    issues.push(issue("THREADING_EMPTY", "threading", "穿综顺序至少包含一根经纱"));
  } else if (threading.length > MAX_DIMENSION) {
    issues.push(issue("THREADING_TOO_LONG", "threading", `经纱数量不能超过 ${MAX_DIMENSION}`, { value: threading.length }));
  } else {
    threading.forEach((value, index) => {
      if (!isNonNegativeInteger(value) || value >= shafts) {
        issues.push(issue("THREADING_SHAFT_OUT_OF_RANGE", `threading[${index}]`, `经纱 ${index} 的综框编号必须在 [0, ${shafts - 1}]，不自动取模`, { index, value }));
      }
    });
  }

  if (!Array.isArray(tieUp) || tieUp.length !== treadles) {
    issues.push(issue("TIEUP_LENGTH_INVALID", "tieUp", `提综表必须为每个踏板（0 到 ${treadles - 1}）提供一行`));
  } else {
    tieUp.forEach((row, treadle) => {
      if (!Array.isArray(row)) {
        issues.push(issue("TIEUP_LENGTH_INVALID", `tieUp[${treadle}]`, "踏板提升综框列表必须是数组", { index: treadle, value: row }));
        return;
      }
      const seen = new Set<number>();
      for (const value of row) {
        if (!isNonNegativeInteger(value) || value >= shafts) {
          issues.push(issue("TIEUP_SHAFT_OUT_OF_RANGE", `tieUp[${treadle}]`, `踏板 ${treadle} 引用的综框必须在 [0, ${shafts - 1}]，不自动取模`, { index: treadle, value }));
        } else if (seen.has(value)) {
          issues.push(issue("TIEUP_DUPLICATE_SHAFT", `tieUp[${treadle}]`, `踏板 ${treadle} 重复提升综框 ${value}`, { index: treadle, value }));
        } else {
          seen.add(value);
        }
      }
    });
  }

  if (!Array.isArray(treadling) || treadling.length === 0) {
    issues.push(issue("TREADLING_EMPTY", "treadling", "踩踏顺序至少包含一次投纬"));
  } else if (treadling.length > MAX_DIMENSION) {
    issues.push(issue("TREADLING_TOO_LONG", "treadling", `投纬次数不能超过 ${MAX_DIMENSION}`, { value: treadling.length }));
  } else {
    treadling.forEach((row, pick) => {
      if (!Array.isArray(row)) {
        issues.push(issue("TREADLING_TREADLE_OUT_OF_RANGE", `treadling[${pick}]`, "每次投纬的踏板列表必须是数组；空数组表示不踩踏板", { index: pick, value: row }));
        return;
      }
      const seen = new Set<number>();
      for (const value of row) {
        if (!isNonNegativeInteger(value) || value >= treadles) {
          issues.push(issue("TREADLING_TREADLE_OUT_OF_RANGE", `treadling[${pick}]`, `第 ${pick} 次投纬引用的踏板必须在 [0, ${treadles - 1}]，不自动取模`, { index: pick, value }));
        } else if (seen.has(value)) {
          issues.push(issue("TREADLING_DUPLICATE_TREADLE", `treadling[${pick}]`, `第 ${pick} 次投纬重复踩下踏板 ${value}`, { index: pick, value }));
        } else {
          seen.add(value);
        }
      }
    });
  }

  if (issues.length > 0) throw new DraftValidationError(issues);
  return {
    ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
    shaftCount: shafts,
    treadleCount: treadles,
    threading: [...(threading as number[])],
    tieUp: (tieUp as number[][]).map((row) => [...row]),
    treadling: (treadling as number[][]).map((row) => [...row]),
  };
}

export function validateMode(mode: unknown): "single" | "periodic" {
  if (mode === "single" || mode === "periodic") return mode;
  throw Object.assign(new Error("模式必须是 single 或 periodic"), { code: "INVALID_MODE" });
}

export function validateThreshold(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw Object.assign(new Error("最大允许浮长必须是非负整数"), { code: "INVALID_THRESHOLD" });
  }
  return value;
}

