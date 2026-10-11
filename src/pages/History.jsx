import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Sparkles, ArrowLeft, Copy, Check, Trash2, Star, Languages, PenLine } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

const CATEGORIES = ['全部', '综合提示', '镜头运镜', '光影氛围', '风格美学', '角色表演', '场景构图', '后期特效', '收藏'];

const CATEGORY_COLORS = {
  '镜头运镜': 'bg-blue-500/10 text-blue-600',
  '光影氛围': 'bg-amber-500/10 text-amber-600',
  '风格美学': 'bg-purple-500/10 text-purple-600',
  '角色表演': 'bg-rose-500/10 text-rose-600',
  '场景构图': 'bg-emerald-500/10 text-emerald-600',
  '后期特效': 'bg-cyan-500/10 text-cyan-600',
  '综合提示': 'bg-slate-500/10 text-slate-600'
};

function HistoryCard({ prompt, onChanged }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lang, setLang] = useState('zh'); // 中文为主

  const primary = lang === 'zh' ? (prompt.content_zh || prompt.content) : prompt.content;
  const hasZh = Boolean(prompt.content_zh);

  const handleCopy = (e) => {
    e.stopPropagation();
    if (!primary) return;
    navigator.clipboard.writeText(primary);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast({ title: '已复制' });
  };

  const handleFavorite = async (e) => {
    e.stopPropagation();
    try {
      await base44.entities.Prompt.update(prompt.id, { is_favorite: !prompt.is_favorite });
      onChanged?.();
    } catch {
      toast({ title: '操作失败', variant: 'destructive' });
    }
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    try {
      await base44.entities.Prompt.delete(prompt.id);
      onChanged?.();
      toast({ title: '已删除' });
    } catch {
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
        {prompt.category && (
          <span className={`text-[10px] px-2 py-0.5 rounded-md ${CATEGORY_COLORS[prompt.category] || CATEGORY_COLORS['综合提示']}`}>
            {prompt.category}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">
          {new Date(prompt.updated_date || prompt.created_date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
        </span>
      </div>

      {prompt.raw_input && (
        <p className="text-[11px] text-muted-foreground/70 truncate mb-1.5">
          <span className="text-muted-foreground/50">原文：</span>{prompt.raw_input}
        </p>
      )}

      <div className="flex items-center justify-between gap-1.5 mb-2">
        {hasZh && (
          <button
            onClick={(e) => { e.stopPropagation(); setLang(lang === 'zh' ? 'en' : 'zh'); }}
            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground hover:bg-muted transition-colors"
          >
            <Languages className="w-3 h-3" />
            {lang === 'zh' ? '中文' : 'EN'}
          </button>
        )}
        <span className="text-[10px] text-muted-foreground/50 ml-auto">{lang === 'zh' ? '中文提示词' : '英文提示词'}</span>
      </div>

      <p className={`text-xs text-muted-foreground leading-relaxed flex-1 ${expanded ? '' : 'line-clamp-3'} ${lang === 'en' ? 'font-mono' : ''}`}>
        {primary || prompt.content}
      </p>

      {prompt.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2.5">
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

export default function History() {
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('全部');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await base44.entities.Prompt.list('-updated_date', 500);
      setPrompts(items);
    } catch {
      setPrompts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = prompts.filter((p) => {
    if (filter === '收藏') {
      if (!p.is_favorite) return false;
    } else if (filter !== '全部' && p.category !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.title?.toLowerCase().includes(q) ||
        p.raw_input?.toLowerCase().includes(q) ||
        p.content?.toLowerCase().includes(q) ||
        p.content_zh?.toLowerCase().includes(q) ||
        p.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/40 sticky top-0 bg-background/80 backdrop-blur-md z-10">
        <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-1.5 rounded-lg hover:bg-muted transition-colors">
              <ArrowLeft className="w-4.5 h-4.5" />
            </Link>
            <div>
              <h1 className="font-semibold text-lg leading-none">提示词库</h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">所有增强与反推记录均自动存档，中文为主、可切换英文</p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">{prompts.length} 条记录</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-6">
        <div className="relative mb-4">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标题、原文、提示词或标签…"
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-lg bg-muted/40 border border-border/50 focus:outline-none focus:border-border focus:bg-background transition-colors"
          />
        </div>

        <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all flex items-center gap-1 ${
                filter === c ? 'bg-foreground text-background' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              {c === '收藏' && <Star className="w-3 h-3" />}
              {c}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...Array(9)].map((_, i) => (
              <div key={i} className="h-44 rounded-xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">还没有记录，去增强或反推一个提示词吧</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((p) => (
              <HistoryCard key={p.id} prompt={p} onChanged={load} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}