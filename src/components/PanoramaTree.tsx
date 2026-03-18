import React, { useLayoutEffect, useRef, useState } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { EntryFunctionAnalysis, SubFunctionAnalysis } from '../services/analysisAi';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';

interface PanoramaTreeProps {
  analysis: EntryFunctionAnalysis | null;
  entryFilePath: string;
  selectedNodeId: string;
  activeNodeId: string | null;
  nodeModuleMap?: Record<string, string>;
  moduleColorMap?: Record<string, string>;
  activeModuleId?: string | null;
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
  moduleColor?: string;
  isDimmed?: boolean;
  onClick: () => void;
}

const CONNECTOR_X = 20;
const CONNECTOR_END_X = 56;

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
  moduleColor,
  isDimmed,
  onClick,
}: NodeCardProps) => {
  const isSelected = selectedNodeId === id;
  const isActive = activeNodeId === id;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`panorama-node-enter w-72 overflow-hidden rounded-xl border-2 text-left shadow-lg transition-all ${
        isDimmed ? 'opacity-30 grayscale' : 'opacity-100'
      } ${
        isSelected
          ? 'border-emerald-400 bg-zinc-900 ring-2 ring-emerald-400/40'
          : isActive
            ? 'border-amber-400 bg-zinc-900 ring-2 ring-amber-400/30'
            : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'
      }`}
    >
      <div
        className="truncate border-b-2 border-inherit px-3 py-1.5 text-xs font-mono text-zinc-100"
        style={{ backgroundColor: moduleColor || '#27272a' }}
      >
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

const TreeNodeItem = ({
  node,
  index,
  total,
  path,
  selectedNodeId,
  activeNodeId,
  nodeModuleMap,
  moduleColorMap,
  activeModuleId,
  parentConnectorOffset,
  onSelectNode,
}: {
  node: SubFunctionAnalysis;
  index: number;
  total: number;
  path: number[];
  selectedNodeId: string;
  activeNodeId: string | null;
  nodeModuleMap?: Record<string, string>;
  moduleColorMap?: Record<string, string>;
  activeModuleId?: string | null;
  parentConnectorOffset: number;
  onSelectNode: PanoramaTreeProps['onSelectNode'];
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardWrapperRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState({
    height: 140,
    cardCenterY: 64,
  });

  useLayoutEffect(() => {
    if (!containerRef.current || !cardWrapperRef.current) {
      return;
    }

    let frameId = 0;
    const measure = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        if (!containerRef.current || !cardWrapperRef.current) {
          return;
        }

        const containerRect = containerRef.current.getBoundingClientRect();
        const cardRect = cardWrapperRef.current.getBoundingClientRect();
        const height = Math.max(containerRect.height, 1);
        const cardCenterY = cardRect.top - containerRect.top + cardRect.height / 2;

        setMetrics((prev) => {
          if (
            Math.abs(prev.height - height) < 0.5 &&
            Math.abs(prev.cardCenterY - cardCenterY) < 0.5
          ) {
            return prev;
          }

          return {
            height,
            cardCenterY,
          };
        });
      });
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(containerRef.current);
    observer.observe(cardWrapperRef.current);

    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      cancelAnimationFrame(frameId);
    };
  }, [node.description, node.stopReason, node.name, node.children?.length]);

  const nextPath = [...path, index];
  const nodeId = `node-${nextPath.join('-')}`;
  const moduleId = nodeModuleMap?.[nodeId];
  const moduleColor = moduleId ? moduleColorMap?.[moduleId] : undefined;
  const isDimmed = Boolean(activeModuleId && moduleId !== activeModuleId);
  const isSelected = selectedNodeId === nodeId;
  const isActive = activeNodeId === nodeId;

  const isFirst = index === 0;
  const isLast = index === total - 1;

  const verticalStart = isFirst ? -parentConnectorOffset : 0;
  const verticalEnd = isLast ? metrics.cardCenterY : metrics.height;
  const horizontalEnd = CONNECTOR_END_X;
  const connectorColor = moduleColor || '#a1a1aa';
  const connectorOpacity = isDimmed ? 0.22 : isSelected ? 1 : isActive ? 0.95 : 0.86;
  const connectorStyle = {
    ['--connector-color' as string]: connectorColor,
    ['--connector-opacity' as string]: String(connectorOpacity),
  } as React.CSSProperties;

  return (
    <div ref={containerRef} className={`relative ${isLast ? '' : 'pb-6'}`}>
      <svg
        style={connectorStyle}
        className="panorama-connector-svg pointer-events-none absolute left-0 top-0 h-full w-16 overflow-visible"
      >
        <line
          x1={CONNECTOR_X}
          y1={verticalStart}
          x2={CONNECTOR_X}
          y2={verticalEnd}
          className="panorama-connector-line"
        />
        <line
          x1={CONNECTOR_X}
          y1={metrics.cardCenterY}
          x2={horizontalEnd - 8}
          y2={metrics.cardCenterY}
          className="panorama-connector-line"
        />
        <polygon
          points={`${horizontalEnd},${metrics.cardCenterY} ${horizontalEnd - 8},${metrics.cardCenterY - 5} ${horizontalEnd - 8},${metrics.cardCenterY + 5}`}
          className="panorama-connector-arrow"
        />
      </svg>

      <div ref={cardWrapperRef} className="relative z-10 pl-16">
        <NodeCard
          id={nodeId}
          title={node.resolvedFile || node.file || '未知文件'}
          subtitle={node.name}
          description={node.description}
          drillDown={node.drillDown}
          stopReason={node.stopReason}
          selectedNodeId={selectedNodeId}
          activeNodeId={activeNodeId}
          moduleColor={moduleColor}
          isDimmed={isDimmed}
          onClick={() =>
            onSelectNode(nodeId, {
              filePath: node.resolvedFile || node.file,
              snippet: node.resolvedSnippet,
            })
          }
        />
      </div>

      {node.children && node.children.length > 0 && (
        <div className="ml-16 mt-6">
          <FunctionTree
            nodes={node.children}
            path={nextPath}
            selectedNodeId={selectedNodeId}
            activeNodeId={activeNodeId}
            nodeModuleMap={nodeModuleMap}
            moduleColorMap={moduleColorMap}
            activeModuleId={activeModuleId}
            parentConnectorOffset={24}
            onSelectNode={onSelectNode}
          />
        </div>
      )}
    </div>
  );
};

