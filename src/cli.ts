import path from "node:path";
import { readFileSync } from "node:fs";
import { Store } from "./store.js";
import { validateDraft, validateMode, validateMaxFloat, RULE_VERSION, ApiError } from "./model.js";
import { expandDraft, explainCell, matrixToText } from "./weave.js";
import { analyzeFloats } from "./floats.js";
import { reportToCsv, startServer } from "./server.js";

const DATA_DIR = process.env.LOOM_DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "loom.db");

function usage(): never {
  console.log(`踏板织机组织分析 CLI（规则版本 ${RULE_VERSION}）
用法: node dist/src/cli.js <命令> [参数]

命令:
  serve [--port N]                 启动 HTTP API（默认端口 0，即自动选择空闲端口）
  preview <draft.json>             校验草图并预览引用错误，不落库
  import <draft.json>              导入草图（穿综/提综/踩踏任一变化都会生成新版本）
  drafts                           列出全部草稿版本
  expand <draftId>                 展开组织矩阵并原子保存
  matrix <draftId>                 查看已保存矩阵（文本字符表）
  cell <draftId> <p> <w>           解释第 p 纬第 w 根经纱的交织来源
  floats <draftId> <single|cyclic> [maxFloat]   统计浮长并保存报告
  violations <draftId> [maxFloat] [mode]        仅列出超限位置
  export <reportId> [json|csv]     导出报告
  demo                             运行双综框平纹演示

草图 JSON 格式:
  { "threading": [0,1,0,1], "tieUp": [[0],[1]], "treadling": [[0],[1]] }`);
  process.exit(1);
}

function loadDraftFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ApiError("E_JSON", `无法读取或解析草图文件 ${file}: ${e}`);
  }
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) usage();

  if (cmd === "serve") {
    const portIdx = args.indexOf("--port");
    const port = portIdx >= 0 ? Number(args[portIdx + 1]) : Number(process.env.PORT ?? 0);
    const { port: actual } = await startServer(DB_PATH, Number.isInteger(port) ? port : 0);
    console.log(`API 已启动: http://127.0.0.1:${actual}  数据目录: ${DATA_DIR}`);
    return;
  }

  const store = new Store(DB_PATH);
  try {
    switch (cmd) {
      case "preview": {
        const draft = validateDraft(loadDraftFile(args[0]));
        const matrix = expandDraft(draft);
        console.log(`校验通过。经纱 ${draft.threading.length}，投纬 ${draft.treadling.length}，规则 ${RULE_VERSION}`);
        console.log(matrixToText(matrix));
        break;
      }
      case "import": {
        const draft = validateDraft(loadDraftFile(args[0]));
        const { id, created } = store.importDraft(draft);
        console.log(JSON.stringify({ id, created, ruleVersion: RULE_VERSION }));
        break;
      }
      case "drafts": {
        console.log(JSON.stringify(store.listDrafts(), null, 2));
        break;
      }
      case "expand": {
        const id = Number(args[0]);
        const matrix = expandDraft(store.getDraft(id));
        store.saveMatrix(id, matrix);
        console.log(matrixToText(matrix));
        break;
      }
      case "matrix": {
        console.log(matrixToText(store.getMatrix(Number(args[0]))));
        break;
      }
      case "cell": {
        const draft = store.getDraft(Number(args[0]));
        console.log(JSON.stringify(explainCell(draft, Number(args[1]), Number(args[2])), null, 2));
        break;
      }
      case "floats": {
        const id = Number(args[0]);
        const mode = validateMode(args[1]);
        const maxFloat = validateMaxFloat(args[2] !== undefined ? Number(args[2]) : undefined);
        const report = analyzeFloats(store.getMatrix(id), mode, maxFloat);
        const reportId = store.saveReport(id, mode, maxFloat, report);
        console.log(JSON.stringify({ reportId, ...report }, null, 2));
        break;
      }
      case "violations": {
        const id = Number(args[0]);
        const maxFloat = validateMaxFloat(args[1] !== undefined ? Number(args[1]) : undefined) ?? 5;
        const mode = validateMode(args[2] ?? "cyclic");
        const report = analyzeFloats(store.getMatrix(id), mode, maxFloat);
        console.log(JSON.stringify(report.violations, null, 2));
        break;
      }
      case "export": {
        const rec = store.getReport(Number(args[0]));
        const format = args[1] ?? "json";
        if (format === "csv") console.log(reportToCsv(rec.payload));
        else if (format === "json") console.log(JSON.stringify(rec, null, 2));
        else throw new ApiError("E_FORMAT", "format 必须是 json 或 csv");
        break;
      }
      case "demo": {
        const draft = validateDraft({ threading: [0, 1, 0, 1], tieUp: [[0], [1]], treadling: [[0], [1]] });
        const { id } = store.importDraft(draft);
        const matrix = expandDraft(draft);
        store.saveMatrix(id, matrix);
        console.log(`演示草稿 id=${id}（双综框平纹）`);
        console.log(matrixToText(matrix));
        const report = analyzeFloats(matrix, "cyclic", 1);
        const reportId = store.saveReport(id, "cyclic", 1, report);
        console.log(`报告 id=${reportId}，经纬正面浮长均为 1，无超限: ${report.violations.length === 0}`);
        break;
      }
      default:
        usage();
    }
  } finally {
    store.close();
  }
}

main().catch((e) => {
  if (e instanceof ApiError) {
    console.error(`错误 [${e.code}] ${e.message}`);
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
});
