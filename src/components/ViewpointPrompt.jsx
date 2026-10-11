import React, { useState, useRef } from 'react';
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
import { compressImage } from '@/lib/compressImage';
import { urlToFile } from '@/lib/urlToFile';

function extractError(e) {
  const body = e?.response?.data || e?.data || e?.response?.body;
  if (body && typeof body === 'object' && body.error) return body.error;
  if (typeof body === 'string') return body;
  return e?.message || '未知错误';
}

const SUBJECTS = [
  { key: 'character', label: '人物' },
  { key: 'scene', label: '场景' }
];

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

export default function ViewpointPrompt({ onSaved, initialContext }) {
  const [subject, setSubject] = useState(initialContext?.subject || 'character');
  const [viewType, setViewType] = useState(initialContext?.viewType || 'multi_view');
  const [viewCustom, setViewCustom] = useState(initialContext?.viewCustom || '');
  const [desc, setDesc] = useState(initialContext?.desc || '');
  const [refImage, setRefImage] = useState(null);
  const [refPreview, setRefPreview] = useState(initialContext?.refImage_url || null);
  const [refUrl, setRefUrl] = useState(initialContext?.refImage_url || null);
  const [dragOver, setDragOver] = useState(false);
  const [model, setModel] = useState(initialContext?.model || 'automatic');
  const [targetKey, setTargetKey] = useState(initialContext?.target || 'imagine2');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [multiLoading, setMultiLoading] = useState(false);
  const [multiResult, setMultiResult] = useState(null);
  const [copied, setCopied] = useState(null);
  const [showAnnotator, setShowAnnotator] = useState(false);
  const fileInput = useRef(null);

  const views = subject === 'character' ? CHAR_VIEWS : SCENE_VIEWS;
  const isMerge = subject === 'character' && viewType === 'merge';
  const isMultiView = viewType === 'multi_view';

  const selectSubject = (s) => {
    setSubject(s);
    setViewType('multi_view');
    setResult(null);
    setMultiResult(null);
  };

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
    setRefImage(file);
    setRefPreview(URL.createObjectURL(file));
    setRefUrl(null);
  };

  useImagePaste((files) => { if (files[0]) handleFile(files[0]); });

  const onPickFile = (e) => { const f = e.target.files?.[0]; if (f) handleFile(f); };
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); };
  const clearImage = () => { setRefImage(null); setRefPreview(null); setRefUrl(null); if (fileInput.current) fileInput.current.value = ''; };

  const handleAnnotated = (file) => {
    setShowAnnotator(false);
    if (file) {
      setRefImage(file);
      setRefPreview(URL.createObjectURL(file));
      setRefUrl(null);
    }
  };

  const handleGenerate = async () => {
    if (!desc.trim() && !refImage && !refUrl) return;
    setLoading(true);
    setResult(null);
    setCopied(null);
    try {
      let fileUrl = null;
      if (refImage) {
        const compressed = await compressImage(refImage);
        const up = await base44.integrations.Core.UploadFile({ file: compressed });
        fileUrl = up.file_url;
      } else if (refUrl) {
        fileUrl = refUrl;
      }
      const selectedTarget = TARGETS.find((t) => t.key === targetKey) || TARGETS[0];
      const res = await base44.functions.invoke('enhancePrompt', {
        mode: 'sheet', subject, view_type: viewType, view_custom: viewCustom,
        raw_input: desc, file_url: fileUrl, model,
        target: selectedTarget.label, target_type: selectedTarget.type
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
          context: { mode: 'viewpoint', subject, viewType, viewCustom, desc, model, target: targetKey, refImage_url: fileUrl }
        });
        onSaved?.();
      } catch {}
      setResult(data);
      try {
        const copyText = `${data.enhanced_prompt_zh || ''}\n\n${data.enhanced_prompt}`;
        await navigator.clipboard.writeText(copyText.trim());
        toast({ title: '已自动复制（中文在前，英文在后）' });
      } catch {
        toast({ title: '生成完成，可手动复制' });
      }
    } catch (e) {
      console.error('生成失败', e);
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
    if (!refImage && !refUrl) {
      toast({ title: '一键多视角需要先上传参考图', variant: 'destructive' });
      return;
    }
    setMultiLoading(true);
    setMultiResult(null);
    try {
      let fileUrl = null;
      if (refImage) {
        const compressed = await compressImage(refImage);
        const up = await base44.integrations.Core.UploadFile({ file: compressed });
        fileUrl = up.file_url;
      } else if (refUrl) {
        fileUrl = refUrl;
      }
      const selectedTarget = TARGETS.find((t) => t.key === targetKey) || TARGETS[0];
      const res = await base44.functions.invoke('enhancePrompt', {
        mode: 'multi_view', subject,
        raw_input: desc, file_url: fileUrl, model,
        target: selectedTarget.label, target_type: selectedTarget.type
      });
      const data = res.data;
      if (data.views && data.views.length > 0) {
        setMultiResult(data);
        toast({ title: `已生成 ${data.views.length} 个视角提示词`, description: '每个视角可单独复制使用' });
      } else {
        toast({ title: '生成失败', description: '未返回视角数据', variant: 'destructive' });
      }
    } catch (e) {
      console.error('多视角生成失败', e);
      toast({ title: '多视角生成失败', description: extractError(e), variant: 'destructive' });
    } finally {
      setMultiLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 主体：人物 / 场景 */}
      <div className="flex gap-1.5">
        {SUBJECTS.map((s) => (
          <button key={s.key} onClick={() => selectSubject(s.key)} className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${subject === s.key ? 'bg-foreground text-background' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}>{s.label}</button>
        ))}
      </div>

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
          {refPreview ? (
            <div className="relative rounded-lg overflow-hidden border border-border/60 w-24 h-24">
              <img src={refPreview} alt="参考图" className="w-full h-full object-cover" />
              <button onClick={clearImage} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80">
                <X className="w-3 h-3" />
              </button>
              <button
                onClick={async () => {
                  if (!refImage && refUrl) {
                    try {
                      const file = await urlToFile(refUrl);
                      setRefImage(file);
                    } catch { return; }
                  }
                  setShowAnnotator(true);
                }}
                className="absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-foreground text-background hover:bg-foreground/85 flex items-center gap-1"
              >
                <PenLine className="w-2.5 h-2.5" />
                标注
              </button>
            </div>
          ) : (
            <button onClick={() => fileInput.current?.click()} className="flex flex-col items-center justify-center gap-1 w-24 h-24 rounded-lg border border-dashed border-border/60 text-[11px] text-muted-foreground hover:bg-muted/40 hover:border-border transition-colors">
              <ImagePlus className="w-4 h-4" />
              <span>添加图片</span>
            </button>
          )}
        </div>
        <input ref={fileInput} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
      </div>

      {/* 描述（合并模式下也可补充条件） */}
      <VoiceTextarea value={desc} onChange={setDesc} placeholder={isMerge ? '可选：补充角色描述或额外条件（仅上传图片也可生成）' : PLACEHOLDERS[subject]} className="min-h-[90px] resize-y bg-muted/30 border-border/60 focus-visible:ring-1 text-sm" />

      <div className="flex gap-2">
        <IconPicker label="大模型" items={MODELS} value={model} onChange={setModel} />
        <IconPicker label="喂给" items={TARGETS} value={targetKey} onChange={setTargetKey} />
      </div>

      <Button
        onClick={isMultiView ? handleMultiView : handleGenerate}
        disabled={isMultiView ? (multiLoading || (!refImage && !refUrl)) : (loading || (!desc.trim() && !refImage))}
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

      {showAnnotator && refImage && (
        <ImageAnnotator
          image={refImage}
          onDone={handleAnnotated}
          onCancel={() => setShowAnnotator(false)}
        />
      )}
    </div>
  );
}