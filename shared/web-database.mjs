const NAMES = ['Prompt', 'Direction', 'StyleLibrary', 'ColorPalette'];
const LIMITS = { Prompt: 12, Direction: 40, StyleLibrary: 80, ColorPalette: 40 };
const KEYS = {
  Prompt: ['id', 'direction', 'rating', 'raw_input', 'content', 'title', 'category', 'updated_date', 'created_date'],
  Direction: ['id', 'name', 'key', 'group', 'base_direction', 'system_prompt', 'updated_date'],
  StyleLibrary: ['id', 'name', 'category', 'style_prompt', 'thumbnail_url', 'updated_date'],
  ColorPalette: ['id', 'name', 'scope', 'colors', 'description', 'updated_date']
};

function clip(value, max = 4000) {
  if (typeof value === 'string') return value.slice(0, max);
  if (Array.isArray(value)) return value.slice(0, 24).map(item => clip(item, 200));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value).slice(0, 24)) out[key] = clip(child, 200);
    return out;
  }
  return value;
}

function projectRow(name, row) {
  if (!row || typeof row !== 'object') return null;
  const out = {};
  for (const key of KEYS[name]) {
    if (row[key] == null) continue;
    out[key] = clip(row[key], key === 'style_prompt' || key === 'content' || key === 'system_prompt' ? 4000 : 2000);
  }
  if (!out.id) return null;
  if (name === 'StyleLibrary') {
    const thumb = String(row.thumbnail_url || '');
    out.thumbnail_url = thumb.startsWith('data:') ? 'inline' : thumb.slice(0, 500);
  }
  if (name === 'Prompt') {
    delete out.context;
  }
  return out;
}

// Text-only snapshot for one serverless call. Image payloads stay out of history rows.
export function projectDatabase(db) {
  const source = db && typeof db === 'object' ? db : {};
  const out = {};
  for (const name of NAMES) {
    const rows = Array.isArray(source[name]) ? source[name] : [];
    out[name] = rows.slice(0, LIMITS[name]).map(row => projectRow(name, row)).filter(Boolean);
  }
  return out;
}

export function sanitizeDatabase(input) {
  return projectDatabase(input);
}

export function changedRows(before, after) {
  const updates = [];
  for (const name of NAMES) {
    const previous = new Map((before?.[name] || []).map(row => [row.id, JSON.stringify(row)]));
    for (const row of after?.[name] || []) {
      if (previous.get(row.id) !== JSON.stringify(row)) updates.push({ name, row });
    }
  }
  return updates;
}
