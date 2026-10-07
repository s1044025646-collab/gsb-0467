
export function parsePort(value: string | undefined): number {
  if (value === undefined || value === "") return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw Object.assign(new Error("端口必须是 0 到 65535 的整数；0 表示由系统选择空闲端口"), { code: "INVALID_PORT" });
  }
  return port;
}


