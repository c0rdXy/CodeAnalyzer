import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import { GithubFileNode } from '../utils/github';

interface TreeNode {
  name: string;
  path: string;
  type: 'blob' | 'tree';
  children?: TreeNode[];
}

interface FileTreeProps {
  files: GithubFileNode[];
  onSelectFile: (path: string) => void;
  selectedFile: string | null;
}

const buildTree = (files: GithubFileNode[]): TreeNode[] => {
  const root: TreeNode[] = [];
  const map = new Map<string, TreeNode>();

  // Sort by path length to ensure parents are processed before children
  const sortedFiles = [...files].sort((a, b) => a.path.length - b.path.length);

  sortedFiles.forEach((file) => {
    const parts = file.path.split('/');
    const name = parts[parts.length - 1];
    
    const node: TreeNode = {
      name,
      path: file.path,
      type: file.type,
      ...(file.type === 'tree' ? { children: [] } : {}),
    };

    map.set(file.path, node);

    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = map.get(parentPath);
      if (parent && parent.children) {
        parent.children.push(node);
      }
    }
  });

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'tree' ? -1 : 1;
    });
    nodes.forEach(node => {
      if (node.children) sortNodes(node.children);
    });
  };

  sortNodes(root);
  return root;
};

const FileTreeNode: React.FC<{
  node: TreeNode;
  level: number;
  onSelectFile: (path: string) => void;
  selectedFile: string | null;
}> = ({ node, level, onSelectFile, selectedFile }) => {
  const [isOpen, setIsOpen] = useState(false);
  const isSelected = selectedFile === node.path;

  const handleToggle = () => {
    if (node.type === 'tree') {
      setIsOpen(!isOpen);
    } else {
      onSelectFile(node.path);
    }
  };

  return (
    <div>
      <div
        className={`flex items-center py-1 px-2 cursor-pointer hover:bg-zinc-800/50 rounded-md transition-colors ${
          isSelected ? 'bg-zinc-800 text-emerald-400' : 'text-zinc-300'
        }`}
        style={{ paddingLeft: `${level * 1.5 + 0.5}rem` }}
        onClick={handleToggle}
      >
        <div className="w-4 h-4 mr-1.5 flex items-center justify-center text-zinc-500">
          {node.type === 'tree' ? (
            isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
          ) : null}
        </div>
        <div className="w-4 h-4 mr-2 flex items-center justify-center">
          {node.type === 'tree' ? (
            isOpen ? <FolderOpen className="w-4 h-4 text-emerald-500" /> : <Folder className="w-4 h-4 text-emerald-500" />
          ) : (
            <File className="w-4 h-4 text-zinc-400" />
          )}
        </div>
        <span className="text-sm truncate select-none">{node.name}</span>
      </div>
      {node.type === 'tree' && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              onSelectFile={onSelectFile}
              selectedFile={selectedFile}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default function FileTree({ files, onSelectFile, selectedFile }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);

  return (
    <div className="overflow-y-auto h-full py-2 custom-scrollbar">
      {tree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          level={0}
          onSelectFile={onSelectFile}
          selectedFile={selectedFile}
        />
      ))}
    </div>
  );
}
