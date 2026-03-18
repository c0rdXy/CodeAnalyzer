import React, { useEffect, useMemo, useState } from "react"
import {
  X,
  Bot,
  Cpu,
  Github,
  BookOpen,
  ExternalLink,
  Save,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react"
import {
  RUNTIME_CONFIG_KEYS,
  RuntimeConfig,
  clearRuntimeConfigOverrides,
  getRuntimeConfig,
  saveRuntimeConfigOverrides,
} from "../utils/runtimeConfig"

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type SettingsTab = "ai" | "analysis" | "github" | "docs"

type ProviderId =
  | "openai_compatible"
  | "openai"
  | "zhipu_glm"
  | "deepseek"
  | "siliconflow"
  | "local_proxy"

interface ProviderOption {
  id: ProviderId
  label: string
  docsUrl: string
  note: string
  recommendedModels: string[]
  preset: {
    baseUrl?: string
    model?: string
  }
}

const PROVIDERS: ProviderOption[] = [
  {
    id: "openai_compatible",
    label: "OpenAI 兼容接口",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    note: "适用于大多数兼容 /v1/chat/completions 的聚合平台、中转服务或统一网关。",
    recommendedModels: ["gpt-4.1-mini", "gpt-4.1", "gpt-5-mini", "gpt-5-codex"],
    preset: {},
  },
  {
    id: "openai",
    label: "OpenAI 官方",
    docsUrl: "https://platform.openai.com/docs/models",
    note: "推荐使用官方模型名，并确保 Base URL 为 https://api.openai.com/v1。",
    recommendedModels: ["gpt-4.1-mini", "gpt-4.1", "gpt-5-mini", "gpt-5-codex"],
    preset: {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
    },
  },
  {
    id: "zhipu_glm",
    label: "智谱 GLM",
    docsUrl: "https://open.bigmodel.cn/dev/howuse/model",
    note: "可使用 GLM 系列模型，常见兼容地址为 coding 或 paas 接口。",
    recommendedModels: ["GLM-5", "GLM-4.6", "GLM-4-Flash"],
    preset: {
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      model: "GLM-5",
    },
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    docsUrl: "https://api-docs.deepseek.com/zh-cn/",
    note: "使用官方 OpenAI 兼容接口，注意模型名需要与账号可用权限一致。",
    recommendedModels: ["deepseek-chat", "deepseek-reasoner"],
    preset: {
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
    },
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    docsUrl: "https://docs.siliconflow.cn/",
    note: "使用 OpenAI 兼容地址，模型名称请按控制台可用模型填写。",
    recommendedModels: [
      "Qwen/Qwen2.5-Coder-32B-Instruct",
      "deepseek-ai/DeepSeek-V3",
      "meta-llama/Meta-Llama-3.1-70B-Instruct",
    ],
    preset: {
      baseUrl: "https://api.siliconflow.cn/v1",
    },
  },
  {
    id: "local_proxy",
    label: "本地代理",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    note: "适用于本地网关、统一代理转发或自建兼容服务，推荐填写本地 OpenAI 兼容地址。",
    recommendedModels: ["gpt-5.3-codex", "gpt-5-codex", "gpt-4.1-mini"],
    preset: {
      baseUrl: "http://127.0.0.1:8317/v1",
    },
  },
]

const TABS: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
  { id: "ai", label: "AI 配置", icon: <Bot className="h-4 w-4" /> },
  {
    id: "analysis",
    label: "分析策略",
    icon: <SlidersHorizontal className="h-4 w-4" />,
  },
  { id: "github", label: "GitHub", icon: <Github className="h-4 w-4" /> },
  { id: "docs", label: "文档入口", icon: <BookOpen className="h-4 w-4" /> },
]

