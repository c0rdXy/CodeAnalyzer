import {
  EntryFunctionAnalysis,
  FunctionModuleGroup,
  ProjectAnalysis,
  SubFunctionAnalysis,
} from '../services/analysisAi';
import { GithubFileNode, GithubRepoInfo } from './github';

const STORAGE_KEY = 'code_analyzer_history_v1';
const MAX_HISTORY_ITEMS = 24;

export interface StoredLogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error';
  request?: unknown;
  response?: unknown;
  fileList?: string[];
}

export interface AnalysisSnapshot {
  repoUrl: string;
  repoInfo: GithubRepoInfo | null;
  files: GithubFileNode[];
  aiAnalysis: ProjectAnalysis | null;
  confirmedEntryFile: { path: string; reason: string } | null;
  subFunctionAnalysis: EntryFunctionAnalysis | null;
  functionModules?: FunctionModuleGroup[];
  nodeModuleMap?: Record<string, string>;
  logs: StoredLogEntry[];
}

export interface AnalysisHistoryItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  projectName: string;
  repoUrl: string;
  summary: string;
  mainLanguages: string[];
  techStack: string[];
  markdown: string;
  snapshot: AnalysisSnapshot;
}

function safeParseHistory(raw: string | null): AnalysisHistoryItem[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatDate(date: string) {
  try {
    return new Date(date).toLocaleString('zh-CN');
  } catch {
    return date;
  }
}

function renderFunctionTree(nodes: SubFunctionAnalysis[], depth = 0): string {
  if (nodes.length === 0) {
    return `${'  '.repeat(depth)}- 暂无`;
  }

  return nodes
    .map((node) => {
      const prefix = '  '.repeat(depth);
      const location = node.resolvedFile || node.file || '未知文件';
      const drillDownText =
        node.drillDown === 1 ? '建议继续下钻' : node.drillDown === -1 ? '无需继续下钻' : '可选继续下钻';
      const lines = [
        `${prefix}- 函数: ${node.name}`,
        `${prefix}  文件: ${location}`,
        `${prefix}  说明: ${node.description}`,
        `${prefix}  下钻判断: ${drillDownText}`,
      ];

      if (node.stopReason) {
        lines.push(`${prefix}  停止原因: ${node.stopReason}`);
      }

      if (node.children && node.children.length > 0) {
        lines.push(`${prefix}  子调用:`);
        lines.push(renderFunctionTree(node.children, depth + 2).trimEnd());
      }

      return lines.join('\n');
    })
    .join('\n');
}

function renderModuleList(modules: FunctionModuleGroup[] | undefined): string {
  if (!modules || modules.length === 0) {
    return '- 暂无模块划分结果';
  }

  return modules
    .map((module, index) => {
      const nodeCount = module.functionNodeIds.length;
      return [
        `${index + 1}. ${module.moduleName} (${nodeCount} 个节点)`,
        `   - moduleId: ${module.moduleId}`,
        `   - 说明: ${module.description || '暂无说明'}`,
      ].join('\n');
    })
    .join('\n');
}

export function buildAnalysisMarkdown(item: Omit<AnalysisHistoryItem, 'markdown'>): string {
  const { snapshot } = item;
  const fileList = snapshot.files.map((file) => `- ${file.type}: ${file.path}`).join('\n') || '- 暂无';
  const logList =
    snapshot.logs
      .map((log) => `- [${formatDate(log.timestamp)}] (${log.type}) ${log.message}`)
      .join('\n') || '- 暂无';

  const functionTree = snapshot.subFunctionAnalysis
    ? [
        `入口函数: ${snapshot.subFunctionAnalysis.entryFunctionName}`,
        `总体说明: ${snapshot.subFunctionAnalysis.summary || '暂无'}`,
        '调用链:',
        renderFunctionTree(snapshot.subFunctionAnalysis.subFunctions).trimEnd(),
      ].join('\n')
    : '暂无调用链分析结果';

  return [
    `# ${item.projectName}`,
    '',
    '## 项目概览',
    `- 项目名称: ${item.projectName}`,
    `- 项目地址: ${item.repoUrl}`,
    `- 创建时间: ${formatDate(item.createdAt)}`,
    `- 最近更新: ${formatDate(item.updatedAt)}`,
    `- 默认分支: ${snapshot.repoInfo?.defaultBranch || '未知'}`,
    '',
    '## 基本信息',
    `- 项目简介: ${item.summary || '暂无'}`,
    `- 编程语言: ${item.mainLanguages.join(', ') || '暂无'}`,
    `- 技术栈: ${item.techStack.join(', ') || '暂无'}`,
    `- 入口文件: ${snapshot.confirmedEntryFile?.path || '未确认'}`,
    `- 入口文件说明: ${snapshot.confirmedEntryFile?.reason || '暂无'}`,
    '',
    '## 功能模块划分',
    renderModuleList(snapshot.functionModules),
    '',
    '## 文件列表',
    fileList,
    '',
    '## 完整调用链',
    functionTree,
    '',
    '## Agent 工作日志',
    logList,
    '',
  ].join('\n');
}

export function getAnalysisHistory(): AnalysisHistoryItem[] {
  if (typeof window === 'undefined') {
    return [];
  }

  return safeParseHistory(window.localStorage.getItem(STORAGE_KEY)).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function getAnalysisHistoryItem(id: string): AnalysisHistoryItem | null {
  return getAnalysisHistory().find((item) => item.id === id) || null;
}

export function saveAnalysisHistory(
  item: Omit<AnalysisHistoryItem, 'markdown'> & { markdown?: string }
): AnalysisHistoryItem {
  const previous = getAnalysisHistory().find((historyItem) => historyItem.id === item.id);
  const baseItem: Omit<AnalysisHistoryItem, 'markdown'> = {
    ...item,
    createdAt: previous?.createdAt || item.createdAt,
  };
  const nextItem: AnalysisHistoryItem = {
    ...baseItem,
    markdown: item.markdown || buildAnalysisMarkdown(baseItem),
  };

  const previousItems = getAnalysisHistory().filter((historyItem) => historyItem.id !== nextItem.id);
  const merged = [nextItem, ...previousItems].slice(0, MAX_HISTORY_ITEMS);

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return nextItem;
}

export function deleteAnalysisHistoryItem(id: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const previousItems = getAnalysisHistory();
  const nextItems = previousItems.filter((historyItem) => historyItem.id !== id);

  if (nextItems.length === previousItems.length) {
    return false;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextItems));
  return true;
}
