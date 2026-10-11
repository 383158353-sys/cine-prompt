import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

// 可展开的下拉选择器：点击按钮展开选项列表，比平铺按钮更节省空间
export default function IconPicker({ label, items, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = items.find((i) => i.key === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">{label}</span>}
      <div ref={ref} className="relative flex-1">
        <button
          onClick={() => setOpen(!open)}
          className={`flex items-center justify-between w-full h-8 px-2.5 rounded-md text-[11px] font-medium transition-all ${
            open ? 'bg-muted/70 ring-1 ring-border/60' : 'bg-muted/40 hover:bg-muted/70'
          }`}
        >
          <span className={`truncate ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
            {selected ? selected.label : '选择…'}
          </span>
          <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute z-50 top-full left-0 mt-1 rounded-md border border-border/60 bg-popover text-popover-foreground shadow-lg overflow-hidden max-h-60 overflow-y-auto min-w-full w-max max-w-[280px]">
            {items.map((item) => {
              const active = value === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => { onChange(item.key); setOpen(false); }}
                  className={`flex items-center justify-between w-full px-2.5 py-1.5 text-[11px] transition-colors text-left whitespace-nowrap ${
                    active ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted/60'
                  }`}
                >
                  <span>{item.label}</span>
                  {active && <Check className="w-3 h-3 shrink-0 ml-1.5" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}