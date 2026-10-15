import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatModelIds, isChatModel } from '../server/chat-models.mjs';

test('chat settings exclude generation, speech, embedding and ranking models', () => {
  const chat = ['deepseek-v4-flash-vision-exp', 'gpt-4o', 'gemini-3.1-flash-lite', 'claude-sonnet-4', 'doubao-seed-2-0-pro-260215', 'qwen3-vl-plus', 'MiniMax-M3'];
  const other = ['banana-2.1-token', 'banana-pro', 'doubao-seedream-4-5', 'doubao-seedance-2-5', 'gpt-image-1', 'qwen-image-max', 'tt-image-2.5', 'imagen-4', 'veo-3', 'sora-2', 'flux.1', 'text-embedding-3-small', 'bge-reranker-v2', 'whisper-1', 'gpt-4o-mini-tts', 'gpt-4o-realtime-preview'];
  assert.deepEqual(chatModelIds([...chat, ...other, chat[0]]), [...chat].sort());
});

test('provider capabilities distinguish chat from non-chat for custom model IDs', () => {
  assert.equal(isChatModel({ id: 'custom-a', supported_endpoint_types: ['chat/completions'] }), true);
  assert.equal(isChatModel({ id: 'custom-b', supported_endpoint_types: ['images/generations'] }), false);
  assert.equal(isChatModel({ name: 'models/custom-c', supportedGenerationMethods: ['embedContent'] }), false);
  assert.equal(isChatModel({ name: 'models/custom-d', supportedGenerationMethods: ['generateContent'] }), true);
  assert.equal(isChatModel({ id: 'custom-e', output_modalities: ['image'] }), false);
  assert.equal(isChatModel({ id: 'custom-f', category: 'audio' }), false);
  assert.equal(isChatModel(null), false);
  assert.equal(isChatModel('unknown-generation-model'), false);
  assert.equal(isChatModel({ id: 'custom-chat', category: 'chat' }), true);
  assert.deepEqual(chatModelIds(['models/gemini-chat', { id: 'gemini-chat' }]), ['gemini-chat']);
});
