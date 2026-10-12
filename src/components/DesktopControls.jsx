import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Minus } from 'lucide-react';

export default function DesktopControls(){
  const api=window.cineDesktop;
  const [pinned,setPinned]=useState(true);
  useEffect(()=>{api?.getWindowState().then(state=>setPinned(state.alwaysOnTop));},[api]);
  if(!api)return null;
  return <div className="fixed bottom-3 left-3 z-[100] flex gap-1 rounded-full border bg-background/90 p-1 shadow-lg backdrop-blur">
    <button title={pinned?'取消始终置顶':'始终置顶'} className="rounded-full p-2 hover:bg-muted" onClick={async()=>setPinned(await api.setAlwaysOnTop(!pinned))}>{pinned?<Eye className="h-3.5 w-3.5"/>:<EyeOff className="h-3.5 w-3.5"/>}</button>
    <button title="隐藏到系统托盘" className="rounded-full p-2 hover:bg-muted" onClick={()=>api.hide()}><Minus className="h-3.5 w-3.5"/></button>
  </div>;
}

