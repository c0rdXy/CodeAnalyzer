import React, { useMemo, useState } from 'react';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { FileCode2, Loader2, Copy, Check, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface CodeViewerProps {
  content: string | null;
  path: string | null;
  isLoading: boolean;
}

const getLanguageFromExtension = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    html: 'html',
    css: 'css',
    md: 'markdown',
    py: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    sh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    xml: 'xml',
    sql: 'sql',
    rb: 'ruby',
    php: 'php',
  };
  return map[ext || ''] || 'text';
};

export default function CodeViewer({ content, path, isLoading }: CodeViewerProps) {
  const language = useMemo(() => (path ? getLanguageFromExtension(path) : 'text'), [path]);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'code' | 'preview'>('preview');

  const isMarkdown = language === 'markdown';

  const handleCopy = async () => {
    if (content) {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        <p>正在加载文件内容...</p>
      </div>
    );
  }

  if (!path || content === null) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-4">
        <FileCode2 className="w-16 h-16 text-zinc-800" />
        <p>请选择一个文件以查看其内容</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#1E1E1E] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800 text-sm text-zinc-400 font-mono">
        <div className="flex items-center">
          <FileCode2 className="w-4 h-4 mr-2 text-emerald-500" />
          {path}
        </div>
        <div className="flex items-center gap-2">
          {isMarkdown && (
            <div className="flex items-center bg-zinc-950 rounded-lg p-0.5 border border-zinc-800 mr-2">
              <button
                onClick={() => setViewMode('preview')}
                className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1.5 ${viewMode === 'preview' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                <FileText className="w-4 h-4" />
                预览
              </button>
              <button
                onClick={() => setViewMode('code')}
                className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1.5 ${viewMode === 'code' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                <FileCode2 className="w-4 h-4" />
                源码
              </button>
            </div>
          )}
          <button
            onClick={handleCopy}
            className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors text-zinc-500 hover:text-zinc-300 flex items-center gap-1.5"
            title="复制代码"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            <span className="text-xs">{copied ? '已复制!' : '复制'}</span>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar">
        {isMarkdown && viewMode === 'preview' ? (
          <div className="p-6 prose prose-invert max-w-none prose-emerald prose-pre:bg-[#1E1E1E] prose-pre:border prose-pre:border-zinc-800">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <SyntaxHighlighter
            language={language}
            style={vs2015}
            customStyle={{
              margin: 0,
              padding: '1rem',
              background: 'transparent',
              fontSize: '14px',
              lineHeight: '1.5',
            }}
            showLineNumbers
            wrapLines
          >
            {content}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
