import { Draft, ApiError } from "./model.js";

export type Matrix = number[][];

export function liftSetForPick(draft: Draft, pick: number): Set<number> {
  const lifted = new Set<number>();
  for (const pedal of draft.treadling[pick]) {
    for (const shaft of draft.tieUp[pedal]) lifted.add(shaft);
  }
  return lifted;
}

export function expandDraft(draft: Draft): Matrix {
  const picks = draft.treadling.length;
  const warps = draft.threading.length;
  const matrix: Matrix = new Array(picks);
  for (let p = 0; p < picks; p++) {
    const lifted = liftSetForPick(draft, p);
    const row = new Array<number>(warps);
    for (let w = 0; w < warps; w++) {
      row[w] = lifted.has(draft.threading[w]) ? 1 : 0;
    }
    matrix[p] = row;
  }
  return matrix;
}

export interface CellExplanation {
  pick: number;
  warp: number;
  shaft: number;
  pedalsPressed: number[];
  pedalsLiftingShaft: number[];
  lifted: boolean;
  value: 0 | 1;
  message: string;
}

export function explainCell(draft: Draft, p: number, w: number): CellExplanation {
  if (!Number.isInteger(p) || p < 0 || p >= draft.treadling.length) {
    throw new ApiError("E_RANGE", `投纬序号越界: ${p}`);
  }
  if (!Number.isInteger(w) || w < 0 || w >= draft.threading.length) {
    throw new ApiError("E_RANGE", `经纱序号越界: ${w}`);
  }
  const shaft = draft.threading[w];
  const pedalsPressed = draft.treadling[p];
  const pedalsLiftingShaft = pedalsPressed.filter((pd) => draft.tieUp[pd].includes(shaft));
  const lifted = pedalsLiftingShaft.length > 0;
  const value = lifted ? 1 : 0;
  const message = lifted
    ? `经纱 ${w} 属于综框 ${shaft}，被已踩踏板 [${pedalsLiftingShaft.join(",")}] 提起，经在正面，记 1`
    : pedalsPressed.length === 0
      ? `经纱 ${w} 属于综框 ${shaft}，本次投纬未踩任何踏板，全部经纱在下，记 0`
      : `经纱 ${w} 属于综框 ${shaft}，未被任何已踩踏板 [${pedalsPressed.join(",")}] 包含，记 0`;
  return { pick: p, warp: w, shaft, pedalsPressed: [...pedalsPressed], pedalsLiftingShaft, lifted, value: value as 0 | 1, message };
}

export function matrixToText(matrix: Matrix): string {
  const header = "    " + matrix[0].map((_, w) => String(w % 10)).join(" ");
  const lines = matrix.map((row, p) => `p${String(p).padStart(2)} ` + row.join(" "));
  return [header, ...lines].join("\n");
}
