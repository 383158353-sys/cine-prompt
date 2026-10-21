import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import BrandLogo from '@/components/BrandLogo';
import ChatModelPicker from '@/components/ChatModelPicker';
import ChatModelManager, { loadModelState, saveModelState, usableModels } from '@/components/ChatModelManager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Settings() {
  const [provider,setProvider]=useState('compatible');
  const [baseUrl,setBaseUrl]=useState('');
  const [model,setModel]=useState('');
  const [modelGemini,setModelGemini]=useState('');
  const [modelGpt,setModelGpt]=useState('');
  const [modelClaude,setModelClaude]=useState('');
  const [modelState,setModelState]=useState(()=>loadModelState());
  const models=usableModels(modelState);
  const [apiKey,setApiKey]=useState('');
  const [hasKey,setHasKey]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    fetch('/api/local/settings').then(async response=>{
      const data=await response.json();
      if(!response.ok) throw new Error(data.error || '配置加载失败');
      if(active){setProvider(data.provider);setBaseUrl(data.baseUrl);setModel(data.model);setModelGemini(data.modelGemini || '');setModelGpt(data.modelGpt || '');setModelClaude(data.modelClaude || '');setHasKey(data.hasKey);}
    }).catch(()=>{if(active)setError('配置加载失败，请确认本地服务已更新并启动');}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[]);
  async function testTicked(ids) {
    setBusy('test-models');setNotice('');setError('');
    try {
      const response=await fetch('/api/local/settings/test-models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,baseUrl,apiKey,model:model||ids[0],modelGemini,modelGpt,modelClaude,models:ids})});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error || '测试失败');
      setModelState(prev=>{const now=Date.now();const results={...prev.results};for(const [id,r] of Object.entries(data.results||{}))results[id]={...r,at:now};const next={...prev,results};saveModelState(next);return next;});
      const list=Object.values(data.results||{});const ok=list.filter(r=>r.ok).length;
      if(ok<list.length) setError(`已测试 ${list.length} 个：通过 ${ok} 个，失败 ${list.length-ok} 个（标红，可重测）。`); else setNotice(`已测试 ${list.length} 个模型，全部通过，已加入模型下拉。`);
    } catch(e) {setError(e.message || '无法连接本地服务');} finally {setBusy('');}
  }
  async function submit(action) {
    setBusy(action);setNotice('');setError('');
    try {
      const suffix=action==='test'?'/test':action==='models'?'/models':'';
      const response=await fetch(`/api/local/settings${suffix}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,baseUrl,apiKey,model,modelGemini,modelGpt,modelClaude})});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error || '操作失败');
      if(action==='save'){setApiKey('');setHasKey(data.hasKey);setBaseUrl(data.baseUrl);setModel(data.model);setNotice('设置已保存并立即生效。');}
      else if(action==='models'){const list=(data.models||[]).map(x=>typeof x==='string'?x:(x?.id||x?.name||'')).filter(Boolean);const prev=modelState;const platform={};for(const id of prev.candidates)platform[id]=list.includes(id);const next={...prev,platform};saveModelState(next);setModelState(next);const found=prev.candidates.filter(id=>platform[id]).length;setNotice(`连接成功：推荐的 ${prev.candidates.length} 个模型中平台有 ${found} 个，已勾选 ${prev.selected.length} 个。`);}
      else setNotice(data.message+' 测试不会保存修改。');
    } catch(e) {setError(e.message || '无法连接本地服务');} finally {setBusy('');}
  }
  return <div className="min-h-screen bg-background">
    <header className="border-b border-border/40"><div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between"><BrandLogo size={38} titleClass="font-semibold text-lg"/><Link to="/" className="flex items-center gap-2 text-sm"><ArrowLeft className="w-4 h-4"/>返回首页</Link></div></header>
    <main className="max-w-xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold">API 设置</h1>
      <p className="text-sm text-muted-foreground mt-2 mb-7">配置用于提示词生成的模型接口。</p>
      <form className="space-y-5" onSubmit={event=>{event.preventDefault();submit('save');}}>
        <fieldset disabled={loading || !!busy} className="space-y-5 disabled:opacity-60">
          <div className="space-y-2"><Label htmlFor="provider">API 类型</Label><select id="provider" value={provider} onChange={e=>{const value=e.target.value;setProvider(value);setBaseUrl(value==='gemini'?'https://generativelanguage.googleapis.com/v1beta':'https://api.lingkeai.ai/api/v1');}} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"><option value="compatible">OpenAI 兼容 / 聚合平台</option><option value="gemini">Gemini 官方 API</option></select></div>
          {provider==='compatible'&&<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={()=>{setBaseUrl('https://api.lk888.ai/v1');}}>使用 LK888 地址</Button><Button type="button" variant="outline" onClick={()=>{setBaseUrl('https://api.lingkeai.ai/api/v1');}}>使用 LingkeAI 地址</Button></div>}
          <div className="space-y-2"><Label htmlFor="base-url">Base URL</Label><Input id="base-url" type="url" required value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder={provider==='gemini'?'https://generativelanguage.googleapis.com/v1beta':'https://api.lk888.ai/v1'}/><p className="text-xs text-muted-foreground">{provider==='gemini'?'Google 官方地址，程序会自动调用 models/{模型}:generateContent。':'填写接口根地址，不要附加 /chat/completions；LK888 缺少 /v1 时会自动补齐。'}</p></div>
          <div className="space-y-2"><Label htmlFor="api-key">API Key</Label><Input id="api-key" type="password" autoComplete="new-password" spellCheck={false} value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={hasKey?'已保存密钥；留空保留，填写可替换':'填写你的 API Key'}/><p className="text-xs text-muted-foreground">密钥保存在本机 .env.local，不会回显。更换地址时请重新填写密钥。</p></div>
          <div className="space-y-2"><div className="flex items-center justify-between"><Label htmlFor="model">默认模型</Label><Button type="button" size="sm" variant="outline" onClick={()=>submit('models')}>{busy==='models'&&<Loader2 className="w-4 h-4 animate-spin mr-2"/>}读取聊天模型</Button></div><ChatModelPicker id="model" models={models} required value={model} onChange={setModel} placeholder={provider==='gemini'?'gemini-3.1-flash-lite':'先读取模型列表，再选择模型'}/><p className="text-xs text-muted-foreground">{provider==='gemini'?'推荐使用稳定模型 gemini-3.1-flash-lite。':'“自动”按钮使用此模型。优先选择名称含 flash-lite、mini、nano、haiku 或 deepseek-chat 的低价文本/视觉模型。'}</p></div>
          <ChatModelManager state={modelState} setState={setModelState} onTest={testTicked} busy={busy==='test-models'}/>
          {provider==='compatible'&&<div className="rounded-lg border border-border/60 p-4 space-y-4"><p className="text-sm font-medium">原网页模型按钮（可选）</p><div className="space-y-2"><Label htmlFor="model-gemini">Gemini 按钮</Label><ChatModelPicker id="model-gemini" models={models} value={modelGemini} onChange={setModelGemini} placeholder="留空则使用默认模型"/></div><div className="space-y-2"><Label htmlFor="model-gpt">GPT 按钮</Label><ChatModelPicker id="model-gpt" models={models} value={modelGpt} onChange={setModelGpt} placeholder="留空则使用默认模型"/></div><div className="space-y-2"><Label htmlFor="model-claude">Claude 按钮</Label><ChatModelPicker id="model-claude" models={models} value={modelClaude} onChange={setModelClaude} placeholder="留空则使用默认模型"/></div></div>}
          <div className="flex gap-3"><Button type="submit">{busy==='save'&&<Loader2 className="w-4 h-4 animate-spin mr-2"/>}保存设置</Button><Button type="button" variant="outline" onClick={()=>submit('test')}>{busy==='test'&&<Loader2 className="w-4 h-4 animate-spin mr-2"/>}测试连接</Button></div>
        </fieldset>
        <p className="text-xs text-muted-foreground">测试会使用当前填写的配置发出一次简短请求，可能产生少量 API 用量。</p>
        {loading&&<p role="status" className="text-sm">正在读取配置…</p>}
        {notice&&<p role="status" className="text-sm text-green-700">{notice}</p>}
        {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>
    </main>
  </div>;
}
