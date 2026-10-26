export const UPSCALE_PRESET = 'upscale';

export const UPSCALE_PROMPT_ZH = '【超清】只根据画面中物体自身已有的材质和质感做超分辨率：提高清晰度、边缘和微观纹理，例如皮肤毛孔、织物织纹、木纹、金属、石材、玻璃本身的纹理。严格保持原图的色调、色彩分级、光影、曝光、构图、机位、焦段、透视、主体身份、造型、场景内容和其余一切属性不变。禁止重新上色、重新打光、改变风格、增加物体、改变氛围或重绘任何区域。';

export const UPSCALE_PROMPT_EN = 'Ultra-detail only: super-resolve and sharpen detail from each object\'s own existing material texture, such as skin pores, fabric weave, wood grain, metal, stone, and glass. Preserve the original color grading, palette, lighting, exposure, composition, camera, lens, perspective, identity, styling, scene content, and every other attribute. Do not recolor, relight, restyle, add objects, change the atmosphere, or redesign anything.';

export function isUpscalePreset(value) {
  return value === UPSCALE_PRESET;
}

export function upscaleRepairInstruction() {
  return `\n\n【一键超清（最高优先级）】\n本次不是寻找逻辑错误后重绘。唯一修改是按物体自身材质做超分。\n${UPSCALE_PROMPT_ZH}\n${UPSCALE_PROMPT_EN}\n若图上有标注，只对标注区域内的既有质感超分，标注外保持原图。若用户另有文字，只能在上述锁定范围内补充要超分的部位，不得据此改色调、光影、构图、身份或其他属性。忽略会改变色调、光影或风格的项目风格与色板。\nrepair_prompt_zh 必须包含「【超清】」并写明只按物体自身质感超分、不改变色调与光影。repair_prompt_en 必须包含 "Ultra-detail only" 和同样的保留约束。negative_constraints 必须禁止改色调、改光影、改构图、改身份和重绘风格。`;
}

export function applyUpscalePreset(result) {
  const source = result && typeof result === 'object' ? result : {};
  const zh = String(source.repair_prompt_zh || '').trim();
  const en = String(source.repair_prompt_en || '').trim();
  const negative = String(source.negative_constraints || '').trim();
  const lock = '禁止改变色调、光影、构图、主体身份和视觉风格。';
  return {
    ...source,
    repair_prompt_zh: zh.includes('【超清】') ? zh : [zh, UPSCALE_PROMPT_ZH].filter(Boolean).join('\n\n'),
    repair_prompt_en: en.includes('Ultra-detail only') ? en : [en, UPSCALE_PROMPT_EN].filter(Boolean).join('\n\n'),
    negative_constraints: negative.includes('禁止改变色调') ? negative : [negative, lock].filter(Boolean).join('\n'),
    repair_preset: UPSCALE_PRESET
  };
}
