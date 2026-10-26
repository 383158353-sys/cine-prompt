process.env.CINE_PUBLIC_WEB = '1';
process.env.CINE_USE_PREBUILT = '1';
process.env.LOCAL_DATA_DIR = '/tmp/cine-prompt-data';
process.env.AI_API_KEY = '';
process.env.AI_IMAGE_MODEL = process.env.AI_IMAGE_MODEL || '';

import { restoreApiUrl } from '../shared/request-url.mjs';
let handleRequest;
let ready = Promise.resolve();
let bootError;
try {
  ({ handleRequest, ready } = await import('../server/index.mjs'));
} catch (error) {
  bootError = error;
}

export const maxDuration = 300;
export const config = { api: { bodyParser: false }, maxDuration: 300 };

function restoreRequestUrl(req) {
  req.url = restoreApiUrl(req.url);
}

export default async function handler(req, res) {
  try {
    if (bootError) throw bootError;
    await ready;
    restoreRequestUrl(req);
    return await handleRequest(req, res);
  } catch (error) {
    if (res.headersSent || res.writableEnded) throw error;
    const message = error?.message || '服务暂时不可用';
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: message }));
  }
}
