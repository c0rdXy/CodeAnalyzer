import { getRuntimeConfig } from '../utils/runtimeConfig';

type JsonRecord = Record<string, unknown>;
type AiOperation = 'project' | 'entry' | 'function' | 'file_guess' | 'module';

const FALLBACK_MODEL = 'gemini-2.5-flash';
const FALLBACK_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const FALLBACK_TIMEOUT_MS = 60000;
const FALLBACK_MAX_OUTPUT_TOKENS = 2000;

function parseBoolean(value: string, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  return value.trim().toLowerCase() !== 'false';
}

function parseNumberWithMin(value: string, fallback: number, min: number): number {
  const parsed = Number(value || '');
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return Math.floor(parsed);
}

export interface ProjectAnalysis {
  mainLanguages: string[];
  techStack: string[];
  entryFiles: string[];
  summary: string;
}

export interface AIAnalysisResult {
  analysis: ProjectAnalysis | null;
  requestPayload?: JsonRecord;
  responseText?: string | null;
}

export interface EntryFileAnalysis {
  isEntryFile: boolean;
  reason: string;
  entryFunctionName?: string;
  entryFunctionReason?: string;
}

export interface SubFunctionAnalysis {
  name: string;
  file: string;
  description: string;
  drillDown: -1 | 0 | 1;
  children?: SubFunctionAnalysis[];
  stopReason?: string;
  resolvedFile?: string;
  resolvedSnippet?: string;
}

export interface EntryFunctionAnalysis {
  entryFunctionName: string;
  summary?: string;
  shouldStop?: boolean;
  stopReason?: string;
  subFunctions: SubFunctionAnalysis[];
}

export interface FunctionFileGuess {
  candidateFiles: string[];
  reason: string;
  isProjectFunction: boolean;
}

export interface ModuleFunctionNodeInput {
  nodeId: string;
  functionName: string;
  description: string;
  filePath?: string;
  parentNodeId?: string;
}

export interface FunctionModuleGroup {
  moduleId: string;
  moduleName: string;
  description: string;
  functionNodeIds: string[];
}

export interface FunctionModuleAnalysis {
  modules: FunctionModuleGroup[];
}

interface AiRuntimeConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  endpoint: string;
  useStream: boolean;
  enableThinking: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
}

interface CallAiOptions {
  operation: AiOperation;
  enableThinking?: boolean;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
      reasoning_content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

const SYSTEM_PROMPT =
  'You are a senior software architect and code analysis expert. Always answer in Simplified Chinese. Return valid JSON only and never wrap JSON in markdown code fences.';

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }

  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }

  return `${trimmed}/chat/completions`;
}

function resolveModelByOperation(operation: AiOperation): string {
  const runtime = getRuntimeConfig();
  const defaultModel = (runtime.AI_MODEL || runtime.AI_MODEL_FAST || FALLBACK_MODEL).trim();

  if (operation === 'project') {
    return (runtime.AI_MODEL_PROJECT || runtime.AI_MODEL_FAST || defaultModel).trim();
  }
  if (operation === 'entry') {
    return (runtime.AI_MODEL_ENTRY || runtime.AI_MODEL_FAST || defaultModel).trim();
  }
  if (operation === 'file_guess') {
    return (runtime.AI_MODEL_FILE_GUESS || runtime.AI_MODEL_FAST || defaultModel).trim();
  }
  if (operation === 'module') {
    return (runtime.AI_MODEL_MODULE || runtime.AI_MODEL_FAST || defaultModel).trim();
  }
  return (runtime.AI_MODEL_FUNCTION || defaultModel).trim();
}

