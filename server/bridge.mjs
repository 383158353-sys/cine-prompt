import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { uploadsDir } from './ai.mjs';

export const BRIDGE_HEADER = 'x-cine-bridge';
export const BRIDGE_ORIGINS = new Set([
  'com.local.lk888.psedit',
  'plugin://com.local.lk888.psedit',
  'uxp://com.local.lk888.psedit'
]);

const IMAGE_LIMIT = 14;
const IMAGE_BYTES_LIMIT = 14 * 1024 * 1024;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const EXTENSIONS = {png:'.png',jpeg:'.jpg',webp:'.webp'};
const sessions = new Map();
let eventSequence = 0;
let latestEvent = null;

function publish(session) {
  latestEvent = { sequence: ++eventSequence, sessionId: session.id, state: session.state };
}

function expireSession(session) {
  clearTimeout(session.expiryTimer);
  session.expiryTimer = setTimeout(async () => {
    sessions.delete(session.id);
    if(session.state==='waiting')session.reject(Object.assign(new Error('影词魔方联动已超时，请重新点击 PS 的优化按钮'),{status:504}));
    await Promise.allSettled((session.files || []).map(file => fs.unlink(file.path)));
  }, 15 * 60 * 1000);
  session.expiryTimer.unref?.();
}

export function bridgeActivity(after = 0) {
  return latestEvent && latestEvent.sequence > Number(after || 0)
    ? latestEvent
    : { sequence: eventSequence };
}

export function getBridgeSession(id) {
  const session = sessions.get(id);
  if (!session) throw Object.assign(new Error('联动会话已结束，请从 PS 再次点击优化'), {status:404});
  return {
    id:session.id,
    state:session.state,
    text:session.text,
    images:session.images,
    target:session.target,
    originalImageCount:session.images.length
  };
}

export function completeBridgeSession(input) {
  const session=sessions.get(input?.id);
  if(!session)throw Object.assign(new Error('联动会话已结束，请从 PS 再次点击优化'),{status:404});
  if(session.state!=='waiting')throw Object.assign(new Error('联动会话已经处理'),{status:409});
  const prompt=typeof input.prompt==='string'?input.prompt.trim():'';
  if(!prompt)throw Object.assign(new Error('优化结果为空，无法回传 PS'),{status:400});
  const availableImages=Math.max(0,6-session.images.length);
  if(Array.isArray(input.images) && input.images.length>availableImages)throw Object.assign(new Error(`PS 图片数量超限，还可添加 ${availableImages} 张；未回传，请减少图片后重试`),{status:400});
  const images=Array.isArray(input.images)?input.images.map((image,index)=>{
    if(!image || typeof image.data!=='string' || !DATA_URL.test(image.data) || image.data.length>14*1024*1024)throw Object.assign(new Error(`新增图片${index+1}格式无效或过大`),{status:400});
    return {name:String(image.name || `影词魔方新增图片${index+1}`).slice(0,150),data:image.data};
  }):[];
  const result={prompt,prompt_en:typeof input.prompt_en==='string'?input.prompt_en:'',prompt_zh:typeof input.prompt_zh==='string'?input.prompt_zh:'',images};
  session.state='complete';session.result=result;publish(session);expireSession(session);session.resolve(result);
  return {ok:true};
}

export function bridgeCors(origin) {
  if (!origin || !BRIDGE_ORIGINS.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Cine-Bridge',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  };
}

export function authorizeBridge(headers,{requireHeader=true}={}) {
  const origin = headers.origin || '';
  if (origin && !BRIDGE_ORIGINS.has(origin)) throw Object.assign(new Error('不允许此插件访问'), {status:403});
  if (requireHeader && headers[BRIDGE_HEADER] !== '1') throw Object.assign(new Error('缺少桥接认证头'), {status:403});
  return bridgeCors(origin);
}

export function parseBridgeImages(images) {
  if (!Array.isArray(images)) throw Object.assign(new Error('图片列表格式无效'), {status:400});
  if (images.length > IMAGE_LIMIT) throw Object.assign(new Error(`最多上传 ${IMAGE_LIMIT} 张图片`), {status:400});
  return images.map((image,index)=>{
    if (!image || typeof image.data !== 'string') throw Object.assign(new Error(`图片${index+1}格式无效`), {status:400});
    const match = DATA_URL.exec(image.data);
    if (!match) throw Object.assign(new Error(`图片${index+1}仅支持 PNG、JPEG 或 WebP`), {status:400});
    let bytes;
    try { bytes=Buffer.from(match[2],'base64'); } catch { throw Object.assign(new Error(`图片${index+1}编码无效`), {status:400}); }
    if (!bytes.length || bytes.length > IMAGE_BYTES_LIMIT) throw Object.assign(new Error(`图片${index+1}为空或超过 14MB`), {status:400});
    return {name:String(image.name || `图片${index+1}`).slice(0,200),bytes,extension:EXTENSIONS[match[1]]};
  });
}

export async function optimizeBridge(input) {
  const text=typeof input?.text === 'string' ? input.text.trim() : '';
  const images=parseBridgeImages(input?.images || []);
  if (!text && images.length===0) throw Object.assign(new Error('请先提供修改要求或图片'), {status:400});
  const purpose=input?.purpose === 'ps_local_edit' ? 'ps_local_edit' : 'generic';
  const target=typeof input?.target === 'string' && input.target.trim() ? input.target.trim() : 'generic_image';
  let resolveResult,rejectResult;
  const resultPromise=new Promise((resolve,reject)=>{resolveResult=resolve;rejectResult=reject;});
  const session={id:randomUUID(),state:'receiving',text,images:[],target,result:null,error:'',files:[],resolve:resolveResult,reject:rejectResult};
  sessions.set(session.id,session);
  expireSession(session);
  await fs.mkdir(uploadsDir,{recursive:true});
  const written=[];
  try {
    for (const image of images) {
      const filename=`${randomUUID()}${image.extension}`;
      await fs.writeFile(path.join(uploadsDir,filename),image.bytes);
      written.push({path:path.join(uploadsDir,filename),url:`/uploads/${filename}`});
    }
    session.files=written;
    session.images=written.map((file,index)=>({name:images[index].name,url:file.url}));
    session.state='waiting';
    publish(session);
    return await resultPromise;
  } catch(error) {
    if(session.state!=='complete'){session.state='error';session.error=error.message || '提示词优化失败';publish(session);expireSession(session);}
    throw error;
  }
}
