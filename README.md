<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# CodeAnalyzer

一个面向 GitHub 仓库的 AI 代码分析工具。

输入仓库地址后，系统会自动拉取文件树、识别项目入口文件与入口函数、分析关键子函数调用链，并以源码面板加全景图的方式逐步展示分析过程。

## 核心能力

- 自动获取并展示仓库文件结构
- 识别项目技术栈、主语言和候选入口文件
- 二次研判真实入口文件，避免将 `AndroidManifest.xml`、`package.json` 等配置文件误判为入口
- 自动分析入口函数及关键子函数
- 支持递归下钻函数调用链，并在全景图中动态展示
- 点击全景图节点可联动打开对应源码
- 支持 `Gemini`、`OpenAI`、`GLM` 等 OpenAI 兼容接口
- 支持通过 `base URL + API Key + Model` 统一切换 AI 提供商

## 技术栈

- React 19
- Vite
- TypeScript
- Tailwind CSS
- React Router
- Lucide React

## 本地运行

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

参考 `.env.example` 新建或修改 `.env`，至少填写以下参数：

```env
AI_API_KEY="你的 API Key"
GEMINIBASE_URL="OpenAI 兼容接口地址"
AI_MODEL="模型名称"
APP_URL="http://localhost:3000"
AI_MAX_RECURSION_DEPTH="2"
```

### 3. 启动项目

```bash
npm run dev
```

## 常见模型配置示例

### GLM Coding Plan

```env
AI_API_KEY="你的智谱 API Key"
GEMINIBASE_URL="https://open.bigmodel.cn/api/coding/paas/v4"
AI_MODEL="GLM-5"
```

### Gemini

```env
AI_API_KEY="你的 Gemini API Key"
GEMINIBASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
AI_MODEL="gemini-2.5-flash"
```

### OpenAI

```env
AI_API_KEY="你的 OpenAI API Key"
GEMINIBASE_URL="https://api.openai.com/v1"
AI_MODEL="gpt-4.1-mini"
```

## 分析流程

1. 拉取 GitHub 仓库信息与文件树
2. 过滤无关目录与非目标代码文件
3. 由 AI 分析项目结构、技术栈和候选入口
4. 对候选入口文件逐个研判，确认真实入口
5. 分析入口函数的关键子函数
6. 对值得继续分析的函数进行递归下钻
7. 在源码面板和全景图中逐步展示分析结果

## 说明

- 当前主要面向公开 GitHub 仓库
- 若遇到 GitHub API 限流，可在设置中配置个人访问令牌
- 不同模型的响应速度和分析质量会有差异

## 版本

当前版本：`v1.0.2`
