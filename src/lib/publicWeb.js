import { normalizeApiBaseUrl } from '../../shared/api-url.mjs';
import { projectDatabase } from '../../shared/web-database.mjs';

const SETTINGS_KEY = 'cine-web-settings-v1';
const DB_NAME = 'cine-prompt-private';
const DB_STORE = 'rows';
let databasePromise;

function readRawSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || {}; }
  catch { return {}; }
}
function writeRawSettings(value) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
}
export function publicSettingsView() {
  const saved = readRawSettings();
  const provider = saved.provider === 'gemini' ? 'gemini' : 'compatible';
  return {
    provider,
    baseUrl: saved.baseUrl || (provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : 'https://api.lingkeai.ai/api/v1'),
    model: saved.model || '',
    modelGemini: saved.modelGemini || '',
    modelGpt: saved.modelGpt || '',
    modelClaude: saved.modelClaude || '',
    hasKey: !!saved.apiKey
  };
}
function encodeSettings() {
  const saved = readRawSettings();
  const view = publicSettingsView();
  if (!saved.apiKey) return '';
  const payload = {
    provider: view.provider,
    baseUrl: view.baseUrl,
    model: view.model || 'model',
    modelGemini: view.modelGemini,
    modelGpt: view.modelGpt,
    modelClaude: view.modelClaude,
    apiKey: saved.apiKey
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
function openDatabase() {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}
function rowKey(name, id) { return `${name}/${id}`; }
async function withStore(mode, fn) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, mode);
    const store = tx.objectStore(DB_STORE);
    let result;
    Promise.resolve().then(() => fn(store)).then(value => { result = value; }, reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('浏览器数据保存失败'));
    tx.onabort = () => reject(tx.error || new Error('浏览器数据保存失败'));
  });
}
function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readAll(name) {
  const rows = await withStore('readonly', store => requestToPromise(store.getAll()));
  return rows.filter(item => item.name === name).map(item => item.row);
}
function matches(row, query) {
  return Object.entries(query || {}).every(([key, value]) => value && typeof value === 'object' ? ('$gte' in value && row[key] >= value.$gte) : row[key] === value);
}
async function entityAction(name, action, args) {
  if (action === 'list' || action === 'filter') {
    const [query, sort = '-updated_date', limit = 200] = action === 'list' ? [{}, args[0], args[1]] : args;
    const key = String(sort || '-updated_date').replace(/^-/, '');
    const direction = String(sort || '').startsWith('-') ? -1 : 1;
    return (await readAll(name)).filter(row => matches(row, query || {})).sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * direction).slice(0, Math.max(0, Number(limit) || 200));
  }
  if (action === 'get') {
    const row = (await readAll(name)).find(item => item.id === args[0]);
    if (!row) throw new Error('记录不存在');
    return row;
  }
  const stamp = new Date().toISOString();
  if (action === 'create' || action === 'bulkCreate') {
    const items = action === 'create' ? [args[0] || {}] : (args[0] || []);
    const rows = items.map(item => ({ ...item, id: crypto.randomUUID(), created_date: stamp, updated_date: stamp, created_by: 'local@localhost' }));
    await withStore('readwrite', async store => { for (const row of rows) await requestToPromise(store.put({ key: rowKey(name, row.id), name, row })); });
    return action === 'create' ? rows[0] : rows;
  }
  if (action === 'update') {
    const [id, patch] = args;
    const current = (await readAll(name)).find(item => item.id === id);
    if (!current) throw new Error('记录不存在');
    const row = { ...current, ...patch, id, updated_date: stamp };
    await withStore('readwrite', store => requestToPromise(store.put({ key: rowKey(name, id), name, row })));
    return row;
  }
  if (action === 'delete') {
    await withStore('readwrite', store => requestToPromise(store.delete(rowKey(name, args[0]))));
    return { success: true };
  }
  throw new Error('未知操作');
}
async function applyUpdates(updates) {
  for (const update of updates || []) {
    if (!update?.name || !update.row?.id) continue;
    await withStore('readwrite', store => requestToPromise(store.put({ key: rowKey(update.name, update.row.id), name: update.name, row: update.row })));
  }
}
function saveFromInput(input) {
  const saved = readRawSettings();
  const provider = input.provider === 'gemini' ? 'gemini' : 'compatible';
  const baseUrl = normalizeApiBaseUrl(input.baseUrl || '');
  const enteredKey = String(input.apiKey || '').trim();
  if (!enteredKey && (baseUrl !== normalizeApiBaseUrl(saved.baseUrl || '') || provider !== (saved.provider || 'compatible'))) {
    throw new Error('更换 API 类型或地址时请重新填写对应密钥');
  }
  const apiKey = enteredKey || saved.apiKey;
  if (!apiKey) throw new Error('请填写 API Key');
  if (!input.model || String(input.model).trim().length > 200) throw new Error('请填写模型名称');
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('Base URL 格式不正确'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('网页版请使用不含密码和查询参数的 HTTPS 地址');
  writeRawSettings({
    provider, baseUrl, apiKey,
    model: String(input.model).trim(),
    modelGemini: String(input.modelGemini || '').trim(),
    modelGpt: String(input.modelGpt || '').trim(),
    modelClaude: String(input.modelClaude || '').trim()
  });
  return publicSettingsView();
}
async function fileToDataUrl(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}
async function forward(native, url, init) {
  const headers = new Headers(init?.headers || {});
  const encoded = encodeSettings();
  if (!encoded) return jsonResponse({ error: '请先在 API 设置中填写自己的 API Key' }, 401);
  headers.set('x-cine-settings', encoded);
  let body = init?.body;
  if (url.endsWith('/rpc') && typeof body === 'string') {
    const input = JSON.parse(body);
    if (input.kind === 'function') {
      const snapshot = {};
      for (const name of ['Prompt', 'Direction', 'StyleLibrary', 'ColorPalette']) snapshot[name] = await readAll(name);
      input.database = projectDatabase(snapshot);
      body = JSON.stringify(input);
      if (new TextEncoder().encode(body).length > 3_600_000) {
        return jsonResponse({ error: '这次请求太大。请减少参考图数量后再试；历史记录里的图片不会随请求上传。' }, 413);
      }
    }
  }
  if (url.includes('/settings') && typeof body === 'string') {
    const input = JSON.parse(body);
    if (!input.apiKey) input.apiKey = readRawSettings().apiKey || '';
    body = JSON.stringify(input);
  }
  const response = await native(url, { ...init, headers, body });
  if (!url.endsWith('/rpc')) return response;
  const data = await response.json();
  if (data?._localUpdates) {
    await applyUpdates(data._localUpdates);
    delete data._localUpdates;
  }
  return jsonResponse(data, response.status);
}

export function installPublicWeb() {
  const native = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.startsWith('/api/local/')) return native(input, init);
    const method = String(init.method || 'GET').toUpperCase();
    try {
      if (url === '/api/local/user' && method === 'GET') return jsonResponse({ id: 'local-user', full_name: '本地用户', email: 'local@localhost', role: 'user' });
      if (url.startsWith('/api/local/voice/')) return jsonResponse({ state: 'off', message: '网页版使用浏览器语音输入。本机中文语音助手在 Windows 安装包里。' });
      if (url.startsWith('/api/local/bridge')) return jsonResponse({ error: 'Photoshop 桥接只在本机安装版里可用' }, 404);
      if (url === '/api/local/settings' && method === 'GET') return jsonResponse(publicSettingsView());
      if (url === '/api/local/settings' && method === 'POST') return jsonResponse(saveFromInput(JSON.parse(init.body || '{}')));
      if (url === '/api/local/upload' && method === 'POST') {
        const file = init.body?.get?.('file');
        if (!file) return jsonResponse({ error: '缺少文件' }, 400);
        return jsonResponse({ file_url: await fileToDataUrl(file) });
      }
      if (url === '/api/local/rpc' && method === 'POST') {
        const payload = JSON.parse(init.body || '{}');
        if (payload.kind === 'entity') return jsonResponse(await entityAction(payload.name, payload.action, payload.args || []));
        return forward(native, url, init);
      }
      if (url.startsWith('/api/local/settings/') && method === 'POST') return forward(native, url, init);
      return native(input, init);
    } catch (error) {
      return jsonResponse({ error: error.message || '请求失败' }, 400);
    }
  };
}
