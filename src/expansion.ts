import { CellExplanation, DraftInput, ExpandedDraft, RULE_VERSION } from "./types.js";

export function expandDraft(input: DraftInput): ExpandedDraft {
  const matrix: number[][] = [];
  for (let pick = 0; pick < input.treadling.length; pick += 1) {
    const liftedShafts = liftedShaftSet(input, pick);
    const row: number[] = [];
    for (let end = 0; end < input.threading.length; end += 1) {
      row.push(liftedShafts.has(input.threading[end] as number) ? 1 : 0);
    }
    matrix.push(row);
  }
  return {
    ruleVersion: RULE_VERSION,
    shaftCount: input.shaftCount,
    treadleCount: input.treadleCount,
    endCount: input.threading.length,
    pickCount: input.treadling.length,
    threading: input.threading,
    tieUp: input.tieUp,
    treadling: input.treadling,
    matrix,
  };
}

export function liftedShaftSet(input: DraftInput, pick: number): Set<number> {
  const result = new Set<number>();
  for (const treadle of input.treadling[pick] as number[]) {
    for (const shaft of input.tieUp[treadle] as number[]) result.add(shaft);
  }
  return result;
}

export function explainCell(input: DraftInput, pick: number, end: number): CellExplanation {
  if (!Number.isInteger(pick) || pick < 0 || pick >= input.treadling.length) {
    throw Object.assign(new Error("投纬索引越界"), { code: "PICK_OUT_OF_RANGE" });
  }
  if (!Number.isInteger(end) || end < 0 || end >= input.threading.length) {
    throw Object.assign(new Error("经纱索引越界"), { code: "END_OUT_OF_RANGE" });
  }
  const pressedTreadles = [...(input.treadling[pick] as number[])];
  const shaft = input.threading[end] as number;
  const liftedShafts = liftedShaftSet(input, pick);
  const liftingTreadles = pressedTreadles.filter((treadle) => (input.tieUp[treadle] as number[]).includes(shaft));
  const value = liftedShafts.has(shaft) ? 1 : 0;
  const reason =
    value === 1
      ? `经纱 ${end} 属于综框 ${shaft}；该框由已踩踏板 ${liftingTreadles.length ? liftingTreadles.join("、") : "（内部错误）"} 提起，因此经纱在正面，单元格为 1。`
      : pressedTreadles.length === 0
        ? `经纱 ${end} 属于综框 ${shaft}；本次投纬未踩任何踏板，该框未被任何已踩踏板包含，因此经纱在下，单元格为 0。`
        : `经纱 ${end} 属于综框 ${shaft}；该框未被任何已踩踏板（${pressedTreadles.join("、")}）包含，因此经纱在下，单元格为 0。`;
  return {
    pick,
    end,
    value,
    endShaft: shaft,
    pressedTreadles,
    liftedShafts: [...liftedShafts].sort((a, b) => a - b),
    liftingTreadles,
    reason,
  };
}
