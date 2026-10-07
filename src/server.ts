import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { explainCell } from "./expansion.js";
import { calculateFloats } from "./floats.js";
import { LoomStore } from "./store.js";
import { matrixText, toCsv } from "./text.js";
import { DraftValidationError } from "./types.js";
import { validateDraft, validateMode, validateThreshold } from "./validation.js";

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 8_000_000) reject(Object.assign(new Error("请求体超过 8 MB"), { code: "PAYLOAD_TOO_LARGE" }));
    });
    request.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("请求体不是合法 JSON"), { code: "INVALID_JSON" }));
      }
    });
    request.on("error", reject);
  });
}

function matrixCsv(matrix: number[][]): string {
  return matrix.map((row) => row.join(",")).join("\n");
}

function runRows(report: Awaited<ReturnType<typeof calculateFloats>>): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  report.warpFloatsByEnd.forEach((run, end) => rows.push({ kind: "warp", index: end, ...run, witness: run.witness.join("|") }));
  report.weftFloatsByPick.forEach((run, pick) => rows.push({ kind: "weft", index: pick, ...run, witness: run.witness.join("|") }));
  return rows;
}

export function createApp(store: LoomStore): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const method = request.method ?? "GET";
      if (method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, ruleVersion: "loom-rules-1.0.0-rising-shed" });
        return;
      }
      if (method === "GET" && url.pathname === "/drafts") {
        sendJson(response, 200, { drafts: store.listVersions() });
        return;
      }
      if (method === "POST" && url.pathname === "/drafts/validate") {
        const draft = validateDraft(await readJson(request));
        sendJson(response, 200, { valid: true, draft });
        return;
      }
      if (method === "POST" && url.pathname === "/drafts") {
        const draft = validateDraft(await readJson(request));
        const { version, created } = store.importDraft(draft);
        sendJson(response, created ? 201 : 200, { created, versionId: version.id, expanded: version.expanded });
        return;
      }

      const versionMatch = url.pathname.match(/^\/drafts\/(\d+)\/(expand|cell|floats|export)$/);
      if (versionMatch && request.method === "GET") {
        const version = store.getVersion(Number(versionMatch[1]));
        if (!version) {
          sendJson(response, 404, { error: { code: "DRAFT_VERSION_NOT_FOUND", message: "指定草图版本不存在" } });
          return;
        }
        if (versionMatch[2] === "expand") {
          sendJson(response, 200, version.expanded);
          return;
        }
        if (versionMatch[2] === "cell") {
          const pick = Number(url.searchParams.get("pick"));
          const end = Number(url.searchParams.get("end"));
          sendJson(response, 200, explainCell(version.draft, pick, end));
          return;
        }
        const mode = validateMode(url.searchParams.get("mode") ?? "single");
        const threshold = validateThreshold(url.searchParams.has("threshold") ? Number(url.searchParams.get("threshold")) : undefined);
        const report = calculateFloats(version.expanded.matrix, mode, version.expanded.ruleVersion, threshold);
        if (versionMatch[2] === "export") {
          const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
          if (format === "csv") {
            const kind = url.searchParams.get("kind");
            const body = kind === "matrix" ? matrixCsv(version.expanded.matrix) : toCsv(runRows(report));
            response.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
            response.end(body);
            return;
          }
          sendJson(response, 200, report);
          return;
        }
        const reportId = store.saveReport(version.id, report);
        sendJson(response, 200, { reportId, report });
        return;
      }

      const reportMatch = url.pathname.match(/^\/reports\/(\d+)$/);
      if (reportMatch && request.method === "GET") {
        const report = store.getReport(Number(reportMatch[1]));
        if (!report) {
          sendJson(response, 404, { error: { code: "REPORT_NOT_FOUND", message: "报告不存在" } });
          return;
        }
        sendJson(response, 200, report);
        return;
      }
      sendJson(response, 404, { error: { code: "ROUTE_NOT_FOUND", message: "未找到 API 路径" } });
    } catch (error) {
      if (error instanceof DraftValidationError) {
        sendJson(response, 400, { error: { code: error.code, message: error.message, issues: error.issues } });
      } else {
        const code = (error as { code?: string }).code ?? "INTERNAL_ERROR";
        const status = code === "INTERNAL_ERROR" ? 500 : 400;
        sendJson(response, status, { error: { code, message: (error as Error).message } });
      }
    }
  });
}

export function startServer(store: LoomStore, port = 0): Promise<{ server: Server; port: number }> {
  const server = createApp(store);
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

export function matrixPreview(matrix: number[][]): string {
  return matrixText(matrix);
}