function maskSecret(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return ""
  }

  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 1)}***${trimmed.slice(-1)}`
  }

  return `${trimmed.slice(0, 4)}${"*".repeat(Math.max(4, trimmed.length - 8))}${trimmed.slice(-4)}`
}

function pickProvider(value: string): ProviderOption {
  return (
    PROVIDERS.find((provider) => provider.id === value) ||
    PROVIDERS.find((provider) => provider.id === "openai_compatible")!
  )
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("ai")
  const [baseline, setBaseline] = useState<RuntimeConfig>(() => getRuntimeConfig())
  const [draft, setDraft] = useState<RuntimeConfig>(() => getRuntimeConfig())
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})
  const [saveMessage, setSaveMessage] = useState("")

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const current = getRuntimeConfig()
    setBaseline(current)
    setDraft(current)
    setActiveTab("ai")
    setSaveMessage("")
  }, [isOpen])

  const selectedProvider = pickProvider((draft.AI_PROVIDER || "openai_compatible").trim())

  const isDirty = useMemo(
    () =>
      RUNTIME_CONFIG_KEYS.some(
        (key) => (draft[key] || "") !== (baseline[key] || ""),
      ),
    [baseline, draft],
  )

  const setDraftValue = (key: keyof RuntimeConfig, value: string) => {
    setDraft((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const toggleSecret = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const renderInput = (input: {
    key: keyof RuntimeConfig
    label: string
    description: string
    placeholder?: string
    secret?: boolean
    type?: "text" | "number" | "select-boolean"
  }) => {
    const value = draft[input.key] || ""
    const showSecret = Boolean(showSecrets[input.key])

    return (
      <div
        key={input.key}
        className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-sm"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-zinc-100">{input.label}</div>
            <div className="text-[11px] text-zinc-500">{input.key}</div>
          </div>
          {input.secret && (
            <button
              type="button"
              onClick={() => toggleSecret(input.key)}
              className="rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
            >
              {showSecret ? "隐藏" : "显示"}
            </button>
          )}
        </div>

        {input.type === "select-boolean" ? (
          <select
            value={(value || "false").toLowerCase() === "true" ? "true" : "false"}
            onChange={(event) => setDraftValue(input.key, event.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <input
            type={
              input.secret && !showSecret
                ? "password"
                : input.type === "number"
                  ? "number"
                  : "text"
            }
            value={value}
            onChange={(event) => setDraftValue(input.key, event.target.value)}
            placeholder={input.placeholder}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          />
        )}

        {input.secret && value && !showSecret && (
          <div className="mt-1 text-[11px] text-zinc-500">
            当前值：{maskSecret(value)}
          </div>
        )}

        <p className="mt-2 text-xs leading-relaxed text-zinc-400">{input.description}</p>
      </div>
    )
  }

  const applyProviderPreset = () => {
    setDraft((prev) => ({
      ...prev,
      AI_PROVIDER: selectedProvider.id,
      GEMINIBASE_URL: selectedProvider.preset.baseUrl || prev.GEMINIBASE_URL,
      GEMINI_BASE_URL: selectedProvider.preset.baseUrl || prev.GEMINI_BASE_URL,
      AI_MODEL: selectedProvider.preset.model || prev.AI_MODEL,
    }))
  }

  const applyModelToAllSlots = (model: string) => {
    const normalized = model.trim()
    if (!normalized) {
      return
    }

    setDraft((prev) => ({
      ...prev,
      AI_MODEL: normalized,
      AI_MODEL_FAST: normalized,
      AI_MODEL_PROJECT: normalized,
      AI_MODEL_ENTRY: normalized,
      AI_MODEL_FILE_GUESS: normalized,
      AI_MODEL_FUNCTION: normalized,
      AI_MODEL_MODULE: normalized,
    }))
  }

  const handleSave = (closeAfterSave: boolean) => {
    saveRuntimeConfigOverrides(draft)
    const latest = getRuntimeConfig()
    setBaseline(latest)
    setDraft(latest)
    setSaveMessage("设置已应用，新的分析请求会立即使用最新配置。")

    if (closeAfterSave) {
      onClose()
    }
  }

  const handleReset = () => {
    clearRuntimeConfigOverrides()
    const latest = getRuntimeConfig()
    setBaseline(latest)
    setDraft(latest)
    setSaveMessage("已清除运行时覆盖配置，恢复为 .env 默认值。")
  }

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-start justify-between border-b border-zinc-800 bg-gradient-to-r from-zinc-900 via-zinc-900 to-emerald-950/40 px-6 py-5">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold text-zinc-100">
              <Cpu className="h-5 w-5 text-emerald-400" />
              运行时设置
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              支持运行中直接修改。点击“应用”后，新发起的分析流程会立刻生效，无需重启页面。
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <aside className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-900/70 p-3">
            <div className="space-y-1">
              {TABS.map((tab) => {
                const active = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-emerald-500/20 text-emerald-200"
                        : "text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200"
                    }`}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                )
              })}
            </div>
          </aside>

          <main className="flex-1 overflow-y-auto bg-gradient-to-b from-zinc-900 to-zinc-950 p-5">
            {activeTab === "ai" && (
              <div className="space-y-4">
                <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-zinc-200">AI 供应商</div>
                      <p className="mt-1 text-xs text-zinc-400">
                        按供应商切换显示相关配置项，也可以一键套用推荐模板。
                      </p>
                    </div>
                    <a
                      href={selectedProvider.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"
                    >
                      供应商文档 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <select
                      value={selectedProvider.id}
                      onChange={(event) => setDraftValue("AI_PROVIDER", event.target.value)}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                    >
                      {PROVIDERS.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={applyProviderPreset}
                      className="rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200 hover:border-zinc-600 hover:text-zinc-100"
                    >
                      应用供应商模板
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-zinc-400">{selectedProvider.note}</p>

                  <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-medium text-zinc-300">可选模型参考</div>
                      <a
                        href={selectedProvider.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200"
                      >
                        查看官方模型列表 <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedProvider.recommendedModels.map((model) => (
                        <button
                          key={model}
                          type="button"
                          onClick={() => setDraftValue("AI_MODEL", model)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                            (draft.AI_MODEL || "").trim() === model
                              ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-200"
                              : "border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:border-zinc-500"
                          }`}
                          title="点击设为默认模型"
                        >
                          {model}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          applyModelToAllSlots(
                            (draft.AI_MODEL || "").trim() ||
                              selectedProvider.recommendedModels[0] ||
                              "",
                          )
                        }
                        className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-200 hover:border-zinc-600"
                      >
                        同步默认模型到所有分析阶段
                      </button>
                      <span className="text-[11px] text-zinc-500">
                        当前默认模型：{(draft.AI_MODEL || "").trim() || "未设置"}
                      </span>
                    </div>
                  </div>
                </section>

                <div className="grid gap-3 md:grid-cols-2">
                  {renderInput({
                    key: "AI_API_KEY",
                    label: "AI API Key",
                    description: "主认证密钥，优先用于当前分析工作流。",
                    placeholder: "sk-xxxx",
                    secret: true,
                  })}
                  {renderInput({
                    key: "OPENAI_API_KEY",
                    label: "OpenAI API Key（兼容）",
                    description: "兼容备用字段；当 AI_API_KEY 为空时可作为回退。",
                    placeholder: "sk-xxxx",
                    secret: true,
                  })}
                  {renderInput({
                    key: "GEMINI_API_KEY",
                    label: "Gemini API Key（兼容）",
                    description: "兼容备用字段；当 AI_API_KEY 为空时可作为回退。",
                    placeholder: "AIza...",
                    secret: true,
                  })}
                  {renderInput({
                    key: "GEMINIBASE_URL",
                    label: "主 Base URL",
                    description: "OpenAI 兼容接口地址，通常不需要包含 /chat/completions。",
                    placeholder: "http://127.0.0.1:8317/v1",
                  })}
                  {renderInput({
                    key: "GEMINI_BASE_URL",
                    label: "兼容 Base URL",
                    description: "历史兼容字段，必要时可与主 Base URL 保持一致。",
                    placeholder: "http://127.0.0.1:8317/v1",
                  })}
                  {renderInput({
                    key: "AI_MODEL",
                    label: "默认模型",
                    description: "主分析流程默认使用的模型。",
                  })}
                  {renderInput({
                    key: "AI_MODEL_FAST",
                    label: "快速模型",
                    description: "适合轻量或快速阶段的默认模型。",
                  })}
                  {renderInput({
                    key: "AI_MODEL_PROJECT",
                    label: "项目画像模型",
                    description: "项目简介、语言和技术栈识别阶段使用。",
                  })}
                  {renderInput({
                    key: "AI_MODEL_ENTRY",
                    label: "入口研判模型",
                    description: "入口文件与入口函数识别阶段使用。",
                  })}
                  {renderInput({
                    key: "AI_MODEL_FUNCTION",
                    label: "函数下钻模型",
                    description: "关键子函数调用链和下钻分析阶段使用。",
                  })}
                  {renderInput({
                    key: "AI_MODEL_FILE_GUESS",
                    label: "函数定位模型",
                    description: "猜测函数所在文件时使用。",
                  })}
                  {renderInput({
                    key: "AI_MODEL_MODULE",
                    label: "模块划分模型",
                    description: "函数节点聚合成功能模块时使用。",
                  })}
                  {renderInput({
                    key: "AI_USE_STREAM",
                    label: "流式响应",
                    description: "是否启用流式返回。",
                    type: "select-boolean",
                  })}
                  {renderInput({
                    key: "AI_ENABLE_THINKING",
                    label: "推理增强",
                    description: "模型支持时可提升复杂任务质量。",
                    type: "select-boolean",
                  })}
                  {renderInput({
                    key: "AI_MAX_OUTPUT_TOKENS",
                    label: "最大输出 Token",
                    description: "控制单次响应长度上限。",
                    type: "number",
                  })}
                  {renderInput({
                    key: "AI_REQUEST_TIMEOUT_MS",
                    label: "请求超时（ms）",
                    description: "单次请求超时阈值，超时后会触发失败处理。",
                    type: "number",
                  })}
                </div>
              </div>
            )}

            {activeTab === "analysis" && (
              <div className="space-y-4">
                <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                  <div className="text-sm font-medium text-zinc-200">分析策略参数</div>
                  <p className="mt-1 text-xs text-zinc-400">
                    这些参数会在下一次分析时即时生效，用于控制速度、深度和成本。
                  </p>
                </section>
                <div className="grid gap-3 md:grid-cols-2">
                  {renderInput({
                    key: "AI_MAX_RECURSION_DEPTH",
                    label: "最大递归深度",
                    description: "函数下钻分析允许的最大层级。",
                    type: "number",
                  })}
                  {renderInput({
                    key: "AI_MAX_ENTRY_FILE_CANDIDATES",
                    label: "入口候选数量",
                    description: "入口文件候选的最大数量。",
                    type: "number",
                  })}
                  {renderInput({
                    key: "AI_MAX_DRILLDOWN_PER_LEVEL",
                    label: "每层下钻数量",
                    description: "每一层最多继续深入分析的函数数量。",
                    type: "number",
                  })}
                  {renderInput({
                    key: "AI_MAX_ANALYSIS_NODES",
                    label: "总分析节点上限",
                    description: "单次工作流允许展开的最大函数节点数。",
                    type: "number",
                  })}
                  {renderInput({
                    key: "AI_MAX_HEURISTIC_SEARCH_FILES",
                    label: "启发式搜索文件数",
                    description: "函数定位时启发式搜索的文件范围。",
                    type: "number",
                  })}
                  {renderInput({
                    key: "AI_MAX_PROJECT_SEARCH_FILES",
                    label: "项目级搜索文件数",
                    description: "全局扫描函数定义时的文件范围上限。",
                    type: "number",
                  })}
                  {renderInput({
                    key: "AI_MAX_INDEX_FILES",
                    label: "索引预热文件数",
                    description: "预建本地函数索引时最多扫描的文件数。",
                    type: "number",
                  })}
                  {renderInput({
                    key: "AI_INDEX_CONCURRENCY",
                    label: "索引并发数",
                    description: "函数索引构建阶段的并发度。",
                    type: "number",
                  })}
                </div>
              </div>
            )}

            {activeTab === "github" && (
              <div className="space-y-4">
                <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-zinc-200">GitHub 访问设置</div>
                      <p className="mt-1 text-xs text-zinc-400">
                        支持运行中更新 Token，新请求会立刻使用最新值。
                      </p>
                    </div>
                    <a
                      href="https://github.com/settings/tokens/new?description=CodeAnalyzer&scopes=repo"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"
                    >
                      获取 GitHub Token <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </section>

                <div className="grid gap-3 md:grid-cols-2">
                  {renderInput({
                    key: "GITHUB_TOKEN",
                    label: "GITHUB_TOKEN",
                    description: "优先使用该字段进行 GitHub API 鉴权。",
                    secret: true,
                    placeholder: "ghp_xxx",
                  })}
                  {renderInput({
                    key: "GITHUB_PAT",
                    label: "GITHUB_PAT（兼容）",
                    description: "历史兼容字段；当 GITHUB_TOKEN 为空时作为回退。",
                    secret: true,
                    placeholder: "ghp_xxx",
                  })}
                  {renderInput({
                    key: "APP_URL",
                    label: "应用地址",
                    description: "用于页面分享、回调或外部链接拼接等场景，不填则沿用当前访问地址。",
                    placeholder: "http://localhost:3000",
                  })}
                </div>
              </div>
            )}

            {activeTab === "docs" && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-300">
                  <p>常用文档入口：</p>
                  <div className="mt-3 grid gap-2">
                    <a
                      className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
                      href="https://platform.openai.com/docs/api-reference/chat"
                      target="_blank"
                      rel="noreferrer"
                    >
                      OpenAI Chat Completions 文档 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <a
                      className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
                      href="https://platform.openai.com/docs/models"
                      target="_blank"
                      rel="noreferrer"
                    >
                      OpenAI Models 文档 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <a
                      className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
                      href="https://open.bigmodel.cn/dev/howuse/model"
                      target="_blank"
                      rel="noreferrer"
                    >
                      智谱 GLM 文档 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <a
                      className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
                      href="https://api-docs.deepseek.com/zh-cn/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      DeepSeek 文档 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <a
                      className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
                      href="https://docs.siliconflow.cn/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      SiliconFlow 文档 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <a
                      className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
                      href="https://docs.github.com/zh/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens"
                      target="_blank"
                      rel="noreferrer"
                    >
                      GitHub Token 文档 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/80 px-6 py-4">
          <div className="text-xs text-zinc-400">
            {saveMessage || (isDirty ? "有未应用的配置修改。" : "当前配置已同步。")}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200 hover:border-zinc-600"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              恢复 .env
            </button>
            <button
              type="button"
              onClick={() => handleSave(false)}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-500/30"
            >
              <Sparkles className="h-3.5 w-3.5" />
              仅应用
            </button>
            <button
              type="button"
              onClick={() => handleSave(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-medium text-zinc-950 hover:bg-emerald-400"
            >
              <Save className="h-3.5 w-3.5" />
              应用并关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
