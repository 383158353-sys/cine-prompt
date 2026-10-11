import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check, ThumbsUp, ThumbsDown, ChevronRight, ChevronDown } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import DnaLayers from '@/components/DnaLayers';

// 轻量 Markdown 渲染：仅处理 ### / **粗体** / - 列表，避免引入 react-markdown 导致的 DOM 协调崩溃
function renderLiteMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const blocks = [];
  let list = [];
  const flushList = () => {
    if (list.length) {
      blocks.push(<ul key={`ul-${blocks.length}`} className="mb-1.5 space-y-0.5">{list}</ul>);
      list = [];
    }
  };
  const inline = (s, k) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return parts.map((p, i) => p.startsWith('**') && p.endsWith('**')
      ? <strong key={`${k}-${i}`} className="text-foreground font-semibold">{p.slice(2, -2)}</strong>
      : <React.Fragment key={`${k}-${i}`}>{p}</React.Fragment>
    );
  };
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) { flushList(); return; }
    if (t.startsWith('### ')) { flushList(); blocks.push(<p key={`h-${i}`} className="font-semibold text-foreground mt-2 mb-1">{inline(t.slice(4), `h-${i}`)}</p>); return; }
    if (t.startsWith('## ')) { flushList(); blocks.push(<p key={`h-${i}`} className="font-semibold text-foreground mt-2 mb-1">{inline(t.slice(3), `h-${i}`)}</p>); return; }
    if (t.startsWith('# ')) { flushList(); blocks.push(<p key={`h-${i}`} className="font-semibold text-foreground mt-2 mb-1">{inline(t.slice(2), `h-${i}`)}</p>); return; }
    if (t.startsWith('- ') || t.startsWith('* ')) { list.push(<li key={`li-${i}`} className="ml-4 list-disc">{inline(t.slice(2), `li-${i}`)}</li>); return; }
    flushList();
    blocks.push(<p key={`p-${i}`} className="mb-1.5">{inline(t, `p-${i}`)}</p>);
  });
  flushList();
  return blocks;
}

// 把主提示词与负向提示词整合为可直接喂给模型的最终提示词
function buildVariant(base, baseZh, neg) {
  const negT = (neg || '').trim();
  let en = base || '';
  let zh = baseZh || '';
  if (en && negT) {
    if (/--(ar|v|style|niji)\b/.test(en)) en = en + ' --no ' + negT;
    else en = en + '\n\nNegative prompt: ' + negT;
  }
  if (zh && negT) zh = zh + '\n\n负向提示词：' + negT;
  return { en, zh };
}

