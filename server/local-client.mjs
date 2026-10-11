import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir, InvokeLLM, GenerateImage } from './ai.mjs';

export const localUser = {id:'local-user', full_name:'本地用户', email:'local@localhost', role:'user'};
const allowed = new Set(['Prompt','Direction','StyleLibrary']);
let queue = Promise.resolve();
async function transaction(fn, write = false) {
  const operation = queue.then(async () => {
    await fs.mkdir(dataDir, {recursive:true});
    const file = path.join(dataDir, 'db.json');
    let db;
    try { db = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('本地数据库读取失败，请检查或恢复备份'); db = {}; }
    const result = fn(db);
    if (write) { await fs.writeFile(`${file}.tmp`, JSON.stringify(db, null, 2)); await fs.rename(`${file}.tmp`, file); }
    return result;
  });
  queue = operation.catch(() => {});
  return operation;
}
function matches(row, query) {
  return Object.entries(query).every(([k,v]) => v && typeof v === 'object' ? ('$gte' in v && row[k] >= v.$gte) : row[k] === v);
}
export function entity(name) {
  if (!allowed.has(name)) throw new Error('未知数据类型');
  const filter = (query = {}, sort = '-updated_date', limit = 200) => transaction(db => {
    const key = sort.replace(/^-/, '');
    return (db[name] || []).filter(row => matches(row, query)).sort((a,b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (sort.startsWith('-') ? -1 : 1)).slice(0, Math.max(0, Number(limit) || 200));
  });
  const create = data => ({...data, id:randomUUID(), created_date:new Date().toISOString(), updated_date:new Date().toISOString(), created_by:localUser.email});
  return {
    list:(sort,limit) => filter({},sort,limit), filter,
    get:id => transaction(db => {const row = (db[name] || []).find(r => r.id === id); if (!row) throw new Error('记录不存在'); return row;}),
    create:data => transaction(db => {const row=create(data); (db[name] ||= []).push(row); return row;},true),
    bulkCreate:items => transaction(db => {const rows=items.map(create); (db[name] ||= []).push(...rows); return rows;},true),
    update:(id,data) => transaction(db => {const row=(db[name] || []).find(r=>r.id===id); if(!row) throw new Error('记录不存在'); Object.assign(row, data, {id,updated_date:new Date().toISOString()}); return row;},true),
    delete:id => transaction(db => {db[name]=(db[name] || []).filter(r=>r.id!==id); return {success:true};},true)
  };
}
const client = {entities:Object.fromEntries([...allowed].map(name=>[name,entity(name)])), integrations:{Core:{InvokeLLM,GenerateImage}}, auth:{me:async()=>localUser}};
client.asServiceRole = client;
export const createClientFromRequest = () => client;
