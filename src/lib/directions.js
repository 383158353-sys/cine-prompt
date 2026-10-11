// 优化方向知识库与前端常量（角色 / 环境 / 视频三大组）
// 模型/目标用文字简写表示，按钮更紧凑

// 增强模式下的子分类（角色 / 环境 / 视角 / 镜头）
export const GROUPS = [
  { key: 'character', label: '角色' },
  { key: 'scene', label: '环境' },
  { key: 'viewpoint', label: '视角' },
  { key: 'repair', label: '逻辑修复' },
  { key: 'video', label: '镜头' }
];

// 反推模式下的子分类（仅图像：角色 / 环境 / 视角）
export const IMAGE_GROUPS = [
  { key: 'character', label: '角色' },
  { key: 'scene', label: '环境' },
  { key: 'viewpoint', label: '视角' }
];

// 视频目标模型（镜头模式专用）
export const VIDEO_TARGETS = [
  { key: 'auto', label: '自动', short: '自动' },
  { key: 'veo', label: 'Veo', short: 'Veo' },
  { key: 'runway', label: 'Runway', short: 'Runway' },
  { key: 'kling', label: 'Kling', short: 'Kling' },
  { key: 'seedance', label: 'Seedance', short: 'Seed' },
  { key: 'sora', label: 'Sora', short: 'Sora' },
  { key: 'hailuo', label: '海螺', short: '海螺' }
];

export const STYLES = {
  character: [
    { key: 'character_default', label: '默认' },
    { key: 'character_realistic', label: '真人写实' },
    { key: 'character_cinematic', label: '电影人像' },
    { key: 'character_fashion', label: '时尚大片' },
    { key: 'character_japanese', label: '日系清新' },
    { key: 'character_anime_niji', label: '二次元Niji' },
    { key: 'character_anime_shinkai', label: '新海诚风' },
    { key: 'character_cg', label: '3D/CG角色' },
    { key: 'character_chibi', label: 'Q版萌系' },
    { key: 'character_concept', label: '概念设定' }
  ],
  scene: [
    { key: 'scene_default', label: '默认' },
    { key: 'scene_outdoor_nature', label: '自然风光' },
    { key: 'scene_outdoor_urban', label: '城市街景' },
    { key: 'scene_outdoor_ancient', label: '古风山水' },
    { key: 'scene_outdoor_scifi', label: '科幻废墟' },
    { key: 'scene_indoor_modern', label: '现代室内' },
    { key: 'scene_indoor_classical', label: '古典中式' },
    { key: 'scene_indoor_cyberpunk', label: '赛博室内' },
    { key: 'scene_indoor_industrial', label: '工业风' }
  ],
  video: [
    { key: 'video_cinematic_shot', label: '电影运镜' },
    { key: 'video_action', label: '动作镜头' },
    { key: 'video_aerial', label: '航拍大场面' },
    { key: 'video_portrait_motion', label: '人物动态' }
  ]
};

export const MODELS = [
  { key: 'automatic', label: '自动', short: '自动' },
  { key: 'gemini_3_flash', label: 'Gemini', short: 'Gem' },
  { key: 'gpt_5_mini', label: 'GPT', short: 'GPT' },
  { key: 'claude_sonnet_4_6', label: 'Claude', short: 'Claude' }
];

export const TARGETS = [
  { key: 'imagine2', label: 'Imagine 2', type: 'image', short: 'IMG2' },
  { key: 'banana2', label: 'Banana 2', type: 'image', short: 'BN2' },
  { key: 'jimeng_image', label: '即梦·生图', type: 'image', short: '即梦图' },
  { key: 'jimeng_video', label: '即梦·生视频', type: 'video', short: '即梦视' },
  { key: 'generic_image', label: '通用·生图', type: 'image', short: '通图' },
  { key: 'generic_video', label: '通用·生视频', type: 'video', short: '通视' },
  { key: 'midjourney', label: 'Midjourney', type: 'image', short: 'MJ' }
];

export const PLACEHOLDERS = {
  character: '例如：一位三十岁亚洲女性，短发，微笑…',
  scene: '例如：雨后赛博朋克城市的霓虹街道…',
  video: '例如：镜头跟随人物穿过拥挤的夜市…',
  repair: '可选：补充说明需要重点检查的区域或已知问题…'
};

export const GROUP_CATEGORY = {
  character: '角色表演',
  scene: '场景构图',
  video: '镜头运镜',
  repair: '场景构图'
};