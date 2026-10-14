import React, { useCallback, useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { Check, ImagePlus, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { analyzePaletteFromImage, hexToRgb, sampleImageColor } from '@/lib/paletteExtraction';
import { downloadPalette } from '@/lib/paletteImage';
import { normalizePaletteWeights, resizePaletteBoundary } from '@/lib/paletteWeights';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ROLES = ['Primary', 'Secondary', 'Accent', 'Highlight', 'Shadow'];
const ROLE_LABELS = { Primary: '主色', Secondary: '辅助色', Accent: '强调色', Highlight: '高光', Shadow: '阴影' };
const FALLBACK = ['#334155', '#64748B', '#94A3B8', '#CBD5E1', '#F1F5F9'];
const EMPTY_ANALYSIS = { temperature: '', brightness: '', saturation: '', contrast: '', harmony: '', tendency: '', highlight_tendency: '', shadow_tendency: '', description: '' };
const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

const detailFromHex = (hex, index = 0, count = FALLBACK.length) => ({
  id: makeId(), name: ROLE_LABELS[index === 0 ? 'Primary' : 'Secondary'], hex: String(hex).toUpperCase(),
  rgb: hexToRgb(hex), percentage: 100 / count, role: index === 0 ? 'Primary' : 'Secondary'
});

const normalizeDetails = (item) => normalizePaletteWeights(
  Array.isArray(item?.colors) && item.colors.length
    ? item.colors.map((color, index) => ({
      id: color.id || makeId(), name: color.name || `颜色${index + 1}`, hex: String(color.hex || '#000000').toUpperCase(),
      rgb: hexToRgb(color.hex), percentage: Number(color.percentage) || 0,
      role: ROLES.includes(color.role) ? color.role : index === 0 ? 'Primary' : 'Secondary'
    }))
    : (item?.palette || FALLBACK).map((hex, index, palette) => detailFromHex(hex, index, palette.length))
);

function PaletteStrip({ colors, activeColor, onSelect, onResize }) {
  const barRef = useRef(null);
  const dragRef = useRef(null);
  const [draggingBoundary, setDraggingBoundary] = useState(null);

  useEffect(() => {
    const move = (event) => {
      if (!dragRef.current || !barRef.current) return;
      const delta = (event.clientX - dragRef.current.startX) / barRef.current.getBoundingClientRect().width * 100;
      onResize(dragRef.current.index, delta, dragRef.current.colors);
      setDraggingBoundary(dragRef.current.index);
    };
    const stop = () => { dragRef.current = null; setDraggingBoundary(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
  }, [onResize]);

  return <div ref={barRef} className="relative flex h-16 overflow-visible rounded-lg border border-border bg-muted shadow-inner">
    {colors.map((color, index) => <div key={color.id} className="relative min-w-0" style={{ width: `${color.percentage}%`, backgroundColor: color.hex }}>
      <button type="button" aria-label={`编辑颜色 ${index + 1} ${color.hex}`} onClick={() => onSelect(index)} className={`absolute inset-0 transition-shadow ${activeColor === index ? 'ring-2 ring-inset ring-white/90' : 'hover:ring-1 hover:ring-inset hover:ring-white/60'}`} />
      {index < colors.length - 1 && <button
        type="button" aria-label={`调整颜色 ${index + 1} 和 ${index + 2} 的占比`}
        onPointerDown={(event) => {
          event.preventDefault();
          dragRef.current = { index, startX: event.clientX, colors: colors.map((entry) => ({ ...entry })) };
          setDraggingBoundary(index);
        }}
        className="group absolute -right-2 top-0 z-10 h-full w-4 cursor-col-resize touch-none"
      >
        <span className="absolute left-1/2 top-1/2 h-9 w-px -translate-x-1/2 -translate-y-1/2 bg-white/70 shadow-[0_0_0_1px_rgba(0,0,0,.18)] transition-all group-hover:h-12 group-hover:w-0.5 group-hover:bg-white" />
        {draggingBoundary === index && <span className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded bg-foreground px-1.5 py-1 text-[9px] text-background shadow">{Math.round(color.percentage)}%</span>}
      </button>}
    </div>)}
  </div>;
}

export default function ColorPaletteLibrary({ scope, selectedPalette, onSelect = (_value) => {}, compact = false }) {
  const label = '';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [sourceImage, setSourceImage] = useState('');
  const [savedSourceImage, setSavedSourceImage] = useState('');
  const [sourceFile, setSourceFile] = useState(null);
  const [colors, setColors] = useState(() => normalizeDetails({ palette: FALLBACK }));
  const [analysis, setAnalysis] = useState(EMPTY_ANALYSIS);
  const [points, setPoints] = useState([]);
  const [colorCount, setColorCount] = useState(6);
  const [variation, setVariation] = useState(50);
  const [activeColor, setActiveColor] = useState(0);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);
  const imageRef = useRef(null);
  const pendingAnalysisFile = useRef(null);
  const draggingPoint = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await base44.entities.ColorPalette.filter({ scope }, '-updated_date', 200);
      setItems(rows || []);
      if (selectedPalette && !rows?.some((row) => row.id === selectedPalette.id)) onSelect(null);
    } catch (error) {
      toast({ title: `${label}色卡加载失败`, description: error.message, variant: 'destructive' });
    } finally { setLoading(false); }
  }, [label, onSelect, scope, selectedPalette]);

  useEffect(() => { load(); }, [scope]);
  useEffect(() => () => { if (sourceImage?.startsWith('blob:')) URL.revokeObjectURL(sourceImage); }, [sourceImage]);

  const resetEditor = () => {
    setEditingId(null); setName(`我的${label}色卡`); setSourceImage(''); setSavedSourceImage(''); setSourceFile(null);
    setColors(normalizeDetails({ palette: FALLBACK })); setAnalysis(EMPTY_ANALYSIS); setPoints([]); setColorCount(6); setVariation(50);
    setActiveColor(0); setColorPickerOpen(false); pendingAnalysisFile.current = null;
  };
  const openNew = () => { resetEditor(); setEditorOpen(true); };
  const openEdit = (item) => {
    const details = normalizeDetails(item);
    setEditingId(item.id); setName(item.name); setSourceImage(item.source_image || ''); setSavedSourceImage(item.source_image || ''); setSourceFile(null);
    setColors(details); setAnalysis({ ...EMPTY_ANALYSIS, ...(item.analysis || {}) }); setPoints(Array.isArray(item.sampling_points) ? item.sampling_points : []);
    setColorCount(details.length); setVariation(item.variation ?? 50); setActiveColor(0); setColorPickerOpen(false); setEditorOpen(true);
  };

  const applyLocalAnalysis = useCallback((nextCount = colorCount, nextVariation = variation) => {
    if (!imageRef.current) return;
    try {
      const result = analyzePaletteFromImage(imageRef.current, { count: nextCount, variation: nextVariation, scope });
      setColors(normalizePaletteWeights(result.colors)); setAnalysis({ ...EMPTY_ANALYSIS, ...result.analysis });
      setPoints(result.points || []); setActiveColor(0); setColorPickerOpen(false);
    } catch {
      toast({ title: '无法读取图片颜色', description: '请重新上传图片后再试。', variant: 'destructive' });
    }
  }, [colorCount, scope, variation]);

  const applyAiAnalysis = async (fileOrUrl) => {
    setAnalyzing(true);
    try {
      let url = typeof fileOrUrl === 'string' ? fileOrUrl : '';
      if (fileOrUrl instanceof File) {
        url = (await base44.integrations.Core.UploadFile({ file: fileOrUrl })).file_url;
        setSavedSourceImage(url);
      }
      if (!url) return;
      const response = await base44.functions.invoke('analyzeColorPalette', { file_url: url, scope });
      if (response.data?.analysis) setAnalysis((current) => ({ ...current, ...response.data.analysis }));
    } catch (error) {
      toast({ title: '已完成本地色彩分析', description: `AI语义分析暂不可用：${error.message}` });
    } finally { setAnalyzing(false); }
  };

  const handleImageLoad = () => {
    if (pendingAnalysisFile.current) {
      const file = pendingAnalysisFile.current; pendingAnalysisFile.current = null;
      applyLocalAnalysis(); applyAiAnalysis(file);
    } else if (sourceImage && points.length === 0) applyLocalAnalysis(colorCount, variation);
  };
  const acceptFile = (file) => {
    if (!file || !ACCEPTED_TYPES.has(file.type)) {
      toast({ title: '仅支持 JPG、JPEG、PNG、WebP', variant: 'destructive' }); return;
    }
    if (sourceImage?.startsWith('blob:')) URL.revokeObjectURL(sourceImage);
    pendingAnalysisFile.current = file; setSourceFile(file); setSavedSourceImage(''); setSourceImage(URL.createObjectURL(file));
    setPoints([]); setEditorOpen(true);
  };
  const reanalyze = () => {
    applyLocalAnalysis();
    const target = sourceFile || savedSourceImage;
    if (target) applyAiAnalysis(target);
  };

  const updateHex = (index, value) => {
    const hex = String(value).toUpperCase();
    setColors((current) => current.map((color, colorIndex) => colorIndex === index
      ? { ...color, hex, ...(/^#[0-9A-F]{6}$/.test(hex) ? { rgb: hexToRgb(hex) } : {}) }
      : color));
  };
  const sampleAt = (index, clientX, clientY) => {
    if (!imageRef.current || !colors[index]) return;
    try {
      const result = sampleImageColor(imageRef.current, clientX, clientY);
      setColors((current) => current.map((color, colorIndex) => colorIndex === index ? { ...color, hex: result.color, rgb: result.rgb } : color));
      setPoints((current) => [...current.filter((point) => point.colorIndex !== index), { ...result.point, colorIndex: index }]);
      setActiveColor(index); setColorPickerOpen(false);
    } catch { toast({ title: '取色失败，请重新上传图片', variant: 'destructive' }); }
  };
  const addColor = () => {
    if (colors.length >= 8) return;
    const nextIndex = colors.length;
    setColors((current) => normalizePaletteWeights([...current, detailFromHex('#808080', nextIndex, nextIndex + 1)]));
    setPoints((current) => [...current, { x: 50, y: 50, colorIndex: nextIndex }]);
    setColorCount(nextIndex + 1); setActiveColor(nextIndex); setColorPickerOpen(false);
  };
  const removeColor = (index = activeColor) => {
    if (colors.length <= 3 || index < 0) return;
    setColors((current) => normalizePaletteWeights(current.filter((_, colorIndex) => colorIndex !== index)));
    setPoints((current) => current.filter((point) => point.colorIndex !== index).map((point) => point.colorIndex > index ? { ...point, colorIndex: point.colorIndex - 1 } : point));
    setColorCount((value) => Math.max(3, value - 1)); setActiveColor(0); setColorPickerOpen(false);
  };
  const resizeBoundary = useCallback((index, delta, startingColors) => setColors(resizePaletteBoundary(startingColors, index, delta)), []);

  const save = async () => {
    if (!sourceImage) { toast({ title: '请先上传参考图片', variant: 'destructive' }); return; }
    if (colors.length < 3 || colors.some((color) => !/^#[0-9A-F]{6}$/.test(color.hex))) {
      toast({ title: '请检查颜色值，至少保留三个有效的六位 HEX 颜色', variant: 'destructive' }); return;
    }
    setSaving(true);
    try {
      let imageUrl = savedSourceImage;
      if (!imageUrl && sourceFile) imageUrl = (await base44.integrations.Core.UploadFile({ file: sourceFile })).file_url;
      if (!imageUrl) imageUrl = sourceImage;
      const now = new Date().toISOString();
      const normalizedColors = normalizePaletteWeights(colors).map((color, index) => ({
        name: color.name?.trim() || `颜色${index + 1}`, hex: color.hex, rgb: hexToRgb(color.hex), percentage: color.percentage, role: color.role
      }));
      const payload = {
        name: name.trim() || `我的${label}色卡`, scope, source_image: imageUrl,
        palette: normalizedColors.map((color) => color.hex), colors: normalizedColors, analysis,
        sampling_points: points, color_count: normalizedColors.length, variation, updated_at: now
      };
      const saved = editingId ? await base44.entities.ColorPalette.update(editingId, payload) : await base44.entities.ColorPalette.create({ ...payload, created_at: now });
      await load(); onSelect(saved); setEditorOpen(false); toast({ title: `${label}色卡已保存` });
    } catch (error) { toast({ title: '色卡保存失败', description: error.message, variant: 'destructive' }); }
    finally { setSaving(false); }
  };
  const remove = async (item) => {
    if (!window.confirm(`确定删除“${item.name}”吗？`)) return;
    try {
      await base44.entities.ColorPalette.delete(item.id);
      if (selectedPalette?.id === item.id) onSelect(null);
      setItems((current) => current.filter((row) => row.id !== item.id));
    } catch (error) { toast({ title: '删除失败', description: error.message, variant: 'destructive' }); }
  };
  const duplicate = async (item) => {
    try {
      const { id, created_date, updated_date, ...data } = item;
      const copy = await base44.entities.ColorPalette.create({ ...data, name: `${item.name} 副本`, created_at: new Date().toISOString() });
      setItems((current) => [copy, ...current]);
    } catch (error) { toast({ title: '复制失败', description: error.message, variant: 'destructive' }); }
  };
  const rename = async (item) => {
    const next = window.prompt('输入新的色卡名称', item.name)?.trim();
    if (!next || next === item.name) return;
    try {
      const updated = await base44.entities.ColorPalette.update(item.id, { name: next, updated_at: new Date().toISOString() });
      setItems((current) => current.map((row) => row.id === item.id ? updated : row));
      if (selectedPalette?.id === item.id) onSelect(updated);
    } catch (error) { toast({ title: '重命名失败', description: error.message, variant: 'destructive' }); }
  };

  return <div className="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-3">
    <div className="flex items-center justify-between gap-2">
      <div><div className="text-xs font-medium">色卡</div><div className="text-[9px] text-muted-foreground">{scope === 'character' ? '只约束人物肤色、发色、妆容、服装与人物光影' : '只约束环境、建筑、材质、天空与氛围光'}</div></div>
      <Button type="button" size="sm" className="h-8 text-[11px]" onClick={openNew}><ImagePlus className="mr-1 h-3.5 w-3.5" />＋ 导入图片生成色卡</Button>
    </div>
    {selectedPalette && <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 p-2 text-[10px]"><Check className="h-3 w-3 text-primary" /><span className="shrink-0">已选：{selectedPalette.name}</span><div className="flex h-4 flex-1 overflow-hidden rounded">{normalizeDetails(selectedPalette).map((color) => <span key={color.id} style={{ width: `${color.percentage}%`, backgroundColor: color.hex }} />)}</div><button type="button" onClick={() => onSelect(null)} title="取消选择"><X className="h-3 w-3" /></button></div>}
    {selectedPalette && <p className="rounded-md bg-muted/30 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">生成提示词会说明色卡名称、颜色及占比，并将色卡图加入参考；{scope==='character'?'只调整人物配色与光影。':'环境与场景视角共用这张色卡，只调整场景配色与光影。'}</p>}
    {loading
      ? <div className="py-5 text-center text-[10px] text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />加载色卡…</div>
      : items.length === 0
        ? <button type="button" onClick={openNew} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); openNew(); acceptFile(event.dataTransfer.files?.[0]); }} className="w-full rounded-md border border-dashed border-border/60 py-8 text-[10px] text-muted-foreground hover:bg-muted/30">暂无{label}色卡，拖入参考图或点击上方按钮创建</button>
        : <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>{items.map((item) => {
          const itemColors = normalizeDetails(item);
          const active = selectedPalette?.id === item.id;
          return <div key={item.id} className={`overflow-hidden rounded-lg border bg-background ${active ? 'border-primary ring-1 ring-primary/30' : 'border-border/50'}`}>
            <button type="button" onClick={() => onSelect(item)} className="block w-full text-left" title="加入色卡参考图">
              <div className="aspect-[16/8] overflow-hidden bg-muted/30"><img src={item.source_image} alt={`${item.name}参考图`} className="h-full w-full object-cover" /></div>
              <div className="flex h-5">{itemColors.map((color) => <span key={color.id} style={{ width: `${color.percentage}%`, backgroundColor: color.hex }} />)}</div>
              <div className="px-2 py-1.5"><div className="truncate text-[10px] font-medium">{item.name}</div><div className="text-[9px] text-muted-foreground">{label}色卡 · {itemColors.length}色 · 点击加入参考</div></div>
            </button>
            <div className="grid grid-cols-6 border-t border-border/40 text-[9px]"><button type="button" onClick={() => onSelect(active ? null : item)} className={`py-1.5 ${active ? 'bg-primary/10 text-primary' : 'hover:bg-muted/40'}`}>{active ? '已使用' : '使用'}</button><button type="button" onClick={() => openEdit(item)} className="py-1.5 hover:bg-muted/40">编辑</button><button type="button" onClick={() => downloadPalette(item)} className="py-1.5 hover:bg-muted/40">下载</button><button type="button" onClick={() => duplicate(item)} className="py-1.5 hover:bg-muted/40">复制</button><button type="button" onClick={() => rename(item)} className="py-1.5 hover:bg-muted/40">重命名</button><button type="button" onClick={() => remove(item)} className="py-1.5 text-destructive hover:bg-destructive/10">删除</button></div>
          </div>;
        })}</div>}

    {editorOpen && <div role="dialog" aria-modal="true" aria-label={`${editingId ? '编辑' : '创建'}${label}色卡`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditorOpen(false); }}>
      <div className="max-h-[96vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-border bg-background shadow-2xl">
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border/60 bg-background/95 px-5 py-3 backdrop-blur">
          <div><h2 className="text-base font-semibold">{editingId ? '编辑' : '创建'}{label}色卡</h2><p className="text-[10px] text-muted-foreground">拖动图片取色点与色带分界线即可完成调整</p></div>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>退出</Button><Button type="button" onClick={save} disabled={saving || !sourceImage}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}保存色卡</Button></div>
        </div>
        <div className="space-y-5 p-5">
          <div className="flex items-center gap-3"><label className="shrink-0 text-xs font-medium">色卡名称</label><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：深海游艇" className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm" /></div>
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-xs font-medium">原始参考图</div><div className="text-[10px] text-muted-foreground">点击图片为当前颜色重新取色；拖动圆点可实时更新</div></div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={addColor} disabled={!sourceImage || colors.length >= 8}><Plus className="mr-1 h-3 w-3" />增加取色点</Button><Button type="button" variant="outline" size="sm" onClick={() => removeColor()} disabled={!sourceImage || colors.length <= 3}><Trash2 className="mr-1 h-3 w-3" />删除取色点</Button></div></div>
            <div onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(event) => { event.preventDefault(); setDragOver(false); acceptFile(event.dataTransfer.files?.[0]); }} className={`relative flex min-h-72 items-center justify-center overflow-hidden rounded-xl border border-dashed bg-neutral-950/95 p-2 ${dragOver ? 'border-primary' : 'border-border'}`}>
              {sourceImage ? <div className="relative inline-block max-w-full" onPointerMove={(event) => { if (draggingPoint.current !== null) sampleAt(draggingPoint.current, event.clientX, event.clientY); }} onPointerUp={() => { draggingPoint.current = null; }}>
                <img ref={imageRef} src={sourceImage} alt="色卡参考图" onLoad={handleImageLoad} onClick={(event) => sampleAt(activeColor, event.clientX, event.clientY)} className="block max-h-[52vh] max-w-full cursor-crosshair select-none object-contain" draggable={false} />
                {points.map((point) => <button
                  type="button" key={point.colorIndex} aria-label={`取色点 ${point.colorIndex + 1}`}
                  onClick={(event) => { event.stopPropagation(); setActiveColor(point.colorIndex); setColorPickerOpen(false); }}
                  onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); draggingPoint.current = point.colorIndex; setActiveColor(point.colorIndex); }}
                  className={`absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none rounded-full border-[3px] border-white shadow-[0_1px_5px_rgba(0,0,0,.8)] ${activeColor === point.colorIndex ? 'ring-2 ring-primary ring-offset-1 ring-offset-black' : ''}`}
                  style={{ left: `${point.x}%`, top: `${point.y}%`, backgroundColor: colors[point.colorIndex]?.hex }}
                />)}
              </div> : <button type="button" onClick={() => fileInput.current?.click()} className="py-16 text-xs text-muted-foreground"><ImagePlus className="mx-auto mb-2 h-8 w-8" />上传或拖入 JPG / PNG / WebP</button>}
              {analyzing && <div className="absolute inset-0 flex items-center justify-center bg-background/75 text-xs"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在完成色彩语义分析…</div>}
            </div>
            <input ref={fileInput} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={(event) => { acceptFile(event.target.files?.[0]); event.target.value = ''; }} className="hidden" />
            <div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>更换图片</Button><Button type="button" variant="outline" size="sm" onClick={reanalyze} disabled={!sourceImage || analyzing}><RefreshCw className="mr-1 h-3 w-3" />重新分析</Button></div>
          </section>

          <section className="space-y-2">
            <div><div className="text-xs font-medium">色卡</div><div className="text-[10px] text-muted-foreground">拖动分界线调整相邻颜色占比；点击色块可直接改色</div></div>
            <PaletteStrip colors={colors} activeColor={activeColor} onSelect={(index) => { setActiveColor(index); setColorPickerOpen(true); }} onResize={resizeBoundary} />
            {colorPickerOpen && colors[activeColor] && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <label className="relative h-10 w-14 cursor-pointer overflow-hidden rounded-md border border-border shadow-inner" style={{ backgroundColor: colors[activeColor].hex }}><input type="color" value={colors[activeColor].hex} onChange={(event) => updateHex(activeColor, event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" /></label>
              <div><label className="mb-1 block text-[9px] text-muted-foreground">HEX</label><input value={colors[activeColor].hex} onChange={(event) => updateHex(activeColor, event.target.value)} className="h-8 w-28 rounded-md border border-border bg-background px-2 font-mono text-xs uppercase" /></div>
              <span className="text-[10px] text-muted-foreground">颜色 {activeColor + 1} · 与图片取色点保持关联</span>
              <button type="button" onClick={() => setColorPickerOpen(false)} className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted" aria-label="关闭颜色选择器"><X className="h-4 w-4" /></button>
            </div>}
          </section>

          <section className="grid gap-5 rounded-xl border border-border/60 bg-muted/10 p-4 sm:grid-cols-2">
            <label className="space-y-2"><span className="flex items-center justify-between text-xs font-medium"><span>色彩数量</span><span className="text-muted-foreground">{colorCount} 色</span></span><input type="range" min="3" max="8" step="1" value={colorCount} disabled={!sourceImage} onChange={(event) => { const value = Number(event.target.value); setColorCount(value); applyLocalAnalysis(value, variation); }} className="w-full accent-foreground" /><span className="flex justify-between text-[9px] text-muted-foreground"><span>3</span><span>8</span></span></label>
            <label className="space-y-2"><span className="flex items-center justify-between text-xs font-medium"><span>色彩变化</span><span className="text-muted-foreground">{variation}</span></span><input type="range" min="0" max="100" step="1" value={variation} disabled={!sourceImage} onChange={(event) => { const value = Number(event.target.value); setVariation(value); applyLocalAnalysis(colorCount, value); }} className="w-full accent-foreground" /><span className="flex justify-between text-[9px] text-muted-foreground"><span>统一</span><span>差异</span></span></label>
          </section>
        </div>
      </div>
    </div>}
  </div>;
}
