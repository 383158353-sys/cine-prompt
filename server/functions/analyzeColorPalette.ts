import { createClientFromRequest } from './local-client.mjs';

const COLOR_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' }, hex: { type: 'string' }, percentage: { type: 'number' },
    role: { type: 'string', enum: ['Primary', 'Secondary', 'Accent', 'Highlight', 'Shadow'] }
  },
  required: ['name', 'hex', 'percentage', 'role']
};

const SCHEMA = {
  type: 'object',
  properties: {
    colors: { type: 'array', items: COLOR_SCHEMA },
    analysis: {
      type: 'object',
      properties: {
        temperature: { type: 'string' }, brightness: { type: 'string' }, saturation: { type: 'string' },
        contrast: { type: 'string' }, harmony: { type: 'string' }, tendency: { type: 'string' },
        highlight_tendency: { type: 'string' }, shadow_tendency: { type: 'string' }, description: { type: 'string' }
      },
      required: ['temperature', 'brightness', 'saturation', 'contrast', 'harmony', 'tendency', 'highlight_tendency', 'shadow_tendency', 'description']
    }
  },
  required: ['colors', 'analysis']
};

const CHARACTER_PROMPT = `你是电影角色设计的色彩分析师。只分析参考图中的人物主体，尽量排除背景、布景和环境大色块的干扰。
识别肤色、发色、服装主色与辅助色、妆容、饰品、人物高光、人物阴影和小面积但醒目的强调色。提取5至8种对角色设计真正有用的颜色，不能只按像素数量排序。小面积高饱和色若形成视觉焦点，标为Accent。
为每种颜色输出中文名称、严格六位HEX、视觉占比（总和100）和角色Primary/Secondary/Accent/Highlight/Shadow。再分析色温、明度、饱和度、对比度、色相关系、整体倾向、高光与阴影倾向，并用一句自然中文总结。不得让背景色主导结果。`;

const ENVIRONMENT_PROMPT = `你是影视美术与环境概念设计的色彩分析师。只分析参考图中的场景/环境色彩体系；如画面中有人物，降低肤色、发色和服装色的权重，不得让人物主导结果。
识别环境主色、建筑与材质、天空或自然环境、环境光、氛围色、高光、阴影和小面积醒目的强调色。提取5至8种对空间设计真正有用的颜色，不能只按像素数量排序。小面积高饱和色若形成空间视觉焦点，标为Accent。
为每种颜色输出中文名称、严格六位HEX、视觉占比（总和100）和角色Primary/Secondary/Accent/Highlight/Shadow。再分析色温、明度、饱和度、对比度、色相关系、整体倾向、高光与阴影倾向，并用一句自然中文总结。`;

function normalizeHex(value: unknown): string | null {
  const text = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(text) ? text : null;
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const scope = body.scope === 'character' ? 'character' : body.scope === 'environment' ? 'environment' : '';
    const fileUrl = String(body.file_url || '');
    if (!scope || !fileUrl) return Response.json({ error: '缺少色卡作用域或参考图片' }, { status: 400 });
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: scope === 'character' ? CHARACTER_PROMPT : ENVIRONMENT_PROMPT,
      response_json_schema: SCHEMA,
      file_urls: [fileUrl]
    });
    const colors = (Array.isArray(result.colors) ? result.colors : []).map((color: any) => ({
      name: String(color.name || '').slice(0, 30), hex: normalizeHex(color.hex),
      percentage: Math.max(0, Math.min(100, Number(color.percentage) || 0)),
      role: ['Primary', 'Secondary', 'Accent', 'Highlight', 'Shadow'].includes(color.role) ? color.role : 'Secondary'
    })).filter((color: any) => color.hex).slice(0, 8);
    if (colors.length < 2) throw new Error('色彩分析结果不足，请重试');
    const total = colors.reduce((sum: number, color: any) => sum + color.percentage, 0) || 1;
    colors.forEach((color: any) => { color.percentage = Math.round(color.percentage / total * 100); });
    colors[0].percentage += 100 - colors.reduce((sum: number, color: any) => sum + color.percentage, 0);
    return Response.json({ colors, analysis: result.analysis });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
