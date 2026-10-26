import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginSource = process.env.PS_PLUGIN_SOURCE || '/tmp/ps-local-edit/plugin';
const stage = path.join(root, 'desktop', 'package');

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
  if (result.status !== 0) process.exit(result.status || 1);
}

const manifestPath = path.join(pluginSource, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`Photoshop plugin source was not found: ${pluginSource}`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
console.log(`staging Photoshop plugin ${manifest.version} from ${pluginSource}`);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'ps-plugin'), { recursive: true });
fs.cpSync(pluginSource, path.join(stage, 'ps-plugin'), { recursive: true });
const scripts = path.join(path.dirname(pluginSource), 'scripts');
const companion = path.join(stage, 'ps-companion', 'scripts');
fs.mkdirSync(companion, { recursive: true });
for (const name of fs.readdirSync(scripts)) {
  if (name.endsWith('.ps1') || name === 'voice-server.cjs') fs.copyFileSync(path.join(scripts, name), path.join(companion, name));
}
run(process.execPath, ['scripts/compile-functions.mjs']);
run('npx', ['vite', 'build'], { VITE_PUBLIC_WEB: '' });
const sharpPackages = [
  ['@img/sharp-win32-x64', '0.35.4'],
  ['@img/sharp-darwin-arm64', '0.35.4'],
  ['@img/sharp-darwin-x64', '0.35.4'],
  ['@img/sharp-libvips-darwin-arm64', '1.3.3'],
  ['@img/sharp-libvips-darwin-x64', '1.3.3']
];
const cache = path.join(root, '.sharp-pack');
fs.rmSync(cache, { recursive: true, force: true });
fs.mkdirSync(cache, { recursive: true });
for (const [name, version] of sharpPackages) {
  run('npm', ['pack', `${name}@${version}`, '--pack-destination', cache]);
  const archive = fs.readdirSync(cache).find(file => file.endsWith('.tgz'));
  const destination = path.join(root, 'node_modules', ...name.split('/'));
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  run('tar', ['-xzf', path.join(cache, archive), '-C', destination, '--strip-components=1']);
  fs.rmSync(path.join(cache, archive));
}
fs.rmSync(cache, { recursive: true, force: true });
const builderEnv = { CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
run('npx', ['electron-builder', '--win', 'nsis', '--x64'], builderEnv);
run('npx', ['electron-builder', '--mac', 'zip', '--arm64', '--x64'], builderEnv);
fs.rmSync(stage, { recursive: true, force: true });
console.log('desktop packages are in release-desktop/');
