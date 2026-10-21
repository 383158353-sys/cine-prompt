// Prefer provider capabilities; names provide a fallback for OpenAI-style ID-only catalogs.
export function isChatModel(item) {
  const data = typeof item === 'string' ? { id: item } : item || {};
  const id = String(data.id || data.name || '').replace(/^models\//, '');
  if (!id) return false;
  const nonChat = /(?:banana|imagen|seedream|seedance|midjourney|dall[-_]?e|stable[-_]?diffusion|flux|recraft|ideogram|kolors|wanx|hunyuan[-_]?(?:image|video)|(?:^|[-_])(?:image|images|video|audio|tts|stt|asr|whisper|embedding|embed|rerank(?:er)?|moderation|sora|veo|kling|suno|luma|jimeng)(?:$|[-_.\d])|(?:^|[-_])(?:gpt[-_]image|qwen[-_]image|z[-_]image|tt[-_]image)|(?:^|[-_])(?:realtime|transcribe|transcription|music)(?:$|[-_.]))/i;
  if (nonChat.test(id)) return false;
  if (Array.isArray(data.supportedGenerationMethods)) return data.supportedGenerationMethods.includes('generateContent');
  const endpoints = data.supported_endpoint_types || data.supported_endpoints || data.endpoints;
  if (Array.isArray(endpoints) && endpoints.length) {
    return endpoints.some(value => /chat|completions|messages|responses|generateContent/i.test(String(typeof value === 'object' ? value.type || value.path || '' : value)));
  }
  const output = data.output_modalities || data.outputModalities || data.modalities?.output;
  if (Array.isArray(output) && output.length) return output.some(value => /^(text|chat)$/i.test(value));
  const type = data.type || data.model_type || data.category;
  if (type && /^(image|video|audio|embedding|rerank(?:er)?|moderation|tts|asr)$/i.test(type)) return false;
  if (type && /^(chat|text|llm|language|vision|multimodal)$/i.test(type)) return true;
  // ID-only catalogs have no universal capability field. Keep recognizable chat families;
  // unrecognized custom IDs remain available through manual entry, rather than guessing.
  // LK888/LingkeAI 平台别名：tt-=GPT、gem-=Gemini、op-/sn-/hk-=Claude Opus/Sonnet/Haiku、gk-=Grok（图像/视频/tts 已在上面排除）
  if (/^(?:tt|gem|op|sn|hk|gk)-\d|^gk-build|^mimo-v\d|^(?:stepfun\/)?step-\d|^doubao-seed-(?:evolving|character)/i.test(id)) return true;
  return /^(?:[a-z0-9]+\/)?(?:chat[-_]|gemini[-_]|gemma[-_]|gpt[-_]|chatgpt[-_]|o[134](?:$|[-_])|claude[-_]|deepseek[-_]|qwen|qwq|qvq|glm[-_\d]|chatglm|minimax[-_](?:m|h)\d|kimi|moonshot|grok[-_]|llama|meta[-_]llama|mistral|mixtral|codestral|magistral|pixtral|command[-_]|ernie|hunyuan[-_](?:turbo|large|standard|pro|lite)|internlm|yi[-_]|jamba|nova[-_]|step[-_\d]|doubao[-_](?:seed[-_](?:\d|chat)|pro|lite|vision))/i.test(id);
}

export function chatModelIds(source) {
  return [...new Set(source.filter(isChatModel).map(item => typeof item === 'string' ? item : item.id || item.name).map(name => name.replace(/^models\//, '')))].sort();
}
