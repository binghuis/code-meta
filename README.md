# code-meta

根据项目源码自动生成 **Cursor Skill 资源**（`.cursor/skills/code-meta/index.json` 与 `by-dir/*.json` 分片），供 AI 按需查阅项目结构、目录职责与文件说明。

## 功能

- **扫描**：遍历 `src`（可配置）目录，构建文件树并计算 md5 / 目录 fingerprint
- **增量**：基于 fingerprint 只对变更目录调用 AI，节省成本
- **分析**：自底向上用 LLM 分析每个目录，输出 summary、业务领域、场景、约定、文件说明
- **Skill 资源**：生成轻量索引 `index.json` 与按顶层目录分片的 `by-dir/*.json`，供 AI 先查索引再按需加载；若目录下无 SKILL.md 则创建默认，有则不动
- **人工覆写**：通过 `.code-meta/overrides.yaml` 修正或补充 AI 描述
- **Feature Map**：按功能跨目录聚合，结果写入同一 JSON 的 features 段

## 安装

```bash
pnpm add -D code-meta
# 或
npm i -D code-meta
```

## 使用

```bash
# 全量分析并生成项目元信息（首次或日常）
npx code-meta

# 仅扫描与 diff，不调用 API，查看待分析目录与预估 token
npx code-meta --dry-run

# 只分析指定子路径
npx code-meta src/modules/payment

# 只分析目录深度 ≤ N 层
npx code-meta --depth=2

# 仅从缓存重新生成 index.json 与 by-dir 分片，不调用 API（适合新人或改模板后）
npx code-meta --emit-only

# 忽略缓存，全量重新分析
npx code-meta --force
```

## 配置

在项目根目录创建 `code-meta.config.js`、`code-meta.config.json`，或使用 `.code-metarc` / `.code-metarc.json`。

### 示例（code-meta.config.js）

```js
module.exports = {
  include: ["src"],
  exclude: [], // 会与 .gitignore 解析结果合并
  allowedExtensions: [".ts", ".tsx", ".js", ".jsx", ".vue", ".mjs", ".cjs"],
  provider: {
    baseUrl: process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: process.env.ARK_API_KEY,
    model: process.env.ARK_MODEL || "doubao-seed-1-8-251228",
    timeout: 90000,
  },
  skill: {
    outputDir: ".cursor/skills/code-meta",
    indexFileName: "index.json",
    dirShardDir: "by-dir",
  },
  features: {
    payment: {
      globs: ["**/payment*", "**/pay*"],
      description: "支付相关逻辑",
    },
  },
};
```

环境变量可直接用于 provider：`ARK_API_KEY`、`ARK_BASE_URL`、`ARK_MODEL`；也支持 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`。

### 人工覆写

在 `.code-meta/overrides.yaml` 中按目录路径覆写或补充 AI 结果：

```yaml
src/legacy/payment:
  summary: "已废弃的旧版支付模块，请勿新增代码。"
  conventions:
    - "只允许 bugfix"
```

## 产出与缓存

- **Skill 资源**：`.cursor/skills/code-meta/index.json`（轻量索引）+ `by-dir/*.json`（按顶层目录分片的元信息）；同目录下若无 `SKILL.md` 则自动创建默认，有则不动（建议将该目录加入 `.gitignore`，由本地或 CI 生成）
- **缓存**：`.code-meta/cache.json`（可提交到 Git，便于团队共享；新人 `npx code-meta --emit-only` 即可生成元信息，无需 API）

## 与 Cursor 集成

1. 在项目根执行 `npx code-meta` 生成 index.json 与 by-dir 分片。
2. 将 `.cursor/skills/code-meta` 作为 Skill 使用；AI 先查阅 `index.json`，再按需查阅 `by-dir/<模块>.json`。

## 集成到工作流

### 提交前更新元信息（推荐）

```bash
# .husky/pre-commit 或 pre-commit hook
npx code-meta
git add .cursor/skills/code-meta .code-meta/cache.json
```

### 新人克隆后仅生成元信息（不调 API）

```bash
# package.json scripts
"postinstall": "npx code-meta --emit-only"
```

若未提交 `cache.json`，新人需配置 API Key 后执行一次 `npx code-meta`。

### 切换分支后增量更新

```bash
# .husky/post-checkout
npx code-meta
```

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 全量自测（Vitest，不含真实 API）
npm run test

# 监听模式
npm run test:watch

# 端到端（Mock API，无需豆包密钥）
npm run test:e2e:mock

# 端到端（真实豆包 API，需配置 .env 中 ARK_API_KEY 且先 npm run build）
npm run test:e2e
```

## License

MIT
