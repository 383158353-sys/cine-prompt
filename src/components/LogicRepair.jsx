import { projectStylePayload } from '../../shared/project-styles.mjs';
import { UPSCALE_PRESET } from '../../shared/repair-presets.mjs';
import React, { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, Wand2, ImagePlus, X, Copy, ChevronDown, ChevronRight, PenLine } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { useChatModelItems } from '@/components/ChatModelManager';
import IconPicker from '@/components/IconPicker';
import VoiceTextarea from '@/components/VoiceTextarea';
import { useImagePaste } from '@/hooks/useImagePaste';
import ImageAnnotator from '@/components/ImageAnnotator';
import ResultBoundary from '@/components/ResultBoundary';
import { compressImages } from '@/lib/compressImage';
import { urlToFile } from '@/lib/urlToFile';
import ReactMarkdown from 'react-markdown';

function extractError(e) {
  const body = e?.response?.data || e?.data || e?.response?.body;
  if (body && typeof body === 'object' && body.error) return body.error;
  if (typeof body === 'string') return body;
  return e?.message || '未知错误';
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
          toast({ title: `已复制${label}` });
        } catch {
          toast({ title: '复制失败', variant: 'destructive' });
        }
      }}
      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
    >
      <Copy className="w-3 h-3" />
      {copied ? '已复制' : '复制'}
    </button>
  );
}

function PromptBlock({ title, text, accent }) {
  const [open, setOpen] = useState(true);
  if (!text) return null;
  return (
    <div className={`rounded-lg border ${accent || 'border-border/60'} overflow-hidden`}>
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-xs font-medium">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {title}
        </button>
        <CopyButton text={text} label={title} />
      </div>
      {open && (
        <div className="px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words">{text}</div>
      )}
    </div>
  );
}

