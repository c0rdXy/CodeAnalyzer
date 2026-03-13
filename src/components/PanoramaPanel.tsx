import React from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { EntryFunctionAnalysis, SubFunctionAnalysis } from '../services/ai';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';

interface PanoramaPanelProps {
  analysis: EntryFunctionAnalysis | null;
  entryFilePath: string;
}

const NodeCard = ({ title, subtitle, description, drillDown }: { title: string, subtitle: string, description: string, drillDown?: number }) => {
  return (
    <div className="bg-zinc-900 border-2 border-zinc-700 rounded-xl w-64 shadow-lg overflow-hidden flex flex-col">
      <div className="bg-zinc-800 px-3 py-1.5 border-b-2 border-zinc-700 text-xs font-mono text-zinc-300 truncate">
        {title}
      </div>
      <div className="p-3 flex flex-col gap-1">
        <div className="font-bold text-emerald-400 text-sm truncate">{subtitle}</div>
        <div className="text-xs text-zinc-400 leading-relaxed line-clamp-3" title={description}>
          {description}
        </div>
        {drillDown !== undefined && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${drillDown === 1 ? 'bg-emerald-500' : drillDown === -1 ? 'bg-zinc-600' : 'bg-yellow-500'}`}></span>
            <span className="text-[10px] text-zinc-500">
              {drillDown === 1 ? '建议下钻分析' : drillDown === -1 ? '无需下钻' : '待定'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default function PanoramaPanel({ analysis, entryFilePath }: PanoramaPanelProps) {
  if (!analysis) {
    return (
      <div className="flex-1 h-full flex items-center justify-center text-zinc-600 text-sm bg-zinc-950/50">
        暂无全景图数据，请先完成入口文件研判。
      </div>
    );
  }

  return (
    <div className="flex-1 h-full relative bg-zinc-950/50 overflow-hidden flex flex-col">
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-1 flex gap-1 shadow-lg backdrop-blur-sm">
          <div className="px-2 py-1 text-xs text-zinc-400 flex items-center">
            拖拽移动 / 滚轮缩放
          </div>
        </div>
      </div>

      <TransformWrapper
        initialScale={1}
        minScale={0.2}
        maxScale={4}
        centerOnInit={true}
        wheel={{ step: 0.1 }}
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <div className="absolute bottom-4 right-4 z-10 flex gap-2">
              <div className="bg-zinc-900/80 border border-zinc-800 rounded-lg p-1 flex gap-1 shadow-lg backdrop-blur-sm">
                <button onClick={() => zoomIn()} className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-md transition-colors">
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button onClick={() => zoomOut()} className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-md transition-colors">
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button onClick={() => resetTransform()} className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-md transition-colors">
                  <Maximize className="w-4 h-4" />
                </button>
              </div>
            </div>

            <TransformComponent wrapperClass="!w-full !h-full" contentClass="min-w-max min-h-max">
              <div className="p-12 flex flex-col items-start min-w-max">
                {/* Entry Node */}
                <div className="relative z-10">
                  <NodeCard 
                    title={entryFilePath} 
                    subtitle={analysis.entryFunctionName} 
                    description="主入口函数" 
                  />
                </div>

                {/* Sub Functions */}
                {analysis.subFunctions.length > 0 && (
                  <div className="relative mt-8 ml-12 flex flex-col gap-6">
                    {analysis.subFunctions.map((sub, index) => (
                      <div key={index} className="relative pl-12 z-10">
                        {/* Vertical Dashed Line Segment */}
                        <div className={`absolute left-0 w-0 border-l-2 border-dashed border-zinc-600 z-0 ${
                          index === 0 ? 'top-[-32px]' : 'top-[-24px]'
                        } ${
                          index === analysis.subFunctions.length - 1 ? 'bottom-1/2' : 'bottom-[-24px]'
                        }`}></div>

                        {/* Horizontal Dashed Line */}
                        <div className="absolute top-1/2 left-0 w-12 h-0 border-t-2 border-dashed border-zinc-600 -translate-y-1/2 z-0"></div>
                        
                        <NodeCard 
                          title={sub.file} 
                          subtitle={sub.name} 
                          description={sub.description} 
                          drillDown={sub.drillDown}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TransformComponent>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}
