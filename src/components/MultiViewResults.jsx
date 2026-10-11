import React, { useState } from 'react';
import { Copy, Check, ChevronDown, AlertCircle, Compass } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

// 一键多视角结果展示：按分组纵向排列视角卡片，每张卡片含视角标签+英文提示词+中文折叠+单独复制
export default function MultiViewResults({ views }) {
  const [copiedKey, setCopiedKey] = useState(null);
  const [expanded, setExpanded] = useState({});

  const handleCopy = (text, key) => {
    if (!text) {
      toast({ title: '该视角提示词为空', variant: 'destructive' });
      return;
    }
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
    toast({ title: '已复制中文提示词' });
  };

  const toggleExpand = (key) => setExpanded((p) => ({ ...p, [key]: !p[key] }));

  // 按分组聚合
  const groups = views.reduce((acc, v) => {
    (acc[v.group] = acc[v.group] || []).push(v);
    return acc;
  }, {});
  const groupOrder = ['水平环绕', '垂直俯仰', '电影特殊'];
  const groupIcons = { '水平环绕': '🧭', '垂直俯仰': '↕️', '电影特殊': '🎬' };

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-2 mb-4">
        <Compass className="w-4 h-4 text-foreground" />
        <h3 className="text-sm font-semibold">360°全景多视角提示词</h3>
        <span className="text-[11px] text-muted-foreground">共 {views.length} 个视角</span>
      </div>

      {groupOrder.filter((g) => groups[g]).map((groupName) => (
        <div key={groupName} className="mb-4 last:mb-0">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[11px]">{groupIcons[groupName]}</span>
            <span className="text-[11px] font-medium text-muted-foreground">{groupName}</span>
            <div className="flex-1 h-px bg-border/40" />
          </div>
          <div className="flex flex-col gap-2">
            {groups[groupName].map((v) => {
              const key = v.view_type;
              const isExpanded = expanded[key];
              const hasError = !!v.error;
              return (
                <div key={key} className={`rounded-lg border p-3 transition-colors ${hasError ? 'border-destructive/40 bg-destructive/5' : 'border-border/50 bg-muted/20'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-foreground text-background">{v.label}</span>
                    <button
                      onClick={() => handleCopy(v.enhanced_prompt_zh || v.enhanced_prompt, key)}
                      className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
                    >
                      {copiedKey === key ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copiedKey === key ? '已复制' : '复制'}
                    </button>
                  </div>

                  {hasError ? (
                    <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                      <AlertCircle className="w-3 h-3" />
                      生成失败：{v.error}
                    </div>
                  ) : (
                    <>
                      <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono mb-2">{v.enhanced_prompt_zh || v.enhanced_prompt}</p>
                      {v.enhanced_prompt && (
                        <button
                          onClick={() => toggleExpand(key)}
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          {isExpanded ? '收起英文' : '展开英文'}
                        </button>
                      )}
                      {isExpanded && v.enhanced_prompt && (
                        <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap mt-2 pt-2 border-t border-border/30">{v.enhanced_prompt}</p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}