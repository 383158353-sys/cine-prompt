import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, Wand2, ImagePlus, X, Save, PenLine } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { GROUPS, MODELS, STYLES } from '@/lib/directions';
import IconPicker from '@/components/IconPicker';
import VoiceTextarea from '@/components/VoiceTextarea';
import { useImagePaste } from '@/hooks/useImagePaste';
import PromptOutput from '@/components/PromptOutput';
import ResultBoundary from '@/components/ResultBoundary';
import ImageAnnotator from '@/components/ImageAnnotator';
import { compressImages } from '@/lib/compressImage';
import { urlToFile } from '@/lib/urlToFile';

// 从 SDK/axios 错误中提取后端返回的真实错误信息
function extractError(e) {
  const body = e?.response?.data || e?.data || e?.response?.body;
  if (body && typeof body === 'object' && body.error) return body.error;
  if (typeof body === 'string') return body;
  return e?.message || '未知错误';
}

const REVERSE_CATEGORIES = [
  {
    key: 'style', label: '风格', items: [
      { key: 'style_full', label: '整图综合风格' },
    ],
  },
  {
    key: 'character', label: '人物', items: [
      { key: 'char_silhouette', label: '动作轮廓' },
      { key: 'char_clothing', label: '服装样式' },
      { key: 'char_accessories', label: '配饰样式' },
      { key: 'char_face', label: '面部五官' },
      { key: 'char_hairstyle', label: '发型' },
      { key: 'char_makeup', label: '妆容' },
      { key: 'char_style', label: '人物整体风格' },
      { key: 'char_full', label: '完整反推人物' },
    ],
  },
  {
    key: 'scene', label: '场景', items: [
      { key: 'scene_space', label: '空间结构' },
      { key: 'scene_color', label: '色彩配色' },
      { key: 'scene_material', label: '材质质感' },
      { key: 'scene_lighting', label: '光影氛围' },
      { key: 'scene_style', label: '场景综合风格' },
      { key: 'scene_full', label: '完整反推场景' },
    ],
  },
];

