export const RUNTIME_CONFIG_UPDATED_EVENT = 'code_analyzer_runtime_config_updated';
const STORAGE_KEY = 'code_analyzer_runtime_config_overrides_v1';

export const RUNTIME_CONFIG_KEYS = [
  'AI_PROVIDER',
  'AI_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'GEMINIBASE_URL',
  'GEMINI_BASE_URL',
  'AI_MODEL',
  'AI_MODEL_FAST',
  'AI_MODEL_PROJECT',
  'AI_MODEL_ENTRY',
  'AI_MODEL_FILE_GUESS',
  'AI_MODEL_FUNCTION',
  'AI_MODEL_MODULE',
  'AI_USE_STREAM',
  'AI_ENABLE_THINKING',
  'AI_MAX_OUTPUT_TOKENS',
  'AI_REQUEST_TIMEOUT_MS',
  'AI_MAX_RECURSION_DEPTH',
  'AI_MAX_ENTRY_FILE_CANDIDATES',
  'AI_MAX_DRILLDOWN_PER_LEVEL',
  'AI_MAX_ANALYSIS_NODES',
  'AI_MAX_HEURISTIC_SEARCH_FILES',
  'AI_MAX_PROJECT_SEARCH_FILES',
  'AI_MAX_INDEX_FILES',
  'AI_INDEX_CONCURRENCY',
  'GITHUB_TOKEN',
  'GITHUB_PAT',
  'APP_URL',
] as const;

export type RuntimeConfigKey = (typeof RUNTIME_CONFIG_KEYS)[number];
export type RuntimeConfig = Record<RuntimeConfigKey, string>;

function readEnvConfig(): RuntimeConfig {
  return {
    AI_PROVIDER: (process.env.AI_PROVIDER || '').trim(),
    AI_API_KEY: (process.env.AI_API_KEY || '').trim(),
    GEMINI_API_KEY: (process.env.GEMINI_API_KEY || '').trim(),
    OPENAI_API_KEY: (process.env.OPENAI_API_KEY || '').trim(),
    GEMINIBASE_URL: (process.env.GEMINIBASE_URL || '').trim(),
    GEMINI_BASE_URL: (process.env.GEMINI_BASE_URL || '').trim(),
    AI_MODEL: (process.env.AI_MODEL || '').trim(),
    AI_MODEL_FAST: (process.env.AI_MODEL_FAST || '').trim(),
    AI_MODEL_PROJECT: (process.env.AI_MODEL_PROJECT || '').trim(),
    AI_MODEL_ENTRY: (process.env.AI_MODEL_ENTRY || '').trim(),
    AI_MODEL_FILE_GUESS: (process.env.AI_MODEL_FILE_GUESS || '').trim(),
    AI_MODEL_FUNCTION: (process.env.AI_MODEL_FUNCTION || '').trim(),
    AI_MODEL_MODULE: (process.env.AI_MODEL_MODULE || '').trim(),
    AI_USE_STREAM: (process.env.AI_USE_STREAM || '').trim(),
    AI_ENABLE_THINKING: (process.env.AI_ENABLE_THINKING || '').trim(),
    AI_MAX_OUTPUT_TOKENS: (process.env.AI_MAX_OUTPUT_TOKENS || '').trim(),
    AI_REQUEST_TIMEOUT_MS: (process.env.AI_REQUEST_TIMEOUT_MS || '').trim(),
    AI_MAX_RECURSION_DEPTH: (process.env.AI_MAX_RECURSION_DEPTH || '').trim(),
    AI_MAX_ENTRY_FILE_CANDIDATES: (process.env.AI_MAX_ENTRY_FILE_CANDIDATES || '').trim(),
    AI_MAX_DRILLDOWN_PER_LEVEL: (process.env.AI_MAX_DRILLDOWN_PER_LEVEL || '').trim(),
    AI_MAX_ANALYSIS_NODES: (process.env.AI_MAX_ANALYSIS_NODES || '').trim(),
    AI_MAX_HEURISTIC_SEARCH_FILES: (process.env.AI_MAX_HEURISTIC_SEARCH_FILES || '').trim(),
    AI_MAX_PROJECT_SEARCH_FILES: (process.env.AI_MAX_PROJECT_SEARCH_FILES || '').trim(),
    AI_MAX_INDEX_FILES: (process.env.AI_MAX_INDEX_FILES || '').trim(),
    AI_INDEX_CONCURRENCY: (process.env.AI_INDEX_CONCURRENCY || '').trim(),
    GITHUB_TOKEN: (process.env.GITHUB_TOKEN || '').trim(),
    GITHUB_PAT: (process.env.GITHUB_PAT || '').trim(),
    APP_URL: (process.env.APP_URL || '').trim(),
  };
}

function readOverrides(): Partial<RuntimeConfig> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Partial<RuntimeConfig> = {};

    for (const key of RUNTIME_CONFIG_KEYS) {
      const value = parsed[key];
      if (typeof value === 'string') {
        next[key] = value.trim();
      }
    }

    // Backward compatibility for legacy settings storage key.
    if (!next.GITHUB_TOKEN) {
      const legacyToken = window.localStorage.getItem('github_pat');
      if (legacyToken) {
        next.GITHUB_TOKEN = legacyToken.trim();
      }
    }

    return next;
  } catch {
    return {};
  }
}

function writeOverrides(nextOverrides: Partial<RuntimeConfig>) {
  if (typeof window === 'undefined') {
    return;
  }

  const compacted: Partial<RuntimeConfig> = {};
  for (const key of RUNTIME_CONFIG_KEYS) {
    const value = nextOverrides[key];
    if (typeof value === 'string') {
      compacted[key] = value.trim();
    }
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compacted));
}

export function getRuntimeConfig(): RuntimeConfig {
  const env = readEnvConfig();
  const overrides = readOverrides();
  return {
    ...env,
    ...overrides,
  };
}

export function saveRuntimeConfigOverrides(next: Partial<RuntimeConfig>) {
  const current = readOverrides();
  writeOverrides({
    ...current,
    ...next,
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(RUNTIME_CONFIG_UPDATED_EVENT));
  }
}

export function clearRuntimeConfigOverrides() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem('github_pat');
    window.dispatchEvent(new Event(RUNTIME_CONFIG_UPDATED_EVENT));
  }
}
