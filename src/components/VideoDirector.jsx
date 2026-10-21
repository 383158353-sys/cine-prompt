import { projectStylePayload } from '../../shared/project-styles.mjs';
import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, Clapperboard, ImagePlus, X, PenLine } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { VIDEO_TARGETS } from '@/lib/directions';
import { useChatModelItems } from '@/components/ChatModelManager';
import IconPicker from '@/components/IconPicker';
import VoiceTextarea from '@/components/VoiceTextarea';
import { useImagePaste } from '@/hooks/useImagePaste';
import PromptOutput from '@/components/PromptOutput';
import ResultBoundary from '@/components/ResultBoundary';
import ImageAnnotator from '@/components/ImageAnnotator';
import { compressImages } from '@/lib/compressImage';
import { urlToFile } from '@/lib/urlToFile';
import { Switch } from '@/components/ui/switch';

function extractError(e) {
  const body = e?.response?.data || e?.data || e?.response?.body;
  if (body && typeof body === 'object' && body.error) return body.error;
  if (typeof body === 'string') return body;
  return e?.message || '未知错误';
}

export default function VideoDirector({ onSaved, initialContext, sharedStyles = [], projectStyle, active = true, onTaskStatus }) {
  const [rawInput, setRawInput] = useState(initialContext?.raw_input || '');
  const [targetModel, setTargetModel] = useState(initialContext?.targetModel || 'auto');
  const [model, setModel] = useState(initialContext?.model || 'automatic');
  const chatModelItems = useChatModelItems();
  const [images, setImages] = useState(() => initialContext?.file_urls?.map((url) => ({ file: null, preview: url, url })) || []);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [optimizeDialogue, setOptimizeDialogue] = useState(initialContext?.optimizeDialogue || false);
  const fileInput = useRef(null);
  const [annotateIdx, setAnnotateIdx] = useState(null);
  const [showAnnotator, setShowAnnotator] = useState(false);

  const addFiles = (fileList) => {
    const arr = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) { toast({ title: '请上传图片文件', variant: 'destructive' }); return; }
    setImages((prev) => [...prev, ...arr.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))]);
  };

  useImagePaste(addFiles,active);

  const onPickFile = (e) => { addFiles(e.target.files); if (fileInput.current) fileInput.current.value = ''; };
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); };
  const removeImage = (idx) => setImages((prev) => prev.filter((it, i) => { if (i !== idx) return true; if (it.preview?.startsWith('blob:')) URL.revokeObjectURL(it.preview); return false; }));

  const handleAnnotated = (file) => {
    setShowAnnotator(false);
    if (file && annotateIdx !== null) {
      setImages((prev) => prev.map((it, i) => i === annotateIdx ? { file, preview: URL.createObjectURL(file) } : it));
    }
    setAnnotateIdx(null);
  };

  const handleEnhance = async () => {
    if (!rawInput.trim() && images.length === 0) return;
    setLoading(true);
    onTaskStatus?.('running');
    setResult(null);
    console.log('[VideoDirector] sending mode=video_director, raw_input:', rawInput);
    try {
      let fileUrls = null;
      const newFiles = images.filter((img) => img.file).map((img) => img.file);
      const existingUrls = images.filter((img) => img.url && !img.file).map((img) => img.url);
      if (newFiles.length > 0 || existingUrls.length > 0) {
        let uploaded = [];
        if (newFiles.length > 0) {
          const compressed = await compressImages(newFiles);
          const uploads = await Promise.all(compressed.map((f) => base44.integrations.Core.UploadFile({ file: f })));
          uploaded = uploads.map((u) => u.file_url);
        }
        fileUrls = [...uploaded, ...existingUrls];
      }
      const res = await base44.functions.invoke('enhancePrompt', {
        mode: 'video_director',
        raw_input: rawInput,
        target_model: targetModel,
        model,
        file_urls: fileUrls,
        dialogue_optimize: optimizeDialogue,
        styles: sharedStyles.map((style) => ({ name: style.name, category: style.category, style_prompt: style.style_prompt })),
        project_style: projectStylePayload(projectStyle)
      });
      const data = res.data;
      if (!data || data.error) throw new Error(data?.error || '增强失败');
      // 自动存入提示词库（含用户原始输入）
      try {
        await base44.entities.Prompt.create({
          title: data.title || rawInput.slice(0, 20),
          raw_input: rawInput,
          content: data.enhanced_prompt,
          content_zh: data.enhanced_prompt_zh || '',
          category: data.category || '镜头运镜',
          direction: 'video_director',
          rating: 3,
          tags: data.tags || [],
          context: { mode: 'video', videoMode: 'single', raw_input: rawInput, model, targetModel, optimizeDialogue, file_urls: fileUrls }
        });
        onSaved?.();
      } catch {}
      setResult(data);
      onTaskStatus?.('done');
      try {
        await navigator.clipboard.writeText(data.enhanced_prompt);
        toast({ title: '已自动复制英文Prompt' });
      } catch {}
    } catch (e) {
      onTaskStatus?.('error');
      toast({ title: '增强失败', description: extractError(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5 text-[11px] text-violet-600 bg-violet-400/10 border border-violet-400/30 rounded-lg px-2.5 py-1.5">
        <Clapperboard className="w-3 h-3" />
        AI视频提示词翻译 · 把抽象感受翻译成具体动作与运镜
      </div>

      {/* 参考图：角色/场景/首帧（统一放在模型选择之上） */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-col gap-2 rounded-lg transition-colors ${dragOver ? 'bg-primary/5 ring-2 ring-primary/30' : ''}`}
      >
        <span className="text-[11px] text-muted-foreground">参考图（可选·角色/场景/首帧）</span>
        <div className="flex flex-wrap gap-2">
          {images.map((img, idx) => (
            <div key={idx} className="relative rounded-lg overflow-hidden border border-border/60 w-20 h-20">
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
            className="flex flex-col items-center justify-center gap-1 w-20 h-20 rounded-lg border border-dashed border-border/60 text-[10px] text-muted-foreground hover:bg-muted/40 hover:border-border transition-colors"
          >
            <ImagePlus className="w-4 h-4" />
            <span>添加参考</span>
          </button>
        </div>
        <input ref={fileInput} type="file" accept="image/*" multiple onChange={onPickFile} className="hidden" />
      </div>

      <div className="flex gap-2">
        <IconPicker label="大模型" items={chatModelItems} value={model} onChange={setModel} />
        <IconPicker label="目标视频模型" items={VIDEO_TARGETS} value={targetModel} onChange={setTargetModel} />
      </div>

      <VoiceTextarea value={rawInput} onChange={setRawInput}
        placeholder="例如：女孩站在雨里，突然回头，然后跑走。"
        className="min-h-[90px] resize-y bg-muted/30 border-border/60 focus-visible:ring-1 text-sm" />

      <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
        <Switch checked={optimizeDialogue} onCheckedChange={setOptimizeDialogue} className="scale-75 origin-left" />
        <span>优化台词{optimizeDialogue ? '（优化为更自然表达）' : '（保留原始台词）'}</span>
      </label>

      <Button onClick={handleEnhance} disabled={loading || (!rawInput.trim() && images.length === 0)}
        className="w-full bg-foreground text-background hover:bg-foreground/90 h-10">
        {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />导演增强中…</>
        : <><Clapperboard className="w-4 h-4 mr-2" />导演级增强</>}
      </Button>

      {result && (
        <ResultBoundary onRetry={() => setResult(null)}>
          <PromptOutput result={result} rawInput={rawInput} />
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