function getAiConfig(options: CallAiOptions): AiRuntimeConfig {
  const runtime = getRuntimeConfig();
  const apiKey = (runtime.AI_API_KEY || runtime.GEMINI_API_KEY || runtime.OPENAI_API_KEY || '').trim();
  const model = resolveModelByOperation(options.operation);
  const baseUrl = (runtime.GEMINIBASE_URL || runtime.GEMINI_BASE_URL || FALLBACK_BASE_URL).trim();
  const endpoint = normalizeBaseUrl(baseUrl);
  const useStream = parseBoolean(runtime.AI_USE_STREAM || 'true', true);
  const thinkingEnabledByConfig = (runtime.AI_ENABLE_THINKING || '').trim().toLowerCase() === 'true';
  const enableThinking = options.enableThinking ?? thinkingEnabledByConfig;
  const timeoutMs = parseNumberWithMin(runtime.AI_REQUEST_TIMEOUT_MS || '', FALLBACK_TIMEOUT_MS, 1000);
  const maxOutputTokens = parseNumberWithMin(
    runtime.AI_MAX_OUTPUT_TOKENS || '',
    FALLBACK_MAX_OUTPUT_TOKENS,
    256
  );

  if (!apiKey) {
    throw new Error('Missing AI API key. Set AI_API_KEY or GEMINI_API_KEY in your .env file.');
  }

  if (!baseUrl) {
    throw new Error('Missing AI base URL. Set GEMINIBASE_URL in your .env file.');
  }

  if (!model) {
    throw new Error('Missing AI model. Set AI_MODEL in your .env file.');
  }

  return {
    apiKey,
    model,
    baseUrl,
    endpoint,
    useStream,
    enableThinking,
    timeoutMs,
    maxOutputTokens,
  };
}

function extractTextContent(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

function extractJsonObject(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('AI response is empty.');
  }

  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');

  if (objectStart === -1 || objectEnd === -1 || objectEnd < objectStart) {
    throw new Error('AI response does not contain a JSON object.');
  }

  return trimmed.slice(objectStart, objectEnd + 1);
}

async function readChatCompletionStream(response: Response): Promise<string> {
  if (!response.body) {
    throw new Error('AI endpoint returned an empty stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      const lines = event
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'));

      for (const line of lines) {
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') {
          continue;
        }

        const chunk = JSON.parse(payload) as ChatCompletionChunk;
        const delta = chunk.choices?.[0]?.delta;
        content += extractTextContent(delta?.content);
      }
    }
  }

  const tail = buffer.trim();
  if (tail.startsWith('data:')) {
    const payload = tail.slice(5).trim();
    if (payload && payload !== '[DONE]') {
      const chunk = JSON.parse(payload) as ChatCompletionChunk;
      content += extractTextContent(chunk.choices?.[0]?.delta?.content);
    }
  }

  return content;
}

