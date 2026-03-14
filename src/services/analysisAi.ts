type JsonRecord = Record<string, unknown>;

const DEFAULT_MODEL =
  process.env.AI_MODEL ||
  process.env.GEMINI_MODEL ||
  'gemini-2.5-flash';

const DEFAULT_BASE_URL =
  process.env.GEMINIBASE_URL ||
  process.env.GEMINI_BASE_URL ||
  'https://generativelanguage.googleapis.com/v1beta/openai';

const DEFAULT_API_KEY =
  process.env.AI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  '';

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

function getAiConfig(): AiRuntimeConfig {
  const apiKey = DEFAULT_API_KEY.trim();
  const model = DEFAULT_MODEL.trim();
  const baseUrl = DEFAULT_BASE_URL.trim();
  const endpoint = normalizeBaseUrl(baseUrl);

  if (!apiKey) {
    throw new Error('Missing AI API key. Set AI_API_KEY or GEMINI_API_KEY in your .env file.');
  }

  if (!baseUrl) {
    throw new Error('Missing AI base URL. Set GEMINIBASE_URL in your .env file.');
  }

  if (!model) {
    throw new Error('Missing AI model. Set AI_MODEL in your .env file.');
  }

  return { apiKey, model, baseUrl, endpoint };
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

async function callAiJson<T>(
  prompt: string
): Promise<{ analysis: T | null; requestPayload: JsonRecord; responseText: string | null }> {
  const { apiKey, model, baseUrl, endpoint } = getAiConfig();

  const requestPayload: JsonRecord = {
    endpoint,
    model,
    baseUrl,
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

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: requestPayload.messages,
      temperature: requestPayload.temperature,
    }),
  });

  const rawBody = await response.text();

  if (!response.ok) {
    let message = rawBody;

    try {
      const parsed = JSON.parse(rawBody) as ChatCompletionResponse;
      message = parsed.error?.message || rawBody;
    } catch {
      // Keep the raw response body when it is not JSON.
    }

    throw new Error(`AI request failed (${response.status}): ${message}`);
  }

  let completion: ChatCompletionResponse;
  try {
    completion = JSON.parse(rawBody) as ChatCompletionResponse;
  } catch {
    throw new Error('AI endpoint did not return valid JSON.');
  }

  const responseText = extractTextContent(completion.choices?.[0]?.message?.content);

  if (!responseText) {
    throw new Error('AI endpoint returned an empty completion.');
  }

  try {
    const jsonText = extractJsonObject(responseText);
    return {
      analysis: JSON.parse(jsonText) as T,
      requestPayload,
      responseText,
    };
  } catch (error) {
    console.error('Failed to parse AI JSON response:', error);
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
    '  "reason": "Use Simplified Chinese to explain why this file is or is not the true project entry file."',
    '}',
    '',
    'Rules:',
    '- Use Simplified Chinese for reason.',
    '- Files such as AndroidManifest.xml, package.json, pom.xml, build.gradle, settings.gradle, Cargo.toml, .env, lock files, and bundler/config files are usually not real runtime entry files.',
    '- A real entry file should usually contain the actual startup code, main function, bootstrap logic, route mounting, application initialization, or process launch flow.',
  ].join('\n');

  try {
    return await callAiJson<EntryFileAnalysis>(prompt);
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
    '- Return at most 10 child functions.',
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
  allFiles: string[]
): Promise<{ analysis: EntryFunctionAnalysis | null; requestPayload: JsonRecord; responseText: string | null }> {
  return analyzeFunctionImplementation({
    repoUrl,
    summary,
    functionName: 'entry function',
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
    return await callAiJson<EntryFunctionAnalysis>(prompt);
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
    return await callAiJson<FunctionFileGuess>(prompt);
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
    '- entryFiles should list only the most likely entry files.',
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
    return await callAiJson<ProjectAnalysis>(prompt);
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
