import { projectStylePayload } from '../../shared/project-styles.mjs';
import React, { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Eye, Copy, Check, ImagePlus, X, Layers, PenLine, Compass } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { MODELS, TARGETS } from '@/lib/directions';
import IconPicker from '@/components/IconPicker';
import VoiceTextarea from '@/components/VoiceTextarea';
import { useImagePaste } from '@/hooks/useImagePaste';
import ImageAnnotator from '@/components/ImageAnnotator';
import MultiViewResults from '@/components/MultiViewResults';
import { compressImages } from '@/lib/compressImage';
import { urlToFile } from '@/lib/urlToFile';

function extractError(e) {
  const body = e?.response?.data || e?.data || e?.response?.body;
  if (body && typeof body === 'object' && body.error) return body.error;
  if (typeof body === 'string') return body;
  return e?.message || '未知错误';
}

// 一键多视角选项（人物与场景共享，作为默认第一项）
const MULTI_VIEW_OPT = { key: 'multi_view', label: '一键多视角·360°', icon: Compass };

// 共享视角选项（人物与场景一致）
const VIEWPOINTS = [
  { key: 'left', label: '左侧视角' },
  { key: 'right', label: '右侧视角' },
  { key: 'closeup', label: '近景特写' },
  { key: 'detail', label: '局部特写' },
  { key: 'reframe', label: '视角转换' }
];

// 人物：一键多视角（默认） + 合并三视图 + 其余视角
const CHAR_VIEWS = [MULTI_VIEW_OPT, { key: 'merge', label: '合并形象·三视图', icon: Layers }, ...VIEWPOINTS];
// 场景：一键多视角（默认） + 其余视角
const SCENE_VIEWS = [MULTI_VIEW_OPT, ...VIEWPOINTS];

const PLACEHOLDERS = {
  character: '描述你设计的人物（如：25岁亚洲女性，黑色长直发，穿红色汉服，佩戴玉簪…）',
  scene: '描述你的场景（如：雨后夜晚的赛博朋克街道，霓虹灯反射在湿地面…）'
};