async function callAiJson<T>(
  prompt: string,
  options: CallAiOptions
): Promise<{ analysis: T | null; requestPayload: JsonRecord; responseText: string | null }> {
  const { apiKey, model, baseUrl, endpoint, useStream, enableThinking, timeoutMs, maxOutputTokens } = getAiConfig(options);
  const startedAt = Date.now();

  const requestPayload: JsonRecord = {
    operation: options.operation,
    endpoint,
    model,
    baseUrl,
    promptLength: prompt.length,
    stream: useStream,
    thinkingEnabled: enableThinking,
    timeoutMs,
    maxOutputTokens,
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.1,
  };

  const sendRequest = async (thinkingEnabled: boolean, streamEnabled: boolean) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const requestBody: Record<string, unknown> = {
      model,
      messages: requestPayload.messages,
      temperature: requestPayload.temperature,
      stream: streamEnabled,
      max_tokens: maxOutputTokens,
    };

    if (thinkingEnabled) {
      requestBody.extra_body = {
        thinking: {
          type: 'enabled',
        },
      };
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const rawBody = await response.text();
        let message = rawBody;

        try {
          const parsed = JSON.parse(rawBody) as ChatCompletionResponse;
          message = parsed.error?.message || rawBody;
        } catch {
          // Keep the raw response body when it is not JSON.
        }

        throw new Error(`AI request failed (${response.status}): ${message}`);
      }

      if (streamEnabled) {
        return await readChatCompletionStream(response);
      }

      const rawBody = await response.text();
      let completion: ChatCompletionResponse;
      try {
        completion = JSON.parse(rawBody) as ChatCompletionResponse;
      } catch {
        throw new Error('AI endpoint did not return valid JSON.');
      }

      return extractTextContent(completion.choices?.[0]?.message?.content);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`AI request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  let responseText = '';
  try {
    responseText = await sendRequest(enableThinking, useStream);
  } catch (error) {
    if (
      enableThinking &&
      error instanceof Error &&
      /(thinking|extra_body|unsupported|invalid_parameter|unknown parameter)/i.test(error.message)
    ) {
      requestPayload.thinkingFallback = true;
      responseText = await sendRequest(false, useStream);
    } else {
      throw error;
    }
  }

  if (!responseText) {
    if (useStream) {
      requestPayload.streamFallback = true;
      responseText = await sendRequest(enableThinking, false);
    }
  }

  if (!responseText) {
    if (enableThinking) {
      requestPayload.thinkingFallbackAfterEmpty = true;
      responseText = await sendRequest(false, false);
    }
  }

  if (!responseText) {
    throw new Error('AI endpoint returned an empty completion.');
  }

  try {
    const jsonText = extractJsonObject(responseText);
    requestPayload.durationMs = Date.now() - startedAt;
    requestPayload.responseLength = responseText.length;
    return {
      analysis: JSON.parse(jsonText) as T,
      requestPayload,
      responseText,
    };
  } catch (error) {
    console.error('Failed to parse AI JSON response:', error);
    requestPayload.durationMs = Date.now() - startedAt;
    requestPayload.responseLength = responseText.length;
    return {
      analysis: null,
      requestPayload,
      responseText,
    };
  }
}

export async function analyzeEntryFile(
  repoUrl: string,
  summary: string,
  languages: string[],
  filePath: string,
  fileContent: string
): Promise<{ analysis: EntryFileAnalysis | null; requestPayload: JsonRecord; responseText: string | null }> {
  const prompt = [
    'Please determine whether the following file is the real entry file of the project.',
    '',
    `Repository URL: ${repoUrl}`,
    `Project summary: ${summary}`,
    `Main languages: ${languages.join(', ')}`,
    '',
    `Candidate file path: ${filePath}`,
    'Candidate file content:',
    '```',
    fileContent,
    '```',
    '',
    'Return JSON only in this shape:',
    '{',
    '  "isEntryFile": true,',
    '  "reason": "Use Simplified Chinese to explain why this file is or is not the true project entry file.",',
    '  "entryFunctionName": "If this is a real entry file, return the most likely entry function name; otherwise return an empty string.",',
    '  "entryFunctionReason": "Use Simplified Chinese to explain how you inferred the entry function, or why it cannot be determined."',
    '}',
    '',
    'Rules:',
    '- Use Simplified Chinese for reason.',
    '- Use Simplified Chinese for entryFunctionReason.',
    '- Files such as AndroidManifest.xml, package.json, pom.xml, build.gradle, settings.gradle, Cargo.toml, .env, lock files, and bundler/config files are usually not real runtime entry files.',
    '- A real entry file should usually contain the actual startup code, main function, bootstrap logic, route mounting, application initialization, or process launch flow.',
    '- If the entry logic is file-level bootstrap code rather than a named function, return an empty entryFunctionName and explain that in entryFunctionReason.',
  ].join('\n');

  try {
    return await callAiJson<EntryFileAnalysis>(prompt, {
      operation: 'entry',
      enableThinking: false,
    });
  } catch (error) {
    console.error('AI entry-file analysis failed:', error);
    return {
      analysis: null,
      requestPayload: {
        error: String(error),
        operation: 'analyzeEntryFile',
      },
      responseText: String(error),
    };
  }
}

