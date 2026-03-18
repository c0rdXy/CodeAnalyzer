# CodeAnalyzer

CodeAnalyzer 是一个面向 GitHub 仓库的 AI 代码分析工具。输入仓库地址后，系统会获取文件树，识别项目入口文件与入口函数，递归分析关键函数调用链，并通过源码面板与全景图联动展示整个分析过程。

项目当前支持通用 OpenAI 兼容接口接入，可以在 `GLM`、`OpenAI`、`Gemini` 等常见模型服务之间切换，同时保留 `GLM Coding Plan` 的配置能力。

## 功能特性

- 自动获取并优先展示 GitHub 仓库文件结构
- 识别项目语言、技术栈与候选入口文件
- 过滤 `AndroidManifest.xml`、`package.json`、`pom.xml` 等非真实运行入口
- 结合本地规则与 AI 判断定位入口文件和入口函数
- 分析入口函数的关键子函数，并递归下钻调用链
- 通过本地函数索引、启发式搜索与 AI 猜测组合定位函数定义
- 在全景图中动态展示节点、连线、高亮状态与源码联动
- 支持分阶段模型配置、流式输出、Thinking、递归预算与性能日志

## 技术栈

- React 19
- Vite
- TypeScript
- Tailwind CSS
- React Router
- Motion
- Lucide React

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，至少填写下面这些核心参数：

```env
AI_API_KEY="你的 API Key"
GEMINIBASE_URL="OpenAI 兼容接口地址"
AI_MODEL="主分析模型"
APP_URL="http://localhost:3000"
```

推荐同时保留这些性能与分析控制参数：

```env
AI_MAX_RECURSION_DEPTH="2"
AI_MAX_DRILLDOWN_PER_LEVEL="3"
AI_MAX_ANALYSIS_NODES="12"
AI_MAX_INDEX_FILES="48"
AI_INDEX_CONCURRENCY="4"
```

### 3. 启动开发环境

```bash
npm run dev
```

默认访问地址：

```text
http://localhost:3000
```

## 模型配置示例

### GLM Coding Plan

```env
AI_API_KEY="你的智谱 API Key"
GEMINIBASE_URL="https://open.bigmodel.cn/api/coding/paas/v4"
AI_MODEL="GLM-5"
AI_MODEL_FAST="GLM-5-Flash"
AI_MODEL_ENTRY="GLM-5-Flash"
AI_MODEL_FILE_GUESS="GLM-5-Flash"
AI_MODEL_FUNCTION="GLM-5"
```

### OpenAI

```env
AI_API_KEY="你的 OpenAI API Key"
GEMINIBASE_URL="https://api.openai.com/v1"
AI_MODEL="gpt-4.1-mini"
AI_MODEL_FUNCTION="gpt-4.1"
```

### Gemini

```env
AI_API_KEY="你的 Gemini API Key"
GEMINIBASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
AI_MODEL="gemini-2.5-flash"
AI_MODEL_FUNCTION="gemini-2.5-pro"
```

## 分析流程

1. 拉取仓库信息与文件树，并优先显示文件列表。
2. 过滤无关目录与非目标源码文件。
3. 使用 AI 生成项目画像，并输出候选入口文件清单。
4. 逐个验证候选入口文件，确认真实入口文件与入口函数。
5. 分析入口函数的关键子函数。
6. 对值得继续分析的函数递归下钻。
7. 一边分析，一边更新源码面板、日志面板和全景图。

## 当前分析引擎设计

### 入口识别

- 先根据文件树和路径规则提升真实入口文件的优先级
- 再逐个读取候选入口文件内容进行验证
- 入口文件超过 4000 行时，发送前 2000 行和后 2000 行
- 优先使用本地规则识别入口函数，AI 负责补位和兜底

### 函数定位

函数定位采用多阶段策略，按以下顺序执行：

1. 上级同文件搜索
2. 本地函数索引搜索
3. 启发式优先文件搜索
4. AI 猜测候选文件
5. 项目级正则搜索

### 递归停止条件

- 找不到函数定义
- 命中系统函数或库函数
- AI 判断该函数不值得继续下钻
- 超过最大递归深度
- 超过最大分析节点数
- 超过单层下钻上限

## 关键环境变量

| 变量 | 说明 |
| --- | --- |
| `AI_API_KEY` | 模型平台 API Key |
| `GEMINIBASE_URL` | OpenAI 兼容接口根地址 |
| `AI_MODEL` | 默认主模型 |
| `AI_MODEL_FAST` | 轻量分析模型 |
| `AI_MODEL_ENTRY` | 入口文件验证模型 |
| `AI_MODEL_FILE_GUESS` | 函数文件猜测模型 |
| `AI_MODEL_FUNCTION` | 关键函数分析模型 |
| `AI_USE_STREAM` | 是否启用流式输出 |
| `AI_ENABLE_THINKING` | 是否启用推理增强 |
| `AI_MAX_RECURSION_DEPTH` | 最大递归深度 |
| `AI_MAX_DRILLDOWN_PER_LEVEL` | 每层最多继续下钻几个函数 |
| `AI_MAX_ANALYSIS_NODES` | 单次分析最多展开多少节点 |
| `AI_MAX_INDEX_FILES` | 预建本地函数索引时最多扫描多少文件 |
| `AI_INDEX_CONCURRENCY` | 预建索引时的并发数 |

## 开发命令

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

## 项目结构

```text
src/
  components/   UI 组件
  pages/        页面与主分析流程
  services/     AI 调用与分析服务
  utils/        GitHub、函数搜索、入口识别等工具
```

## 注意事项

- 当前主要面向公开 GitHub 仓库
- 如果遇到 GitHub API 限流，建议配置个人访问令牌
- 不同模型在速度、成本和分析质量上会有明显差异
- 使用前请确认你的模型服务支持 OpenAI 兼容接口

## 版本

当前版本：`v1.2.0`
