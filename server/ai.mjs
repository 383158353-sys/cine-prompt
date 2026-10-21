import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnv } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { modelImage } from './model-image.mjs';
import { normalizeApiBaseUrl } from './api-url.mjs';

const appRoot = process.env.CINE_APP_ROOT || process.cwd();
const settingsFile = process.env.CINE_SETTINGS_FILE || path.resolve('.env.local');
const env = { ...loadEnv('development', appRoot, ''), ...(existsSync(settingsFile) ? parseEnv(readFileSync(settingsFile, 'utf8')) : {}), ...process.env };
export const dataDir = path.resolve(env.LOCAL_DATA_DIR || 'local-data');
export const uploadsDir = path.join(dataDir, 'uploads');
export const config = env;
const mime = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' };
export function uploadPath(url) {
  if (!/^\/uploads\/[a-zA-Z0-9-]+\.[a-zA-Z0-9]+$/.test(url)) throw new Error('无效的本地文件地址');
  return path.join(uploadsDir, path.basename(url));
}
export async function imageUrl(url, maxBytes = 750_000) {
  if (url.startsWith('/uploads/')) {
    const file = uploadPath(url);
    if (!mime[path.extname(file)]) throw new Error('视觉输入需要 PNG/JPEG/WebP/GIF 图片');
    return modelImage(await fs.readFile(file), mime[path.extname(file)], maxBytes);
  }
  const inline = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (inline) return modelImage(Buffer.from(inline[2], 'base64'), inline[1], maxBytes);
  if (/^https:\/\//.test(url)) return url;
  throw new Error('不支持的图片地址');
}
export function selectModel(requested) {
  const value = String(requested || '').trim();
  // 旧版按钮键（Gemini/GPT/Claude）仍映射到设置里的对应模型；其他非“自动”的值视为用户勾选的真实模型 ID
  const legacy = {gemini_3_flash:'GEMINI',gpt_5_mini:'GPT',claude_sonnet_4_6:'CLAUDE',gemini:'GEMINI',gpt:'GPT',claude:'CLAUDE'}[value.toLowerCase()];
  if (!legacy && value && value !== 'automatic' && /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,199}$/.test(value)) return value;
  const model = (legacy && env[`AI_MODEL_${legacy}`]) || env.AI_MODEL;
  if (!model) throw new Error('请在 API 设置页面填写模型名称');
  return model;
}
function geminiRequest(body) {
  const systemText = body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
  const contents = body.messages.filter(message => message.role !== 'system').map(message => {
    const source = Array.isArray(message.content) ? message.content : [{type:'text', text:String(message.content || '')}];
    const parts = source.map(part => {
      if (part.type === 'text') return {text:part.text};
      if (part.type === 'image_url') {
        const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(part.image_url?.url || '');
        if (!match) throw new Error('Gemini 官方接口的参考图必须先上传到本地应用');
        return {inlineData:{mimeType:match[1],data:match[2]}};
      }
      throw new Error('Gemini 官方接口收到不支持的输入类型');
    });
    return {role:message.role === 'assistant' ? 'model' : 'user',parts};
  });
  const request = {contents};
  if (systemText) request.systemInstruction = {parts:[{text:systemText}]};
  if (body.response_format?.type === 'json_object') request.generationConfig = {responseMimeType:'application/json'};
  return request;
}
export async function upstream(endpoint, body, settings = env) {
  const provider = settings.AI_PROVIDER || 'compatible';
  if (!['compatible','gemini'].includes(provider)) throw new Error('不支持的 API 类型');
  if (!settings.AI_API_KEY) throw new Error('请在 API 设置页面填写 API Key');
  const baseUrl = normalizeApiBaseUrl(settings.AI_BASE_URL || (provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.lingkeai.ai/api/v1'));
  const isGemini = provider === 'gemini';
  if (isGemini && endpoint !== '/chat/completions') throw new Error('Gemini 官方模式暂不支持此图片生成操作');
  const requestUrl = isGemini ? `${baseUrl}/models/${encodeURIComponent(body.model)}:generateContent` : `${baseUrl}${endpoint}`;
  const requestBody = isGemini ? geminiRequest(body) : body;
  const serialized = JSON.stringify(requestBody);
  const requestBytes = Buffer.byteLength(serialized);
  const maxBytes = Number(settings.AI_MAX_REQUEST_BYTES) || 4_000_000;
  if (requestBytes > maxBytes) throw new Error(`AI 请求发送前超过预算（${requestBytes} bytes / ${maxBytes} bytes），请减少图片或文本；原图未修改`);
  let response;
  try {
    response = await fetch(requestUrl, {
      method: 'POST', headers: isGemini ? {'x-goog-api-key':settings.AI_API_KEY,'Content-Type':'application/json'} : {Authorization:`Bearer ${settings.AI_API_KEY}`,'Content-Type':'application/json'},
      body: serialized, signal: AbortSignal.timeout(Number(settings.AI_TIMEOUT_MS) || 180000)
    });
  } catch { throw new Error('AI 网络连接失败或超时，请检查地址和网络'); }
  // Never forward provider bodies: some gateways echo credentials or request headers.
  if (settings.AI_REQUEST_DIAGNOSTICS === '1' || response.status === 413) {
    console.info(JSON.stringify({stage:'upstream-ai',requestBytes,status:response.status}));
  }
  if (response.status === 413) throw new Error(`上游 AI API 返回 HTTP 413（请求 ${requestBytes} bytes），已通过应用入口；请核查上游网关请求体限制`);
  if (!response.ok) throw new Error(`AI 请求失败（HTTP ${response.status}）。请检查密钥、余额、模型名称和模型能力`);
  let result;
  try { result = await response.json(); } catch { throw new Error('AI 返回了非 JSON 响应，请检查 API 地址'); }
  if (!isGemini) return result;
  const candidate = result.candidates?.[0];
  const content = candidate?.content?.parts?.map(part => part.text || '').join('') || '';
  return {choices:[{finish_reason:candidate?.finishReason === 'MAX_TOKENS' ? 'length' : 'stop',message:{content}}]};
}
export function parseJson(content, schema) {
  let value;
  try { value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new Error('模型未返回有效 JSON，请重试或更换支持结构化输出的模型'); }
  validate(value, schema);
  return value;
}
function validate(value, schema) {
  if (!schema) return;
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (schema.type && type !== schema.type && !(schema.type === 'integer' && Number.isInteger(value))) throw new Error('模型返回的数据类型不符合要求');
  if (type === 'object') {
    for (const key of schema.required || []) if (!(key in value)) throw new Error(`模型输出缺少字段：${key}`);
    for (const [key, child] of Object.entries(schema.properties || {})) if (key in value) validate(value[key], child);
  }
  if (type === 'array' && schema.items) value.forEach(item => validate(item, schema.items));
}
export async function InvokeLLM({ prompt, file_urls = [], response_json_schema, model }) {
  const content = [{ type:'text', text:prompt }];
  const imageBudget = Math.min(750_000, Math.floor(2_700_000 / Math.max(1, file_urls.length)));
  for (const url of file_urls) content.push({ type:'image_url', image_url:{url: await imageUrl(url, imageBudget)} });
  const messages = [];
  if (response_json_schema) messages.push({role:'system', content:`Return only valid JSON matching this schema. Do not use Markdown fences.\n${JSON.stringify(response_json_schema)}`});
  messages.push({role:'user', content: file_urls.length ? content : prompt});
  const body = {model:selectModel(model), messages, stream:false};
  if (response_json_schema && env.AI_JSON_MODE === 'json_object') body.response_format = {type:'json_object'};
  const result = await upstream('/chat/completions', body);
  const choice = result.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('模型输出被截断，请提高平台输出上限或更换模型');
  const text = choice?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('API 返回格式不兼容：缺少 choices[0].message.content');
  return response_json_schema ? parseJson(text, response_json_schema) : text;
}
export async function GenerateImage({prompt}) {
  if (!env.AI_IMAGE_MODEL) throw new Error('生成缩略图需要设置 AI_IMAGE_MODEL');
  const result = await upstream('/images/generations', {model:env.AI_IMAGE_MODEL, prompt, n:1});
  const item = result.data?.[0];
  if (item?.b64_json) {
    await fs.mkdir(uploadsDir, {recursive:true});
    const name = `${randomUUID()}.png`;
    await fs.writeFile(path.join(uploadsDir, name), Buffer.from(item.b64_json, 'base64'));
    return {url:`/uploads/${name}`};
  }
  if (item?.url && /^https:\/\//.test(item.url)) return {url:item.url};
  throw new Error('图片 API 未返回可用图片');
}
