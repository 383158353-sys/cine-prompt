import React, { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { Image } from '@/components/ui/image';
import BrandLogo, { BRAND_ICON } from '@/components/BrandLogo';
import PromptEnhancer from '@/components/PromptEnhancer';
import RecoverableBoundary from '@/components/RecoverableBoundary';

// 可拖动的迷你浮窗：在浏览器内常驻，挨着你的生图软件使用
export default function FloatingEnhancer({ onSaved }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem('fe_state') || 'null'); } catch { return null; } })();
  const [open, setOpen] = useState(saved?.open ?? false);
  const [pos, setPos] = useState(saved?.pos || { x: 60, y: 80 });
  const [maximized, setMaximized] = useState(saved?.maximized ?? false);
  const dragRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem('fe_state', JSON.stringify({ open, pos, maximized })); } catch {}
  }, [open, pos, maximized]);

  useEffect(() => {
    const handler = (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const startDrag = (e) => {
    if (maximized) return;
    dragging.current = true;
    const point = e.touches ? e.touches[0] : e;
    offset.current = {
      x: point.clientX - pos.x,
      y: point.clientY - pos.y
    };
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchmove', onDrag);
    document.addEventListener('touchend', stopDrag);
  };

  const onDrag = (e) => {
    if (!dragging.current) return;
    const point = e.touches ? e.touches[0] : e;
    const maxX = window.innerWidth - 320;
    const maxY = window.innerHeight - 120;
    setPos({
      x: Math.min(Math.max(0, point.clientX - offset.current.x), maxX),
      y: Math.min(Math.max(0, point.clientY - offset.current.y), maxY)
    });
  };

  const stopDrag = () => {
    dragging.current = false;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', stopDrag);
    document.removeEventListener('touchmove', onDrag);
    document.removeEventListener('touchend', stopDrag);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-2xl shadow-xl ring-1 ring-black/10 hover:scale-105 active:scale-95 transition-transform flex items-center justify-center overflow-hidden"
        title="打开影词模方"
      >
        <Image src={BRAND_ICON} alt="影词模方" className="w-14 h-14" />
      </button>
    );
  }

  if (maximized) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <BrandLogo size={26} showSubtitle={false} titleClass="font-semibold text-sm" />
          <div className="flex items-center gap-1">
            <button onClick={() => setMaximized(false)} className="p-1.5 rounded hover:bg-muted text-xs">
              浮窗
            </button>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded hover:bg-muted">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 max-w-xl mx-auto w-full">
          <RecoverableBoundary>
            <PromptEnhancer onSaved={onSaved} />
          </RecoverableBoundary>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={dragRef}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-50 w-80 rounded-2xl border border-border/60 bg-card shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden"
    >
      <div
        onMouseDown={startDrag}
        onTouchStart={startDrag}
        className="flex items-center justify-between px-3 py-2 border-b border-border/40 cursor-move bg-foreground text-background"
      >
        <div className="flex items-center gap-1.5">
          <Image src={BRAND_ICON} alt="" className="w-5 h-5 rounded-md" />
          <span className="text-xs font-medium tracking-tight">影词模方</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMaximized(true)} className="p-1 rounded hover:bg-white/15 text-[10px]">
            展开
          </button>
          <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-white/15">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="p-3 overflow-auto max-h-[70vh]">
        <RecoverableBoundary>
          <PromptEnhancer onSaved={onSaved} compact />
        </RecoverableBoundary>
      </div>
    </div>
  );
}