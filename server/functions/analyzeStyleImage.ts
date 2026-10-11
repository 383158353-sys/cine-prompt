import { createClientFromRequest } from './local-client.mjs';

const CATEGORY_LABELS: Record<string, string> = {
  hair: '发型',
  makeup: '化妆',
  clothing: '服装',
  overall: '总体形象'
};

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: '简短中文名称(2-8字)' },
    description: { type: 'string', description: '中文风格描述(1-2句)' },
    style_prompt: { type: 'string', description: '英文风格替换提示词(用于局部替换)' }
  },
  required: ['name', 'description', 'style_prompt']
};

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const fileUrls: string[] = Array.isArray(body.file_urls) ? body.file_urls : [];
    const text = (body.text || '').toString().trim();
    const category = (body.category || 'hair').toString();
    const categoryLabel = CATEGORY_LABELS[category] || category;

    if (fileUrls.length === 0 && !text) return Response.json({ error: '请上传图片或输入文本' }, { status: 400 });

    const results = [];

    // 文本模式：根据文本生成风格信息 + 自动生成缩略图
    if (text && fileUrls.length === 0) {
      const styleRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `根据以下${categoryLabel}描述，生成风格信息：
描述：${text}
要求：
- name: 简短中文名称(2-8字)，概括该${categoryLabel}风格
- description: 中文风格描述(1-2句)，说明该${categoryLabel}的视觉特征
- style_prompt: 英文风格替换提示词，用于将该${categoryLabel}风格替换到其他图片的对应部位，应包含具体的视觉特征描述`,
        response_json_schema: SCHEMA
      });
      // 生成缩略图
      let thumbnailUrl = '';
      try {
        const imgRes = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt: `A professional close-up portrait photo showing ${styleRes.style_prompt}, ${categoryLabel} style reference, clean neutral background, studio lighting, high quality, detailed, photorealistic`
        });
        thumbnailUrl = imgRes.url || '';
      } catch {}
      results.push({
        name: styleRes.name,
        description: styleRes.description,
        style_prompt: styleRes.style_prompt,
        thumbnail_url: thumbnailUrl,
        category,
        gender: 'unisex'
      });
    }

    // 图片模式：分析每张图片
    for (const url of fileUrls) {
      const prompt = `分析这张图片中的${categoryLabel}风格特征，提取可用于AI图像生成局部风格替换的提示词。
要求：
- name: 简短中文名称(2-8字)，概括该${categoryLabel}风格
- description: 中文风格描述(1-2句)，说明该${categoryLabel}的视觉特征
- style_prompt: 英文风格替换提示词，用于将该${categoryLabel}风格替换到其他图片的对应部位，应包含具体的视觉特征描述`;
      const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: SCHEMA,
        file_urls: [url]
      });
      results.push({
        name: res.name,
        description: res.description,
        style_prompt: res.style_prompt,
        thumbnail_url: url,
        category,
        gender: 'unisex'
      });
    }

    return Response.json({ results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}