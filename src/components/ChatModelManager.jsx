import React, { useState } from 'react';
import { Loader2, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

// 聊天模型管理：候选（平台拉取）→ 勾选 → 测试已勾选 → 通过的进下拉。数据存 localStorage。
const KEYS = { candidates: 'cine-model-candidates', selected: 'cine-model-selected', results: 'cine-model-test-results' };
function read(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch { return fallback; } }
// 兼容字符串或 {id,name} 对象，统一成字符串 ID
const toId = item => String(typeof item === 'string' ? item : item?.id || item?.name || '').trim();
const ids = list => [...new Set((Array.isArray(list) ? list : []).map(toId).filter(Boolean))];
// 推荐聊天模型（每个系列最实惠的一个），按价格从低到高；价格为每百万 token 输入/输出
export const CURATED = [
  { id: 'hk-5-5', label: 'Claude Haiku 5.5', price: '0.22/1.09' },
  { id: 'tt-6-luna', label: 'GPT 6 Luna', price: '0.36/1.81' },
  { id: 'gem-3.8-flash', label: 'Gemini 3.8 Flash', price: '0.42/2.08' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', price: '' },
  { id: 'tt-6.1-sol', label: 'GPT 6.1 Sol', price: '0.94/4.71' },
];
const CURATED_IDS = CURATED.map(m => m.id);
export function loadModelState() {
  const migrated = localStorage.getItem('cine-model-curated-v1') === '1';
  const prevSel = ids(read(KEYS.selected, []));
  let manual = ids(read('cine-model-manual', [])).filter(id => !CURATED_IDS.includes(id));
  if (!migrated) manual = [...new Set([...manual, ...prevSel.filter(id => !CURATED_IDS.includes(id))])]; // 之前手动勾选的保留
  const candidates = [...CURATED_IDS, ...manual];
  const selected = migrated ? prevSel.filter(id => candidates.includes(id)) : [...CURATED_IDS, ...manual];
  const raw = read(KEYS.results, {}); const results = {};
  if (raw && typeof raw === 'object') for (const id of candidates) if (raw[id]) results[id] = raw[id];
  const state = { candidates, selected, results, manual, platform: read('cine-model-platform', {}) || {} };
  if (!migrated) { localStorage.setItem('cine-model-curated-v1', '1'); saveModelState(state); }
  return state;
}
export function saveModelState(state) {
  localStorage.setItem(KEYS.candidates, JSON.stringify(ids(state.candidates)));
  localStorage.setItem(KEYS.selected, JSON.stringify(ids(state.selected)));
  localStorage.setItem(KEYS.results, JSON.stringify(state.results || {}));
  localStorage.setItem('cine-model-manual', JSON.stringify(ids(state.manual)));
  localStorage.setItem('cine-model-platform', JSON.stringify(state.platform || {}));
  try { window.dispatchEvent(new Event('cine-models-changed')); } catch { /* ignore */ }
}
export function usableModels(state) { return ids(state.selected).filter(id => ids(state.candidates).includes(id) && state.results?.[id]?.ok); }

export default function ChatModelManager({ state, setState, onTest, busy, header = undefined }) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState('');
  const addManual = () => { const id = newId.trim(); if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(id)) return; const next = { ...state, manual: [...new Set([...(state.manual || []), id])], candidates: [...new Set([...candidates, id])], selected: [...new Set([...selected, id])] }; update(next); setNewId(''); setAdding(false); if (!state.results?.[id]) onTest([id]); };
  const update = next => { saveModelState(next); setState(next); };
  const candidates = ids(state.candidates), selected = ids(state.selected).filter(id => candidates.includes(id));
  const ordered = [...selected, ...candidates.filter(id => !selected.includes(id))];
  const q = query.trim().toLowerCase();
  const shown = q ? ordered.filter(id => id.toLowerCase().includes(q)) : ordered;
  const tick = (id, on) => { update({ ...state, selected: on ? [...selected.filter(x => x !== id), id] : selected.filter(x => x !== id) }); if (on && !state.results?.[id] && !busy) onTest([id]); };
  const setAll = on => update({ ...state, selected: on ? [...selected, ...shown.filter(id => !selected.includes(id))] : selected.filter(id => !shown.includes(id)) });
  const move = (id, d) => { const s = [...selected]; const i = s.indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; update({ ...state, selected: s }); };
  const small = 'h-6 px-2 text-xs';
  return <div className="rounded-lg border border-border/60 p-3 space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium mr-auto">聊天模型 <span className="text-xs text-muted-foreground">候选 {candidates.length} · 勾选 {selected.length} · 可用 {usableModels(state).length}</span></span>
      {header}
      <Button type="button" size="sm" className="h-7" disabled={!selected.length || busy} onClick={() => onTest(selected)}>{busy && <Loader2 className="w-3 h-3 animate-spin mr-1" />}测试已勾选</Button>
    </div>
    <div className="flex items-center gap-1">
      <input type="search" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} placeholder="搜索模型" aria-label="搜索候选模型" className="h-7 flex-1 min-w-0 rounded-md border border-input bg-transparent px-2 text-sm" />
      <Button type="button" variant="outline" className={small} onClick={() => setAll(true)}>全选</Button>
      <Button type="button" variant="outline" className={small} onClick={() => setAll(false)}>全不选</Button>
    </div>
    <div className="max-h-72 overflow-y-auto divide-y divide-border/40">
      {!shown.length && <p className="py-2 text-xs text-muted-foreground">{candidates.length ? `没有匹配「${query}」的模型。` : '暂无候选，点「读取聊天模型」拉取。'}</p>}
      {shown.map(id => { const on = selected.includes(id), r = state.results?.[id], failed = on && r && !r.ok;
        return <div key={id} className={'flex items-center gap-2 py-1 ' + (failed ? 'bg-red-500/10' : '')}>
          <input type="checkbox" checked={on} onChange={e => tick(id, e.target.checked)} aria-label={`使用 ${id}`} />
          <span onClick={() => tick(id, !on)} title={r?.text || id} className={'min-w-0 flex-1 truncate text-sm cursor-pointer ' + (failed ? 'text-red-500' : '')}>{CURATED.find(m => m.id === id)?.label || id} <span className="text-xs text-muted-foreground">{CURATED.find(m => m.id === id)?.price || id}{state.platform?.[id] === false ? ' · 平台未找到' : ''}</span></span>
          {on && <button type="button" disabled={busy} title={r ? r.text + (r.ok ? '' : '（点击重测）') : '尚未测试，点击测试'} onClick={() => onTest([id])} className={'w-6 h-6 rounded border text-xs ' + (r ? (r.ok ? 'text-green-600' : 'text-red-500 border-red-400') : 'text-muted-foreground')}>{r ? (r.ok ? '✓' : '✗') : '–'}</button>}
          {on && <><button type="button" aria-label="上移" onClick={() => move(id, -1)} className="w-6 h-6 rounded border flex items-center justify-center"><ArrowUp className="w-3 h-3" /></button><button type="button" aria-label="下移" onClick={() => move(id, 1)} className="w-6 h-6 rounded border flex items-center justify-center"><ArrowDown className="w-3 h-3" /></button></>}
        </div>; })}
    </div>
    {adding ? <div className="flex gap-1"><input value={newId} onChange={e => setNewId(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } }} placeholder="模型 ID" className="h-7 flex-1 min-w-0 rounded-md border border-input bg-transparent px-2 text-sm" /><Button type="button" variant="outline" className={small} onClick={addManual}>添加</Button></div> : <button type="button" className="text-xs text-muted-foreground" onClick={() => setAdding(true)}>+ 手动添加</button>}
  </div>;
}

