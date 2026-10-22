import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { Star, Copy, Trash2, Check, Languages, PenLine } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

const CATEGORY_COLORS = {
  '镜头运镜': 'bg-blue-500/10 text-blue-600',
  '光影氛围': 'bg-amber-500/10 text-amber-600',
  '风格美学': 'bg-purple-500/10 text-purple-600',
  '角色表演': 'bg-rose-500/10 text-rose-600',
  '场景构图': 'bg-emerald-500/10 text-emerald-600',
  '后期特效': 'bg-cyan-500/10 text-cyan-600',
  '综合提示': 'bg-slate-500/10 text-slate-600'
};

export default function PromptCard({ prompt, onChanged }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lang, setLang] = useState('zh'); // 中文为主

  const hasZh = Boolean(prompt.content_zh);
  const primary = lang === 'zh' ? (prompt.content_zh || prompt.content) : prompt.content;

  const handleCopy = (e) => {
    e.stopPropagation();
    const text = lang === 'en' ? prompt.content : prompt.content_zh;
    if (!text) { toast({ title: '此记录暂无所选语言提示词，请重新生成' }); return; }
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast({ title: '已复制' });
  };

  const handleFavorite = async (e) => {
    e.stopPropagation();
    try {
      await base44.entities.Prompt.update(prompt.id, { is_favorite: !prompt.is_favorite });
      onChanged?.();
    } catch (err) {
      toast({ title: '操作失败', variant: 'destructive' });
    }
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    try {
      await base44.entities.Prompt.delete(prompt.id);
      onChanged?.();
      toast({ title: '已删除' });
    } catch (err) {
      toast({ title: '删除失败', variant: 'destructive' });
    }
  };

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      className="group rounded-xl border border-border/50 bg-card hover:border-border hover:shadow-sm transition-all cursor-pointer p-4 flex flex-col"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-medium text-sm leading-snug line-clamp-2 flex-1">{prompt.title}</h3>
        <button onClick={handleFavorite} className="shrink-0 mt-0.5">
          <Star
            className={`w-4 h-4 transition-colors ${
              prompt.is_favorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40 hover:text-amber-400'
            }`}
          />
        </button>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[10px] px-2 py-0.5 rounded-md ${CATEGORY_COLORS[prompt.category] || CATEGORY_COLORS['综合提示']}`}>
          {prompt.category}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {new Date(prompt.updated_date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
        </span>
      </div>

      {prompt.raw_input && (
        <p className="text-[11px] text-muted-foreground/70 truncate mb-1.5">
          <span className="text-muted-foreground/50">原文：</span>{prompt.raw_input}
        </p>
      )}

      {hasZh && (
        <button
          onClick={(e) => { e.stopPropagation(); setLang(lang === 'zh' ? 'en' : 'zh'); }}
          className="self-start flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground hover:bg-muted transition-colors mb-2"
        >
          <Languages className="w-3 h-3" />
          {lang === 'zh' ? '中文' : 'EN'}
        </button>
      )}

      <p className={`text-xs text-muted-foreground leading-relaxed flex-1 ${expanded ? '' : 'line-clamp-3'} ${lang === 'en' ? 'font-mono' : ''}`}>
        {primary}
      </p>

      {prompt.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {prompt.tags.map((t, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>
          ))}
        </div>
      )}

      <div className="flex gap-1 mt-3 pt-2 border-t border-border/30">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md hover:bg-muted text-muted-foreground transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? '已复制' : '复制'}
        </button>
        {prompt.context && (
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/?restore=${prompt.id}`); }}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md hover:bg-foreground hover:text-background text-muted-foreground transition-colors"
          >
            <PenLine className="w-3.5 h-3.5" />
            继续编辑
          </button>
        )}
        <button
          onClick={handleDelete}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive ml-auto transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          删除
        </button>
      </div>
    </div>
  );
}