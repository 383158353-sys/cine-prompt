/* global chrome */
// 优化方向（与后端 DIRECTIONS 对应的 key）
const DIRECTIONS = [
  { group: '角色', items: [
    ['character_realistic', '真人写实摄影'],
    ['character_cinematic', '电影级人像'],
    ['character_fashion', '时尚杂志大片'],
    ['character_japanese', '日系清新人像'],
    ['character_anime_niji', '二次元动漫(Niji)'],
    ['character_anime_shinkai', '新海诚风动漫'],
    ['character_cg', '3D写实CG角色'],
    ['character_chibi', 'Q版/萌系卡通'],
    ['character_concept', '角色概念设定'],
  ]},
  { group: '场景', items: [
    ['scene_outdoor_nature', '自然风光(室外)'],
    ['scene_outdoor_urban', '城市街景(室外)'],
    ['scene_outdoor_ancient', '古风山水古建'],
    ['scene_outdoor_scifi', '科幻废墟(室外)'],
    ['scene_indoor_modern', '现代室内'],
    ['scene_indoor_classical', '古典中式室内'],
    ['scene_indoor_cyberpunk', '赛博朋克室内'],
    ['scene_indoor_industrial', '工业风室内'],
  ]},
  { group: '视频镜头', items: [
    ['video_cinematic_shot', '电影运镜镜头'],
    ['video_action', '动作镜头'],
    ['video_aerial', '航拍/大场面'],
    ['video_portrait_motion', '人物动态镜头'],
  ]},
];

const MODELS = [
  ['automatic', '自动'],
  ['gemini_3_flash', 'Gemini'],
  ['gpt_5_mini', 'GPT'],
  ['claude_sonnet_4_6', 'Claude'],
];

const TARGETS = [
  ['imagine2', 'Imagine 2', 'image'],
  ['banana2', 'Banana 2', 'image'],
  ['jimeng_image', '即梦·生图', 'image'],
  ['jimeng_video', '即梦·生视频', 'video'],
  ['generic_image', '通用·生图', 'image'],
  ['generic_video', '通用·生视频', 'video'],
  ['midjourney', 'Midjourney', 'image'],
];

