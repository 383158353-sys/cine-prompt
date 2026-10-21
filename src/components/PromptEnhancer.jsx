import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { GROUPS, STYLES, TARGETS, PLACEHOLDERS } from '@/lib/directions';
import { useChatModelItems } from '@/components/ChatModelManager';
import CustomDirectionForm from '@/components/CustomDirectionForm';
import DirectionDetail from '@/components/DirectionDetail';
import { Loader2, Sparkles, ImagePlus, X, Plus, PenLine, Eye } from 'lucide-react';
import VoiceTextarea from '@/components/VoiceTextarea';
import { useImagePaste } from '@/hooks/useImagePaste';
import ImageAnnotator from '@/components/ImageAnnotator';
import ReversePrompt from '@/components/ReversePrompt';
import ViewpointPrompt from '@/components/ViewpointPrompt';
import VideoDirector from '@/components/VideoDirector';
import LogicRepair from '@/components/LogicRepair';
import BatchStoryboard from '@/components/BatchStoryboard';
import StyleLibrary from '@/components/StyleLibrary';
import IconPicker from '@/components/IconPicker';
import PromptOutput from '@/components/PromptOutput';
import ResultBoundary from '@/components/ResultBoundary';
import { toast } from '@/components/ui/use-toast';
import { compressImages } from '@/lib/compressImage';
import { createPaletteImage } from '@/lib/paletteImage';
import { PROJECT_STYLES, projectStylePayload } from '../../shared/project-styles.mjs';
import { urlToFile } from '@/lib/urlToFile';

function extractError(e) {
  const body = e?.response?.data || e?.data || e?.response?.body;
  if (body && typeof body === 'object' && body.error) return body.error;
  if (typeof body === 'string') return body;
  return e?.message || '未知错误';
}

// 把电影级/增强提示词与负向提示词整合为可直接喂给模型的最终提示词（英文+中文两版）
function buildFinalPrompt(data) {
  const en = (() => {
    let base = data.cinematic_prompt || data.enhanced_prompt || '';
    if (!base) return '';
    const neg = (data.negative_prompt || '').trim();
    if (!neg) return base;
    if (/--(ar|v|style)\b/.test(base)) return `${base} --no ${neg}`;
    return `${base}\n\nNegative prompt: ${neg}`;
  })();
  const zh = (() => {
    let base = data.cinematic_prompt_zh || data.enhanced_prompt_zh || '';
    if (!base) return '';
    const neg = (data.negative_prompt || '').trim();
    if (!neg) return base;
    return `${base}\n\n负向提示词：${neg}`;
  })();
  return { en, zh };
}

function fileDataUrl(file) {
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('新增图片读取失败'));reader.readAsDataURL(file);});
}

