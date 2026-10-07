import http from "node:http";
import { Store } from "./store.js";
import { validateDraft, validateMode, validateMaxFloat, ApiError, RULE_VERSION } from "./model.js";
import { expandDraft, explainCell, matrixToText } from "./weave.js";
import { analyzeFloats, FloatReport } from "./floats.js";

function send(res: http.ServerResponse, status: number, body: unknown, contentType = "application/json; charset=utf-8"): void {
  const data = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": contentType });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new ApiError("E_JSON", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function reportToCsv(report: FloatReport): string {
  const lines = ["kind,index,maxFloat,exceeds,witnessStart,witnessIndices,wraps,fullCycle"];
  const emit = (kind: string, r: FloatReport["warpFloats"][number]) => {
    const w = r.witness;
    lines.push(
      [kind, r.index, r.maxFloat, r.exceeds, w ? w.start : "", w ? w.indices.join("|") : "", w ? w.wraps : "", w ? w.fullCycle : ""].join(",")
    );
  };
  report.warpFloats.forEach((r) => emit("warp", r));
  report.weftFloats.forEach((r) => emit("weft", r));
  return lines.join("\r\n") + "\r\n";
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      if (method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true, ruleVersion: RULE_VERSION });
      }

      if (method === "GET" && url.pathname === "/drafts") {
        return send(res, 200, { drafts: store.listDrafts() });
      }

      if (method === "POST" && url.pathname === "/drafts/preview") {
        const body = await readBody(req);
        const draft = validateDraft(body);
        const matrix = expandDraft(draft);
        return send(res, 200, { ok: true, ruleVersion: RULE_VERSION, warps: draft.threading.length, picks: draft.treadling.length, preview: matrixToText(matrix) });
      }

      if (method === "POST" && url.pathname === "/drafts") {
        const body = await readBody(req);
        const draft = validateDraft(body);
        const { id, created } = store.importDraft(draft);
        return send(res, created ? 201 : 200, { id, created, ruleVersion: RULE_VERSION });
      }

      if (parts[0] === "drafts" && parts.length >= 2) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id)) throw new ApiError("E_SCHEMA", "草稿 id 必须是整数");
        const action = parts[2];

        if (method === "GET" && !action) {
          return send(res, 200, { id, draft: store.getDraft(id), ruleVersion: RULE_VERSION });
        }

        if (method === "POST" && action === "expand") {
          const draft = store.getDraft(id);
          const matrix = expandDraft(draft);
          store.saveMatrix(id, matrix);
          return send(res, 200, { id, ruleVersion: RULE_VERSION, matrix, text: matrixToText(matrix) });
        }

        if (method === "GET" && action === "matrix") {
          const matrix = store.getMatrix(id);
          if (url.searchParams.get("format") === "text") {
            return send(res, 200, matrixToText(matrix), "text/plain; charset=utf-8");
          }
          return send(res, 200, { id, matrix });
        }

        if (method === "GET" && action === "cell") {
          const p = Number(url.searchParams.get("p"));
          const w = Number(url.searchParams.get("w"));
          const draft = store.getDraft(id);
          return send(res, 200, explainCell(draft, p, w));
        }

        if (method === "POST" && action === "floats") {
          const body = (await readBody(req)) as Record<string, unknown>;
          const mode = validateMode(body.mode ?? url.searchParams.get("mode"));
          const maxFloat = validateMaxFloat(body.maxFloat ?? (url.searchParams.get("maxFloat") !== null ? Number(url.searchParams.get("maxFloat")) : undefined));
          const matrix = store.getMatrix(id);
          const report = analyzeFloats(matrix, mode, maxFloat);
          const reportId = store.saveReport(id, mode, maxFloat, report);
          return send(res, 200, { reportId, draftId: id, ruleVersion: RULE_VERSION, ...report });
        }

        if (method === "GET" && action === "violations") {
          const mode = validateMode(url.searchParams.get("mode") ?? "cyclic");
          const maxFloat = validateMaxFloat(url.searchParams.get("maxFloat") !== null ? Number(url.searchParams.get("maxFloat")) : undefined) ?? 5;
          const matrix = store.getMatrix(id);
          const report = analyzeFloats(matrix, mode, maxFloat);
          return send(res, 200, { draftId: id, mode, maxFloat, violations: report.violations });
        }

        if (method === "GET" && action === "reports") {
          return send(res, 200, { reports: store.listReports(id) });
        }
      }

      if (parts[0] === "reports" && parts.length === 3 && parts[2] === "export" && method === "GET") {
        const reportId = Number(parts[1]);
        const rec = store.getReport(reportId);
        const format = url.searchParams.get("format") ?? "json";
        if (format === "csv") {
          return send(res, 200, reportToCsv(rec.payload), "text/csv; charset=utf-8");
        }
        if (format === "json") {
          return send(res, 200, { reportId, ...rec });
        }
        throw new ApiError("E_FORMAT", "format 必须是 json 或 csv");
      }

      throw new ApiError("E_NOTFOUND", `未知路由: ${method} ${url.pathname}`);
    } catch (e) {
      if (e instanceof ApiError) {
        return send(res, e.code === "E_NOTFOUND" ? 404 : 400, { error: { code: e.code, message: e.message, details: e.details ?? null } });
      }
      return send(res, 500, { error: { code: "E_INTERNAL", message: String(e) } });
    }
  });
}

export function startServer(dbPath: string, port: number): Promise<{ server: http.Server; port: number }> {
  const store = new Store(dbPath);
  const server = createServer(store);
  server.on("close", () => store.close());
  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      resolve({ server, port: actual });
    });
  });
}