export default function LogicRepair({ onSaved, initialContext, sharedImages, onSharedImagesChange, sharedContext, onSharedContextChange, sharedModel, onSharedModelChange, selectedStyles = [], projectStyle, selectedPalette, onSelectedPaletteChange = (_value) => {}, onBridgeComplete, active = true, onTaskStatus }) {
  const [localImages, setLocalImages] = useState(() => initialContext?.file_urls?.map((url) => ({ file: null, preview: url, url })) || []);
  const [dragOver, setDragOver] = useState(false);
  const [localContext, setLocalContext] = useState(initialContext?.context || '');
  const [localModel, setLocalModel] = useState(initialContext?.model || 'automatic');
  const chatModelItems = useChatModelItems();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [annotateIdx, setAnnotateIdx] = useState(null);
  const [showAnnotator, setShowAnnotator] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [upscale, setUpscale] = useState(false);
  const fileInput = useRef(null);
  const resultRef = useRef(null);
  const images = sharedImages ?? localImages;
  const setImages = onSharedImagesChange ?? setLocalImages;
  const context = sharedContext ?? localContext;
  const setContext = onSharedContextChange ?? setLocalContext;
  const model = sharedModel ?? localModel;
  const setModel = onSharedModelChange ?? setLocalModel;

  useEffect(() => {
    if (result && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [result]);

  const addFiles = (fileList) => {
    const arr = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) { toast({ title: '请上传图片文件', variant: 'destructive' }); return; }
    setImages((prev) => [...prev, ...arr.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))]);
  };

  useImagePaste(addFiles,active);

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

  const handleRepair = async (forceUpscale = false) => {
    const useUpscale = forceUpscale === true || upscale;
    if (images.length === 0) return;
    setLoading(true);
    onTaskStatus?.('running');
    setResult(null);
    try {
      const newFiles = images.filter((img) => img.file).map((img) => img.file);
      const existingUrls = images.filter((img) => img.url && !img.file).map((img) => img.url);
      let file_urls = [];
      if (newFiles.length > 0) {
        const compressed = await compressImages(newFiles);
        const uploads = await Promise.all(compressed.map((f) => base44.integrations.Core.UploadFile({ file: f })));
        file_urls = uploads.map((u) => u.file_url);
      }
      file_urls = [...file_urls, ...existingUrls];
      const res = await base44.functions.invoke('enhancePrompt', {
        mode: 'repair',
        repair_preset: useUpscale ? UPSCALE_PRESET : undefined,
        raw_input: context,
        file_urls,
        model,
        styles: selectedStyles.map((style) => ({ name: style.name, category: style.category, style_prompt: style.style_prompt })),
        project_style: projectStylePayload(projectStyle),
        color_palette: selectedPalette ? {
          id: selectedPalette.id, name: selectedPalette.name, scope: selectedPalette.scope,
          palette: selectedPalette.palette, colors: selectedPalette.colors,
          analysis: selectedPalette.analysis, variation: selectedPalette.variation
        } : undefined
      });
      const data = res?.data ?? res;
      if (!data || data.error) throw new Error(data?.error || '修复失败');
      try {
        await base44.entities.Prompt.create({
          title: data.title || '逻辑修复',
          raw_input: context || '逻辑修复',
          content: data.repair_prompt_en || '',
          content_zh: data.repair_prompt_zh || '',
          category: '场景构图',
          direction: 'repair',
          rating: 3,
          tags: data.tags || [],
          context: { mode: 'repair', repair_preset: useUpscale ? UPSCALE_PRESET : '', context, model, file_urls, style_names: selectedStyles.map((style) => style.name), project_style_id: projectStyle?.id, color_palette_id: selectedPalette?.id, color_palette_name: selectedPalette?.name }
        });
        onSaved?.();
      } catch {}
      setResult(data);
      onTaskStatus?.('done');
      if (onBridgeComplete) {
        await onBridgeComplete({
          prompt: data.repair_prompt_zh || data.repair_prompt_en || '',
          prompt_zh: data.repair_prompt_zh || '',
          prompt_en: data.repair_prompt_en || ''
        });
      }
      try {
        await navigator.clipboard.writeText(data.repair_prompt_zh || '');
        toast({ title: '已自动复制中文修复提示词' });
      } catch {
        toast({ title: '修复提示词已生成，可手动复制' });
      }
    } catch (e) {
      console.error('逻辑修复失败', e);
      onTaskStatus?.('error');
      toast({ title: '修复失败', description: extractError(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5 text-[11px] text-teal-600 bg-teal-400/10 border border-teal-400/30 rounded-lg px-2.5 py-1.5">
        <Wand2 className="w-3 h-3" />
        影视美术逻辑修复 · 框选错误区域，生成修复提示词
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={upscale}
          onClick={() => {
            if (loading) return;
            if (upscale) { setUpscale(false); return; }
            setUpscale(true);
            if (images.length === 0) { toast({ title: '请先上传需要超清的图片', variant: 'destructive' }); return; }
            handleRepair(true);
          }}
          className={`px-2.5 py-1 rounded-full text-[11px] transition-all ${upscale ? 'bg-foreground text-background' : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'}`}
        >超清</button>
        {upscale && <span className="text-[11px] text-muted-foreground">只按物体自身质感超分，不改色调、光影和其他内容。</span>}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-lg transition-colors ${dragOver ? 'bg-primary/5 ring-2 ring-primary/30' : ''}`}
      >
        <div className="flex flex-wrap gap-2">
          {images.map((img, idx) => (
            <div key={idx} className="relative rounded-lg overflow-hidden border border-border/60 w-24 h-24">
              <img src={img.preview} alt={`场景图${idx + 1}`} className="w-full h-full object-cover" />
              <button onClick={() => removeImage(idx)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80">
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
          <button onClick={() => fileInput.current?.click()} className="flex flex-col items-center justify-center gap-1 w-24 h-24 rounded-lg border border-dashed border-border/60 text-[11px] text-muted-foreground hover:bg-muted/40 hover:border-border transition-colors">
            <ImagePlus className="w-4 h-4" />
            <span>添加图片</span>
          </button>
        </div>
        <input ref={fileInput} type="file" accept="image/*" multiple onChange={onPickFile} className="hidden" />
      </div>

      <VoiceTextarea
        value={context}
        onChange={setContext}
        placeholder="可选：补充说明需要修复的内容"
        className="min-h-[48px] resize-y bg-muted/30 border-border/60 focus-visible:ring-1 text-sm"
      />

      <IconPicker label="大模型" items={chatModelItems} value={model} onChange={setModel} />

      <Button onClick={handleRepair} disabled={loading || images.length === 0} className="w-full bg-foreground text-background hover:bg-foreground/90 h-10">
        {loading ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />生成中…</>
        ) : (
          <><Wand2 className="w-4 h-4 mr-2" />{upscale ? '一键超清' : '生成修复提示词'}</>
        )}
      </Button>

      {result && (
        <ResultBoundary onRetry={() => setResult(null)}>
          <div ref={resultRef} className="flex flex-col gap-3 rounded-xl border border-border/60 p-3 bg-muted/20">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">{result.title}</h3>
              <div className="flex gap-1 flex-wrap justify-end">
                {(result.tags || []).map((t, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-muted/50 text-muted-foreground">{t}</span>
                ))}
              </div>
            </div>

            {result.scene_analysis && (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <button onClick={() => setAnalysisOpen(!analysisOpen)} className="w-full flex items-center gap-1.5 px-3 py-2 bg-muted/30 text-xs font-medium hover:bg-muted/50 transition-colors">
                  {analysisOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  修复分析
                </button>
                {analysisOpen && (
                  <div className="px-3 py-2.5 text-[13px] leading-relaxed">
                    <ReactMarkdown
                      components={{
                        h1: ({node, ...props}) => <h1 className="text-base font-semibold mt-3 mb-1" {...props} />,
                        h2: ({node, ...props}) => <h2 className="text-sm font-semibold mt-2 mb-1" {...props} />,
                        h3: ({node, ...props}) => <h3 className="text-sm font-medium mt-2 mb-1" {...props} />,
                        ul: ({node, ...props}) => <ul className="list-disc pl-4 space-y-0.5 my-1" {...props} />,
                        ol: ({node, ...props}) => <ol className="list-decimal pl-4 space-y-0.5 my-1" {...props} />,
                        p: ({node, ...props}) => <p className="my-1" {...props} />,
                        strong: ({node, ...props}) => <strong className="font-semibold" {...props} />,
                      }}
                    >
                      {result.scene_analysis}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            )}

            <PromptBlock title="中文修复提示词" text={result.repair_prompt_zh} accent="border-amber-400/40" />
            <PromptBlock title="English Repair Prompt" text={result.repair_prompt_en} accent="border-sky-400/40" />
            <PromptBlock title="负向约束" text={result.negative_constraints} accent="border-red-400/40" />
            {!result.repair_prompt_zh && !result.repair_prompt_en && (
              <div className="rounded-lg border border-border/60 p-3 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">
                {JSON.stringify(result, null, 2)}
              </div>
            )}
          </div>
        </ResultBoundary>
      )}

      {showAnnotator && annotateIdx !== null && images[annotateIdx] && (
        <ImageAnnotator
          image={images[annotateIdx].file}
          onDone={handleAnnotated}
          onCancel={() => { setShowAnnotator(false); setAnnotateIdx(null); }}
        />
      )}
    </div>
  );
}
