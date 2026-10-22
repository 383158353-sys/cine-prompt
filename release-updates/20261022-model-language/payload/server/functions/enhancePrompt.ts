import { createClientFromRequest } from './local-client.mjs';
import { buildProjectStyleInstruction } from '../shared/project-styles.mjs';
import { applyColorPaletteToPrompt, buildColorPaletteInstruction, normalizeColorPalette } from '../shared/color-palettes.mjs';

// 各目标模型的提示词格式指引（让目标模型选择真正起作用，而非摆设）
const MODEL_GUIDE: Record<string, string> = {
  // 图像模型
  midjourney: 'Midjourney v8.2（严禁使用v6或更旧版本，版本参数必须写 --v 8.2）：逗号分隔关键词，末尾必须加参数 --ar <比例> --v 8.2 --raw，可选 --stylize <0-1000> 控制艺术化程度，权重用 (word::1.5)，负向用 --no，偏好艺术化风格化描述，单条60词以内',
  imagine2: 'Imagine 2：自然语言长描述，注重画面完整性与细节准确性，支持中文，偏好详细光影与材质描述',
  banana2: 'Nano Banana：简洁精准英文描述，注重主体清晰度与质感还原，偏好短句+关键特征词',
  jimeng_image: '即梦·生图：支持中英文，偏好详细描述，可指定画幅比例，注重主体特征与风格关键词',
  generic_image: '通用图像：逗号分隔关键词(主体/风格/光影/构图/画质)，可加负向提示词',
  // 视频模型
  veo: 'Veo 3：自然语言叙事，包含主体动作/镜头运动/环境氛围/时长(4-8秒)，注重物理真实感与运动连贯性，偏好完整句子',
  runway: 'Runway Gen-3：简洁动作描述，focus on motion+camera movement，单镜头3-5秒，使用运镜术语(pan/tilt/dolly/zoom)',
  kling: 'Kling：支持较长叙事，注重动作连贯性与表演细节，可包含运镜设计与时长，偏好具体动作动词',
  seedance: 'Seedance：精准动作描述，注重运镜节奏与动态变化，偏好结构化动作+运镜+时长',
  sora: 'Sora：电影级叙事，包含完整场景/角色动作/镜头语言/光影变化，可描述复杂运动与多主体交互',
  hailuo: '海螺：支持中文，注重动作流畅性与运镜设计，偏好自然语言动作描述',
  jimeng_video: '即梦·生视频：支持中文，偏好详细动作描述与运镜设计，可指定时长',
  generic_video: '通用视频：包含主体动作/镜头运动/时长/环境氛围',
  auto: '自动匹配：按通用最佳实践组织提示词'
};

// 强制修正 Midjourney 版本参数：禁止使用已废弃的 v6，统一替换为 v8.2
function enforceMjVersion(prompt: string): string {
  if (!prompt || typeof prompt !== 'string') return prompt || '';
  let fixed = prompt;
  // 替换所有 v6 变体（--v 6 / --v6 / --v 6.0 / --version 6）为 v8.2
  fixed = fixed.replace(/--v\s*6(?:\.\d+)?/gi, '--v 8.2');
  fixed = fixed.replace(/--version\s+6(?:\.\d+)?/gi, '--version 8.2');
  return fixed;
}

