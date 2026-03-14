import React from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { EntryFunctionAnalysis, SubFunctionAnalysis } from '../services/analysisAi';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';

interface PanoramaTreeProps {
  analysis: EntryFunctionAnalysis | null;
  entryFilePath: string;
  selectedNodeId: string;
  activeNodeId: string | null;
  onSelectNode: (
    nodeId: string,
    node: { filePath?: string; snippet?: string }
  ) => void | Promise<void>;
}

interface NodeCardProps {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  drillDown?: number;
  stopReason?: string;
  selectedNodeId: string;
  activeNodeId: string | null;
  onClick: () => void;
}

const getDrillDownLabel = (drillDown?: number) => {
  if (drillDown === 1) {
    return '建议继续下钻分析';
  }
  if (drillDown === -1) {
    return '无需继续下钻';
  }
  return '可选继续分析';
};

const NodeCard = ({
  id,
  title,
  subtitle,
  description,
  drillDown,
  stopReason,
  selectedNodeId,
  activeNodeId,
  onClick,
}: NodeCardProps) => {
  const isSelected = selectedNodeId === id;
  const isActive = activeNodeId === id;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`panorama-node-enter w-72 overflow-hidden rounded-xl border-2 text-left shadow-lg transition-all ${
        isSelected
          ? 'border-emerald-400 bg-zinc-900 ring-2 ring-emerald-400/40'
          : isActive
            ? 'border-amber-400 bg-zinc-900 ring-2 ring-amber-400/30'
            : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'
      }`}
    >
      <div className="truncate border-b-2 border-inherit bg-zinc-800 px-3 py-1.5 text-xs font-mono text-zinc-300">
        {title}
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        <div className="truncate text-sm font-bold text-emerald-400">{subtitle}</div>
        <div className="text-xs leading-relaxed text-zinc-400 whitespace-pre-wrap break-words" title={description}>
          {description}
        </div>
        {drillDown !== undefined && (
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                drillDown === 1 ? 'bg-emerald-500' : drillDown === -1 ? 'bg-zinc-600' : 'bg-yellow-500'
              }`}
            />
            <span className="text-[10px] text-zinc-500">{getDrillDownLabel(drillDown)}</span>
          </div>
        )}
        {stopReason && <div className="text-[10px] leading-relaxed text-zinc-500">{stopReason}</div>}
      </div>
    </button>
  );
};

const FunctionTree = ({
  nodes,
  path,
  selectedNodeId,
  activeNodeId,
  onSelectNode,
}: {
  nodes: SubFunctionAnalysis[];
  path: number[];
  selectedNodeId: string;
  activeNodeId: string | null;
  onSelectNode: PanoramaTreeProps['onSelectNode'];
}) => {
  if (nodes.length === 0) {
    return null;
  }

  return (
    <div className="relative mt-8 ml-12 flex flex-col gap-6">
      {nodes.map((node, index) => {
        const nextPath = [...path, index];
        const nodeId = `node-${nextPath.join('-')}`;

        return (
          <div key={`${node.resolvedFile || node.file}-${node.name}-${nodeId}`} className="relative z-10 pl-12">
            <div
              className={`animated-dash-vertical panorama-link-vertical absolute left-0 z-0 ${
                index === 0 ? 'top-[-32px]' : 'top-[-24px]'
              } ${index === nodes.length - 1 ? 'bottom-1/2' : 'bottom-[-24px]'}`}
            />
            <div className="animated-dash-horizontal panorama-link-horizontal absolute top-1/2 left-0 z-0 w-12 -translate-y-1/2" />

            <NodeCard
              id={nodeId}
              title={node.resolvedFile || node.file || '未知文件'}
              subtitle={node.name}
              description={node.description}
              drillDown={node.drillDown}
              stopReason={node.stopReason}
              selectedNodeId={selectedNodeId}
              activeNodeId={activeNodeId}
              onClick={() =>
                onSelectNode(nodeId, {
                  filePath: node.resolvedFile || node.file,
                  snippet: node.resolvedSnippet,
                })
              }
            />

            {node.children && node.children.length > 0 && (
              <FunctionTree
                nodes={node.children}
                path={nextPath}
                selectedNodeId={selectedNodeId}
                activeNodeId={activeNodeId}
                onSelectNode={onSelectNode}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default function PanoramaTree({
  analysis,
  entryFilePath,
  selectedNodeId,
  activeNodeId,
  onSelectNode,
}: PanoramaTreeProps) {
  if (!analysis) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-zinc-950/50 text-sm text-zinc-600">
        暂无全景图数据，请先完成入口文件分析。
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-1 flex-col overflow-hidden bg-zinc-950/50">
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/80 p-1 shadow-lg backdrop-blur-sm">
          <div className="flex items-center px-2 py-1 text-xs text-zinc-400">拖拽移动 / 滚轮缩放</div>
        </div>
      </div>

      <TransformWrapper initialScale={1} minScale={0.2} maxScale={4} centerOnInit wheel={{ step: 0.1 }}>
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <div className="absolute right-4 bottom-4 z-10 flex gap-2">
              <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/80 p-1 shadow-lg backdrop-blur-sm">
                <button onClick={() => zoomIn()} className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100">
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button onClick={() => zoomOut()} className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100">
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button onClick={() => resetTransform()} className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100">
                  <Maximize className="h-4 w-4" />
                </button>
              </div>
            </div>

            <TransformComponent wrapperClass="!w-full !h-full" contentClass="min-w-max min-h-max">
              <div className="flex min-w-max flex-col items-start p-12">
                <div className="relative z-10">
                  <NodeCard
                    id="root"
                    title={entryFilePath}
                    subtitle={analysis.entryFunctionName}
                    description={analysis.summary || '项目主入口函数'}
                    stopReason={analysis.stopReason}
                    selectedNodeId={selectedNodeId}
                    activeNodeId={activeNodeId}
                    onClick={() =>
                      onSelectNode('root', {
                        filePath: entryFilePath,
                      })
                    }
                  />
                </div>

                <FunctionTree
                  nodes={analysis.subFunctions}
                  path={[]}
                  selectedNodeId={selectedNodeId}
                  activeNodeId={activeNodeId}
                  onSelectNode={onSelectNode}
                />
              </div>
            </TransformComponent>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}