// 可折叠区块（定义在组件外部，避免每次渲染重新挂载导致 DOM 抖动）
function CollapsibleSection({ open, setOpen, label, tone = undefined, copyText = undefined, copyKey = undefined, onCopy = undefined, copied = undefined, children }) {
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between">
        <button onClick={() => setOpen(!open)} className={`flex items-center gap-1 text-[11px] ${tone === 'neg' ? 'text-destructive/80 hover:text-destructive' : 'text-muted-foreground hover:text-foreground'}`}>
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {label}
        </button>
        {open && copyText && (
          <button onClick={() => onCopy(copyText, copyKey)} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md hover:bg-muted text-muted-foreground">
            {copied === copyKey ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied === copyKey ? '已复制' : '复制'}
          </button>
        )}
      </div>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

// 统一的提示词输出组件：中文为主、可中英切换、简洁、其余默认折叠。
// 同时服务于「增强」与「反推」：反推结果带有 character_prompt / scene_prompt / dimension_label。
export default function PromptOutput({ result, rawInput = undefined, onRate = undefined, rated = undefined, footer = undefined }) {
  const hasCinematic = Boolean(result.cinematic_prompt || result.cinematic_prompt_zh);
  const isReverseStyle = result.mode === 'reverse_style' || Boolean(result.prompt_template);
  const [variant, setVariant] = useState(isReverseStyle ? 'concept' : (hasCinematic ? 'cinematic' : 'concept'));
  const [lang, setLang] = useState('zh'); // 中文在前，默认中文
  const [showNegative, setShowNegative] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showCharacter, setShowCharacter] = useState(false);
  const [showScene, setShowScene] = useState(false);
  const [showInvariants, setShowInvariants] = useState(false);
  const [showDna, setShowDna] = useState(false);
  const [showSemantic, setShowSemantic] = useState(false);
  const [showAdded, setShowAdded] = useState(false);
  const [copied, setCopied] = useState(null);

  const variants = { concept: buildVariant(result.enhanced_prompt, result.enhanced_prompt_zh, result.negative_prompt) };
  if (hasCinematic) variants.cinematic = buildVariant(result.cinematic_prompt, result.cinematic_prompt_zh, result.negative_prompt);
  if (isReverseStyle) {
    variants.template = buildVariant(result.prompt_template, result.prompt_template_zh, result.negative_prompt);
    variants.precision = buildVariant(result.precision_prompt, result.precision_prompt_zh, result.negative_prompt);
  }
  const current = variants[variant] || variants.concept;
  const displayText = lang === 'en' ? current.en : current.zh;
  // 复制时中文在前、英文在后（完整两版），无论当前显示哪种语言
  const fullCopyText = current.zh && current.en ? `${current.zh}\n\n${current.en}` : (current.zh || current.en || '');

  const handleCopy = (text, key) => {
    if (!text) return;
    try { navigator.clipboard.writeText(text); } catch {}
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
    toast({ title: '已复制到剪贴板' });
  };

  const hasCharacter = Boolean(result.character_prompt);
  const hasScene = Boolean(result.scene_prompt);
  const hasNegative = Boolean(result.negative_prompt);
  const hasAnalysis = (typeof result.analysis === 'string' && result.analysis.length > 0) || (typeof result.director_design === 'string' && result.director_design.length > 0);
  const hasSemantic = Boolean(result.semantic_lock);
  const hasAddedInfo = Array.isArray(result.added_information) && result.added_information.length > 0;
  const hasInvariants = Array.isArray(result.style_invariants) && result.style_invariants.length > 0;
  const hasSignature = Boolean(result.style_signature);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="text-sm font-semibold">{result.title}</h3>
        {result.dimension_label && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{result.dimension_label}</span>
        )}
      </div>

      {result.cleaned_input && result.cleaned_input !== rawInput && (
        <div className="mb-3 rounded-lg bg-muted/30 border border-border/40 p-2.5">
          <span className="text-[10px] text-muted-foreground">输入已自动整理（修正错字/语序）</span>
          <p className="text-xs text-foreground/80 mt-1 leading-relaxed">{result.cleaned_input}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-3">
        {Array.isArray(result.tags) && result.tags.map((t, i) => (
          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>
        ))}
      </div>

      {hasSignature && (
        <div className="mb-3 rounded-lg bg-primary/[0.04] border border-primary/15 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">风格指纹</span>
            <button onClick={() => handleCopy(result.style_signature, 'sig')} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md hover:bg-muted text-muted-foreground">
              {copied === 'sig' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied === 'sig' ? '已复制' : '复制'}
            </button>
          </div>
          <p className="text-xs text-foreground/80 mt-1 leading-relaxed">{result.style_signature}</p>
        </div>
      )}

      {/* 主提示词：中文为主，可中英切换，一键复制 */}
      <div className="rounded-lg border border-foreground/30 bg-foreground/[0.03] p-3">
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <div className="flex gap-1">
            {isReverseStyle && (
              <>
                <button onClick={() => setVariant('concept')} className={`px-2 py-0.5 rounded text-[10px] transition-all ${variant === 'concept' ? 'bg-foreground text-background' : 'bg-muted/60 text-muted-foreground hover:bg-muted'}`}>纯风格</button>
                <button onClick={() => setVariant('template')} className={`px-2 py-0.5 rounded text-[10px] transition-all ${variant === 'template' ? 'bg-foreground text-background' : 'bg-muted/60 text-muted-foreground hover:bg-muted'}`}>模板</button>
                <button onClick={() => setVariant('precision')} className={`px-2 py-0.5 rounded text-[10px] transition-all ${variant === 'precision' ? 'bg-foreground text-background' : 'bg-muted/60 text-muted-foreground hover:bg-muted'}`}>精准</button>
              </>
            )}
            {hasCinematic && !isReverseStyle && (
              <>
                <button onClick={() => setVariant('concept')} className={`px-2 py-0.5 rounded text-[10px] transition-all ${variant === 'concept' ? 'bg-foreground text-background' : 'bg-muted/60 text-muted-foreground hover:bg-muted'}`}>概念设计</button>
                <button onClick={() => setVariant('cinematic')} className={`px-2 py-0.5 rounded text-[10px] transition-all ${variant === 'cinematic' ? 'bg-foreground text-background' : 'bg-muted/60 text-muted-foreground hover:bg-muted'}`}>电影剧照</button>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex gap-0.5 bg-muted/60 rounded p-0.5">
              <button onClick={() => setLang('zh')} className={`px-2 py-0.5 rounded text-[10px] transition-all ${lang === 'zh' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}>中文</button>
              <button onClick={() => setLang('en')} className={`px-2 py-0.5 rounded text-[10px] transition-all ${lang === 'en' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}>English</button>
            </div>
            <button onClick={() => handleCopy(fullCopyText, 'main')} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-foreground text-background hover:bg-foreground/90">
              {copied === 'main' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied === 'main' ? '已复制' : '复制'}
            </button>
          </div>
        </div>
        <p className={`text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap ${lang === 'en' ? 'font-mono' : ''}`}>{displayText}</p>
      </div>

      {/* 其余内容默认折叠，展开后才显示 */}
      {hasCharacter && (
        <CollapsibleSection open={showCharacter} setOpen={setShowCharacter} label="人物独立复刻提示词" copyKey="char" copyText={lang === 'en' ? result.character_prompt : (result.character_prompt_zh || result.character_prompt)} onCopy={handleCopy} copied={copied}>
          <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5">
            <p className={`text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap ${lang === 'en' ? 'font-mono' : ''}`}>{lang === 'en' ? result.character_prompt : (result.character_prompt_zh || result.character_prompt)}</p>
          </div>
        </CollapsibleSection>
      )}

      {hasScene && (
        <CollapsibleSection open={showScene} setOpen={setShowScene} label="场景独立复刻提示词" copyKey="scene" copyText={lang === 'en' ? result.scene_prompt : (result.scene_prompt_zh || result.scene_prompt)} onCopy={handleCopy} copied={copied}>
          <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5">
            <p className={`text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap ${lang === 'en' ? 'font-mono' : ''}`}>{lang === 'en' ? result.scene_prompt : (result.scene_prompt_zh || result.scene_prompt)}</p>
          </div>
        </CollapsibleSection>
      )}

      {hasNegative && (
        <CollapsibleSection open={showNegative} setOpen={setShowNegative} label="负向提示词" tone="neg" copyKey="neg" copyText={result.negative_prompt} onCopy={handleCopy} copied={copied}>
          <div className="rounded-lg border border-destructive/20 bg-destructive/[0.03] p-2.5">
            <p className="text-xs leading-relaxed text-destructive/70 whitespace-pre-wrap font-mono">{result.negative_prompt}</p>
          </div>
        </CollapsibleSection>
      )}

      {hasInvariants && (
        <CollapsibleSection open={showInvariants} setOpen={setShowInvariants} label="风格不变量（更换主体后必须保留的视觉规律）" copyKey="invariants" copyText={result.style_invariants.join('\n')} onCopy={handleCopy} copied={copied}>
          <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5">
            <ol className="space-y-1">
              {result.style_invariants.map((inv, i) => (
                <li key={i} className="text-xs text-muted-foreground leading-relaxed flex gap-1.5">
                  <span className="text-foreground/40 shrink-0">{i + 1}.</span>
                  <span>{inv}</span>
                </li>
              ))}
            </ol>
          </div>
        </CollapsibleSection>
      )}

      {result.analysis_layers && result.analysis_layers.length > 0 ? (
        <CollapsibleSection open={showDna} setOpen={setShowDna} label="风格DNA · 16层完整分析" onCopy={handleCopy} copied={copied}>
          <DnaLayers layers={result.analysis_layers} />
        </CollapsibleSection>
      ) : hasAnalysis && (
        <CollapsibleSection open={showAnalysis} setOpen={setShowAnalysis} label={isReverseStyle ? '风格DNA分析（从大到小16层）' : '设计推演分析'} onCopy={handleCopy} copied={copied}>
          <div className="rounded-lg bg-muted/20 border border-border/40 p-3 text-xs leading-relaxed text-muted-foreground">
            {renderLiteMarkdown(result.analysis || result.director_design)}
          </div>
        </CollapsibleSection>
      )}

      {hasSemantic && (
        <CollapsibleSection open={showSemantic} setOpen={setShowSemantic} label="语义锁定（用户原始意图，AI不可修改）">
          <div className="rounded-lg bg-emerald-400/5 border border-emerald-400/20 p-2.5">
            <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{result.semantic_lock}</p>
          </div>
        </CollapsibleSection>
      )}

      {hasAddedInfo && (
        <CollapsibleSection open={showAdded} setOpen={setShowAdded} label="AI新增信息（导演补全内容）">
          <div className="rounded-lg bg-muted/20 border border-border/40 p-2.5">
            <ul className="space-y-1">
              {result.added_information.map((info, i) => (
                <li key={i} className="text-xs text-muted-foreground leading-relaxed flex gap-1.5">
                  <span className="text-foreground/40 shrink-0">+</span>
                  <span>{info}</span>
                </li>
              ))}
            </ul>
          </div>
        </CollapsibleSection>
      )}

      {onRate && (
        <div className="flex gap-1.5 mt-3">
          <Button variant="outline" size="sm" onClick={() => onRate(true)} disabled={rated} className={`flex-1 ${rated ? 'text-emerald-600 border-emerald-500/40' : ''}`}>
            <ThumbsUp className="w-3.5 h-3.5 mr-1" />认可
          </Button>
          <Button variant="outline" size="sm" onClick={() => onRate(false)} disabled={rated} className="flex-1">
            <ThumbsDown className="w-3.5 h-3.5 mr-1" />不认可
          </Button>
        </div>
      )}
      {rated && <p className="text-[10px] text-muted-foreground mt-2 text-center">已记录反馈，系统将持续学习你的偏好</p>}

      {footer}
    </div>
  );
}