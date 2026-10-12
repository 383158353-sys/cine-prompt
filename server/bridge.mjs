import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { entity } from './local-client.mjs';
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
const PS_PREFIX = '这是 Photoshop 局部改图：图片1 是选区原图，只修改用户要求的部分，其余保持不变；图片2 起是参考图，请在提示词中用「图片N」引用；输出要简洁、可直接给生图模型执行，不要写分析过程。';

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

export async function optimizeBridge(input,{enhancePrompt,timeoutMs=90000}={}) {
  const text=typeof input?.text === 'string' ? input.text.trim() : '';
  const images=parseBridgeImages(input?.images || []);
  if (!text && images.length===0) throw Object.assign(new Error('请先提供修改要求或图片'), {status:400});
  const purpose=input?.purpose === 'ps_local_edit' ? 'ps_local_edit' : 'generic';
  const language=input?.language === 'en' ? 'en' : 'zh';
  const target=typeof input?.target === 'string' && input.target.trim() ? input.target.trim() : 'generic_image';
  const direction=typeof input?.direction === 'string' && input.direction.trim() ? input.direction.trim() : 'bridge_auto';
  await fs.mkdir(uploadsDir,{recursive:true});
  const written=[];
  try {
    for (const image of images) {
      const filename=`${randomUUID()}${image.extension}`;
      await fs.writeFile(path.join(uploadsDir,filename),image.bytes);
      written.push({path:path.join(uploadsDir,filename),url:`/uploads/${filename}`});
    }
    const requestData={mode:'enhance',raw_input:text || '根据图片完成局部修改',file_urls:written.map(file=>file.url),target,direction};
    if (purpose === 'ps_local_edit') requestData.system_prompt=PS_PREFIX;
    const response=await Promise.race([
      enhancePrompt(new Request('http://127.0.0.1/api/bridge/optimize',{method:'POST',body:JSON.stringify(requestData)})),
      new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Object.assign(new Error('优化等待超时，请稍后重试'),{status:504})),timeoutMs);timer.unref?.();})
    ]);
    const result=await response.json();
    if (!response.ok || result?.error) throw Object.assign(new Error(result?.error || '提示词优化失败'),{status:response.status || 500});
    const history=await entity('Prompt').create({
      title:result.title || text.slice(0,20) || 'PS 局部改图',
      raw_input:text,
      content:result.enhanced_prompt || '',
      content_zh:result.enhanced_prompt_zh || '',
      category:result.category || '综合提示',
      direction:result.direction || direction,
      rating:3,
      tags:result.tags || [],
      source:purpose === 'ps_local_edit' ? 'ps' : 'bridge',
      context:{purpose,target,language,file_urls:written.map(file=>file.url)}
    });
    return {
      prompt:language === 'en' ? (result.enhanced_prompt || result.enhanced_prompt_zh || '') : (result.enhanced_prompt_zh || result.enhanced_prompt || ''),
      prompt_en:result.enhanced_prompt || '',
      prompt_zh:result.enhanced_prompt_zh || '',
      negative:result.negative_prompt || '',
      title:result.title || '',
      history_id:history.id
    };
  } catch(error) {
    if (!error.status || error.status >= 500) await Promise.allSettled(written.map(file=>fs.unlink(file.path)));
    throw error;
  }
}
