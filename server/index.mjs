import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { transform } from 'esbuild';
import { entity, localUser } from './local-client.mjs';
import { config, uploadsDir, uploadPath } from './ai.mjs';

import { publicSettings, saveSettings, testSettings, listModels } from './settings.mjs';
import { authorizeBridge, bridgeActivity, bridgeCors, completeBridgeSession, getBridgeSession, optimizeBridge } from './bridge.mjs';

const functions = {};
for (const name of ['enhancePrompt','analyzeStyleImage','generateStyleThumbnails','parseStoryboard']) {
  const source = await fs.readFile(new URL(`./functions/${name}.ts`, import.meta.url), 'utf8');
  const code = (await transform(source, {loader:'ts',format:'esm',target:'node22'})).code;
  // Transpile beside the runtime adapter so relative imports resolve normally.
  const output = new URL(`./.${name}.mjs`, import.meta.url);
  await fs.writeFile(output, code);
  functions[name] = (await import(output.href)).default;
}
const dev = process.argv.includes('--dev');
const vite = dev ? await createViteServer({server:{middlewareMode:true},appType:'spa'}) : null;
const port = Number(config.PORT) || 5173;
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
async function body(req) {
  const chunks = []; let size=0;
  for await (const chunk of req) {size+=chunk.length; if(size>26*1024*1024) throw Object.assign(new Error('应用入口请求超过 26MB（含上传封装）'), {status:413}); chunks.push(chunk);}
  if(config.AI_REQUEST_DIAGNOSTICS === '1') console.info(JSON.stringify({stage:'application-ingress',requestBytes:size}));
  return Buffer.concat(chunks);
}
function json(res, value, status=200) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function bridgeJson(req,res,value,status=200) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...bridgeCors(req.headers.origin || '')});res.end(JSON.stringify(value));}
const server = http.createServer(async(req,res) => {
  try {
    const host = req.headers.host;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) return json(res,{error:'仅允许本机访问'},403);
    const url = new URL(req.url, `http://${host}`);
    if(url.pathname.startsWith('/api/bridge/')) {
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
    if (req.headers.origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin)) return json(res,{error:'不允许跨站请求'},403);
    if(url.pathname==='/api/local/bridge-session' && req.method==='GET') return json(res,getBridgeSession(url.searchParams.get('id')));
    if(url.pathname==='/api/local/bridge-session/complete' && req.method==='POST') {
      if(!req.headers['content-type']?.startsWith('application/json')) return json(res,{error:'需要 JSON 请求'},415);
      return json(res,completeBridgeSession(JSON.parse((await body(req)).toString())));
    }
    if(url.pathname==='/api/local/settings' && req.method==='GET') return json(res,publicSettings());
    if(['/api/local/settings','/api/local/settings/test','/api/local/settings/models'].includes(url.pathname) && req.method==='POST') {
      if(!req.headers['content-type']?.startsWith('application/json')) return json(res,{error:'需要 JSON 请求'},415);
      const input=JSON.parse((await body(req)).toString());
      const result=url.pathname.endsWith('/test') ? await testSettings(input) : url.pathname.endsWith('/models') ? await listModels(input) : await saveSettings(input);
      return json(res,result);
    }
    if(url.pathname==='/api/local/user' && req.method==='GET') return json(res,localUser);
    if(url.pathname==='/api/local/upload' && req.method==='POST') {
      const data = await body(req);
      const form = await new Request(`http://${host}`,{method:'POST',headers:{'content-type':req.headers['content-type']},body:data}).formData();
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
        if(!['list','filter','get','create','bulkCreate','update','delete'].includes(input.action)) throw new Error('未知操作');
        return json(res,await entity(input.name)[input.action](...(input.args || [])));
      }
      if(input.kind==='function' && Object.hasOwn(functions,input.name)) {
        const result = await functions[input.name](new Request(`http://${host}`,{method:'POST',body:JSON.stringify(input.data || {})}));
        return json(res,await result.json(),result.status);
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
    const message = e.code ? '本地文件操作失败' : (e.message || '请求失败');
    json(res,{error:config.AI_API_KEY ? message.replaceAll(config.AI_API_KEY,'[redacted]') : message},e.status || 400);
  }
});
server.listen(port,'127.0.0.1',()=>console.log(`影词模方：http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await vite?.close();server.close();process.exit(0);});
