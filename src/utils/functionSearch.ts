export interface FunctionMatch {
  startLine: number;
  endLine: number;
  snippet: string;
  signatureLine: string;
}

const PYTHON_SIGNATURE_RE = /^\s*(?:async\s+def|def)\s+/;
const RUBY_SIGNATURE_RE = /^\s*def\s+/;
const FUNCTION_NAME_CAPTURE_PATTERNS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\s*\(/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  /^\s*(?:async\s+def|def)\s+([A-Za-z_][\w]*)\s*\(/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/,
  /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*(?:<[^>]+>)?\s*\(/,
  /^\s*(?:public|private|protected|static|final|abstract\s+)?function\s+([A-Za-z_][\w]*)\s*\(/,
  /^\s*def\s+([A-Za-z_][\w]*)\b/,
  /^\s*(?:public|private|protected|internal|static|final|virtual|override|abstract|async|synchronized|inline\s+)*[A-Za-z_$][\w<>,\[\].?]*\s+([A-Za-z_$][\w$]*)\s*\(/,
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeFunctionName(functionName: string): string {
  return functionName
    .trim()
    .replace(/\s+/g, '')
    .replace(/\([^)]*\)\s*$/, '');
}

function parseFunctionName(functionName: string): {
  normalized: string;
  simpleName: string;
  qualifiers: string[];
  cppQualifiedName: string;
} {
  const normalized = normalizeFunctionName(functionName);
  const tokens = normalized.split(/::|\.|#/).filter(Boolean);
  const simpleName = tokens[tokens.length - 1] || normalized;
  const qualifiers = tokens.slice(0, -1);
  const cppQualifiedName =
    qualifiers.length > 0 && simpleName ? `${qualifiers.join('::')}::${simpleName}` : '';

  return {
    normalized,
    simpleName,
    qualifiers,
    cppQualifiedName,
  };
}

export function getFunctionNameLookupKeys(functionName: string): string[] {
  const parsed = parseFunctionName(functionName);
  const keys = [
    functionName.trim().toLowerCase(),
    parsed.normalized.toLowerCase(),
    parsed.simpleName.toLowerCase(),
  ];

  if (parsed.cppQualifiedName) {
    keys.push(parsed.cppQualifiedName.toLowerCase());
  }

  if (parsed.qualifiers.length > 0) {
    const className = parsed.qualifiers[parsed.qualifiers.length - 1];
    keys.push(`${className}::${parsed.simpleName}`.toLowerCase());
    keys.push(`${className}.${parsed.simpleName}`.toLowerCase());
  }

  return [...new Set(keys.filter(Boolean))];
}

function buildDefinitionPatterns(functionName: string): RegExp[] {
  const parsed = parseFunctionName(functionName);
  const safeName = escapeRegex(parsed.simpleName || functionName.trim());
  const patterns: RegExp[] = [
    new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${safeName}\\s*\\(`),
    new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${safeName}\\s*=\\s*(?:async\\s*)?function\\s*\\(`),
    new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${safeName}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`),
    new RegExp(`^\\s*(?:public|private|protected|static|async|override|virtual|internal|final|abstract|sealed|export\\s+)?\\s*(?:async\\s+)?${safeName}\\s*\\(`),
    new RegExp(`^\\s*(?:async\\s+def|def)\\s+${safeName}\\s*\\(`),
    new RegExp(`^\\s*func\\s+(?:\\([^)]*\\)\\s*)?${safeName}\\s*\\(`),
    new RegExp(`^\\s*(?:pub\\s+)?(?:async\\s+)?fn\\s+${safeName}\\s*(?:<[^>]+>)?\\s*\\(`),
    new RegExp(`^\\s*(?:public|private|protected|static|final|abstract\\s+)?function\\s+${safeName}\\s*\\(`),
    new RegExp(`^\\s*def\\s+${safeName}\\b`),
    new RegExp(`^\\s*(?:public|private|protected|internal|static|final|virtual|override|abstract|async|synchronized|inline\\s+)*[A-Za-z_$][\\w<>,\\[\\].?]*\\s+${safeName}\\s*\\(`),
    new RegExp(`^\\s*(?:public|private|protected|internal|static|virtual|inline|constexpr|explicit|friend\\s+)*~?${safeName}\\s*\\(`),
  ];

  if (parsed.cppQualifiedName) {
    const qualified = escapeRegex(parsed.cppQualifiedName);
    patterns.unshift(
      new RegExp(`^\\s*(?:template\\s*<[^>]+>\\s*)?(?:inline\\s+|static\\s+|virtual\\s+|constexpr\\s+|friend\\s+|extern\\s+|typename\\s+)*[A-Za-z_$~][\\w:<>,\\[\\]().*&\\s]*\\b${qualified}\\s*\\(`)
    );
    patterns.unshift(new RegExp(`^\\s*(?:inline\\s+|constexpr\\s+)?${qualified}\\s*\\(`));
    patterns.unshift(new RegExp(`\\b${qualified}\\s*\\(`));
  }

  return patterns;
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

function isLikelyInsideClass(lines: string[], startLineIndex: number, classNames: string[]): boolean {
  if (classNames.length === 0) {
    return false;
  }

  const maxScanLines = 220;
  const end = Math.max(0, startLineIndex - maxScanLines);
  for (let index = startLineIndex; index >= end; index -= 1) {
    const line = lines[index];

    for (const className of classNames) {
      const classPattern = new RegExp(`\\b(?:class|struct)\\s+${escapeRegex(className)}\\b`);
      if (classPattern.test(line)) {
        return true;
      }
    }

    if (index < startLineIndex - 2 && /^\s*}\s*;?\s*$/.test(line)) {
      break;
    }
  }

  return false;
}

export function findFunctionDefinitionInContent(functionName: string, content: string): FunctionMatch | null {
  const parsed = parseFunctionName(functionName);
  const classCandidates = parsed.qualifiers.length > 0 ? [parsed.qualifiers[parsed.qualifiers.length - 1]] : [];
  const normalizedQualifiedName = parsed.cppQualifiedName.replace(/\s+/g, '').toLowerCase();
  const normalizedSimpleName = parsed.simpleName.replace(/\s+/g, '').toLowerCase();
  const patterns = buildDefinitionPatterns(functionName);
  const lines = content.split('\n');
  const candidateIndexes: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matchesDefinition = patterns.some((pattern) => pattern.test(line));

    if (!matchesDefinition) {
      continue;
    }

    candidateIndexes.push(index);
  }

  if (candidateIndexes.length === 0) {
    return null;
  }

  const scoredIndexes = [...candidateIndexes].sort((leftIndex, rightIndex) => {
    const score = (line: string, index: number) => {
      let value = 0;
      const normalizedLine = line.replace(/\s+/g, '').toLowerCase();

      if (normalizedQualifiedName && normalizedLine.includes(normalizedQualifiedName)) {
        value += 240;
      }

      if (normalizedSimpleName && normalizedLine.includes(normalizedSimpleName)) {
        value += 30;
      }

      if (isLikelyInsideClass(lines, index, classCandidates)) {
        value += 110;
      }

      if (/\b(if|for|while|switch)\b/.test(line)) {
        value -= 120;
      }

      return value;
    };

    return score(lines[rightIndex], rightIndex) - score(lines[leftIndex], leftIndex);
  });

  for (const index of scoredIndexes) {
    const line = lines[index];

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

export function extractFunctionNamesFromContent(content: string): string[] {
  const names = new Set<string>();
  const lines = content.split('\n');

  for (const line of lines) {
    for (const pattern of FUNCTION_NAME_CAPTURE_PATTERNS) {
      const match = line.match(pattern);
      if (match?.[1]) {
        names.add(match[1]);
        break;
      }
    }
  }

  return [...names];
}

export async function searchFunctionInFiles(input: {
  functionName: string;
  filePaths: string[];
  getFileContent: (path: string) => Promise<string>;
  concurrency?: number;
}): Promise<{ filePath: string; match: FunctionMatch } | null> {
  const visited = new Set<string>();
  const concurrency = Math.max(1, input.concurrency ?? 6);

  for (let start = 0; start < input.filePaths.length; start += concurrency) {
    const batch = input.filePaths
      .slice(start, start + concurrency)
      .filter((filePath) => filePath && !visited.has(filePath));

    batch.forEach((filePath) => visited.add(filePath));

    const results = await Promise.all(
      batch.map(async (filePath) => {
        try {
          const content = await input.getFileContent(filePath);
          const match = findFunctionDefinitionInContent(input.functionName, content);
          return match ? { filePath, match } : null;
        } catch {
          return null;
        }
      })
    );

    const matched = results.find(Boolean);
    if (matched) {
      return matched;
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
  const lookupKeys = getFunctionNameLookupKeys(input.functionName);
  const normalizedName = lookupKeys[2] || lookupKeys[1] || lookupKeys[0] || input.functionName.toLowerCase();
  const qualifierTerms = lookupKeys
    .filter((key) => key.includes('::') || key.includes('.'))
    .map((key) => key.split(/::|\./).slice(0, -1).join('/'))
    .filter(Boolean);
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
    if (lookupKeys.some((key) => key && lower.includes(key))) {
      score += 4;
    }
    if (qualifierTerms.some((term) => term && lower.includes(term.toLowerCase()))) {
      score += 3;
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
