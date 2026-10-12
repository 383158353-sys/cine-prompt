import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

function sample(schema) {
  if(schema.enum) return schema.enum[0];
  if(schema.type==='object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([k,v])=>[k,sample(v)]));
  if(schema.type==='array') return [sample(schema.items || {type:'string'})];
  if(schema.type==='boolean') return true;
  if(schema.type==='number' || schema.type==='integer') return 5;
  return '测试内容 Test prompt';
}
test('local application integration with a mock OpenAI-compatible provider', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'cine-local-test-'));
  const calls=[]; let fault='';
  const upstream=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const body=JSON.parse(Buffer.concat(chunks));calls.push({url:req.url,body});
    res.setHeader('Content-Type','application/json');
    if(fault==='401'){res.statusCode=401;res.end(JSON.stringify({error:'credential-echo-test'}));return;}
    if(req.url==='/images/generations'){res.end(JSON.stringify({data:[{b64_json:Buffer.from('test image').toString('base64')}]}));return;}
    const schema=body.messages.find(m=>m.role==='system')?.content.split('\n').slice(1).join('\n');
    const content=fault==='json' ? 'invalid json' : schema ? JSON.stringify(sample(JSON.parse(schema))) : '一个角色站在雨中';
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}));
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const app=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,AI_PROVIDER:'compatible',AI_BASE_URL:`http://127.0.0.1:${upstream.address().port}`,AI_API_KEY:'test-only-token',AI_MODEL:'mock-vision',AI_MODEL_GPT:'mock-gpt',AI_IMAGE_MODEL:'mock-image',LOCAL_DATA_DIR:temp,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{app.kill();await new Promise(r=>upstream.close(r));});
  await Promise.race([once(app.stdout,'data'),once(app,'exit').then(()=>{throw new Error('app exited before startup');}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('startup timeout')),20000);timer.unref();})]);
  const base=`http://127.0.0.1:${port}`;
  const rpc=async(data)=>{const r=await fetch(base+'/api/local/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
  const fn=(name,data)=>rpc({kind:'function',name,data});
  const ent=(name,action,...args)=>rpc({kind:'entity',name,action,args});
  await t.test('frontend and local identity',async()=>{
    assert.equal((await fetch(base)).status,200);
    assert.equal((await (await fetch(base+'/api/local/user')).json()).id,'local-user');
  });
  await t.test('CRUD, concurrent persistence, filtering and favorites',async()=>{
    const results=await Promise.all(Array.from({length:10},(_,i)=>ent('Prompt','create',{title:`p${i}`,rating:i,direction:'test'})));
    assert.equal((await ent('Prompt','list')).data.length,10);
    assert.equal((await ent('Prompt','filter',{rating:{$gte:4},direction:'test'},'-updated_date',3)).data.length,3);
    const id=results[0].data.id;
    await ent('Prompt','update',id,{is_favorite:true});assert.equal((await ent('Prompt','get',id)).data.is_favorite,true);
    await ent('Prompt','delete',id);assert.equal((await ent('Prompt','list')).data.length,9);
    assert.equal(JSON.parse(await fs.readFile(path.join(temp,'db.json'),'utf8')).Prompt.length,9);
    assert.equal((await ent('Direction','create',{name:'自定义方向'})).status,200);
  });
  await t.test('settings endpoints hide saved keys and test the supplied model',async()=>{
    const read=await (await fetch(base+'/api/local/settings')).json();
    assert.equal(read.hasKey,true);assert.equal(read.model,'mock-vision');assert.ok(!JSON.stringify(read).includes('test-only-token'));
    const result=await fetch(base+'/api/local/settings/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'compatible',baseUrl:read.baseUrl,model:'connection-model',apiKey:''})});
    assert.equal(result.status,200);assert.match((await result.json()).message,/连接成功/);
    assert.equal(calls.at(-1).body.model,'connection-model');
    assert.equal((await (await fetch(base+'/api/local/settings')).json()).model,'mock-vision');
    const forbidden=await fetch(base+'/api/local/settings',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.test'},body:'{}'});
    assert.equal(forbidden.status,403);
  });
  const bridgeHeaders={'X-Cine-Bridge':'1','Content-Type':'application/json',Origin:'plugin://com.local.lk888.psedit'};
  await t.test('bridge health enforces its own origin and header policy',async()=>{
    assert.equal((await fetch(base+'/api/bridge/health')).status,403);
    assert.equal((await fetch(base+'/api/bridge/health',{headers:{'X-Cine-Bridge':'1',Origin:'https://attacker.example'}})).status,403);
    const health=await fetch(base+'/api/bridge/health',{headers:bridgeHeaders});
    assert.equal(health.status,200);assert.equal((await health.json()).model,'mock-vision');
    assert.equal(health.headers.get('access-control-allow-origin'),'plugin://com.local.lk888.psedit');
    const options=await fetch(base+'/api/bridge/optimize',{method:'OPTIONS',headers:{Origin:'plugin://com.local.lk888.psedit','Access-Control-Request-Headers':'content-type,x-cine-bridge'}});
    assert.equal(options.status,204);assert.match(options.headers.get('access-control-allow-headers'),/X-Cine-Bridge/);
  });
  let image;
  await t.test('upload and conversion to vision data URL',async()=>{
    const form=new FormData();form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPhkAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'reference.png');
    image=(await (await fetch(base+'/api/local/upload',{method:'POST',body:form})).json()).file_url;
    assert.match(image,/^\/uploads\//);
    assert.equal((await fetch(base+image)).status,200);
  });
  await t.test('bridge validates images, optimizes in order and writes PS history',async()=>{
    const data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPhkAAAAASUVORK5CYII=';
    const response=await fetch(base+'/api/bridge/optimize',{method:'POST',headers:bridgeHeaders,body:JSON.stringify({text:'把衣服改成红色丝绒',images:[{name:'选区.png',data},{name:'参考.png',data}],purpose:'ps_local_edit',target:'banana2',language:'zh'})});
    const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.ok(result.prompt);assert.ok(result.prompt_en);assert.ok(result.prompt_zh);assert.ok(result.history_id);
    const last=calls.at(-1);assert.equal(last.body.messages.at(-1).content.filter(part=>part.type==='image_url').length,2);assert.match(last.body.messages.at(-1).content[0].text,/Photoshop 局部改图/);
    const saved=(await ent('Prompt','get',result.history_id)).data;assert.equal(saved.source,'ps');assert.equal(saved.raw_input,'把衣服改成红色丝绒');assert.equal(saved.context.file_urls.length,2);
    const tooMany=await fetch(base+'/api/bridge/optimize',{method:'POST',headers:bridgeHeaders,body:JSON.stringify({text:'x',images:Array(15).fill({name:'x.png',data})})});
    assert.equal(tooMany.status,400);
    const invalid=await fetch(base+'/api/bridge/optimize',{method:'POST',headers:bridgeHeaders,body:JSON.stringify({text:'x',images:[{name:'x.gif',data:'data:image/gif;base64,R0lGODlh'}]})});
    assert.equal(invalid.status,400);
  });
  for(const mode of ['enhance','reverse','repair','sheet','viewpoint','style_swap','video_director']) {
    await t.test(`${mode} reaches compatible provider and returns original fields`,async()=>{
      const result=await fn('enhancePrompt',{mode,raw_input:'一个角色站在雨中',file_urls:[image],model:'gpt',styles:[{name:'短发',category:'hair',style_prompt:'short hair'}]});
      assert.equal(result.status,200,JSON.stringify(result.data));assert.ok(mode === 'repair' ? result.data.repair_prompt_en : result.data.enhanced_prompt);
      const last=calls.at(-1);assert.equal(last.url,'/chat/completions');assert.equal(last.body.model,'mock-gpt');
      assert.match(last.body.messages.at(-1).content.find(c=>c.type==='image_url').image_url.url,/^data:image\/png;base64,/);
    });
  }
  await t.test('all fourteen viewpoints return results',async()=>{
    const result=await fn('enhancePrompt',{mode:'multi_view',file_urls:[image]});
    assert.equal(result.status,200);assert.equal(result.data.views.length,14);assert.ok(result.data.views.every(v=>v.enhanced_prompt && !v.error));
  });
  await t.test('repeated multi-image requests do not retain removed images or history',async()=>{
    const count = () => calls.at(-1).body.messages.at(-1).content.filter(part=>part.type==='image_url').length;
    assert.equal((await fn('enhancePrompt',{mode:'reverse',file_urls:[image,image]})).status,200);
    assert.equal(count(),2);
    assert.equal((await fn('enhancePrompt',{mode:'reverse',file_urls:[image]})).status,200);
    assert.equal(count(),1);
    const previous = JSON.stringify(calls.at(-1).body);
    assert.equal((await fn('enhancePrompt',{mode:'reverse',file_urls:[image]})).status,200);
    assert.equal(JSON.stringify(calls.at(-1).body),previous);
  });
  await t.test('batch storyboard retains shot identity and dialogue',async()=>{
    const result=await fn('enhancePrompt',{mode:'video_batch',shots:[{shot_id:'one',original_prompt:'她转身说：“你好。”'},{shot_id:'two',original_prompt:'他走远'}]});
    assert.equal(result.status,200);assert.deepEqual(result.data.shots.map(s=>s.shot_id),['one','two']);assert.ok(result.data.shots.every(s=>s.enhanced_prompt));
  });
  await t.test('image/text style analysis and thumbnail generation',async()=>{
    for(const input of [{file_urls:[image],category:'hair'},{text:'短发',category:'hair'}]) {
      const result=await fn('analyzeStyleImage',input);assert.equal(result.status,200);assert.ok(result.data.results[0].style_prompt);assert.ok(result.data.results[0].thumbnail_url);
    }
    await ent('StyleLibrary','bulkCreate',[{name:'短发',style_prompt:'short hair'}]);
    const result=await fn('generateStyleThumbnails',{});assert.equal(result.data.success,1);
  });
  await t.test('CSV storyboard parses locally including quoted multiline cells',async()=>{
    const before=calls.length;const form=new FormData();form.append('file',new Blob(['镜号,描述\n1,"雨中\n转身"\n2,走远']),'shots.csv');
    const file=(await (await fetch(base+'/api/local/upload',{method:'POST',body:form})).json()).file_url;
    const result=await fn('parseStoryboard',{file_url:file});assert.equal(result.data.rows.length,2);assert.equal(result.data.rows[0].描述,'雨中\n转身');assert.equal(calls.length,before);
  });
  await t.test('bad JSON and upstream errors are surfaced without provider body',async()=>{
    fault='json';assert.equal((await fn('enhancePrompt',{raw_input:'角色'})).status,500);
    fault='401';const result=await fn('enhancePrompt',{raw_input:'角色'});assert.equal(result.status,500);assert.match(result.data.error,/401/);assert.ok(!JSON.stringify(result).includes('credential-echo-test'));fault='';
  });
  await t.test('cross-origin calls and unknown operations are rejected',async()=>{
    assert.equal((await fetch(base+'/api/local/rpc',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await rpc({kind:'entity',name:'../secret',action:'list'})).status,400);
    assert.equal((await rpc({kind:'entity',name:'Prompt',action:'constructor'})).status,400);
    assert.ok(!(await (await fetch(base+'/.env.local')).text()).includes('test-only-token'));
  });
});