export default function ViewpointPrompt({ sharedSubject, onSaved, initialContext, sharedImages, onSharedImagesChange, sharedContext, onSharedContextChange, sharedModel, onSharedModelChange, sharedStyles = [], projectStyle, selectedCharacterPalette, selectedEnvironmentPalette, onSelectedCharacterPaletteChange = (_value) => {}, onSelectedEnvironmentPaletteChange = (_value) => {}, active = true, onTaskStatus }) {
  const subject = sharedSubject ?? initialContext?.subject ?? 'character';
  const previousSubject = useRef(subject);
  const [viewType, setViewType] = useState(initialContext?.viewType || 'multi_view');
  const [viewCustom, setViewCustom] = useState(initialContext?.viewCustom || '');
  const [localDesc, setLocalDesc] = useState(initialContext?.desc || '');
  const [localImages, setLocalImages] = useState(() => {
    const urls = initialContext?.file_urls?.length ? initialContext.file_urls : (initialContext?.refImage_url ? [initialContext.refImage_url] : []);
    return urls.map((url) => ({ file: null, preview: url, url }));
  });
  const images = sharedImages ?? localImages;
  const setImages = onSharedImagesChange ?? setLocalImages;
  const desc = sharedContext ?? localDesc;
  const setDesc = onSharedContextChange ?? setLocalDesc;
  const [dragOver, setDragOver] = useState(false);
  const [localModel, setLocalModel] = useState(initialContext?.model || 'automatic');
  const model = sharedModel ?? localModel;
  const setModel = onSharedModelChange ?? setLocalModel;
  const [targetKey, setTargetKey] = useState(initialContext?.target || 'imagine2');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [multiLoading, setMultiLoading] = useState(false);
  const [multiResult, setMultiResult] = useState(null);
  const [copied, setCopied] = useState(null);
  const [showAnnotator, setShowAnnotator] = useState(false);
  const [annotateIdx, setAnnotateIdx] = useState(null);
  const fileInput = useRef(null);

  useEffect(() => {
    if (previousSubject.current === subject) return;
    previousSubject.current = subject;
    setViewType('multi_view');
    setResult(null);
    setMultiResult(null);
  }, [subject]);

  const views = subject === 'character' ? CHAR_VIEWS : SCENE_VIEWS;
  const isMerge = subject === 'character' && viewType === 'merge';
  const isMultiView = viewType === 'multi_view';
  const selectedPalette = subject === 'character' ? selectedCharacterPalette : selectedEnvironmentPalette;
  const palettePayload = selectedPalette ? {
    id: selectedPalette.id, name: selectedPalette.name, scope: selectedPalette.scope,
    palette: selectedPalette.palette, colors: selectedPalette.colors,
    analysis: selectedPalette.analysis, variation: selectedPalette.variation
  } : undefined;

  const selectView = (v) => {
    setViewType(v);
    setResult(null);
    setMultiResult(null);
  };

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) {
      toast({ title: '请上传图片文件', variant: 'destructive' });
      return;
    }
    setImages((prev) => [...prev, { file, preview: URL.createObjectURL(file) }]);
  };

  useImagePaste((files) => { Array.from(files || []).forEach(handleFile); },active);

  const onPickFile = (e) => { Array.from(e.target.files || []).forEach(handleFile); if (fileInput.current) fileInput.current.value = ''; };
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); Array.from(e.dataTransfer.files || []).forEach(handleFile); };
  const clearImage = (idx) => setImages((prev) => prev.filter((image, index) => { if (index !== idx) return true; if (image.preview?.startsWith('blob:')) URL.revokeObjectURL(image.preview); return false; }));

  const handleAnnotated = (file) => {
    setShowAnnotator(false);
    if (file && annotateIdx !== null) setImages((prev) => prev.map((image, index) => index === annotateIdx ? { file, preview: URL.createObjectURL(file) } : image));
    setAnnotateIdx(null);
  };

  const uploadImages = async () => {
    const newFiles = images.filter((image) => image.file).map((image) => image.file);
    const existingUrls = images.filter((image) => image.url && !image.file).map((image) => image.url);
    if (!newFiles.length) return existingUrls;
    const compressed = await compressImages(newFiles);
    const uploads = await Promise.all(compressed.map((file) => base44.integrations.Core.UploadFile({ file })));
    return [...uploads.map((upload) => upload.file_url), ...existingUrls];
  };

  const handleGenerate = async () => {
    if (!desc.trim() && images.length === 0) return;
    setLoading(true);
    onTaskStatus?.('running');
    setResult(null);
    setCopied(null);
    try {
      const fileUrls = await uploadImages();
      const selectedTarget = TARGETS.find((t) => t.key === targetKey) || TARGETS[0];
      const res = await base44.functions.invoke('enhancePrompt', {
        mode: 'sheet', subject, view_type: viewType, view_custom: viewCustom,
        raw_input: desc, file_urls: fileUrls, model,
        target: selectedTarget.label, target_type: selectedTarget.type,
        styles: sharedStyles.map((style) => ({ name: style.name, category: style.category, style_prompt: style.style_prompt })),
        project_style: projectStylePayload(projectStyle),
        color_palette: palettePayload
      });
      const data = res.data;
      // 自动存入提示词库（含用户原始输入）
      try {
        await base44.entities.Prompt.create({
          title: data.title || desc.slice(0, 20),
          raw_input: desc,
          content: data.enhanced_prompt,
          content_zh: data.enhanced_prompt_zh || '',
          category: data.category || (subject === 'character' ? '角色表演' : '场景构图'),
          direction: `sheet_${viewType}`,
          rating: 3,
          tags: data.tags || [],
          context: { mode: 'viewpoint', subject, viewType, viewCustom, desc, model, target: targetKey, file_urls: fileUrls, color_palette_id: selectedPalette?.id, color_palette_name: selectedPalette?.name }
        });
        onSaved?.();
      } catch {}
      setResult(data);
      onTaskStatus?.('done');
      try {
        const copyText = `${data.enhanced_prompt_zh || ''}\n\n${data.enhanced_prompt}`;
        await navigator.clipboard.writeText(copyText.trim());
        toast({ title: '已自动复制（中文在前，英文在后）' });
      } catch {
        toast({ title: '生成完成，可手动复制' });
      }
    } catch (e) {
      console.error('生成失败', e);
      onTaskStatus?.('error');
      toast({ title: '生成失败', description: extractError(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text, which) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
    toast({ title: '已复制到剪贴板' });
  };

  // 一键多视角：基于参考图并行生成14个视角的完整提示词
  const handleMultiView = async () => {
    if (images.length === 0) {
      toast({ title: '一键多视角需要先上传参考图', variant: 'destructive' });
      return;
    }
    setMultiLoading(true);
    onTaskStatus?.('running');
    setMultiResult(null);
    try {
      const fileUrls = await uploadImages();
      const selectedTarget = TARGETS.find((t) => t.key === targetKey) || TARGETS[0];
      const res = await base44.functions.invoke('enhancePrompt', {
        mode: 'multi_view', subject,
        raw_input: desc, file_urls: fileUrls, model,
        target: selectedTarget.label, target_type: selectedTarget.type,
        styles: sharedStyles.map((style) => ({ name: style.name, category: style.category, style_prompt: style.style_prompt })),
        project_style: projectStylePayload(projectStyle),
        color_palette: palettePayload
      });
      const data = res.data;
      if (data.views && data.views.length > 0) {
        setMultiResult(data);
        onTaskStatus?.('done');
        toast({ title: `已生成 ${data.views.length} 个视角提示词`, description: '每个视角可单独复制使用' });
      } else {
        onTaskStatus?.('error');
        toast({ title: '生成失败', description: '未返回视角数据', variant: 'destructive' });
      }
    } catch (e) {
      console.error('多视角生成失败', e);
      onTaskStatus?.('error');
      toast({ title: '多视角生成失败', description: extractError(e), variant: 'destructive' });
    } finally {
      setMultiLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 视角选项 */}
      <div className="flex flex-wrap gap-1.5">
        {views.map((v) => {
          const Icon = v.icon;
          return (
            <button key={v.key} onClick={() => selectView(v.key)} className={`px-2.5 py-1 rounded-full text-[11px] transition-all flex items-center gap-1 ${viewType === v.key ? 'bg-foreground text-background' : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'}`}>
              {Icon && <Icon className="w-3 h-3" />}
              {v.label}
            </button>
          );
        })}
      </div>

      {/* 补充方向/部位（合并模式与多视角模式不需要） */}
      {!isMerge && !isMultiView && (
        <Input value={viewCustom} onChange={(e) => setViewCustom(e.target.value)} placeholder="补充精确方向/部位（可选，如：从南向北看 / 招牌的近景 / 眼部特写）" className="bg-muted/30 border-border/60 focus-visible:ring-1 text-sm h-9" />
      )}

      {/* 参考图：与增强页一致的"添加图片"样式 */}
      <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop} className={`rounded-lg transition-colors ${dragOver ? 'bg-primary/5 ring-2 ring-primary/30' : ''}`}>
        <div className="flex flex-wrap gap-2">
          {images.map((image, idx) => (
            <div key={`${image.preview}-${idx}`} className="relative rounded-lg overflow-hidden border border-border/60 w-24 h-24">
              <img src={image.preview} alt={`参考图${idx + 1}`} className="w-full h-full object-cover" />
              <button onClick={() => clearImage(idx)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80">
                <X className="w-3 h-3" />
              </button>
              <button
                onClick={async () => {
                  if (!image.file && image.url) {
                    try {
                      const file = await urlToFile(image.url);
                      setImages((prev) => prev.map((item, index) => index === idx ? { ...item, file } : item));
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
          <button onClick={() => fileInput.current?.click()} className="flex flex-col items-center justify-center gap-1 w-24 h-24 rounded-lg border border-dashed border-border/60 text-[11px] text-muted-foreground hover:bg-muted/40 hover:border-border transition-colors">
            <ImagePlus className="w-4 h-4" />
            <span>添加图片</span>
          </button>
        </div>
        <input ref={fileInput} type="file" accept="image/*" multiple onChange={onPickFile} className="hidden" />
      </div>

      {/* 描述（合并模式下也可补充条件） */}
      <VoiceTextarea value={desc} onChange={setDesc} placeholder={isMerge ? '可选：补充角色描述或额外条件（仅上传图片也可生成）' : PLACEHOLDERS[subject]} className="min-h-[90px] resize-y bg-muted/30 border-border/60 focus-visible:ring-1 text-sm" />

      <div className="flex gap-2">
        <IconPicker label="大模型" items={MODELS} value={model} onChange={setModel} />
        <IconPicker label="喂给" items={TARGETS} value={targetKey} onChange={setTargetKey} />
      </div>

      <Button
        onClick={isMultiView ? handleMultiView : handleGenerate}
        disabled={isMultiView ? (multiLoading || images.length === 0) : (loading || (!desc.trim() && images.length === 0))}
        className="w-full bg-foreground text-background hover:bg-foreground/90 h-10"
      >
        {(isMultiView ? multiLoading : loading) ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{isMultiView ? '正在生成14个视角…' : '生成中…'}</>
        ) : (
          <>{isMultiView ? <Compass className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}{isMultiView ? '一键多视角·360°全景' : (isMerge ? '生成三视图提示词' : '生成视角提示词')}</>
        )}
      </Button>

      {!isMultiView && result && (
        <div className="rounded-xl border border-border/60 bg-card p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <h3 className="text-sm font-semibold mb-2">{result.title}</h3>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {Array.isArray(result.tags) && result.tags.map((t, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>
            ))}
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium text-muted-foreground">英文提示词</span>
              <button onClick={() => handleCopy(result.enhanced_prompt, 'en')} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md hover:bg-muted text-muted-foreground">
                {copied === 'en' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied === 'en' ? '已复制' : '复制'}
              </button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap font-mono">{result.enhanced_prompt}</p>
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium text-muted-foreground">中文提示词</span>
              <button onClick={() => handleCopy(result.enhanced_prompt_zh, 'zh')} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md hover:bg-muted text-muted-foreground">
                {copied === 'zh' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied === 'zh' ? '已复制' : '复制'}
              </button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{result.enhanced_prompt_zh}</p>
          </div>
        </div>
      )}

      {isMultiView && multiLoading && (
        <div className="rounded-xl border border-border/60 bg-card p-6 flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-foreground" />
          <p className="text-xs text-muted-foreground">正在并行生成14个视角提示词，每个视角都与原图严格保持一致性…</p>
        </div>
      )}

      {isMultiView && multiResult && <MultiViewResults views={multiResult.views} />}

      {showAnnotator && annotateIdx !== null && images[annotateIdx]?.file && (
        <ImageAnnotator
          image={images[annotateIdx].file}
          onDone={handleAnnotated}
          onCancel={() => { setShowAnnotator(false); setAnnotateIdx(null); }}
        />
      )}
    </div>
  );
}
