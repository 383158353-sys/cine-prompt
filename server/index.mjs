import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { entity, localUser, withMemoryDatabase } from './local-client.mjs';
import { config, uploadsDir, uploadPath, withSettings, currentConfig } from './ai.mjs';
import { publicSettings, saveSettings, testSettings, listModels, testModels, validateSettings } from './settings.mjs';
import { authorizeBridge, bridgeActivity, bridgeCors, completeBridgeSession, getBridgeSession, optimizeBridge } from './bridge.mjs';
import { sanitizeDatabase, changedRows } from '../shared/web-database.mjs';

const FUNCTION_NAMES = ['enhancePrompt','analyzeStyleImage','analyzeColorPalette','generateStyleThumbnails','parseStoryboard'];
const publicWeb = process.env.CINE_PUBLIC_WEB === '1';
async function loadFunctions() {
  const functions = {};
  if (process.env.CINE_USE_PREBUILT === '1') {
    for (const name of FUNCTION_NAMES) functions[name] = (await import(`./runtime/${name}.mjs`)).default;
    return functions;
  }
  const { transform } = await import('esbuild');
  for (const name of FUNCTION_NAMES) {
    const source = await fs.readFile(new URL(`./functions/${name}.ts`, import.meta.url), 'utf8');
    const code = (await transform(source, {loader:'ts',format:'esm',target:'node22'})).code;
    const output = new URL(`./.${name}.mjs`, import.meta.url);
    await fs.writeFile(output, code);
    functions[name] = (await import(output.href)).default;
  }
  return functions;
}
export const ready = loadFunctions();
const dev = process.argv.includes('--dev');
const vite = dev ? await (await import('vite')).then(({createServer}) => createServer({server:{middlewareMode:true},appType:'spa'})) : null;
const port = Number(config.PORT) || 5173;
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
async function body(req) {
  const chunks = []; let size=0;
  const limit = publicWeb ? 4_200_000 : 26*1024*1024;
  for await (const chunk of req) {size+=chunk.length; if(size>limit) throw Object.assign(new Error(publicWeb ? '这次请求太大。请减少参考图数量后再试。' : '应用入口请求超过 26MB（含上传封装）'), {status:413}); chunks.push(chunk);}
  if(config.AI_REQUEST_DIAGNOSTICS === '1') console.info(JSON.stringify({stage:'application-ingress',requestBytes:size}));
  return Buffer.concat(chunks);
}
function json(res, value, status=200) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function bridgeJson(req,res,value,status=200) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...bridgeCors(req.headers.origin || '')});res.end(JSON.stringify(value));}
function readClientSettings(req) {
  const raw = req.headers['x-cine-settings'];
  if (typeof raw !== 'string' || !raw) throw Object.assign(new Error('请先在 API 设置中填写自己的 API Key'), {status:401});
  let input;
  try { input = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
  catch { throw Object.assign(new Error('API 设置无效，请重新保存'), {status:400}); }
  return validateSettings({ ...input, apiKey: String(input.apiKey || ''), model: String(input.model || ''), baseUrl: String(input.baseUrl || ''), provider: String(input.provider || '') });
}
export async function handleRequest(req, res) {
  try {
    const functions = await ready;
    const host = req.headers.host || '';
    if (!publicWeb && ![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) return json(res,{error:'仅允许本机访问'},403);
    if (publicWeb && req.headers.origin) {
      let originHost = '';
      try { originHost = new URL(req.headers.origin).host; } catch { return json(res,{error:'不允许跨站请求'},403); }
      if (originHost !== host) return json(res,{error:'不允许跨站请求'},403);
    }
    const url = new URL(req.url, `http://${host || 'localhost'}`);
    if(url.pathname.startsWith('/api/bridge/')) {
      if (publicWeb) return json(res,{error:'Photoshop 桥接只在本机安装版里可用'},404);
      try {
        const cors=authorizeBridge(req.headers,{requireHeader:req.method!=='OPTIONS'});
        if(req.method==='OPTIONS'){res.writeHead(204,{'Cache-Control':'no-store',...cors});return res.end();}
        if(url.pathname==='/api/bridge/health' && req.method==='GET') return bridgeJson(req,res,{ok:true,version:'1.0.0',model:publicSettings().model || ''});
        if(url.pathname==='/api/bridge/activity' && req.method==='GET') return bridgeJson(req,res,bridgeActivity(url.searchParams.get('after')));
        if(url.pathname==='/api/bridge/optimize' && req.method==='POST') {
          if(!req.headers['content-type']?.startsWith('application/json')) return bridgeJson(req,res,{error:'需要 JSON 请求'},415);
          const input=JSON.parse((await body(req)).toString());
          return bridgeJson(req,res,await optimizeBridge(input));
        }
        return bridgeJson(req,res,{error:'桥接接口不存在'},404);
      } catch(error) {return bridgeJson(req,res,{error:error.message || '桥接请求失败'},error.status || 400);}
    }
    if (!publicWeb && req.headers.origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin)) return json(res,{error:'不允许跨站请求'},403);
    if(url.pathname.startsWith('/api/local/voice/') && ['GET','POST'].includes(req.method)) {
      const action=url.pathname.slice('/api/local/voice/'.length);
      if(!['health','start','status','stop'].includes(action)) return json(res,{error:'语音接口不存在'},404);
      if (publicWeb) return json(res,{state:'off',message:'网页版使用浏览器语音输入。本机中文语音助手在 Windows 安装包里。'});
      const target=new URL(`http://127.0.0.1:17402/${action}`);
      if(action==='status'||action==='stop') {
        for(const key of ['id','cursor'])if(url.searchParams.has(key))target.searchParams.set(key,url.searchParams.get(key));
      }
      try {
        const upstream=await fetch(target,{method:req.method,headers:{'X-PS-Local-Voice':'1'},signal:AbortSignal.timeout(5000)});
        return json(res,await upstream.json(),upstream.status);
      } catch {return json(res,{message:'本机中文语音服务未启动。请重新启动影词魔方。'},503);}
    }
    if(url.pathname==='/api/local/bridge-session' && req.method==='GET') return json(res,publicWeb ? {error:'Photoshop 桥接只在本机安装版里可用'} : getBridgeSession(url.searchParams.get('id')), publicWeb ? 404 : 200);
    if(url.pathname==='/api/local/bridge-session/complete' && req.method==='POST') {
      if (publicWeb) return json(res,{error:'Photoshop 桥接只在本机安装版里可用'},404);
      if(!req.headers['content-type']?.startsWith('application/json')) return json(res,{error:'需要 JSON 请求'},415);
      return json(res,completeBridgeSession(JSON.parse((await body(req)).toString())));
    }
    if(url.pathname==='/api/local/settings' && req.method==='GET') return json(res,publicSettings());
    if(['/api/local/settings','/api/local/settings/test','/api/local/settings/models','/api/local/settings/test-models'].includes(url.pathname) && req.method==='POST') {
      if(!req.headers['content-type']?.startsWith('application/json')) return json(res,{error:'需要 JSON 请求'},415);
      const input=JSON.parse((await body(req)).toString());
      const result=url.pathname.endsWith('/test-models') ? await testModels(input) : url.pathname.endsWith('/test') ? await testSettings(input) : url.pathname.endsWith('/models') ? await listModels(input) : await saveSettings(input);
      return json(res,result);
    }
    if(url.pathname==='/api/local/user' && req.method==='GET') return json(res,localUser);
    if(url.pathname==='/api/local/upload' && req.method==='POST') {
      const data = await body(req);
      const form = await new Request(`http://${host || 'localhost'}`,{method:'POST',headers:{'content-type':req.headers['content-type']},body:data}).formData();
      const file = form.get('file');
      if(!file || typeof file.arrayBuffer!=='function') throw new Error('缺少文件');
      const ext = path.extname(file.name).toLowerCase();
      if(!['.png','.jpg','.jpeg','.webp','.gif','.csv','.xlsx','.txt'].includes(ext)) throw new Error('不支持此文件格式');
      await fs.mkdir(uploadsDir,{recursive:true}); const name=`${randomUUID()}${ext}`;
      await fs.writeFile(path.join(uploadsDir,name),Buffer.from(await file.arrayBuffer()));
      return json(res,{file_url:`/uploads/${name}`});
    }
    if(url.pathname==='/api/local/rpc' && req.method==='POST') {
      if(!req.headers['content-type']?.startsWith('application/json')) return json(res,{error:'需要 JSON 请求'},415);
      const input = JSON.parse((await body(req)).toString());
      if(input.kind==='entity') {
        if (publicWeb) return json(res,{error:'网页版的历史和风格库保存在这台浏览器中'},400);
        if(!['list','filter','get','create','bulkCreate','update','delete'].includes(input.action)) throw new Error('未知操作');
        return json(res,await entity(input.name)[input.action](...(input.args || [])));
      }
      if(input.kind==='function' && Object.hasOwn(functions,input.name)) {
        const payload = JSON.stringify(input.data || {});
        const invoke = () => functions[input.name](new Request(`http://${host || 'localhost'}`,{method:'POST',body:payload,headers:{'content-type':'application/json'}}));
        if (!publicWeb) {
          const result = await invoke();
          return json(res,await result.json(),result.status);
        }
        const settings = readClientSettings(req);
        const database = sanitizeDatabase(input.database);
        const before = structuredClone(database);
        const executed = await withSettings(settings, () => withMemoryDatabase(database, async () => {
          const result = await invoke();
          return {status:result.status, body:await result.json()};
        }));
        const updates = changedRows(before, database);
        if (updates.length && executed.body && typeof executed.body === 'object' && !Array.isArray(executed.body)) executed.body._localUpdates = updates;
        return json(res, executed.body, executed.status);
      }
      return json(res,{error:'未知调用'},404);
    }
    if(url.pathname.startsWith('/api/')) return json(res,{error:'接口不存在'},404);
    if(url.pathname.startsWith('/uploads/')) {
      const file=uploadPath(url.pathname); const data=await fs.readFile(file);
      res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','X-Content-Type-Options':'nosniff'});return res.end(data);
    }
    if(vite) return vite.middlewares(req,res);
    const root=path.resolve(process.env.CINE_APP_ROOT || '.', 'dist');
    const file=path.resolve(root,`.${decodeURIComponent(url.pathname)}`);
    if(!file.startsWith(root+path.sep) && file!==root) return json(res,{error:'无效路径'},400);
    let data, target=file;
    try {data=await fs.readFile(file);} catch {target=path.join(root,'index.html');data=await fs.readFile(target);}
    res.writeHead(200,{'Content-Type':types[path.extname(target)] || 'application/octet-stream'});res.end(data);
  } catch(e) {
    const secret = currentConfig().AI_API_KEY;
    const message = e.code ? '本地文件操作失败' : (e.message || '请求失败');
    json(res,{error:secret ? message.replaceAll(secret,'[redacted]') : message},e.status || 400);
  }
}
const server = http.createServer(handleRequest);
const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  ready.catch(error => { console.error(error); process.exit(1); });
  server.listen(port,'127.0.0.1',()=>console.log(`影词模方：http://127.0.0.1:${port}`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await vite?.close();server.close();process.exit(0);});
}
