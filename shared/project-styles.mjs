export const PROJECT_STYLES = [
  {
    id: 'builtin-realistic', name: '真人写实', base_style: 'realistic',
    system_prompt: '真实摄影质感，自然可信的光影、色彩和材质，遵循用户指定的内容与构图。',
    character_prompt: '人物采用真人摄影表现：真实皮肤纹理、自然五官、可信的服装与发丝细节，避免塑料皮肤和卡通化。',
    scene_prompt: '场景采用实景摄影表现：真实空间尺度、建筑结构、材质纹理和自然光照，避免卡通化。没有人物时不得添加人物。'
  },
  {
    id: 'builtin-concept', name: '概念设定', base_style: 'concept',
    system_prompt: '采用影视概念设定方法，突出清晰的设计意图、统一的视觉语言与可实现的细节；具体画风服从用户要求。',
    character_prompt: '针对人物身份、轮廓、服装、配饰、材质和气质进行概念设定，保持指定人物身份与已有设计的一致性。',
    scene_prompt: '针对空间布局、建筑、道具、材质、色彩和氛围进行场景概念设定，保持指定结构与空间关系。没有人物时不得添加人物。'
  }
];

export function projectStylePayload(style) {
  if (!style) return undefined;
  return {
    name: String(style.name || '').slice(0, 120),
    system_prompt: String(style.system_prompt || '').slice(0, 6000),
    character_prompt: String(style.character_prompt || '').slice(0, 6000),
    scene_prompt: String(style.scene_prompt || '').slice(0, 6000),
    base_style: ['realistic', 'concept'].includes(style.base_style) ? style.base_style : ''
  };
}

export function buildProjectStyleInstruction(style, task = {}) {
  const value = projectStylePayload(style);
  if (!value) return '';
  const subject = task.mode === 'repair' ? 'auto' : task.subject || task.group || (String(task.direction || '').startsWith('scene_') ? 'scene' : String(task.direction || '').startsWith('character_') ? 'character' : 'auto');
  const character = subject === 'character';
  const scene = subject === 'scene' || subject === 'environment';
  const base = PROJECT_STYLES.find((item) => item.base_style === value.base_style);
  const parts = [
    '\n\n【项目风格（所有栏目共享，按当前主体应用）】',
    `项目风格：${value.name || '未命名'}`,
    '先结合当前任务、用户文字、参考图和标注识别真正需要处理的主体。通用描述中的人物要求与场景要求必须分别理解，只应用与当前主体有关的部分；人物与场景同时存在时分别应用，禁止串用。用户明确要求优先。',
    value.system_prompt && `项目通用要求：${value.system_prompt}`,
    base && `基础风格：${base.system_prompt}`,
    !scene && base && `基础人物表现：${base.character_prompt}`,
    !character && base && `基础场景表现：${base.scene_prompt}`,
    !scene && value.character_prompt && `人物专属要求：${value.character_prompt}`,
    !character && value.scene_prompt && `场景专属要求：${value.scene_prompt}`,
    character ? '当前主体：人物。只应用人物与通用要求，背景保持原有内容，除非用户明确要求修改。' : scene ? '当前主体：场景。只应用场景与通用要求，不得把肤色、五官、服装等人物要求套用于建筑、道具或环境。' : '当前主体：根据图片、用户要求和标注自动识别人物、场景、道具或混合主体，只取对应要求。',
    task.mode === 'repair' && '当前是逻辑修复：项目风格只作用于用户指定的局部，其余区域保持原图。不得因选择项目风格而重做全图。',
    '在视角和镜头任务中保持人物身份、场景结构及项目风格连续性，不得新增用户未要求的主体。'
  ];
  return parts.filter(Boolean).join('\n');
}
