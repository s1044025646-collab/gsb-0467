# 踏板织机组织展开与跨周期浮长核验

本项目是纯本地后端服务，只提供 HTTP API 与 CLI，不包含图形界面、不连接织机硬件、不做图片/颜色渲染或布料力学模拟。使用 TypeScript、Node.js 与 Node 内置 `node:sqlite`，无需 Docker、WSL、付费服务或外部在线 API。

## 模型约定

- 综框与踏板均从 `0` 编号，各自允许 `1..8` 个。
- 经纱数与投纬次数允许 `1..1024`。
- `threading[w]` 是第 `w` 根经纱所属综框，每根经纱恰好属于一个综框。
- `tieUp[t]` 是踩下踏板 `t` 时提升的综框集合。
- `treadling[p]` 是第 `p` 次投纬同时踩下的踏板；空数组 `[]` 表示一次都不踩，所有经纱在下。
- 同时踩多个踏板时，提升综框取并集。
- 重复综框、重复踏板明确报错；编号越界不自动取模。

本项目只实现**上升梭口**：若第 `w` 根经纱的综框在第 `p` 次投纬提升集合中，则 `matrix[p][w] = 1`，表示经纱在正面、纬纱在其下；否则为 `0`。矩阵行按投纬顺序、列按经纱顺序，不转置，也不交换零一含义。

## 浮长定义

- 经浮长：同一列连续 `1` 的长度，即正面连续经组织点。
- 纬浮长：同一行连续 `0` 的长度，即正面连续纬组织点。
- `single` 单片模式在矩阵四边截断。
- `periodic` 周期模式把每列首尾投纬相接、每行首尾经纱相接。
- 见证索引按从起点前进的顺序列出。例如行 `[0,0,1,0]` 的最大纬浮：单片为索引 `[0,1]`，长度 2；周期为 `[3,0,1]`，长度 3，并标记跨周期接缝。
- 没有目标值时最大浮长为 `0`，见证为空数组。
- 若整列全为 `1` 或整行全为 `0`，返回本周期长度、起点 `0` 的本周期全部索引与 `uniformAcrossPeriod: true`；不会输出 `Infinity`，也不会把它误算成无限重复后的有限最大段。
- 门槛判断：普通段必须 `maxLength > threshold` 才超限；全周期持续段在周期模式中无论门槛多大都标记超限。

## 环境与构建

要求 Windows 本地安装 Node.js 25（当前项目使用其内置 SQLite API）。

```powershell
npm install
npm run build
npm test
npm run demo
npm start
```

默认 `npm start` 使用端口 `0`，由操作系统选择空闲端口，并在标准输出打印实际端口。也可以指定：

```powershell
$env:PORT=8080
npm start
```

数据库默认在项目内 `data/loom.db`。可通过 `LOOM_DB` 或 CLI 的 `--db` 覆盖。

## 草图 JSON

示例见 `data/plain-weave.json`：

```json
{
  "name": "plain-weave-example",
  "shaftCount": 2,
  "treadleCount": 2,
  "threading": [0, 1, 0, 1],
  "tieUp": [[0], [1]],
  "treadling": [[0], [1]]
}
```

展开结果：

```text
1 0 1 0
0 1 0 1
```

字符表中 `█` 表示 1，`·` 表示 0。平纹在两种模式下正面经浮长和纬浮长均为 1。

## CLI

```powershell
# 只校验，预览结构或引用/重复编号错误
node dist/src/cli.js validate --file data/plain-weave.json

# 导入并展开，内容相同的草图不会生成新版本
node dist/src/cli.js import --file data/plain-weave.json

# 查看一个交织格的完整来源
node dist/src/cli.js cell --file data/plain-weave.json --pick 0 --end 0

# 单片/周期浮长与门槛
node dist/src/cli.js floats --file data/plain-weave.json --mode periodic --threshold 1
node dist/src/cli.js violations --file data/plain-weave.json --mode periodic --threshold 1

# JSON / CSV 导出
node dist/src/cli.js export --file data/plain-weave.json --mode periodic --format json --kind runs --out report.json
node dist/src/cli.js export --file data/plain-weave.json --mode periodic --format csv --kind matrix --out matrix.csv

# 列出版本、读取固定报告、启动服务
node dist/src/cli.js list
node dist/src/cli.js report --id 1
node dist/src/cli.js serve --port 0
```

## HTTP API

所有请求和响应均为本地 JSON；CSV 导出除外。

- `GET /health`：健康检查和规则版本。
- `POST /drafts/validate`：只校验草图，不保存。
- `POST /drafts`：校验、展开并按内容哈希去重保存。
- `GET /drafts`：列出草图版本。
- `GET /drafts/{id}/expand`：读取指定版本的原始草图、维度和矩阵。
- `GET /drafts/{id}/cell?pick=0&end=0`：读取单元解释。
- `GET /drafts/{id}/floats?mode=single|periodic&threshold=N`：计算并保存报告。
- `GET /drafts/{id}/export?format=json|csv&kind=matrix|runs&mode=...&threshold=N`：导出。
- `GET /reports/{id}`：按报告 ID 读取历史报告。

示例：

```powershell
$body = Get-Content data/plain-weave.json -Raw
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/drafts `
  -ContentType 'application/json; charset=utf-8' -Body $body
Invoke-RestMethod -Uri 'http://127.0.0.1:8080/drafts/1/floats?mode=periodic&threshold=1'
```

## 持久化与一致性

SQLite 保存三份原始草图（`threading`、`tieUp`、`treadling`）、维度、规则版本、展开矩阵和报告。版本由三份草图及硬件维度的规范哈希确定：改变穿综、提综或踩踏顺序都会得到新版本；重复提交相同参数返回同一版本。报告通过外键固定到生成它的版本，历史报告不会自动指向最新草图。

矩阵在事务前由已校验输入完整计算，数据库写入使用事务；参数失败不会产生少行少列的成功版本。相同版本、模式和门槛复用同一报告。重启后读取的单元来源、矩阵与浮长见证来自同一不可变版本。

## 错误码

常见错误码包括：`DRAFT_VALIDATION_FAILED`、`SHAFT_COUNT_INVALID`、`TREADLE_COUNT_INVALID`、`THREADING_SHAFT_OUT_OF_RANGE`、`TIEUP_DUPLICATE_SHAFT`、`TIEUP_SHAFT_OUT_OF_RANGE`、`TREADLING_DUPLICATE_TREADLE`、`TREADLING_TREADLE_OUT_OF_RANGE`、`INVALID_MODE`、`INVALID_THRESHOLD`、`PICK_OUT_OF_RANGE`、`END_OUT_OF_RANGE`、`DRAFT_VERSION_NOT_FOUND`、`REPORT_NOT_FOUND`。

## 已验证范围

测试覆盖：标准平纹、独立集合枚举对照、不踩踏板、未使用综框、多踏板提综并集、重复/越界拒绝、单片与跨周期接缝、全一列、全零行、单行单列、门槛等值、重启后版本/报告一致性。

## 限制

- Node 25 的 `node:sqlite` 当前会输出实验性 API 警告；功能由测试覆盖，但未来 Node 大版本可能调整 API。
- 仅保存和分析二维组织周期，不模拟纱线粗细、张力、缩率、布料力学或实际机械时序。
- 最大规模固定为经纱和投纬各 1024，适合草图核验，不面向批量生产数据仓库。
