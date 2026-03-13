import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Github, Search, AlertCircle, Settings } from 'lucide-react';
import { parseGithubUrl } from '../utils/github';
import { motion } from 'motion/react';
import SettingsModal from '../components/SettingsModal';

export default function Home() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const navigate = useNavigate();

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!url.trim()) {
      setError('请输入 GitHub 仓库地址');
      return;
    }

    const parsed = parseGithubUrl(url);
    if (!parsed) {
      setError('无效的 GitHub 地址。请输入有效的仓库地址 (例如: https://github.com/owner/repo)');
      return;
    }

    navigate(`/analyze?url=${encodeURIComponent(url)}`);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col items-center justify-center p-4 relative">
      <button 
        onClick={() => setIsSettingsOpen(true)} 
        className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-zinc-100 bg-zinc-900/50 rounded-full border border-zinc-800 transition-colors"
        title="设置"
      >
        <Settings className="w-5 h-5" />
      </button>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl space-y-8 text-center"
      >
        <div className="flex justify-center mb-8">
          <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 shadow-2xl">
            <Github className="w-16 h-16 text-emerald-400" />
          </div>
        </div>
        
        <div className="space-y-4">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white">
            GitHub 代码分析器
          </h1>
          <p className="text-lg text-zinc-400 max-w-xl mx-auto">
            可视化项目结构，浏览文件，并直接分析任何公开的 GitHub 仓库代码。
          </p>
        </div>

        <form onSubmit={handleAnalyze} className="mt-8 space-y-4">
          <div className="relative max-w-xl mx-auto">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-zinc-500" />
            </div>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="block w-full pl-12 pr-32 py-4 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all shadow-sm"
            />
            <button
              type="submit"
              className="absolute inset-y-2 right-2 px-6 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              分析
            </button>
          </div>
          
          {error && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="flex items-center justify-center gap-2 text-red-400 text-sm"
            >
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </motion.div>
          )}
        </form>

        <div className="pt-12 text-sm text-zinc-600">
          <p>试试这个: https://github.com/facebook/react</p>
        </div>
      </motion.div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}