export default function ReversePrompt({ onSaved, initialContext, active = true, onTaskStatus }) {
  const [images, setImages] = useState(() => initialContext?.file_urls?.map((url) => ({ file: null, preview: url, url })) || []);
  const [dragOver, setDragOver] = useState(false);
  const [category, setCategory] = useState(() => {
    if (initialContext?.dimension) {
      return REVERSE_CATEGORIES.find((c) => c.items.some((i) => i.key === initialContext.dimension))?.key || 'style';
    }
    return 'style';
  });
  const [dimension, setDimension] = useState(initialContext?.dimension || 'style_full');
  const [refine, setRefine] = useState(initialContext?.refine || '');
  const [model, setModel] = useState(initialContext?.model || 'automatic');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [dirName, setDirName] = useState('');
  const [dirGroup, setDirGroup] = useState('character');
  const [dirBase, setDirBase] = useState('character_realistic');
  const [saving, setSaving] = useState(false);
  const [annotateIdx, setAnnotateIdx] = useState(null);
  const [showAnnotator, setShowAnnotator] = useState(false);
  const fileInput = useRef(null);

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

  const handleReverse = async () => {
    if (images.length === 0) return;
    setLoading(true);
    onTaskStatus?.('running');
    setResult(null);
    setSaveOpen(false);
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
        mode: 'reverse', extract: dimension, file_urls, model, refine
      });
      const data = res.data;
      // 自动存入提示词库（反推结果，含用户原始输入/补充说明）
      try {
        await base44.entities.Prompt.create({
          title: data.title || `反推·${dimension}`,
          raw_input: refine || `反推:${dimension}`,
          content: data.enhanced_prompt,
          content_zh: data.enhanced_prompt_zh || '',
          category: data.category || '风格美学',
          direction: `reverse_${dimension}`,
          rating: 3,
          tags: data.tags || [],
          context: { mode: 'reverse', dimension, refine, model, file_urls }
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
        toast({ title: '反推完成，可手动复制' });
      }
    } catch (e) {
      console.error('反推失败', e);
      onTaskStatus?.('error');
      toast({ title: '反推失败', description: extractError(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDirection = async () => {
    if (!dirName.trim()) { toast({ title: '请填写方向名称', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      await base44.entities.Direction.create({
        name: dirName.trim(),
        group: dirGroup,
        base_direction: dirBase,
        system_prompt: `${result.enhanced_prompt}\n\n${result.enhanced_prompt_zh}`
      });
      toast({ title: '已存为项目方向', description: '可在增强模式中选用' });
      setSaveOpen(false);
      setDirName('');
      onSaved?.();
    } catch (e) {
      toast({ title: '保存失败', description: extractError(e), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const baseOptions = STYLES[dirGroup] || [];

  const saveFooter = !saveOpen ? (
    <Button variant="outline" size="sm" onClick={() => setSaveOpen(true)} className="w-full mt-3">
      <Save className="w-3.5 h-3.5 mr-1" />存为项目方向
    </Button>
  ) : (
    <div className="rounded-lg border border-border/60 p-3 flex flex-col gap-2 mt-3">
      <input
        value={dirName}
        onChange={(e) => setDirName(e.target.value)}
        placeholder="方向名称（如：赛博朋克霓虹风）"
        className="w-full px-2.5 py-1.5 text-xs rounded-md bg-muted/30 border border-border/60 focus:outline-none focus:border-border"
      />
      <div className="flex gap-2">
        <select
          value={dirGroup}
          onChange={(e) => { setDirGroup(e.target.value); setDirBase((STYLES[e.target.value]?.[0] || {}).key || 'character_realistic'); }}
          className="flex-1 px-2 py-1.5 text-xs rounded-md bg-muted/30 border border-border/60 focus:outline-none"
        >
          {GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
        <select value={dirBase} onChange={(e) => setDirBase(e.target.value)} className="flex-1 px-2 py-1.5 text-xs rounded-md bg-muted/30 border border-border/60 focus:outline-none">
          {baseOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" onClick={() => setSaveOpen(false)} className="flex-1">取消</Button>
        <Button size="sm" onClick={handleSaveDirection} disabled={saving} className="flex-1 bg-foreground text-background hover:bg-foreground/90">
          {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
          保存
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* 反推分类 — 置顶，与增强页模板一致 */}
      <div>
        <span className="text-[11px] text-muted-foreground">反推分类</span>
        <div className="flex gap-1.5 mt-1.5">
          {REVERSE_CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => { setCategory(c.key); setDimension(c.items[0].key); }}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${category === c.key ? 'bg-foreground text-background' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 flex-wrap mt-1.5">
          {REVERSE_CATEGORIES.find((c) => c.key === category)?.items.map((d) => (
            <button
              key={d.key}
              onClick={() => setDimension(d.key)}
              className={`px-2.5 py-1 rounded-full text-[11px] transition-all ${dimension === d.key ? 'bg-foreground text-background' : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'}`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* 参考图：与增强页一致的"添加图片"样式 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-lg transition-colors ${dragOver ? 'bg-primary/5 ring-2 ring-primary/30' : ''}`}
      >
        <div className="flex flex-wrap gap-2">
          {images.map((img, idx) => (
            <div key={idx} className="relative rounded-lg overflow-hidden border border-border/60 w-24 h-24">
              <img src={img.preview} alt={`参考图${idx + 1}`} className="w-full h-full object-cover" />
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
        value={refine}
        onChange={setRefine}
        placeholder="可选：精确补充反推方向（如：重点提取金属反光、忽略背景人物）"
        className="min-h-[48px] resize-none bg-muted/30 border-border/60 focus-visible:ring-1 text-sm"
      />

      <IconPicker label="大模型" items={MODELS} value={model} onChange={setModel} />

      <Button onClick={handleReverse} disabled={loading || images.length === 0} className="w-full bg-foreground text-background hover:bg-foreground/90 h-10">
        {loading ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />反推中…</>
        ) : (
          <><Wand2 className="w-4 h-4 mr-2" />反推提示词</>
        )}
      </Button>

      {result && (
        <ResultBoundary onRetry={() => setResult(null)}>
          <PromptOutput result={result} footer={saveFooter} />
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