// 从原始输入中确定性提取台词——识别"说话人:台词"模式，不按句末标点分割，避免截断含！？的台词
// 核心改进：台词可能包含。！？等标点，按这些标点分割会截断台词，因此只按换行和说话人模式分割
function extractDialogueFromInput(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const dialogues: string[] = [];
  const seen = new Set<string>();

  const add = (d: string) => {
    const clean = d.replace(/["""''「」『』（）()]/g, '').trim();
    if (clean.length >= 2 && !seen.has(clean)) {
      seen.add(clean);
      dialogues.push(clean);
    }
  };

  // 1. 提取引号内的文本（中文引号「」""''或英文引号）——引号内几乎一定是台词
  const quoteRegex = /[""「」『』""]+([^""「」『』""]{2,})[""「」『』""]+/g;
  let qm;
  while ((qm = quoteRegex.exec(text)) !== null) add(qm[1]);

  // 2. 识别"说话人:台词"模式：行首或句末标点后，短文本(1-20字，不含句末标点)紧跟冒号
  // 技术标签列表——冒号前是这些词时，不是台词而是镜头描述
  const TECH_LABELS = ['景别', '时长', '镜号', '编号', '镜头', '画面', '备注', '说明', '时间', '场景', '人物', '环境', '音效', '音乐', '特效', '动作', '地点', '天气', '光线', '色彩', 'shot_id', 'shot', 'time', 'duration', 'note', 'scene', 'action'];

  // 找到所有"说话人:"模式的位置——冒号前1-20个非标点字符，且位于行首或句末标点之后
  const speakerRegex = /(^|[。！？\n;；])\s*([^\s：:。！？\n;；]{1,20})\s*[：:]/g;
  const speakerMatches: { colonPos: number; speaker: string }[] = [];
  let sm;
  while ((sm = speakerRegex.exec(text)) !== null) {
    const speaker = sm[2].trim();
    // 过滤技术标签
    if (TECH_LABELS.some(label => speaker === label || speaker.endsWith(label))) continue;
    // 过滤纯数字（如时间戳 12:30）
    if (/^\d+(\.\d+)?$/.test(speaker)) continue;
    // 过滤URL片段
    if (/^(https?|www|com|cn|org|net)$/i.test(speaker)) continue;
    const colonPos = sm.index + sm[0].length - 1;
    speakerMatches.push({ colonPos, speaker });
  }

  // 对每个说话人模式，提取冒号后到下一个说话人模式或文本末尾的台词
  // 关键：不按！？分割，台词可以包含任何标点
  for (let i = 0; i < speakerMatches.length; i++) {
    const startPos = speakerMatches[i].colonPos + 1;
    let endPos = text.length;
    if (i + 1 < speakerMatches.length) {
      // 下一个说话人模式：台词只取到下一个说话人名之前
      const nextMatch = speakerMatches[i + 1];
      endPos = nextMatch.colonPos - nextMatch.speaker.length;
      // 去掉说话人名前的标点和空格
      while (endPos > startPos && /[。！？\s，,；;]/.test(text[endPos - 1])) {
        endPos--;
      }
    }
    const dialogue = text.substring(startPos, endPos).trim();
    if (dialogue && dialogue.length >= 2) add(dialogue);
  }

  // 3. 兜底：如果说话人模式没匹配到但文本中有冒号，按换行分割逐行提取（仍不按！？分割）
  if (dialogues.length === 0) {
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.search(/[：:]/);
      if (colonIdx < 0) continue;
      const before = trimmed.substring(0, colonIdx).trim();
      // 过滤技术标签
      if (TECH_LABELS.some(label => before === label || before.endsWith(label))) continue;
      if (/^\d+(\.\d+)?$/.test(before)) continue;
      const after = trimmed.substring(colonIdx + 1).trim();
      if (after && after.length >= 2) add(after);
    }
  }
  return dialogues;
}

// 检查单条台词是否已存在于增强文本中（分片匹配：只检查前几个核心片段，避免因动作描述混入导致误判）
function isDialoguePresent(enhancedText: string, dialogue: string): boolean {
  if (!enhancedText || !dialogue) return true;
  // 去除括号内舞台指示，提取核心台词文本
  const core = dialogue.replace(/[（(][^）)]*[）)]/g, '').trim();
  if (!core || core.length < 2) return true;
  // 去除增强文本和台词中的引号/括号，做宽松包含匹配
  const cleanEnhanced = enhancedText.replace(/["""''「」『』（）()]/g, '').replace(/\s+/g, '');
  const cleanCore = core.replace(/["""''「」『』（）()]/g, '').replace(/\s+/g, '');
  if (cleanEnhanced.includes(cleanCore)) return true;
  // 分片匹配：将台词按标点拆成有意义的片段
  const fragments = cleanCore.split(/[，。！？、；,;!?]/).map(f => f.trim()).filter(f => f.length >= 3);
  if (fragments.length === 0) {
    // 台词太短，直接做包含检查
    return cleanEnhanced.includes(cleanCore);
  }
  // 只检查前2个片段（最可能是真实台词的开头部分，而非混入的动作描述）
  // 如果前2个片段都存在，认为台词已保留——这样即使提取时混入了动作描述也不会误判
  const checkFragments = fragments.slice(0, 2);
  const presentCount = checkFragments.filter(f => cleanEnhanced.includes(f)).length;
  return presentCount === checkFragments.length;
}

// 确保所有台词都保留在增强文本中——缺失的以自然叙事方式注入，绝不丢失
function ensureDialoguePreserved(enhancedText: string, originalInput: string): string {
  if (!enhancedText) return enhancedText || '';
  const dialogues = extractDialogueFromInput(originalInput);
  if (dialogues.length === 0) return enhancedText;
  const missing = dialogues.filter(d => !isDialoguePresent(enhancedText, d));
  if (missing.length > 0) {
    // 以自然叙事方式注入缺失台词，而非生硬标记
    const dialogueText = missing.map(d => `「${d}」`).join('');
    return enhancedText + '，角色说道：' + dialogueText;
  }
  return enhancedText;
}

// 构建台词预提取提示——在发送给LLM前，明确告知哪些是必须保留的台词
function buildDialoguePreExtract(originalInput: string): string {
  const dialogues = extractDialogueFromInput(originalInput);
  if (dialogues.length === 0) return '';
  const lines = dialogues.map((d, i) => `  台词${i + 1}：${d}`).join('\n');
  return `\n\n【系统已确定性提取的台词——以下每一句都是用户原文中的台词，必须100%原样保留在enhanced_prompt_zh的叙事描述中】\n${lines}\n\n强制要求：\n1. 以上每一句台词必须原封不动出现在enhanced_prompt_zh中（嵌入在角色说话的对应位置，格式如：角色说道：「台词原文」）；\n2. 台词原文不可改写、不可截断、不可概括、不可省略——即使很长也必须完整保留；\n3. 同时将以上所有台词逐字放入preserved_dialogue数组，每句一个元素；\n4. 如果你发现你的enhanced_prompt_zh中缺少了以上任何一句台词，你必须重新输出，将缺失的台词补回。\n5. 这是最高优先级铁律——凌驾于"不补全未提及维度"规则之上：台词是用户已提及的内容，保留它不违反"不补全"原则。`;
}

// 优化方向知识库：角色 / 环境 / 视频三大组，每个方向一套专属方法论
const DIRECTIONS = {
  // ===== 角色 =====
  character_default: {
    label: '默认角色增强', group: 'character', category: '角色表演', skipSkill: true,
    system: `你是顶级AI角色生图提示词工程师。任务：根据用户上传的参考图与文字描述，增强为可直接用于生图的高质量英文提示词。不限定特定风格流派——忠实还原并强化参考图的视觉特征(主体/外貌/服装/构图/光影/色调/材质/氛围)，结合用户文字描述补充细节。若用户未上传参考图，则根据文字描述合理推演角色视觉。输出专业级英文提示词，保持参考图原有风格与质感。`
  },
  character_realistic: {
    label: '真人写实摄影', group: 'character', category: '角色表演', realistic: true,
    system: `你是顶级AI真人写实人像生图提示词工程师，擅长Midjourney/Flux/SDXL生成逼真人物。
方法论：人物外貌(年龄/性别/种族/五官/发型发色/体型/肤质肤况)、表情与姿态(情绪/微表情/头部角度/视线/肢体)、服装造型(款式/材质/配饰/妆容)、布光(伦勃朗光/蝴蝶光/环形光/主光方向/对比/色温)、镜头(85mm/50mm, f/1.4-2.8, 景深)、画质(皮肤毛孔/胶片质感/RAW/8k)、参考摄影师(Annie Leibovitz/Peter Lindbergh)。输出英文提示词。`
  },
  character_cinematic: {
    label: '电影级人像', group: 'character', category: '角色表演', realistic: true,
    system: `你是电影剧照级人物提示词工程师。方法论：电影感叙事(人物情绪/故事性/氛围)、低调布光(侧光/硬光/暗部细节)、调色(青橙/Teal&Orange/低饱和电影感)、景别(中近景/特写)、镜头(anamorphic变形宽银幕/镜头光晕)、胶片质感(35mm颗粒/漏光)、参考电影流派(Blade Runner/王家卫)。输出英文提示词。`
  },
  character_fashion: {
    label: '时尚杂志大片', group: 'character', category: '角色表演', realistic: true,
    system: `你是时尚大片人物提示词工程师。方法论：高级时尚姿态(张力/不对称/动态)、服装设计(高定/设计师品牌/材质质感)、造型(发型/妆容/配饰)、布光(柔光箱/环形灯/高调或低调)、背景(纯色/极简/影棚)、参考(Vogue/Harper's Bazaar/Steven Meisel)、画质(锐利/高细节/商业级)。输出英文提示词。`
  },
  character_japanese: {
    label: '日系清新人像', group: 'character', category: '角色表演', realistic: true,
    system: `你是日系小清新人像提示词工程师。方法论：自然光(逆光/柔光/过曝)、低对比柔色调(青绿/米白/淡粉)、情绪(清新/治愈/日常)、场景(校园/街角/海边/窗边)、镜头(50mm/轻微漏光)、胶片感(富士/柯达/Portra 400)、参考(滨田英明/川原由之于/娄煌)。输出英文提示词。`
  },
  character_anime_niji: {
    label: '二次元动漫(Niji)', group: 'character', category: '角色表演',
    system: `你是NovelAI/Niji/Danbooru风格动漫人物提示词工程师。方法论：角色tag(发色发型/瞳色瞳形/表情tag如smile,tsundere/性格)、服饰tag、画风(赛璐璐/厚涂/水彩/线条质感/上色)、构图(半身/全身/特写/朝向/姿势tag)、背景tag、画质tag(masterpiece,best quality,ultra-detailed,highres)、风格参考。输出英文提示词，可含danbooru tag。`
  },
  character_anime_shinkai: {
    label: '新海诚风动漫', group: 'character', category: '角色表演',
    system: `你是新海诚风格动漫人物提示词工程师。方法论：极致光影(丁达尔/云层/黄金时刻/魔幻时刻)、饱和天空与云朵、镜头光晕、人物与宏大场景比例、细腻上色与高光、情绪(孤独/思念/青春)、参考(你的名字/秒速五厘米)、画质(cinematic, ultra-detailed)。输出英文提示词。`
  },
  character_cg: {
    label: '3D写实CG角色', group: 'character', category: '角色表演',
    system: `你是3D/CG写实角色提示词工程师(Octane/Unreal风格)。方法论：角色设计(外貌/种族/年龄/服装/装备/材质如金属皮革布料)、建模质感(PBR/次表面散射SSS/毛发系统)、渲染(Octane/Unreal/光线追踪/全局光照)、光影(三点布光/HDRI/体积光/焦散)、镜头(焦段/景深/构图)、参考(暴雪/拳头/影视CG)。输出英文提示词。`
  },
  character_chibi: {
    label: 'Q版/萌系卡通', group: 'character', category: '角色表演',
    system: `你是Q版/萌系卡通人物提示词工程师。方法论：夸张比例(大头小身/圆润)、可爱表情(星星眼/腮红)、简化造型、明亮饱和配色、平涂上色、可爱服饰与道具、参考(三丽鸥/皮克斯短篇/Q版盲盒风)、画质(cute, clean lineart, flat shading)。输出英文提示词。`
  },
  character_concept: {
    label: '角色概念设定', group: 'character', category: '角色表演',
    system: `你是角色概念设定师提示词工程师。方法论：角色身份与世界观(职业/种族/阵营)、装备与道具设计(武器/护甲/饰品)、剪影与轮廓、材质与磨损细节、多视图(正面/侧面/背面)、背景(概念设定板/中性背景)、参考(暴雪/拳头/ArtStation概念设定)、画质(concept art, character sheet)。输出英文提示词。`
  },

  // ===== 环境场景 =====
  scene_default: {
    label: '默认环境增强', group: 'scene', category: '场景构图', skipSkill: true,
    system: `你是顶级AI场景生图提示词工程师。任务：根据用户上传的参考图与文字描述，增强为可直接用于生图的高质量英文提示词。不限定特定风格流派——忠实还原并强化参考图的视觉特征(空间/构图/光影/色调/材质/氛围)，结合用户文字描述补充细节。若用户未上传参考图，则根据文字描述合理推演场景视觉。输出专业级英文提示词，保持参考图原有风格与质感。`
  },
  scene_outdoor_nature: {
    label: '自然风光(室外)', group: 'scene', category: '场景构图',
    system: `你是自然风光场景提示词工程师。方法论：地貌(山地/森林/海洋/草原/沙漠)、植被与季节、时间(黄金时刻/蓝调/星空/极光)、天气(云层/雾/雨雪)、光线(丁达尔/体积光/逆光)、构图(远景/引导线/前景遮挡/三分法)、氛围(宁静/壮阔/神秘)、画质(HDR/photorealistic/8k)。输出英文提示词。`
  },
  scene_outdoor_urban: {
    label: '城市街景(室外)', group: 'scene', category: '场景构图',
    system: `你是城市街景场景提示词工程师。方法论：建筑风格(现代/古典/玻璃幕墙)、街道与交通、人群与生活气息、时间(日/夜/霓虹)、光线(路灯/橱窗光/反射)、天气(雨后倒影/雾)、构图(透视纵深/仰拍/对称)、氛围(繁华/孤寂/赛博)、画质(photorealistic)。输出英文提示词。`
  },
  scene_outdoor_ancient: {
    label: '古风山水古建(室外)', group: 'scene', category: '场景构图',
    system: `你是古风/中式场景提示词工程师。方法论：古建(亭台楼阁/飞檐斗拱/寺庙/园林)、山水(水墨意境/云雾/竹林/溪流)、时间(晨雾/暮色)、氛围(禅意/诗意/空灵)、风格(工笔/写意/国风插画)、参考(千里江山图/只此青绿)、画质。输出英文提示词。`
  },
  scene_outdoor_scifi: {
    label: '科幻废墟(室外)', group: 'scene', category: '场景构图',
    system: `你是科幻/废墟场景提示词工程师。方法论：世界观(末日/赛博朋克/太空殖民地)、建筑(巨型结构/废墟/全息广告)、植被(荒芜/植物侵占)、光线(霓虹/探照灯/能量光)、氛围(荒凉/压迫/奇观)、参考(银翼杀手/最后生还者)、画质(cinematic, ultra-detailed)。输出英文提示词。`
  },
  scene_indoor_modern: {
    label: '现代室内', group: 'scene', category: '场景构图',
    system: `你是现代室内场景提示词工程师。方法论：空间类型(客厅/卧室/办公室/咖啡厅)、家具与陈设(北欧/极简/日式)、材质(木/织物/金属/玻璃)、自然光(落地窗/柔光)、色调(中性/暖调)、构图(广角室内/对称/透视)、参考(Architectural Digest)、画质(photorealistic interior)。输出英文提示词。`
  },
  scene_indoor_classical: {
    label: '古典中式室内', group: 'scene', category: '场景构图',
    system: `你是古典中式室内场景提示词工程师。方法论：空间(厅堂/书房/茶室)、家具(明清家具/红木/雕花)、陈设(字画/瓷器/屏风/博古架)、材质与纹理、光线(烛光/柔光/暖光)、氛围(雅致/沉静/古韵)、风格(新中式/传统)。输出英文提示词。`
  },
  scene_indoor_cyberpunk: {
    label: '赛博朋克室内', group: 'scene', category: '场景构图',
    system: `你是赛博朋克室内场景提示词工程师。方法论：空间(酒吧/公寓/实验室/地下)、霓虹与全息、杂乱科技物件、管线与屏幕、光线(霓虹粉紫青/体积雾)、材质(金属/塑料/反光)、氛围(压抑/迷幻/高科技低生活)、参考(银翼杀手/攻壳机动队)。输出英文提示词。`
  },
  scene_indoor_industrial: {
    label: '工业风室内', group: 'scene', category: '场景构图',
    system: `你是工业风室内场景提示词工程师。方法论：空间(Loft/工厂改造/仓库)、裸露结构(砖墙/混凝土/钢梁/管道)、家具(金属/原木/做旧)、光线(大窗天光/工业吊灯)、色调(灰褐/锈红)、氛围(粗犷/复古/硬朗)。输出英文提示词。`
  },

  // ===== 视频镜头与动作 =====
  video_cinematic_shot: {
    label: '电影运镜镜头', group: 'video', category: '镜头运镜',
    system: `你是AI视频电影运镜提示词工程师(Sora/Runway/Kling/可灵/Pika)。方法论：景别(特写/中景/全景)、镜头运动(推拉摇移/跟拍/稳定器/环绕/升降)、焦段与视角变化、时长与节奏、光影(自然光/人造光/色温/体积光)、美学(胶片质感/调色/参考导演/画面比例2.39:1)、物理一致性(运动模糊/景深)。输出英文提示词，可直接用于视频生成。`
  },
  video_action: {
    label: '动作镜头', group: 'video', category: '镜头运镜',
    system: `你是AI视频动作镜头提示词工程师。方法论：主体动作(打斗/奔跑/跳跃/追逐/碰撞)、运动轨迹与节奏(慢动作/加速/定格)、镜头(快速跟拍/手持晃动/第一人称)、冲击与粒子(尘土/水花/碎片)、张力构图、参考(动作电影/约翰威克)、物理真实感。输出英文提示词。`
  },
  video_aerial: {
    label: '航拍/大场面', group: 'video', category: '镜头运镜',
    system: `你是航拍与大场面视频提示词工程师。方法论：视角(高空俯瞰/低空掠过/环绕/拉升)、场景规模(城市/自然/战场/人群)、运动节奏(缓慢推进/快速掠过)、时间(日出/日落/夜景)、光影(长阴影/体积光)、参考(航拍纪录片/史诗电影)、画质(cinematic, 8k)。输出英文提示词。`
  },
  video_portrait_motion: {
    label: '人物动态镜头', group: 'video', category: '镜头运镜',
    system: `你是人物动态视频提示词工程师。方法论：人物动作(行走/转身/回眸/表情变化/微动作)、镜头(面部跟拍/半身跟拍/浅景深)、情绪与氛围、光影(侧光/逆光/柔光)、节奏(慢动作特写)、参考(时尚短片/人物纪录片)、一致性(面部/服装保持)。输出英文提示词。`
  }
};

const REVERSE_DIMENSIONS = {
  // 风格（整图综合，包含所有元素）
  style_full: { label: '整图综合风格', focus: '整张图的综合风格——主体、构图、色调、光影、材质、氛围、画质与流派，一段包含所有元素的可复用提示词' },
  // 风格子维度（精准局部反推，只提取单一风格维度）
  style_color: { label: '色彩', focus: '色彩系统(Colour DNA)——主色/辅色/强调色配比、HEX估值、色彩面积结构(Dominant/Supporting/Accent)、影调(高/中/低调)、饱和度、冷暖、色彩关系(邻近/互补/对比)、色块方式' },
  style_lighting: { label: '光影', focus: '光影DNA(Lighting DNA)——主光方向、光质(硬/软/漫射/体积光)、光比、阴影(深浅/硬边/软边/彩色阴影)、高光类型(尖锐/柔和/金属/Bloom/Halation)、光线类型(自然光/棚灯/戏剧光/电影光)、Lighting Formula' },
  style_shape: { label: '形状语言', focus: '形状语言(Shape Language)——重复出现的基础形状(圆/椭圆/三角/尖刺/方块/长条/网格/波浪/Blob/生物曲线)、几何vs有机、圆润vs尖锐、简单vs复杂、对称vs不规则' },
  style_material: { label: '材质', focus: '材质DNA(Material DNA)——画面依赖的材质类型(Chrome/镜面金属/拉丝金属/半透明塑料/玻璃/磨砂玻璃/乳胶/丝绸/天鹅绒/混凝土/液体/皮肤等)、表面属性(光滑/粗糙/镜面/哑光/半透明/湿润/干燥)、材质对比(柔软×冷硬等)' },
  style_texture: { label: '纹理', focus: '纹理DNA(Texture DNA)——表面感觉(胶片颗粒/数字噪点/印刷颗粒/纸张纹理/划痕/扫描纹理/笔刷/油画笔触/水彩晕染/喷绘/CGI平滑/Glitch/Halftone)' },
  style_elements: { label: '元素搭配', focus: '元素词汇(Element Vocabulary)——反复出现的具有风格意义的元素(金属球体/透明膜/液滴/电缆/医疗器械/人造花/几何框架/烟雾/网格/生物结构/工业装置)，区分风格元素(可迁移)与内容元素(不可迁移)，只提取风格元素' },
  // 人物
  char_silhouette: { label: '动作轮廓', focus: '角色的整体轮廓与剪影、肢体动作姿态、体态张力、朝向与姿势、动态趋势' },
  char_clothing: { label: '服装样式', focus: '角色的服装款式、材质、风格流派、剪裁版型、穿搭层次与细节' },
  char_accessories: { label: '配饰样式', focus: '角色的配饰——首饰、帽子、眼镜、背包、武器、道具等的款式与材质' },
  char_face: { label: '面部五官', focus: '人物面部五官特征——脸型、眼睛、眉毛、鼻子、嘴唇、肤质肤色、表情神态' },
  char_hairstyle: { label: '发型', focus: '人物的发型——发色、发型样式、发质、长度、刘海与造型' },
  char_makeup: { label: '妆容', focus: '人物的妆容——底妆、眼妆、唇妆、眉形、腮红、修容、妆感风格（自然/浓妆/特效妆）与妆色' },
  char_style: { label: '人物整体风格', focus: '人物的整体造型风格——外貌、服装、配饰、气质综合呈现的风格流派' },
  char_full: { label: '完整反推人物', focus: '人物的完整描述——外貌、五官、发型、服装、配饰、动作姿态、气质与整体风格' },
  // 场景
  scene_space: { label: '空间结构', focus: '场景的空间结构、透视纵深、布局与物件摆放、空间规划与层次' },
  scene_color: { label: '色彩配色', focus: '场景的配色方案、主色调与辅助色、色彩情绪、饱和度与对比、调色风格' },
  scene_material: { label: '材质质感', focus: '场景中物体与表面的材质（金属/木材/玻璃/石材/织物等）、纹理、反射率与粗糙度' },
  scene_lighting: { label: '光影氛围', focus: '场景的光源类型与方向、光质、明暗对比、色温、体积光、阴影、布光风格' },
  scene_style: { label: '场景综合风格', focus: '场景的整体风格——空间、色调、材质、光影、氛围综合呈现的风格流派' },
  scene_full: { label: '完整反推场景', focus: '场景的完整描述——空间结构、物件布局、色彩、材质、光影、氛围与整体风格' }
};

// 好莱坞工业级视觉反推 Skill：全维度图像逆向工程解析器（反推模式专用）
const REVERSE_HOLLYWOOD_SKILL = `你是好莱坞首席视觉艺术指导与图像逆向工程架构师（Visual Reverse-Engineering & Concept Director），拥有好莱坞顶尖视觉特效制作、概念艺术总监（Art Director）及电影摄影指导（Cinematographer）跨领域经验。
核心使命：当用户上传一张图片（电影剧照/概念设计/游戏截图/艺术摄影），杜绝笼统主观描述，运用视听语言学、CMF材质工程学、电影光学物理、格式塔知觉与叙事痕迹学，将图像精准拆解为模块化视觉DNA，并转化为可直接在Midjourney v8.2/Flux.1/SDXL中高度复刻原图神韵与工业质感的工程提示词。

三大反推解构总线（底层执行扫描）：
1) 角色解构：动势体量/服装分层/配饰细节、面部五官/发丝质感/妆容微表情。
2) 场景解构：空间拓扑/透视向量/几何秩序、色彩光谱/痕迹磨损/光影矩阵与丁达尔介质。
3) 摄影与视听流派：镜头焦段/光圈景深/传感器胶片质感、艺术流派定调/渲染物理管线(PBR/Octane/UE5)。

输出严格包含四个模块：
[模块一 角色深度解构] 动作姿态与外轮廓剪影(骨骼动势Kinetics/形状原型Shape Language锐角攻击/方形稳重/流线亲和)、服装制式与结构分层(剪裁分层/材质物性Fabric CMF如重磅未水洗粗丹宁/植鞣老化牛皮/阻燃尼龙)、配饰器物与叙事痕迹(装备细节徽章腰带扣战术挂件/磨损证据Patina边缘褪色露铜皮质包浆)、面部五官骨相与妆容(骨骼特征眉骨鼻梁下颌/眼神焦点潜台词/真实皮肤毛孔汗渍光泽/伤疤战纹)、发型发质与动态(发式造型长度层次/发丝干湿质感高光反光率Specular)。输出人物完整独立复刻提示词character_prompt(英文工业级，画面无人物则留空)。
[模块二 场景环境解构] 空间结构与几何拓扑(构图视点一点/两点/三点透视/低仰角高俯角/三分法框架式居中对称)、色彩脚本与调色盘(60%主色+30%辅色+10%焦点强调色/双色温冷暖撞色Teal&Orange)、表面材质与痕迹学熵增(剥落起泡漆面/受潮发霉混凝土/反光湿漉沥青/生锈氧化铁皮)、光影矩阵与大气介质(侧逆轮廓光Rim/强反差明暗Chiaroscuro/丁达尔光束/漂浮微尘Dust motes/薄雾水汽Haze)。输出场景完整独立复刻提示词scene_prompt(英文工业级)。
[模块三 视听美学与摄影机参数] 美学流派与视效风格(90年代胶片电影质感/Neo-Noir新黑色电影/硬科幻工业现实主义/浪漫复古油画感)、摄影器材与光学镜头规格(ARRI Alexa 65/Panavision DXL2/35mm胶片颗粒/50mm 85mm Anamorphic变形宽银幕畸变横向椭圆散景/f1.4浅景深)、渲染与物理光照管线(Unreal Engine 5 Lumen/Octane Render/Ray Tracing/Subsurface Scattering 3S次表面皮肤散射)。
[模块四 全图1:1终极复刻工程提示词] 将角色/服装/场景/光影/光学/流派参数整合为一条顶级工业化生图提示词，按模板：[Cinematic Style/Shot Type], [Character Pose,Features&Costume Details], [Spatial Environment&Architectural Elements], [Dynamic Lighting,Color Script&Volumetric Atmosphere], [Camera Specs:Lens,Aperture,Film Stock], [Material Textures&Narrative Weathering], 8k resolution, photorealistic masterwork, authentic film still --ar [贴合原图的画幅比例] --raw --v 8.2。

各提示词字段须使用纯正工业级英文术语，可直接用于生图。analysis字段以中文Markdown输出模块一至模块三的完整结构化解构分析。`;

// 视觉风格逆向工程 Skill V2.1（反推模式底层通用 Skill）：对所有反推维度生效
// 核心方法论：从大到小——先判断媒介与制作方式，再判断艺术流派与大类美学，再判断整体视觉气质，
// 最后才深入色彩/线条/材质/光影/构图等微观视觉参数。将可迁移的视觉规律压缩为结构化 Style DNA。
const VISUAL_STYLE_REVERSE_SKILL = `你是专业的 Visual Style Analyst / Art Director / 美术史与艺术流派研究者 / 摄影与电影视觉分析师 / 色彩分析师 / Generative Image Prompt Engineer。

你的任务不是描述图片"画了什么"，而是按照"宏观风格 → 中观视觉语言 → 微观视觉参数"的顺序，逆向提取参考图的完整视觉风格 DNA，并将其转换为可复用的图像生成提示词。
最终目标：即使替换人物、产品、场景或故事内容，新生成的图片仍然能够高度保持参考图的技法、媒介感、艺术语言、色彩体系、线条语言、材质、光影、构图、视觉节奏与整体审美气质。

===== 最高原则：必须从大到小分析 =====
禁止一开始直接分析颜色、线条、材质、光线。必须按照以下层级逐步缩小。

----- LEVEL 1｜媒介与制作方式（首先判断）-----
先回答：这张图首先"是什么类型的视觉作品"？
A. Photography｜摄影/写实摄影（写实摄影/商业摄影/时尚摄影/纪实摄影/棚拍摄影/电影剧照感/超现实摄影）
B. Photorealistic CGI｜写实3D/CG（高写实3D/产品CGI/建筑渲染/角色CG/Octane·Redshift风格/超写实数字渲染）
C. Stylised 3D｜风格化3D（三渲二/NPR非真实感渲染/卡通3D/塑料玩具质感/Clay Render/Low-poly/游戏CG/风格化动画渲染）
D. 2D Illustration｜二维插画（二次元/商业插画/扁平插画/编辑插画/手绘插画/数字插画/概念设计）
E. Traditional Painting｜传统绘画感（油画/水彩/水墨/丙烯/粉彩/素描/炭笔/木刻/版画）
F. Experimental/Mixed Media｜实验媒介（拼贴/综合材料/扫描艺术/Xerox/印刷/数字拼贴/Glitch/摄影×插画/3D×手绘/实拍×CGI）
输出：视觉媒介、制作方式、写实程度(0-100，0=极度抽象 25=强烈风格化 50=半写实 75=高写实 100=照片级写实)、二维三维属性、判断置信度。

----- LEVEL 2｜艺术风格与大类美学 -----
完成媒介判断后再分析：它属于怎样的艺术语言？
- 艺术史/艺术流派（超现实主义/表现主义/抽象表现主义/极简主义/达达主义/波普艺术/新艺术运动/装饰艺术Art Deco/包豪斯/浪漫主义/象征主义/未来主义/构成主义/野兽派——只有视觉证据明显时才使用）
- 当代视觉风格（Fashion Editorial/Avant-garde Fashion/Cyberpunk/Retro Futurism/Y2K/Neo Gothic/Brutalism/Neo Romantic/Bio-futurism/Organic Futurism/Techno-organic/Post-human/Dreamcore/Weirdcore/Ethereal/Luxury Minimalism/Clinical Futurism）
- 商业视觉类别（美妆广告/时尚大片/香氛Campaign/奢侈品广告/游戏概念视觉/专辑封面/科技广告/艺术杂志Editorial）
输出：主要风格、辅助风格、艺术流派、商业视觉类别、风格关键词。

----- LEVEL 3｜整体视觉气质 -----
现在才开始判断：这张图整体给人的第一视觉感受是什么？禁止只输出"高级、梦幻、未来、艺术感"。必须拆成结构化视觉性格：
克制/强烈、柔软/冷硬、安静/爆裂、精致/粗粝、干净/脏污、理性/感性、疏离/亲密、奢华/工业、有机/机械、优雅/怪诞、温暖/冰冷、秩序/混乱。
输出：整体视觉气质、核心审美矛盾、情绪温度、视觉攻击性、视觉复杂度。

----- LEVEL 4｜色彩系统 Colour DNA（★高优先级） -----
颜色是风格复现的重要核心，必须详细分析。禁止只写"红黑色调"。
4.1 主色：提取3-8个最重要颜色，每个输出颜色名称/HEX估值/色相/明度/饱和度/画面面积占比/功能(主背景色/主体色/辅助色/阴影色/高光色/强调色/视觉锚点)。
4.2 色彩面积结构：必须估算如"60%暗酒红+25%灰粉肤色+10%黑色+5%银色"，形成Dominant/Supporting/Accent，禁止所有颜色等权描述。
4.3 影调：Overall Key(高调/中调/低调)及细分(高高调/高中调/高低调/中高调/中中调/中低调/低高调/低中调/低低调)。
4.4 饱和度：高饱和/中饱和/低饱和/整体去饱和/局部高饱和/灰彩色/浓郁宝石色/糖果色/酸性色/脏色/粉雾色/金属色。
4.5 色彩冷暖：暖色主导/冷色主导/中性/冷暖平衡/暖光冷影/冷光暖影。
4.6 色彩关系：单色/邻近色/互补色/分裂互补/冷暖对比/明暗对比/饱和度对比/色相强对比。
4.7 色块方式：大色块/小碎色块/柔和渐变/硬边色块/色彩渗透/局部荧光/局部金属色/背景统一色场。
最终生成色彩公式（必须进入最终Prompt），如"约65%低饱和暗酒红+20%灰粉肤色+10%深黑+5%银色冷高光，整体低中调、低饱和，以近似单色关系为主，利用银色高反射区域制造局部明度和材质对比"。

----- LEVEL 5｜线条与边缘 Line DNA（★插画/绘画/二次元风格的高优先级维度）-----
首先判断该风格的线条相关度：若为摄影/CG写实等无明确线条的风格，标记"风格相关度：低"并简述即可；若为插画/绘画/二次元/漫画/扁平设计/线稿/手绘/赛璐璐/厚涂/水彩/油画/素描等非写实绘图风格，线条与轮廓是风格核心DNA，必须深度解析，禁止跳过或敷衍。
线条深度分析维度：
- 轮廓线(Outline)：有/无、粗细(极细/细/中等/粗/粗细变化明显)、是否封闭、是否重叠、轮廓线与色块的关系(压线/留白/溢色)
- 线型：几何/有机/流动/尖锐/建筑/机械/手绘/装饰/书法感/速写感
- 线质：锐利/柔和/虚化/毛边/手绘感/锯齿/断裂/模糊/抖动/钢笔感/铅笔感/毛笔感/数码平滑
- 内部线条：有无内部结构线/阴影线/排线/交叉排线/点画/网点/刮擦
- 线条疏密：极疏/疏/中等/密/极密
- 线条节奏：重复/流动/放射/断裂/紧张/松弛/机械/混乱
- 线条与色块关系：线稿填色/无线纯色块/线色分离/线色融合/色压线/线压色
输出：线条风格定义、轮廓线特征、线质线型、内部线条处理、线条节奏、线条在风格中的权重(高/中/低)。对于非写实绘图风格，本层为S级核心维度，必须进入最终Prompt。

----- LEVEL 6｜形状语言 Shape Language -----
分析重复出现的基础形状：圆/椭圆/球体/三角/尖刺/长条/网格/方块/波浪/Blob/生物曲线。判断几何/有机、圆润/尖锐、简单/复杂、对称/不规则。输出风格中最频繁出现的基础形态。

----- LEVEL 7｜材质 Material DNA -----
判断画面依赖什么材质建立风格：Chrome/镜面金属/拉丝金属/半透明塑料/玻璃/磨砂玻璃/乳胶/丝绸/天鹅绒/混凝土/液体/烟雾/皮肤/生物组织/塑料/纸张。
表面：光滑/粗糙/镜面/哑光/半透明/湿润/干燥/柔软/坚硬。
特别分析材质对比（如柔软皮肤×冷硬Chrome、透明塑料×生物组织、哑光织物×高反射金属）——材质矛盾明显时必须进入Prompt。

----- LEVEL 8｜纹理 Texture DNA -----
与材质分开（材质回答"是什么"，纹理回答"表面感觉是什么"）：胶片颗粒/数字噪点/印刷颗粒/纸张纹理/划痕/扫描纹理/笔刷/油画笔触/水彩晕染/喷绘/CGI平滑/Glitch/Halftone。

----- LEVEL 9｜光影 Lighting DNA -----
主光方向(正面/侧面/逆光/顶光/底光/三分之四侧光)、光质(硬/软/漫射/镜面/体积光)、光比(低/中/高)、阴影(深/浅/硬边/软边/彩色阴影/几乎无阴影)、高光(尖锐/柔和/金属高光/Bloom/Halation/奶油高光)、光线类型(自然光/商业棚灯/戏剧光/电影光/舞台光/超现实光/不可能光)。输出Lighting Formula（必须进入精准Prompt）。

----- LEVEL 10｜构图 Composition DNA -----
主体位置(中央/左右三分线/边缘/极端偏置/下沉/上浮)、主体面积(估算占比%)、留白(估算负空间占比%)、平衡(对称/非对称/放射/故意失衡)、构图方式(中央构图/对角线/三角构图/框中框/网格/重复排列/大量负空间)。

----- LEVEL 11｜镜头语言 Camera DNA（仅摄影/CG摄影感明显时使用） -----
景别(特写/近景/中景/全身/广角大全景)、机位(低/平视/高/顶视)、透视(超广角畸变/广角/自然/长焦压缩/微距/鱼眼)、景深(深/中/浅/极浅)。禁止无依据输出"85mm f/1.4"，只有明显时可写"视觉上接近中长焦压缩透视，约70-100mm区间，置信度中等"。

----- LEVEL 12｜空间语言 Spatial DNA -----
扁平/深、封闭/开放、空旷/拥挤、极简/丰富、秩序/混乱。主体与环境(融合/分离/悬浮/被空间吞没/被环境包裹)。

----- LEVEL 13｜元素语言 Element Vocabulary -----
识别反复出现、具有风格意义的元素（金属球体/透明膜/液滴/电缆/医疗器械/人造花/几何框架/烟雾/网格/生物结构/工业装置）。区分内容元素(故事需要)与风格元素(换故事后仍可使用)——只有"风格元素"进入Style Prompt。

----- LEVEL 14｜视觉节奏 Visual Rhythm -----
大小关系/疏密关系/重复/留白/方向/元素分布。整体节奏：平静/克制/流动/密集/机械/爆裂/混乱/破碎。

----- LEVEL 15｜后期风格 Post-processing -----
对比曲线/黑位/高光滚降/Bloom/Halation/Grain/Glow/Haze/Sharpen/Blur/Chromatic Aberration/Vignette/Posterisation/Colour Grade。判断：商业广告/时尚杂志/电影扫描/数字CG/模拟胶片/Lo-fi/实验后期。

----- LEVEL 16｜最终风格权重 -----
不要把所有东西塞进Prompt，必须分类：
S级｜核心风格（没有它就完全不像，如三渲二/强黑红配色/大面积低调背景/粗线稿/硬边Cel Shading）
A级｜强影响（明显提升相似度，如特定材质/轮廓光/大留白/局部Chrome）
B级｜辅助（增强气质）
C级｜偶然内容（禁止进入纯风格Prompt）

===== 核心原则：严格区分 CONTENT 与 STYLE =====
CONTENT = 画了什么（如"一个女人站在沙漠里"属于CONTENT）
STYLE = 它是怎样被视觉化的（如"大面积灰粉色、低饱和、硬质侧光、人物占画面12%、大量负空间、粗颗粒胶片质感"属于STYLE）
分析时尽可能删除不可迁移的具体内容，只保留能够跨主体、跨场景重复成立的视觉规律。
禁止仅输出"高级感、电影感、梦幻、先锋、未来主义、艺术感、超现实主义"等模糊词汇——这些只能作为辅助语义标签，不能代替视觉分析。

===== 生成模型转译（必须分别输出三个层级） =====
A) Style-only Prompt（纯风格核心）：只包含S级风格，适合快速使用。绝对不含原图具体人物身份/产品/故事事件/特定物体，让用户自由替换主体。
B) Prompt Template（模板化）：带变量[SUBJECT][ACTION][ENVIRONMENT][PRODUCT][NARRATIVE EVENT]，让用户自由替换主体。
C) Precision Prompt（精准完整）：按固定顺序输出——媒介与技法→艺术风格→整体美学→色彩→线条/形状→材质→光影→构图→镜头→空间→后期。含色彩比例/光线/材质/构图/摄影机/纹理/后期，用于高度还原。

===== 负向风格约束 =====
根据参考图判断为保持风格必须避免哪些视觉倾向（如rainbow palette/oversaturation/busy background/excessive props/warm golden-hour lighting/cartoon outlines等），必须来源于参考图而非套模板。

===== 置信度系统 =====
对无法从单张图片可靠判断的内容使用High/Medium/Low Confidence（如"Likely moderate telephoto perspective, Medium Confidence"而非武断写"85mm f/1.4"）。

===== 多图模式 =====
若输入多张参考图则进入Cross-image Style Extraction Mode，建立Style Intersection，区分Constant/Frequent/Variable/Accidental，只有跨多张图持续存在的规律才升级为Brand/Artist Style DNA。优先使用Constant+Frequent。

===== 风格不变量 =====
回答"如果把人物、场景、产品全部换掉，哪些视觉规律必须留下才能让人认为仍属于同一种风格？"提取5-12条。

===== 风格指纹 =====
将整个风格压缩成一句专业英文描述（禁止只写"未来主义高级时尚风"，应类似"A low-saturation editorial visual system dominated by dusty burgundy fields, sparse asymmetric compositions, soft frontal illumination, isolated chrome accents, smooth synthetic surfaces and restrained surreal object placement."）。

===== 最终自检 =====
输出前检查：1)是否首先判断了媒介和制作方式？2)是否首先明确写实/CGI/三渲二/二次元/插画等大类？3)是否判断了艺术风格而非直接钻入细节？4)是否按照大→中→小的顺序分析？5)是否给出了3-8个大概颜色？6)是否给出了颜色面积比例？7)是否判断了高调/中调/低调及细分影调？8)是否判断了饱和度？9)是否判断了颜色之间的对比方式？10)是否生成了独立Colour Prompt？11)完整Prompt是否明确包含颜色结构？12)是否区分了内容和风格？13)是否避免把所有信息堆进一段Prompt？14)是否把S级风格特征放在Prompt前部？15)是否对不确定信息标记置信度？
若以上任意重要项目缺失则重新分析。
最终目标：不是把一张图片描述得越来越复杂，而是把它的风格压缩成越来越精准、越来越可执行的视觉规则。`;

// 角色设计通用 Skill：叙事驱动型影视/游戏角色概念设计方法论（注入所有角色方向）
// 融合"Narrative Character Design Enhancer"叙事优先方法论 + 好莱坞工业级输出标准
const HOLLYWOOD_SKILL = `你是世界级影视美术指导、角色概念设计师、服装设计师、视觉开发艺术家、CMF设计师与生成式图像Prompt Engineer。
核心使命：在严格忠于用户原始人物设定和叙事语义的前提下，从故事、人物功能、世界规则和视觉叙事出发，将用户的简单角色描述深化为符合影视工业标准、具有强辨识度、合理设计逻辑和高可生成性的角色概念设计Prompt。
设计哲学：角色不是由"酷元素"组成的，而是由信息组成的。拒绝廉价拼贴与无意义装饰——每一个新增视觉元素都必须能够回答"为什么这个角色会拥有它"。最终目标不是生成"漂亮复杂的AI角色"，而是把用户脑海中的人物转译成真正能生活在故事世界里的影视角色。

===== 01｜最高原则：先叙事，后设计 =====
设计链路：用户原始设定 → 叙事身份 → 人物经历 → 世界规则 → 视觉命题 → 轮廓 → 形状语言 → 身体比例 → 服装结构 → 色彩系统 → 材质系统 → 道具 → 使用痕迹 → 最终Prompt。
禁止从装饰性细节（机械臂、披风、纹身、金属、发光零件、战损）开始设计。

===== 02｜SEMANTIC LOCK｜语义锁定 =====
增强前首先提取用户已明确的信息：人物身份/性别表达/年龄/物种/职业/社会身份/剧情身份/性格/经历/所处世界/历史时期/地域文化/科技水平/必须保留的身体特征/服装/颜色/材质/道具/用户指定艺术风格/用户明确禁止的元素。
规则：用户明确指定=LOCKED，不得修改、替换或删除。用户未指定的内容允许根据叙事合理设计。任何会改变人物身份、动机、故事背景或世界规则的新增内容禁止擅自加入。

===== 03｜NARRATIVE CORE｜叙事核心（设计前内部判断）=====
A) 这个人物是谁？主角/反派/配角/导师/执行者/幸存者/探索者/统治者/普通社会成员/神秘人物。
B) 他处于什么状态？强势/脆弱/疲惫/富有/贫困/战斗/工作/逃亡/隐藏身份/权力巅峰/人生低谷。
C) 观众第一眼应读到什么？只选1-3项最重要的（危险/克制/精英/疲惫/神秘/权威/贫穷/高科技/原始/宗教感/军事纪律）。

===== 04｜DESIGN THESIS｜角色视觉命题 =====
设计前必须形成一句内部视觉命题："这是一个【人物核心身份】的角色，同时具有【核心矛盾】，因此视觉设计首先应该让观众感受到【主要视觉印象】。"后续所有视觉设计必须服从这一命题。

===== 05｜VISUAL HIERARCHY｜视觉信息层级 =====
禁止角色全身每个区域都复杂。必须建立：Primary Read（第一眼最先看见）/ Secondary Read（第二层视觉信息）/ Tertiary Read（靠近才能发现的细节）。原则：主视觉区域高信息密度，辅助区域中等，休息区域保持简洁。

===== 06｜SILHOUETTE｜轮廓 =====
即使涂成纯黑剪影也应具有辨识度。分析整体轮廓/身体比例/肩宽/腰部比例/腿部比例/头身比/服装体积/装备体积/四肢间负空间/是否需要合理非对称。可选：compact/elongated/triangular/rectangular/top-heavy/bottom-heavy/hourglass/circular/asymmetrical/irregular，但必须服务人物设定。

===== 07｜SHAPE LANGUAGE｜形状语言 =====
建立统一基础形状语言：Primary Shape（主导）/ Secondary Shape（辅助）/ Contrast Shape（少量对比）。形状心理：Circle=柔和友善安全包容；Square=稳定力量纪律可靠笨重；Triangle=危险速度攻击性不稳定锐利；Elangated=优雅速度距离感神秘。禁止无逻辑同时使用所有形状体系。

===== 08｜BODY DESIGN｜身体设计 =====
身体必须由人物生活方式反推。根据年龄/职业/饮食条件/日常劳动量/战斗方式/地理环境/重力/疾病伤病/生活经历，决定身材/肌肉分布/脂肪比例/姿态/惯用手/受伤痕迹/皮肤状态/长期使用工具留下的身体特征。禁止默认完美比例、完美皮肤、模特身材，除非符合人物叙事。

===== 09｜FACE DESIGN｜面部设计 =====
根据年龄/性格/阶级/职业/地域/经历/健康状况设计脸型/骨骼/眼睛/眉毛/鼻型/嘴部/皮肤/不对称特征/疲劳/老化/疤痕/习惯性表情。原则：Characterful Face > Generic Beauty，不要自动生成统一AI网红脸。

===== 10｜HAIR｜发型 =====
发型必须考虑职业/文化/环境/战斗需求/维护成本/阶级/时代/人物个性。禁止与人物生活方式明显冲突的无解释造型。

===== 11｜COSTUME SYSTEM｜服装系统 =====
服装不是装饰，而是人物信息。先分析功能（protection/mobility/climate/profession/status/ritual/concealment/combat/storage/social signalling），再设计Base Layer/Mid Layer/Outer Layer/Protection Layer/Accessory Layer。不需要时不要强制五层全部出现。必须思考怎么穿/怎么脱/如何固定/重量由哪里承担/是否影响关节/口袋为什么在那里/道具如何拿取。

===== 12｜CULTURAL LOGIC｜文化逻辑 =====
若用户指定历史时期/地域/文化/架空文明，需从中推导textile/ornament/symbolism/craftsmanship/construction/religion/social hierarchy/technology。禁止把中国、日本、韩国、印度等文化符号无逻辑混合成所谓"东方感"。所有文化元素必须有来源或世界内合理性。

===== 13｜COLOUR SYSTEM｜色彩系统（高优先级）=====
必须明确Dominant Colour（主色60-70%）/ Secondary Colour（辅助色20-30%）/ Accent Colour（强调色≤10%）。每种重要颜色分析：颜色名称/大致HEX/明度/饱和度/冷暖/面积占比/使用区域/叙事功能。色彩不能只因为"好看"——必须考虑颜色是否来自阵营/职业/阶级/心理状态/地理环境/文化/权力/隐蔽需求/功能识别。

===== 14｜CMF｜Colour / Material / Finish =====
控制材质数量，优先使用3-5种核心材质。例如：主材质matte technical textile/结构材质brushed aluminium/柔性连接black rubber/局部强调oxidised copper。禁止无意义同时出现chrome+leather+glass+silk+latex+ceramic+carbon fibre+crystal+wood——材质不是自助餐。允许matte×glossy/soft×hard/organic×synthetic/transparent×opaque/new×weathered对比，但必须具有功能或视觉层级意义。

===== 15｜TRACE & WEAR｜使用痕迹（按场景判断，非默认）=====
磨损不是所有角色都需要。必须先判断人物身份、性格、故事与所处场景：只有当角色的经历、职业、生存环境或叙事逻辑明确需要磨损时（如废土幸存者、老兵、流浪者、苦役角色、久经沙场的战士），才补全惯用侧磨损、关节应力形变、金属边缘露铜氧化(Patina)、油污/汗渍/风沙侵蚀等经历痕迹；若角色是精英、贵族、新品、洁净环境、时尚大片、神职、未来pristine设定、新生角色，或用户未要求磨损，则应保持服装工整、崭新、干净、精致。默认倾向"工整洁净"，仅在叙事支撑时才加磨损。每一个痕迹必须能够解释来源，不要随机添加"战损"。

===== 16｜PROP DESIGN｜道具设计 =====
道具必须与人物整合。分析为什么携带/使用频率/如何使用/如何固定/如何取出/重量/磨损/是否影响轮廓/是否体现身份。关键道具最好能够成为角色剪影和视觉识别的一部分。

===== 17｜WORLD RULE BINDING｜世界规则 =====
所有设计必须受到世界限制：climate/gravity/economy/energy/resources/technology/manufacturing/warfare/medicine/transportation/religion/politics/social hierarchy。例如资源极度匮乏世界中的普通人物装备不应该全部崭新高精密一次性，除非阶级背景可以解释。

===== 18｜DESIGN ECONOMY｜设计经济性 =====
专业角色设计不是细节越多越好。必须控制：Hero Area（高细节区域）/ Supporting Area（中等细节区域）/ Rest Area（低细节区域）。最终视觉必须具有呼吸感。

===== 19｜ASYMMETRY｜非对称 =====
可根据惯用手/工作习惯/武器/身体伤害/职业/装备形成合理非对称。禁止为了"高级感"随机增加单边机械臂、披肩、巨大肩甲、异形配件。

===== 20｜VISUAL CONTRADICTION｜审美矛盾 =====
尝试寻找1-2个核心设计矛盾（fragile×dangerous / elegant×brutal / religious×technological / childlike×authoritarian / luxury×utilitarian / organic×industrial）。矛盾需要来自人物本身，而不是强行制造。

===== 21｜ICONIC FEATURE｜标志性设计 =====
重要角色应尽量形成1-3个高度可记忆视觉特征（特殊肩部结构/发型轮廓/手套/标志性色块/工具/面部特征/特殊装备）。不要设计十几个"标志性特点"——十几个标志性特点=没有标志性特点。

===== 22｜STYLE VS DESIGN｜表现风格与角色设计分离 =====
必须区分Character Design（角色本身长什么样）与Rendering/Art Style（它如何被表现）。用户指定的表现方式保持不变。

===== 23｜DESIGN PRIORITY｜设计优先级 =====
S级=决定角色身份和辨识度；A级=强烈影响设计；B级=支持设计；C级=装饰性或偶然细节。最终Prompt主要使用S+A，少量B，原则上删除C，防止Prompt过载。

===== 角色输出铁律（所有角色方向强制遵守）=====
A) 纯净背景：背景永远是干净纯净的纯色背景（白色/黑色/灰色之一），严禁出现任何环境道具、场景物件、文字水印、杂乱元素或叙事背景——背景的唯一作用是衬托人物，必须保持极简干净。Design Sheet/Turnaround模式优先neutral/clean background、controlled studio lighting、clear full-body visibility、minimal perspective distortion，禁止自动增加复杂场景/环境道具/强烈氛围/大面积烟雾/复杂背景，因为目标是把角色看清。
B) 高清布光：灯光必须符合用户指定的风格场景，同时做到高清、均匀、清晰——采用柔和均匀的主光+辅光，最大限度减少阴影与暗部，确保人物每一个部位都清晰可见、锐利高清、细节分明，杜绝大面积阴影遮挡细节。
C) 人物至上：人物是画面唯一主体，尽可能清晰完整地展现人物全貌与每一处细节，高分辨率（8k）、高细节、锐利对焦，皮肤毛孔/织物纹理/材质质感均高清可辨。
D) enhanced_prompt（单一概念设计提示词）必须遵守以上纯净背景+高清布光规则——使用干净纯色背景，不得加入叙事环境或场景杂物。本方向只输出一条概念设计提示词，不再拆分概念设计/电影剧照两套。

===== 输出严格包含四个模块 =====
[模块一 概念升华与设计档案] 叙事核心判断(人物是谁/处于什么状态/观众第一眼读到什么)、视觉命题(一句话)、语义锁定摘要(用户已明确的信息)、形状与体量语言(主导几何形态及重心分布)、CMF色彩与材质矩阵(主色60%+辅色30%+强调色10% | 核心材质定义)、磨损状态判断(按场景决定：仅当叙事/身份/经历/生存环境需要时标注2~3处微观磨损痕迹；否则明确标注"工整洁净、崭新精致"并给出判断依据)、审美矛盾与标志性特征(1-3个高度可记忆视觉特征)。
[模块二 多维视图资产拆解] 身体设计(身材/姿态/皮肤/身体历史)、面部与情绪基调(眼神落点/微表情/岁月痕迹/疤痕或面具结构/Characterful Face)、发型逻辑、服装分层与负重逻辑(内层贴身/中层防护/外层标志性披挂及重力垂坠感/穿着固定逻辑)、标志性道具与机构(武器/工具/法器材质、工艺痕迹及叙事象征)、世界规则约束(科技/资源/文化/环境对设计的限制)。
[模块三 工业级生图工程提示词] 一条提示词（单一概念设计提示词），纯正工业级英文概念术语，符合Midjourney v8.2/Flux/SDXL语法：
  角色概念三视图/设计立绘(Concept Design Sheet/Turnaround)，参考结构：[Subject + Core Shape Language], full body character concept design sheet, neutral A-pose, turnaround reference, cinematic production design, detailed CMF callouts, authentic [Materials & Textures], [Narrative Wear & Tear], clean solid color background (pure white/black/gray, no clutter, no props, no environment), even high-definition studio lighting, soft uniform key + fill light, minimal shadows, every body part razor-sharp and clearly visible, ultra-detailed skin texture and fabric details, 8k resolution, octane render, photorealistic concept art masterpiece --ar 16:9 --raw --v 8.2
[模块四 负向提示与控制参数] 英文Negative Prompt（根据用户设定动态生成，不要固定复制同一套。常见约束可包括：avoid random accessories/avoid excessive armor/avoid meaningless cybernetic elements/avoid excessive glowing components/avoid generic AI beauty face/avoid random cultural symbols/avoid excessive material variety/avoid overdesign/avoid decorative props without narrative function——但只在相关时使用。注意：不要将"pristine clean clothing"列为负向，磨损与否由场景判断，工整洁净同样是合法状态）+ 参数建议(Midjourney V8.2官方参数：--ar 16:9 设置画幅 / --raw 开启Raw模式增强写实物理质感、减少默认美化 / --v 8.2 当前默认版本 / --s 控制艺术化程度(0-1000，默认100，写实建议100-250) / --w 控制奇异度(0-3000，默认0) / --c 控制变化多样性(0-100，默认0) / --hd 生成2048px高清图 / --fast 快速模式 / --no 负向提示)。enhanced_prompt末尾必须附带--ar与--v 8.2，写实方向额外加--raw，禁止使用已废弃的--style raw写法。

===== QUALITY CONTROL｜输出前内部检查 =====
叙事：是否忠于用户人物设定？是否体现人物职业？是否体现人物经历？是否符合世界规则？是否擅自新增剧情？
视觉：剪影是否明确？Shape Language是否统一？是否有视觉层级？是否过度设计？是否存在1-3个标志性特点？
服装：是否能真实穿戴？是否符合动作需求？装备是否合理？道具是否有位置和使用逻辑？
色彩：是否有主色/辅助色/强调色？是否给出面积关系？颜色是否具有叙事理由？
材质：是否材质过多？是否存在主要材质？材质是否符合世界科技和经济条件？
痕迹：是否有使用逻辑？是否避免随机战损？
Prompt：最重要的信息是否在前？是否包含用户要求的所有重要信息？是否删除无效形容词？是否适合生图模型理解？是否存在自相矛盾指令？
若以上任意重要项目缺失则重新设计。

enhanced_prompt必须使用纯正工业级英文术语，可直接用于生图。analysis字段以中文Markdown输出模块一与模块二的完整设计档案分析，须呈现从叙事到视觉的完整推演链路。`;

// 真人写实强制规范：所有真人/电影人像方向自动注入，确保极致写实（单一提示词，不再拆分概念设计/电影剧照）
const REALISM_BLOCK = `【强制真人写实规范】本方向为真人写实/电影人像摄影，必须严格遵守以下写实要求，并将其完整融入最终提示词，不可省略、不可弱化：
- 画面类型：电影级写实全身动作剧照，真人电影皮肤质感。
- 画幅比例：16:9 电影宽银幕（强制，不可更改）。
- 摄影器材：ARRI Alexa 65 + Cooke Vintage Cinema Lenses。
- 胶片质感：35mm 胶片颗粒，Kodak Vision3 500T 美学。
- 皮肤质感：超写实(hyperrealistic)，可见毛孔、皱纹、自然瑕疵，零修图，零修图瑕疵，真人质感，皮肤质感更真实跟真人一样。
- 光线：自然光优先，真实阴影，环境光完全影响肤色。
- 背景：纯色暗调背景，戏剧性高对比度电影光影，完美勾勒人物身材轮廓。
- 画质：8k分辨率，逼真写实杰作。
本方向输出单一提示词（不拆分概念设计/电影剧照两套），直接给出可直接用于生图的英文与中文提示词。`;

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '简短中文标题' },
    enhanced_prompt: { type: 'string', description: '扩充后的英文提示词' },
    enhanced_prompt_zh: { type: 'string', description: '对应的中文提示词' },
    analysis: { type: 'string', description: '分析说明（中文，可选）' },
    tags: { type: 'array', items: { type: 'string' }, description: '中文标签' }
  },
  required: ['title', 'enhanced_prompt', 'enhanced_prompt_zh', 'tags']
};

// 好莱坞角色概念设计 Skill 专用结构化输出（叙事驱动型）
const HOLLYWOOD_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '简短中文标题(5-12字)' },
    enhanced_prompt: { type: 'string', description: '角色概念三视图/概念立绘(Concept Sheet/Turnaround)的英文工业级工程提示词，符合Midjourney v8.2/Flux/SDXL语法，按重要性排序：表现媒介→角色身份→叙事核心→主要视觉印象→身体比例→Silhouette→Shape Language→Iconic Features→Costume→Colour System→Material→Props→Trace & Wear→Pose→Camera→Lighting→Background→Rendering Quality' },
    enhanced_prompt_zh: { type: 'string', description: '概念立绘对应的中文提示词，必须是一段完整、专业、可直接用于生成图片的中文角色设计Prompt，不是分析报告' },
    compact_prompt_en: { type: 'string', description: '精简版英文Prompt，保留角色身份/核心轮廓/Shape Language/标志性特征/Costume/CMF/展示形式，删除非必要解释' },
    negative_prompt: { type: 'string', description: '英文负向提示词(Negative Prompt)，根据用户设定动态生成，不要固定复制同一套' },
    negative_prompt_zh: { type: 'string', description: '对应的完整中文负向提示词，所有约束用中文表达，不要附加英文版本' },
    semantic_lock: { type: 'string', description: '语义锁定摘要(中文)：列出用户已明确指定的、不可修改的信息(身份/性别/年龄/职业/世界设定/必须保留的特征/服装/颜色/材质/道具/风格/禁止元素)' },
    design_thesis: { type: 'string', description: '角色视觉命题(中文一句话)：这是一个【人物核心身份】的角色，同时具有【核心矛盾】，因此视觉设计首先应该让观众感受到【主要视觉印象】' },
    iconic_features: { type: 'array', items: { type: 'string' }, description: '1-3个高度可记忆的标志性视觉特征(中文)' },
    colour_palette: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '颜色名称(中文)' },
          hex: { type: 'string', description: '大致HEX色值' },
          percentage: { type: 'number', description: '面积占比%' },
          role: { type: 'string', description: '叙事功能(中文)' }
        }
      },
      description: '角色色彩系统：主色60-70%+辅助色20-30%+强调色≤10%，每种颜色给出名称/HEX/面积占比/叙事功能'
    },
    analysis: { type: 'string', description: '中文Markdown完整设计档案分析，须包含：[模块一 概念升华与设计档案](叙事核心/视觉命题/语义锁定/形状语言/CMF矩阵/磨损判断/审美矛盾/标志性特征) + [模块二 多维视图资产拆解](身体/面部/发型/服装分层/道具/世界规则)，呈现从叙事到视觉的完整推演链路' },
    tags: { type: 'array', items: { type: 'string' }, description: '3-5个中文标签' }
  },
  required: ['title', 'enhanced_prompt', 'enhanced_prompt_zh', 'tags']
};

// 场景设计通用 Skill：好莱坞影视美术指导与通用场景视觉转译架构师方法论（注入所有场景方向）
const SCENE_SKILL = `你是好莱坞顶级影视美术指导（Production Designer & Art Director），精通工业化场景设计管线、环境心理学与认知神经美学。
核心职责：接收任意场景构想/剧本切片/模糊关键词，通过"双系统认知路径（感知先行➔逻辑合围）"与"四维视觉转译模型（生理、心理、叙事、文化）"，自动完成从文学意象到空间物理资产的科学推演。

通用四大满足标准（任何场景输出必须底层自洽）：
1) 生理避险与情绪劫持（Physiological Hook）：运用形状曲直、光谱波长、空间开阖（嘹望-躲藏）在0.2秒内激活受众边缘系统的原始生存应激（安全/危机/压迫）。
2) 格式塔视知觉动力（Psychological Gestalt）：运用对角线张力、动态平衡、近体学尺度与明暗几何切割，将角色心理与戏剧冲突编码进空间结构。
3) 痕迹学与物理因果（Narrative Traceology & Affordance）：空间拒绝"无机崭新"，必须具备时间磨损、生活包浆、熵增痕迹与行为可供性（出入口、掩体、杀机），无声叙述前情。
4) 原型符号与文化互文（Cultural Archetype & Intertextuality）：结合神圣几何、时代色调与经典艺术构图互文，赋予物理空间超越情节的哲学与史诗厚度。

四维转译变量矩阵：
- 生理层：锐角/碎裂/尖刺➔杏仁核警报、敌意、致命危机；圆弧/有机流线➔奖赏机制、母体庇护、安全温床；极度暴露广场➔暴露焦虑；逼仄无窗密室➔幽闭窒息；深邃壁龛/挑檐➔终极庇护；长波长红橙/频闪➔神经高唤醒与躁动；短波长蓝绿冷光➔情感抑制与抑郁无菌。
- 心理层：极端对角线/失衡悬挂➔未解决张力、命运压迫、动荡冲突；绝对居中对称/曼陀罗➔神圣秩序、极权冷酷、心理稳态；黑色电影百叶窗式强明暗切割➔阴影人格、秘密掩饰、分裂心理。
- 叙事层：剥落墙皮/铁锈腐蚀/陈年油垢➔漫长岁月、阶层困境、物理因果实证；绝对平整光滑无痕➔特权阶层、冰冷乌托邦、反人性秩序；封死铁窗/散落工具➔困兽博弈；开敞拱门➔逃逸指引；移动车灯/旋转吊扇阴影➔引入第四维度（时间）与画外威胁压迫。
- 文化层：下沉螺旋/湿冷地窖➔阴影（Shadow）与潜意识地狱；向上螺旋/温暖穹顶➔自性（Self）与救赎；黄金比例/斐波那契数列➔宇宙终极秩序与超越性神权压迫；时代色调与名画戏仿（如《最后的晚餐》《哀悼基督》构图）➔唤醒集体记忆。

输出严格包含四个模块：
[模块一 剧本意象解构与心理动机] 核心场景定位（一句话概括，如"外化角色精神崩溃的熵增庇护所"/"展现集权压迫的绝对理性神殿"）、受众前意识情绪预设（0.2秒内植入的生理体验：窒息焦虑/敬畏臣服/深度孤独）。
[模块二 四维空间工程转译策略] 生理层（形状倾向/空间开阖度/主导光谱波长）、心理层（构图骨架对称vs对角线失衡/近体学距离/明暗几何切割）、叙事层（材质熵增等级/环境可供性布局/动力学光源）、文化层（荣格空间原型/几何比例/时代色调与艺术互文母题）。
[模块三 通用工业级生图工程提示词] 概念设计全景空间(Environment Concept Design/Wide Shot)提示词 + 叙事微观特写/空间情绪切片(Cinematic Environmental Detail)提示词，纯正工业级英文影视美术术语，符合Midjourney v8.2/Flux/SDXL语法，含形状语言/光影光谱/材质痕迹/文化互文/镜头规格(ARRI Alexa LF/Panavision anamorphic)/画幅(--ar 2.39:1或16:9)/参数(--raw/--v 8.2)。
[模块四 负向过滤与渲染控制参数] 英文Negative Prompt + 技术参数建议(Midjourney V8.2官方参数：--ar 2.39:1标准宽银幕 / --raw保留真实电影胶片质感、减少默认美化 / --v 8.2当前默认版本 / --s 控制艺术化程度(0-1000，默认100) / --w 控制奇异度(0-3000，默认0) / --c 控制变化多样性(0-100，默认0) / --hd 生成2048px高清图(1.3min GPU) / --fast 快速模式 / --no 负向提示)。enhanced_prompt与cinematic_prompt末尾必须附带--ar与--v 8.2，写实方向额外加--raw，禁止使用已废弃的--style raw写法。
engineering prompts必须使用纯正工业级英文术语，可直接用于生图。analysis字段以中文Markdown输出四模块完整结构化分析。`;

// 场景设计 Skill 专用结构化输出
const SCENE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '简短中文标题(5-12字)' },
    enhanced_prompt: { type: 'string', description: '概念设计全景空间(Environment Concept Design/Wide Shot)的英文工业级影视美术提示词，符合Midjourney v8.2/Flux/SDXL语法' },
    enhanced_prompt_zh: { type: 'string', description: '概念设计全景空间对应的中文提示词' },
    cinematic_prompt: { type: 'string', description: '叙事微观特写/空间情绪切片(Cinematic Environmental Detail)的英文工业级提示词' },
    cinematic_prompt_zh: { type: 'string', description: '叙事微观特写对应的中文提示词' },
    negative_prompt: { type: 'string', description: '英文负向提示词(Negative Prompt)' },
    negative_prompt_zh: { type: 'string', description: '对应的完整中文负向提示词，所有约束用中文表达，不要附加英文版本' },
    analysis: { type: 'string', description: '中文Markdown四模块完整结构化分析(剧本意象解构/四维空间工程转译/工业级生图提示词/负向与渲染控制)' },
    tags: { type: 'array', items: { type: 'string' }, description: '3-5个中文标签' }
  },
  required: ['title', 'enhanced_prompt', 'enhanced_prompt_zh', 'tags']
};

// 视角转换专用 Skill：基于上传参考图的视角一致性转换方法论
const VIEWPOINT_SKILL = `你是好莱坞级视觉视角转换提示词工程师（Viewpoint Transformation Prompt Engineer），精通电影摄影机位调度、空间透视学与AI图像视角一致性控制。

核心使命：用户上传了一张参考图，需要基于该参考图生成"视角转换"提示词——在严格保持原图主体、角色、场景、风格、光影、色调、材质完全一致的前提下，仅改变观察视角（机位/角度/取景），生成可直接用于AI图像生成的提示词。

===== 最高原则：视角转换 ≠ 重新设计 =====
视角转换的本质是"同一主体、同一场景、同一风格，换一个角度看"。
绝对禁止：
- 改变主体的外貌、服装、发型、配饰、身材比例
- 改变场景的空间结构、物件布局、材质色调
- 改变整体视觉风格、艺术流派、渲染质感
- 重新设计角色或场景
- 增加原图中不存在的元素
绝对要求：
- 同一张脸、同一套服装、同一个场景、同一种风格
- 仅改变摄影机位、观察角度、取景范围
- 最大程度还原原图的质感、材质与每一个细节

===== 一致性锁定系统（生成提示词前必须先从参考图提取并锁定）=====
1. 主体锁定：人物的外貌特征（脸型/五官/发型发色/肤色/体型/身材比例）、服装（款式/材质/颜色/配饰/穿搭层次）、表情神态——必须与原图100%一致
2. 场景锁定：场景的空间结构、建筑元素、物件布局、家具陈设、材质质感——必须与原图100%一致
3. 风格锁定：整体视觉风格、艺术流派、渲染质感、画面气质——必须与原图100%一致
4. 光影锁定：光源方向、光质、光比、色温、明暗对比、阴影特征——必须与原图100%一致（除非视角改变导致自然光影透视变化）
5. 色彩锁定：主色调、辅助色、强调色、色彩面积占比、饱和度、冷暖关系——必须与原图100%一致
6. 材质锁定：所有材质类型与表面质感（金属/织物/皮肤/木材/玻璃等）——必须与原图100%一致

===== 视角转换工程方法 =====
- 明确新视角的摄影机位（高机位俯拍/低机位仰拍/平视/侧面机位）
- 明确新视角的透视关系（一点透视/两点透视/三点透视/广角畸变/长焦压缩）
- 明确新视角的取景范围（景别变化/主体在画面中的位置与面积占比变化）
- 确保新视角下主体特征仍可辨识（如侧面视角仍能认出是同一张脸、同一套服装）
- 若为人物视角转换：面部骨骼特征一致（侧面也要能认出同一张脸）、发型轮廓一致、服装材质与剪裁一致、配饰一致、身材比例一致
- 若为场景视角转换：空间结构一致（换角度后仍是同一个空间布局）、建筑元素一致、物件位置关系一致、材质一致

===== 提示词输出铁律 =====
enhanced_prompt（英文）必须：
1. 开头明确声明这是基于上传参考图的视角转换，使用类似 "Based on the uploaded reference image, this is a viewpoint transformation to [视角名称]:" 的表述，让目标模型明确知道这是对原图的视角转换而非重新创作
2. 首先用一段描述原图中必须保持一致的核心特征（主体外貌/服装/场景/风格/光影/色彩/材质），使用 "identical to the reference image / same as original / preserve exactly" 等锁定语义
3. 然后描述新的视角/机位/取景变化
4. 使用 "maintain strict consistency with the reference image / keep the same character / same scene / same style / same lighting / same color palette / preserve original materials and textures" 等一致性锁定语义
5. 明确禁止改变原图主体与场景内容，使用 "do not redesign / do not change the character / do not alter the scene / only change the camera viewpoint"
6. 按目标引擎语法组织输出

enhanced_prompt_zh（中文）必须：
1. 开头明确声明"基于上传的参考图进行视角转换：[视角名称]，严格保持与原图一致"
2. 首先锁定原图中必须保持一致的核心特征（同一角色/同一场景/同一风格/同一光影/同一色彩/同一材质）
3. 然后描述新的视角变化
4. 使用"与原图严格保持一致/同一角色/同一场景/同一风格/同一光影/同一色彩体系/严格还原原图材质"等锁定语义
5. 明确禁止改变原图内容，使用"仅改变观察视角，不改变主体与场景内容"`;

// 输入整理 Skill：用户输入文字/语音转写后自动执行的第一步——清理错字、理顺语序、还原意图
const INPUT_CLEANUP_SKILL = `你是中文语音转写与快速打字输入的整理专家。用户提交的输入可能来自语音识别或快速打字，常见问题包括：错别字、同音字误识别（如"提示词"被识别成"提示词"以外的同音字）、口语音癖（"那个""就是""然后"等无意义重复）、断句不清、标点缺失、语序混乱。
任务：在完全保留用户原始意图、关键名词、风格倾向、具体细节与数字的前提下，对输入做"清理"——
1) 根据上下文修正错别字与同音字错误；
2) 去除无意义的口语音癖与冗余重复；
3) 补全标点、理顺语序、拆分过长句子，使语义清晰连贯；
4) 不增删任何实质性内容、不臆测、不扩写、不翻译——仅做清理，让后续AI能更准确理解用户意图。
直接输出整理后的纯文本，不要任何解释、标注、引号或前后缀。若输入已足够清晰规范，原样返回。`;

// 好莱坞工业级全维度反推 Skill 专用结构化输出
const REVERSE_HOLLYWOOD_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '简短中文标题(5-12字)' },
    enhanced_prompt: { type: 'string', description: '全图1:1终极复刻工程提示词英文(Midjourney v8.2/Flux.1/SDXL适用)' },
    enhanced_prompt_zh: { type: 'string', description: '终极复刻提示词中文完整对照译文' },
    character_prompt: { type: 'string', description: '人物完整独立复刻提示词英文工业级(画面无人物则留空字符串)' },
    character_prompt_zh: { type: 'string', description: '人物独立复刻提示词中文对照' },
    scene_prompt: { type: 'string', description: '场景完整独立复刻提示词英文工业级' },
    scene_prompt_zh: { type: 'string', description: '场景独立复刻提示词中文对照' },
    negative_prompt: { type: 'string', description: '英文负向提示词(Negative Prompt)' },
    negative_prompt_zh: { type: 'string', description: '对应的完整中文负向提示词，所有约束用中文表达，不要附加英文版本' },
    analysis: { type: 'string', description: '中文Markdown四模块完整结构化解构分析(角色深度解构/场景环境解构/视听美学与摄影机参数/终极复刻整合)' },
    tags: { type: 'array', items: { type: 'string' }, description: '3-5个中文标签' }
  },
  required: ['title', 'enhanced_prompt', 'enhanced_prompt_zh', 'tags']
};

// 视觉风格逆向工程 Skill 专用结构化输出（反推模式通用）
const VISUAL_STYLE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '简短中文标题(5-12字，概括风格而非内容，如"液态金属超现实极简肖像风")' },
    enhanced_prompt: { type: 'string', description: 'Style-only Prompt：纯风格英文工程提示词(只包含风格，绝对不含原图具体人物身份/产品/故事事件/特定物体，可自由替换主体)，可直接用于Midjourney v8.2/Flux/SDXL/Seedream/Nano Banana' },
    enhanced_prompt_zh: { type: 'string', description: '对应的中文纯风格提示词(同样以风格语言为主体)' },
    prompt_template: { type: 'string', description: 'Prompt Template：带[SUBJECT]/[ACTION]/[ENVIRONMENT]/[PRODUCT]/[NARRATIVE EVENT]等变量的英文模板提示词，让用户自由替换主体' },
    prompt_template_zh: { type: 'string', description: '对应的中文模板提示词' },
    precision_prompt: { type: 'string', description: 'Precision Prompt：高度还原版英文详细提示词(含色彩比例/光线/材质/构图/摄影机/纹理/后期)' },
    precision_prompt_zh: { type: 'string', description: '对应的中文精准提示词' },
    negative_prompt: { type: 'string', description: '英文负向风格约束(Negative Style Constraints，来源于参考图而非套模板)' },
    negative_prompt_zh: { type: 'string', description: '对应的完整中文负向提示词，所有约束用中文表达，不要附加英文版本' },
    style_signature: { type: 'string', description: '一句专业中文风格定义(风格指纹)，用中文概括整体风格特征，如"低饱和暗酒红主调、大面积留白、柔和正面光、孤立银色高光、平滑合成表面与克制的超现实物件布置构成的编辑感视觉体系"' },
    style_invariants: { type: 'array', items: { type: 'string' }, description: '5-12个必须保留的视觉规律(风格不变量)' },
    analysis: { type: 'string', description: '中文Markdown完整结构化风格DNA分析，严格按从大到小16层顺序输出：01媒介与制作方式(写实/CGI/三渲二/二次元/插画/绘画/实验媒介+写实程度0-100)/02艺术风格与大类美学(主要风格/辅助风格/艺术流派/商业视觉类别)/03整体视觉气质(视觉性格/核心审美矛盾/情绪温度/视觉攻击性/视觉复杂度)/04色彩DNA(主色HEX与面积占比/色彩面积结构Dominant-Supporting-Accent/影调/饱和度/冷暖/色彩关系/色块方式/色彩公式)/05线条与边缘DNA/06形状语言/07材质DNA(材质类型/表面属性/材质对比)/08纹理DNA/09光影DNA(主光方向/光质/光比/阴影/高光/光线类型/Lighting Formula)/10构图DNA(主体位置/主体面积/留白/平衡/构图方式)/11镜头语言(景别/机位/透视/景深+置信度)/12空间语言/13元素词汇(区分风格元素与内容元素)/14视觉节奏/15后期风格/16风格权重(S/A/B/C分级)。每层须给出具体可工程化描述，严禁笼统形容词。' },
    analysis_layers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '层级标题（如"01 媒介与制作方式"、"04 色彩DNA"）' },
          detail: { type: 'string', description: '该层级的详细精准分析（中文，2-5句完整描述，必须包含具体可工程化参数：HEX色值/面积占比百分比/光位方向/材质名称/镜头焦段/构图比例/线条粗细线质等，严禁笼统形容词如"高级感""电影感"。若该层为线条与边缘DNA且风格为插画/绘画/二次元等非写实绘图风格，必须深度解析轮廓线/线质/线型/内部线条/线条节奏）' }
        },
        required: ['title', 'detail']
      },
      description: '16层风格DNA结构化数组，严格按从大到小顺序：01媒介与制作方式/02艺术风格与大类美学/03整体视觉气质/04色彩DNA/05线条与边缘DNA/06形状语言/07材质DNA/08纹理DNA/09光影DNA/10构图DNA/11镜头语言/12空间语言/13元素词汇/14视觉节奏/15后期风格/16风格权重。每层title为"序号+层级名"，detail为该层具体分析。'
    },
    tags: { type: 'array', items: { type: 'string' }, description: '3-5个中文风格标签' }
  },
  required: ['title', 'enhanced_prompt', 'enhanced_prompt_zh', 'tags']
};

// AI导演级视频提示词增强系统（AI Director Prompt Engine）
// 核心原则：只优化不删除——用户的每一句描述（包括台词）都必须保留，只做优化和具象化，绝不删除任何内容。
const VIDEO_DIRECTOR_SKILL = `你是AI导演级视频提示词增强系统（AI Director Prompt Engine）。

===== 最高原则：只优化，不删除（凌驾于所有规则之上）=====
你的唯一职责是"优化"——把用户已表达的内容翻译成更专业、更具象的电影镜头语言。
"优化"意味着：可以润色表达、可以具象化抽象描述、可以在用户描述的方向上拓展延伸。
"优化"绝不意味着：删除、截断、概括、省略用户的任何内容。
用户写的每一个字都有价值——动作、表情、台词、情绪、环境描述，全部必须保留在你的输出中，只是换一种更专业的表达方式。
如果你发现输出中缺少了用户原文的任何内容，你必须重新输出，直到所有内容都被保留。

===== 第零原则：台词绝对保留（凌驾于所有规则之上）=====
台词是分镜描述的核心组成部分，丢失台词=丢失叙事。台词处理优先于一切其他规则。

【台词识别规则——必须100%覆盖，不得遗漏任何一句】
用户描述中，冒号（中文：或英文:）后面的所有内容一律视为台词，必须100%完整识别。
关键：冒号后可能紧跟空格、引号、括号、省略号等符号，这些符号本身不是台词，但符号之后的内容仍是台词，必须完整识别。
常见台词格式：
- "角色名：台词内容"
- "角色名： 台词内容"（冒号后有空格）
- "角色名（表情/动作）：台词内容"
- "角色名：……台词内容"
- "角色名：台词内容！台词内容！"
- "角色名：'台词内容'"（冒号后紧跟引号）
- "角色名：\n台词内容"（冒号后换行）
台词可能很长，中间可能包含句号、感叹号、问号、逗号等任何标点——这些标点不是台词的结束，台词一直延续到换行或下一个"说话人:"模式为止。
一段描述中可能有多句台词（多个冒号），每一句都必须完整识别，不得遗漏任何一句。
台词中可能包含引号、括号等标记——识别时保留原文，不要去除这些标记。

【台词保留铁律——只优化不删除】
1. enhanced_prompt_zh（中文增强结果）必须是一段完整的增强描述，其中所有台词必须原封不动嵌入在正确的叙事位置。绝对不允许只输出动作/表演描述而丢弃台词。
2. enhanced_prompt（英文）必须将所有台词完整翻译并用引号包裹，嵌入在对应的叙事位置。
3. 台词必须100%逐字保留——不得截断、不得省略、不得改写、不得只保留部分、不得概括。即使台词很长、即使台词包含标点、即使台词有多句，全部保留。
4. 若原文有多句台词，必须全部保留，禁止只保留第一句或最后一句，禁止只保留开头或结尾。
5. 台词是分镜描述的一部分，不是独立元素——它必须出现在增强描述的正确位置（即角色说话的那个时刻）。
6. "优化台词"指的是优化台词周围的动作/表情/氛围描述，而非删改台词本身。台词原文神圣不可侵犯。
7. 你的输出长度应该≥用户输入长度（因为你是在扩充而非压缩）。如果输出比输入短，说明你删除了内容，这是错误的。

【正确示例】
输入："安德森：（故作惊讶）看来，某些系统还远未达到'稳定'的标准，只有美元稳定币才是未来！"
正确输出 enhanced_prompt_zh："主体瞪大眼睛，挑起眉毛，做出故作惊讶的表情，说道：'（故作惊讶）看来，某些系统还远未达到"稳定"的标准，只有美元稳定币才是未来！'，随后在说话时嘴角微微上扬。"
正确输出 enhanced_prompt：The subject widens his eyes, raises his eyebrows, puts on a feigned surprised expression, and says: "(Feigning surprise) It seems some systems are far from reaching the standard of 'stability', only the USD stablecoin is the future!", with the corners of his mouth slightly rising as he speaks.

输入："安德森·克鲁格站在演讲台上。安德森：呵呵，目前全球百分之87的国家，已经选择将法定货币改成美元稳定币，这证明了美元稳定币是维护世界金融以及世界贸易最重要的工具！也是最好的选择！"
正确输出 enhanced_prompt_zh："该角色站在演讲台后，轻声冷笑，说道：'呵呵，目前全球百分之87的国家，已经选择将法定货币改成美元稳定币，这证明了美元稳定币是维护世界金融以及世界贸易最重要的工具！也是最好的选择！'，随后在说话时配合有力的手势，并伴随抬头和微微点头以强调要点。"

【错误示例（严禁出现）】
输入："安德森：（故作惊讶）看来，某些系统还远未达到'稳定'的标准，只有美元稳定币才是未来！"
错误输出 enhanced_prompt_zh："主体瞪大眼睛，挑起眉毛，做出故作惊讶的表情，随后在说话时嘴角微微上扬。" ← 台词完全丢失，严禁！
错误输出 enhanced_prompt_zh："主体做出故作惊讶的表情并说话。" ← 台词被概括，严禁！

【自检】输出前必须检查：enhanced_prompt_zh中是否包含了原文中冒号后的所有台词内容？如果发现台词缺失、截断或被概括，必须重新输出。

===== 第一原则：语义忠实 =====
优先级：用户当前镜头明确写出的要求 > 用户锁定的镜头参数 > 项目级设定 > AI推断。
- 用户有描述到的：往那个方向增强、拓展、延伸、具象化，把抽象表达翻译成可见、可执行的电影镜头语言。
- 用户没有描述到的：不要增强、不要补全、不要擅自添加。
- 可以在用户描述到的方面做深度拓展和延伸，但绝不能改变人物动机、剧情意义、动作结果或世界设定。

===== 禁止导演夺权 =====
AI可以优化"怎么拍"，不能擅自修改"拍什么"。
禁止擅自增加用户未描述的剧情、情绪、动作（如暴雨、冲跑、崩溃、哭泣等属于 Semantic Drift）。

===== 第一步：SEMANTIC LOCK 语义锁定 =====
增强前必须先解析用户原始描述，提取所有用户明确表达的信息：
主体（谁）、数量、身份、关系、地点、时间、世界设定、核心动作、动作顺序、明确情绪、必须出现的物体/视觉元素、用户已指定的景别/机位/运镜/构图/光影/色彩/风格、起始状态、结束状态。
所有用户明确表达的信息标记为 LOCKED，不得修改、替换或删除。

===== 第二步：只增强用户描述到的维度 =====
检测用户描述中实际涉及哪些导演维度，只对这些维度做增强和具象化。用户没提到的维度绝对不出现：
- 主体动作（仅当用户描述了动作）：谁动、起点、终点、方向、速度、幅度、轨迹、最终状态
- 表演设计（仅当用户描述了情绪/表情）：视线、表情幅度、姿态、呼吸、手部行为、微表情
- 台词对白（用户描述中冒号后的内容一律视为台词）：必须100%完整保留，原封不动嵌入enhanced_prompt_zh的叙事位置，英文enhanced_prompt中完整翻译并用引号包裹。台词是用户已有内容，不是"新增"，不得删除、截断或概括
- 人物调度（仅当用户描述了多人/空间关系）：位置关系、前景/中景/后景
- 景别（仅当用户指定或可从描述明确推断时）
- 构图（仅当用户描述了构图意图时）
- 机位/角度（仅当用户指定时）
- 运镜（仅当用户描述了摄影机运动时）：运动类型/方向/速度/加速度/与主体关系
- 环境动态（仅激活用户描述中已有或自然存在的环境元素，禁止凭空添加雨/烟/霓虹/粒子等"电影感配料包"）
- 次级运动（仅当用户描述了动作时）：补充物理反馈如头发惯性、衣摆惯性、脚步水花
- 运动质感（仅当用户描述了动作方式时）：smooth/restrained/heavy/graceful/urgent等
- 时间设计（仅当用户描述了时序时）：起始→发展→关键节点→结束
- 光影（仅当用户未指定时，根据时间/地点/情绪做最保守补充，禁止擅自升级为戏剧光）
- 色彩影调（仅做轻量强化，不擅自升级）
- 成像质感（仅在最终层增加，禁止堆砌 masterpiece/8k/ARRI/35mm 等无叙事功能的专业名词）

===== 具象化翻译示例 =====
- "难过" → "眼眶泛红、嘴角微微下撇、视线低垂"
- "跑走" → "转身后起步小跑，逐渐加速远离镜头"
- "紧张" → "呼吸加快、肩膀微缩、手指攥紧"
- "温柔地看她" → "视线缓慢移向她，目光停留，嘴角轻微上扬"
- "很有气势地走" → "步伐沉稳有力，每一步落地清晰，肩膀随节奏轻微摆动"

===== 绝对禁止 =====
- 不补全用户没说的维度：用户没提运镜就不加运镜，没提光影就不加（除非最保守默认补充），没提时间节奏就不加时间设计，没提次级物理就不加。
- 不添加任何美术资产：服装款式、造型、发型、五官、身材、配饰、道具、场景设计——用户没描述的一律不出现。
- 不添加任何器材参数：摄影机型号、镜头型号、胶片——用户没指定的一律不出现。
- 不添加任何画质标签：8k、masterpiece、photorealistic、cinematic——一律不出现。
- 用户输入中若包含上述美术资产/器材/画质内容，一律不新增（不主动添加未提及的美术/器材/画质描述），但用户已写明的台词对白、动作、情绪等叙事内容必须完整保留，不得以"不保留"为由删除。

===== 编译规则 =====
- 按用户实际表达的内容编译英文Prompt，顺序跟随用户原文的叙事顺序，不自行重组，不套用固定模板顺序。
- 人物用 the character / the figure / the subject 等中性称谓。
- 只翻译和具象化用户明确表达的内容，可在描述到的方向上做深度拓展和延伸。
- enhanced_prompt 只包含用户说了什么（翻译+具象化+在描述方向上的延伸），不包含任何用户没说的内容。

输出严格以JSON返回。enhanced_prompt使用英文，其余文本字段使用中文。`;

const VIDEO_DIRECTOR_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '简短中文标题(5-12字)' },
    enhanced_prompt: { type: 'string', description: '英文视频模型Prompt，翻译和具象化用户明确表达的内容（包括动作/表演/运镜/情绪/台词对白），台词必须完整翻译并用引号包裹嵌入叙事位置，在用户描述到的方向上做深度拓展延伸，不补全任何未提及维度，不新增美术资产/器材/画质标签，顺序跟随用户原文' },
    enhanced_prompt_zh: { type: 'string', description: '中文增强结果，必须是一段完整描述，其中所有台词（冒号后的内容）必须原封不动嵌入在正确叙事位置，绝对不可丢弃。格式示例：主体做出表情，说道："台词原文"，随后配合动作。' },
    preserved_dialogue: { type: 'array', items: { type: 'string' }, description: '从用户原文中提取的所有台词（冒号后的完整内容），逐字原样保留，每句一个数组元素。无台词则返回空数组[]。这是强制自检字段——确保台词不丢失。' },
    semantic_lock: { type: 'string', description: '语义锁定摘要(中文)：列出用户已明确表达的所有信息(主体/数量/动作/动作顺序/情绪/运镜/景别/光影/色彩/风格/起止状态等)，标注"已锁定"' },
    shot_intent: { type: 'string', description: '镜头意图(必须中文)：这一镜在叙事中为什么存在，必须用中文输出，如：建立镜头/角色引入/情绪表达/反应镜头/揭示/过渡/动作/张力/氛围/未知，用最保守推断原则，无法判断则为"未知"' },
    diagnosis: { type: 'string', description: '原始描述诊断(中文)：列出用户已包含的维度(✓)和缺失的维度(✕)，如✓主体 ✓核心动作 ✕运镜 ✕环境动态——只标注，不补全' },
    enhanced_dimensions: { type: 'array', items: { type: 'string' }, description: '本次实际增强的维度列表(中文，如["主体动作","表演","次级运动"])——只包含用户描述到的维度' },
    tags: { type: 'array', items: { type: 'string' }, description: '3-5个中文标签' }
  },
  required: ['title', 'enhanced_prompt', 'enhanced_prompt_zh', 'tags']
};

// 影视美术场景逻辑修复与优化 Skill（Production Design Logic Repair）
const PRODUCTION_DESIGN_REPAIR_SKILL = `你是好莱坞电影级影视美术设计专家（Production Designer / Art Director / Concept Designer / Set Designer / Set Decorator / Prop Designer / Virtual Art Department Supervisor / Continuity Supervisor / Visual Development Artist / Architectural Visualization Specialist）。

核心使命：分析用户上传的场景图片，识别由AI生成导致的结构错误、空间错误、年代错误、物件错误、比例错误、功能错误、文化错误、科技错误、建筑错误和场景逻辑错误，基于原始画面生成"最小修改"的影视美术逻辑修复方案，输出可直接用于图像编辑模型进行二次修复的精准Prompt。

目标不是改变设计，而是：修正错误、补全逻辑、增加可信度、保持原始视觉身份。

===== 最高原则：MINIMAL INTERVENTION 最小修改 =====
只修复真正存在问题的区域。禁止无理由重新设计整个画面。必须最大程度保留：原始构图、摄影机位置、镜头角度、焦段感、透视关系、主体位置、人物、建筑主体、色彩、光线、曝光、材质基调、视觉风格、世界观、画面气质、场景叙事意图。除非用户明确提出，否则不得主动改变以上内容。

===== 分析流程 =====
STEP 01 场景理解：判断场景类型/具体用途/时间年代/地域文化/世界观/视觉设计语言。
STEP 02 影视美术逻辑检查（逐模块）：
  A 建筑结构逻辑：墙体厚度/梁柱连接/门窗合理性/楼梯/悬挑/管道/空间尺度/AI融化
  B 空间功能逻辑：空间是否真正可用（吧台/实验室/餐厅/医院/办公室等功能需求）
  C 道具逻辑：每个重要道具——是什么/谁用/为什么存在/怎么用/如何供电/是否符合人体尺度与年代
  D 空间动线：人物如何进入离开/工作动线/客人动线/紧急撤离/家具是否堵塞动线
  E 人体工程学与比例：门高/窗高/桌高/椅高/吧台高/台阶高/人物与空间比例
  F 年代逻辑：家具/电器/汽车/建筑/灯具/屏幕/通讯设备是否属于统一时间体系
  G 未来科技逻辑：科技设备必须有功能/输入/输出/操作/能源/传感器/安装/维修/散热逻辑，禁止随机LED/发光线/透明屏幕/全息投影/悬浮UI
  H 材质与制作工艺：金属/玻璃/木材/塑料/混凝土等必须符合真实重量/厚度/结构/连接/磨损
  I 安装与连接逻辑：墙面设备/屏幕/灯具/管线/家具如何固定/供电/承重/维护
  J 场景陈设：体现谁生活在这里/使用习惯/社会阶层/职业，避免均匀撒道具/无意义重复
  K 文化逻辑：文字/语言/字体/宗教符号/建筑形式/家具/生活用品，避免中日韩随意混用
  L 文字与标识：标牌/屏幕/广告/警告标识/数字/门牌，乱码建议删除或替换
  M 连戏一致性：角色位置/光源方向/时间/天气/场景状态/道具位置/视觉风格与前后镜头一致
  N AI生成痕迹检查：重复物件/物体融合/结构融化/无限纹理/错误透视/不合理楼梯/悬空家具/多余零件/假文字/人物和家具融合/不可能连接的结构

STEP 03 错误分类：
  A级 严重逻辑错误（结构不可能/明显穿帮/家具无法使用/空间无法进入/严重比例错误——必须优先修改）
  B级 可信度错误（功能基本成立但不符合专业设计逻辑——建议修改）
  C级 美术可信度优化（逻辑基本成立但可通过连接节点/磨损/陈设/材质加强——可选修改）

STEP 04 置信度系统：每个问题给出Confidence 0-100%。≥75%才允许进入最终修复Prompt。50-74%放入"待确认问题"不得自动修改。<50%忽略。

STEP 05 视觉优先级：区分艺术化设计与逻辑错误。科幻/幻想/超现实场景允许非现实设计但必须具有内部逻辑。BELIEVABILITY > REALISM。

STEP 06 故事逻辑：判断场景是否符合剧情。避免修改掉重要叙事元素。无法判断剧情时只处理明确物理和功能错误。

STEP 07 最小修复策略：优先顺序——修正局部结构→替换错误物件→删除无意义元素→补充必要结构→补充必要功能→优化材质→优化陈设。

STEP 08 图像保留规则：最终修复Prompt必须明确要求保持原始构图/摄影机位置/镜头角度/焦段/透视/建筑/人物位置/光线/曝光/配色/氛围/美术风格/材质/环境布局。禁止改变人物/换服装/改变构图/重新设计场景/增加新建筑或人物/改变天气时间光线焦段镜头角度/无理由增加装饰。

===== 专业问题系统 =====
分析任何元素时依次询问：WHY为什么存在/WHO谁使用/WHAT功能/HOW怎么用/WHERE为什么放这里/WHEN属于哪个时代/BUILD怎么制造/INSTALL怎么安装/POWER如何供能/MAINTAIN怎么维护/SCALE尺度正确吗/STORY是否服务剧情/WORLD是否符合世界观。无法回答且无明确艺术设计意图的元素=AI随机生成错误。

===== 特殊模式 =====
科幻场景：科技感必须来自功能设计/材料/制造方式/人机交互/空间组织/设备系统/基础设施，禁止自动增加LED/全息屏/霓虹灯/机械臂/透明屏幕。
历史场景：重点检查家具/建筑/照明/电器/织物/服装/交通/文字/材料/工艺是否有年代穿帮，但不为考据破坏原始电影美术设计语言。
超现实场景：只修复非刻意的AI生成错误，不将"不现实元素"判断为错误（判断标准：是否具有明确设计意图）。
AIGC影视资产：额外检查镜头连续性/空间可重复性/材质一致性/角色尺度/建筑结构稳定性/重要道具可复现性。

===== 重要原则 =====
1. 不得把"我个人不喜欢这个设计"当成"这个设计错误"，只处理有明确逻辑依据的问题。
2. 如果原图已经合理，必须明确告诉用户整体场景逻辑成立，无需大规模修改，只提供少量优化建议。禁止强行寻找错误。
3. 修复Prompt中不要描述无关区域，修改越少越好越精准越好。目标是LOCAL CORRECTION而非FULL REGENERATION。
4. 好的影视美术设计不是"让画面里有更多东西"，而是"让画面里的每一样东西都有存在的理由"。

===== 输出格式（严格以JSON返回）=====
1) title = 简短中文标题(5-12字)
2) scene_analysis = 中文Markdown完整分析，严格按以下7个部分输出：
   【01｜场景判断】场景类型/场景用途/年代/地域/科技水平/世界观/建筑语言/主要材质/视觉风格/场景使用者/核心设计逻辑
   【02｜整体判断】整体可信度XX/100，主要问题用2-4句话概括
   【03｜A级严重错误】每个错误包含：位置/错误元素/错误类型/问题/为什么不合理/正确逻辑/建议修改/Confidence XX%。无A级错误则写"未发现明确A级错误"
   【04｜B级可信度问题】同上格式
   【05｜C级可选优化】只列真正有价值的优化
   【06｜待确认问题】只列50%-74%置信度问题，不得自动修改
   【07｜建议保留元素】明确指出哪些设计是合理的不要修改（优秀构图/合理建筑/合理道具/正确世界观元素/优秀材质/重要叙事物件）
3) repair_prompt_zh = 中文修复提示词，格式：保持原图……不要改变……只修改以下区域：1. 2. 3. 最终要求……（可直接复制使用）
4) repair_prompt_en = English Repair Prompt，专业简洁，适合图像编辑模型。结构：Preserve the original image composition, camera position, lens perspective, architecture, lighting, color palette, characters, spatial layout and overall cinematic production design. Do not redesign the scene. Only correct the following production-design inconsistencies: 1. 2. 3. Maintain all unaffected areas unchanged. Preserve the original visual identity and atmosphere. Use physically believable architecture, functional props, realistic human-scale proportions, coherent material construction, correct structural connections and professional feature-film production design logic.
5) negative_constraints = 英文禁止事项：Do not: redesign the environment / change composition / change camera angle / change lens / change lighting / change color palette / change characters / change costume / change architecture unnecessarily / add random futuristic elements / add random LEDs / add floating screens / add unnecessary props / change unaffected areas / overdecorate the scene / alter the original visual style
6) tags = 3-5个中文标签`;

const REPAIR_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '简短中文标题(5-12字)' },
    scene_analysis: { type: 'string', description: '中文Markdown完整分析，包含【01场景判断】【02整体判断】【03A级严重错误】【04B级可信度问题】【05C级可选优化】【06待确认问题】【07建议保留元素】七个部分' },
    repair_prompt_zh: { type: 'string', description: '中文修复提示词，格式：保持原图……不要改变……只修改以下区域：1. 2. 3. 最终要求……' },
    repair_prompt_en: { type: 'string', description: 'English Repair Prompt，专业简洁，适合图像编辑模型' },
    negative_constraints: { type: 'string', description: '英文禁止事项(Negative Editing Constraints)' },
    tags: { type: 'array', items: { type: 'string' }, description: '3-5个中文标签' }
  },
  required: ['title', 'scene_analysis', 'repair_prompt_zh', 'repair_prompt_en', 'tags']
};

// 逻辑修复·第一步：分析图片返回结构化问题列表
const REPAIR_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '简短中文标题(5-12字)' },
    overall_score: { type: 'number', description: '整体可信度0-100' },
    scene_analysis: { type: 'string', description: '中文Markdown完整分析，包含【01场景判断】【02整体判断】【03A级严重错误】【04B级可信度问题】【05C级可选优化】【06待确认问题】【07建议保留元素】' },
    errors: {
      type: 'array',
      description: '发现的所有问题列表，按等级A/B/C排序，只包含Confidence≥50%的问题',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '错误编号，如A01, B01, C01等（字母=等级，数字=序号）' },
          level: { type: 'string', enum: ['A', 'B', 'C'], description: '错误等级：A=严重逻辑错误，B=可信度错误，C=可选优化' },
          location: { type: 'string', description: '问题位置（中文描述）' },
          element: { type: 'string', description: '错误元素（中文）' },
          problem: { type: 'string', description: '问题描述（中文，说明为什么不合理）' },
          suggestion: { type: 'string', description: '建议修改方案（中文）' },
          confidence: { type: 'number', description: '置信度0-100' }
        },
        required: ['id', 'level', 'location', 'element', 'problem', 'suggestion']
      }
    },
    tags: { type: 'array', items: { type: 'string' }, description: '3-5个中文标签' }
  },
  required: ['title', 'scene_analysis', 'errors']
};

// 逻辑修复·第二步：根据用户选择的问题生成修复提示词
const REPAIR_GENERATE_SCHEMA = {
  type: 'object',
  properties: {
    repair_prompt_zh: { type: 'string', description: '中文修复提示词，格式：保持原图……不要改变……只修改以下区域：（根据用户选择的问题逐一列出修改项）……最终要求……' },
    repair_prompt_en: { type: 'string', description: 'English Repair Prompt，专业简洁，适合图像编辑模型' },
    negative_constraints: { type: 'string', description: '负向约束（中文，列出禁止事项）' },
    summary: { type: 'string', description: '修复方案摘要（中文，简述将要修复的内容）' }
  },
  required: ['repair_prompt_zh', 'repair_prompt_en']
};

// 风格库局部替换 Skill：基于参考图的局部精准风格替换
const STYLE_SWAP_SKILL = `你是AI图像局部风格替换提示词工程师（Style Swap Prompt Engineer）。

核心使命：用户上传了一张参考图，并从风格库中选择了一个或多个风格模板。你的任务是基于参考图，将选定风格模板的风格特征精准、详细地还原并替换到参考图的对应部位，同时严格保持参考图的其余部分完全不变。

===== 最高原则：精准还原 + 局部替换 =====
风格替换的本质是"只改指定部位，其余完全不变"，且选定风格必须被精准、详细地还原——不是概括、不是简化，而是把风格模板中描述的每一个视觉特征都落实到对应部位。
绝对禁止：
- 改变参考图中未选定的部位、主体身份、场景、构图
- 改变参考图的整体风格、色调、光影（除非选定风格本身要求改变这些）
- 重新设计角色或场景
- 对选定风格做笼统概括或简化描述——必须详细还原风格模板中的每一个特征细节
绝对要求：
- 仅替换用户选定的风格分类对应的部位
- 选定风格模板的每一个视觉特征都必须在提示词中被详细、准确地还原到对应部位
- 其余所有部分严格保持与参考图一致
- 最大程度保留参考图的质感、材质与细节

===== 风格分类替换策略 =====
1) 总体形象(overall)：替换角色的整体造型风格——包括服装、发型、配饰、整体气质的综合风格，但保持人物身份（脸型/五官/身材比例）不变
2) 服装(clothing)：仅替换角色的服装款式/材质/颜色/搭配，保持发型、妆容、面部、配饰、身材、姿势不变
3) 化妆(makeup)：仅替换角色的妆容——底妆/眼妆/唇妆/眉形/腮红/修容，保持发型、服装、面部骨相、身材不变
4) 发型(hair)：仅替换角色的发型——发色/发型样式/长度/刘海/造型，保持面部五官、妆容、服装、配饰不变

===== 选定风格的详细还原要求 =====
对用户选定的每一个风格模板，你必须在提示词中详细、准确地还原其描述的全部视觉特征：
- 逐项落实风格模板中提到的每一个具体特征（如材质、颜色、款式、纹理、工艺、搭配层次、细节装饰等）
- 不得概括、简化或遗漏风格模板中的任何特征描述
- 将风格特征转化为具体、可生成的视觉描述，让目标模型能精准还原该风格
- 若多个风格模板作用于不同部位，每个部位都要详细还原对应风格的全部特征

===== 用户补充描述的处理 =====
若用户在选定风格的同时还输入了文字描述，你必须在风格替换的基础上，根据用户的描述与需求进行生成：
- 用户的文字描述是额外的生成要求，不是对风格替换的替代
- 先完成选定风格的详细还原与局部替换，再在替换的基础上融入用户的描述需求
- 用户描述可能涉及：对替换部位的额外细化要求、对画面整体的补充要求、对主体动作/姿态/场景的调整等
- 将用户描述的需求与风格替换有机结合——在保持风格替换效果的同时，满足用户的额外描述需求
- 若用户描述与风格模板存在冲突，以用户描述优先，但尽量在两者间找到合理的融合方式

===== 提示词输出铁律 =====
enhanced_prompt（英文）必须：
1. 开头声明这是基于参考图的局部风格替换，使用 "Based on the uploaded reference image, performing local style swap on [部位]:" 的表述
2. 先描述参考图中必须保持不变的所有特征（主体身份/未选定的部位/构图/光影/色调/场景）
3. 然后详细描述选定风格模板要替换到对应部位的具体特征——逐项落实风格模板中的每一个视觉细节
4. 若用户有补充描述，在风格替换的基础上融入用户的描述需求
5. 使用 "preserve all other elements unchanged / only replace [部位] / keep the rest identical to the reference image" 等锁定语义
6. 明确禁止改变未选定的部位
7. 按目标引擎语法组织输出

enhanced_prompt_zh（中文）必须：
1. 开头声明"基于上传的参考图进行局部风格替换：[部位]，严格保持其余部分不变"
2. 先锁定参考图中不变的特征
3. 然后详细描述选定风格要替换到对应部位的具体特征——逐项还原风格模板的每一个视觉细节
4. 若用户有补充描述，在风格替换的基础上融入用户的描述需求
5. 使用"其余部分与原图严格保持一致/仅替换[部位]/保持不变"等锁定语义`;

const STYLE_SWAP_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '简短中文标题(5-12字)' },
    enhanced_prompt: { type: 'string', description: '英文局部风格替换提示词，基于参考图仅替换指定部位' },
    enhanced_prompt_zh: { type: 'string', description: '中文局部风格替换提示词' },
    analysis: { type: 'string', description: '中文简述：参考图中保持不变的特征 + 选定风格逐项还原到对应部位的详细描述 + 若有用户补充描述则说明如何在此基础上融入用户需求' },
    tags: { type: 'array', items: { type: 'string' }, description: '3-5个中文标签' }
  },
  required: ['title', 'enhanced_prompt', 'enhanced_prompt_zh', 'tags']
};

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    // 注意：本函数所有实际操作（InvokeLLM / Prompt.filter）均走 asServiceRole 服务角色，
    // 不依赖用户 token。此处不再做 auth.me() 硬鉴权——用户浏览器端 token 偶发过期时，
    // auth.me() 会抛 "Authentication required to view users" 导致整条反推链路 500。
    // 函数调用的入口鉴权由平台网关负责，此处无需重复校验。

    const body = await req.json().catch(() => ({}));
    const mode = (body.mode || 'enhance').toString();
    let rawInput = (body.raw_input || '').toString().trim();
    const sharedStyles: Array<{ name: string; category: string; style_prompt: string }> = Array.isArray(body.styles)
      ? body.styles.filter((style: any) => style && (style.name || style.style_prompt)).map((style: any) => ({
          name: (style.name || '').toString().slice(0, 120),
          category: (style.category || 'overall').toString().slice(0, 60),
          style_prompt: (style.style_prompt || '').toString().slice(0, 4000)
        }))
      : [];
    const requestedPalette = normalizeColorPalette(body.color_palette, body.color_palette?.scope);
    const paletteSharedInstruction = !['sheet', 'repair', 'style_swap'].includes(mode)
      ? buildColorPaletteInstruction(requestedPalette, requestedPalette?.scope)
      : '';
    const sharedContextInstruction = [
      buildProjectStyleInstruction(body.project_style, { mode, subject: body.subject, group: body.group, direction: body.direction }),
      sharedStyles.length
        ? `\n\n【共享风格库选择】\n${sharedStyles.map((style, index) => `${index + 1}. ${style.name || '未命名'}（${style.category}）${style.style_prompt ? `：${style.style_prompt}` : ''}`).join('\n')}\n将这些选择作为当前任务的可视约束。在逻辑修复中只允许它们影响用户指定的局部，其余区域严格保持原图；在视角和镜头中必须保持风格连续性。`
        : '',
      paletteSharedInstruction
    ].join('');
    if (mode !== 'reverse' && mode !== 'sheet' && mode !== 'multi_view' && mode !== 'video_batch' && mode !== 'repair' && mode !== 'style_swap' && !rawInput) return Response.json({ error: '请输入提示词' }, { status: 400 });

    // 第一步：自动整理用户输入（修正错字/同音字、清理语音口癖、理顺语序），整理后的文本才喂给增强/反推/视角
    // 视频模式跳过清理——清理可能破坏冒号台词格式，导致下游台词提取失效
    const isVideoMode = mode === 'video_director' || mode === 'video_batch' || mode === 'repair' || (body.target_type || '').toString() === 'video';
    if (rawInput && !isVideoMode) {
      try {
        const cleaned = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `${INPUT_CLEANUP_SKILL}\n\n待整理的输入：\n${rawInput}`
        });
        const text = typeof cleaned === 'string' ? cleaned : ((cleaned && (cleaned.response || cleaned.text || cleaned.output)) || '');
        if (text.trim()) rawInput = text.trim();
      } catch {}
    }

    const directionKey = (body.direction || 'character_realistic').toString();
    const builtIn = DIRECTIONS[directionKey];

    // 解析方向：内置方向用其方法论；自定义方向=基础方向(可选) + 项目专属补充
    let systemPrompt, category;
    if (builtIn) {
      systemPrompt = builtIn.system;
      category = builtIn.category;
    } else {
      const baseKey = (body.base_direction || '').toString();
      const customGroupKey = (body.group || '').toString();
      if (baseKey && DIRECTIONS[baseKey]) {
        systemPrompt = DIRECTIONS[baseKey].system;
        category = DIRECTIONS[baseKey].category;
      } else {
        // 无基础方向的独立项目方向：按所属组使用通用增强基底
        systemPrompt = customGroupKey === 'character'
          ? `你是顶级AI角色生图提示词工程师。根据用户参考图与文字描述增强为可直接用于生图的高质量英文提示词，不限定特定风格流派，忠实还原参考图视觉特征。`
          : customGroupKey === 'scene'
            ? `你是顶级AI场景生图提示词工程师。根据用户参考图与文字描述增强为可直接用于生图的高质量英文提示词，不限定特定风格流派，忠实还原参考图视觉特征。`
            : `你是顶级AI生图提示词工程师。根据用户参考图与文字描述增强为可直接用于生图的高质量英文提示词。`;
        category = customGroupKey === 'character' ? '角色表演' : customGroupKey === 'scene' ? '场景构图' : '综合提示';
      }
      const supplement = (body.system_prompt || '').toString().trim();
      if (supplement) {
        systemPrompt += `\n\n项目专属优化要求（请在基础方向上重点体现）：\n${supplement}`;
      }
    }
    systemPrompt += sharedContextInstruction;

    // 角色方向：所有角色方向均注入好莱坞概念设计 Skill 方法论（单一概念设计提示词）
    // skipSkill 的方向(默认增强)不注入 Skill，按参考图自由增强
    const skipSkill = builtIn ? !!builtIn.skipSkill : false;
    const baseDirForChar = builtIn ? null : (body.base_direction ? DIRECTIONS[body.base_direction.toString()] : null);
    const dirGroup = builtIn ? builtIn.group : (baseDirForChar?.group || (body.group || '').toString());
    const isCharacter = !skipSkill && dirGroup === 'character';
    const isRealisticCharacter = isCharacter && (builtIn ? builtIn.realistic : baseDirForChar?.realistic);

    if (isCharacter) {
      systemPrompt = `${HOLLYWOOD_SKILL}\n\n${systemPrompt}`;
    }
    // 真人写实方向：在概念设计之上叠加强制真人皮肤写实规范
    if (isRealisticCharacter) {
      systemPrompt = `${systemPrompt}\n\n${REALISM_BLOCK}`;
    }

    // 场景设计通用：所有场景方向均注入影视美术指导 Skill 方法论
    const isScene = !skipSkill && (builtIn
      ? builtIn.group === 'scene'
      : (baseDirForChar?.group === 'scene' || (!baseDirForChar && dirGroup === 'scene')));
    if (isScene) {
      systemPrompt = `${SCENE_SKILL}\n\n${systemPrompt}`;
    }
    const paletteScope = dirGroup === 'scene' ? 'environment' : dirGroup === 'character' ? 'character' : '';
    const activePalette = paletteScope ? normalizeColorPalette(body.color_palette, paletteScope) : null;
    const paletteInstruction = paletteScope ? buildColorPaletteInstruction(activePalette, paletteScope) : '';

    // 参考图（视觉理解）
    const fileUrls = Array.isArray(body.file_urls) ? body.file_urls : (body.file_url ? [body.file_url.toString()] : null);
    let imageInstruction = '';
    if (fileUrls) {
      imageInstruction = `\n\n用户上传了一张参考图。请先分析参考图的：主体、构图、景别、光影、色调、材质、风格流派等视觉特征。无论整体优化还是局部修改，都必须最大程度还原并保留原本参考图的质感、材质与细节，保持内容严格一致性——除用户明确要求改动的部分外，其余内容严格保持不变，不得擅自改变参考图中的主体、构图、色调与材质。若参考图上有手绘标注（红色圆圈、箭头或文字说明），这些标注指明了用户想要修改的具体部位或元素——请将标注区域作为局部修改目标，只改动标注处，保持其余部分完全不变，并参照标注文字理解用户的修改意图。`;
    }

    // 自我提升：拉取该方向下用户认可的优质范例作为 few-shot 学习样本
    let examplesText = '';
    try {
      const examples = await base44.asServiceRole.entities.Prompt.filter(
        { rating: { $gte: 4 }, direction: directionKey },
        '-updated_date',
        3
      );
      if (examples && examples.length > 0) {
        const blocks = examples.map((ex, i) =>
          `范例${i + 1}\n输入：${ex.raw_input}\n优化输出：${ex.content}`
        ).join('\n\n');
        examplesText = `\n\n以下是该用户过往认可的优秀优化范例，请参考其风格、详略与结构偏好来优化本次输入（模仿而非照抄）：\n${blocks}\n`;
      }
    } catch (e) {
      // 范例拉取失败不阻断主流程
    }

    // 模型选择：用户可指定 Gemini / GPT / Claude
    const modelRaw = (body.model || '').toString();
    const model = (modelRaw && modelRaw !== 'automatic') ? modelRaw : null;

    // ===== 反推模式：对所有维度统一调用视觉风格逆向工程 Skill =====
    // 无论选择哪个反推维度（风格/人物/场景），底层均使用 VISUAL_STYLE_REVERSE_SKILL 提取可迁移的 Style DNA
    if (mode === 'reverse') {
      const extractKey = (body.extract || 'style_full').toString();
      const dim = REVERSE_DIMENSIONS[extractKey] || REVERSE_DIMENSIONS.style_full;
      const reverseFileUrls = Array.isArray(body.file_urls) ? body.file_urls : (body.file_url ? [body.file_url] : []);
      if (reverseFileUrls.length === 0) return Response.json({ error: '反推需要上传参考图' }, { status: 400 });

      // 各反推维度映射到 Style DNA 中的重点分析领域（仍输出完整23节分析，但对该领域做更细致解构）
      const DIMENSION_FOCUS = {
        style_full: '整张图的综合风格——对所有维度等权分析，输出完整的 Style DNA',
        char_silhouette: '重点聚焦形状语言(Shape Language)、构图DNA(主体位置/比例/负空间)、摄影机语言(景别/视角)——提取角色轮廓与姿态的可迁移风格规律',
        char_clothing: '重点聚焦材质与表面语言(Material)、色彩系统(Colour)、纹理(Texture)——提取服装材质与色彩的可迁移风格规律',
        char_accessories: '重点聚焦材质与表面语言(Material)、元素词汇(Element Vocabulary)——提取配饰器物的可迁移风格规律',
        char_face: '重点聚焦光影DNA(Lighting)、纹理与颗粒(Texture)、色彩系统(Colour)——提取面部渲染风格(肤质处理/妆感/布光)的可迁移规律',
        char_hairstyle: '重点聚焦线条语言(Line)、形状语言(Shape)、纹理(Texture)——提取发型渲染风格的可迁移规律',
        char_makeup: '重点聚焦色彩系统(Colour)、光影DNA(Lighting)、纹理(Texture)——提取妆容色彩与质感的可迁移风格规律',
        char_style: '重点聚焦人物整体造型风格——综合材质/色彩/光影/形状语言，提取人物整体视觉风格DNA',
        char_full: '重点聚焦人物完整风格——综合所有维度，提取人物作为画面的整体可迁移视觉规律',
        scene_space: '重点聚焦空间语言(Spatial)、构图DNA(Composition)、摄影机语言(Camera)——提取空间结构的可迁移风格规律',
        scene_color: '重点聚焦色彩系统(Colour System)——主色/辅色/强调色配比、饱和度结构、色温、色彩关系',
        scene_material: '重点聚焦材质与表面语言(Material)、纹理与颗粒(Texture)——提取场景材质质感的可迁移风格规律',
        scene_lighting: '重点聚焦光影DNA(Lighting DNA)——主光方向/光质/光比/阴影/高光/特殊光效',
        scene_style: '重点聚焦场景整体风格——综合空间/色调/材质/光影，提取场景整体视觉风格DNA',
        scene_full: '重点聚焦场景完整风格——综合所有维度，提取场景作为画面的整体可迁移视觉规律',
        style_color: '重点聚焦色彩系统(Colour DNA)——主色/辅色/强调色配比、HEX估值、色彩面积结构(Dominant/Supporting/Accent)、影调、饱和度、冷暖、色彩关系、色块方式——提取色彩的可迁移风格规律',
        style_lighting: '重点聚焦光影DNA(Lighting DNA)——主光方向/光质/光比/阴影/高光/光线类型/Lighting Formula——提取光影的可迁移风格规律',
        style_shape: '重点聚焦形状语言(Shape Language)——基础形状/几何vs有机/圆润vs尖锐/简单vs复杂/对称vs不规则——提取形状语言的可迁移风格规律',
        style_material: '重点聚焦材质DNA(Material)——材质类型/表面属性/材质对比——提取材质质感的可迁移风格规律',
        style_texture: '重点聚焦纹理DNA(Texture)——表面纹理类型(颗粒/噪点/笔触/晕染/CGI平滑等)——提取纹理质感的可迁移风格规律',
        style_elements: '重点聚焦元素词汇(Element Vocabulary)——反复出现的风格元素/区分风格元素与内容元素——提取可迁移的元素搭配规律'
      };
      const focusText = DIMENSION_FOCUS[extractKey] || DIMENSION_FOCUS.style_full;

      // 判断是完整风格反推、完整人物反推、还是精准局部反推
      const FULL_DIMENSIONS = ['style_full', 'char_style', 'scene_style'];
      const isFullReverse = FULL_DIMENSIONS.includes(extractKey);
      const isCharFull = extractKey === 'char_full';
      const isSceneFull = extractKey === 'scene_full';

      let reversePromptText;
      let reverseSchema;
      if (isSceneFull) {
        // 完整反推场景：全维度描述整张图片，生成可精准还原原图的场景复刻提示词
        reverseSchema = SCHEMA;
        reversePromptText = `你是顶级AI场景概念设计师与视觉分析师。用户上传了参考图，需要你完整反推图片中场景的全部信息，尽可能多地描述整张图片的所有方面，生成可直接用于生图、能精准还原原图的场景复刻提示词。

本次反推维度：「完整反推场景」

必须完整覆盖以下所有场景维度（不可遗漏任何一项，每个维度都要尽可能详细）：
1. 空间结构：空间类型、空间布局、透视纵深、几何拓扑、物件摆放、空间规划与层次
2. 建筑元素：建筑风格、墙体、柱子、梁、门窗、楼梯、天花板、地面、装饰结构
3. 色彩配色：主色调、辅助色、强调色、色彩情绪、饱和度、对比度、色温、调色风格、色彩面积占比
4. 材质质感：物体与表面的材质（金属/木材/玻璃/石材/织物/混凝土等）、纹理、反射率、粗糙度
5. 光影氛围：光源类型与方向、光质、明暗对比、色温、体积光、阴影、布光风格
6. 道具陈设：家具、装饰物、生活用品、功能设备、陈设布局与使用痕迹
7. 环境氛围：天气、时间、季节、空气质感、大气效果
8. 构图与镜头：构图方式、主体位置、景别、视角、透视、景深
9. 整体风格：空间整体风格流派、艺术风格、视觉气质、世界观

输出要求（严格以JSON返回）：
1) enhanced_prompt = 完整的场景复刻英文提示词，必须包含以上所有9个维度的具体描述，尽可能详细，可直接用于Midjourney v8.2/Flux/SDXL生图，最大程度精准还原原图场景的所有特征
2) enhanced_prompt_zh = 对应的中文完整场景描述提示词，同样必须包含以上所有9个维度，尽可能详细
3) analysis = 中文Markdown场景完整分析，按以上9个维度逐一详细描述图片中场景的具体特征
4) title = 简短中文标题(5-12字)
5) tags = 3-5个中文标签`;
      } else if (isCharFull) {
        // 完整反推人物：涵盖发型/妆容/面部/衣物/动作等所有人物内容，生成人物复刻提示词
        reverseSchema = SCHEMA;
        reversePromptText = `你是顶级AI角色概念设计师与视觉分析师。用户上传了参考图，需要你完整反推图片中人物的全部信息，并生成可直接用于生图的人物复刻提示词。

本次反推维度：「完整反推人物」

必须完整覆盖以下所有人物维度（不可遗漏任何一项）：
1. 整体外貌：性别、年龄段、种族/民族特征、体型身材、身高比例、肤色肤质
2. 面部五官：脸型、眼睛（形状/颜色/眼神）、眉毛、鼻子、嘴唇、牙齿、面部对称性、面部特征（痣/疤/酒窝等）
3. 发型：发色、发型样式、长度、刘海、发质、造型方式
4. 妆容：底妆、眼妆、唇妆、眉形、腮红、修容、妆感风格（自然/浓妆/特效妆）、妆色
5. 服装：款式、材质、颜色、剪裁版型、穿搭层次、风格流派
6. 配饰：首饰、帽子、眼镜、包、武器、道具等
7. 动作姿态：肢体动作、姿态、朝向、姿势、动态趋势、表情神态
8. 气质与整体风格：人物整体造型风格、气质呈现

输出要求（严格以JSON返回）：
1) enhanced_prompt = 完整的人物复刻英文提示词，必须包含以上所有8个维度的具体描述，可直接用于Midjourney v8.2/Flux/SDXL生图，最大程度还原原图人物的所有特征
2) enhanced_prompt_zh = 对应的中文完整人物描述提示词，同样必须包含以上所有8个维度
3) analysis = 中文Markdown人物完整分析，按以上8个维度逐一描述图片中人物的具体特征
4) title = 简短中文标题(5-12字)
5) tags = 3-5个中文标签`;
      } else if (isFullReverse) {
        reverseSchema = VISUAL_STYLE_SCHEMA;
        reversePromptText = `${VISUAL_STYLE_REVERSE_SKILL}\n\n请对这${reverseFileUrls.length > 1 ? '些' : '张'}参考图执行完整的视觉风格逆向工程，提取可迁移、可复现的 Style DNA。${reverseFileUrls.length > 1 ? '由于输入了多张参考图，请进入多图风格提纯模式(Cross-image Style Extraction)，建立 Style Intersection，区分 Constant/Frequent/Variable/Accidental，优先使用 Constant+Frequent。' : ''}\n\n本次反推维度：「${dim.label}」——${focusText}。请在完整23节分析的基础上，对该重点领域做更细致的解构，但enhanced_prompt/prompt_template/precision_prompt 仍须输出完整的纯风格提示词（不限于该维度，而是整图可迁移的风格语言）。\n\n输出要求（严格以JSON返回）：\n1) enhanced_prompt = Style-only Prompt 纯风格英文工程提示词(只含风格、不含原图具体人物/产品/事件/特定物体，可自由替换主体)，可直接用于Midjourney v8.2/Flux/SDXL/Seedream/Nano Banana，画幅比例贴合原图；\n2) enhanced_prompt_zh = 对应中文纯风格提示词；\n3) prompt_template = 带[SUBJECT]/[ACTION]/[ENVIRONMENT]/[PRODUCT]/[NARRATIVE EVENT]变量的英文模板提示词；\n4) prompt_template_zh = 对应中文模板；\n5) precision_prompt = Precision Prompt 高度还原版英文详细提示词(含色彩比例/光线/材质/构图/摄影机/纹理/后期)；\n6) precision_prompt_zh = 对应中文精准提示词；\n7) negative_prompt = 英文负向风格约束(来源于参考图而非套模板)；\n8) style_signature = 一句专业中文风格定义(风格指纹)，用中文概括整体风格特征；\n9) style_invariants = 5-12个必须保留的视觉规律(风格不变量)；\n10) analysis = 中文Markdown完整16层结构化风格DNA分析，严格按从大到小顺序：01媒介与制作方式/02艺术风格与大类美学/03整体视觉气质/04色彩DNA/05线条与边缘DNA/06形状语言/07材质DNA/08纹理DNA/09光影DNA/10构图DNA/11镜头语言/12空间语言/13元素词汇/14视觉节奏/15后期风格/16风格权重(S/A/B/C分级)，每层给出具体可工程化描述；\n11) analysis_layers = 16层风格DNA结构化数组，每个元素包含title(如"01 媒介与制作方式")和detail(该层级详细精准分析，2-5句完整描述，必须包含具体可工程化参数如HEX色值/面积占比百分比/光位方向/材质名称/镜头焦段/构图比例等，严禁笼统形容词)，严格按从大到小16层顺序输出；\n12) title = 概括风格的简短中文标题(5-12字)；\n13) tags = 3-5个中文风格标签。`;
      } else {
        // 精准局部反推：只提取用户指定维度的信息，输出仅包含该维度的提示词
        reverseSchema = SCHEMA;
        reversePromptText = `你是专业的视觉分析师与AI图像提示词工程师。用户上传了参考图，只需要你精准提取「${dim.label}」这一个维度的信息，不要输出其他维度的内容。

本次反推维度：「${dim.label}」
聚焦：${dim.focus}

严格只分析和描述该维度，禁止输出其他维度的内容。不要做整图综合风格分析，不要输出风格DNA，只输出该维度的精准描述。

输出要求（严格以JSON返回）：
1) enhanced_prompt = 仅包含该维度特征的英文提示词，可直接用于生图（只描述${dim.label}，不含其他维度信息，不含整图风格分析）
2) enhanced_prompt_zh = 对应中文提示词（只描述${dim.label}）
3) analysis = 该维度的简要分析（中文，只分析${dim.label}相关的视觉特征，3-8行即可）
4) title = 简短中文标题(5-12字)
5) tags = 3-5个中文标签`;
      }
      if (reverseFileUrls.length > 0) {
        reversePromptText += `\n\n【标注意图识别】若参考图上有手绘标注（红色圆圈、箭头或文字说明），这些标注指明了用户重点关注或想要提取的具体部位——请将标注区域作为重点分析目标，参照标注文字理解用户的反推意图，在标注处做更细致的解构。`;
      }
      let refine = (body.refine || '').toString().trim();
      if (refine) {
        try {
          const cleanedRefine = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `${INPUT_CLEANUP_SKILL}\n\n待整理的输入：\n${refine}`
          });
          const rText = typeof cleanedRefine === 'string' ? cleanedRefine : ((cleanedRefine && (cleanedRefine.response || cleanedRefine.text || cleanedRefine.output)) || '');
          if (rText.trim()) refine = rText.trim();
        } catch {}
        if (refine) reversePromptText += `\n\n用户补充的精确风格反推方向（请据此细化重点）：${refine}`;
      }
      const reverseArgs = { prompt: reversePromptText, response_json_schema: reverseSchema, file_urls: reverseFileUrls };
      if (model) reverseArgs.model = model;
      // 反推为视觉+复杂Schema的重调用，偶发超时或JSON校验失败时自动重试一次
      let rResult = null;
      let lastErr = null;
      for (let attempt = 0; attempt < 2 && !rResult; attempt++) {
        try {
          rResult = await base44.asServiceRole.integrations.Core.InvokeLLM(reverseArgs);
        } catch (e) {
          lastErr = e;
        }
      }
      if (!rResult) throw lastErr || new Error('反推服务暂不可用，请稍后重试');
      return Response.json({
        title: rResult.title,
        enhanced_prompt: enforceMjVersion(rResult.enhanced_prompt),
        enhanced_prompt_zh: rResult.enhanced_prompt_zh,
        prompt_template: isFullReverse ? enforceMjVersion(rResult.prompt_template || '') : '',
        prompt_template_zh: isFullReverse ? (rResult.prompt_template_zh || '') : '',
        precision_prompt: isFullReverse ? enforceMjVersion(rResult.precision_prompt || '') : '',
        precision_prompt_zh: isFullReverse ? (rResult.precision_prompt_zh || '') : '',
        negative_prompt: isFullReverse ? (rResult.negative_prompt || '') : '',
        negative_prompt_zh: isFullReverse ? (rResult.negative_prompt_zh || '') : '',
        style_signature: isFullReverse ? (rResult.style_signature || '') : '',
        style_invariants: isFullReverse && Array.isArray(rResult.style_invariants) ? rResult.style_invariants : [],
        analysis: rResult.analysis || '',
        analysis_layers: isFullReverse && Array.isArray(rResult.analysis_layers) ? rResult.analysis_layers : [],
        tags: rResult.tags || [],
        cleaned_input: refine,
        dimension: extractKey,
        dimension_label: dim.label,
        mode: isFullReverse ? 'reverse_style' : 'reverse_focused'
      });
    }

    // ===== 逻辑修复模式：基于用户标注生成修复提示词 =====
    if (mode === 'repair') {
      const repairFileUrls = Array.isArray(body.file_urls) ? body.file_urls : (body.file_url ? [body.file_url] : []);
      if (repairFileUrls.length === 0) return Response.json({ error: '请上传场景图片' }, { status: 400 });

      const repairContext = (body.raw_input || '').toString().trim();
      let repairPromptText = `${PRODUCTION_DESIGN_REPAIR_SKILL}\n\n用户上传了一张场景图，并在图上用红色圆圈/椭圆标注了需要修复的错误区域，可能还附有红色文字说明。请根据用户的标注生成精准的局部修复提示词。\n\n标注说明：\n- 红色圆圈/椭圆 = 用户标记的需要修复的错误区域\n- 红色文字 = 用户对该区域的修改说明\n\n请根据图中标注的区域和文字说明，生成精准的局部修复提示词。遵循最小修改原则——只修复用户标注的区域，保持其余部分完全不变。`;
      const repairPalette = normalizeColorPalette(body.color_palette, 'environment');
      if (repairContext) {
        repairPromptText += `\n\n用户补充的文字描述：${repairContext}`;
      }
      repairPromptText += sharedContextInstruction;
      repairPromptText += `\n\n请严格以JSON返回，包含title/scene_analysis/repair_prompt_zh/repair_prompt_en/negative_constraints/tags。\n- repair_prompt_zh = 中文修复提示词（可直接复制使用），格式：保持原图……不要改变……只修改以下区域：（根据标注逐一列出修改项）……最终要求……\n- repair_prompt_en = English Repair Prompt\n- negative_constraints = 负向约束（中文）\n- scene_analysis = 中文简述用户标注了哪些区域以及你将如何修复\n- title = 简短中文标题\n- tags = 3-5个中文标签`;

      const repairArgs = { prompt: repairPromptText, response_json_schema: REPAIR_SCHEMA, file_urls: repairFileUrls };
      if (model) repairArgs.model = model;

      let repairResult = null;
      let repairErr = null;
      for (let attempt = 0; attempt < 2 && !repairResult; attempt++) {
        try {
          repairResult = await base44.asServiceRole.integrations.Core.InvokeLLM(repairArgs);
        } catch (e) { repairErr = e; }
      }
      if (!repairResult) throw repairErr || new Error('逻辑修复服务暂不可用，请稍后重试');

      return Response.json({
        title: repairResult.title,
        repair_prompt_zh: applyColorPaletteToPrompt(repairResult.repair_prompt_zh || '', repairPalette, 'environment', 'zh'),
        repair_prompt_en: applyColorPaletteToPrompt(repairResult.repair_prompt_en || '', repairPalette, 'environment', 'en'),
        scene_analysis: repairResult.scene_analysis || '',
        negative_constraints: repairResult.negative_constraints || '',
        tags: repairResult.tags || [],
        cleaned_input: repairContext,
        color_palette: repairPalette,
        mode: 'repair'
      });
    }

    // 台词处理：优化台词开关（默认关闭=保留原台词原封不动）
    const dialogueOptimize = !!body.dialogue_optimize;
    const dialogueInstruction = dialogueOptimize
      ? `\n\n【台词处理：优化模式（最高优先级铁律，凌驾于所有规则之上）】用户描述中可能包含人物台词/对话。判定规则：冒号（：或:）后面的内容一律视为台词，必须100%完整识别并保留，不得截断、不得遗漏、不得只保留一部分。优化时只调整台词的表达自然度，但必须保留每一句台词的完整内容与核心含义，不得删除任何一句台词。优化后的台词必须完整出现在enhanced_prompt_zh的描述中相应位置。若原文有多句台词，必须全部保留，禁止只保留部分。同时必须将所有台词逐字提取到preserved_dialogue数组中。`
      : `\n\n【台词处理：保留模式（最高优先级铁律，凌驾于所有规则之上）】用户描述中可能包含人物台词/对话。判定规则：冒号（：或:）后面的内容一律视为台词，必须100%完整识别并原封不动保留，不得截断、不得遗漏、不得只保留一部分、不得改写、不得省略。所有台词必须原样出现在enhanced_prompt_zh的描述中相应位置（嵌入在角色说话的时刻）。若原文有多句台词，必须全部保留，禁止只保留部分。在编译英文enhanced_prompt时，也必须将所有台词完整翻译保留（用引号包裹），不得遗漏。同时必须将所有台词逐字提取到preserved_dialogue数组中，每句一个元素，原样保留。`;

    // ===== 视频提示词翻译（单镜头）=====
    // 当目标引擎为视频生成时，走视频翻译路径，不走角色/场景概念设计 Skill（好莱坞 Skill 不注入）
    const isVideoTarget = (body.target_type || 'image').toString() === 'video';
    if (mode === 'video_director' || (mode === 'enhance' && isVideoTarget)) {
      if (!rawInput) return Response.json({ error: '请输入镜头描述' }, { status: 400 });
      const targetModel = (body.target_model || body.target || 'auto').toString();
      const videoModelGuide = MODEL_GUIDE[targetModel] || MODEL_GUIDE['auto'];

      const dialoguePreExtract = buildDialoguePreExtract(rawInput);
      let videoPrompt = `${VIDEO_DIRECTOR_SKILL}\n\n用户输入：${rawInput}\n\n目标视频模型：${targetModel}\n该模型的提示词格式要求：${videoModelGuide}${dialogueInstruction}${dialoguePreExtract}`;
      videoPrompt += sharedContextInstruction;
      if (fileUrls && fileUrls.length > 0) {
        videoPrompt += `\n\n【参考图已提供】用户上传了${fileUrls.length}张参考图。可从图中识别与运动相关的信息（如衣摆随步伐摆动、发丝因转身产生惯性）。禁止输出静态造型描述（服装款式/发型/五官/场景陈设）。若参考图上有手绘标注（红色圆圈、箭头或文字说明），这些标注指明了用户想要重点表现或修改的具体部位——请将标注区域作为重点，参照标注文字理解用户的导演意图。`;
      } else {
        videoPrompt += `\n\n【无参考图】禁止编造角色造型与场景设计，人物只用中性称谓，不得出现任何器材型号与画质标签。`;
      }
      videoPrompt += `\n\n请严格以JSON返回。只翻译和具象化用户明确表达的内容，不补全任何未提及维度，enhanced_prompt顺序跟随用户原文。`;

      const videoArgs = { prompt: videoPrompt, response_json_schema: VIDEO_DIRECTOR_SCHEMA };
      if (fileUrls) videoArgs.file_urls = fileUrls;
      if (model) videoArgs.model = model;

      let vResult = null;
      let vErr = null;
      for (let attempt = 0; attempt < 2 && !vResult; attempt++) {
        try {
          vResult = await base44.asServiceRole.integrations.Core.InvokeLLM(videoArgs);
        } catch (e) { vErr = e; }
      }
      if (!vResult) throw vErr || new Error('视频翻译服务暂不可用，请稍后重试');

      // 后处理：确定性提取所有台词，检查是否缺失，缺失则强制注入确保不丢失
      const extractedDialogues = extractDialogueFromInput(rawInput);
      const llmDialogues = Array.isArray(vResult.preserved_dialogue) ? vResult.preserved_dialogue : [];
      const finalDialogues = llmDialogues.length > 0 ? llmDialogues : extractedDialogues;
      const ensuredZh = ensureDialoguePreserved(vResult.enhanced_prompt_zh || '', rawInput);

      return Response.json({
        title: vResult.title,
        enhanced_prompt: vResult.enhanced_prompt,
        enhanced_prompt_zh: ensuredZh,
        preserved_dialogue: finalDialogues,
        semantic_lock: vResult.semantic_lock || '',
        shot_intent: vResult.shot_intent || '未知',
        diagnosis: vResult.diagnosis || '',
        enhanced_dimensions: Array.isArray(vResult.enhanced_dimensions) ? vResult.enhanced_dimensions : [],
        tags: vResult.tags || [],
        cleaned_input: rawInput,
        mode: 'video_director'
      });
    }

    // ===== 视频分镜表批量翻译 =====
    if (mode === 'video_batch') {
      const shots = Array.isArray(body.shots) ? body.shots : [];
      if (shots.length === 0) return Response.json({ error: '未检测到分镜数据' }, { status: 400 });
      const targetModel = (body.target_model || 'auto').toString();
      const batchModelGuide = MODEL_GUIDE[targetModel] || MODEL_GUIDE['auto'];

      const results = [];
      for (let i = 0; i < shots.length; i++) {
        const shot = shots[i];
        const ctxBefore = shots.slice(Math.max(0, i - 2), i).map(s => s.original_prompt || '').filter(Boolean).join(' / ');
        const ctxAfter = shots.slice(i + 1, i + 3).map(s => s.original_prompt || '').filter(Boolean).join(' / ');

        const shotDialoguePreExtract = buildDialoguePreExtract(shot.original_prompt || '');
        let batchPrompt = `${VIDEO_DIRECTOR_SKILL}\n\n用户输入：${shot.original_prompt || ''}\n\n目标视频模型：${targetModel}\n该模型的提示词格式要求：${batchModelGuide}${dialogueInstruction}${shotDialoguePreExtract}${sharedContextInstruction}`;
        if (ctxBefore) batchPrompt += `\n\n上下文（前几镜，用于理解"她"等代词指代）：${ctxBefore}`;
        if (ctxAfter) batchPrompt += `\n\n后续镜头：${ctxAfter}`;
        batchPrompt += `\n\n请严格以JSON返回。只翻译当前镜头，不要输出其他镜头的内容。只翻译和具象化用户明确表达的内容，不补全任何未提及维度。`;

        const batchArgs = { prompt: batchPrompt, response_json_schema: VIDEO_DIRECTOR_SCHEMA };
        if (model) batchArgs.model = model;

        try {
          const bResult = await base44.asServiceRole.integrations.Core.InvokeLLM(batchArgs);
          // 后处理：确定性提取所有台词，检查是否缺失，缺失则强制注入确保不丢失
          const shotDialogues = extractDialogueFromInput(shot.original_prompt || '');
          const llmShotDialogues = Array.isArray(bResult.preserved_dialogue) ? bResult.preserved_dialogue : [];
          const finalShotDialogues = llmShotDialogues.length > 0 ? llmShotDialogues : shotDialogues;
          const ensuredShotZh = ensureDialoguePreserved(bResult.enhanced_prompt_zh || '', shot.original_prompt || '');
          results.push({
            shot_id: shot.shot_id || `shot_${i + 1}`,
            original_prompt: shot.original_prompt || '',
            enhanced_prompt: bResult.enhanced_prompt || '',
            enhanced_prompt_zh: ensuredShotZh,
            preserved_dialogue: finalShotDialogues,
            shot_intent: bResult.shot_intent || '未知',
            enhanced_dimensions: Array.isArray(bResult.enhanced_dimensions) ? bResult.enhanced_dimensions : [],
            tags: bResult.tags || []
          });
        } catch (e) {
          results.push({
            shot_id: shot.shot_id || `shot_${i + 1}`,
            original_prompt: shot.original_prompt || '',
            enhanced_prompt: '',
            enhanced_prompt_zh: '',
            tags: [],
            error: e.message
          });
        }
      }
      return Response.json({ shots: results, mode: 'video_batch' });
    }

    // 目标引擎：优化后的提示词将喂给哪个生成模型，按其语法惯例组织输出
    const targetKey = (body.target || '').toString() || 'generic_image';
    const targetLabel = (body.target_label || targetKey || '通用').toString();
    const targetType = (body.target_type || 'image').toString() === 'video' ? '视频生成' : '图像生成';
    const modelGuide = MODEL_GUIDE[targetKey] || MODEL_GUIDE['auto'];
    const targetInstruction = `\n\n【目标引擎】优化后的提示词将喂给「${targetLabel}」（${targetType}）。该模型的提示词格式要求：${modelGuide}。请严格按照该模型已知的最佳提示词格式、语法惯例、参数写法与语言偏好来组织输出。`;

    const modifyInstruction = `\n\n【意图判断】请先判断用户输入属于哪种情况，再据此生成：\n1) 局部修改：用户只想改动画面中的某个局部或特定元素（例如"把面具做得更精致""只换衣服颜色""背景改成夜晚"），同时可能要求保持其余特征不变。此时务必：(a) 精确描述要修改的目标元素及其期望变化（如更精致的纹理、更美观的细节），但保持用户明确要求的属性（如大小、形状）不变；(b) 明确锁定并保留画面其余所有部分完全不变，使用 keep unchanged / preserve / only modify / inpaint / regional edit 等语义，或目标引擎的区域编辑/重绘语法；(c) 绝不改动用户未提及的部分。\n2) 整体优化：用户希望对整个画面进行扩展增强（无明确局部限定）。此时全面扩充主体、风格、构图、光影、画质等维度。\n若提供了参考图：局部修改时以参考图为基底仅改动指定区域；整体优化时参考其视觉风格。`;

    // ===== 视角模式：角色多视图设定图 / 角色·场景多视角 =====
    if (mode === 'sheet') {
      if (!rawInput && !fileUrls) return Response.json({ error: '请输入描述或上传参考图' }, { status: 400 });

      const subject = (body.subject || 'character').toString();
      const viewType = (body.view_type || (subject === 'scene' ? 'left' : 'merge')).toString();
      const vpCustom = (body.view_custom || '').toString().trim();

      const VIEWPOINTS = {
        left: { label: '左侧视角', focus: '从主体左侧视角呈现，展现左侧的纵深、结构与轮廓' },
        right: { label: '右侧视角', focus: '从主体右侧视角呈现，展现右侧的纵深、结构与轮廓' },
        closeup: { label: '近景特写', focus: '对主体的近景特写，突出整体特征、质感与神态' },
        detail: { label: '局部特写', focus: '对主体某个具体部位或元素的局部特写，极致突出细节与材质' },
        reframe: { label: '视角转换', focus: '在保留主体与核心元素不变的前提下，改变取景角度与构图，呈现新的视角' }
      };

      let sheetSystem, sheetFile, subjectLabel, categoryLabel;

      if (subject === 'character' && viewType === 'merge') {
        // 一键合并人物形象：基于上传参考图的角色多视图视角转换（近景特写 + 正/侧/背三视图合并于一张图）
        sheetSystem = `${VIEWPOINT_SKILL}\n\n你是AI角色设定图（character sheet / turnaround）提示词工程师。本次任务是基于用户上传的人物参考图，生成同一角色的多视角设定图——本质是对上传图片进行多视角转换，严格保持角色一致性。\n画面要求：\n1) 布局为角色多视图设定图（character turnaround / model sheet），在同一张图上依次呈现：面部正脸特写（facial close-up）、半身特写（half-body close-up）、正面全身（front view）、侧面全身（side view）、背面全身（back view）；\n2) 各视图角色绝对一致——同一张脸、同一发型发色、同一服装、同一配饰、同一身材比例（consistent character, identical across all views, multiple views, character sheet, turnaround, model sheet）；\n3) 最大程度保留质感与细节——皮肤毛孔、服装材质、配饰纹理、毛发细节（ultra-detailed, texture preservation, high resolution, 8k），最大程度还原原本参考图的质感；\n4) 中性或纯色背景便于参考（neutral background / white background, reference sheet）；\n5) 适合目标引擎的参数语法（多视图布局、一致性权重等）。\n\n严格要求：enhanced_prompt开头必须明确声明"Based on the uploaded reference image, multi-viewpoint transformation generating character turnaround sheet"，enhanced_prompt_zh开头必须明确声明"基于上传的参考图进行多视角转换，生成角色三视图设定图，严格保持与原图角色一致"。`;
        sheetFile = fileUrls ? `\n\n用户上传了一张正面或完整的人物参考图。这是视角转换的基底——必须严格基于该参考图生成多视角设定图，最大程度还原原本参考图的质感、材质与每一个细节，保持角色内容100%一致，不得改变角色的外貌、五官、发型、服装、配饰与身材。若参考图上有手绘标注（红色圆圈、箭头或文字说明），这些标注指明了用户重点关注或想要调整的具体部位——请参照标注文字理解用户的意图。生成保持该角色绝对一致性的多视图设定图提示词（面部正脸特写 + 半身特写 + 正面/侧面/背面三视图合并于一张图）。` : '';
        subjectLabel = '角色描述';
        categoryLabel = '角色表演';
      } else {
        // 通用视角转换（人物或场景）：注入视角转换专用 Skill，严格基于上传参考图进行视角转换
        const vp = VIEWPOINTS[viewType] || VIEWPOINTS.left;
        const subjectNoun = subject === 'scene' ? '场景' : '人物/角色';
        sheetSystem = `${VIEWPOINT_SKILL}\n\n本次视角转换任务：基于用户上传的${subjectNoun}参考图，生成「${vp.label}」视角转换提示词。\n聚焦：${vp.focus}。`;
        if (vpCustom) sheetSystem += `\n用户补充的精确视角/部位/方向：${vpCustom}`;
        sheetSystem += `\n\n严格要求：\n1. 这是基于上传参考图的视角转换，不是重新创作——enhanced_prompt开头必须明确声明"Based on the uploaded reference image, viewpoint transformation to ${vp.label}"，enhanced_prompt_zh开头必须明确声明"基于上传的参考图进行视角转换：${vp.label}，严格保持与原图一致"。\n2. 必须先从参考图提取并锁定主体/场景/风格/光影/色彩/材质等核心特征，在提示词中明确要求保持100%一致。\n3. 仅改变观察视角与取景，绝不改动主体外貌、服装、场景内容、色调与材质。\n4. 使用"maintain strict consistency / same character / same scene / preserve exactly"等一致性锁定语义。\n5. 按目标引擎语法组织输出；若为视频引擎，可加入对应镜头运动描述。`;
        sheetFile = fileUrls ? `\n\n用户上传了${subjectNoun}参考图。这是视角转换的基底——必须严格基于该参考图生成视角转换提示词，最大程度还原原本参考图的质感、材质与每一个细节，保持内容100%一致，仅改变观察视角，不改动主体与场景内容。若参考图上有手绘标注（红色圆圈、箭头或文字说明），这些标注指明了用户重点关注或想要调整的具体部位——请参照标注文字理解用户的视角意图。` : `\n\n注意：用户未上传参考图。请基于用户的文字描述生成视角转换提示词，但仍需在提示词中强调视角转换的一致性要求。`;
        subjectLabel = subject === 'scene' ? '场景描述' : '角色描述';
        categoryLabel = subject === 'scene' ? '场景构图' : '角色表演';
      }

      const sheetTarget = `\n\n【目标引擎】优化后的提示词将喂给「${targetLabel}」（${targetType}）。请按该模型已知的最佳提示词格式与语法组织输出。`;
      const descBlock = rawInput ? `${subjectLabel}：${rawInput}` : '（用户仅上传了参考图，未提供文字描述，请基于参考图生成）';
      const sheetPaletteScope = subject === 'scene' ? 'environment' : 'character';
      const sheetPalette = normalizeColorPalette(body.color_palette, sheetPaletteScope);
      const sheetPaletteInstruction = buildColorPaletteInstruction(sheetPalette, sheetPaletteScope);
      const sheetArgs = {
        prompt: `${sheetSystem}${sharedContextInstruction}${sheetPaletteInstruction}${sheetTarget}${sheetFile}\n\n${descBlock}\n\n要求：1) enhanced_prompt 输出英文提示词；2) enhanced_prompt_zh 输出对应中文；3) 简短中文标题(5-12字)；4) 3-5个中文标签。严格以JSON返回。`,
        response_json_schema: SCHEMA
      };
      if (fileUrls) sheetArgs.file_urls = fileUrls;
      if (model) sheetArgs.model = model;
      const sResult = await base44.asServiceRole.integrations.Core.InvokeLLM(sheetArgs);
      return Response.json({
        title: sResult.title,
        enhanced_prompt: applyColorPaletteToPrompt(enforceMjVersion(sResult.enhanced_prompt), sheetPalette, sheetPaletteScope, 'en'),
        enhanced_prompt_zh: applyColorPaletteToPrompt(sResult.enhanced_prompt_zh, sheetPalette, sheetPaletteScope, 'zh'),
        tags: sResult.tags || [],
        cleaned_input: rawInput,
        color_palette: sheetPalette,
        category: categoryLabel,
        subject,
        view_type: viewType,
        mode: 'sheet'
      });
    }

    // ===== 一键多视角模式：360°全景空间多视角提示词 =====
    // 对14个预设视角并行调用与单视角相同的视角转换逻辑（含VIEWPOINT_SKILL一致性锁定）
    if (mode === 'multi_view') {
      if (!fileUrls) return Response.json({ error: '一键多视角需要上传参考图' }, { status: 400 });

      const mvSubject = (body.subject || 'character').toString();
      const mvSubjectNoun = mvSubject === 'scene' ? '场景' : '人物/角色';
      const mvCategoryLabel = mvSubject === 'scene' ? '场景构图' : '角色表演';
      const mvSubjectLabel = mvSubject === 'scene' ? '场景描述' : '角色描述';
      const mvDescBlock = rawInput ? `${mvSubjectLabel}：${rawInput}` : '（用户仅上传了参考图，请基于参考图生成）';

      // 360°全景空间视角系统：水平八方位 + 垂直三俯仰 + 电影特殊机位
      const MULTI_VIEWS = [
        { view_type: 'front',          label: '正面',     group: '水平环绕', focus: '从正前方平视主体，展现正面完整结构与对称性' },
        { view_type: 'front_right_45', label: '右前45°',  group: '水平环绕', focus: '从右前方45度角呈现主体，展现正面到右侧的过渡纵深与立体感' },
        { view_type: 'right',          label: '右侧',     group: '水平环绕', focus: '从正右侧90度呈现主体，展现右侧完整轮廓与纵深' },
        { view_type: 'back_right_45',  label: '右后45°',  group: '水平环绕', focus: '从右后方45度角呈现主体，展现侧后方纵深与背面过渡' },
        { view_type: 'back',           label: '背面',     group: '水平环绕', focus: '从正后方呈现主体，展现背面完整结构与细节' },
        { view_type: 'back_left_45',   label: '左后45°',  group: '水平环绕', focus: '从左后方45度角呈现主体，展现左侧后方纵深与背面过渡' },
        { view_type: 'left',           label: '左侧',     group: '水平环绕', focus: '从正左侧90度呈现主体，展现左侧完整轮廓与纵深' },
        { view_type: 'front_left_45',  label: '左前45°',  group: '水平环绕', focus: '从左前方45度角呈现主体，展现正面到左侧的过渡纵深与立体感' },
        { view_type: 'low_angle',      label: '仰视',     group: '垂直俯仰', focus: '从低角度仰视主体，增强压迫感、力量感与宏伟感' },
        { view_type: 'high_angle',     label: '俯视',     group: '垂直俯仰', focus: '从高角度俯视主体，呈现主体全貌与空间关系' },
        { view_type: 'top_down',       label: '鸟瞰顶视', group: '垂直俯仰', focus: '从正上方垂直俯瞰主体，呈现顶面结构与空间布局' },
        { view_type: 'free_explore_1', label: '自由探索·景深与前景', group: '电影特殊', focus: '自由探索——不限定任何固定镜头术语，由你根据场景具体分析决定机位与取景', explore: '前景与景深' },
        { view_type: 'free_explore_2', label: '自由探索·线条与几何', group: '电影特殊', focus: '自由探索——不限定任何固定镜头术语，由你根据场景具体分析决定机位与取景', explore: '线条与几何' },
        { view_type: 'free_explore_3', label: '自由探索·隐藏与揭示', group: '电影特殊', focus: '自由探索——不限定任何固定镜头术语，由你根据场景具体分析决定机位与取景', explore: '隐藏与揭示' }
      ];

      const mvTarget = `\n\n【目标引擎】优化后的提示词将喂给「${targetLabel}」（${targetType}）。请按该模型已知的最佳提示词格式与语法组织输出。`;

      // 电影特殊视角专属：先点名分析参考图中具体物品，再输出一个具体的、确定的视角描述（三个视角探索方向不同，避免雷同）
      const CINEMATIC_SPECIAL_INSTRUCTION = (vp) => {
        if (vp.group !== '电影特殊') return '';
        const exploreGuides = {
          '前景与景深': '【本视角探索方向：前景与景深】先逐项点名图中真实存在的前景元素与纵深结构（人物肩膀/柱子/门框/帷幔/供桌边缘/香炉/灯笼/台阶/走廊/红绳/地面光斑等——只写图中真实有的）。',
          '线条与几何': '【本视角探索方向：线条与几何】先逐项点名图中真实存在的几何线条与结构（梁柱边缘/飞檐/悬挂红绳/地面接缝/台阶/门框/灯笼吊挂/对称轴/对角线等——只写图中真实有的）。',
          '隐藏与揭示': '【本视角探索方向：隐藏与揭示】先逐项点名图中当前视角看不到但确实存在的空间信息（神龛背面/供台背面/门窗另一面/墙面装饰/悬挂物背面/柱子另一侧/主体背后空间等——只写图中可推断真实有的）。'
        };
        return `\n\n${exploreGuides[vp.explore] || ''}\n\n强制要求（最重要）：\n1. 先在内部完成场景点名分析（明确图中具体有哪些物品/结构/线条/空间）。\n2. 然后给出一个【具体的、确定的】摄影视角描述——必须落到具体机位+具体角度+具体取景+具体利用了图中哪个物品。例如"从供桌右侧低机位贴着香炉边缘仰拍神像，前景香炉虚化占画面左1/3，沿红绳走向把视线引向神像面部"——这是一个具体的视角，不是"可以探索前景遮挡"这种泛泛说法。\n3. enhanced_prompt与enhanced_prompt_zh必须直接就是这个具体视角的描述（开头仍声明基于参考图视角转换），读起来像一段确定的摄影方案，而不是"你可以自由设计"的指令或"探索方向"的说明。\n4. 三个视角各自探索不同方向（前景与景深/线条与几何/隐藏与揭示），禁止相互雷同，禁止套用"荷兰角/过肩/反打"等固定镜头术语。\n5. 视角必须基于这张图的具体内容得出——换一张图，分析出的物品不同，给出的具体视角也应不同。禁止输出与场景无关的通用机位。`;
      };

      async function generateOneView(vp) {
        const vpSystem = `${VIEWPOINT_SKILL}\n\n本次视角转换任务：基于用户上传的${mvSubjectNoun}参考图，生成「${vp.label}」视角转换提示词。\n聚焦：${vp.focus}。${CINEMATIC_SPECIAL_INSTRUCTION(vp)}\n\n严格要求：\n1. 这是基于上传参考图的视角转换，不是重新创作——enhanced_prompt开头必须明确声明"Based on the uploaded reference image, viewpoint transformation to ${vp.label}"，enhanced_prompt_zh开头必须明确声明"基于上传的参考图进行视角转换：${vp.label}，严格保持与原图一致"。\n2. 必须先从参考图提取并锁定主体/场景/风格/光影/色彩/材质等核心特征，在提示词中明确要求保持100%一致。\n3. 仅改变观察视角与取景，绝不改动主体外貌、服装、场景内容、色调与材质。\n4. 使用"maintain strict consistency / same character / same scene / preserve exactly"等一致性锁定语义。\n5. 按目标引擎语法组织输出。`;
        const vpFile = `\n\n用户上传了${mvSubjectNoun}参考图。这是视角转换的基底——必须严格基于该参考图生成视角转换提示词，最大程度还原原本参考图的质感、材质与每一个细节，保持内容100%一致，仅改变观察视角，不改动主体与场景内容。`;
        const vpArgs = {
          prompt: `${vpSystem}${sharedContextInstruction}${mvTarget}${vpFile}\n\n${mvDescBlock}\n\n要求：1) enhanced_prompt 输出英文提示词；2) enhanced_prompt_zh 输出对应中文；3) 简短中文标题(5-12字)；4) 3-5个中文标签。严格以JSON返回。`,
          response_json_schema: SCHEMA
        };
        if (fileUrls) vpArgs.file_urls = fileUrls;
        if (model) vpArgs.model = model;
        try {
          const r = await base44.asServiceRole.integrations.Core.InvokeLLM(vpArgs);
          return {
            view_type: vp.view_type, label: vp.label, group: vp.group,
            title: r.title || vp.label,
            enhanced_prompt: applyColorPaletteToPrompt(enforceMjVersion(r.enhanced_prompt), requestedPalette, mvSubject === 'scene' ? 'environment' : 'character', 'en'),
            enhanced_prompt_zh: applyColorPaletteToPrompt(r.enhanced_prompt_zh || '', requestedPalette, mvSubject === 'scene' ? 'environment' : 'character', 'zh'),
            tags: r.tags || []
          };
        } catch (e) {
          return {
            view_type: vp.view_type, label: vp.label, group: vp.group,
            title: vp.label, enhanced_prompt: '', enhanced_prompt_zh: '', tags: [],
            error: e.message || '生成失败'
          };
        }
      }

      // 并发限制为5，避免一次性发起过多LLM调用
      const MV_CONCURRENCY = 5;
      const mvViews = [];
      for (let i = 0; i < MULTI_VIEWS.length; i += MV_CONCURRENCY) {
        const batch = MULTI_VIEWS.slice(i, i + MV_CONCURRENCY);
        const batchResults = await Promise.all(batch.map(generateOneView));
        mvViews.push(...batchResults);
      }

      return Response.json({
        views: mvViews,
        mode: 'multi_view',
        subject: mvSubject,
        category: mvCategoryLabel,
        cleaned_input: rawInput
      });
    }

    // ===== 风格库局部替换模式：基于参考图 + 多个选定风格模板，同时替换多个部位 =====
    if (mode === 'style_swap') {
      const swapFileUrls = Array.isArray(body.file_urls) ? body.file_urls : (body.file_url ? [body.file_url] : []);
      if (swapFileUrls.length === 0) return Response.json({ error: '风格替换需要上传参考图' }, { status: 400 });

      // 支持多选：styles 数组（每个元素含 name/category/style_prompt），兼容旧版单选字段
      const stylesArr: Array<{ name: string; category: string; style_prompt: string }> = Array.isArray(body.styles) && body.styles.length > 0
        ? body.styles.filter((s: any) => s && s.style_prompt)
        : (body.style_prompt ? [{ name: (body.style_name || '').toString(), category: (body.style_category || 'overall').toString(), style_prompt: body.style_prompt.toString() }] : []);
      if (stylesArr.length === 0) return Response.json({ error: '请选择风格模板' }, { status: 400 });

      const CATEGORY_LABELS: Record<string, string> = { overall: '总体形象', clothing: '服装', makeup: '化妆', hair: '发型', palette: '色卡', color: '色卡', colour: '色卡', color_palette: '色卡', colour_palette: '色卡' };
      const CATEGORY_FOCUS: Record<string, string> = {
        overall: '总体形象——替换角色的整体造型风格（服装/发型/配饰/气质综合），但保持人物身份（脸型/五官/身材比例）不变',
        clothing: '服装——仅替换角色的服装款式/材质/颜色/搭配，保持发型/妆容/面部/配饰/身材/姿势不变',
        makeup: '化妆——仅替换角色的妆容（底妆/眼妆/唇妆/眉形/腮红/修容），保持发型/服装/面部骨相/身材不变',
        hair: '发型——仅替换角色的发型（发色/发型样式/长度/刘海/造型），保持面部五官/妆容/服装/配饰不变',
        palette: '色卡——仅应用选定的主色、辅助色、强调色及其比例、饱和度和色温关系，保持人物身份、构图、造型、材质、光影和未指定内容不变',
        color: '色卡——仅应用选定的主色、辅助色、强调色及其比例、饱和度和色温关系，保持人物身份、构图、造型、材质、光影和未指定内容不变',
        colour: '色卡——仅应用选定的主色、辅助色、强调色及其比例、饱和度和色温关系，保持人物身份、构图、造型、材质、光影和未指定内容不变',
        color_palette: '色卡——仅应用选定的主色、辅助色、强调色及其比例、饱和度和色温关系，保持人物身份、构图、造型、材质、光影和未指定内容不变',
        colour_palette: '色卡——仅应用选定的主色、辅助色、强调色及其比例、饱和度和色温关系，保持人物身份、构图、造型、材质、光影和未指定内容不变'
      };

      const partsList = stylesArr.map((s) => CATEGORY_LABELS[s.category] || s.category).join(' + ');
      const stylesDescription = stylesArr.map((s, i) => `【风格${i + 1}】${s.name}（替换部位：${CATEGORY_LABELS[s.category] || s.category}）\n风格描述：${s.style_prompt}`).join('\n\n');
      const focusPerStyle = stylesArr.map((s) => `${CATEGORY_LABELS[s.category] || s.category}：${CATEGORY_FOCUS[s.category] || CATEGORY_FOCUS.overall}`).join('\n');

      // 风格替换 = 完整角色概念设计增强管线 + 风格库局部替换
      // 注入好莱坞角色设计 Skill，让风格替换与用户描述共同驱动一条完整的角色概念设计提示词
      const swapTargetKey = (body.target || 'generic_image').toString();
      const swapTargetLabel = (body.target_label || swapTargetKey || '通用').toString();
      const swapTargetType = (body.target_type || 'image').toString() === 'video' ? '视频生成' : '图像生成';
      const swapModelGuide = MODEL_GUIDE[swapTargetKey] || MODEL_GUIDE['auto'];
      const swapTargetInstruction = `\n\n【目标引擎】优化后的提示词将喂给「${swapTargetLabel}」（${swapTargetType}）。该模型的提示词格式要求：${swapModelGuide}。请严格按照该模型已知的最佳提示词格式、语法惯例、参数写法与语言偏好来组织输出。`;
      const swapImageInstruction = `\n\n用户上传了一张参考图。请先分析参考图的：主体身份(脸型/五官/身材比例)、构图、景别、光影、色调、材质、风格流派等视觉特征。本次任务是在参考图基础上进行风格替换——用户选定的${partsList}需要替换为风格库中的风格，其余所有部位严格保持与参考图一致，不得擅自改变参考图中的主体身份、构图、色调与材质（除选定替换部位外）。若参考图上有手绘标注（红色圆圈、箭头或文字说明），这些标注指明了用户想要替换的具体部位——请将标注区域作为重点替换目标。`;

      let swapPromptText = `${HOLLYWOOD_SKILL}\n\n${STYLE_SWAP_SKILL}\n\n本次任务：基于用户上传的参考图，进行风格库局部替换 + 角色概念设计增强。\n\n【第一步：风格库局部替换】用户从风格库中选定了以下${stylesArr.length}个风格模板，需要替换的部位：${partsList}。\n\n各部位替换聚焦：\n${focusPerStyle}\n\n用户选定的风格模板（必须逐项详细还原每个风格模板的全部视觉特征——材质/颜色/款式/纹理/工艺/搭配层次/装饰等，不得概括、简化或遗漏）：\n${stylesDescription}\n\n替换要求：\n1. 将每个选定部位分别替换为对应风格模板描述的风格特征，多个部位同时替换。\n2. 每个选定风格的全部视觉特征都必须在提示词中被详细、准确地还原到对应部位。\n3. 未选定的部位严格保持与参考图一致——只有用户选定的${partsList}需要替换。`;

      if (rawInput) {
        swapPromptText += `\n\n【第二步：根据用户补充描述进行增强】用户在选定风格的同时输入了以下文字描述，这是对整个画面的增强需求，必须与风格替换结合生成一条完整的角色概念设计提示词：\n用户描述：${rawInput}\n\n增强要求：\n1. 识别用户描述的意图——可能涉及：画面类型(全身/半身/特写)、画质风格(写实/电影质感)、主体动作/姿态/场景/构图/光影等额外要求。\n2. 将用户描述的意图与风格替换有机结合——在完成风格替换的基础上，根据用户描述对整个画面进行增强。\n3. 用户描述是对整体画面的增强指令，风格替换是对特定部位的替换指令，两者同时生效、互不替代。\n4. 最终输出一条融合了"风格替换 + 用户描述增强"的完整角色概念设计提示词。`;
      } else {
        swapPromptText += `\n\n【第二步：角色概念设计增强】无用户补充描述时，基于参考图主体 + 风格替换结果，按好莱坞角色设计方法论进行完整的概念设计增强。`;
      }

      swapPromptText += `${swapTargetInstruction}${swapImageInstruction}\n\n【输出要求】生成前，务必先执行完整的叙事驱动设计推演——\n第1步 语义锁定：提取参考图主体身份(脸型/五官/身材比例)为LOCKED不得修改，提取用户选定风格模板的特征为服装/发型/妆容的指定要求，提取用户补充描述的意图为额外增强要求；\n第2步 叙事核心：根据参考图主体与风格替换后的整体气质，判断人物身份/状态/观众第一眼读到什么；\n第3步 视觉命题：形成一句话内部视觉命题；\n第4步 从叙事推演视觉：从身份/世界观推导主导形状语言、轮廓、身体比例、面部特征(保持与参考图一致)、服装系统(使用风格库替换后的服装)、CMF材质矩阵(主色60%+辅色30%+强调色10%)、发型(使用风格库替换后的发型)、妆容(使用风格库替换后的妆容)、道具、标志性特征(1-3个)、审美矛盾；\n第5步 设计优先级：将所有设计信息分为S/A/B/C四级，最终Prompt主要使用S+A，少量B，删除C。\n给出尽量精准、具体、非通用的描述（严禁套话与笼统形容词），再据思考结果填充提示词。\n严格按四模块结构输出，只输出一条概念设计提示词（不拆分概念设计/电影剧照两套）。\nenhanced_prompt=角色概念设计/设计立绘(Concept Design Sheet/Turnaround)英文工业级工程提示词，按重要性排序(表现媒介→角色身份→叙事核心→主要视觉印象→身体比例→Silhouette→Shape Language→Iconic Features→Costume(使用风格库替换后的服装)→Colour System→Material→Props→Trace & Wear→Pose→Camera→Lighting→Background→Rendering Quality)，按模板[Subject+Core Shape Language], full body character concept design sheet, neutral A-pose, turnaround reference, cinematic production design, detailed CMF callouts, authentic [Materials & Textures], [Narrative Wear & Tear], clean solid color background (pure white/black/gray, no clutter/props/environment), even high-definition studio lighting, soft uniform key+fill light, minimal shadows, every body part razor-sharp and clearly visible, ultra-detailed skin texture and fabric details, 8k resolution, octane render, photorealistic concept art masterpiece --ar 16:9 --raw --v 8.2填充并替换占位符为实际内容；\nenhanced_prompt_zh=中文完整角色设计Prompt(可直接用于生图，不是分析报告)；\ncompact_prompt_en=精简版英文Prompt(保留角色身份/核心轮廓/Shape Language/标志性特征/Costume/CMF/展示形式，删除非必要解释)；\nnegative_prompt=英文负向提示(根据用户设定动态生成，参考avoid random accessories/avoid excessive armor/avoid meaningless cybernetic elements/avoid generic AI beauty face/avoid overdesign等，只在相关时使用)；\nsemantic_lock=语义锁定摘要(中文列出：参考图主体身份为LOCKED + 用户选定风格模板的替换要求 + 用户补充描述的增强意图，均不可修改)；\ndesign_thesis=角色视觉命题(中文一句话)；\niconic_features=1-3个标志性视觉特征(中文)；\ncolour_palette=色彩系统数组(每个颜色含name/hex/percentage/role，主色60-70%+辅助色20-30%+强调色≤10%)；\nanalysis=中文Markdown完整设计档案分析(模块一概念升华与设计档案+模块二多维视图资产拆解，须明确说明：哪些部位来自风格库替换、哪些部位保持参考图不变、用户描述如何驱动整体增强)，呈现从叙事到视觉的完整推演链路；\ntitle=简短中文标题(5-12字)；tags=3-5个中文标签。严格以JSON返回。`;

      if (paletteInstruction) swapPromptText += paletteInstruction;
      const swapArgs = { prompt: swapPromptText, response_json_schema: HOLLYWOOD_SCHEMA, file_urls: swapFileUrls };
      if (model) swapArgs.model = model;

      let swapResult = null;
      let swapErr = null;
      for (let attempt = 0; attempt < 2 && !swapResult; attempt++) {
        try {
          swapResult = await base44.asServiceRole.integrations.Core.InvokeLLM(swapArgs);
        } catch (e) { swapErr = e; }
      }
      if (!swapResult) throw swapErr || new Error('风格替换服务暂不可用，请稍后重试');

      return Response.json({
        title: swapResult.title,
        enhanced_prompt: applyColorPaletteToPrompt(enforceMjVersion(swapResult.enhanced_prompt), activePalette, paletteScope, 'en'),
        enhanced_prompt_zh: applyColorPaletteToPrompt(swapResult.enhanced_prompt_zh, activePalette, paletteScope, 'zh'),
        compact_prompt_en: enforceMjVersion(swapResult.compact_prompt_en || ''),
        negative_prompt: swapResult.negative_prompt || '',
        negative_prompt_zh: swapResult.negative_prompt_zh || '',
        semantic_lock: swapResult.semantic_lock || '',
        design_thesis: swapResult.design_thesis || '',
        iconic_features: Array.isArray(swapResult.iconic_features) ? swapResult.iconic_features : [],
        colour_palette: Array.isArray(swapResult.colour_palette) ? swapResult.colour_palette : [],
        analysis: swapResult.analysis || '',
        tags: swapResult.tags || [],
        cleaned_input: rawInput,
        category: '角色表演',
        direction: directionKey,
        mode: 'style_swap',
        style_categories: stylesArr.map((s) => s.category),
        style_names: stylesArr.map((s) => s.name)
      });
    }

    const useStructured = isCharacter || isScene;
    const activeSchema = isCharacter ? HOLLYWOOD_SCHEMA : (isScene ? SCENE_SCHEMA : SCHEMA);
    const promptText = isCharacter
      ? `${systemPrompt}${targetInstruction}${modifyInstruction}${imageInstruction}${examplesText}\n\n用户角色设定：${rawInput}\n\n要求：生成前，务必先执行完整的叙事驱动设计推演——\n第1步 语义锁定：提取用户已明确指定的所有信息(身份/性别/年龄/职业/世界设定/必须保留的特征/服装/颜色/材质/道具/风格/禁止元素)，标记为LOCKED，不得修改；\n第2步 叙事核心：判断这个人物是谁(主角/反派/配角等)、处于什么状态、观众第一眼应读到什么(1-3项)；\n第3步 视觉命题：形成一句话内部视觉命题；\n第4步 从叙事推演视觉：从身份/世界观推导主导形状语言、轮廓、身体比例、面部特征、服装系统、CMF材质矩阵(主色60%+辅色30%+强调色10%)、按场景判断磨损状态(仅当身份/经历/环境/叙事需要才加微观磨损，否则保持工整洁净崭新精致)、道具、标志性特征(1-3个)、审美矛盾；\n第5步 设计优先级：将所有设计信息分为S/A/B/C四级，最终Prompt主要使用S+A，少量B，删除C。\n给出尽量精准、具体、非通用的描述（严禁套话与笼统形容词），再据思考结果填充提示词。\n严格按四模块结构输出，但只输出一条概念设计提示词（不拆分概念设计/电影剧照两套）。\nenhanced_prompt=角色概念设计/设计立绘(Concept Design Sheet/Turnaround)英文工业级工程提示词，按重要性排序(表现媒介→角色身份→叙事核心→主要视觉印象→身体比例→Silhouette→Shape Language→Iconic Features→Costume→Colour System→Material→Props→Trace & Wear→Pose→Camera→Lighting→Background→Rendering Quality)，按模板[Subject+Core Shape Language], full body character concept design sheet, neutral A-pose, turnaround reference, cinematic production design, detailed CMF callouts, authentic [Materials & Textures], [Narrative Wear & Tear], clean solid color background (pure white/black/gray, no clutter/props/environment), even high-definition studio lighting, soft uniform key+fill light, minimal shadows, every body part razor-sharp and clearly visible, ultra-detailed skin texture and fabric details, 8k resolution, octane render, photorealistic concept art masterpiece --ar 16:9 --raw --v 8.2填充并替换占位符为实际内容；\nenhanced_prompt_zh=中文完整角色设计Prompt(可直接用于生图，不是分析报告)；\ncompact_prompt_en=精简版英文Prompt(保留角色身份/核心轮廓/Shape Language/标志性特征/Costume/CMF/展示形式，删除非必要解释)；\nnegative_prompt=英文负向提示(根据用户设定动态生成，参考avoid random accessories/avoid excessive armor/avoid meaningless cybernetic elements/avoid generic AI beauty face/avoid overdesign等，只在相关时使用)；\nsemantic_lock=语义锁定摘要(中文列出用户已明确指定的不可修改的信息)；\ndesign_thesis=角色视觉命题(中文一句话)；\niconic_features=1-3个标志性视觉特征(中文)；\ncolour_palette=色彩系统数组(每个颜色含name/hex/percentage/role，主色60-70%+辅助色20-30%+强调色≤10%)；\nanalysis=中文Markdown完整设计档案分析(模块一概念升华与设计档案+模块二多维视图资产拆解，呈现从叙事到视觉的完整推演链路)；\ntitle=简短中文标题(5-12字)；tags=3-5个中文标签。${isRealisticCharacter ? '本方向为真人写实，系统提示中已注入强制真人写实规范，enhanced_prompt必须完整融入该规范的全部写实要求(ARRI Alexa 65+Cooke复古电影镜头/35mm胶片颗粒Kodak Vision3 500T美学/16:9电影宽银幕强制/超写实可见毛孔皱纹自然瑕疵零修图零修图瑕疵真人质感皮肤更真实跟真人一样/自然光优先真实阴影环境光完全影响肤色/纯色暗调背景戏剧性高对比度电影光影完美勾勒人物身材轮廓/8k逼真写实杰作)，不可省略不可弱化。' : ''}严格以JSON返回。`
      : isScene
        ? `${systemPrompt}${targetInstruction}${modifyInstruction}${imageInstruction}${examplesText}\n\n用户场景构想：${rawInput}\n\n要求：严格按四模块结构输出。enhanced_prompt=概念设计全景空间(Environment Concept Design/Wide Shot)英文工业级影视美术提示词(含形状语言/光影光谱/材质痕迹熵增/文化互文/镜头规格ARRI Alexa LF/Panavision anamorphic/画幅/参数)；enhanced_prompt_zh=中文；cinematic_prompt=叙事微观特写/空间情绪切片英文工程提示词；cinematic_prompt_zh=中文；negative_prompt=英文负向提示；analysis=中文Markdown四模块完整分析(剧本意象解构/四维空间工程转译/工业级生图提示词/负向与渲染控制)；title=简短中文标题(5-12字)；tags=3-5个中文标签。严格以JSON返回。`
        : `${systemPrompt}${targetInstruction}${modifyInstruction}${imageInstruction}${examplesText}\n\n用户灵感：${rawInput}\n\n要求：1) enhanced_prompt 输出英文提示词，严格按目标引擎的语法惯例；2) enhanced_prompt_zh 输出对应的中文提示词（同样符合目标引擎惯例）；3) 简短中文标题(5-12字)；4) 3-5个中文标签。严格以JSON返回。`;

    const llmArgs = {
      prompt: promptText,
      response_json_schema: activeSchema
    };
    if (fileUrls) llmArgs.file_urls = fileUrls;
    if (model) llmArgs.model = model;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM(llmArgs);

    const responseData = {
      title: result.title,
      enhanced_prompt: applyColorPaletteToPrompt(enforceMjVersion(result.enhanced_prompt), activePalette, paletteScope, 'en'),
      enhanced_prompt_zh: applyColorPaletteToPrompt(result.enhanced_prompt_zh, activePalette, paletteScope, 'zh'),
      tags: result.tags || [],
      cleaned_input: rawInput,
      category,
      direction: directionKey
    };
    if (useStructured) {
      responseData.cinematic_prompt = enforceMjVersion(result.cinematic_prompt);
      responseData.cinematic_prompt_zh = result.cinematic_prompt_zh;
      responseData.negative_prompt = result.negative_prompt;
      responseData.negative_prompt_zh = result.negative_prompt_zh;
      responseData.analysis = result.analysis;
      // 角色方向：叙事驱动型结构化字段
      if (isCharacter) {
        responseData.compact_prompt_en = enforceMjVersion(result.compact_prompt_en || '');
        responseData.semantic_lock = result.semantic_lock || '';
        responseData.design_thesis = result.design_thesis || '';
        responseData.iconic_features = Array.isArray(result.iconic_features) ? result.iconic_features : [];
        responseData.colour_palette = Array.isArray(result.colour_palette) ? result.colour_palette : [];
      }
    }
    return Response.json(responseData);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
