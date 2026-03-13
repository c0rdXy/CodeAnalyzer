import React, { useState, useEffect } from 'react';
import { X, Key, ExternalLink } from 'lucide-react';
import { getGithubToken, setGithubToken } from '../utils/github';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [token, setToken] = useState('');

  useEffect(() => {
    if (isOpen) {
      setToken(getGithubToken());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    setGithubToken(token.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Key className="w-5 h-5 text-emerald-500" />
            设置
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              GitHub 个人访问令牌 (PAT)
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <p className="mt-2 text-xs text-zinc-500">
              未认证请求限制为每小时 60 次。添加令牌可将此限制提高到每小时 5000 次。您的令牌仅保存在本地浏览器中。
            </p>
          </div>
          <a
            href="https://github.com/settings/tokens/new?description=GitHub+Code+Analyzer&scopes=repo"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 w-fit"
          >
            生成新令牌 <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <div className="p-4 border-t border-zinc-800 flex justify-end gap-3 bg-zinc-900/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors">
            取消
          </button>
          <button onClick={handleSave} className="px-4 py-2 text-sm font-medium bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-lg transition-colors">
            保存令牌
          </button>
        </div>
      </div>
    </div>
  );
}
