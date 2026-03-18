import { getRuntimeConfig } from './runtimeConfig';

export interface GithubRepoInfo {
  owner: string;
  repo: string;
  defaultBranch: string;
}

export interface GithubFileNode {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

export const getGithubToken = () => {
  const runtime = getRuntimeConfig();
  return (runtime.GITHUB_TOKEN || runtime.GITHUB_PAT || '').trim();
};

const fetchWithAuth = async (url: string, customHeaders: Record<string, string> = {}) => {
  const token = getGithubToken();
  const headers: Record<string, string> = { ...customHeaders };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(url, { headers });
};

export const parseGithubUrl = (url: string): { owner: string; repo: string } | null => {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname !== 'github.com') return null;
    
    const parts = parsedUrl.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    
    return {
      owner: parts[0],
      repo: parts[1].replace(/\.git$/, ''),
    };
  } catch {
    return null;
  }
};

export const fetchRepoInfo = async (owner: string, repo: string): Promise<GithubRepoInfo> => {
  const response = await fetchWithAuth(`https://api.github.com/repos/${owner}/${repo}`);
  if (!response.ok) {
    if (response.status === 403) throw new Error('GitHub API rate limit exceeded. Please add a Personal Access Token in Settings.');
    if (response.status === 404) throw new Error('Repository not found. Make sure it is public or you have provided a valid token.');
    throw new Error('Failed to fetch repository information');
  }
  const data = await response.json();
  return {
    owner,
    repo,
    defaultBranch: data.default_branch,
  };
};

export const fetchFileTree = async (owner: string, repo: string, branch: string): Promise<GithubFileNode[]> => {
  const response = await fetchWithAuth(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
  if (!response.ok) {
    if (response.status === 403) throw new Error('GitHub API rate limit exceeded. Please add a Personal Access Token in Settings.');
    throw new Error('Failed to fetch file tree');
  }
  const data = await response.json();
  return data.tree;
};

export const fetchFileContent = async (owner: string, repo: string, branch: string, path: string): Promise<string> => {
  const response = await fetchWithAuth(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    { Accept: 'application/vnd.github.v3.raw' }
  );
  if (!response.ok) {
    if (response.status === 403) throw new Error('GitHub API rate limit exceeded. Please add a Personal Access Token in Settings.');
    throw new Error('Failed to fetch file content');
  }
  return await response.text();
};
