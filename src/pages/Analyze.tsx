import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Github, Search, AlertCircle, Loader2, ArrowLeft, Settings, Sparkles, Code2, Layers, FileTerminal, Activity, ChevronDown, ChevronRight, Maximize2, X, CheckCircle, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { parseGithubUrl, fetchRepoInfo, fetchFileTree, fetchFileContent, GithubFileNode, GithubRepoInfo } from '../utils/github';
import FileTree from '../components/FileTree';
import CodeViewer from '../components/CodeViewer';
import SettingsModal from '../components/SettingsModal';
import PanoramaTree from '../components/PanoramaTree';
import {
  analyzeProjectFiles,
  analyzeEntryFile,
  analyzeSubFunctions,
  analyzeFunctionImplementation,
  analyzeFunctionModules,
  guessFunctionFiles,
  FunctionModuleGroup,
  FunctionModuleAnalysis,
  ModuleFunctionNodeInput,
  FunctionFileGuess,
  ProjectAnalysis,
  EntryFunctionAnalysis,
  SubFunctionAnalysis,
} from '../services/analysisAi';
import {
  extractFunctionNamesFromContent,
  findFunctionDefinitionInContent,
  getFunctionNameLookupKeys,
  prioritizeSearchPaths,
  searchFunctionInFiles,
  trimFunctionSnippet,
} from '../utils/functionSearch';
import { detectEntryFunctionCandidate } from '../utils/entryAnalysis';
import {
  AnalysisHistoryItem,
  AnalysisSnapshot,
  getAnalysisHistoryItem,
  saveAnalysisHistory,
} from '../utils/analysisHistory';
import { getRuntimeConfig } from '../utils/runtimeConfig';



interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'error';
  request?: any;
  response?: any;
  fileList?: string[];
}

type LogFilter = 'all' | LogEntry['type'];

interface DrillDownAnalysisCacheEntry {
  analysis: EntryFunctionAnalysis;
  filePath: string;
  functionName: string;
  cachedAt: number;
}

const serializeLogs = (logs: LogEntry[]) =>
  logs.map((log) => ({
    ...log,
    timestamp: log.timestamp.toISOString(),
  }));

const deserializeLogs = (logs: AnalysisSnapshot['logs']): LogEntry[] =>
  logs.map((log) => ({
    ...log,
    timestamp: new Date(log.timestamp),
  }));

type ResizablePanelKey = 'overview' | 'files' | 'source' | 'panorama';

const PANEL_MIN_WIDTHS: Record<ResizablePanelKey, number> = {
  overview: 280,
  files: 240,
  source: 320,
  panorama: 280,
};

const CODE_EXTENSIONS = [
  'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs',
  'rb', 'php', 'swift', 'kt', 'dart', 'sh', 'bash', 'html', 'css', 'scss', 'less',
  'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'graphql', 'vue', 'svelte'
];

const IGNORED_PATH_SEGMENTS = new Set([
  '.idea',
  '.vscode',
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.output',
  '.vercel'
]);

const ENTRY_FILE_BLOCKLIST_PATTERNS = [
  /(^|\/)androidmanifest\.xml$/i,
  /(^|\/)(package|composer|cargo|pom|build|settings|gradle|pnpm-lock|package-lock|yarn-lock|bun\.lock|requirements|pyproject|poetry\.lock|go\.mod|go\.sum|gemfile|podfile)(\.[^/]+)?$/i,
  /(^|\/)(vite|webpack|rollup|tsconfig|jsconfig|babel|eslint|prettier|tailwind|postcss|jest|vitest|cypress|playwright|next|nuxt|metro|capacitor|turbo|nx|lerna|commitlint|stylelint)(\.[^/]+)?$/i,
  /(^|\/)\.env(\.[^/]+)?$/i,
  /(^|\/)(dockerfile|docker-compose|makefile)$/i,
  /(^|\/)(app|src\/main)\/res\//i,
];

