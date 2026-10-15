import { chatModelIds } from './chat-models.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, upstream } from './ai.mjs';
import { normalizeApiBaseUrl } from './api-url.mjs';

export function publicSettings() {
  const provider = /generativelanguage\.googleapis\.com/i.test(config.AI_BASE_URL || '') ? 'gemini' : (config.AI_PROVIDER || 'compatible');
  return {provider,baseUrl:normalizeApiBaseUrl(config.AI_BASE_URL || (provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.lingkeai.ai/api/v1')),model:config.AI_MODEL || '',modelGemini:config.AI_MODEL_GEMINI || '',modelGpt:config.AI_MODEL_GPT || '',modelClaude:config.AI_MODEL_CLAUDE || '',hasKey:!!config.AI_API_KEY};
}
export function validateSettings(input) {
  if (!input || typeof input.provider !== 'string' || typeof input.baseUrl !== 'string' || typeof input.model !== 'string' || typeof input.apiKey !== 'string') throw new Error('请填写 API 类型、地址、密钥和模型名称');
  const provider=input.provider.trim();
  if (!['compatible','gemini'].includes(provider)) throw new Error('请选择正确的 API 类型');
  const baseUrl=normalizeApiBaseUrl(input.baseUrl);
  let url;
  try {url=new URL(baseUrl);} catch {throw new Error('Base URL 格式不正确');}
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Base URL 只能是 HTTP(S) 接口地址，不能包含密码、查询参数或片段');
  if (url.protocol==='http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('远程 API 请使用 HTTPS 地址');
  const model=input.model.trim(), enteredKey=input.apiKey.trim();
  const optionalModels = [input.modelGemini,input.modelGpt,input.modelClaude].map(value => typeof value === 'string' ? value.trim() : '');
  if (!model || [model,...optionalModels].some(value => value.length>200) || /[\r\n\0]/.test(model+optionalModels.join('')+enteredKey) || enteredKey.length>4096) throw new Error('模型名称或密钥格式不正确');
  const current=publicSettings();
  if (!enteredKey && (baseUrl!==normalizeApiBaseUrl(current.baseUrl) || provider!==current.provider)) throw new Error('更换 API 类型或地址时请重新填写对应密钥');
  const apiKey=enteredKey || config.AI_API_KEY;
  if (!apiKey) throw new Error('请填写 API Key');
  if (provider === 'gemini' && !/generativelanguage\.googleapis\.com$/i.test(url.hostname)) throw new Error('Gemini 官方模式请使用 Google 官方 Base URL');
  return {AI_BASE_URL:baseUrl,AI_MODEL:model,AI_MODEL_GEMINI:optionalModels[0],AI_MODEL_GPT:optionalModels[1],AI_MODEL_CLAUDE:optionalModels[2],AI_API_KEY:apiKey,AI_PROVIDER:provider};
}
let saveQueue=Promise.resolve();
export function saveSettings(input, file=process.env.CINE_SETTINGS_FILE || path.resolve('.env.local')) {
  const values=validateSettings(input);
  const operation=saveQueue.then(async()=>{
    let original='';
    try {original=await fs.readFile(file,'utf8');} catch(e) {if(e.code!=='ENOENT') throw new Error('无法读取本地配置');}
    const keys=Object.keys(values);
    const lines=original.split(/\r?\n/).filter(line=>!keys.some(key=>new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line)));
    const content=lines.join('\n').trimEnd()+'\n'+keys.map(key=>`${key}=${JSON.stringify(values[key])}`).join('\n')+'\n';
    try {await fs.writeFile(file+'.tmp',content,{mode:0o600});await fs.rename(file+'.tmp',file);} catch {throw new Error('无法保存 .env.local，请检查文件写入权限');}
    Object.assign(config,values);
    return publicSettings();
  });
  saveQueue=operation.catch(()=>{});
  return operation;
}
export async function testSettings(input) {
  const values=validateSettings(input);
  const result=await upstream('/chat/completions',{model:values.AI_MODEL,messages:[{role:'user',content:'Reply OK.'}],stream:false},{...config,...values,AI_TIMEOUT_MS:20000});
  if(typeof result.choices?.[0]?.message?.content!=='string' || !result.choices[0].message.content.trim()) throw new Error('返回格式不兼容：未收到有效的聊天回复');
  return {message:'连接成功，模型已返回有效回复。此测试仅验证文本连接。'};
}
export async function listModels(input) {
  const values=validateSettings({...input,model:input.model || config.AI_MODEL || 'model-list'});
  const baseUrl=values.AI_BASE_URL.replace(/\/+$/,'');
  let response;
  try {
    response=await fetch(`${baseUrl}/models`,{headers:values.AI_PROVIDER==='gemini'?{'x-goog-api-key':values.AI_API_KEY}:{Authorization:`Bearer ${values.AI_API_KEY}`},signal:AbortSignal.timeout(20000)});
  } catch {throw new Error('模型列表读取失败：无法连接 API 地址');}
  if(!response.ok) throw new Error(`模型列表读取失败（HTTP ${response.status}），请检查地址和密钥`);
  let result;
  try {result=await response.json();} catch {throw new Error('模型列表返回格式不正确');}
  const source=Array.isArray(result.data)?result.data:Array.isArray(result.models)?result.models:[];
  const models=chatModelIds(source);
  if(!models.length) throw new Error('接口已连接，但没有读取到可用的聊天模型；可手动填写模型 ID');
  return {models:models.slice(0,1000)};
}
