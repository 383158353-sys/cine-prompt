import React, { useState, useEffect, useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, Search, Check, X, Image as ImageIcon, Upload, Loader2, Plus } from 'lucide-react';
import ColorPaletteLibrary from '@/components/ColorPaletteLibrary';

const CATEGORIES = [
  { key: 'clothing', label: '服装', icon: '👗' },
  { key: 'makeup', label: '化妆', icon: '💄' },
  { key: 'hair', label: '发型', icon: '✂' },
  { key: 'palette', label: '色卡', icon: '🎨' }
];

const GENDERS = [
  { key: 'all', label: '全部' },
  { key: 'female', label: '女' },
  { key: 'male', label: '男' }
];

export default function StyleLibrary({ selectedStyles = [], onSelect, compact, paletteScope = 'character', selectedCharacterPalette, selectedEnvironmentPalette, onSelectPalette = (_value, _scope) => {} }) {
  const [styles, setStyles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('hair');
  const [paletteView,setPaletteView]=useState(paletteScope);
  useEffect(()=>setPaletteView(paletteScope),[paletteScope]);
  const [gender, setGender] = useState('all');
  const [search, setSearch] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [textInput, setTextInput] = useState('');
  const fileInput = useRef(null);

  const loadStyles = async () => {
    try {
      const res = await base44.entities.StyleLibrary.list('-updated_date', 200);
      setStyles(res || []);
    } catch {
      // 忽略
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStyles(); }, []);

  const filtered = useMemo(() => {
    return styles.filter((s) => {
      if (s.category !== category) return false;
      if (gender !== 'all' && s.gender !== gender && s.gender !== 'unisex') return false;
      if (search) {
        const q = search.toLowerCase();
        if (!s.name?.toLowerCase().includes(q) && !s.description?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [styles, category, gender, search]);

  // 多选：切换某个风格的选中状态
  const toggleStyle = (s) => {
    const exists = selectedStyles.some((x) => x.id === s.id);
    if (exists) {
      onSelect(selectedStyles.filter((x) => x.id !== s.id));
    } else {
      onSelect([...selectedStyles, s]);
    }
  };

  // 拖拽添加图片：上传 → 后端分析 → 创建StyleLibrary记录 → 自动选中
  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    setAnalyzing(true);
    try {
      const uploads = await Promise.all(files.map((f) => base44.integrations.Core.UploadFile({ file: f })));
      const fileUrls = uploads.map((u) => u.file_url);
      const res = await base44.functions.invoke('analyzeStyleImage', { file_urls: fileUrls, category });
      const analyzed = res.data?.results || [];
      const created = await base44.entities.StyleLibrary.bulkCreate(analyzed);
      setStyles((prev) => [...created, ...prev]);
      onSelect([...selectedStyles, ...created]);
    } catch (e) {
      // 忽略
    } finally {
      setAnalyzing(false);
    }
  };

  // 文本添加：输入文本 → 后端生成风格信息+缩略图 → 创建记录 → 自动选中
  const handleTextAdd = async () => {
    const text = textInput.trim();
    if (!text || analyzing) return;
    setAnalyzing(true);
    try {
      const res = await base44.functions.invoke('analyzeStyleImage', { text, category });
      const analyzed = res.data?.results || [];
      const created = await base44.entities.StyleLibrary.bulkCreate(analyzed);
      setStyles((prev) => [...created, ...prev]);
      onSelect([...selectedStyles, ...created]);
      setTextInput('');
    } catch (e) {
      // 忽略
    } finally {
      setAnalyzing(false);
    }
  };

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); };
  const onPick = (e) => { handleFiles(e.target.files); if (fileInput.current) fileInput.current.value = ''; };

  return (
    <div className="flex flex-col gap-1.5">
      {/* 分类标签 */}
      <div className="flex gap-1 items-center">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={`flex-1 px-1.5 py-1 rounded-md text-[10px] font-medium transition-all flex items-center justify-center gap-0.5 ${
              category === c.key ? 'bg-foreground text-background' : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'
            }`}
          >
            <span className="text-[9px]">{c.icon}</span>
            {c.label}
          </button>
        ))}
      </div>

      {category === 'palette' ? (
        <div className="space-y-2">
          <div className="flex gap-1 text-[10px]">
            {[['character','人物'],['environment','环境 / 视角场景']].map(([scope,label])=><button key={scope} type="button" onClick={()=>setPaletteView(scope)} className={`flex-1 rounded-md px-2 py-1 ${paletteView===scope?'bg-foreground text-background':'bg-muted/40 text-muted-foreground'}`}>{label}</button>)}
          </div>
          <ColorPaletteLibrary scope={paletteView} selectedPalette={paletteView==='character'?selectedCharacterPalette:selectedEnvironmentPalette} onSelect={palette=>onSelectPalette(palette,paletteView)} compact={compact} />
        </div>
      ) : <>

      {/* 文本输入 + 图片上传按钮 */}
      <div className="flex gap-1 items-center">
        <input
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && textInput.trim()) handleTextAdd(); }}
          disabled={analyzing}
          placeholder={`输入${CATEGORIES.find(c=>c.key===category)?.label}描述…`}
          className="flex-1 h-6 px-2 rounded-md bg-muted/30 border border-border/40 text-[10px] focus:outline-none focus:ring-1 focus:ring-border/60 disabled:opacity-50"
        />
        <button
          onClick={handleTextAdd}
          disabled={analyzing || !textInput.trim()}
          title="输入文本添加，自动生成缩略图"
          className="px-1.5 h-6 rounded-md text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-all flex items-center gap-0.5 disabled:opacity-50 shrink-0"
        >
          {analyzing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Plus className="w-2.5 h-2.5" />}
          添加
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('ring-1', 'ring-primary/40'); }}
          onDragLeave={(e) => { e.currentTarget.classList.remove('ring-1', 'ring-primary/40'); }}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('ring-1', 'ring-primary/40'); handleFiles(e.dataTransfer.files); }}
          disabled={analyzing}
          title="拖拽图片到此处或点击上传"
          className="px-1.5 h-6 rounded-md text-[10px] font-medium bg-muted/40 text-muted-foreground hover:bg-muted/70 transition-all flex items-center gap-0.5 disabled:opacity-50 shrink-0"
        >
          <Upload className="w-2.5 h-2.5" />
        </button>
        <input ref={fileInput} type="file" accept="image/*" multiple onChange={onPick} className="hidden" />
      </div>

      {/* 性别筛选 + 搜索 */}
      <div className="flex items-center gap-1.5">
        <div className="flex gap-0.5">
          {GENDERS.map((g) => (
            <button
              key={g.key}
              onClick={() => setGender(g.key)}
              className={`px-1.5 py-0.5 rounded-full text-[9px] transition-all ${
                gender === g.key ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex-1 relative">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索…"
            className="w-full h-6 pl-6 pr-2 rounded-md bg-muted/30 border border-border/40 text-[10px] focus:outline-none focus:ring-1 focus:ring-border/60"
          />
        </div>
      </div>

      {/* 已选风格提示 */}
      {selectedStyles.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-primary bg-primary/10 border border-primary/20 rounded-md px-1.5 py-1">
          <Check className="w-2.5 h-2.5 shrink-0" />
          <span className="shrink-0">已选{selectedStyles.length}项</span>
          {selectedStyles.map((s) => (
            <span key={s.id} className="flex items-center gap-0.5 bg-primary/10 rounded px-1 py-0.5">
              {s.name}
              <button onClick={() => toggleStyle(s)} className="hover:text-primary">
                <X className="w-2 h-2" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 拖拽区域 + 风格卡片网格 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-md transition-colors ${dragOver ? 'bg-primary/5 ring-1 ring-primary/30' : ''}`}
      >
        <ScrollArea className={compact ? "h-[160px]" : "h-[220px]"}>
          {loading ? (
            <div className="flex items-center justify-center py-6 text-[10px] text-muted-foreground">
              <Sparkles className="w-2.5 h-2.5 mr-1 animate-pulse" />
              加载风格库…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-[10px] text-muted-foreground gap-1">
              <Upload className="w-3 h-3" />
              <span>拖拽图片到此处或点击"添加"</span>
              <span className="text-[9px]">自动分析{CATEGORIES.find(c=>c.key===category)?.label}风格</span>
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-0.5 p-0.5">
              {filtered.map((s) => {
                const active = selectedStyles.some((x) => x.id === s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleStyle(s)}
                    title={s.name}
                    className={`relative rounded overflow-hidden border transition-all text-left group ${
                      active ? 'border-primary ring-1 ring-primary/40' : 'border-border/40 hover:border-border'
                    }`}
                  >
                    <div className="aspect-square bg-muted/20 overflow-hidden">
                      {s.thumbnail_url ? (
                        <img src={s.thumbnail_url} alt={s.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/40 gap-0.5">
                          <ImageIcon className="w-2 h-2" />
                        </div>
                      )}
                    </div>
                    {active && (
                      <div className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                        <Check className="w-1.5 h-1.5" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
      </>}
    </div>
  );
}
