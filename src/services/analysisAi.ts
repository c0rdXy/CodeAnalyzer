type JsonRecord = Record<string, unknown>;
type AiOperation = 'project' | 'entry' | 'function' | 'file_guess';

const DEFAULT_MODEL =
  process.env.AI_MODEL ||
  process.env.GEMINI_MODEL ||
  'gemini-2.5-flash';

const DEFAULT_PROJECT_MODEL =
  process.env.AI_MODEL_PROJECT ||
  process.env.AI_MODEL_FAST ||
  DEFAULT_MODEL;

const DEFAULT_ENTRY_MODEL =
  process.env.AI_MODEL_ENTRY ||
  process.env.AI_MODEL_FAST ||
  DEFAULT_MODEL;

const DEFAULT_FUNCTION_MODEL =
  process.env.AI_MODEL_FUNCTION ||
  DEFAULT_MODEL;

const DEFAULT_FILE_GUESS_MODEL =
  process.env.AI_MODEL_FILE_GUESS ||
  process.env.AI_MODEL_FAST ||
  DEFAULT_MODEL;

const DEFAULT_BASE_URL =
  process.env.GEMINIBASE_URL ||
  process.env.GEMINI_BASE_URL ||
  'https://generativelanguage.googleapis.com/v1beta/openai';

const DEFAULT_API_KEY =
  process.env.AI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  '';

const DEFAULT_USE_STREAM =
  (process.env.AI_USE_STREAM || 'true').trim().toLowerCase() !== 'false';

const DEFAULT_ENABLE_THINKING =
  (process.env.AI_ENABLE_THINKING || 'false').trim().toLowerCase() === 'true';

const DEFAULT_REQUEST_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.AI_REQUEST_TIMEOUT_MS || '60000');
  if (!Number.isFinite(parsed) || parsed < 1000) {
    return 60000;
  }
  return Math.floor(parsed);
})();

const DEFAULT_MAX_OUTPUT_TOKENS = (() => {
  const parsed = Number(process.env.AI_MAX_OUTPUT_TOKENS || '2000');
  if (!Number.isFinite(parsed) || parsed < 256) {
    return 2000;
  }
  return Math.floor(parsed);
})();

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
  if (operation === 'project') {
    return DEFAULT_PROJECT_MODEL.trim();
  }
  if (operation === 'entry') {
    return DEFAULT_ENTRY_MODEL.trim();
  }
  if (operation === 'file_guess') {
    return DEFAULT_FILE_GUESS_MODEL.trim();
  }
  return DEFAULT_FUNCTION_MODEL.trim();
}

function getAiConfig(options: CallAiOptions): AiRuntimeConfig {
  const apiKey = DEFAULT_API_KEY.trim();
  const model = resolveModelByOperation(options.operation);
  const baseUrl = DEFAULT_BASE_URL.trim();
  const endpoint = normalizeBaseUrl(baseUrl);
  const useStream = DEFAULT_USE_STREAM;
  const enableThinking = options.enableThinking ?? DEFAULT_ENABLE_THINKING;

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
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
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

  const sendRequest = async (thinkingEnabled: boolean) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const requestBody: Record<string, unknown> = {
      model,
      messages: requestPayload.messages,
      temperature: requestPayload.temperature,
      stream: useStream,
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

      if (useStream) {
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
    responseText = await sendRequest(enableThinking);
  } catch (error) {
    if (
      enableThinking &&
      error instanceof Error &&
      /(thinking|extra_body|unsupported|invalid_parameter|unknown parameter)/i.test(error.message)
    ) {
      requestPayload.thinkingFallback = true;
      responseText = await sendRequest(false);
    } else {
      throw error;
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
    '      "name": "child function name",',
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
