export interface FunctionMatch {
  startLine: number;
  endLine: number;
  snippet: string;
  signatureLine: string;
}

const PYTHON_SIGNATURE_RE = /^\s*(?:async\s+def|def)\s+/;
const RUBY_SIGNATURE_RE = /^\s*def\s+/;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildDefinitionPatterns(functionName: string): RegExp[] {
  const name = escapeRegex(functionName);

  return [
    new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`),
    new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?function\\s*\\(`),
    new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`),
    new RegExp(`^\\s*(?:public|private|protected|static|async|override|virtual|internal|final|abstract|sealed|export\\s+)?\\s*(?:async\\s+)?${name}\\s*\\(`),
    new RegExp(`^\\s*(?:async\\s+def|def)\\s+${name}\\s*\\(`),
    new RegExp(`^\\s*func\\s+(?:\\([^)]*\\)\\s*)?${name}\\s*\\(`),
    new RegExp(`^\\s*(?:pub\\s+)?(?:async\\s+)?fn\\s+${name}\\s*(?:<[^>]+>)?\\s*\\(`),
    new RegExp(`^\\s*(?:public|private|protected|static|final|abstract\\s+)?function\\s+${name}\\s*\\(`),
    new RegExp(`^\\s*def\\s+${name}\\b`),
    new RegExp(`^\\s*(?:public|private|protected|internal|static|final|virtual|override|abstract|async|synchronized|inline\\s+)*[A-Za-z_$][\\w<>,\\[\\].?]*\\s+${name}\\s*\\(`),
  ];
}

function countLineIndent(line: string): number {
  const match = line.match(/^\s*/);
  return match ? match[0].length : 0;
}

function extractIndentedBlock(lines: string[], startLineIndex: number): FunctionMatch {
  const startIndent = countLineIndent(lines[startLineIndex]);
  let endLineIndex = startLineIndex;

  for (let i = startLineIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      endLineIndex = i;
      continue;
    }

    const indent = countLineIndent(line);
    if (indent <= startIndent && !trimmed.startsWith('#') && !trimmed.startsWith('@')) {
      break;
    }

    endLineIndex = i;
  }

  return {
    startLine: startLineIndex + 1,
    endLine: endLineIndex + 1,
    snippet: lines.slice(startLineIndex, endLineIndex + 1).join('\n'),
    signatureLine: lines[startLineIndex],
  };
}

function extractRubyBlock(lines: string[], startLineIndex: number): FunctionMatch {
  let depth = 0;
  let endLineIndex = startLineIndex;

  for (let i = startLineIndex; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (/^(def|class|module|if|unless|case|begin|do)\b/.test(trimmed)) {
      depth += 1;
    }
    if (/^end\b/.test(trimmed)) {
      depth -= 1;
      if (depth === 0) {
        endLineIndex = i;
        break;
      }
    }
    endLineIndex = i;
  }

  return {
    startLine: startLineIndex + 1,
    endLine: endLineIndex + 1,
    snippet: lines.slice(startLineIndex, endLineIndex + 1).join('\n'),
    signatureLine: lines[startLineIndex],
  };
}

function findBraceBlockEnd(content: string, startIndex: number): number {
  let depth = 0;
  let started = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = startIndex; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];
    const prev = content[i - 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (prev === '*' && char === '/') {
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inTemplate) {
      if (char === '/' && next === '/') {
        inLineComment = true;
        continue;
      }
      if (char === '/' && next === '*') {
        inBlockComment = true;
        continue;
      }
    }

    if (char === "'" && !inDoubleQuote && !inTemplate && prev !== '\\') {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote && !inTemplate && prev !== '\\') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (char === '`' && !inSingleQuote && !inDoubleQuote && prev !== '\\') {
      inTemplate = !inTemplate;
      continue;
    }

    if (inSingleQuote || inDoubleQuote || inTemplate) {
      continue;
    }

    if (char === '{') {
      depth += 1;
      started = true;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (started && depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function extractBraceBlock(content: string, lines: string[], startLineIndex: number): FunctionMatch | null {
  const lineStartIndex = lines.slice(0, startLineIndex).join('\n').length + (startLineIndex > 0 ? 1 : 0);
  const searchSlice = content.slice(lineStartIndex);
  const openBraceRelativeIndex = searchSlice.indexOf('{');

  if (openBraceRelativeIndex === -1) {
    const line = lines[startLineIndex];
    if (line.trim().endsWith(';')) {
      return {
        startLine: startLineIndex + 1,
        endLine: startLineIndex + 1,
        snippet: line,
        signatureLine: line,
      };
    }
    return null;
  }

  const openBraceIndex = lineStartIndex + openBraceRelativeIndex;
  const closeBraceIndex = findBraceBlockEnd(content, openBraceIndex);

  if (closeBraceIndex === -1) {
    return null;
  }

  const snippet = content.slice(lineStartIndex, closeBraceIndex + 1);
  const endLine = snippet.split('\n').length + startLineIndex;

  return {
    startLine: startLineIndex + 1,
    endLine,
    snippet,
    signatureLine: lines[startLineIndex],
  };
}

export function findFunctionDefinitionInContent(functionName: string, content: string): FunctionMatch | null {
  const patterns = buildDefinitionPatterns(functionName);
  const lines = content.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matchesDefinition = patterns.some((pattern) => pattern.test(line));

    if (!matchesDefinition) {
      continue;
    }

    if (PYTHON_SIGNATURE_RE.test(line)) {
      return extractIndentedBlock(lines, index);
    }

    if (RUBY_SIGNATURE_RE.test(line)) {
      return extractRubyBlock(lines, index);
    }

    const braceMatch = extractBraceBlock(content, lines, index);
    if (braceMatch) {
      return braceMatch;
    }
  }

  return null;
}

export async function searchFunctionInFiles(input: {
  functionName: string;
  filePaths: string[];
  getFileContent: (path: string) => Promise<string>;
}): Promise<{ filePath: string; match: FunctionMatch } | null> {
  const visited = new Set<string>();

  for (const filePath of input.filePaths) {
    if (!filePath || visited.has(filePath)) {
      continue;
    }
    visited.add(filePath);

    try {
      const content = await input.getFileContent(filePath);
      const match = findFunctionDefinitionInContent(input.functionName, content);

      if (match) {
        return { filePath, match };
      }
    } catch {
      // Ignore fetch or parse errors and continue searching.
    }
  }

  return null;
}

export function prioritizeSearchPaths(input: {
  functionName: string;
  allFiles: string[];
  parentFilePath?: string;
  hintedFiles?: string[];
}): string[] {
  const normalizedName = input.functionName.toLowerCase();
  const parentDir = input.parentFilePath?.includes('/')
    ? input.parentFilePath.slice(0, input.parentFilePath.lastIndexOf('/'))
    : '';

  const scored = input.allFiles.map((filePath) => {
    let score = 0;
    const lower = filePath.toLowerCase();
    const basename = lower.split('/').pop() || lower;

    if (input.hintedFiles?.includes(filePath)) {
      score += 100;
    }
    if (parentDir && lower.startsWith(parentDir.toLowerCase())) {
      score += 20;
    }
    if (basename.includes(normalizedName)) {
      score += 12;
    }
    if (lower.includes(normalizedName)) {
      score += 8;
    }
    if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.jsx')) {
      score += 2;
    }

    return { filePath, score };
  });

  return scored
    .sort((left, right) => right.score - left.score)
    .map((item) => item.filePath);
}

export function trimFunctionSnippet(snippet: string, maxLines = 220): string {
  const lines = snippet.split('\n');
  if (lines.length <= maxLines) {
    return snippet;
  }

  const head = lines.slice(0, Math.floor(maxLines * 0.7));
  const tail = lines.slice(-(maxLines - head.length));
  return `${head.join('\n')}\n\n/* ... ${lines.length - maxLines} lines omitted ... */\n\n${tail.join('\n')}`;
}
