export const RULE_VERSION = "loom-rules-1.0.0-rising-shed";
export const MAX_DIMENSION = 1024;
export const MIN_HARDWARE = 1;
export const MAX_HARDWARE = 8;

export type Mode = "single" | "periodic";

export interface DraftInput {
  name?: string;
  shaftCount: number;
  treadleCount: number;
  threading: number[];
  tieUp: number[][];
  treadling: number[][];
}

export interface ValidationIssue {
  code:
    | "SHAFT_COUNT_INVALID"
    | "TREADLE_COUNT_INVALID"
    | "THREADING_EMPTY"
    | "THREADING_TOO_LONG"
    | "THREADING_SHAFT_OUT_OF_RANGE"
    | "TIEUP_LENGTH_INVALID"
    | "TIEUP_DUPLICATE_SHAFT"
    | "TIEUP_SHAFT_OUT_OF_RANGE"
    | "TREADLING_EMPTY"
    | "TREADLING_TOO_LONG"
    | "TREADLING_DUPLICATE_TREADLE"
    | "TREADLING_TREADLE_OUT_OF_RANGE";
  path: string;
  message: string;
  index?: number;
  value?: unknown;
}

export class DraftValidationError extends Error {
  readonly code = "DRAFT_VALIDATION_FAILED";
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super("草图参数校验失败");
    this.name = "DraftValidationError";
    this.issues = issues;
  }
}

export interface CellExplanation {
  pick: number;
  end: number;
  value: 0 | 1;
  endShaft: number;
  pressedTreadles: number[];
  liftedShafts: number[];
  liftingTreadles: number[];
  reason: string;
}

export interface RunStats {
  maxLength: number;
  witness: number[];
  crossesPeriodSeam: boolean;
  uniformAcrossPeriod: boolean;
}

export interface FloatReport {
  ruleVersion: string;
  mode: Mode;
  matrix: number[][];
  warpFloatsByEnd: RunStats[];
  weftFloatsByPick: RunStats[];
  threshold?: number;
  violations: {
    warp: Array<{ end: number; maxLength: number; witness: number[]; crossesPeriodSeam: boolean; uniformAcrossPeriod: boolean }>;
    weft: Array<{ pick: number; maxLength: number; witness: number[]; crossesPeriodSeam: boolean; uniformAcrossPeriod: boolean }>;
  };
}

export interface ExpandedDraft {
  ruleVersion: string;
  shaftCount: number;
  treadleCount: number;
  endCount: number;
  pickCount: number;
  threading: number[];
  tieUp: number[][];
  treadling: number[][];
  matrix: number[][];
}
