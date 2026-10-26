import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = ['enhancePrompt', 'analyzeStyleImage', 'analyzeColorPalette', 'generateStyleThumbnails', 'parseStoryboard'];

export function relocateFunction(code) {
  return code
    .replaceAll("from './local-client.mjs'", "from '../local-client.mjs'")
    .replaceAll("from './spreadsheet.mjs'", "from '../spreadsheet.mjs'")
    .replaceAll("from '../shared/", "from '../../shared/");
}

export async function compileFunctions() {
  const outputDir = path.join(root, 'server', 'runtime');
  await fs.mkdir(outputDir, { recursive: true });
  for (const name of names) {
    const source = await fs.readFile(path.join(root, 'server', 'functions', `${name}.ts`), 'utf8');
    const compiled = (await transform(source, { loader: 'ts', format: 'esm', target: 'node22' })).code;
    await fs.writeFile(path.join(outputDir, `${name}.mjs`), relocateFunction(compiled));
  }
  return outputDir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputDir = await compileFunctions();
  console.log(`compiled functions → ${outputDir}`);
}
