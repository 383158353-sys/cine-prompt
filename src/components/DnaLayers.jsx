import React from 'react';

// 风格DNA 16层分析：作为可折叠区块的内容，全部平铺，序号+标题+内容
export default function DnaLayers({ layers }) {
  if (!layers || layers.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 space-y-2 max-h-[480px] overflow-y-auto">
      {layers.map((layer, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-[11px] font-mono font-semibold text-primary/60 shrink-0 pt-0.5">
            {layer.title?.match(/^(\d+)/)?.[1] || String(i + 1).padStart(2, '0')}
          </span>
          <div className="flex-1">
            <span className="text-xs font-medium text-foreground">
              {layer.title?.replace(/^\d+\s*/, '') || layer.title}
            </span>
            <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
              {layer.detail}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}