function buildFunctionAnalysisPrompt(input: {
  repoUrl: string;
  summary: string;
  functionName: string;
  filePath: string;
  functionCode: string;
  allFiles: string[];
  parentFunctionName?: string;
  depth?: number;
}): string {
  return [
    'Analyze the following project function and identify the most important child functions it calls.',
    '',
    `Repository URL: ${input.repoUrl}`,
    `Project summary: ${input.summary}`,
    `Current function name: ${input.functionName}`,
    `Current function file: ${input.filePath}`,
    input.parentFunctionName ? `Parent function name: ${input.parentFunctionName}` : '',
    typeof input.depth === 'number' ? `Current drill-down depth: ${input.depth}` : '',
    'Project file list:',
    input.allFiles.slice(0, 1000).join('\n'),
    '',
    'Current function code:',
    '```',
    input.functionCode,
    '```',
    '',
    'Return JSON only in this shape:',
    '{',
    '  "entryFunctionName": "current function name",',
    '  "summary": "Use Simplified Chinese to summarize this function in 1-2 sentences.",',
    '  "shouldStop": false,',
    '  "stopReason": "If shouldStop is true, explain the reason in Simplified Chinese.",',
    '  "subFunctions": [',
    '    {',
    '      "name": "child function name (method should include class name, for example ClassName::methodName)",',
      '      "file": "most likely project file path, or empty string if unknown",',
      '      "description": "Use Simplified Chinese to explain what this child function does.",',
      '      "drillDown": 1',
    '    }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Use Simplified Chinese for summary, stopReason, and description.',
    '- Return at most 6 child functions.',
    '- Only keep the truly critical child functions that are necessary to understand the main execution flow.',
    '- Do not return trivial helper calls such as common data-structure operations, string formatting/parsing, logging, simple getters/setters, or shallow data conversion unless they directly decide core control flow.',
    '- Prefer child functions that represent business orchestration, external I/O boundaries, state transition, permission/auth decision, transaction/persistence, or key protocol flow.',
    '- For object-oriented languages, methods must include class-qualified names when possible.',
    '- For C/C++, use ClassName::FunctionName (or Namespace::ClassName::FunctionName if known).',
    '- For Java/C#/Kotlin, prefer ClassName.methodName.',
    '- Use drillDown = 1 only for functions that are highly likely to deserve continued drill-down analysis.',
    '- Use drillDown = 0 sparingly for borderline cases.',
    '- drillDown must be -1, 0, or 1.',
    '- Mark drillDown as -1 for library functions, system functions, or obviously non-core functions.',
    '- Set shouldStop to true when the current function is not worth drilling into further.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function analyzeSubFunctions(
  repoUrl: string,
  summary: string,
  entryFilePath: string,
  entryFileContent: string,
  allFiles: string[],
  entryFunctionName?: string
): Promise<{ analysis: EntryFunctionAnalysis | null; requestPayload: JsonRecord; responseText: string | null }> {
  return analyzeFunctionImplementation({
    repoUrl,
    summary,
    functionName: entryFunctionName || 'entry function',
    filePath: entryFilePath,
    functionCode: entryFileContent,
    allFiles,
  });
}

export async function analyzeFunctionImplementation(input: {
  repoUrl: string;
  summary: string;
  functionName: string;
  filePath: string;
  functionCode: string;
  allFiles: string[];
  parentFunctionName?: string;
  depth?: number;
}): Promise<{ analysis: EntryFunctionAnalysis | null; requestPayload: JsonRecord; responseText: string | null }> {
  const prompt = buildFunctionAnalysisPrompt(input);

  try {
    return await callAiJson<EntryFunctionAnalysis>(prompt, {
      operation: 'function',
      enableThinking: true,
    });
  } catch (error) {
    console.error('AI function analysis failed:', error);
    return {
      analysis: null,
      requestPayload: {
        error: String(error),
        operation: 'analyzeFunctionImplementation',
        functionName: input.functionName,
      },
      responseText: String(error),
    };
  }
}

export async function guessFunctionFiles(input: {
  repoUrl: string;
  summary: string;
  functionName: string;
  allFiles: string[];
  parentFunctionName?: string;
  parentFilePath?: string;
  hintedFilePath?: string;
}): Promise<{ analysis: FunctionFileGuess | null; requestPayload: JsonRecord; responseText: string | null }> {
  const prompt = [
    'Estimate which project files are the most likely place to define the target function.',
    '',
    `Repository URL: ${input.repoUrl}`,
    `Project summary: ${input.summary}`,
    `Target function name: ${input.functionName}`,
    input.parentFunctionName ? `Parent function name: ${input.parentFunctionName}` : '',
    input.parentFilePath ? `Parent file path: ${input.parentFilePath}` : '',
    input.hintedFilePath ? `Existing hinted file path: ${input.hintedFilePath}` : '',
    '',
    'Project file list:',
    input.allFiles.slice(0, 1000).join('\n'),
    '',
    'Return JSON only in this shape:',
    '{',
    '  "candidateFiles": ["src/example.ts", "src/foo/bar.py"],',
    '  "reason": "Use Simplified Chinese to explain the guess.",',
    '  "isProjectFunction": true',
    '}',
    '',
    'Rules:',
    '- Return at most 5 candidate files.',
    '- Prefer real project files from the provided list.',
    '- Set isProjectFunction to false for obvious system or third-party library functions.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    return await callAiJson<FunctionFileGuess>(prompt, {
      operation: 'file_guess',
      enableThinking: false,
    });
  } catch (error) {
    console.error('AI function file guess failed:', error);
    return {
      analysis: null,
      requestPayload: {
        error: String(error),
        operation: 'guessFunctionFiles',
        functionName: input.functionName,
      },
      responseText: String(error),
    };
  }
}

