export function matrixText(matrix: number[][]): string {
  return matrix.map((row) => row.join(" ")).join("\n");
}

export function matrixWeaveText(matrix: number[][]): string {
  return matrix.map((row) => row.map((value) => (value === 1 ? "█" : "·")).join("")).join("\n");
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] as Record<string, unknown>);
  const escape = (value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}