// 后台自动测试已勾选但未测试的模型（迁移/首次启动后无需手动点测试）
let autoTesting = null;
export async function autoTestUntested() {
  if (autoTesting) return autoTesting;
  autoTesting = (async () => {
    const state = loadModelState();
    const todo = ids(state.selected).filter(id => !state.results?.[id]);
    if (!todo.length) return;
    const cfg = await (await fetch('/api/local/settings')).json();
    if (!cfg?.hasKey) return;
    const response = await fetch('/api/local/settings/test-models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: cfg.provider, baseUrl: cfg.baseUrl, apiKey: '', model: cfg.model || todo[0], modelGemini: cfg.modelGemini || '', modelGpt: cfg.modelGpt || '', modelClaude: cfg.modelClaude || '', models: todo }) });
    const data = await response.json();
    if (!response.ok) return;
    const latest = loadModelState(); const now = Date.now();
    for (const [id, r] of Object.entries(data.results || {})) latest.results[id] = { ...r, at: now };
    saveModelState(latest);
  })().catch(() => {}).finally(() => { autoTesting = null; });
  return autoTesting;
}
// 主页面「大模型」下拉：自动（=顺序第一个可用模型）+ 勾选且测试通过的模型（按勾选顺序）
export function useChatModelItems() {
  const read = () => { try { const st = loadModelState(); const c = ids(st.candidates); return ids(st.selected).filter(id => c.includes(id)).map(id => ({ id, r: st.results?.[id] })); } catch { return []; } };
  const [list, setList] = React.useState(read);
  const [defaultModel, setDefaultModel] = React.useState('gem-3.8-flash');
  React.useEffect(() => {
    const refresh = () => { setList(read()); fetch('/api/local/settings').then(r => r.json()).then(cfg => { if (cfg.model) setDefaultModel(cfg.model); }).catch(() => {}); };
    refresh();
    window.addEventListener('cine-models-changed', refresh); window.addEventListener('storage', refresh); window.addEventListener('focus', refresh);
    autoTestUntested().then(refresh);
    return () => { window.removeEventListener('cine-models-changed', refresh); window.removeEventListener('storage', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  const name = id => CURATED.find(m => m.id === id)?.label || id;
  const mark = r => (r ? (r.ok ? '' : ' ✗ 失败') : ' · 未测');
  const auto = defaultModel;
  return [{ key: 'automatic', label: auto ? `自动（${name(auto)}）` : '自动（默认模型）', short: '自动' }, ...list.map(({ id, r }) => ({ key: id, label: name(id) + mark(r), short: name(id) }))];
}
// 自动：第一个测试通过的；没有则第一个勾选的
function pickAutoModel(list) { return (list.find(x => x.r?.ok) || list[0])?.id || ''; }
export function autoModelId() { try { const st = loadModelState(); const c = ids(st.candidates); return pickAutoModel(ids(st.selected).filter(id => c.includes(id)).map(id => ({ id, r: st.results?.[id] }))); } catch { return ''; } }