export async function analyzeProjectFiles(files: string[]): Promise<AIAnalysisResult> {
  const prompt = [
    'Analyze the following repository file list and infer the overall project profile.',
    '',
    'Project file paths:',
    files.join('\n'),
    '',
    'Return JSON only in this shape:',
    '{',
    '  "mainLanguages": ["TypeScript", "Python"],',
    '  "techStack": ["React", "Vite", "Express"],',
    '  "entryFiles": ["src/main.tsx", "server/index.ts"],',
    '  "summary": "Use 1-2 sentences of Simplified Chinese to summarize the project."',
    '}',
    '',
    'Rules:',
    '- summary must be in Simplified Chinese.',
    '- mainLanguages and techStack can keep English technical names.',
    '- entryFiles should list only the most likely entry files, ideally no more than 3.',
    '- Do not treat manifest, package manager, build, config, lock, or descriptor files as runtime entry files.',
    '- AndroidManifest.xml, package.json, pom.xml, build.gradle, settings.gradle, Cargo.toml, go.mod, and .env are usually not entry files.',
  ].join('\n');

  if (!files || files.length === 0) {
    console.warn('No files were provided for AI analysis.');
    return {
      analysis: null,
      requestPayload: { operation: 'analyzeProjectFiles' },
      responseText: null,
    };
  }

  try {
    return await callAiJson<ProjectAnalysis>(prompt, {
      operation: 'project',
      enableThinking: false,
    });
  } catch (error) {
    console.error('AI project analysis failed:', error);
    return {
      analysis: null,
      requestPayload: {
        error: String(error),
        operation: 'analyzeProjectFiles',
      },
      responseText: String(error),
    };
  }
}

export async function analyzeFunctionModules(input: {
  repoUrl: string;
  summary: string;
  mainLanguages: string[];
  techStack: string[];
  functionNodes: ModuleFunctionNodeInput[];
}): Promise<{ analysis: FunctionModuleAnalysis | null; requestPayload: JsonRecord; responseText: string | null }> {
  const functionNodeList = input.functionNodes
    .slice(0, 200)
    .map((node) =>
      [
        `nodeId: ${node.nodeId}`,
        `functionName: ${node.functionName}`,
        `description: ${node.description || '暂无描述'}`,
        `filePath: ${node.filePath || '未知文件'}`,
        `parentNodeId: ${node.parentNodeId || '无'}`,
      ].join(' | ')
    )
    .join('\n');

  const prompt = [
    'Please group the following analyzed function nodes into business modules.',
    '',
    `Repository URL: ${input.repoUrl}`,
    `Project summary: ${input.summary}`,
    `Main languages: ${input.mainLanguages.join(', ')}`,
    `Tech stack: ${input.techStack.join(', ')}`,
    '',
    'Function node list:',
    functionNodeList,
    '',
    'Return JSON only in this shape:',
    '{',
    '  "modules": [',
    '    {',
    '      "moduleId": "module-auth",',
    '      "moduleName": "用户认证模块",',
    '      "description": "该模块负责登录、鉴权与会话管理",',
    '      "functionNodeIds": ["root", "node-0", "node-0-1"]',
    '    }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- module count must be between 1 and 10.',
    '- moduleName and description must be Simplified Chinese.',
    '- Every function node must belong to exactly one module.',
    '- functionNodeIds must use nodeId from the given list only.',
    '- Prefer meaningful, business-oriented module boundaries instead of purely technical layering.',
  ].join('\n');

  try {
    return await callAiJson<FunctionModuleAnalysis>(prompt, {
      operation: 'module',
      enableThinking: false,
    });
  } catch (error) {
    console.error('AI module analysis failed:', error);
    return {
      analysis: null,
      requestPayload: {
        error: String(error),
        operation: 'analyzeFunctionModules',
      },
      responseText: String(error),
    };
  }
}
