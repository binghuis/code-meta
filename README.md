# code-meta

**FSD 架构专用**的项目元信息生成工具——自动扫描采用 [Feature-Sliced Design](https://feature-sliced.design/) 架构的前端项目，生成结构化的 **Cursor Skill 资源**（`.cursor/skills/code-meta/`），供 AI 按需查阅项目的层、切片、Segment 与文件说明。

## 核心理念

- **FSD 结构即语义**：路径规则推导目录角色，LLM 只负责补充业务描述
- **Slice 是核心分析单位**：Layer 聚合、Segment 派生，只有 Slice 级需要完整 LLM 分析
- **增量分析**：基于 fingerprint 只对变更的 Slice 调用 AI，节省成本

## 功能

- **扫描**：自动检测 FSD 层（app / pages / widgets / features / entities / shared），构建 FSD 感知的文件树
- **增量**：基于 Slice 级 fingerprint 只对变更切片调用 AI
- **分析**：用 LLM 分析每个 Slice 的业务功能、使用场景、编码约定、公共 API
- **Skill 资源**：生成 `index.json`（FSD 语义化索引）+ `by-layer/*.json`（按层分片）+ `SKILL.md`
- **人工覆写**：通过 `.code-meta/overrides.yaml` 修正或补充 AI 描述

## 安装

```bash
pnpm add -D code-meta
# 或
npm i -D code-meta
```

## 使用

```bash
# 全量分析（首次或日常）
npx code-meta

# 仅扫描与 diff，不调用 API，查看待分析目标与预估 token
npx code-meta --dry-run

# 只分析指定 slice 或 layer
npx code-meta features/cart
npx code-meta features

# 仅从缓存重新生成元信息，不调用 API
npx code-meta --emit-only

# 忽略缓存，全量重新分析
npx code-meta --force
```

## 项目结构要求

本工具**仅支持 FSD 架构项目**。要求 `srcRoot`（默认 `src`）下至少包含：

- `shared` 层
- 至少一个业务层（`pages` / `widgets` / `features` / `entities`）

标准 FSD 结构：

```text
src/
  app/              # 全局配置、路由、Provider
  pages/            # 页面视图
    dashboard/
    settings/
  widgets/          # 业务视图组件
    sidebar/
    header/
  features/         # 可复用的最小业务功能
    auth/
    cart/
  entities/         # 业务实体数据管理
    user/
    order/
  shared/           # 与业务无关的通用代码
    ui/
    lib/
    config/
```

## 配置

在项目根目录创建 `code-meta.config.ts`、`code-meta.config.js`，或使用 `.code-metarc` / `.code-metarc.json`。

### 示例（code-meta.config.ts）

```typescript
import type { CodeMetaConfig } from "code-meta";

export default {
  srcRoot: "src",                    // FSD 层所在根目录
  provider: {
    baseUrl: process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: process.env.ARK_API_KEY,
    model: process.env.ARK_MODEL || "doubao-seed-1-8-251228",
    timeout: 90000,
  },
} satisfies CodeMetaConfig;
```

环境变量：`ARK_API_KEY`、`ARK_BASE_URL`、`ARK_MODEL`；也支持 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`。

### 人工覆写

在 `.code-meta/overrides.yaml` 中按路径覆写或补充 AI 结果：

```yaml
src/features/cart:
  summary: "购物车功能，包含商品添加、数量修改、结算等。"
  conventions:
    - "所有请求通过 api segment 发出"
```

## 产出

- **Skill 资源**：`.cursor/skills/code-meta/`
  - `index.json` — FSD 语义化索引（层 → 切片列表 + 摘要）
  - `by-layer/*.json` — 按层分片的完整元信息
  - `SKILL.md` — AI 查阅指引
- **缓存**：`.code-meta/cache.json`（可提交到 Git，团队共享）

## 与 Cursor 集成

1. 执行 `npx code-meta` 生成元信息。
2. AI 先查阅 `index.json` 了解项目全貌，再按需查阅 `by-layer/<层>.json` 获取切片详情。

## 集成到工作流

### 提交前更新元信息

```bash
# .husky/pre-commit
npx code-meta
git add .cursor/skills/code-meta .code-meta/cache.json
```

### 新人克隆后仅生成元信息（不调 API）

```bash
# package.json scripts
"postinstall": "npx code-meta --emit-only"
```

### 切换分支后增量更新

```bash
# .husky/post-checkout
npx code-meta
```

## 开发

```bash
npm install
npm run build
npm run test
npm run test:watch
```

## License

MIT
