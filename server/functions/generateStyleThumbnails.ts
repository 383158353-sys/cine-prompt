import { createClientFromRequest } from './local-client.mjs';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 50, 100);

    // 拉取所有缺少缩略图的风格库记录
    const all = await base44.asServiceRole.entities.StyleLibrary.list('-updated_date', 200);
    const needThumb = all.filter((s: any) => !s.thumbnail_url).slice(0, limit);
    if (needThumb.length === 0) return Response.json({ message: '无需生成', total: 0 });

    const BATCH = 3;
    let success = 0, fail = 0;
    for (let i = 0; i < needThumb.length; i += BATCH) {
      const batch = needThumb.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(async (s: any) => {
        const prompt = `${s.style_prompt}, portrait headshot showing the style, clean plain background, high quality, detailed, studio lighting, photorealistic`;
        const res = await base44.asServiceRole.integrations.Core.GenerateImage({ prompt });
        if (res?.url) {
          await base44.asServiceRole.entities.StyleLibrary.update(s.id, { thumbnail_url: res.url });
          return s.name;
        }
        throw new Error('no url returned');
      }));
      for (const r of results) {
        if (r.status === 'fulfilled') success++;
        else fail++;
      }
    }
    return Response.json({ total: needThumb.length, success, fail });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}