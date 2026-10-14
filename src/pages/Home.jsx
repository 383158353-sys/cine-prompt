import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import PromptEnhancer from '@/components/PromptEnhancer';
import RecoverableBoundary from '@/components/RecoverableBoundary';
import PromptCard from '@/components/PromptCard';
import PwaInstallPrompt from '@/components/PwaInstallPrompt';
import { Search, Sparkles, Library, Star, PlugZap, Plus, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import BrandLogo from '@/components/BrandLogo';

const CATEGORIES = ['全部', '综合提示', '镜头运镜', '光影氛围', '风格美学', '角色表演', '场景构图', '后期特效'];

export default function Home() {
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('全部');
  const [favOnly, setFavOnly] = useState(false);
  const [tasks,setTasks]=useState([{id:1,title:'任务 1',status:'idle'}]);
  const [activeTask,setActiveTask]=useState(1);
  const nextTaskId=React.useRef(2);
  const addTask=()=>{const id=nextTaskId.current++;setTasks(current=>[...current,{id,title:`任务 ${id}`,status:'idle'}]);setActiveTask(id);};
  const updateTask=(id,patch)=>setTasks(current=>current.map(task=>task.id===id?{...task,...patch}:task));
  const closeTask=(id)=>{
    const task=tasks.find(item=>item.id===id);
    if(!task||task.status==='running'||tasks.length===1)return;
    const remaining=tasks.filter(item=>item.id!==id);
    setTasks(remaining);if(activeTask===id)setActiveTask(remaining[remaining.length-1].id);
  };

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const items = await base44.entities.Prompt.list('-updated_date', 200);
      setPrompts(items);
    } catch (e) {
      setPrompts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const filtered = prompts.filter((p) => {
    if (favOnly && !p.is_favorite) return false;
    if (filter !== '全部' && p.category !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.title?.toLowerCase().includes(q) ||
        p.content?.toLowerCase().includes(q) ||
        p.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // ===== 完整版（Full Mode）— 留白更多、提示词库占比更小 =====
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/40 sticky top-0 bg-background/80 backdrop-blur-md z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <BrandLogo size={38} titleClass="font-semibold text-lg" />
          <div className="flex items-center gap-3">
            <PwaInstallPrompt />
            <Link to="/photoshop" className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/60 hover:bg-muted transition-colors">
              <PlugZap className="w-3.5 h-3.5" />
              PS 联动
            </Link>
            <Link to="/settings" className="text-xs px-3 py-1.5 rounded-lg border border-border/60 hover:bg-muted transition-colors">API 设置</Link>
            <Link
              to="/history"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/60 hover:bg-muted transition-colors"
            >
              <Library className="w-3.5 h-3.5" />
              历史记录
            </Link>
            <span className="text-xs text-muted-foreground hidden sm:block">
              {prompts.length} 条提示词
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <aside className="lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto pr-1">
          <div className="flex items-center gap-1 overflow-x-auto pb-2 mb-3 border-b border-border/50" role="tablist" aria-label="工作台任务">
            {tasks.map(task=><div key={task.id} className={`flex shrink-0 items-center rounded-md border text-xs ${activeTask===task.id?'bg-foreground text-background border-foreground':'bg-muted/40 border-border/60'}`}>
              <button type="button" role="tab" aria-selected={activeTask===task.id} onClick={()=>setActiveTask(task.id)} className="px-2.5 py-1.5 whitespace-nowrap">{task.title}{task.status==='running'?' · 生成中':task.status==='done'?' · 完成':task.status==='error'?' · 失败':''}</button>
              {tasks.length>1&&<button type="button" onClick={()=>closeTask(task.id)} disabled={task.status==='running'} title={task.status==='running'?'生成中不能关闭':'关闭任务'} aria-label={`关闭${task.title}`} className="pr-1.5 disabled:opacity-30"><X className="w-3 h-3" /></button>}
            </div>)}
            <button type="button" onClick={addTask} className="shrink-0 rounded-md border border-dashed border-border/70 px-2 py-1.5 text-xs" aria-label="新建任务"><Plus className="w-3.5 h-3.5" /></button>
          </div>
          {tasks.map(task=><div key={task.id} hidden={activeTask!==task.id}>
            <RecoverableBoundary><PromptEnhancer active={activeTask===task.id} bridgeEnabled={task.id===1} onSaved={loadPrompts} onTaskStatus={status=>updateTask(task.id,{status})} /></RecoverableBoundary>
          </div>)}
        </aside>

        <section className="lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
          <div className="flex items-center gap-2 mb-3">
            <Library className="w-3.5 h-3.5 text-muted-foreground" />
            <h2 className="font-semibold text-xs">提示词库</h2>
            <span className="text-[10px] text-muted-foreground">({filtered.length})</span>
          </div>

          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索…"
              data-gramm="false"
              data-gramm_editor="false"
              data-enable-grammarly="false"
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-muted/40 border border-border/50 focus:outline-none focus:border-border focus:bg-background transition-colors"
            />
          </div>

          <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={`px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap transition-all ${
                  filter === c
                    ? 'bg-foreground text-background'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                {c}
              </button>
            ))}
            <button
              onClick={() => setFavOnly(!favOnly)}
              className={`px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap transition-all flex items-center gap-1 ${
                favOnly ? 'bg-amber-400/20 text-amber-600' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              <Star className={`w-3 h-3 ${favOnly ? 'fill-amber-400' : ''}`} />
              收藏
            </button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-2.5">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-20 rounded-lg bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Sparkles className="w-7 h-7 mx-auto mb-2 opacity-30" />
              <p className="text-xs">还没有提示词，在左侧输入灵感开始创作</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5">
              {filtered.map((p) => (
                <PromptCard key={p.id} prompt={p} onChanged={loadPrompts} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
