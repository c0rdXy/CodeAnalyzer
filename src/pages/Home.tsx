import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Github, Search, AlertCircle, Settings, History, Clock3, Trash2 } from 'lucide-react';
import { parseGithubUrl } from '../utils/github';
import { motion } from 'motion/react';
import SettingsModal from '../components/SettingsModal';
import { AnalysisHistoryItem, deleteAnalysisHistoryItem, getAnalysisHistory } from '../utils/analysisHistory';

export default function Home() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<AnalysisHistoryItem[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    setHistoryItems(getAnalysisHistory());
  }, []);

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!url.trim()) {
      setError('请输入 GitHub 仓库地址。');
      return;
    }

    const parsed = parseGithubUrl(url);
    if (!parsed) {
      setError('无效的 GitHub 地址。请输入类似 https://github.com/owner/repo 的公开仓库地址。');
      return;
    }

    navigate(`/analyze?url=${encodeURIComponent(url.trim())}`);
  };

  const handleDeleteHistory = (e: React.MouseEvent<HTMLButtonElement>, item: AnalysisHistoryItem) => {
    e.stopPropagation();
    const confirmed = window.confirm(`确认删除历史记录「${item.projectName}」吗？`);
    if (!confirmed) {
      return;
    }

    const deleted = deleteAnalysisHistoryItem(item.id);
    if (deleted) {
      setHistoryItems((prev) => prev.filter((historyItem) => historyItem.id !== item.id));
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 px-4 py-10 md:px-6">
      <button
        onClick={() => setIsSettingsOpen(true)}
        className="absolute top-4 right-4 rounded-full border border-zinc-800 bg-zinc-900/50 p-2 text-zinc-400 transition-colors hover:text-zinc-100"
        title="设置"
      >
        <Settings className="w-5 h-5" />
      </button>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto flex w-full max-w-3xl flex-col items-center text-center"
        >
          <div className="mb-8 rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
            <Github className="h-16 w-16 text-emerald-400" />
          </div>

          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl">
              GitHub 代码分析器
            </h1>
            <p className="mx-auto max-w-2xl text-lg leading-relaxed text-zinc-400">
              输入仓库地址后，系统会自动分析项目结构、入口文件、入口函数与关键调用链，并生成可回放的工程文件与历史记录。
            </p>
          </div>

          <form onSubmit={handleAnalyze} className="mt-8 w-full space-y-4">
            <div className="relative mx-auto max-w-3xl">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                <Search className="h-5 w-5 text-zinc-500" />
              </div>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                className="block w-full rounded-2xl border border-zinc-800 bg-zinc-900 py-4 pl-12 pr-32 text-zinc-100 placeholder-zinc-500 shadow-sm transition-all focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
              <button
                type="submit"
                className="absolute inset-y-2 right-2 flex items-center gap-2 rounded-xl bg-emerald-500 px-6 font-medium text-zinc-950 transition-colors hover:bg-emerald-400"
              >
                分析
              </button>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="flex items-center justify-center gap-2 text-sm text-red-400"
              >
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </motion.div>
            )}
          </form>

          <div className="pt-8 text-sm text-zinc-600">
            <p>示例: https://github.com/facebook/react</p>
          </div>
        </motion.div>

        <section className="mx-auto w-full max-w-6xl">
          <div className="mb-5 flex items-center gap-2 text-zinc-200">
            <History className="h-4 w-4 text-emerald-400" />
            <h2 className="text-lg font-semibold">历史分析记录</h2>
          </div>

          {historyItems.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-10 text-center text-sm text-zinc-500">
              还没有历史分析记录。完成一次仓库分析后，这里会自动生成可回放的工程卡片。
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {historyItems.map((item) => (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/analyze?history=${encodeURIComponent(item.id)}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/analyze?history=${encodeURIComponent(item.id)}`);
                    }
                  }}
                  className="group cursor-pointer rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-500/40 hover:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-zinc-100 group-hover:text-emerald-300">
                        {item.projectName}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                        {item.repoUrl}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <div className="flex items-center gap-1 text-xs text-zinc-500">
                        <Clock3 className="h-3.5 w-3.5" />
                        <span>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteHistory(e, item)}
                        className="rounded-lg border border-zinc-700/80 bg-zinc-900/90 p-1.5 text-zinc-500 transition-colors hover:border-red-500/40 hover:text-red-300"
                        title="删除历史记录"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-zinc-400">
                    {item.summary || '暂无项目摘要'}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.mainLanguages.slice(0, 3).map((language) => (
                      <span
                        key={language}
                        className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-xs text-blue-300"
                      >
                        {language}
                      </span>
                    ))}
                    {item.mainLanguages.length === 0 && (
                      <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-xs text-zinc-400">
                        未记录语言
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}