export default function PromptEnhancer({ onSaved, compact = false, active = true, bridgeEnabled = true, onTaskStatus }) {
  const [group, setGroup] = useState('character');
  const [viewpointSubject, setViewpointSubject] = useState('character');
  const [direction, setDirection] = useState('character_default');
  const [model, setModel] = useState('automatic');
  const chatModelItems = useChatModelItems();
  const [targetKey, setTargetKey] = useState('imagine2');
  const [rawInput, setRawInput] = useState('');
  const [images, setImages] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [annotateIdx, setAnnotateIdx] = useState(null);
  const [customDirs, setCustomDirs] = useState([]);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [viewingDirId, setViewingDirId] = useState(null);
  const [showAnnotator, setShowAnnotator] = useState(false);
  const [mode, setMode] = useState('enhance');
  const [videoMode, setVideoMode] = useState('single');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [rated, setRated] = useState(false);
  const [selectedStyles, setSelectedStyles] = useState([]);
  const [selectedCharacterPalette, setSelectedCharacterPalette] = useState(null);
  const [selectedEnvironmentPalette, setSelectedEnvironmentPalette] = useState(null);
  const selectPalette = (palette, scope) => {
    (scope === 'character' ? setSelectedCharacterPalette : setSelectedEnvironmentPalette)(palette);
  };

  const [projectStyleId, setProjectStyleId] = useState('');
  const [bridgeSessionId,setBridgeSessionId]=useState('');
  const [bridgeOriginalCount,setBridgeOriginalCount]=useState(0);
  const [bridgeCompleted,setBridgeCompleted]=useState(false);
  const [showStyleLib, setShowStyleLib] = useState(false);
  const fileInput = useRef(null);
  const cancelRef = useRef(false);

  const loadCustom = async () => {
    try {
      const res = await base44.entities.Direction.filter({}, '-updated_date', 50);
      setCustomDirs(res || []);
    } catch {
      // 忽略
    }
  };

  useEffect(() => { loadCustom(); }, []);

  // 从历史记录恢复编辑上下文
  const location = useLocation();
  const navigate = useNavigate();
  const [restoreCtx, setRestoreCtx] = useState(null);
  const [restoreKey, setRestoreKey] = useState(0);
  useEffect(() => {
    if(!bridgeEnabled)return;
    const params = new URLSearchParams(location.search);
    const rid = params.get('restore');
    if (!rid) return;
    base44.entities.Prompt.get(rid).then((p) => {
      if (!p?.context) return;
      const ctx = p.context;
      setRestoreCtx(ctx);
      if (ctx.mode === 'enhance' || ctx.mode === 'style_swap') {
        setMode('enhance');
        if (ctx.group) setGroup(ctx.group);
        if (ctx.subject) setViewpointSubject(ctx.subject);
        if (ctx.direction) setDirection(ctx.direction);
        if (ctx.model) setModel(ctx.model);
        if (ctx.target) setTargetKey(ctx.target);
        if (ctx.project_style_id) setProjectStyleId(ctx.project_style_id);
        if (ctx.raw_input) setRawInput(ctx.raw_input);
        if (ctx.file_urls?.length) setImages(ctx.file_urls.map((url) => ({ file: null, preview: url, url })));
      } else if (ctx.mode === 'reverse') {
        setMode('reverse');
      } else if (ctx.mode === 'viewpoint') {
        setGroup('viewpoint');
        if (ctx.desc) setRawInput(ctx.desc);
        if (ctx.model) setModel(ctx.model);
        const restoredViewImages = ctx.file_urls?.length ? ctx.file_urls : (ctx.refImage_url ? [ctx.refImage_url] : []);
        if (restoredViewImages.length) setImages(restoredViewImages.map((url) => ({ file: null, preview: url, url })));
      } else if (ctx.mode === 'video') {
        setGroup('video');
        if (ctx.videoMode) setVideoMode(ctx.videoMode);
      } else if (ctx.mode === 'repair') {
        setGroup('repair');
      }
      setRestoreKey((k) => k + 1);
      navigate('/', { replace: true });
    }).catch(() => {});
  }, [location.search]);

  useEffect(()=>{
    if(!bridgeEnabled)return;
    const id=new URLSearchParams(location.search).get('bridge');
    if(!id)return;
    fetch(`/api/local/bridge-session?id=${encodeURIComponent(id)}`).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}).then(session=>{
      setBridgeSessionId(session.id);setBridgeOriginalCount(session.originalImageCount || 0);setBridgeCompleted(false);
      setMode('enhance');
      setGroup('repair');
      setRawInput(session.text || '');
      setImages((session.images || []).map(image=>({file:null,preview:image.url,url:image.url,bridgeOriginal:true,name:image.name})));
    }).catch(error=>toast({title:'PS 联动读取失败',description:error.message,variant:'destructive'}));
  },[location.search,bridgeEnabled]);

  // 合并内置 + 自定义方向
  const builtInStyles = STYLES[group] || [];
  const customStyles = customDirs
    .filter((d) => d.group === group)
    .map((d) => ({
      key: d.id,
      label: d.name,
      isCustom: true,
      base_direction: d.base_direction,
      system_prompt: d.system_prompt,
      group: d.group
    }));
  const allStyles = [...builtInStyles, ...customStyles];

  const selectedProjectStyle = [...PROJECT_STYLES, ...customDirs].find((item) => item.id === projectStyleId) || null;
  const projectBase = selectedProjectStyle?.base_style;
  const selected = group === 'character'
    ? { key: projectBase === 'realistic' ? 'character_realistic' : projectBase === 'concept' ? 'character_concept' : 'character_default' }
    : group === 'scene' ? { key: 'scene_default' } : allStyles.find((s) => s.key === direction) || allStyles[0];
  const paletteScope = group === 'character' || (group === 'viewpoint' && viewpointSubject === 'character') ? 'character' : 'environment';
  const selectedPalette = paletteScope === 'character' ? selectedCharacterPalette : selectedEnvironmentPalette;
  useEffect(() => {
    setImages(current => {
      const regular=current.filter(image=>!image.paletteScope);
      const reference=selectedPalette?createPaletteImage(selectedPalette):null;
      const previous=current.find(image=>image.paletteScope===paletteScope);
      if(current.length===regular.length+(reference?1:0) && (!reference || (previous?.paletteId===reference.paletteId && previous?.preview===reference.preview)))return current;
      return reference?[...regular,reference]:regular;
    });
  }, [paletteScope,selectedPalette]);

  const selectGroup = (g) => {
    setGroup(g);
    if (STYLES[g]) setDirection(STYLES[g][0].key);
    setShowCustomForm(false);
  };

  const addFiles = (fileList) => {
    const arr = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) { toast({ title: '请上传图片文件', variant: 'destructive' }); return; }
    setImages((prev) => [...prev, ...arr.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))]);
  };

  useImagePaste(addFiles,active && mode==='enhance' && !['repair','viewpoint','video'].includes(group));

  const onPickFile = (e) => { addFiles(e.target.files); if (fileInput.current) fileInput.current.value = ''; };

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); };

  const removeImage = (idx) => { setImages((prev) => prev.filter((it, i) => { if (i !== idx) return true; if (it.preview?.startsWith('blob:')) URL.revokeObjectURL(it.preview); return false; })); };

  const handleAnnotated = (file) => {
    setShowAnnotator(false);
    if (file && annotateIdx !== null) {
      setImages((prev) => prev.map((it, i) => i === annotateIdx ? { file, preview: URL.createObjectURL(file) } : it));
    }
    setAnnotateIdx(null);
  };

  const handleEnhance = async () => {
    // 优化中再次点击 = 取消
    if (loading) { cancelRef.current = true; onTaskStatus?.('idle'); return; }
    const hasStyleSwap = selectedStyles.length > 0 && group === 'character' && images.length > 0;
    if (!rawInput.trim() && !hasStyleSwap && images.length === 0) return;
    cancelRef.current = false;
    setLoading(true);
    onTaskStatus?.('running');
    setResult(null);
    setRated(false);
    try {
      let fileUrls = null;
      let bridgeAddedImages=[];
      const newFiles = images.filter((img) => img.file).map((img) => img.file);
      const existingUrls = images.filter((img) => img.url && !img.file).map((img) => img.url);
      if (newFiles.length > 0 || existingUrls.length > 0) {
        let uploaded = [];
        if (newFiles.length > 0) {
          const compressed = await compressImages(newFiles);
          const uploads = await Promise.all(compressed.map((f) => base44.integrations.Core.UploadFile({ file: f })));
          uploaded = uploads.map((u) => u.file_url);
          if(bridgeSessionId){
            const available=Math.max(0,6-bridgeOriginalCount);
            if (compressed.length > available) throw new Error(`PS 最多接收 6 张图片，当前还可添加 ${available} 张。请删除多余参考图后再增强。`);
            bridgeAddedImages=await Promise.all(compressed.map(async(file,index)=>({name:newFiles[index]?.name || `影词魔方新增图片${index+1}.webp`,data:await fileDataUrl(file)})));
          }
        }
        fileUrls = [...uploaded, ...existingUrls];
      }
      const selectedTarget = TARGETS.find((t) => t.key === targetKey) || TARGETS[0];
      const useStyleSwap = selectedStyles.length > 0 && group === 'character' && fileUrls && fileUrls.length > 0;
      const payload = {
        raw_input: rawInput,
        direction: selected.key,
        file_urls: fileUrls,
        model,
        target: selectedTarget.key,
        target_label: selectedTarget.label,
        target_type: selectedTarget.type
      };
      if (selectedStyles.length > 0) {
        payload.styles = selectedStyles.map((s) => ({
          name: s.name,
          category: s.category,
          style_prompt: s.style_prompt
        }));
      }
      if (selectedPalette) {
        payload.color_palette = {
          id: selectedPalette.id, name: selectedPalette.name, scope: selectedPalette.scope,
          palette: selectedPalette.palette, colors: selectedPalette.colors,
          analysis: selectedPalette.analysis, variation: selectedPalette.variation
        };
      }
      if (selectedProjectStyle) {
        payload.project_style = projectStylePayload(selectedProjectStyle);
      }
      if (selected.isCustom) {
        payload.base_direction = selected.base_direction;
        payload.system_prompt = selected.system_prompt;
        payload.group = selected.group || group;
      }
      if (useStyleSwap) {
        payload.mode = 'style_swap';
      }
      const res = await base44.functions.invoke('enhancePrompt', payload);
      if (cancelRef.current) return; // 已取消，丢弃结果
      const data = res.data;
      if (!data || data.error || !data.enhanced_prompt) {
        throw new Error(data?.error || '优化失败，请稍后重试');
      }
      // 自动存入历史记录（rating 3，不污染 few-shot 学习样本，仅"认可"才升级为范例）
      let savedId = null;
      try {
        const saved = await base44.entities.Prompt.create({
          title: data.title,
          raw_input: rawInput,
          content: data.enhanced_prompt,
          content_zh: data.enhanced_prompt_zh || '',
          category: data.category || '综合提示',
          direction: data.direction || selected.key,
          rating: 3,
          tags: data.tags || [],
          context: { mode: useStyleSwap ? 'style_swap' : 'enhance', group, direction: selected.key, model, target: targetKey, raw_input: rawInput, file_urls: bridgeSessionId ? undefined : fileUrls, image_count:bridgeSessionId ? fileUrls?.length || 0 : undefined, style_names: selectedStyles.map((s) => s.name), project_style_id: projectStyleId || undefined, color_palette_id: selectedPalette?.id, color_palette_name: selectedPalette?.name }
        });
        savedId = saved.id;
        onSaved?.();
      } catch {
        // 历史保存失败不阻断主流程
      }
      if (cancelRef.current) return; // 已取消，不显示结果
      const finalPrompt = buildFinalPrompt(data);
      setResult({ ...data, _savedId: savedId, _fileUrls: fileUrls, final_prompt: finalPrompt.en, final_prompt_zh: finalPrompt.zh });
      onTaskStatus?.('done');
      if(bridgeSessionId && !bridgeCompleted){
        const response=await fetch('/api/local/bridge-session/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:bridgeSessionId,prompt:finalPrompt.zh || data.enhanced_prompt_zh || finalPrompt.en || data.enhanced_prompt,prompt_en:finalPrompt.en || data.enhanced_prompt || '',prompt_zh:finalPrompt.zh || data.enhanced_prompt_zh || '',images:bridgeAddedImages})});
        const completed=await response.json();if(!response.ok)throw new Error(completed.error || '回传 Photoshop 失败');
        setBridgeCompleted(true);toast({title:'已回传 Photoshop',description:bridgeAddedImages.length?`提示词和 ${bridgeAddedImages.length} 张新增图片已同步`:'优化提示词已填回 PS'});
      }
      try {
        const copyText = `${finalPrompt.zh || data.enhanced_prompt_zh || ''}\n\n${finalPrompt.en || data.enhanced_prompt}`;
        await navigator.clipboard.writeText(copyText.trim());
        toast({ title: '已自动复制（中文在前，英文在后）' });
      } catch {
        toast({ title: '优化完成，可手动复制' });
      }
    } catch (e) {
      if (cancelRef.current) return; // 取消导致的错误不提示
      console.error('增强失败', e);
      onTaskStatus?.('error');
      toast({ title: '增强失败', description: extractError(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleRate = async (good) => {
    if (!result || rated) return;
    try {
      if (result._savedId) {
        await base44.entities.Prompt.update(result._savedId, { rating: good ? 5 : 1 });
      } else {
        await base44.entities.Prompt.create({
          title: result.title,
          raw_input: rawInput,
          content: result.enhanced_prompt,
          content_zh: result.enhanced_prompt_zh || '',
          category: result.category || '综合提示',
          direction: result.direction || selected.key,
          rating: good ? 5 : 1,
          tags: result.tags,
          context: { mode: 'enhance', group, direction: selected.key, model, target: targetKey, raw_input: rawInput, file_urls: result._fileUrls || null }
        });
      }
      setRated(true);
      if (good) {
        toast({ title: '已认可并存为学习范例', description: '系统会参考你的偏好持续优化' });
        onSaved?.();
      } else {
        toast({ title: '已记录反馈' });
      }
    } catch (e) {
      toast({ title: '保存失败', description: e.message, variant: 'destructive' });
    }
  };

  // ===== 反推模式 =====
  if (mode === 'reverse') {
    return (
      <div className="flex flex-col gap-4">
        {/* 顶层：增强 / 反推 */}
        <div className="flex gap-1.5">
          <button onClick={() => setMode('enhance')} className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-muted/50 text-muted-foreground hover:bg-muted">增强</button>
          <button className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-foreground text-background">反推</button>
        </div>
        <ReversePrompt key={restoreKey} onSaved={onSaved} initialContext={restoreCtx} active={active} onTaskStatus={onTaskStatus} />
      </div>
    );
  }

  // ===== 增强模式 =====
  const isViewpoint = group === 'viewpoint';
  const isVideo = group === 'video';
  const isRepair = group === 'repair';

  return (
    <div className="flex flex-col gap-4">
      {bridgeSessionId && <div className={`rounded-lg border px-3 py-2 text-xs ${bridgeCompleted?'border-emerald-300 bg-emerald-50 text-emerald-700':'border-blue-300 bg-blue-50 text-blue-700'}`}>{bridgeCompleted?'已增强并回传 PS；现在可回到 PS 点击生成。':'PS 已连接：可继续选择角色/环境、方向、风格库和模型，也可拖入新图片；点击增强后自动回传。'}</div>}
      {/* 顶层：增强 / 反推 */}
      <div className="flex gap-1.5">
        <button className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-foreground text-background">增强</button>
        <button onClick={() => setMode('reverse')} className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-muted/50 text-muted-foreground hover:bg-muted">反推</button>
      </div>

      {/* 子分类：角色 / 环境 / 视角 / 镜头 */}
      <div className="flex gap-1.5">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => selectGroup(g.key)}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${group === g.key ? 'bg-foreground text-background' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* 镜头模式：单镜头 / 分镜表批量 */}
      {isVideo && (
        <div className="flex gap-1.5">
          <button onClick={() => setVideoMode('single')} className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${videoMode === 'single' ? 'bg-foreground text-background' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>单镜头</button>
          <button onClick={() => setVideoMode('batch')} className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${videoMode === 'batch' ? 'bg-foreground text-background' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>分镜表批量</button>
        </div>
      )}

      {group === 'viewpoint' && <div className="flex gap-1.5">
        {[{ key: 'character', label: '人物' }, { key: 'scene', label: '场景' }].map((subject) => <button key={subject.key} onClick={() => setViewpointSubject(subject.key)} className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${viewpointSubject === subject.key ? 'bg-foreground text-background' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>{subject.label}</button>)}
      </div>}

      {/* 项目风格与风格库由整个工作台共享，切换栏目时保持选择 */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[11px] text-muted-foreground mr-0.5">项目风格</span>
          <button
            onClick={() => setProjectStyleId('')}
            className={`px-2.5 py-1 rounded-full text-[11px] transition-all ${!projectStyleId ? 'bg-foreground text-background' : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'}`}
          >默认</button>
          {[...PROJECT_STYLES, ...customDirs].map((item) => (
            <button
              key={item.id}
              onClick={() => setProjectStyleId(item.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] transition-all ${projectStyleId === item.id ? 'bg-foreground text-background' : 'bg-primary/10 text-primary hover:bg-primary/20'}`}
            >{item.name}</button>
          ))}
          {selectedProjectStyle && customDirs.some((item) => item.id === projectStyleId) && <button type="button" onClick={() => setViewingDirId(projectStyleId)} title="编辑项目风格" className="h-5 w-5 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><Eye className="h-3 w-3" /></button>}
          {!compact && (
            <button
              onClick={() => setShowCustomForm(!showCustomForm)}
              className="px-2.5 py-1 rounded-full text-[11px] transition-all flex items-center gap-1 border border-dashed border-border/60 text-muted-foreground hover:bg-muted/40"
            ><Plus className="w-3 h-3" />新建项目风格</button>
          )}
        </div>
        <button
          onClick={() => setShowStyleLib(!showStyleLib)}
          className={`w-full px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1 ${showStyleLib || selectedStyles.length > 0 ? 'bg-foreground text-background' : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'}`}
        >
          <Sparkles className="w-3 h-3" />
          风格库{selectedStyles.length > 0 ? ` · 已选${selectedStyles.length}项` : ''}
        </button>
        {showStyleLib && <StyleLibrary selectedStyles={selectedStyles} onSelect={setSelectedStyles} paletteScope={paletteScope} selectedCharacterPalette={selectedCharacterPalette} selectedEnvironmentPalette={selectedEnvironmentPalette} onSelectPalette={selectPalette} compact />}
        {selectedStyles.length > 0 && !showStyleLib && (
          <div className="flex flex-wrap items-center gap-1 text-[10px] text-primary bg-primary/10 border border-primary/20 rounded-lg px-2 py-1.5">
            <Sparkles className="w-2.5 h-2.5 shrink-0" /><span className="shrink-0">共享已选：</span>
            {selectedStyles.map((s) => (
              <span key={s.id} className="flex items-center gap-0.5 bg-primary/10 rounded px-1 py-0.5">{s.name}<button onClick={() => setSelectedStyles(selectedStyles.filter((x) => x.id !== s.id))}><X className="w-2 h-2" /></button></span>
            ))}
            <button onClick={() => setSelectedStyles([])} className="ml-auto text-[9px] text-muted-foreground hover:text-primary">清空</button>
          </div>
        )}
      </div>

      {showCustomForm && !compact && (
        <CustomDirectionForm
          onCreated={(saved) => { setShowCustomForm(false); loadCustom(); if (saved?.id) setProjectStyleId(saved.id); }}
        />
      )}

      {viewingDirId && (() => {
        const dir = customDirs.find(d => d.id === viewingDirId);
        if (!dir) return null;
        return (
          <DirectionDetail
            direction={dir}
            onClose={() => setViewingDirId(null)}
            onChanged={() => { loadCustom(); setViewingDirId(null); }}
          />
        );
      })()}

      {isVideo && videoMode === 'single' ? (
        <VideoDirector key={restoreKey} onSaved={onSaved} initialContext={restoreCtx} sharedStyles={selectedStyles} projectStyle={selectedProjectStyle} active={active} onTaskStatus={onTaskStatus} />
      ) : isVideo && videoMode === 'batch' ? (
        <BatchStoryboard sharedStyles={selectedStyles} projectStyle={selectedProjectStyle} />
      ) : isViewpoint ? (
        <ViewpointPrompt
          sharedSubject={viewpointSubject} active={active} onTaskStatus={onTaskStatus}
          key={restoreKey}
          onSaved={onSaved}
          initialContext={restoreCtx}
          sharedImages={images}
          onSharedImagesChange={setImages}
          sharedContext={rawInput}
          onSharedContextChange={setRawInput}
          sharedModel={model}
          onSharedModelChange={setModel}
          sharedStyles={selectedStyles}
          projectStyle={selectedProjectStyle}
          selectedCharacterPalette={selectedCharacterPalette}
          selectedEnvironmentPalette={selectedEnvironmentPalette}
          onSelectedCharacterPaletteChange={(palette) => selectPalette(palette, 'character')}
          onSelectedEnvironmentPaletteChange={(palette) => selectPalette(palette, 'environment')}
        />
      ) : isRepair ? (
        <LogicRepair
          key={restoreKey}
          active={active} onTaskStatus={onTaskStatus}
          onSaved={onSaved}
          initialContext={restoreCtx}
          sharedImages={images}
          onSharedImagesChange={setImages}
          sharedContext={rawInput}
          onSharedContextChange={setRawInput}
          sharedModel={model}
          onSharedModelChange={setModel}
          selectedStyles={selectedStyles}
          projectStyle={selectedProjectStyle}
          selectedPalette={selectedEnvironmentPalette}
          onSelectedPaletteChange={(palette) => selectPalette(palette, 'environment')}
          onBridgeComplete={bridgeSessionId && !bridgeCompleted ? async ({ prompt, prompt_en, prompt_zh }) => {
            const available = Math.max(0, 6 - bridgeOriginalCount);
            const newFiles = images.filter((image) => image.file && !image.bridgeOriginal).map((image) => image.file);
            const compressed = await compressImages(newFiles);
            if (compressed.length > available) throw new Error(`PS 最多接收 6 张图片，当前还可添加 ${available} 张。请删除多余参考图后再增强。`);
            const addedImages = await Promise.all(compressed.map(async (file, index) => ({ name: newFiles[index]?.name || `影词魔方新增图片${index + 1}.webp`, data: await fileDataUrl(file) })));
            const response = await fetch('/api/local/bridge-session/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: bridgeSessionId, prompt, prompt_en, prompt_zh, images: addedImages }) });
            const completed = await response.json();
            if (!response.ok) throw new Error(completed.error || '回传 Photoshop 失败');
            setBridgeCompleted(true);
            toast({ title: '已回传 Photoshop', description: addedImages.length ? `修复提示词和 ${addedImages.length} 张新增图片已同步` : '修复提示词已填回 PS' });
          } : null}
        />
      ) : (
      <>
      {group === 'character' && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-600 bg-amber-400/10 border border-amber-400/30 rounded-lg px-2.5 py-1.5">
          <Sparkles className="w-3 h-3" />
          好莱坞角色概念设计 Skill 已启用 · 每次增强自动应用
        </div>
      )}
      {group === 'scene' && (
        <div className="flex items-center gap-1.5 text-[11px] text-sky-600 bg-sky-400/10 border border-sky-400/30 rounded-lg px-2.5 py-1.5">
          <Sparkles className="w-3 h-3" />
          影视美术指导场景 Skill 已启用 · 四维转译每次自动应用
        </div>
      )}
      {/* 风格选择（内置 + 我的方向） */}
      {group === 'video' && <div className="flex flex-wrap gap-1.5">
        {builtInStyles.map((s) => (
          <button
            key={s.key}
            onClick={() => setDirection(s.key)}
            className={`px-2.5 py-1 rounded-full text-[11px] transition-all ${
              direction === s.key ? 'bg-foreground text-background' : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'
            }`}
          >
            {s.label}
          </button>
        ))}
        {customStyles.length > 0 && (
          <span className="w-full h-px bg-border/40 my-0.5" />
        )}
        {customStyles.map((s) => (
          <div key={s.key} className="flex items-center gap-0.5">
            <button
              onClick={() => setDirection(s.key)}
              className={`px-2.5 py-1 rounded-full text-[11px] transition-all flex items-center gap-1 ${
                direction === s.key
                  ? 'bg-foreground text-background'
                  : 'bg-primary/10 text-primary hover:bg-primary/20'
              }`}
            >
              <span className="w-1 h-1 rounded-full bg-current opacity-60" />
              {s.label}
            </button>
            <button
              onClick={() => setViewingDirId(s.key)}
              title="查看 / 编辑 / 删除"
              className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            >
              <Eye className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>}

      {/* 参考图：可拖拽上传 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-col gap-2 rounded-lg transition-colors ${dragOver ? 'bg-primary/5 ring-2 ring-primary/30' : ''}`}
      >
        <div className="flex flex-wrap gap-2">
          {images.map((img, idx) => (
            <div key={idx} className="relative rounded-lg overflow-hidden border border-border/60 w-24 h-24">
              <img src={img.preview} alt={`参考图${idx + 1}`} className="w-full h-full object-cover" />
              <button
                onClick={() => removeImage(idx)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
              >
                <X className="w-3 h-3" />
              </button>
              <button
                onClick={async () => {
                  if (!images[idx].file && images[idx].url) {
                    try {
                      const file = await urlToFile(images[idx].url);
                      setImages(prev => prev.map((it, i) => i === idx ? { ...it, file } : it));
                    } catch { return; }
                  }
                  setAnnotateIdx(idx);
                  setShowAnnotator(true);
                }}
                className="absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-foreground text-background hover:bg-foreground/85 flex items-center gap-1"
              >
                <PenLine className="w-2.5 h-2.5" />
                标注
              </button>
            </div>
          ))}
          <button
            onClick={() => fileInput.current?.click()}
            className="flex flex-col items-center justify-center gap-1 w-24 h-24 rounded-lg border border-dashed border-border/60 text-[11px] text-muted-foreground hover:bg-muted/40 hover:border-border transition-colors"
          >
            <ImagePlus className="w-4 h-4" />
            <span>添加图片</span>
          </button>
        </div>
        <input ref={fileInput} type="file" accept="image/*" multiple onChange={onPickFile} className="hidden" />
      </div>

      <div className="flex gap-2">
        <IconPicker label="大模型" items={chatModelItems} value={model} onChange={setModel} />
        <IconPicker label="喂给" items={TARGETS} value={targetKey} onChange={setTargetKey} />
      </div>

      {/* 描述输入框 */}
      <VoiceTextarea
        value={rawInput}
        onChange={setRawInput}
        placeholder={PLACEHOLDERS[group]}
        className="min-h-[90px] resize-y bg-muted/30 border-border/60 focus-visible:ring-1 text-sm"
      />

      {/* 增强按钮（优化中可点击取消） */}
      <Button
        onClick={handleEnhance}
        disabled={!loading && !rawInput.trim() && images.length === 0 && !(selectedStyles.length > 0 && group === 'character' && images.length > 0)}
        className={`w-full h-10 ${loading ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'bg-foreground text-background hover:bg-foreground/90'}`}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            点击取消…
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4 mr-2" />
            {selectedStyles.length > 0 && group === 'character' ? '风格替换' : '增强提示词'}
          </>
        )}
      </Button>

      {result && (
        <ResultBoundary onRetry={() => setResult(null)}>
          <PromptOutput result={result} rawInput={rawInput} onRate={handleRate} rated={rated} />
        </ResultBoundary>
      )}

      {showAnnotator && annotateIdx !== null && images[annotateIdx] && (
        <ImageAnnotator
          image={images[annotateIdx].file}
          onDone={handleAnnotated}
          onCancel={() => { setShowAnnotator(false); setAnnotateIdx(null); }}
        />
      )}
      </>
      )}
    </div>
  );
}
