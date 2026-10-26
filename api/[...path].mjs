process.env.CINE_PUBLIC_WEB = '1';
process.env.CINE_USE_PREBUILT = '1';
process.env.LOCAL_DATA_DIR = '/tmp/cine-prompt-data';
process.env.AI_API_KEY = '';
process.env.AI_IMAGE_MODEL = process.env.AI_IMAGE_MODEL || '';

const { handleRequest, ready } = await import('../server/index.mjs');

export const maxDuration = 300;
export const config = { api: { bodyParser: false }, maxDuration: 300 };

export default async function handler(req, res) {
  await ready;
  return handleRequest(req, res);
}
