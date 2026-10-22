import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Circle, ArrowUpRight, Type, Undo2, Trash2, Check, X, Copy, Maximize2, Minimize2, Download } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

const TOOLS = [
  { key: 'circle', label: '圆圈', Icon: Circle },
  { key: 'arrow', label: '箭头', Icon: ArrowUpRight },
  { key: 'text', label: '文字', Icon: Type },
];

function drawAnnotation(ctx, a) {
  ctx.lineWidth = 3;
  ctx.font = 'bold 15px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  if (a.type === 'circle') {
    ctx.strokeStyle = '#ff3b30';
    ctx.beginPath();
    const rx = Math.max(1, Math.abs(a.w) / 2);
    const ry = Math.max(1, Math.abs(a.h) / 2);
    ctx.ellipse(a.x + a.w / 2, a.y + a.h / 2, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (a.type === 'arrow') {
    ctx.strokeStyle = '#ff3b30';
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath();
    ctx.moveTo(a.x1, a.y1);
    ctx.lineTo(a.x2, a.y2);
    ctx.stroke();
    const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
    const len = 12;
    ctx.beginPath();
    ctx.moveTo(a.x2, a.y2);
    ctx.lineTo(a.x2 - len * Math.cos(angle - Math.PI / 6), a.y2 - len * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(a.x2 - len * Math.cos(angle + Math.PI / 6), a.y2 - len * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  } else if (a.type === 'text') {
    const metrics = ctx.measureText(a.text);
    const pad = 5;
    ctx.fillStyle = 'rgba(255,59,48,0.92)';
    ctx.fillRect(a.x - pad, a.y - 18, metrics.width + pad * 2, 24);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(a.text, a.x, a.y);
  }
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function hitTest(pos, a) {
  if (a.type === 'circle') {
    return pos.x >= a.x - 5 && pos.x <= a.x + a.w + 5 && pos.y >= a.y - 5 && pos.y <= a.y + a.h + 5;
  }
  if (a.type === 'arrow') {
    return distToSegment(pos.x, pos.y, a.x1, a.y1, a.x2, a.y2) < 9;
  }
  if (a.type === 'text') {
    const w = (a.text?.length || 1) * 9 + 12;
    return pos.x >= a.x - 6 && pos.x <= a.x + w && pos.y >= a.y - 22 && pos.y <= a.y + 8;
  }
  return false;
}

function shiftAnnotation(a, dx, dy) {
  if (a.type === 'circle') return { ...a, x: a.x + dx, y: a.y + dy };
  if (a.type === 'arrow') return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
  if (a.type === 'text') return { ...a, x: a.x + dx, y: a.y + dy };
  return a;
}

export default function ImageAnnotator({ image, onDone, onCancel }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [tool, setTool] = useState('circle');
  const [annotations, setAnnotations] = useState([]);
  const [drawing, setDrawing] = useState(null);
  const [drag, setDrag] = useState(null);
  const [pendingText, setPendingText] = useState(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const maxW = isFullscreen ? 1600 : 640, maxH = isFullscreen ? 860 : 460;
      const w = img.naturalWidth || 600;
      const h = img.naturalHeight || 400;
      const scale = Math.min(maxW / w, maxH / h, 1);
      setSize({ w: Math.round(w * scale), h: Math.round(h * scale) });
      setReady(true);
    };
    img.src = URL.createObjectURL(image);
    return () => URL.revokeObjectURL(img.src);
  }, [image, isFullscreen]);

  const redraw = useCallback((extra) => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);
    const all = extra ? [...annotations, extra] : annotations;
    all.forEach((a) => drawAnnotation(ctx, a));
  }, [annotations]);

  useEffect(() => {
    if (!ready) return;
    let shape = null;
    if (drawing) {
      if (drawing.type === 'circle') {
        shape = {
          type: 'circle',
          x: Math.min(drawing.start.x, drawing.cur.x),
          y: Math.min(drawing.start.y, drawing.cur.y),
          w: Math.abs(drawing.cur.x - drawing.start.x),
          h: Math.abs(drawing.cur.y - drawing.start.y),
        };
      } else if (drawing.type === 'arrow') {
        shape = {
          type: 'arrow',
          x1: drawing.start.x, y1: drawing.start.y,
          x2: drawing.cur.x, y2: drawing.cur.y,
        };
      }
    }
    redraw(shape);
  }, [ready, annotations, drawing, redraw]);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return {
      x: cx * (canvas.width / rect.width),
      y: cy * (canvas.height / rect.height),
    };
  };

  const onDown = (e) => {
    e.preventDefault();
    if (pendingText) return;
    const pos = getPos(e);
    // 命中已有标注 → 进入拖动
    for (let i = annotations.length - 1; i >= 0; i--) {
      if (hitTest(pos, annotations[i])) {
        setDrag({ index: i, start: pos, orig: { ...annotations[i] } });
        return;
      }
    }
    if (tool === 'text') {
      setPendingText({ x: pos.x, y: pos.y, value: '' });
      return;
    }
    setDrawing({ type: tool, start: pos, cur: pos });
  };

  const onMove = (e) => {
    const pos = getPos(e);
    if (drag) {
      e.preventDefault();
      const dx = pos.x - drag.start.x;
      const dy = pos.y - drag.start.y;
      const moved = shiftAnnotation(drag.orig, dx, dy);
      setAnnotations(annotations.map((a, i) => (i === drag.index ? moved : a)));
      return;
    }
    if (drawing) {
      e.preventDefault();
      setDrawing({ ...drawing, cur: pos });
    }
  };

  const onUp = () => {
    if (drag) { setDrag(null); return; }
    if (!drawing) return;
    const pos = drawing.cur;
    if (drawing.type === 'circle') {
      const w = Math.abs(pos.x - drawing.start.x);
      const h = Math.abs(pos.y - drawing.start.y);
      if (w > 4 && h > 4) {
        setAnnotations([...annotations, {
          type: 'circle',
          x: Math.min(drawing.start.x, pos.x),
          y: Math.min(drawing.start.y, pos.y),
          w, h,
        }]);
      }
    } else if (drawing.type === 'arrow') {
      if (Math.hypot(pos.x - drawing.start.x, pos.y - drawing.start.y) > 6) {
        setAnnotations([...annotations, {
          type: 'arrow',
          x1: drawing.start.x, y1: drawing.start.y,
          x2: pos.x, y2: pos.y,
        }]);
      }
    }
    setDrawing(null);
  };

  const commitText = () => {
    if (!pendingText) return;
    const val = pendingText.value.trim();
    if (val) {
      setAnnotations([...annotations, { type: 'text', x: pendingText.x, y: pendingText.y, text: val }]);
    }
    setPendingText(null);
  };

  const exportCanvas = () => {
    const preview = canvasRef.current, original = imgRef.current;
    if (!preview || !original || !ready) throw new Error('图片尚未加载完成');
    const output = document.createElement('canvas');
    output.width = original.naturalWidth; output.height = original.naturalHeight;
    const ctx = output.getContext('2d');
    ctx.drawImage(original, 0, 0);
    ctx.scale(output.width / preview.width, output.height / preview.height);
    annotations.forEach(annotation => drawAnnotation(ctx, annotation));
    if (pendingText?.value.trim()) drawAnnotation(ctx, {type:'text',x:pendingText.x,y:pendingText.y,text:pendingText.value.trim()});
    return output;
  };
  const exportBlob = () => new Promise((resolve, reject) => {
    try { exportCanvas().toBlob(blob => blob ? resolve(blob) : reject(new Error('无法导出标注图片')), 'image/png'); }
    catch (error) { reject(error); }
  });
  const handleCopyImage = async () => {
    try {
      if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error('当前环境不支持复制图片，请使用保存图片');
      // Start clipboard.write in the click gesture, before PNG encoding finishes.
      await navigator.clipboard.write([new window.ClipboardItem({'image/png':exportBlob()})]);
      toast({title:'已复制标注图片到剪贴板'});
    } catch (error) { toast({title:'复制失败',description:error.message,variant:'destructive'}); }
  };

  const handleSaveImage = async () => {
    try {
      const blob = await exportBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `标注图片-${Date.now()}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast({ title: '已开始下载标注图，请查看下载文件夹' });
    } catch (error) { toast({title:'保存失败',description:error.message,variant:'destructive'}); }
  };

  const handleDone = () => {
    const canvas = canvasRef.current;
    canvas.toBlob((blob) => {
      if (!blob) { onDone(null); return; }
      const file = new File([blob], 'annotated.png', { type: 'image/png' });
      onDone(file);
    }, 'image/png');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`bg-card rounded-2xl border border-border shadow-2xl w-full flex flex-col ${isFullscreen ? 'max-w-none max-h-none h-full rounded-none' : 'max-w-2xl max-h-[92vh]'}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <h3 className="text-sm font-semibold">标注参考图</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? '退出全屏' : '全屏标注'}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex gap-1.5 px-4 py-2.5 border-b border-border/60">
          {TOOLS.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => { setTool(key); setPendingText(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${
                tool === key ? 'bg-foreground text-background' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => setAnnotations(annotations.slice(0, -1))}
            disabled={!annotations.length}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-muted/50 text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Undo2 className="w-3.5 h-3.5" />
            撤销
          </button>
          <button
            onClick={() => setAnnotations([])}
            disabled={!annotations.length}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-muted/50 text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            清空
          </button>
        </div>

        <div className="flex-1 overflow-auto flex items-center justify-center bg-muted/20 p-4">
          {ready && size.w > 0 && (
            <div className="relative" style={{ width: size.w, height: size.h }}>
              <canvas
                ref={canvasRef}
                width={size.w}
                height={size.h}
                onMouseDown={onDown}
                onMouseMove={onMove}
                onMouseUp={onUp}
                onMouseLeave={onUp}
                onTouchStart={onDown}
                onTouchMove={onMove}
                onTouchEnd={onUp}
                className="rounded-lg shadow-md cursor-crosshair touch-none"
                style={{ width: size.w, height: size.h }}
              />
              {pendingText && (
                <input
                  autoFocus
                  value={pendingText.value}
                  onChange={(e) => setPendingText({ ...pendingText, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitText();
                    if (e.key === 'Escape') setPendingText(null);
                  }}
                  onBlur={commitText}
                  placeholder="输入说明…"
                  className="absolute z-10 text-sm px-2 py-1 rounded border-2 border-red-500 bg-white text-black outline-none shadow-lg"
                  style={{ left: pendingText.x, top: pendingText.y - 20, minWidth: 100 }}
                />
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-border/60">
          <p className="text-[11px] text-muted-foreground flex-1 self-center">
            点击标注可拖动移动位置；圈出要改的部位或加文字说明
          </p>
          <Button variant="outline" size="sm" onClick={handleSaveImage} disabled={!ready}>
            <Download className="w-3.5 h-3.5 mr-1" />
            保存图片
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopyImage} disabled={!ready}>
            <Copy className="w-3.5 h-3.5 mr-1" />
            复制图片
          </Button>
          <Button onClick={handleDone} size="sm" className="bg-foreground text-background hover:bg-foreground/90">
            <Check className="w-3.5 h-3.5 mr-1" />
            完成标注
          </Button>
        </div>
      </div>
    </div>
  );
}
