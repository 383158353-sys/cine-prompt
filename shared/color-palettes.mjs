export const COLOR_PALETTE_SCOPES = Object.freeze({
  CHARACTER: 'character',
  ENVIRONMENT: 'environment'
});

export function normalizeHexColor(value) {
  const text = String(value || '').trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(text)) return text;
  if (/^#[0-9A-F]{3}$/.test(text)) return `#${text.slice(1).split('').map((part) => part + part).join('')}`;
  return null;
}

export function normalizeColorPalette(input, expectedScope) {
  if (!input || typeof input !== 'object') return null;
  const scope = input.scope === COLOR_PALETTE_SCOPES.ENVIRONMENT
    ? COLOR_PALETTE_SCOPES.ENVIRONMENT
    : input.scope === COLOR_PALETTE_SCOPES.CHARACTER ? COLOR_PALETTE_SCOPES.CHARACTER : '';
  if (!scope || (expectedScope && scope !== expectedScope)) return null;
  const palette = Array.isArray(input.palette)
    ? input.palette.map(normalizeHexColor).filter(Boolean).slice(0, 8)
    : [];
  if (palette.length < 2) return null;
  const roles = new Set(['Primary', 'Secondary', 'Accent', 'Highlight', 'Shadow']);
  const colors = Array.isArray(input.colors) && input.colors.length
    ? input.colors.map((color, index) => {
      const hex = normalizeHexColor(color?.hex || palette[index]);
      if (!hex) return null;
      return {
        name: String(color?.name || `颜色${index + 1}`).slice(0, 40), hex,
        percentage: Math.max(0, Math.min(100, Number(color?.percentage) || 0)),
        role: roles.has(color?.role) ? color.role : index === 0 ? 'Primary' : 'Secondary'
      };
    }).filter(Boolean).slice(0, 8)
    : palette.map((hex, index) => ({ name: `颜色${index + 1}`, hex, percentage: 0, role: index === 0 ? 'Primary' : 'Secondary' }));
  const sourceAnalysis = input.analysis && typeof input.analysis === 'object' ? input.analysis : {};
  const analysis = Object.fromEntries(['temperature', 'brightness', 'saturation', 'contrast', 'harmony', 'tendency', 'highlight_tendency', 'shadow_tendency', 'description'].map((key) => [key, String(sourceAnalysis[key] || '').slice(0, 500)]));
  return {
    id: String(input.id || ''),
    name: String(input.name || (scope === 'character' ? '角色色卡' : '场景色卡')).slice(0, 80),
    scope,
    palette,
    colors,
    analysis,
    color_count: palette.length,
    variation: Math.max(0, Math.min(100, Number(input.variation) || 50))
  };
}

export function buildColorPaletteInstruction(input, expectedScope) {
  const palette = normalizeColorPalette(input, expectedScope);
  if (!palette) return '';
  const colors = palette.colors.map((color) => `${color.name} ${color.hex}（${color.role}${color.percentage ? `，${color.percentage}%` : ''}）`).join('；');
  const analysis = palette.analysis;
  const analysisText = [
    analysis.temperature && `色温${analysis.temperature}`, analysis.brightness && `明度${analysis.brightness}`,
    analysis.saturation && `饱和度${analysis.saturation}`, analysis.contrast && `对比度${analysis.contrast}`,
    analysis.harmony && `色相关系${analysis.harmony}`, analysis.tendency,
    analysis.highlight_tendency && `高光倾向${analysis.highlight_tendency}`,
    analysis.shadow_tendency && `阴影倾向${analysis.shadow_tendency}`
  ].filter(Boolean).join('，');
  const relation = palette.palette.length >= 4
    ? `前两种颜色作为大面积主色与次主色，中间颜色承担层次、过渡与局部材质，最后一种颜色仅作为小面积点缀或光影强调；模型必须结合参考图实际内容动态判断面积比例，不得机械平均分配。`
    : `第一种颜色作为主色，第二种颜色作为辅助与过渡，其余颜色用于阴影、高光或小面积点缀；模型必须结合参考图实际内容动态判断面积比例。`;
  if (palette.scope === COLOR_PALETTE_SCOPES.CHARACTER) {
    return `\n\n<COLOR_PALETTE scope="character" name="${palette.name}">\n色卡：${colors}。${relation}${analysisText ? `\n色彩关系：${analysisText}。` : ''}${analysis.description ? `\n分析摘要：${analysis.description}` : ''}\n这是角色色卡，只能用于人物主体的重新配色与重打光。必须遵循已标注的Primary、Secondary、Accent、Highlight、Shadow及占比关系，把颜色有目的地分配到头发、皮肤与五官局部色彩、妆容、服装主副色、饰品/金属/材质、轮廓光与人物阴影中。可轻微统一背景色调，但背景不得喧宾夺主，也不得扩写大段场景风格。目标是保持原图主体、结构和设计内容不变，只根据色卡调整配色、色调、光影和整体色彩关系；不得重新设计角色。严格保持人物身份、脸型五官、身体结构、姿态、服装款式与结构、构图和主要内容不变。中文结果必须是自然中文，不得中英混杂或机械套用模板。\n</COLOR_PALETTE>`;
  }
  return `\n\n<COLOR_PALETTE scope="environment" name="${palette.name}">\n色卡：${colors}。${relation}${analysisText ? `\n色彩关系：${analysisText}。` : ''}${analysis.description ? `\n分析摘要：${analysis.description}` : ''}\n这是场景色卡，只能用于环境整体的重新着色与重打光。必须遵循已标注的Primary、Secondary、Accent、Highlight、Shadow及占比关系，把颜色有目的地分配到天空、海面/水面、地面、墙面、建筑、植被、道具、展品与空间材质中；同步调整环境光、氛围光、时间感、雾感、空气透视、反射与冷暖关系。目标是保持原图主体、空间结构和设计内容不变，只根据色卡调整配色、色调、光影和整体色彩关系；不得重新设计场景。严格保持建筑比例、透视、机位、物体布局、展陈关系、构图和主要内容不变。禁止分析或改写人物五官、发型、服装等角色项目。中文结果必须是自然中文，不得中英混杂。\n</COLOR_PALETTE>`;
}

export function applyColorPaletteToPrompt(text, input, expectedScope, language = 'zh') {
  const palette = normalizeColorPalette(input, expectedScope);
  if (!palette || !text) return text;
  const colors = palette.colors.map(color => `${color.hex} ${Math.round(color.percentage)}%`).join('、');
  const target = palette.scope === 'character' ? '人物的发色、妆容、服装、材质与人物光影' : '环境、建筑、地面、植被与场景光影';
  const suffix = language === 'en'
    ? `Apply the selected ${palette.scope === 'character' ? 'character' : 'environment'} palette ${palette.name} as a visual reference: ${palette.colors.map(color => `${color.hex} ${Math.round(color.percentage)}%`).join(', ')}. Preserve the original subject and composition; change only the color distribution and related lighting.`
    : `色卡配色说明：以“${palette.name}”色卡图为视觉参考，按 ${colors} 的面积比例调整${target}；保持原有主体、结构和构图不变。`;
  return `${String(text).trim()}\n\n${suffix}`;
}