const STYLES_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.pc-wrap { position: fixed; top: 80px; right: 24px; width: 380px; z-index: 2147483647;
  background: #0f0f10; color: #f5f5f4; border: 1px solid #2a2a2a; border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,.5); overflow: hidden; font-size: 13px; }
.pc-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px;
  background: #161618; border-bottom: 1px solid #2a2a2a; cursor: move; user-select: none; }
.pc-title { font-weight: 600; font-size: 13px; letter-spacing: .5px; }
.pc-actions { display: flex; gap: 6px; }
.pc-btn { background: transparent; border: none; color: #a3a3a3; cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 4px; border-radius: 4px; }
.pc-btn:hover { background: #262626; color: #fff; }
.pc-body { padding: 12px; max-height: 70vh; overflow-y: auto; }
.pc-label { font-size: 11px; color: #a3a3a3; margin: 8px 0 4px; }
.pc-row { display: flex; gap: 6px; flex-wrap: wrap; }
.pc-chip { padding: 4px 8px; border-radius: 6px; font-size: 11px; background: #1f1f22; color: #d4d4d4; cursor: pointer; border: 1px solid transparent; }
.pc-chip.on { background: #f5f5f4; color: #0f0f10; font-weight: 600; }
.pc-select, .pc-area { width: 100%; background: #1c1c1f; color: #f5f5f4; border: 1px solid #2a2a2a;
  border-radius: 8px; padding: 8px 10px; font-size: 12px; }
.pc-area { min-height: 64px; resize: vertical; }
.pc-go { width: 100%; margin-top: 12px; padding: 10px; border-radius: 8px; border: none; cursor: pointer;
  background: #f5f5f4; color: #0f0f10; font-weight: 600; font-size: 13px; }
.pc-go:disabled { opacity: .5; cursor: wait; }
.pc-result { margin-top: 12px; border-top: 1px solid #2a2a2a; padding-top: 10px; }
.pc-res-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.pc-res-title { font-size: 12px; color: #d4d4d4; font-weight: 600; }
.pc-copy { font-size: 10px; background: #262626; color: #d4d4d4; border: none; border-radius: 5px; padding: 3px 7px; cursor: pointer; }
.pc-prompt { white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; color: #e5e5e5; background: #161618; padding: 8px; border-radius: 6px; max-height: 120px; overflow-y: auto; }
.pc-zh { color: #a3a3a3; }
.pc-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.pc-tag { font-size: 10px; background: #1f1f22; color: #a3a3a3; padding: 2px 6px; border-radius: 4px; }
.pc-err { color: #f87171; font-size: 12px; margin-top: 8px; }
.pc-foot { margin-top: 10px; font-size: 10px; color: #737373; display: flex; justify-content: space-between; }
.pc-foot a { color: #a3a3a3; text-decoration: none; }
.pc-foot a:hover { color: #fff; }
.pc-loading { text-align: center; color: #a3a3a3; padding: 10px; font-size: 12px; }
`;

let config = { endpoint: '', appUrl: '' };
let panel = null;

function loadConfig(cb) {
  chrome.storage.sync.get(['endpoint', 'appUrl', 'pc_dir'], (res) => {
    config.endpoint = res.endpoint || '';
    config.appUrl = res.appUrl || '';
    if (res.pc_dir) window.__pc_dir = res.pc_dir;
    cb();
  });
}

function buildPanel() {
  const host = document.createElement('div');
  host.id = 'pc-enhancer-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLES_CSS;
  shadow.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'pc-wrap';
  wrap.innerHTML = `
    <div class="pc-head">
      <span class="pc-title">✦ 影词模方 增强小窗</span>
      <div class="pc-actions">
        <button class="pc-btn" id="pc-open" title="打开完整应用">⤢</button>
        <button class="pc-btn" id="pc-close" title="关闭">×</button>
      </div>
    </div>
    <div class="pc-body">
      <div class="pc-label">优化方向</div>
      <select class="pc-select" id="pc-dir"></select>

      <div class="pc-label">模型</div>
      <div class="pc-row" id="pc-models"></div>

      <div class="pc-label">目标引擎</div>
      <div class="pc-row" id="pc-targets"></div>

      <div class="pc-label">灵感描述</div>
      <textarea class="pc-area" id="pc-input" placeholder="输入简短灵感或待优化提示词…"></textarea>

      <button class="pc-go" id="pc-go">优化生成</button>
      <div id="pc-out"></div>
      <div class="pc-foot">
        <span id="pc-status">快捷键可在扩展设置中自定义</span>
        <a href="#" id="pc-options">设置</a>
      </div>
    </div>`;
  shadow.appendChild(wrap);

  const dirSel = shadow.getElementById('pc-dir');
  DIRECTIONS.forEach((g) => {
    const og = document.createElement('optgroup');
    og.label = g.group;
    g.items.forEach(([k, label]) => {
      const o = document.createElement('option');
      o.value = k; o.textContent = label;
      og.appendChild(o);
    });
    dirSel.appendChild(og);
  });
  dirSel.value = window.__pc_dir || 'character_realistic';
  dirSel.addEventListener('change', () => {
    window.__pc_dir = dirSel.value;
    try { chrome.storage.sync.set({ pc_dir: dirSel.value }); } catch (_) {}
  });

  let model = 'automatic';
  const modelRow = shadow.getElementById('pc-models');
  MODELS.forEach(([k, label]) => {
    const b = document.createElement('button');
    b.className = 'pc-chip' + (k === model ? ' on' : '');
    b.textContent = label;
    b.onclick = () => { model = k; [...modelRow.children].forEach(c => c.classList.remove('on')); b.classList.add('on'); };
    modelRow.appendChild(b);
  });

  let target = 'imagine2';
  const targetRow = shadow.getElementById('pc-targets');
  TARGETS.forEach(([k, label, type]) => {
    const b = document.createElement('button');
    b.className = 'pc-chip' + (k === target ? ' on' : '');
    b.textContent = label;
    b.title = type === 'video' ? '视频' : '图像';
    b.onclick = () => { target = k; window.__pc_target = k; [...targetRow.children].forEach(c => c.classList.remove('on')); b.classList.add('on'); };
    targetRow.appendChild(b);
  });

  shadow.getElementById('pc-close').onclick = () => { host.style.display = 'none'; };
  shadow.getElementById('pc-open').onclick = () => { if (config.appUrl) window.open(config.appUrl, '_blank'); };
  shadow.getElementById('pc-options').onclick = (e) => { e.preventDefault(); if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage(); };

  const head = shadow.querySelector('.pc-head');
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  head.addEventListener('mousedown', (e) => {
    dragging = true;
    const r = wrap.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    wrap.style.right = 'auto';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    wrap.style.left = (ox + e.clientX - sx) + 'px';
    wrap.style.top = (oy + e.clientY - sy) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  shadow.getElementById('pc-go').onclick = doEnhance;

  host.style.display = 'none';
  document.documentElement.appendChild(host);
  panel = host;
}

function toggle() {
  if (!panel) { loadConfig(() => { buildPanel(); panel.style.display = 'block'; }); return; }
  panel.style.display = (panel.style.display === 'none' || !panel.style.display) ? 'block' : 'none';
  if (panel.style.display === 'block') loadConfig(() => {});
}

async function doEnhance() {
  const root = panel.shadowRoot;
  const raw = root.getElementById('pc-input').value.trim();
  const out = root.getElementById('pc-out');
  const btn = root.getElementById('pc-go');
  const status = root.getElementById('pc-status');
  if (!raw) { out.innerHTML = '<div class="pc-err">请输入灵感描述</div>'; return; }
  if (!config.endpoint) { out.innerHTML = '<div class="pc-err">未配置接口地址，请点"设置"填写 enhancePrompt 接口 URL</div>'; return; }
  btn.disabled = true; status.textContent = '正在生成…';
  out.innerHTML = '<div class="pc-loading">正在调用大模型…</div>';
  const dir = root.getElementById('pc-dir').value;
  try {
    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ mode: 'enhance', raw_input: raw, direction: dir, model: '', target: (window.__pc_target || 'imagine2') })
    });
    if (res.status === 401) { out.innerHTML = '<div class="pc-err">未登录，请先点右上角 ⤢ 打开完整应用并登录后重试。</div>'; return; }
    const data = await res.json();
    if (data.error) { out.innerHTML = '<div class="pc-err">' + data.error + '</div>'; return; }
    const en = data.enhanced_prompt || '';
    const zh = data.enhanced_prompt_zh || '';
    const tags = (data.tags || []).map(t => '<span class="pc-tag">' + t + '</span>').join('');
    out.innerHTML = '<div class="pc-result"><div class="pc-res-head"><span class="pc-res-title">' + (data.title || '优化结果') + '</span><button class="pc-copy" id="pc-cpy-en">复制英文</button></div><div class="pc-prompt">' + en + '</div><div class="pc-res-head" style="margin-top:8px"><span class="pc-res-title pc-zh">中文提示词</span><button class="pc-copy" id="pc-cpy-zh">复制中文</button></div><div class="pc-prompt pc-zh">' + zh + '</div><div class="pc-tags">' + tags + '</div></div>';
    root.getElementById('pc-cpy-en').onclick = () => copy(en, status);
    root.getElementById('pc-cpy-zh').onclick = () => copy(zh, status);
    copy(en, status);
  } catch (e) {
    out.innerHTML = '<div class="pc-err">请求失败：' + e.message + '（跨域或未登录可能导致此问题，请用完整应用）</div>';
  } finally {
    btn.disabled = false; status.textContent = '完成';
  }
}

function copy(text, status) {
  navigator.clipboard.writeText(text).then(() => { status.textContent = '已复制到剪贴板'; }).catch(() => {});
}

window.__pc_target = window.__pc_target || 'imagine2';
window.__pc_dir = window.__pc_dir || 'character_realistic';

// ===== 自动检测生图对话框并注入一键增强按钮 =====
let badge = null;

function ensureBadge() {
  if (badge) return badge;
  badge = document.createElement('div');
  badge.id = 'pc-quick-badge';
  badge.setAttribute('style', [
    'all: initial', 'position: fixed', 'z-index: 2147483646', 'display: none',
    'width: 30px', 'height: 30px', 'border-radius: 8px', 'background: #0f0f10',
    'color: #f5f5f4', 'box-shadow: 0 2px 10px rgba(0,0,0,.35)', 'cursor: pointer',
    'line-height: 30px', 'text-align: center', 'border: 1px solid #2a2a2a',
    'user-select: none', 'box-sizing: border-box'
  ].join(';'));
  badge.style.font = '14px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  badge.textContent = '✨';
  badge.title = '影词魔方：增强此输入框内容';
  badge.addEventListener('mousedown', (e) => { e.preventDefault(); }); // 阻止输入框失焦
  badge.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const el = badge.__target;
    if (el) enhanceAndFill(el);
  });
  document.documentElement.appendChild(badge);
  return badge;
}

function isPromptBox(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  const isText = tag === 'TEXTAREA'
    || (tag === 'INPUT' && /^(text|search|)$/.test((el.type || '').toLowerCase()))
    || el.isContentEditable;
  if (!isText) return false;
  if (el.closest('#pc-enhancer-host') || el.closest('#pc-quick-badge')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 120 || r.height < 16) return false;
  const sig = [
    el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'),
    el.getAttribute('aria-placeholder'), el.getAttribute('title'), el.getAttribute('role')
  ].join(' ').toLowerCase();
  const BAD = ['password', 'email', 'username', 'user name', 'login', 'signin', 'signup', '注册', '登录', '手机号', '验证码', 'captcha'];
  if (BAD.some((k) => sig.includes(k))) return false;
  const KW = ['prompt', 'describe', 'description', 'message', 'chat', 'ask', 'input', '想象', '描述', '提示', '输入', '消息', '发送', '咒语', '正向', '关键词', '画面', '生成'];
  const isKW = KW.some((k) => sig.includes(k));
  if (tag === 'TEXTAREA') return isKW || r.width > 240;
  if (el.isContentEditable) return isKW || (r.width > 200 && r.height > 40);
  return isKW;
}

function positionBadge() {
  if (!badge || !badge.__target) return;
  const r = badge.__target.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) { badge.style.display = 'none'; return; }
  let left = r.right - 34;
  if (left < 4) left = 4;
  badge.style.left = left + 'px';
  badge.style.top = (r.top + 4) + 'px';
  badge.style.display = 'flex';
  badge.style.alignItems = 'center';
  badge.style.justifyContent = 'center';
}

function showBadge(el) { ensureBadge(); badge.__target = el; positionBadge(); }
function hideBadge() { if (badge) badge.style.display = 'none'; }

function readValue(el) {
  if (el.isContentEditable) return (el.innerText || el.textContent || '');
  return el.value || '';
}

function fillValue(el, text) {
  if (el.isContentEditable) {
    el.focus();
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (_) {}
    if (!ok) el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    return;
  }
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, text); else el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function resetBadge() {
  if (!badge) return;
  badge.textContent = '✨';
  badge.title = '影词魔方：增强此输入框内容';
}

async function enhanceAndFill(el) {
  if (!config.endpoint) return finish('未配置');
  const raw = readValue(el).trim();
  if (!raw) return finish('输入框为空');
  if (badge) { badge.textContent = '…'; badge.title = '正在优化…'; }
  try {
    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ mode: 'enhance', raw_input: raw, direction: window.__pc_dir || 'character_realistic', model: '', target: window.__pc_target || 'imagine2' })
    });
    if (res.status === 401) return finish('未登录');
    const data = await res.json();
    if (data.error) return finish('失败');
    const en = data.enhanced_prompt || '';
    if (!en) return finish('无结果');
    fillValue(el, en);
    finish('已填充✓');
  } catch (e) {
    finish('请求失败');
  }
  function finish(msg) {
    if (!badge) return;
    badge.textContent = msg;
    badge.title = msg;
    setTimeout(resetBadge, 1400);
  }
}

function setupAutoInject() {
  document.addEventListener('focusin', (e) => {
    if (isPromptBox(e.target)) showBadge(e.target);
    else if (e.target !== badge) hideBadge();
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (!badge || badge.style.display === 'none') return;
    if (e.target === badge || badge.contains(e.target)) return;
    if (badge.__target && e.target === badge.__target) return;
    hideBadge();
  }, true);
  window.addEventListener('scroll', positionBadge, true);
  window.addEventListener('resize', positionBadge);
}

loadConfig(() => {});
setupAutoInject();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'TOGGLE_ENHANCER') toggle();
});