import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, Download, Table, X } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { Switch } from '@/components/ui/switch';
import { parseXlsx } from '@/lib/parseXlsx';


function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const parseLine = (line) => {
    const result = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (c === delim && !inQ) { result.push(cur); cur = ''; }
      else cur += c;
    }
    result.push(cur);
    return result.map(s => s.trim());
  };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const vals = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = (vals[i] || '').trim());
    return obj;
  });
  return { headers, rows };
}

function toCSV(headers, rows) {
  const escape = (v) => {
    const s = String(v || '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.map(escape).join(',')];
  rows.forEach(row => lines.push(headers.map(h => escape(row[h])).join(',')));
  return lines.join('\n');
}

export default function BatchStoryboard() {
  const [pasteText, setPasteText] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [promptCol, setPromptCol] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [optimizeDialogue, setOptimizeDialogue] = useState(false);
  const fileInput = useRef(null);
  const dragCounter = useRef(0);

  // 自动选中字数最多的列作为增强列
  const autoPickColumn = (h, r) => {
    if (!h || h.length === 0) return '';
    return h.reduce((best, col) => {
      const totalLen = (r || []).reduce((sum, row) => sum + String(row[col] || '').length, 0);
      return totalLen > best.len ? { col, len: totalLen } : best;
    }, { col: h[0], len: 0 }).col;
  };

  const readFile = async (file) => {
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    if (isExcel) {
      setParsing(true);
      try {
        const rawRows = await parseXlsx(file);
        if (!rawRows || rawRows.length === 0) {
          toast({ title: 'Excel解析失败', description: '文件为空', variant: 'destructive' });
          return;
        }
        const h = rawRows[0].map(c => String(c ?? '').trim());
        const r = rawRows.slice(1).map(row => {
          const obj = {};
          h.forEach((col, i) => obj[col] = String(row[i] ?? '').trim());
          return obj;
        }).filter(row => Object.values(row).some(v => v));
        if (r.length === 0) {
          toast({ title: 'Excel解析失败', description: '未检测到数据行', variant: 'destructive' });
          return;
        }
        setHeaders(h);
        setRows(r);
        setPromptCol(autoPickColumn(h, r));
      } catch (e) {
        toast({ title: 'Excel解析失败', description: e.message, variant: 'destructive' });
      } finally {
        setParsing(false);
      }
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setPasteText(String(ev.target.result || ''));
        const { headers: h, rows: r } = parseCSV(ev.target.result);
        if (h.length > 0) {
          setHeaders(h);
          setRows(r);
          setPromptCol(autoPickColumn(h, r));
        }
      };
      reader.readAsText(file);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.(csv|tsv|txt|xlsx|xls)$/i.test(file.name)) {
      toast({ title: '请拖入 CSV / TSV / Excel 文件', variant: 'destructive' });
      return;
    }
    readFile(file);
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };

  const handleParse = () => {
    const { headers: h, rows: r } = parseCSV(pasteText);
    if (h.length === 0) { toast({ title: '未检测到数据', variant: 'destructive' }); return; }
    setHeaders(h);
    setRows(r);
    setPromptCol(autoPickColumn(h, r));
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readFile(file);
    if (fileInput.current) fileInput.current.value = '';
  };

  const handleBatch = async () => {
    if (rows.length === 0 || !promptCol) return;
    setLoading(true);
    setProgress(0);
    const newHeaders = headers.filter(h => !['保留台词', '镜头意图', '增强维度'].includes(h));
    for (const col of ['导演增强', '英文Prompt']) {
      if (!newHeaders.includes(col)) newHeaders.push(col);
    }
    setHeaders(newHeaders);
    setRows(prev => prev.map(r => ({ ...r, '导演增强': '', '英文Prompt': '' })));

    let successCount = 0;
    let failCount = 0;
    let done = 0;
    const indices = rows.map((r, i) => ({ i, prompt: r[promptCol] || '' })).filter(x => x.prompt.trim());
    const CONCURRENCY = 4;
    const processOne = async ({ i, prompt }) => {
      try {
        const res = await base44.functions.invoke('enhancePrompt', {
          mode: 'video_director',
          raw_input: prompt,
          target_model: 'auto',
          target_type: 'video',
          dialogue_optimize: optimizeDialogue
        });
        const d = res.data;
        if (!d || d.error) throw new Error(d?.error || '处理失败');
        setRows(prev => {
          const next = [...prev];
          next[i] = { ...next[i], '导演增强': d.enhanced_prompt_zh || '', '英文Prompt': d.enhanced_prompt || '' };
          return next;
        });
        successCount++;
      } catch (e) {
        failCount++;
        setRows(prev => {
          const next = [...prev];
          next[i] = { ...next[i], '导演增强': `❌ ${e.message || '失败'}` };
          return next;
        });
      }
      done++;
      setProgress(done);
    };
    // 并发执行，限制同时4条
    for (let start = 0; start < indices.length; start += CONCURRENCY) {
      const batch = indices.slice(start, start + CONCURRENCY);
      await Promise.all(batch.map(processOne));
    }
    setLoading(false);
    if (failCount === 0) {
      toast({ title: `批量增强完成（${successCount}镜）` });
    } else {
      toast({ title: `完成 ${successCount} 镜，失败 ${failCount} 镜`, variant: failCount === indices.length ? 'destructive' : 'default' });
    }
  };

  const handleExport = () => {
    const csv = toCSV(headers, rows);
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'storyboard_enhanced.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasData = headers.length > 0 && rows.length > 0;
  const hasEnhanced = headers.includes('导演增强');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5 text-[11px] text-violet-600 bg-violet-400/10 border border-violet-400/30 rounded-lg px-2.5 py-1.5">
        <Table className="w-3 h-3" />
        分镜表批量增强 · CSV/TSV → 逐镜导演增强 → 导出
      </div>

      {!hasData ? (
        <>
          <div
            onDrop={handleDrop}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            className={`relative rounded-lg transition-all ${isDragging ? 'border-2 border-dashed border-primary bg-primary/5' : ''}`}
          >
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
              placeholder={'粘贴分镜表（CSV/TSV格式，含表头）或拖拽文件到此处\n例如：\n镜号,时长,原始分镜\n01,5s,女孩走进酒吧四处看\n02,4s,特写她发现了什么\n03,6s,她快速穿过人群'}
              className={`min-h-[120px] resize-none bg-muted/30 border rounded-lg p-3 text-xs focus:outline-none font-mono w-full ${isDragging ? 'border-primary' : 'border-border/60 focus:border-border'}`}
              data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
            {isDragging && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none rounded-lg bg-primary/5">
                <div className="flex flex-col items-center gap-1 text-primary">
                  <Upload className="w-6 h-6" />
                  <span className="text-xs font-medium">松开以上传文件</span>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={parsing} className="flex-1">
              {parsing ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />解析中…</> : <><Upload className="w-3.5 h-3.5 mr-1" />上传文件</>}
            </Button>
            <Button size="sm" onClick={handleParse} disabled={parsing} className="flex-1 bg-foreground text-background hover:bg-foreground/90">
              解析表格
            </Button>
            <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={handleFile} className="hidden" />
          </div>
          <p className="text-[10px] text-muted-foreground text-center">支持 CSV / TSV / Excel（.xlsx），直接拖入即可解析</p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground shrink-0">增强列：</span>
            <select value={promptCol} onChange={e => setPromptCol(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs rounded-md bg-muted/30 border border-border/60 focus:outline-none">
              {headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
            <Switch checked={optimizeDialogue} onCheckedChange={setOptimizeDialogue} className="scale-75 origin-left" />
            <span>优化台词{optimizeDialogue ? '（优化为更自然表达）' : '（保留原始台词）'}</span>
          </label>

          <div className="max-h-60 overflow-auto rounded-lg border border-border/40">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-muted/60">
                <tr>{headers.map(h => <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-t border-border/30">
                    {headers.map(h => <td key={h} className="px-2 py-1.5 max-w-48 truncate align-top" title={r[h]}>{r[h]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 20 && <p className="text-[10px] text-muted-foreground text-center py-1.5">…共 {rows.length} 行，仅显示前20行</p>}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setHeaders([]); setRows([]); setPasteText(''); }} className="flex-1">
              <X className="w-3.5 h-3.5 mr-1" />清空
            </Button>
            <Button size="sm" onClick={handleBatch} disabled={loading} className="flex-1 bg-foreground text-background hover:bg-foreground/90">
              {loading ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />增强中… {progress}/{rows.length}</> : <><Table className="w-3.5 h-3.5 mr-1" />批量增强</>}
            </Button>
            {hasEnhanced && (
              <Button variant="outline" size="sm" onClick={handleExport} className="flex-1">
                <Download className="w-3.5 h-3.5 mr-1" />导出
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}