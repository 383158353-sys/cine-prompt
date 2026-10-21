import React, { useId, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

export default function ChatModelPicker({ id, models, value, onChange, placeholder, required = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listId = useId();
  const filtered = models.filter(name => name.toLowerCase().includes(query.trim().toLowerCase()));
  function choose(name) { onChange(name); setOpen(false); }
  return <div className="flex min-w-0 gap-1">
    <Input id={id} required={required} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="min-w-0 flex-1" />
    <Popover open={open} onOpenChange={next => { setOpen(next); if (next) setQuery(''); }}>
      <PopoverTrigger asChild><button type="button" aria-label={`选择${id === 'model' ? '默认' : id.replace('model-', '')}聊天模型`} aria-haspopup="dialog" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-background hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><ChevronDown className="h-4 w-4" /></button></PopoverTrigger>
      <PopoverContent align="end" collisionPadding={12} className="flex w-[min(360px,calc(100vw-24px))] max-h-[min(360px,var(--radix-popover-content-available-height))] flex-col gap-2 overflow-hidden p-2" aria-label="选择聊天模型">
        <Input aria-label="搜索聊天模型" placeholder="搜索聊天模型…" value={query} onChange={event => setQuery(event.target.value)} aria-controls={listId} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (filtered.length) choose(filtered[0]); } else if (event.key === 'ArrowDown') { event.preventDefault(); document.getElementById(listId)?.querySelector('button')?.focus(); } }} />
        <div id={listId} role="group" aria-label="聊天模型列表" className="min-h-0 overflow-y-auto overscroll-contain" style={{ maxHeight: 264, scrollbarGutter: 'stable' }} onKeyDown={event => { if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return; const buttons = Array.from(event.currentTarget.querySelectorAll('button')); const current = buttons.indexOf(document.activeElement); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))); event.preventDefault(); buttons[next]?.focus(); }}>
          {filtered.map(name => <button key={name} type="button" aria-pressed={value === name} onClick={() => choose(name)} className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"><span className="min-w-0 flex-1 break-all">{name}</span>{value === name && <Check className="h-4 w-4 shrink-0" />}</button>)}
          {!filtered.length && <p className="px-2 py-3 text-sm text-muted-foreground">{models.length ? '没有匹配的聊天模型，可在输入框手动填写。' : '暂无可用模型：请在上方勾选并「测试已勾选」，也可手动填写模型 ID。'}</p>}
        </div>
        <p role="status" className="px-2 text-xs text-muted-foreground">{filtered.length} 个聊天模型</p>
      </PopoverContent>
    </Popover>
  </div>;
}