const ENTRY_FILE_PRIORITY_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /(^|\/)src\/main\.(tsx|ts|jsx|js)$/i, score: 130 },
  { pattern: /(^|\/)src\/index\.(tsx|ts|jsx|js)$/i, score: 120 },
  { pattern: /(^|\/)main\.(tsx|ts|jsx|js|py|go|rs|java|kt|cpp|c|php|rb|swift)$/i, score: 120 },
  { pattern: /(^|\/)index\.(tsx|ts|jsx|js|php)$/i, score: 100 },
  { pattern: /(^|\/)lib\/main\.dart$/i, score: 125 },
  { pattern: /(^|\/)(__main__|app|server|run)\.py$/i, score: 95 },
  { pattern: /(^|\/)(mainactivity|launcheractivity|appdelegate|scenedelegate|program|startup|bootstrap|application)\.(kt|java|swift|cs)$/i, score: 115 },
  { pattern: /(^|\/).*application\.(kt|java)$/i, score: 105 },
  { pattern: /(^|\/)cmd\/[^/]+\/main\.go$/i, score: 120 },
  { pattern: /(^|\/)server\/main\.go$/i, score: 110 },
  { pattern: /(^|\/)src\/main\/(java|kotlin)\//i, score: 55 },
  { pattern: /(^|\/)app\/src\/main\/(java|kotlin)\//i, score: 60 },
  { pattern: /(^|\/)src\/.*(boot|main|entry|app)\.(ts|tsx|js|jsx|py|go|rs|java|kt|dart|swift|cs)$/i, score: 75 },
];

const DEFAULT_MAX_RECURSION_DEPTH = 2;
const DEFAULT_MAX_ENTRY_FILE_CANDIDATES = 3;
const DEFAULT_MAX_DRILLDOWN_PER_LEVEL = 3;
const DEFAULT_MAX_HEURISTIC_SEARCH_FILES = 24;
const DEFAULT_MAX_PROJECT_SEARCH_FILES = 80;
const DEFAULT_MAX_ANALYSIS_NODES = 12;
const DEFAULT_MAX_INDEX_FILES = 48;
const DEFAULT_INDEX_CONCURRENCY = 4;

const parseIntWithMin = (value: string, fallback: number, min: number) => {
  const parsed = Number(value || '');
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return Math.floor(parsed);
};

const getAnalysisLimits = () => {
  const runtime = getRuntimeConfig();

  return {
    MAX_RECURSION_DEPTH: parseIntWithMin(
      runtime.AI_MAX_RECURSION_DEPTH,
      DEFAULT_MAX_RECURSION_DEPTH,
      0
    ),
    MAX_ENTRY_FILE_CANDIDATES: parseIntWithMin(
      runtime.AI_MAX_ENTRY_FILE_CANDIDATES,
      DEFAULT_MAX_ENTRY_FILE_CANDIDATES,
      1
    ),
    MAX_DRILLDOWN_PER_LEVEL: parseIntWithMin(
      runtime.AI_MAX_DRILLDOWN_PER_LEVEL,
      DEFAULT_MAX_DRILLDOWN_PER_LEVEL,
      1
    ),
    MAX_HEURISTIC_SEARCH_FILES: parseIntWithMin(
      runtime.AI_MAX_HEURISTIC_SEARCH_FILES,
      DEFAULT_MAX_HEURISTIC_SEARCH_FILES,
      1
    ),
    MAX_PROJECT_SEARCH_FILES: parseIntWithMin(
      runtime.AI_MAX_PROJECT_SEARCH_FILES,
      DEFAULT_MAX_PROJECT_SEARCH_FILES,
      1
    ),
    MAX_ANALYSIS_NODES: parseIntWithMin(
      runtime.AI_MAX_ANALYSIS_NODES,
      DEFAULT_MAX_ANALYSIS_NODES,
      1
    ),
    MAX_INDEX_FILES: parseIntWithMin(runtime.AI_MAX_INDEX_FILES, DEFAULT_MAX_INDEX_FILES, 1),
    INDEX_CONCURRENCY: parseIntWithMin(runtime.AI_INDEX_CONCURRENCY, DEFAULT_INDEX_CONCURRENCY, 1),
  };
};

const isAnalyzableCodeFile = (path: string) => {
  const segments = path.split('/');
  const hasIgnoredSegment = segments.some((segment) => IGNORED_PATH_SEGMENTS.has(segment));
  if (hasIgnoredSegment) {
    return false;
  }

  const ext = segments[segments.length - 1].split('.').pop()?.toLowerCase();
  return Boolean(ext && CODE_EXTENSIONS.includes(ext));
};

const isBlockedEntryCandidate = (path: string) =>
  ENTRY_FILE_BLOCKLIST_PATTERNS.some((pattern) => pattern.test(path));

const getEntryCandidateScore = (path: string) => {
  if (isBlockedEntryCandidate(path)) {
    return -1000;
  }

  let score = 0;

  for (const { pattern, score: currentScore } of ENTRY_FILE_PRIORITY_PATTERNS) {
    if (pattern.test(path)) {
      score += currentScore;
    }
  }

  if (/\/(src|app|cmd|server|client|web|lib)\//i.test(path)) {
    score += 15;
  }

  if (/\.(tsx|ts|jsx|js|py|go|rs|java|kt|dart|swift|cs|php|rb|c|cpp)$/i.test(path)) {
    score += 10;
  }

  return score;
};

const buildPanoramaNodeId = (path: number[]) => (path.length === 0 ? 'root' : `node-${path.join('-')}`);

const MODULE_COLOR_PALETTE = [
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f97316',
  '#eab308',
  '#14b8a6',
  '#84cc16',
  '#f43f5e',
];

type WorkflowStatus = 'idle' | 'running' | 'completed' | 'failed';
type ColoredFunctionModule = FunctionModuleGroup & { color: string };

const getWorkflowStatusMeta = (status: WorkflowStatus) => {
  if (status === 'running') {
    return {
      label: '工作中',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      showSpinner: true,
    };
  }
  if (status === 'completed') {
    return {
      label: '工作流已结束',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
      showSpinner: false,
    };
  }
  if (status === 'failed') {
    return {
      label: '工作流已结束（失败）',
      className: 'border-red-500/30 bg-red-500/10 text-red-300',
      showSpinner: false,
    };
  }
  return {
    label: '未开始',
    className: 'border-zinc-700 bg-zinc-800/60 text-zinc-400',
    showSpinner: false,
  };
};
const toColoredModules = (modules: FunctionModuleGroup[]): ColoredFunctionModule[] =>
  modules.map((module, index) => ({
    ...module,
    color: MODULE_COLOR_PALETTE[index % MODULE_COLOR_PALETTE.length],
  }));

const buildNodeModuleMapFromModules = (modules: FunctionModuleGroup[]) => {
  const map: Record<string, string> = {};

  for (const module of modules) {
    for (const nodeId of module.functionNodeIds) {
      map[nodeId] = module.moduleId;
    }
  }

  return map;
};

const flattenFunctionNodesForModules = (
  analysis: EntryFunctionAnalysis,
  entryFilePath: string
): ModuleFunctionNodeInput[] => {
  const result: ModuleFunctionNodeInput[] = [
    {
      nodeId: 'root',
      functionName: analysis.entryFunctionName || 'entry function',
      description: analysis.summary || '入口函数流程概览',
      filePath: entryFilePath,
    },
  ];

  const walk = (nodes: SubFunctionAnalysis[], pathPrefix: number[], parentNodeId: string) => {
    for (const [index, node] of nodes.entries()) {
      const nextPath = [...pathPrefix, index];
      const nodeId = buildPanoramaNodeId(nextPath);
      result.push({
        nodeId,
        functionName: node.name,
        description: node.description || node.stopReason || '',
        filePath: node.resolvedFile || node.file,
        parentNodeId,
      });

      if (node.children && node.children.length > 0) {
        walk(node.children, nextPath, nodeId);
      }
    }
  };

  walk(analysis.subFunctions || [], [], 'root');
  return result;
};

const normalizeFunctionModuleAnalysis = (
  moduleAnalysis: FunctionModuleAnalysis,
  functionNodes: ModuleFunctionNodeInput[]
): FunctionModuleGroup[] => {
  const nodeIdSet = new Set(functionNodes.map((node) => node.nodeId));
  const assignedNodeIds = new Set<string>();
  const normalizedModules: FunctionModuleGroup[] = [];

  for (const [index, module] of (moduleAnalysis.modules || []).entries()) {
    if (normalizedModules.length >= 10) {
      break;
    }

    const dedupedNodeIds: string[] = [];
    for (const nodeId of module.functionNodeIds || []) {
      if (!nodeIdSet.has(nodeId) || assignedNodeIds.has(nodeId)) {
        continue;
      }
      assignedNodeIds.add(nodeId);
      dedupedNodeIds.push(nodeId);
    }

    if (dedupedNodeIds.length === 0) {
      continue;
    }

    normalizedModules.push({
      moduleId: (module.moduleId || `module-${index + 1}`).trim(),
      moduleName: (module.moduleName || `功能模块 ${index + 1}`).trim(),
      description: (module.description || '').trim(),
      functionNodeIds: dedupedNodeIds,
    });
  }

  const unassignedNodeIds = functionNodes
    .map((node) => node.nodeId)
    .filter((nodeId) => !assignedNodeIds.has(nodeId));

  if (unassignedNodeIds.length > 0) {
    if (normalizedModules.length < 10) {
      normalizedModules.push({
        moduleId: 'module-unassigned',
        moduleName: '未归类模块',
        description: 'AI 未能为这些函数节点分配明确模块，已自动归入未归类模块。',
        functionNodeIds: unassignedNodeIds,
      });
    } else if (normalizedModules.length > 0) {
      normalizedModules[normalizedModules.length - 1].functionNodeIds.push(...unassignedNodeIds);
    }
  }

  return normalizedModules.slice(0, 10);
};

const rankSymbolIndexPaths = (paths: string[]) => {
  const scorePath = (path: string) => {
    let score = 0;
    const lower = path.toLowerCase();

    if (/\/(src|app|lib|server|client|cmd|internal|pkg|core|domain|modules|features|services|controllers)\//.test(lower)) {
      score += 40;
    }

    if (/\.(tsx|ts|jsx|js|py|go|rs|java|kt|dart|swift|cs|php|rb|c|cpp|h|hpp|vue|svelte)$/.test(lower)) {
      score += 20;
    }

    if (/(test|spec|mock|fixture|story|stories|min)\./.test(lower)) {
      score -= 30;
    }

    if (/(generated|vendor|dist|build|coverage)\//.test(lower)) {
      score -= 100;
    }

    return score;
  };

  return [...paths].sort((left, right) => scorePath(right) - scorePath(left));
};

const rankEntryFileCandidates = (allPaths: string[], aiEntryFiles: string[]) => {
  const scoreMap = new Map<string, number>();

  for (const path of allPaths) {
    if (!isAnalyzableCodeFile(path) || isBlockedEntryCandidate(path)) {
      continue;
    }

    const score = getEntryCandidateScore(path);
    if (score > 0) {
      scoreMap.set(path, score);
    }
  }

  for (const path of aiEntryFiles) {
    if (!allPaths.includes(path) || isBlockedEntryCandidate(path)) {
      continue;
    }

    scoreMap.set(path, Math.max(getEntryCandidateScore(path), 0) + 1000);
  }

  return [...scoreMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([path]) => path)
    .slice(0, 8);
};

const truncateJson = (obj: any): any => {
  if (typeof obj === 'string') {
    if (obj.length > 500) {
      return obj.substring(0, 500) + `... (后续还有 ${obj.length - 500} 个字符)`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(truncateJson);
  }
  if (obj !== null && typeof obj === 'object') {
    const newObj: any = {};
    for (const key in obj) {
      newObj[key] = truncateJson(obj[key]);
    }
    return newObj;
  }
  return obj;
};

const ResizeHandle = ({ onMouseDown }: { onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void }) => {
  return (
    <div
      onMouseDown={onMouseDown}
      className="hidden lg:flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-zinc-950/40 hover:bg-emerald-500/10 transition-colors group"
    >
      <div className="h-16 w-px bg-zinc-800 group-hover:bg-emerald-400 transition-colors" />
    </div>
  );
};

const LogItem = ({ log }: { log: LogEntry }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeDetail, setActiveDetail] = useState<'request' | 'response' | 'fileList' | null>(null);
  const hasFileList = Boolean(log.fileList && log.fileList.length > 0);
  const hasRequest = Boolean(log.request);
  const hasResponse = Boolean(log.response);
  const firstAvailableDetail: 'request' | 'response' | 'fileList' | null =
    hasFileList ? 'fileList' : hasRequest ? 'request' : hasResponse ? 'response' : null;

  const typeMeta =
    log.type === 'error'
      ? {
          badge: 'ERROR',
          badgeClass: 'border-red-500/40 bg-red-500/15 text-red-300',
          textClass: 'text-red-300',
        }
      : log.type === 'success'
        ? {
            badge: 'SUCCESS',
            badgeClass: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
            textClass: 'text-emerald-300',
          }
        : {
            badge: 'INFO',
            badgeClass: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
            textClass: 'text-zinc-200',
          };

  const toggleCard = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      if (next) {
        setActiveDetail((detailPrev) => detailPrev || firstAvailableDetail);
      } else {
        setActiveDetail(null);
      }
      return next;
    });
  };

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/70 shadow-sm transition-colors hover:border-zinc-700">
      <button
        type="button"
        onClick={toggleCard}
        className="w-full px-3 py-2.5 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-[11px] font-mono text-zinc-500">{log.timestamp.toLocaleTimeString()}</div>
            <div className={`text-xs leading-relaxed break-words ${typeMeta.textClass}`}>{log.message}</div>
          </div>
          <div className="mt-0.5 shrink-0">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-zinc-500" />
            ) : (
              <ChevronRight className="h-4 w-4 text-zinc-500" />
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
            {hasFileList && <span className="rounded-full border border-zinc-700 bg-zinc-800/80 px-2 py-0.5">文件 {log.fileList?.length}</span>}
            {hasRequest && <span className="rounded-full border border-zinc-700 bg-zinc-800/80 px-2 py-0.5">请求</span>}
            {hasResponse && <span className="rounded-full border border-zinc-700 bg-zinc-800/80 px-2 py-0.5">响应</span>}
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${typeMeta.badgeClass}`}>
            {typeMeta.badge}
          </span>
        </div>
      </button>

      {isExpanded && (hasFileList || hasRequest || hasResponse) && (
        <div className="border-t border-zinc-800/80 px-3 pb-3 pt-2">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {hasFileList && (
              <button
                type="button"
                onClick={() => setActiveDetail('fileList')}
                className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                  activeDetail === 'fileList'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-zinc-800/70 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'
                }`}
              >
                文件列表
              </button>
            )}
            {hasRequest && (
              <button
                type="button"
                onClick={() => setActiveDetail('request')}
                className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                  activeDetail === 'request'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-zinc-800/70 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'
                }`}
              >
                请求内容
              </button>
            )}
            {hasResponse && (
              <button
                type="button"
                onClick={() => setActiveDetail('response')}
                className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                  activeDetail === 'response'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-zinc-800/70 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'
                }`}
              >
                响应内容
              </button>
            )}
          </div>

          {activeDetail === 'fileList' && log.fileList && (
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-3 shadow-inner">
              <pre className="max-h-64 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-zinc-400 custom-scrollbar">
                {JSON.stringify(log.fileList, null, 2)}
              </pre>
            </div>
          )}
          {activeDetail === 'request' && log.request && (
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-3 shadow-inner">
              <pre className="max-h-64 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-zinc-400 custom-scrollbar">
                {JSON.stringify(truncateJson(log.request), null, 2)}
              </pre>
            </div>
          )}
          {activeDetail === 'response' && log.response && (
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-3 shadow-inner">
              <pre className="max-h-64 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-zinc-400 custom-scrollbar">
                {JSON.stringify(truncateJson(log.response), null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function Analyze() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlParam = searchParams.get('url') || '';
  const historyParam = searchParams.get('history') || '';

  const [urlInput, setUrlInput] = useState(urlParam);
  const [currentRepoUrl, setCurrentRepoUrl] = useState(urlParam);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(historyParam || null);
  const [repoInfo, setRepoInfo] = useState<GithubRepoInfo | null>(null);
  const [files, setFiles] = useState<GithubFileNode[]>([]);
  const [openedFiles, setOpenedFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [loadingFiles, setLoadingFiles] = useState<Record<string, boolean>>({});
  const [isTreeLoading, setIsTreeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [aiAnalysis, setAiAnalysis] = useState<ProjectAnalysis | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isModuleReanalyzing, setIsModuleReanalyzing] = useState(false);

  const [confirmedEntryFile, setConfirmedEntryFile] = useState<{ path: string, reason: string } | null>(null);
  const [isVerifyingEntry, setIsVerifyingEntry] = useState(false);

  const [subFunctionAnalysis, setSubFunctionAnalysis] = useState<EntryFunctionAnalysis | null>(null);
  const [isSubFunctionLoading, setIsSubFunctionLoading] = useState(false);
  const [selectedPanoramaNodeId, setSelectedPanoramaNodeId] = useState('root');
  const [activePanoramaNodeId, setActivePanoramaNodeId] = useState<string | null>(null);
  const [functionModules, setFunctionModules] = useState<ColoredFunctionModule[]>([]);
  const [nodeModuleMap, setNodeModuleMap] = useState<Record<string, string>>({});
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus>('idle');

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<LogFilter>('all');
  const [isLogsExpanded, setIsLogsExpanded] = useState(true);
  const [isFullScreenLogs, setIsFullScreenLogs] = useState(false);
  const [panelVisibility, setPanelVisibility] = useState({
    files: true,
    source: true,
    panorama: true,
  });
  const [panelWidths, setPanelWidths] = useState({
    overview: 320,
    files: 288,
    source: 560,
  });
  
  const lastLoadedUrl = useRef<string | null>(null);
  const lastLoadedHistory = useRef<string | null>(null);
  const desktopLayoutRef = useRef<HTMLDivElement | null>(null);
  const rightAreaRef = useRef<HTMLDivElement | null>(null);
  const fileContentCacheRef = useRef<Record<string, string>>({});
  const pendingFileContentRequestsRef = useRef<Record<string, Promise<string>>>({});
  const functionFileGuessCacheRef = useRef<Record<string, FunctionFileGuess | null>>({});
  const drillDownAnalysisCacheRef = useRef<Record<string, DrillDownAnalysisCacheEntry>>({});
  const fileSymbolCacheRef = useRef<Record<string, string[]>>({});
  const symbolFileMapRef = useRef<Record<string, string[]>>({});
  const analyzablePathsRef = useRef<string[]>([]);
  const analysisNodeCountRef = useRef(0);
  const moduleAnalysisTriggeredRef = useRef(false);
  const dragStateRef = useRef<{
    type: 'overview' | 'files' | 'source';
    startX: number;
    overview: number;
    files: number;
    source: number;
  } | null>(null);

  const rightPanelsVisible = panelVisibility.source || panelVisibility.panorama;
  const showOverviewResizeHandle = panelVisibility.files || rightPanelsVisible;
  const showFilesResizeHandle = panelVisibility.files && rightPanelsVisible;
  const showSourceResizeHandle = panelVisibility.source && panelVisibility.panorama;
  const workflowStatusMeta = getWorkflowStatusMeta(workflowStatus);
  const logCounts = useMemo(
    () =>
      logs.reduce(
        (acc, log) => {
          acc[log.type] += 1;
          return acc;
        },
        {
          all: logs.length,
          info: 0,
          success: 0,
          error: 0,
        } as Record<LogFilter, number>
      ),
    [logs]
  );
  const filteredLogs = useMemo(
    () => (logFilter === 'all' ? logs : logs.filter((log) => log.type === logFilter)),
    [logs, logFilter]
  );
  const moduleColorMap = functionModules.reduce<Record<string, string>>((acc, module) => {
    acc[module.moduleId] = module.color;
    return acc;
  }, {});

  const getRightCompositeMinWidth = () => {
    if (!panelVisibility.source && !panelVisibility.panorama) {
      return 0;
    }
    if (panelVisibility.source && panelVisibility.panorama) {
      return PANEL_MIN_WIDTHS.source + PANEL_MIN_WIDTHS.panorama;
    }
    return panelVisibility.source ? PANEL_MIN_WIDTHS.source : PANEL_MIN_WIDTHS.panorama;
  };

  const stopResize = () => {
    dragStateRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', handleResize);
    window.removeEventListener('mouseup', stopResize);
  };

  const handleResize = (event: MouseEvent) => {
    const dragState = dragStateRef.current;
    if (!dragState) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;

    if (dragState.type === 'overview') {
      const containerWidth = desktopLayoutRef.current?.clientWidth ?? 0;
      const remainingMinWidth =
        (panelVisibility.files ? PANEL_MIN_WIDTHS.files : 0) + getRightCompositeMinWidth();
      const maxWidth = Math.max(PANEL_MIN_WIDTHS.overview, containerWidth - remainingMinWidth);
      const nextOverviewWidth = Math.min(
        maxWidth,
        Math.max(PANEL_MIN_WIDTHS.overview, dragState.overview + deltaX)
      );

      setPanelWidths((prev) => ({ ...prev, overview: nextOverviewWidth }));
      return;
    }

    if (dragState.type === 'files') {
      const containerWidth = desktopLayoutRef.current?.clientWidth ?? 0;
      const remainingMinWidth = dragState.overview + getRightCompositeMinWidth();
      const maxWidth = Math.max(PANEL_MIN_WIDTHS.files, containerWidth - remainingMinWidth);
      const nextFilesWidth = Math.min(
        maxWidth,
        Math.max(PANEL_MIN_WIDTHS.files, dragState.files + deltaX)
      );

      setPanelWidths((prev) => ({ ...prev, files: nextFilesWidth }));
      return;
    }

    const rightAreaWidth = rightAreaRef.current?.clientWidth ?? 0;
    const maxSourceWidth = Math.max(
      PANEL_MIN_WIDTHS.source,
      rightAreaWidth - PANEL_MIN_WIDTHS.panorama
    );
    const nextSourceWidth = Math.min(
      maxSourceWidth,
      Math.max(PANEL_MIN_WIDTHS.source, dragState.source + deltaX)
    );

    setPanelWidths((prev) => ({ ...prev, source: nextSourceWidth }));
  };

  const startResize =
    (type: 'overview' | 'files' | 'source') =>
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragStateRef.current = {
        type,
        startX: event.clientX,
        overview: panelWidths.overview,
        files: panelWidths.files,
        source: panelWidths.source,
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleResize);
      window.addEventListener('mouseup', stopResize);
    };

  const locateFunctionDefinition = async (input: {
    repo: GithubRepoInfo;
    repoUrl: string;
    summary: string;
    functionName: string;
    parentFunctionName?: string;
    parentFilePath?: string;
    parentFileContent?: string;
    hintedFilePath?: string;
    allFiles: string[];
  }): Promise<{
    filePath: string;
    snippet: string;
    startLine: number;
    endLine: number;
    stage: 'same_file' | 'indexed_search' | 'heuristic_search' | 'ai_guess' | 'project_search';
  } | null> => {
    const startedAt = Date.now();
    const limits = getAnalysisLimits();
    
    if (isLikelyExternalFunctionName(input.functionName)) {
      addLog(`停止下钻 ${input.functionName}：疑似系统函数或库函数`, 'info');
      return null;
    }

    if (input.parentFilePath && input.parentFileContent) {
      addLog(`优先在上级同文件搜索函数定义：${input.functionName} -> ${input.parentFilePath}`, 'info');
      const sameFileMatch = findFunctionDefinitionInContent(input.functionName, input.parentFileContent);
      if (sameFileMatch) {
        addStageLog(`已在同文件中定位到函数 ${input.functionName}`, startedAt);
        return {
          filePath: input.parentFilePath,
          snippet: trimFunctionSnippet(sameFileMatch.snippet),
          startLine: sameFileMatch.startLine,
          endLine: sameFileMatch.endLine,
          stage: 'same_file',
        };
      }
    }

    const functionLookupKeys = getFunctionNameLookupKeys(input.functionName);
    const indexedFiles = Array.from(
      new Set(
        functionLookupKeys.flatMap((lookupKey) => symbolFileMapRef.current[lookupKey] || [])
      )
    )
      .filter((filePath) => input.allFiles.includes(filePath))
      .slice(0, limits.MAX_HEURISTIC_SEARCH_FILES);

    if (indexedFiles.length > 0) {
      addLog(`命中本地函数索引候选文件，开始定位函数：${input.functionName}`, 'info', { fileList: indexedFiles });
      const indexedLocated = await searchFunctionInFiles({
        functionName: input.functionName,
        filePaths: indexedFiles,
        getFileContent: (path) => getRepositoryFileContent(input.repo, path),
        concurrency: limits.INDEX_CONCURRENCY,
      });

      if (indexedLocated) {
        addStageLog(`函数定位成功（本地索引）：${input.functionName} -> ${indexedLocated.filePath}`, startedAt);
        return {
          filePath: indexedLocated.filePath,
          snippet: trimFunctionSnippet(indexedLocated.match.snippet),
          startLine: indexedLocated.match.startLine,
          endLine: indexedLocated.match.endLine,
          stage: 'indexed_search',
        };
      }
    }

    const heuristicSearchPaths = prioritizeSearchPaths({
      functionName: input.functionName,
      allFiles: input.allFiles,
      parentFilePath: input.parentFilePath,
      hintedFiles: input.hintedFilePath ? [input.hintedFilePath] : undefined,
    }).slice(0, limits.MAX_HEURISTIC_SEARCH_FILES);

    if (heuristicSearchPaths.length > 0) {
      addLog(`开始按启发式路径定位函数：${input.functionName}`, 'info', { fileList: heuristicSearchPaths });
      const heuristicLocated = await searchFunctionInFiles({
        functionName: input.functionName,
        filePaths: heuristicSearchPaths,
        getFileContent: (path) => getRepositoryFileContent(input.repo, path),
        concurrency: limits.INDEX_CONCURRENCY,
      });

      if (heuristicLocated) {
        addStageLog(`函数定位成功（启发式搜索）：${input.functionName} -> ${heuristicLocated.filePath}`, startedAt);
        return {
          filePath: heuristicLocated.filePath,
          snippet: trimFunctionSnippet(heuristicLocated.match.snippet),
          startLine: heuristicLocated.match.startLine,
          endLine: heuristicLocated.match.endLine,
          stage: 'heuristic_search',
        };
      }
    }

    const guessCacheKey = [
      input.functionName,
      input.parentFunctionName || '',
      input.parentFilePath || '',
      input.hintedFilePath || '',
    ].join('::');

    let guessedFiles = functionFileGuessCacheRef.current[guessCacheKey];

    if (guessedFiles === undefined) {
      addLog(`正在调用 AI 猜测函数所在文件：${input.functionName}`, 'info');
      const guessedResult = await guessFunctionFiles({
        repoUrl: input.repoUrl,
        summary: input.summary,
        functionName: input.functionName,
        allFiles: input.allFiles,
        parentFunctionName: input.parentFunctionName,
        parentFilePath: input.parentFilePath,
        hintedFilePath: input.hintedFilePath,
      });
      guessedFiles = guessedResult.analysis;
      functionFileGuessCacheRef.current[guessCacheKey] = guessedFiles || null;
      addLog(`AI 文件猜测完成：${input.functionName}`, guessedFiles ? 'success' : 'error', {
        request: guessedResult.requestPayload,
        response: guessedResult.responseText,
      });
    }

    if (guessedFiles && !guessedFiles.isProjectFunction) {
      addLog(`函数 ${input.functionName} 被判断为非项目函数：${guessedFiles.reason}`, 'info');
      return null;
    }

    const aiCandidateFiles = Array.from(
      new Set(
        [input.hintedFilePath, ...(guessedFiles?.candidateFiles || [])].filter(
          (filePath): filePath is string => Boolean(filePath && input.allFiles.includes(filePath))
        )
      )
    );

    if (aiCandidateFiles.length > 0) {
      addLog(`使用 AI 候选文件继续定位函数：${input.functionName}`, 'info', { fileList: aiCandidateFiles });
      const aiLocated = await searchFunctionInFiles({
        functionName: input.functionName,
        filePaths: aiCandidateFiles,
        getFileContent: (path) => getRepositoryFileContent(input.repo, path),
        concurrency: limits.INDEX_CONCURRENCY,
      });

      if (aiLocated) {
        addStageLog(`函数定位成功（AI 候选）：${input.functionName} -> ${aiLocated.filePath}`, startedAt);
        return {
          filePath: aiLocated.filePath,
          snippet: trimFunctionSnippet(aiLocated.match.snippet),
          startLine: aiLocated.match.startLine,
          endLine: aiLocated.match.endLine,
          stage: 'ai_guess',
        };
      }
    }

    const orderedSearchPaths = prioritizeSearchPaths({
      functionName: input.functionName,
      allFiles: input.allFiles,
      parentFilePath: input.parentFilePath,
      hintedFiles: aiCandidateFiles,
    }).slice(0, limits.MAX_PROJECT_SEARCH_FILES);

    addLog(`开始在项目范围内搜索函数定义：${input.functionName}`, 'info');
    const searched = await searchFunctionInFiles({
      functionName: input.functionName,
      filePaths: orderedSearchPaths,
      getFileContent: (path) => getRepositoryFileContent(input.repo, path),
      concurrency: limits.INDEX_CONCURRENCY,
    });

    if (!searched) {
      addStageLog(`未能在项目中定位到函数定义：${input.functionName}`, startedAt, 'info');
      return null;
    }

    addStageLog(`函数定位成功（项目搜索）：${input.functionName} -> ${searched.filePath}`, startedAt);
    return {
      filePath: searched.filePath,
      snippet: trimFunctionSnippet(searched.match.snippet),
      startLine: searched.match.startLine,
      endLine: searched.match.endLine,
      stage: 'project_search',
    };
  };
  const drillDownSubFunctions = async (input: {
    repo: GithubRepoInfo;
    repoUrl: string;
    summary: string;
    parentFunctionName: string;
    parentFilePath: string;
    parentFileContent: string;
    subFunctions: SubFunctionAnalysis[];
    allFiles: string[];
    depth: number;
    pathPrefix: number[];
  }): Promise<void> => {
    const limits = getAnalysisLimits();
    const prioritizedIndexes = input.subFunctions
      .map((subFunction, index) => ({ subFunction, index }))
      .sort((left, right) => right.subFunction.drillDown - left.subFunction.drillDown);

    const allowedIndexes = new Set(
      prioritizedIndexes
        .filter(({ subFunction }) => subFunction.drillDown !== -1)
        .slice(0, limits.MAX_DRILLDOWN_PER_LEVEL)
        .map(({ index }) => index)
    );

    for (const [index, subFunction] of input.subFunctions.entries()) {
      const currentPath = [...input.pathPrefix, index];
      setActivePanoramaNodeId(buildPanoramaNodeId(currentPath));

      if (input.depth >= limits.MAX_RECURSION_DEPTH) {
        subFunction.stopReason = subFunction.stopReason || '已达到最大下钻深度，停止继续分析。';
        updateSubFunctionAtPath(currentPath, (node) => ({
          ...node,
          stopReason: node.stopReason || '已达到最大下钻深度，停止继续分析。',
        }));
        continue;
      }

      if (subFunction.drillDown === -1) {
        subFunction.stopReason = subFunction.stopReason || 'AI 判断该函数与核心流程关联较弱，停止继续下钻。';
        updateSubFunctionAtPath(currentPath, (node) => ({
          ...node,
          stopReason: node.stopReason || 'AI 判断该函数与核心流程关联较弱，停止继续下钻。',
        }));
        continue;
      }

      if (!allowedIndexes.has(index)) {
        subFunction.stopReason =
          subFunction.stopReason ||
          `达到每层最大下钻数量 ${limits.MAX_DRILLDOWN_PER_LEVEL}，其余函数停止下钻。`;
        updateSubFunctionAtPath(currentPath, (node) => ({
          ...node,
          stopReason:
            node.stopReason ||
            `达到每层最大下钻数量 ${limits.MAX_DRILLDOWN_PER_LEVEL}，其余函数停止下钻。`,
        }));
        continue;
      }

      if (analysisNodeCountRef.current >= limits.MAX_ANALYSIS_NODES) {
        subFunction.stopReason =
          subFunction.stopReason ||
          `已达到总分析节点上限 ${limits.MAX_ANALYSIS_NODES}，停止继续下钻。`;
        updateSubFunctionAtPath(currentPath, (node) => ({
          ...node,
          stopReason:
            node.stopReason ||
            `已达到总分析节点上限 ${limits.MAX_ANALYSIS_NODES}，停止继续下钻。`,
        }));
        continue;
      }

      analysisNodeCountRef.current += 1;
      const locateStartedAt = Date.now();
      const located = await locateFunctionDefinition({
        repo: input.repo,
        repoUrl: input.repoUrl,
        summary: input.summary,
        functionName: subFunction.name,
        parentFunctionName: input.parentFunctionName,
        parentFilePath: input.parentFilePath,
        parentFileContent: input.parentFileContent,
        hintedFilePath: subFunction.file,
        allFiles: input.allFiles,
      });

      if (!located) {
        subFunction.stopReason = subFunction.stopReason || '未能定位到该函数定义，无法继续下钻。';
        updateSubFunctionAtPath(currentPath, (node) => ({
          ...node,
          stopReason: node.stopReason || '未能定位到该函数定义，无法继续下钻。',
        }));
        continue;
      }

      addStageLog(`函数定位完成：${subFunction.name}（${located.stage}）`, locateStartedAt);
      const fileContent = await getRepositoryFileContent(input.repo, located.filePath);
      subFunction.resolvedFile = located.filePath;
      subFunction.resolvedSnippet = located.snippet;
      updateSubFunctionAtPath(currentPath, (node) => ({
        ...node,
        resolvedFile: located.filePath,
        resolvedSnippet: located.snippet,
      }));

      let childAnalysis: EntryFunctionAnalysis | null = null;
      const drillDownCacheKey = buildDrillDownCacheKey(subFunction.name, located.filePath);
      const cachedAnalysis = drillDownAnalysisCacheRef.current[drillDownCacheKey];

      if (cachedAnalysis) {
        childAnalysis = cloneEntryFunctionAnalysis(cachedAnalysis.analysis);
        addLog(
          `命中下钻缓存：${subFunction.name} -> ${located.filePath}（缓存时间 ${new Date(cachedAnalysis.cachedAt).toLocaleTimeString()}）`,
          'success'
        );
      } else {
        const functionAnalysisStartedAt = Date.now();
        addLog(`调用 AI 深入分析函数 ${subFunction.name}（深度 ${input.depth + 1}）`, 'info');
        const {
          analysis,
          requestPayload,
          responseText,
        } = await analyzeFunctionImplementation({
          repoUrl: input.repoUrl,
          summary: input.summary,
          functionName: subFunction.name,
          filePath: located.filePath,
          functionCode: located.snippet,
          allFiles: input.allFiles,
          parentFunctionName: input.parentFunctionName,
          depth: input.depth + 1,
        });

        childAnalysis = analysis;
        addStageLog(
          childAnalysis ? `函数 ${subFunction.name} 深入分析完成` : `函数 ${subFunction.name} 深入分析失败`,
          functionAnalysisStartedAt,
          childAnalysis ? 'success' : 'error',
          { request: requestPayload, response: responseText }
        );

        if (childAnalysis) {
          drillDownAnalysisCacheRef.current[drillDownCacheKey] = {
            analysis: cloneEntryFunctionAnalysis(childAnalysis),
            filePath: located.filePath,
            functionName: subFunction.name,
            cachedAt: Date.now(),
          };
          addLog(`已写入下钻缓存：${subFunction.name} -> ${located.filePath}`, 'info');
        }
      }

      if (!childAnalysis || childAnalysis.shouldStop) {
        subFunction.description = childAnalysis?.summary || subFunction.description;
        subFunction.stopReason =
          childAnalysis?.stopReason ||
          subFunction.stopReason ||
          'AI 返回停止继续下钻。';
        updateSubFunctionAtPath(currentPath, (node) => ({
          ...node,
          description: childAnalysis?.summary || node.description,
          stopReason:
            childAnalysis?.stopReason ||
            node.stopReason ||
            'AI 返回停止继续下钻。',
        }));
        continue;
      }

      subFunction.description = childAnalysis.summary || subFunction.description;
      subFunction.resolvedFile = located.filePath;
      subFunction.resolvedSnippet = located.snippet;
      subFunction.children = childAnalysis.subFunctions;
      subFunction.stopReason = childAnalysis.stopReason;
      updateSubFunctionAtPath(currentPath, (node) => ({
        ...node,
        description: childAnalysis.summary || node.description,
        resolvedFile: located.filePath,
        resolvedSnippet: located.snippet,
        children: childAnalysis.subFunctions,
        stopReason: childAnalysis.stopReason,
      }));

      await drillDownSubFunctions({
        repo: input.repo,
        repoUrl: input.repoUrl,
        summary: input.summary,
        parentFunctionName: childAnalysis.entryFunctionName || subFunction.name,
        parentFilePath: located.filePath,
        parentFileContent: fileContent,
        subFunctions: childAnalysis.subFunctions,
        allFiles: input.allFiles,
        depth: input.depth + 1,
        pathPrefix: currentPath,
      });
    }
  };
  useEffect(() => {
    return () => {
      stopResize();
    };
  }, []);

  const togglePanel = (panel: 'files' | 'source' | 'panorama') => {
    setPanelVisibility((prev) => ({
      ...prev,
      [panel]: !prev[panel],
    }));
  };

  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info', extra?: { request?: any, response?: any, fileList?: string[] }) => {
    setLogs(prev => [...prev, {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date(),
      message,
      type,
      ...extra
    }]);
  };

  const formatDuration = (durationMs: number) => {
    if (durationMs < 1000) {
      return `${durationMs}ms`;
    }
    return `${(durationMs / 1000).toFixed(durationMs >= 10000 ? 0 : 1)}s`;
  };

  const addStageLog = (
    message: string,
    startedAt: number,
    type: 'info' | 'success' | 'error' = 'success',
    extra?: { request?: any, response?: any, fileList?: string[] }
  ) => {
    addLog(`${message}（耗时 ${formatDuration(Date.now() - startedAt)}）`, type, extra);
  };

  const buildHistorySnapshot = (): AnalysisSnapshot => ({
    repoUrl: currentRepoUrl,
    repoInfo,
    files,
    aiAnalysis,
    confirmedEntryFile,
    subFunctionAnalysis,
    functionModules: functionModules.map(({ color: _color, ...module }) => module),
    nodeModuleMap,
    logs: serializeLogs(logs),
  });

  const restoreHistoryRecord = async (record: AnalysisHistoryItem) => {
    const snapshot = record.snapshot;
    const restoredLogs = deserializeLogs(snapshot.logs || []);
    const restoredAiAnalysis: ProjectAnalysis | null =
      snapshot.aiAnalysis ||
      (record.summary ||
      (record.mainLanguages || []).length > 0 ||
      (record.techStack || []).length > 0 ||
      snapshot.confirmedEntryFile?.path
        ? {
            summary: record.summary || '',
            mainLanguages: record.mainLanguages || [],
            techStack: record.techStack || [],
            entryFiles: snapshot.confirmedEntryFile?.path ? [snapshot.confirmedEntryFile.path] : [],
          }
        : null);

    setError(null);
    setUrlInput(snapshot.repoUrl);
    setCurrentRepoUrl(snapshot.repoUrl);
    setCurrentHistoryId(record.id);
    setRepoInfo(snapshot.repoInfo);
    setFiles(snapshot.files || []);
    setOpenedFiles(snapshot.confirmedEntryFile?.path ? [snapshot.confirmedEntryFile.path] : []);
    setActiveFile(snapshot.confirmedEntryFile?.path || null);
    setFileContents({});
    setLoadingFiles({});
    setAiAnalysis(restoredAiAnalysis);
    setConfirmedEntryFile(snapshot.confirmedEntryFile);
    setSubFunctionAnalysis(snapshot.subFunctionAnalysis);
    const restoredModules = toColoredModules(snapshot.functionModules || []);
    setFunctionModules(restoredModules);
    setNodeModuleMap(
      snapshot.nodeModuleMap ||
      buildNodeModuleMapFromModules(restoredModules.map(({ color: _color, ...module }) => module))
    );
    setActiveModuleId(null);
    setSelectedPanoramaNodeId('root');
    setActivePanoramaNodeId(null);
    setLogs(restoredLogs);
    setWorkflowStatus('completed');
    setIsTreeLoading(false);
    setIsAiLoading(false);
    setIsVerifyingEntry(false);
    setIsSubFunctionLoading(false);
    moduleAnalysisTriggeredRef.current = Boolean((snapshot.functionModules || []).length > 0);
    fileContentCacheRef.current = {};
    pendingFileContentRequestsRef.current = {};
    functionFileGuessCacheRef.current = {};
    drillDownAnalysisCacheRef.current = {};
    fileSymbolCacheRef.current = {};
    symbolFileMapRef.current = {};
    analyzablePathsRef.current = snapshot.files
      .filter((node) => node.type === 'blob')
      .map((node) => node.path)
      .filter(isAnalyzableCodeFile);

    const estimatedNodeCount =
      snapshot.subFunctionAnalysis?.subFunctions.length || 0;
    analysisNodeCountRef.current = Math.max(estimatedNodeCount, 1);

    if (snapshot.confirmedEntryFile?.path && snapshot.repoInfo) {
      await handleSelectFile(snapshot.confirmedEntryFile.path, snapshot.repoInfo);
    }
  };

  const updateSubFunctionAtPath = (
    targetPath: number[],
    updater: (node: SubFunctionAnalysis) => SubFunctionAnalysis
  ) => {
    setSubFunctionAnalysis((prev) => {
      if (!prev || targetPath.length === 0) {
        return prev;
      }

      const updateNodes = (
        nodes: SubFunctionAnalysis[],
        pathIndex: number
      ): SubFunctionAnalysis[] =>
        nodes.map((node, index) => {
          if (index !== targetPath[pathIndex]) {
            return node;
          }

          if (pathIndex === targetPath.length - 1) {
            return updater(node);
          }

          return {
            ...node,
            children: node.children ? updateNodes(node.children, pathIndex + 1) : node.children,
          };
        });

      return {
        ...prev,
        subFunctions: updateNodes(prev.subFunctions, 0),
      };
    });
  };

  const isLikelyExternalFunctionName = (functionName: string) => {
    const normalized = (getFunctionNameLookupKeys(functionName)[2] || functionName.trim().toLowerCase());
    const builtinNames = new Set([
      'print',
      'printf',
      'println',
      'console.log',
      'console.error',
      'log',
      'map',
      'filter',
      'reduce',
      'foreach',
      'for_each',
      'len',
      'length',
      'push',
      'pop',
      'slice',
      'splice',
      'require',
      'import',
      'render',
      'setstate',
    ]);

    return builtinNames.has(normalized);
  };

  const cloneEntryFunctionAnalysis = (analysis: EntryFunctionAnalysis): EntryFunctionAnalysis =>
    JSON.parse(JSON.stringify(analysis)) as EntryFunctionAnalysis;

  const buildDrillDownCacheKey = (functionName: string, filePath: string) => {
    const lookupKey = getFunctionNameLookupKeys(functionName)[2] || functionName.trim().toLowerCase();
    return `${filePath.toLowerCase()}::${lookupKey}`;
  };

  const getRepositoryFileContent = async (repo: GithubRepoInfo, path: string): Promise<string> => {
    if (fileContentCacheRef.current[path] !== undefined) {
      return fileContentCacheRef.current[path];
    }

    if (!pendingFileContentRequestsRef.current[path]) {
      pendingFileContentRequestsRef.current[path] = fetchFileContent(
        repo.owner,
        repo.repo,
        repo.defaultBranch,
        path
      ).then((content) => {
        fileContentCacheRef.current[path] = content;

        if (!fileSymbolCacheRef.current[path]) {
          const names = extractFunctionNamesFromContent(content);
          fileSymbolCacheRef.current[path] = names;
          for (const name of names) {
            const normalizedName = name.toLowerCase();
            const files = symbolFileMapRef.current[normalizedName] || [];
            if (!files.includes(path)) {
              symbolFileMapRef.current[normalizedName] = [...files, path];
            }
          }
        }

        setFileContents((prev) => (prev[path] === content ? prev : { ...prev, [path]: content }));
        delete pendingFileContentRequestsRef.current[path];
        return content;
      }).catch((error) => {
        delete pendingFileContentRequestsRef.current[path];
        throw error;
      });
    }

    return pendingFileContentRequestsRef.current[path];
  };

  const buildRepositorySymbolIndex = async (repo: GithubRepoInfo, filePaths: string[]) => {
    const startedAt = Date.now();
    const limits = getAnalysisLimits();
    const candidatePaths = rankSymbolIndexPaths(filePaths)
      .slice(0, limits.MAX_INDEX_FILES)
      .filter((path) => !fileSymbolCacheRef.current[path]);

    if (candidatePaths.length === 0) {
      return;
    }

    addLog(`开始预建本地函数索引，目标文件 ${candidatePaths.length} 个`, 'info', {
      fileList: candidatePaths,
    });

    for (let start = 0; start < candidatePaths.length; start += limits.INDEX_CONCURRENCY) {
      const batch = candidatePaths.slice(start, start + limits.INDEX_CONCURRENCY);
      await Promise.all(batch.map((path) => getRepositoryFileContent(repo, path).catch(() => '')));
    }

    const indexedSymbolCount = Object.keys(symbolFileMapRef.current).length;
    addStageLog(`本地函数索引构建完成，已收录 ${indexedSymbolCount} 个函数名`, startedAt, 'success');
  };
  const applyModuleAnalysis = async (input: {
    analysis: EntryFunctionAnalysis;
    entryFilePath: string;
    trigger: 'auto' | 'manual';
  }): Promise<boolean> => {
    const repoUrlForModuleAnalysis =
      currentRepoUrl.trim() ||
      (repoInfo ? `https://github.com/${repoInfo.owner}/${repoInfo.repo}` : '');

    if (!repoUrlForModuleAnalysis) {
      addLog('模块划分失败：缺少仓库或项目信息。', 'error');
      return false;
    }

    const hasProjectProfile = Boolean(aiAnalysis);
    const summaryForModuleAnalysis =
      aiAnalysis?.summary?.trim() ||
      confirmedEntryFile?.reason?.trim() ||
      `入口文件 ${input.entryFilePath}`;
    const languagesForModuleAnalysis = (aiAnalysis?.mainLanguages || []).filter((language) =>
      Boolean(language && language.trim())
    );
    const techStackForModuleAnalysis = (aiAnalysis?.techStack || []).filter((item) =>
      Boolean(item && item.trim())
    );

    const functionNodes = flattenFunctionNodesForModules(input.analysis, input.entryFilePath);
    if (functionNodes.length === 0) {
      addLog('模块划分失败：没有可用于划分的函数节点。', 'error');
      return false;
    }

    const startedAt = Date.now();
    addLog(
      input.trigger === 'manual'
        ? `开始重新划分功能模块（节点数：${functionNodes.length}）`
        : `开始自动划分功能模块（节点数：${functionNodes.length}）`,
      'info'
    );
    if (!hasProjectProfile) {
      addLog('未找到完整项目画像，将使用回退信息继续模块划分。', 'info');
    }

    const { analysis, requestPayload, responseText } = await analyzeFunctionModules({
      repoUrl: repoUrlForModuleAnalysis,
      summary: summaryForModuleAnalysis,
      mainLanguages: languagesForModuleAnalysis,
      techStack: techStackForModuleAnalysis,
      functionNodes,
    });

    if (!analysis || !Array.isArray(analysis.modules) || analysis.modules.length === 0) {
      addStageLog('功能模块划分失败：AI 未返回有效模块。', startedAt, 'error', {
        request: requestPayload,
        response: responseText,
      });
      return false;
    }

    const normalizedModules = normalizeFunctionModuleAnalysis(analysis, functionNodes);
    if (normalizedModules.length === 0) {
      addStageLog('功能模块划分失败：模块结果为空。', startedAt, 'error', {
        request: requestPayload,
        response: responseText,
      });
      return false;
    }

    const nextNodeModuleMap = buildNodeModuleMapFromModules(normalizedModules);
    const nextColoredModules = toColoredModules(normalizedModules);
    const moduleIds = new Set(nextColoredModules.map((module) => module.moduleId));

    setFunctionModules(nextColoredModules);
    setNodeModuleMap(nextNodeModuleMap);
    setActiveModuleId((prev) => (prev && moduleIds.has(prev) ? prev : null));

    addStageLog(
      `功能模块划分完成：共 ${nextColoredModules.length} 个模块`,
      startedAt,
      'success',
      {
        request: requestPayload,
        response: responseText,
      }
    );

    return true;
  };
  useEffect(() => {
    if (historyParam) {
      if (historyParam !== lastLoadedHistory.current) {
        const record = getAnalysisHistoryItem(historyParam);
        lastLoadedHistory.current = historyParam;
        lastLoadedUrl.current = null;
        if (record) {
          restoreHistoryRecord(record);
        } else {
          setError('未找到对应的历史分析记录，可能已被清理。');
        }
      }
      return;
    }

    if (urlParam && urlParam !== lastLoadedUrl.current) {
      lastLoadedUrl.current = urlParam;
      lastLoadedHistory.current = null;
      loadRepository(urlParam);
    }
  }, [historyParam, urlParam]);

  useEffect(() => {
    if (!repoInfo || !currentRepoUrl) {
      return;
    }

    if (files.length === 0 && !aiAnalysis && !confirmedEntryFile && !subFunctionAnalysis && logs.length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const timestamp = new Date().toISOString();
      const snapshot = buildHistorySnapshot();
      const id =
        currentHistoryId ||
        `${repoInfo.owner}-${repoInfo.repo}-${Date.now()}`;

      const saved = saveAnalysisHistory({
        id,
        createdAt: currentHistoryId ? timestamp : timestamp,
        updatedAt: timestamp,
        projectName: repoInfo.repo,
        repoUrl: currentRepoUrl,
        summary: aiAnalysis?.summary || '',
        mainLanguages: aiAnalysis?.mainLanguages || [],
        techStack: aiAnalysis?.techStack || [],
        snapshot,
      });

      if (saved.id !== currentHistoryId) {
        setCurrentHistoryId(saved.id);
      }
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [
    currentHistoryId,
    currentRepoUrl,
    repoInfo,
    files,
    aiAnalysis,
    confirmedEntryFile,
    subFunctionAnalysis,
    functionModules,
    nodeModuleMap,
    logs,
  ]);

  const loadRepository = async (repoUrl: string) => {
    setError(null);
    setCurrentRepoUrl(repoUrl);
    setCurrentHistoryId(null);
    setRepoInfo(null);
    setFiles([]);
    setOpenedFiles([]);
    setActiveFile(null);
    setFileContents({});
    setLoadingFiles({});
    setAiAnalysis(null);
    setConfirmedEntryFile(null);
    setSubFunctionAnalysis(null);
    setFunctionModules([]);
    setNodeModuleMap({});
    setActiveModuleId(null);
    setSelectedPanoramaNodeId('root');
    setActivePanoramaNodeId(null);
    setIsTreeLoading(true);
    setWorkflowStatus('running');
    setLogs([]);
    setLogFilter('all');
    fileContentCacheRef.current = {};
    pendingFileContentRequestsRef.current = {};
    functionFileGuessCacheRef.current = {};
    drillDownAnalysisCacheRef.current = {};
    fileSymbolCacheRef.current = {};
    symbolFileMapRef.current = {};
    analyzablePathsRef.current = [];
    analysisNodeCountRef.current = 0;
    moduleAnalysisTriggeredRef.current = false;

    addLog(`开始校验 GitHub 地址：${repoUrl}`, 'info');

    try {
      const repoInfoStartedAt = Date.now();
      const parsed = parseGithubUrl(repoUrl);
      if (!parsed) {
        throw new Error('无法解析 GitHub 仓库地址');
      }
      addLog(`地址解析成功：${parsed.owner}/${parsed.repo}`, 'success');

      const info = await fetchRepoInfo(parsed.owner, parsed.repo);
      setRepoInfo(info);
      addStageLog(`已获取仓库信息，默认分支 ${info.defaultBranch}`, repoInfoStartedAt);

      const treeStartedAt = Date.now();
      const tree = await fetchFileTree(info.owner, info.repo, info.defaultBranch);
      setFiles(tree);
      setIsTreeLoading(false);
      addStageLog(`已获取文件树，共 ${tree.length} 个文件或目录`, treeStartedAt);

      const analysisResult = await analyzeTree(tree, info);
      if (analysisResult && analysisResult.entryFiles.length > 0) {
        await verifyEntryFiles(analysisResult, info, repoUrl, tree);
      }
      setWorkflowStatus('completed');
      addLog('工作流已完成。', 'success');
    } catch (err: any) {
      setError(err.message || '加载失败');
      addLog(`加载失败：${err.message}`, 'error');
      setWorkflowStatus('failed');
    } finally {
      setIsTreeLoading(false);
    }
  };
  const verifyEntryFiles = async (
    analysis: ProjectAnalysis,
    repo: GithubRepoInfo,
    repoUrl: string,
    tree: GithubFileNode[]
  ) => {
    setIsVerifyingEntry(true);
    setConfirmedEntryFile(null);
    const limits = getAnalysisLimits();

    const candidateEntryFiles = analysis.entryFiles.slice(0, limits.MAX_ENTRY_FILE_CANDIDATES);
    let entryConfirmed = false;
    addLog(`开始逐个验证 ${candidateEntryFiles.length} 个候选入口文件...`, 'info');

    for (const path of candidateEntryFiles) {
      const entryCheckStartedAt = Date.now();
      addLog(`正在获取候选入口文件内容：${path}`, 'info');

      try {
        const content = await getRepositoryFileContent(repo, path);
        const lines = content.split('\n');
        let contentToSend = content;

        if (lines.length > 4000) {
          const first2000 = lines.slice(0, 2000).join('\n');
          const last2000 = lines.slice(-2000).join('\n');
          contentToSend = `${first2000}\n\n... [中间省略 ${lines.length - 4000} 行] ...\n\n${last2000}`;
          addLog(`文件 ${path} 超过 4000 行（共 ${lines.length} 行），已截取前后 2000 行。`, 'info');
        }

        addLog(`正在调用 AI 验证入口文件：${path}`, 'info');
        const { analysis: entryAnalysis, requestPayload, responseText } = await analyzeEntryFile(
          repoUrl,
          analysis.summary,
          analysis.mainLanguages,
          path,
          contentToSend
        );

        if (!entryAnalysis) {
          addLog(`AI 入口验证失败：${path}`, 'error', { request: requestPayload, response: responseText });
          continue;
        }

        addStageLog(`入口文件验证完成：${path}`, entryCheckStartedAt, entryAnalysis.isEntryFile ? 'success' : 'info', {
          request: requestPayload,
          response: responseText,
        });

        addLog(`AI 入口判断结果：${path} -> ${entryAnalysis.isEntryFile ? '是' : '否'}入口文件`, entryAnalysis.isEntryFile ? 'success' : 'info', {
          request: requestPayload,
          response: responseText,
        });

        if (!entryAnalysis.isEntryFile) {
          continue;
        }

        entryConfirmed = true;
        setConfirmedEntryFile({ path, reason: entryAnalysis.reason });
        addLog(`已确认项目入口文件：${path}，停止后续候选文件验证。`, 'success');

        setIsSubFunctionLoading(true);
        addLog(`开始分析入口文件 ${path} 的关键子函数...`, 'info');

        const allPaths = analyzablePathsRef.current.length > 0
          ? analyzablePathsRef.current
          : tree.filter((node) => node.type === 'blob').map((node) => node.path);

        const localEntryFunction = detectEntryFunctionCandidate(path, content);
        const aiEntryFunction =
          !localEntryFunction && entryAnalysis.entryFunctionName
            ? {
                name: entryAnalysis.entryFunctionName,
                snippet: findFunctionDefinitionInContent(entryAnalysis.entryFunctionName, content)?.snippet,
                reason: entryAnalysis.entryFunctionReason || entryAnalysis.reason,
              }
            : null;
        const resolvedEntryFunction = localEntryFunction || aiEntryFunction;

        if (resolvedEntryFunction) {
          addLog(`已确认入口函数：${resolvedEntryFunction.name}（${resolvedEntryFunction.reason}）`, 'success');
        } else {
          addLog('未能直接识别命名入口函数，将继续从入口文件整体代码分析执行流程。', 'info');
        }

        const subAnalysisStartedAt = Date.now();
        const { analysis: subAnalysis, requestPayload: subReq, responseText: subRes } = await analyzeSubFunctions(
          repoUrl,
          analysis.summary,
          path,
          resolvedEntryFunction?.snippet || contentToSend,
          allPaths,
          resolvedEntryFunction?.name
        );

        if (subAnalysis) {
          analysisNodeCountRef.current = 1;
          addStageLog(`入口函数关键子函数分析完成：${path}`, subAnalysisStartedAt, 'success', {
            request: subReq,
            response: subRes,
          });
          setSubFunctionAnalysis(subAnalysis);
          setSelectedPanoramaNodeId('root');
          setActivePanoramaNodeId('root');
          addLog(`AI 子函数分析完成，共识别出 ${subAnalysis.subFunctions.length} 个关键子函数`, 'success', {
            request: subReq,
            response: subRes,
          });

          await handleSelectFile(path, repo);
          await drillDownSubFunctions({
            repo,
            repoUrl,
            summary: analysis.summary,
            parentFunctionName: subAnalysis.entryFunctionName,
            parentFilePath: path,
            parentFileContent: content,
            subFunctions: subAnalysis.subFunctions,
            allFiles: allPaths,
            depth: 1,
            pathPrefix: [],
          });

          moduleAnalysisTriggeredRef.current = true;
          await applyModuleAnalysis({
            analysis: subAnalysis,
            entryFilePath: path,
            trigger: 'auto',
          });
        } else {
          addStageLog(`入口函数关键子函数分析失败：${path}`, subAnalysisStartedAt, 'error', {
            request: subReq,
            response: subRes,
          });
          addLog('AI 子函数分析失败。', 'error', { request: subReq, response: subRes });
        }

        setIsSubFunctionLoading(false);
        setActivePanoramaNodeId(null);
        break;
      } catch (err: any) {
        setIsSubFunctionLoading(false);
        setActivePanoramaNodeId(null);
        addLog(`获取或验证文件 ${path} 失败：${err.message}`, 'error');
      }
    }

    if (!entryConfirmed) {
      addLog('未在候选列表中确认真实入口文件，本次流程结束。', 'info');
    }

    setIsVerifyingEntry(false);
  };
  const analyzeTree = async (tree: GithubFileNode[], repo: GithubRepoInfo): Promise<ProjectAnalysis | null> => {
    setIsAiLoading(true);
    const startedAt = Date.now();
    const limits = getAnalysisLimits();
    addLog('开始准备 AI 分析...', 'info');

    try {
      const allPaths = tree.filter((node) => node.type === 'blob').map((node) => node.path);
      const codeFiles = allPaths.filter(isAnalyzableCodeFile);
      analyzablePathsRef.current = codeFiles;
      const symbolIndexPromise = buildRepositorySymbolIndex(repo, codeFiles);

      addLog(`过滤出 ${codeFiles.length} 个代码文件（总文件数：${allPaths.length}）`, 'info', {
        fileList: codeFiles,
      });

      const filesToAnalyze = codeFiles.slice(0, 1000);
      if (codeFiles.length > 1000) {
        addLog('文件数量过多，截取前 1000 个文件进行分析。', 'info', {
          fileList: filesToAnalyze,
        });
      }

      addLog('正在调用 AI 接口进行项目画像分析...', 'info');
      const { analysis, requestPayload, responseText } = await analyzeProjectFiles(filesToAnalyze);

      if (!analysis) {
        addStageLog('项目画像分析未返回有效结果。', startedAt, 'error', {
          request: requestPayload,
          response: responseText,
        });
        addLog('AI 分析未返回有效结果。', 'error', { request: requestPayload, response: responseText });
        return null;
      }

      const rankedEntryFiles = rankEntryFileCandidates(allPaths, analysis.entryFiles || []).slice(
        0,
        limits.MAX_ENTRY_FILE_CANDIDATES
      );

      const normalizedAnalysis: ProjectAnalysis = {
        ...analysis,
        entryFiles:
          rankedEntryFiles.length > 0
            ? rankedEntryFiles
            : (analysis.entryFiles || []).slice(0, limits.MAX_ENTRY_FILE_CANDIDATES),
      };

      await symbolIndexPromise;

      addStageLog(`项目画像分析完成，候选入口文件 ${normalizedAnalysis.entryFiles.length} 个`, startedAt, 'success', {
        request: requestPayload,
        response: responseText,
      });

      setAiAnalysis(normalizedAnalysis);
      return normalizedAnalysis;
    } catch (err: any) {
      console.error('AI Analysis failed:', err);
      addStageLog(`AI 分析过程中发生异常：${err.message}`, startedAt, 'error');
      return null;
    } finally {
      setIsAiLoading(false);
    }
  };
  const handleReanalyzeModules = async () => {
    if (isModuleReanalyzing || isAiLoading) {
      return;
    }

    if (!subFunctionAnalysis || !confirmedEntryFile?.path) {
      addLog('当前项目暂无可重新划分的模块上下文，请先完成函数分析。', 'error');
      return;
    }

    setIsModuleReanalyzing(true);

    try {
      moduleAnalysisTriggeredRef.current = true;
      await applyModuleAnalysis({
        analysis: subFunctionAnalysis,
        entryFilePath: confirmedEntryFile.path,
        trigger: 'manual',
      });
    } catch (err: any) {
      addLog(`手动重新划分模块失败：${err.message}`, 'error');
      setIsModuleReanalyzing(false);
    }
  };
  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    if (urlInput.trim() && urlInput !== urlParam) {
      navigate(`/analyze?url=${encodeURIComponent(urlInput)}`);
    }
  };

  const handleSelectFile = async (path: string, repoOverride?: GithubRepoInfo) => {
    if (activeFile === path) return;

    setActiveFile(path);

    if (!openedFiles.includes(path)) {
      setOpenedFiles(prev => [...prev, path]);
    }

    if (fileContents[path] !== undefined) {
      return; // Already loaded or loading
    }

    setLoadingFiles(prev => ({ ...prev, [path]: true }));

    try {
      const repo = repoOverride || repoInfo;
      if (!repo) throw new Error('仓库信息不可用');
      const content = await getRepositoryFileContent(repo, path);
      setFileContents(prev => ({ ...prev, [path]: content }));
    } catch (err: any) {
      setFileContents(prev => ({ ...prev, [path]: `加载失败: ${err.message}` }));
    } finally {
      setLoadingFiles(prev => ({ ...prev, [path]: false }));
    }
  };
  const handleCloseFile = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    setOpenedFiles(prev => {
      const newOpened = prev.filter(p => p !== path);
      if (activeFile === path) {
        setActiveFile(newOpened.length > 0 ? newOpened[newOpened.length - 1] : null);
      }
      return newOpened;
    });
  };

  const handleSelectPanoramaNode = async (
    nodeId: string,
    node: { filePath?: string; snippet?: string }
  ) => {
    setSelectedPanoramaNodeId(nodeId);

    if (node.filePath) {
      await handleSelectFile(node.filePath);
    }
  };

  const handleSettingsClose = () => {
    setIsSettingsOpen(false);
    // Auto retry if we had a rate limit error
    if (error && error.includes('rate limit')) {
      loadRepository(urlParam);
    }
  };

  return (
    <div className="h-screen bg-zinc-950 text-zinc-50 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-zinc-800 bg-zinc-900/50 flex items-center px-4 shrink-0">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-zinc-400 hover:text-zinc-100 transition-colors mr-6"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-emerald-400 font-semibold text-lg">
          <Github className="w-6 h-6" />
          <span>代码分析工作台</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {repoInfo && (
            <div className="flex items-center gap-2 text-sm text-zinc-400 bg-zinc-800/50 px-3 py-1.5 rounded-full border border-zinc-700/50">
              <span className="text-zinc-300">{repoInfo.owner}</span>
              <span className="text-zinc-600">/</span>
              <span className="text-zinc-100 font-medium">{repoInfo.repo}</span>
              <span className="text-zinc-600 px-1">·</span>
              <span className="text-emerald-400/80">{repoInfo.defaultBranch}</span>
            </div>
          )}
          <div className="hidden lg:flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/70 p-1">
            <button
              onClick={() => togglePanel('files')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${
                panelVisibility.files
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'text-zinc-500 hover:text-zinc-200'
              }`}
              title="显示或隐藏文件列表"
            >
              <FileTerminal className="w-3.5 h-3.5" />
              <span>文件</span>
            </button>
            <button
              onClick={() => togglePanel('source')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${
                panelVisibility.source
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'text-zinc-500 hover:text-zinc-200'
              }`}
              title="显示或隐藏源码面板"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>源码</span>
            </button>
            <button
              onClick={() => togglePanel('panorama')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${
                panelVisibility.panorama
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'text-zinc-500 hover:text-zinc-200'
              }`}
              title="显示或隐藏全景图面板"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>全景图</span>
            </button>
          </div>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-full transition-colors"
            title="设置"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>
      {/* Main Content - 3 Columns */}
      <div ref={desktopLayoutRef} className="flex-1 flex overflow-hidden relative">
        {/* Left Column: Input & Info */}
        <div
          className={`w-full lg:w-[var(--overview-width)] border-r border-zinc-800 bg-zinc-900/30 p-4 flex-col gap-6 shrink-0 overflow-y-auto custom-scrollbar ${files.length > 0 || isTreeLoading ? 'hidden lg:flex' : 'flex'}`}
          style={{ ['--overview-width' as string]: `${panelWidths.overview}px` }}
        >
          <form onSubmit={handleAnalyze} className="space-y-2">
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              仓库地址
            </label>
            <div className="relative">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://github.com/..."
                className="w-full pl-3 pr-10 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
              />
              <button
                type="submit"
                className="absolute inset-y-0 right-0 px-3 flex items-center text-zinc-500 hover:text-emerald-400 transition-colors"
              >
                <Search className="w-4 h-4" />
              </button>
            </div>
          </form>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex flex-col gap-2 text-red-400 text-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <p className="break-words">{error}</p>
              </div>
              {error.includes('rate limit') && (
                <button 
                  onClick={() => setIsSettingsOpen(true)}
                  className="text-xs bg-red-500/20 hover:bg-red-500/30 text-red-300 py-1.5 px-3 rounded-md transition-colors self-start ml-6"
                >
                  去设置 GitHub Token
                </button>
              )}
            </div>
          )}

          {/* Logs Section */}
          <div className="flex flex-col gap-2 border border-zinc-800/80 rounded-2xl bg-zinc-900/40 overflow-hidden shrink-0 shadow-sm">
            <div className="flex items-center justify-between p-3.5 bg-zinc-800/20 hover:bg-zinc-800/40 transition-colors">
              <button
                onClick={() => setIsLogsExpanded(!isLogsExpanded)}
                className="flex items-center gap-2 text-zinc-300 text-sm font-medium flex-1 text-left"
              >
                <Activity className="w-4 h-4 text-emerald-500" />
                <span>AI 工作日志</span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${workflowStatusMeta.className}`}>
                  {workflowStatusMeta.showSpinner && <Loader2 className="h-3 w-3 animate-spin" />}
                  {workflowStatusMeta.label}
                </span>
                {isLogsExpanded ? (
                  <ChevronDown className="w-4 h-4 text-zinc-500 ml-1" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-zinc-500 ml-1" />
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsFullScreenLogs(true);
                }}
                className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 rounded-full transition-colors"
                title="全屏查看日志"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>

            {isLogsExpanded && (
              <>
                <div className="px-4 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {(['all', 'info', 'success', 'error'] as LogFilter[]).map((filter) => {
                      const labels: Record<LogFilter, string> = {
                        all: '全部',
                        info: 'INFO',
                        success: 'SUCCESS',
                        error: 'ERROR',
                      };
                      const active = logFilter === filter;
                      return (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setLogFilter(filter)}
                          className={
                            'rounded-full border px-2.5 py-1 text-[11px] transition-colors ' +
                            (active
                              ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-200'
                              : 'border-zinc-700 bg-zinc-900/70 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300')
                          }
                        >
                          {labels[filter]} ({logCounts[filter]})
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="px-4 pb-4 space-y-3 max-h-72 overflow-y-auto custom-scrollbar">
                  {filteredLogs.length > 0 ? (
                    filteredLogs.map((log) => <LogItem key={log.id} log={log} />)
                  ) : (
                    <div className="text-xs text-zinc-500">当前筛选条件下暂无日志</div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* AI Analysis Section */}
          {(isAiLoading || aiAnalysis || files.length > 0) && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-emerald-400 border-b border-zinc-800 pb-2">
                <Sparkles className="w-4 h-4" />
                <h3 className="font-medium text-sm">AI 项目分析</h3>
              </div>

              {isAiLoading ? (
                <div className="flex flex-col items-center justify-center py-8 text-zinc-500 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                  <span className="text-sm">正在调用 AI 分析项目结构...</span>
                </div>
              ) : aiAnalysis ? (
                <div className="space-y-5 text-sm">
                  <div className="space-y-2">
                    <p className="text-zinc-300 leading-relaxed">{aiAnalysis.summary}</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <Code2 className="w-4 h-4" />
                      <span className="font-medium">主要语言</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {aiAnalysis.mainLanguages.map((lang, i) => (
                        <span key={i} className="px-2 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-md text-xs">
                          {lang}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <Layers className="w-4 h-4" />
                      <span className="font-medium">技术栈</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {aiAnalysis.techStack.map((tech, i) => (
                        <span key={i} className="px-2 py-1 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-md text-xs">
                          {tech}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-zinc-400">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4" />
                        <span className="font-medium">功能模块</span>
                      </div>
                      <button
                        onClick={handleReanalyzeModules}
                        disabled={isModuleReanalyzing || isAiLoading}
                        className="inline-flex items-center gap-1.5 text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 hover:text-emerald-300 py-1 px-2.5 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isModuleReanalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        <span>{isModuleReanalyzing ? '重新划分中...' : '重新划分'}</span>
                      </button>
                    </div>

                    {functionModules.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveModuleId(null)}
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            activeModuleId === null
                              ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200'
                              : 'border-zinc-700 bg-zinc-800/60 text-zinc-300 hover:border-zinc-500'
                          }`}
                        >
                          全部模块
                        </button>
                        {functionModules.map((module) => {
                          const isActive = activeModuleId === module.moduleId;
                          return (
                            <button
                              type="button"
                              key={module.moduleId}
                              onClick={() => setActiveModuleId(module.moduleId)}
                              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                isActive ? 'ring-1 ring-white/30' : ''
                              }`}
                              style={{
                                color: module.color,
                                borderColor: `${module.color}66`,
                                backgroundColor: isActive ? `${module.color}33` : `${module.color}1A`,
                              }}
                              title={module.description}
                            >
                              {module.moduleName} ({module.functionNodeIds.length})
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-500">
                        模块分析尚未完成。完成函数分析后，这里会展示模块划分结果，并可点击标签筛选全景图节点。                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <FileTerminal className="w-4 h-4" />
                      <span className="font-medium">入口文件</span>
                    </div>

                    {confirmedEntryFile ? (
                      <div className="mt-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                        <div className="flex items-center gap-2 text-emerald-400 font-medium mb-1.5">
                          <CheckCircle className="w-4 h-4" />
                          <span className="truncate" title={confirmedEntryFile.path}>{confirmedEntryFile.path}</span>
                        </div>
                        <p className="text-zinc-400 text-xs leading-relaxed mb-3">{confirmedEntryFile.reason}</p>
                        <button
                          onClick={() => handleSelectFile(confirmedEntryFile.path)}
                          className="text-xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 py-1.5 px-3 rounded-lg transition-colors"
                        >
                          查看文件
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {aiAnalysis.entryFiles.map((file, i) => (
                          <button
                            key={i}
                            onClick={() => handleSelectFile(file)}
                            className="text-left px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs text-zinc-300 hover:text-emerald-400 transition-colors truncate"
                            title={file}
                          >
                            {file}
                          </button>
                        ))}
                      </div>
                    )}

                    {isVerifyingEntry && !confirmedEntryFile && (
                      <div className="mt-3 flex items-center gap-2 text-zinc-400 text-xs bg-zinc-900/50 p-2 rounded-lg border border-zinc-800/50">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
                        <span>正在逐个验证候选入口文件...</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                  <p className="text-xs leading-relaxed text-zinc-400">
                    完成项目分析后，这里会展示模块划分结果、入口文件信息以及关键技术栈，帮助我们快速理解项目结构。                  </p>
                  <button
                    onClick={handleReanalyzeModules}
                    disabled={isModuleReanalyzing || isAiLoading}
                    className="inline-flex items-center gap-2 text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 hover:text-emerald-300 py-1.5 px-3 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isModuleReanalyzing ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>重新划分中...</span>
                      </>
                    ) : (
                      <>
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>重新划分功能模块</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {!isAiLoading && !aiAnalysis && files.length === 0 && !error && (
            <div className="flex-1 border border-dashed border-zinc-800 rounded-xl flex items-center justify-center text-zinc-600 text-sm p-4 text-center">
              <p>输入仓库地址后，AI 将自动分析项目结构和技术栈。</p>
            </div>
          )}
        </div>

        {showOverviewResizeHandle && <ResizeHandle onMouseDown={startResize('overview')} />}

        {/* Middle Column: File Tree */}
        <div
          className={`${panelVisibility.files ? ((files.length === 0 && !isTreeLoading) ? 'hidden lg:flex' : activeFile ? 'hidden lg:flex' : 'flex') : 'hidden'} w-full lg:w-[var(--files-width)] border-r border-zinc-800 bg-zinc-900/10 flex-col shrink-0`}
          style={{ ['--files-width' as string]: `${panelWidths.files}px` }}
        >
          <div className="h-10 border-b border-zinc-800 flex items-center px-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider shrink-0 bg-zinc-900/30 justify-between">
            <span>文件列表</span>
            <button 
              onClick={() => { setFiles([]); setRepoInfo(null); navigate('/'); }}
              className="lg:hidden text-zinc-500 hover:text-zinc-300"
            >
              返回首页
            </button>
          </div>
          <div className="flex-1 overflow-hidden relative">
            {isTreeLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                <span className="text-sm">正在加载仓库文件树...</span>
              </div>
            ) : files.length > 0 ? (
              <FileTree 
                files={files} 
                onSelectFile={handleSelectFile} 
                selectedFile={activeFile}
              />
            ) : !error ? (
              <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm text-center px-4">
                仓库已加载，但暂未获取到可展示的文件。              </div>
            ) : null}
          </div>
        </div>

        {showFilesResizeHandle && <ResizeHandle onMouseDown={startResize('files')} />}

        {/* Right Area: Code Viewer & Panorama */}
        <div
          ref={rightAreaRef}
          className={`${rightPanelsVisible ? ((activeFile || confirmedEntryFile) ? 'flex' : 'hidden lg:flex') : 'hidden'} flex-1 flex-col lg:flex-row overflow-hidden min-w-0`}
        >
          {/* Code Viewer */}
          <div
            className={`${panelVisibility.source ? (activeFile ? 'flex' : 'hidden lg:flex') : 'hidden'} ${panelVisibility.panorama ? 'lg:w-[var(--source-width)] lg:shrink-0' : 'flex-1'} bg-zinc-950 overflow-hidden flex-col min-w-0 lg:border-r border-zinc-800`}
            style={panelVisibility.panorama ? { ['--source-width' as string]: `${panelWidths.source}px` } : undefined}
          >
            {/* Tabs */}
            {openedFiles.length > 0 && (
              <div className="flex bg-zinc-900 border-b border-zinc-800 overflow-x-auto custom-scrollbar shrink-0">
                {openedFiles.map(path => (
                  <div 
                    key={path}
                    onClick={() => setActiveFile(path)}
                    className={`flex items-center gap-2 px-4 py-2 text-sm border-r border-zinc-800 cursor-pointer whitespace-nowrap group ${
                      activeFile === path ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
                    }`}
                  >
                    <span className="truncate max-w-[150px]" title={path}>
                      {path.split('/').pop()}
                    </span>
                    <button 
                      onClick={(e) => handleCloseFile(e, path)}
                      className="p-0.5 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-hidden relative">
              {activeFile && (
                <button 
                  onClick={() => setActiveFile(null)}
                  className="lg:hidden m-4 flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors w-fit absolute top-0 left-0 z-10"
                >
                  <ArrowLeft className="w-4 h-4" />
                  返回文件列表
                </button>
              )}
              <CodeViewer 
                content={activeFile ? fileContents[activeFile] : null} 
                path={activeFile} 
                isLoading={activeFile ? loadingFiles[activeFile] : false} 
              />
            </div>
          </div>

          {showSourceResizeHandle && <ResizeHandle onMouseDown={startResize('source')} />}

          {/* Panorama Panel */}
          <div className={`${panelVisibility.panorama ? 'flex' : 'hidden'} flex-1 overflow-hidden flex-col min-w-0 bg-zinc-950 relative`}>
             <div className="h-10 border-b border-zinc-800 flex items-center px-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider shrink-0 bg-zinc-900/30 z-10">
               <span>全景图</span>
             </div>
             {subFunctionAnalysis ? (
                <>
                  <PanoramaTree
                    analysis={subFunctionAnalysis}
                    entryFilePath={confirmedEntryFile?.path || ''}
                    selectedNodeId={selectedPanoramaNodeId}
                    activeNodeId={activePanoramaNodeId}
                    nodeModuleMap={nodeModuleMap}
                    moduleColorMap={moduleColorMap}
                    activeModuleId={activeModuleId}
                    onSelectNode={handleSelectPanoramaNode}
                  />
                  {isSubFunctionLoading && (
                    <div className="absolute top-14 right-4 z-10 flex items-center gap-2 rounded-full border border-emerald-500/20 bg-zinc-900/85 px-3 py-1.5 text-xs text-emerald-300 shadow-lg backdrop-blur-sm">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>正在分析函数调用链...</span>
                    </div>
                  )}
                </>
             ) : isSubFunctionLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                  <span className="text-sm">正在生成函数全景图...</span>
                </div>
             ) : (
                <PanoramaTree
                  analysis={subFunctionAnalysis}
                  entryFilePath={confirmedEntryFile?.path || ''}
                  selectedNodeId={selectedPanoramaNodeId}
                  activeNodeId={activePanoramaNodeId}
                  nodeModuleMap={nodeModuleMap}
                  moduleColorMap={moduleColorMap}
                  activeModuleId={activeModuleId}
                  onSelectNode={handleSelectPanoramaNode}
                />
             )}
          </div>
        </div>
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={handleSettingsClose} />

      {/* Full Screen Logs Modal */}
      {isFullScreenLogs && (
        <div className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center p-4 lg:p-8">
          <div className="bg-zinc-900 border border-zinc-800/80 rounded-3xl w-full h-full max-w-5xl flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-zinc-800/80 bg-zinc-900/50">
            <div className="flex items-center gap-2 text-emerald-400 font-medium text-lg">
              <Activity className="w-5 h-5" />
              <span>AI 工作日志（全屏）</span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${workflowStatusMeta.className}`}>
                {workflowStatusMeta.showSpinner && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {workflowStatusMeta.label}
              </span>
            </div>
              <button onClick={() => setIsFullScreenLogs(false)} className="text-zinc-400 hover:text-zinc-100 p-2 rounded-full hover:bg-zinc-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="border-b border-zinc-800/80 px-6 py-3 bg-zinc-900/60">
              <div className="flex flex-wrap items-center gap-2">
                {(['all', 'info', 'success', 'error'] as LogFilter[]).map((filter) => {
                  const labels: Record<LogFilter, string> = {
                    all: '全部',
                    info: 'INFO',
                    success: 'SUCCESS',
                    error: 'ERROR',
                  };
                  const active = logFilter === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setLogFilter(filter)}
                      className={
                        'rounded-full border px-2.5 py-1 text-xs transition-colors ' +
                        (active
                          ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-200'
                          : 'border-zinc-700 bg-zinc-900/70 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300')
                      }
                    >
                      {labels[filter]} ({logCounts[filter]})
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-zinc-900/30">
              {filteredLogs.length > 0 ? (
                filteredLogs.map((log) => <LogItem key={log.id} log={log} />)
              ) : (
                <div className="text-sm text-zinc-500">当前筛选条件下暂无日志</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}








