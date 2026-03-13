import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Github, Search, AlertCircle, Loader2, ArrowLeft, Settings, Sparkles, Code2, Layers, FileTerminal, Activity, ChevronDown, ChevronRight, Maximize2, X, CheckCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { parseGithubUrl, fetchRepoInfo, fetchFileTree, fetchFileContent, GithubFileNode, GithubRepoInfo } from '../utils/github';
import FileTree from '../components/FileTree';
import CodeViewer from '../components/CodeViewer';
import SettingsModal from '../components/SettingsModal';
import PanoramaPanel from '../components/PanoramaPanel';
import { analyzeProjectFiles, analyzeEntryFile, analyzeSubFunctions, ProjectAnalysis, EntryFunctionAnalysis } from '../services/ai';

interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'error';
  request?: any;
  response?: any;
  fileList?: string[];
}

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

const LogItem = ({ log }: { log: LogEntry }) => {
  const [expanded, setExpanded] = useState<'request' | 'response' | 'fileList' | null>(null);

  const toggle = (section: 'request' | 'response' | 'fileList') => {
    setExpanded(prev => prev === section ? null : section);
  };

  return (
    <div className="text-xs space-y-1.5 py-1">
      <div className="flex items-start gap-2">
        <span className="text-zinc-500 shrink-0 mt-0.5 font-mono">
          {log.timestamp.toLocaleTimeString()}
        </span>
        <span className={`flex-1 mt-0.5 leading-relaxed ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : 'text-zinc-300'}`}>
          {log.message}
        </span>
        <div className="flex flex-wrap gap-1.5 shrink-0 justify-end">
          {log.fileList && (
            <button onClick={() => toggle('fileList')} className={`px-2.5 py-1 rounded-full transition-colors ${expanded === 'fileList' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'}`}>
              {expanded === 'fileList' ? '收起文件' : '文件清单'}
            </button>
          )}
          {log.request && (
            <button onClick={() => toggle('request')} className={`px-2.5 py-1 rounded-full transition-colors ${expanded === 'request' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'}`}>
              {expanded === 'request' ? '收起请求' : '请求详情'}
            </button>
          )}
          {log.response && (
            <button onClick={() => toggle('response')} className={`px-2.5 py-1 rounded-full transition-colors ${expanded === 'response' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'}`}>
              {expanded === 'response' ? '收起响应' : '响应详情'}
            </button>
          )}
        </div>
      </div>
      {expanded === 'fileList' && log.fileList && (
        <div className="mt-2 p-3 bg-zinc-950/80 rounded-2xl border border-zinc-800/80 overflow-x-auto max-h-64 overflow-y-auto custom-scrollbar shadow-inner">
          <pre className="text-zinc-400 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all">
            {JSON.stringify(log.fileList, null, 2)}
          </pre>
        </div>
      )}
      {expanded === 'request' && log.request && (
        <div className="mt-2 p-3 bg-zinc-950/80 rounded-2xl border border-zinc-800/80 overflow-x-auto max-h-64 overflow-y-auto custom-scrollbar shadow-inner">
          <pre className="text-zinc-400 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all">
            {JSON.stringify(truncateJson(log.request), null, 2)}
          </pre>
        </div>
      )}
      {expanded === 'response' && log.response && (
        <div className="mt-2 p-3 bg-zinc-950/80 rounded-2xl border border-zinc-800/80 overflow-x-auto max-h-64 overflow-y-auto custom-scrollbar shadow-inner">
          <pre className="text-zinc-400 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all">
            {JSON.stringify(truncateJson(log.response), null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default function Analyze() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlParam = searchParams.get('url') || '';

  const [urlInput, setUrlInput] = useState(urlParam);
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

  const [confirmedEntryFile, setConfirmedEntryFile] = useState<{ path: string, reason: string } | null>(null);
  const [isVerifyingEntry, setIsVerifyingEntry] = useState(false);

  const [subFunctionAnalysis, setSubFunctionAnalysis] = useState<EntryFunctionAnalysis | null>(null);
  const [isSubFunctionLoading, setIsSubFunctionLoading] = useState(false);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLogsExpanded, setIsLogsExpanded] = useState(true);
  const [isFullScreenLogs, setIsFullScreenLogs] = useState(false);
  
  const lastLoadedUrl = useRef<string | null>(null);

  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info', extra?: { request?: any, response?: any, fileList?: string[] }) => {
    setLogs(prev => [...prev, {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date(),
      message,
      type,
      ...extra
    }]);
  };

  useEffect(() => {
    if (urlParam && urlParam !== lastLoadedUrl.current) {
      lastLoadedUrl.current = urlParam;
      loadRepository(urlParam);
    }
  }, [urlParam]);

  const loadRepository = async (repoUrl: string) => {
    setError(null);
    setRepoInfo(null);
    setFiles([]);
    setOpenedFiles([]);
    setActiveFile(null);
    setFileContents({});
    setLoadingFiles({});
    setAiAnalysis(null);
    setConfirmedEntryFile(null);
    setSubFunctionAnalysis(null);
    setIsTreeLoading(true);
    setLogs([]);

    addLog(`开始校验 GitHub 地址: ${repoUrl}`, 'info');

    try {
      const parsed = parseGithubUrl(repoUrl);
      if (!parsed) {
        throw new Error('无效的 GitHub 地址');
      }
      addLog(`地址解析成功: ${parsed.owner}/${parsed.repo}`, 'success');

      const info = await fetchRepoInfo(parsed.owner, parsed.repo);
      setRepoInfo(info);
      addLog(`获取仓库信息成功，默认分支: ${info.defaultBranch}`, 'success');

      const tree = await fetchFileTree(info.owner, info.repo, info.defaultBranch);
      setFiles(tree);
      addLog(`获取文件树成功，共 ${tree.length} 个文件/目录`, 'success');

      // Trigger AI Analysis
      const analysisResult = await analyzeTree(tree);
      
      // Trigger Entry File Verification
      if (analysisResult && analysisResult.entryFiles && analysisResult.entryFiles.length > 0) {
        await verifyEntryFiles(analysisResult, info, repoUrl, tree);
      }

    } catch (err: any) {
      setError(err.message || '加载仓库失败');
      addLog(`加载失败: ${err.message}`, 'error');
    } finally {
      setIsTreeLoading(false);
    }
  };

  const verifyEntryFiles = async (analysis: ProjectAnalysis, repo: GithubRepoInfo, repoUrl: string, tree: GithubFileNode[]) => {
    setIsVerifyingEntry(true);
    setConfirmedEntryFile(null);
    addLog(`开始逐个研判 ${analysis.entryFiles.length} 个可能的入口文件...`, 'info');

    for (const path of analysis.entryFiles) {
      addLog(`正在获取可能入口文件的内容: ${path}`, 'info');
      try {
        const content = await fetchFileContent(repo.owner, repo.repo, repo.defaultBranch, path);
        
        const lines = content.split('\n');
        let contentToSend = content;
        if (lines.length > 4000) {
          const first2000 = lines.slice(0, 2000).join('\n');
          const last2000 = lines.slice(-2000).join('\n');
          contentToSend = `${first2000}\n\n... [中间省略 ${lines.length - 4000} 行] ...\n\n${last2000}`;
          addLog(`文件 ${path} 超过 4000 行 (共 ${lines.length} 行)，已截取前后 2000 行`, 'info');
        }

        addLog(`正在呼叫 AI 研判文件: ${path}`, 'info');
        const { analysis: entryAnalysis, requestPayload, responseText } = await analyzeEntryFile(
          repoUrl,
          analysis.summary,
          analysis.mainLanguages,
          path,
          contentToSend
        );

        if (entryAnalysis) {
          addLog(`AI 研判完成: ${path} -> ${entryAnalysis.isEntryFile ? '是' : '否'}入口文件`, entryAnalysis.isEntryFile ? 'success' : 'info', { request: requestPayload, response: responseText });
          
          if (entryAnalysis.isEntryFile) {
            setConfirmedEntryFile({ path, reason: entryAnalysis.reason });
            addLog(`已确认项目入口文件: ${path}，停止后续研判。`, 'success');
            
            // Start sub-function analysis
            setIsSubFunctionLoading(true);
            addLog(`开始分析入口文件 ${path} 的关键子函数...`, 'info');
            const allPaths = tree.filter(n => n.type === 'blob').map(n => n.path);
            const { analysis: subAnalysis, requestPayload: subReq, responseText: subRes } = await analyzeSubFunctions(
              repoUrl,
              analysis.summary,
              path,
              contentToSend,
              allPaths
            );
            
            if (subAnalysis) {
              setSubFunctionAnalysis(subAnalysis);
              addLog(`AI 子函数分析完成，共识别出 ${subAnalysis.subFunctions.length} 个关键子函数`, 'success', { request: subReq, response: subRes });
            } else {
              addLog(`AI 子函数分析失败`, 'error', { request: subReq, response: subRes });
            }
            setIsSubFunctionLoading(false);
            
            break;
          }
        } else {
          addLog(`AI 研判失败: ${path}`, 'error', { request: requestPayload, response: responseText });
        }
      } catch (err: any) {
        addLog(`获取或研判文件 ${path} 失败: ${err.message}`, 'error');
      }
    }
    setIsVerifyingEntry(false);
  };

  const analyzeTree = async (tree: GithubFileNode[]): Promise<ProjectAnalysis | null> => {
    setIsAiLoading(true);
    addLog('开始准备 AI 分析...', 'info');
    try {
      // Extract all file paths
      const allPaths: string[] = [];
      for (const node of tree) {
        if (node.type === 'blob') {
          allPaths.push(node.path);
        }
      }

      // Filter code files
      const codeExtensions = [
        'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 
        'rb', 'php', 'swift', 'kt', 'dart', 'sh', 'bash', 'html', 'css', 'scss', 'less', 
        'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'graphql', 'vue', 'svelte'
      ];
      const codeFiles = allPaths.filter(path => {
        const ext = path.split('.').pop()?.toLowerCase();
        return ext && codeExtensions.includes(ext);
      });

      addLog(`过滤出 ${codeFiles.length} 个代码文件 (总文件数: ${allPaths.length})`, 'info', { fileList: codeFiles });

      // Limit files to avoid huge payloads
      const filesToAnalyze = codeFiles.slice(0, 1000);
      if (codeFiles.length > 1000) {
        addLog(`文件数量过多，截取前 1000 个文件进行分析`, 'info', { fileList: filesToAnalyze });
      }
      
      addLog('正在调用 AI 接口进行分析...', 'info');
      const { analysis, requestPayload, responseText } = await analyzeProjectFiles(filesToAnalyze);
      
      if (analysis) {
        addLog('AI 分析成功', 'success', { request: requestPayload, response: responseText });
        setAiAnalysis(analysis);
        return analysis;
      } else {
        addLog('AI 分析未返回有效结果', 'error', { request: requestPayload, response: responseText });
        return null;
      }
    } catch (err: any) {
      console.error("AI Analysis failed:", err);
      addLog(`AI 分析过程发生异常: ${err.message}`, 'error');
      return null;
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    if (urlInput.trim() && urlInput !== urlParam) {
      navigate(`/analyze?url=${encodeURIComponent(urlInput)}`);
    }
  };

  const handleSelectFile = async (path: string) => {
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
      if (!repoInfo) throw new Error('缺少仓库信息');
      const content = await fetchFileContent(repoInfo.owner, repoInfo.repo, repoInfo.defaultBranch, path);
      setFileContents(prev => ({ ...prev, [path]: content }));
    } catch (err: any) {
      setFileContents(prev => ({ ...prev, [path]: `加载文件出错: ${err.message}` }));
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
          <span>代码分析器</span>
        </div>
        
        <div className="ml-auto flex items-center gap-4">
          {repoInfo && (
            <div className="flex items-center gap-2 text-sm text-zinc-400 bg-zinc-800/50 px-3 py-1.5 rounded-full border border-zinc-700/50">
              <span className="text-zinc-300">{repoInfo.owner}</span>
              <span className="text-zinc-600">/</span>
              <span className="text-zinc-100 font-medium">{repoInfo.repo}</span>
              <span className="text-zinc-600 px-1">•</span>
              <span className="text-emerald-400/80">{repoInfo.defaultBranch}</span>
            </div>
          )}
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
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Column: Input & Info */}
        <div className={`w-full lg:w-80 border-r border-zinc-800 bg-zinc-900/30 p-4 flex-col gap-6 shrink-0 overflow-y-auto custom-scrollbar ${files.length > 0 || isTreeLoading ? 'hidden lg:flex' : 'flex'}`}>
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
                  添加 GitHub Token
                </button>
              )}
            </div>
          )}

          {/* Logs Section */}
          {logs.length > 0 && (
            <div className="flex flex-col gap-2 border border-zinc-800/80 rounded-2xl bg-zinc-900/40 overflow-hidden shrink-0 shadow-sm">
              <div className="flex items-center justify-between p-3.5 bg-zinc-800/20 hover:bg-zinc-800/40 transition-colors">
                <button 
                  onClick={() => setIsLogsExpanded(!isLogsExpanded)}
                  className="flex items-center gap-2 text-zinc-300 text-sm font-medium flex-1 text-left"
                >
                  <Activity className="w-4 h-4 text-emerald-500" />
                  工作日志
                  {isLogsExpanded ? <ChevronDown className="w-4 h-4 text-zinc-500 ml-1" /> : <ChevronRight className="w-4 h-4 text-zinc-500 ml-1" />}
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); setIsFullScreenLogs(true); }}
                  className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 rounded-full transition-colors"
                  title="全屏查看"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
              
              {isLogsExpanded && (
                <div className="p-4 pt-0 space-y-3 max-h-72 overflow-y-auto custom-scrollbar">
                  {logs.map(log => (
                    <LogItem key={log.id} log={log} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI Analysis Section */}
          {(isAiLoading || aiAnalysis) && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-emerald-400 border-b border-zinc-800 pb-2">
                <Sparkles className="w-4 h-4" />
                <h3 className="font-medium text-sm">AI 项目分析</h3>
              </div>
              
              {isAiLoading ? (
                <div className="flex flex-col items-center justify-center py-8 text-zinc-500 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                  <span className="text-sm">正在分析项目结构...</span>
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
                    <div className="flex items-center gap-2 text-zinc-400">
                      <FileTerminal className="w-4 h-4" />
                      <span className="font-medium">主入口文件</span>
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
                        <span>正在研判真实入口文件...</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}
          
          {!isAiLoading && !aiAnalysis && !error && (
            <div className="flex-1 border border-dashed border-zinc-800 rounded-xl flex items-center justify-center text-zinc-600 text-sm p-4 text-center">
              <p>输入仓库地址后，AI 将自动分析项目结构和技术栈。</p>
            </div>
          )}
        </div>

        {/* Middle Column: File Tree */}
        <div className={`w-full lg:w-72 border-r border-zinc-800 bg-zinc-900/10 flex-col shrink-0 ${(files.length === 0 && !isTreeLoading) ? 'hidden lg:flex' : ''} ${activeFile ? 'hidden lg:flex' : 'flex'}`}>
          <div className="h-10 border-b border-zinc-800 flex items-center px-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider shrink-0 bg-zinc-900/30 justify-between">
            <span>文件列表</span>
            <button 
              onClick={() => { setFiles([]); setRepoInfo(null); navigate('/'); }}
              className="lg:hidden text-zinc-500 hover:text-zinc-300"
            >
              更换仓库
            </button>
          </div>
          <div className="flex-1 overflow-hidden relative">
            {isTreeLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                <span className="text-sm">正在获取仓库...</span>
              </div>
            ) : files.length > 0 ? (
              <FileTree 
                files={files} 
                onSelectFile={handleSelectFile} 
                selectedFile={activeFile}
              />
            ) : !error ? (
              <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm text-center px-4">
                输入仓库地址以查看文件
              </div>
            ) : null}
          </div>
        </div>

        {/* Right Area: Code Viewer & Panorama */}
        <div className={`flex-1 flex flex-col lg:flex-row overflow-hidden min-w-0 ${activeFile || confirmedEntryFile ? 'flex' : 'hidden lg:flex'}`}>
          {/* Code Viewer */}
          <div className={`flex-1 bg-zinc-950 overflow-hidden flex-col min-w-0 ${activeFile ? 'flex' : 'hidden lg:flex'} lg:border-r border-zinc-800`}>
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

          {/* Panorama Panel */}
          <div className="flex-1 overflow-hidden flex flex-col min-w-0 bg-zinc-950 relative">
             <div className="h-10 border-b border-zinc-800 flex items-center px-4 text-xs font-semibold text-zinc-400 uppercase tracking-wider shrink-0 bg-zinc-900/30 z-10">
               <span>全景图</span>
             </div>
             {isSubFunctionLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                  <span className="text-sm">正在分析关键子函数...</span>
                </div>
             ) : (
                <PanoramaPanel analysis={subFunctionAnalysis} entryFilePath={confirmedEntryFile?.path || ''} />
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
                工作日志 (全屏)
              </div>
              <button onClick={() => setIsFullScreenLogs(false)} className="text-zinc-400 hover:text-zinc-100 p-2 rounded-full hover:bg-zinc-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-zinc-900/30">
              {logs.map(log => <LogItem key={log.id} log={log} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
