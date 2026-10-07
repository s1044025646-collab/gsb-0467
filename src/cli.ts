#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { explainCell } from "./expansion.js";
import { calculateFloats } from "./floats.js";
import { matrixText, matrixWeaveText, toCsv } from "./text.js";
import { LoomStore } from "./store.js";
import { DraftInput, DraftValidationError } from "./types.js";
import { validateDraft, validateMode, validateThreshold } from "./validation.js";

const args = process.argv.slice(2);
const command = args[0] ?? "help";
const option = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const flag = (name: string): boolean => args.includes(`--${name}`);

function readDraft(path?: string): DraftInput {
  if (!path) throw Object.assign(new Error("请用 --file 指定草图 JSON"), { code: "MISSING_FILE" });
  return validateDraft(JSON.parse(readFileSync(path, "utf8")));
}

function printError(error: unknown): never {
  if (error instanceof DraftValidationError) {
    console.error(JSON.stringify({ error: { code: error.code, message: error.message, issues: error.issues } }, null, 2));
  } else {
    console.error(JSON.stringify({ error: { code: (error as { code?: string }).code ?? "CLI_ERROR", message: (error as Error).message } }, null, 2));
  }
  process.exitCode = 1;
  throw error;
}

function output(data: unknown, csvRows?: Array<Record<string, unknown>>): void {
  if (flag("csv") && csvRows) {
    process.stdout.write(`${toCsv(csvRows)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

const demoDraft: DraftInput = {
  name: "双综框平纹演示",
  shaftCount: 2,
  treadleCount: 2,
  threading: [0, 1, 0, 1],
  tieUp: [[0], [1]],
  treadling: [[0], [1]],
};

function demo(): void {
  const draft = validateDraft(demoDraft);
  const store = new LoomStore(option("db") ?? "data/loom.db");
  const { version, created } = store.importDraft(draft);
  const single = calculateFloats(version.expanded.matrix, "single", version.expanded.ruleVersion, 1);
  const periodic = calculateFloats(version.expanded.matrix, "periodic", version.expanded.ruleVersion, 1);
  store.saveReport(version.id, single);
  store.saveReport(version.id, periodic);
  const boundaryRow: number[] = [0, 0, 1, 0];
  const boundarySingle = calculateFloats([boundaryRow], "single", version.expanded.ruleVersion);
  const boundaryPeriodic = calculateFloats([boundaryRow], "periodic", version.expanded.ruleVersion);
  console.log("=== 上升梭口零一矩阵（行=投纬，列=经纱；1=经在正面） ===");
  console.log(matrixText(version.expanded.matrix));
  console.log("\n=== 字符表（█=1，·=0） ===");
  console.log(matrixWeaveText(version.expanded.matrix));
  console.log("\n=== 平纹单片/周期浮长 ===");
  console.log(JSON.stringify({ versionId: version.id, created, single, periodic }, null, 2));
  console.log("\n=== [0,0,1,0] 纬浮接缝见证：单片索引 0,1；周期索引 3,0,1 ===");
  console.log(JSON.stringify({ single: boundarySingle.weftFloatsByPick[0], periodic: boundaryPeriodic.weftFloatsByPick[0] }, null, 2));
}

try {
  if (command === "help" || flag("help")) {
    console.log(`命令:
  validate --file draft.json            只校验并规范化草图
  import --file draft.json [--db ...]   导入/去重保存版本并展开
  expand --file draft.json              不依赖数据库展开矩阵
  cell --file draft.json --pick 0 --end 0  查看交织单元来源
  floats --file draft.json --mode single|periodic [--threshold N] [--db ...]
  violations --file draft.json --mode periodic --threshold N
  export --file draft.json --mode periodic --format json|csv --kind matrix|runs --out file
  list [--db ...]
  report --id N [--db ...]
  demo                                  内置平纹与跨缝演示
  serve [--port 0] [--db ...]           启动 HTTP API`);
  } else if (command === "demo") {
    demo();
  } else if (command === "validate") {
    output({ valid: true, draft: readDraft(option("file")) });
  } else if (command === "expand") {
    const draft = readDraft(option("file"));
    const store = new LoomStore(option("db") ?? "data/loom.db");
    const { version, created } = store.importDraft(draft);
    const csvRows = version.expanded.matrix.map((row, pick) => ({
      pick,
      ...Object.fromEntries(row.map((value, end) => [`end_${end}`, value])),
    }));
    output({ created, versionId: version.id, expanded: version.expanded, text: matrixText(version.expanded.matrix) }, csvRows);
  } else if (command === "import") {
    const store = new LoomStore(option("db") ?? "data/loom.db");
    const result = store.importDraft(readDraft(option("file")));
    output({ created: result.created, versionId: result.version.id, expanded: result.version.expanded });
  } else if (command === "cell") {
    output(explainCell(readDraft(option("file")), Number(option("pick")), Number(option("end"))));
  } else if (command === "floats" || command === "violations") {
    const mode = validateMode(option("mode") ?? "single");
    const threshold = validateThreshold(option("threshold") === undefined ? undefined : Number(option("threshold")));
    const store = new LoomStore(option("db") ?? "data/loom.db");
    const { version } = store.importDraft(readDraft(option("file")));
    const report = calculateFloats(version.expanded.matrix, mode, version.expanded.ruleVersion, threshold);
    const reportId = store.saveReport(version.id, report);
    const payload = command === "violations" ? { reportId, violations: report.violations } : { reportId, report };
    const rows = [...report.warpFloatsByEnd.map((run, index) => ({ kind: "warp", index, ...run, witness: run.witness.join("|") })), ...report.weftFloatsByPick.map((run, index) => ({ kind: "weft", index, ...run, witness: run.witness.join("|") }))];
    output(payload, rows);
  } else if (command === "export") {
    const mode = validateMode(option("mode") ?? "single");
    const report = calculateFloats((() => { const store = new LoomStore(":memory:"); return store.importDraft(readDraft(option("file"))).version.expanded.matrix; })(), mode, "loom-rules-1.0.0-rising-shed");
    const kind = option("kind") ?? "runs";
    const body = option("format") === "csv" ? (kind === "matrix" ? report.matrix.map((row) => row.join(",")).join("\n") : toCsv([...report.warpFloatsByEnd.map((run, index) => ({ kind: "warp", index, ...run, witness: run.witness.join("|") })), ...report.weftFloatsByPick.map((run, index) => ({ kind: "weft", index, ...run, witness: run.witness.join("|") }))])) : JSON.stringify(report, null, 2);
    const out = option("out");
    if (out) writeFileSync(out, body); else process.stdout.write(`${body}\n`);
  } else if (command === "list") {
    const store = new LoomStore(option("db") ?? "data/loom.db");
    output({ drafts: store.listVersions() });
  } else if (command === "report") {
    const store = new LoomStore(option("db") ?? "data/loom.db");
    const result = store.getReport(Number(option("id")));
    if (!result) throw Object.assign(new Error("报告不存在"), { code: "REPORT_NOT_FOUND" });
    output(result);
  } else if (command === "serve") {
    const { startServer } = await import("./server.js");
    const store = new LoomStore(option("db") ?? "data/loom.db");
    const port = Number(option("port") ?? "0");
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw Object.assign(new Error("端口必须是 0 到 65535"), { code: "INVALID_PORT" });
    const listening = await startServer(store, port);
    console.log(JSON.stringify({ status: "listening", url: `http://127.0.0.1:${listening.port}`, port: listening.port }));
  } else {
    throw Object.assign(new Error(`未知命令 ${command}`), { code: "UNKNOWN_COMMAND" });
  }
} catch (error) {
  printError(error);
}
