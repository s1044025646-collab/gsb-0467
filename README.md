# 踏板织机组织展开与跨周期浮长核验（后端）

离线本地服务：输入穿综顺序（threading）、踏板提综表（tieUp）、逐纬踩踏顺序（treadling），展开经纬交织矩阵，并按单片 / 周期两种模式统计正面经浮长与纬浮长。仅提供 HTTP API 与 CLI，无图形界面、不控制实际织机。

技术栈：TypeScript + Node.js（>= 22.5，使用内置 `node:sqlite`，零运行时依赖）+ SQLite。Windows 本地直接运行，不需要 Docker / WSL / 外部服务。

## 模型约定

- **上升梭口模型**：踏板只负责“提起”综框；未被提起的综框在下。
- 综框与踏板均从 **0** 编号，各 1–8 个；越界编号直接报错，**不自动取模**。
- `threading[w]`：第 `w` 根经纱所属综框（恰好一个）。
- `tieUp[t]`：踏板 `t` 提升的综框列表；同一踏板内综框重复会被拒绝。
- `treadling[p]`：第 `p` 次投纬同时踩下的踏板列表（取并集）；允许空数组 `[]` 表示该次不踩任何踏板、全部经纱在下；同一投纬内踏板重复会被拒绝。
- 第 `p` 纬、第 `w` 根经纱：若其综框在当次提综集合内，则 `matrix[p][w] = 1`（**经在正面、纬在下面**），否则为 `0`。行 = 投纬顺序，列 = 经纱顺序。
- **经浮长**：同一列连续 `1` 的计数（正面）。**纬浮长**：同一行连续 `0` 的计数（正面）。
- 上限：经纱数 ≤ 256，投纬次数 ≤ 256（见 `src/model.ts` 常量）。

## 单片与周期模式

- `single`（单片）：浮长在四边截断，不跨边。
- `cyclic`（周期重复）：每列首尾投纬相接、每行首尾经纱相接；跨接缝的尾段与首段**合并**为一段，见证索引按从起点前进的顺序列出（如 `[3,0,1]`），并带 `wraps: true`。
- **全周期持续**：若某列全为 `1`（或某行全为 `0`），返回 `fullCycle: true`、长度为**本周期长度**（不是 Infinity），见证为起点 0 与全部索引。周期模式下全周期持续**总是判定超限**；普通段仅当长度**严格大于** `maxFloat` 才超限（等值不算超限）。
- 没有目标值时 `maxFloat = 0`、`witness = null`。

## 版本与存储

- 规则版本：`rising-shed-v1`，随草稿、矩阵、报告一起落库。
- 三份草图任一变化（穿综 / 提综 / 踩踏）都会因内容哈希不同而生成**新草稿版本**；历史报告始终指向其所属版本，不会被新草图“改写”。
- 矩阵展开与报告写入在事务中原子保存；参数校验失败不会留下残缺矩阵。
- 数据目录：项目内 `./data/loom.db`（可用环境变量 `LOOM_DATA_DIR` 覆盖）。

## 构建 / 测试 / 启动 / 演示

```powershell
npm install      # 仅安装开发依赖 typescript / @types/node
npm run build    # 编译到 dist/
npm test         # 构建并运行全部单元与端到端测试
npm start        # 启动 API（默认端口 0 = 自动选择空闲端口，PORT 环境变量或 --port 可指定）
npm run demo     # 双综框平纹演示：矩阵 [1,0,1,0]/[0,1,0,1]，经纬浮长均为 1
```

## CLI

```
node dist/src/cli.js serve [--port N]
node dist/src/cli.js preview examples/plain.json     # 只校验与预览，不落库
node dist/src/cli.js import  examples/plain.json     # 导入草图，输出版本 id
node dist/src/cli.js drafts                          # 列出全部版本
node dist/src/cli.js expand 1                        # 展开并保存矩阵（文本字符表输出）
node dist/src/cli.js matrix 1
node dist/src/cli.js cell 1 0 1                      # 单元来源解释
node dist/src/cli.js floats 1 cyclic 1               # 浮长统计并保存报告
node dist/src/cli.js violations 1 1 cyclic           # 仅列超限位置
node dist/src/cli.js export 1 csv                    # 导出报告 json|csv
node dist/src/cli.js demo
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查与规则版本 |
| POST | `/drafts/preview` | 校验草图并预览矩阵，不落库 |
| POST | `/drafts` | 导入草图（相同内容复用版本 id） |
| GET | `/drafts` / `/drafts/:id` | 列表 / 详情 |
| POST | `/drafts/:id/expand` | 展开组织并原子保存 |
| GET | `/drafts/:id/matrix?format=text` | 查看矩阵（JSON 或文本字符表） |
| GET | `/drafts/:id/cell?p=0&w=1` | 单元解释：所属综框、踩下踏板、实际提起该框的踏板、结果 |
| POST | `/drafts/:id/floats` | 体：`{"mode":"single\|cyclic","maxFloat":5}`，保存并返回报告 |
| GET | `/drafts/:id/violations?mode=cyclic&maxFloat=5` | 仅超限位置 |
| GET | `/drafts/:id/reports` | 该版本的报告列表 |
| GET | `/reports/:id/export?format=json\|csv` | 导出报告 |

错误统一为 `{"error":{"code","message","details"}}`，错误码包括 `E_SCHEMA`、`E_JSON`、`E_THREADING`、`E_TIEUP`、`E_TREADLING`、`E_DUP`、`E_RANGE`、`E_LIMIT`、`E_MODE`、`E_MAXFLOAT`、`E_FORMAT`、`E_NOTFOUND`、`E_INTERNAL`。

## 验证方法

- 组织矩阵：测试中用**独立集合枚举**（逐投纬求提综集合并逐格比对）核对展开结果。
- 浮长：测试中用**两倍周期扫描 + 全周期专门判断**的独立参考实现，对 200 组随机矩阵在两种模式下逐行逐列交叉核对最大浮长与见证索引。
- 覆盖用例：全一列、全零行、从不使用的综框、同时踩两踏板、空投纬、单行单列、门槛等值不超限、跨缝见证 `[3,0,1]`、重启后数据一致、相同草图复用版本。

## 限制

- 仅上升梭口模型；不建模下降梭口、颜色、织物力学。
- `node:sqlite` 在 Node 25 仍打印 ExperimentalWarning，属正常提示，不影响功能。
- 单进程本地服务，无鉴权，面向本机离线使用。
