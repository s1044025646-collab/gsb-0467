import { LoomStore } from "./store.js";
import { createApp, startServer } from "./server.js";
import { parsePort } from "./port.js";

const dbPath = process.env.LOOM_DB ?? "data/loom.db";
const store = new LoomStore(dbPath);
const port = parsePort(process.env.PORT ?? process.env.LOOM_PORT);
const { port: actualPort } = await startServer(store, port);
console.log(JSON.stringify({ status: "listening", url: `http://127.0.0.1:${actualPort}`, port: actualPort, dbPath }));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    store.close();
    process.exit(0);
  });
}

