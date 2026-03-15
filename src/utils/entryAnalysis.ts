import { findFunctionDefinitionInContent } from './functionSearch';

export interface EntryFunctionCandidate {
  name: string;
  snippet?: string;
  reason: string;
}

function createCandidate(
  name: string,
  reason: string,
  content: string
): EntryFunctionCandidate {
  const match = findFunctionDefinitionInContent(name, content);
  return {
    name,
    snippet: match?.snippet,
    reason,
  };
}

export function detectEntryFunctionCandidate(
  filePath: string,
  content: string
): EntryFunctionCandidate | null {
  const lowerPath = filePath.toLowerCase();

  if (/\.(ts|tsx|js|jsx)$/.test(lowerPath)) {
    if (/function\s+main\s*\(|const\s+main\s*=|let\s+main\s*=|var\s+main\s*=/.test(content)) {
      return createCandidate('main', '检测到前端/Node 常见 main 入口函数。', content);
    }
    if (/function\s+bootstrap\s*\(|const\s+bootstrap\s*=|let\s+bootstrap\s*=|var\s+bootstrap\s*=/.test(content)) {
      return createCandidate('bootstrap', '检测到 bootstrap 启动函数。', content);
    }
    if (/createRoot\s*\(|ReactDOM\.render\s*\(/.test(content)) {
      return {
        name: 'app bootstrap',
        reason: '检测到 React 应用挂载逻辑，入口更可能是文件级启动代码。',
      };
    }
  }

  if (/\.py$/.test(lowerPath)) {
    if (/\bdef\s+main\s*\(/.test(content)) {
      return createCandidate('main', '检测到 Python 常见 main 入口函数。', content);
    }
  }

  if (/\.(go)$/.test(lowerPath) && /\bfunc\s+main\s*\(/.test(content)) {
    return createCandidate('main', '检测到 Go 程序主入口 main。', content);
  }

  if (/\.(rs)$/.test(lowerPath) && /\bfn\s+main\s*\(/.test(content)) {
    return createCandidate('main', '检测到 Rust 程序主入口 main。', content);
  }

  if (/\.(dart)$/.test(lowerPath) && /\bvoid\s+main\s*\(/.test(content)) {
    return createCandidate('main', '检测到 Dart/Flutter 主入口 main。', content);
  }

  if (/\.(java|kt)$/.test(lowerPath)) {
    if (/\b(?:public\s+static\s+void|fun)\s+main\s*\(/.test(content)) {
      return createCandidate('main', '检测到 Java/Kotlin 常见 main 入口函数。', content);
    }
    if (/\boncreate\s*\(/i.test(content)) {
      return createCandidate('onCreate', '检测到 Android 生命周期入口 onCreate。', content);
    }
  }

  if (/\.(c|cpp)$/.test(lowerPath) && /\b(?:int|void)\s+main\s*\(/.test(content)) {
    return createCandidate('main', '检测到 C/C++ 主入口 main。', content);
  }

  return null;
}