const FunctionTree = ({
  nodes,
  path,
  selectedNodeId,
  activeNodeId,
  nodeModuleMap,
  moduleColorMap,
  activeModuleId,
  parentConnectorOffset,
  onSelectNode,
}: {
  nodes: SubFunctionAnalysis[];
  path: number[];
  selectedNodeId: string;
  activeNodeId: string | null;
  nodeModuleMap?: Record<string, string>;
  moduleColorMap?: Record<string, string>;
  activeModuleId?: string | null;
  parentConnectorOffset: number;
  onSelectNode: PanoramaTreeProps['onSelectNode'];
}) => {
  if (nodes.length === 0) {
    return null;
  }

  return (
    <div className="relative flex flex-col gap-0">
      {nodes.map((node, index) => (
        <TreeNodeItem
          key={`${node.resolvedFile || node.file}-${node.name}-${path.join('-')}-${index}`}
          node={node}
          index={index}
          total={nodes.length}
          path={path}
          selectedNodeId={selectedNodeId}
          activeNodeId={activeNodeId}
          nodeModuleMap={nodeModuleMap}
          moduleColorMap={moduleColorMap}
          activeModuleId={activeModuleId}
          parentConnectorOffset={parentConnectorOffset}
          onSelectNode={onSelectNode}
        />
      ))}
    </div>
  );
};

export default function PanoramaTree({
  analysis,
  entryFilePath,
  selectedNodeId,
  activeNodeId,
  nodeModuleMap,
  moduleColorMap,
  activeModuleId,
  onSelectNode,
}: PanoramaTreeProps) {
  if (!analysis) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-zinc-950/50 text-sm text-zinc-600">
        暂无全景图数据，请先完成入口文件分析。
      </div>
    );
  }

  const rootModuleId = nodeModuleMap?.root;
  const rootModuleColor = rootModuleId ? moduleColorMap?.[rootModuleId] : undefined;
  const rootDimmed = Boolean(activeModuleId && rootModuleId !== activeModuleId);

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
                    moduleColor={rootModuleColor}
                    isDimmed={rootDimmed}
                    onClick={() =>
                      onSelectNode('root', {
                        filePath: entryFilePath,
                      })
                    }
                  />
                </div>

                <div className="mt-8 ml-16">
                  <FunctionTree
                    nodes={analysis.subFunctions}
                    path={[]}
                    selectedNodeId={selectedNodeId}
                    activeNodeId={activeNodeId}
                    nodeModuleMap={nodeModuleMap}
                    moduleColorMap={moduleColorMap}
                    activeModuleId={activeModuleId}
                    parentConnectorOffset={32}
                    onSelectNode={onSelectNode}
                  />
                </div>
              </div>
            </TransformComponent>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}
