import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve('.');

test('Windows connector bundle has install, launch and uninstall entrypoints', () => {
  for (const file of [
    'installer/windows/安装.cmd',
    'installer/windows/卸载.cmd',
    'installer/windows/installer/install.ps1',
    'installer/windows/installer/start-cine-prompt.ps1',
    'installer/windows/installer/uninstall.ps1',
  ]) assert.ok(fs.statSync(path.join(root, file)).isFile(), `${file} is missing`);
});

test('PowerShell installer sources stay ASCII for Windows PowerShell 5.1', () => {
  const files = [
    'scripts/build-windows-bundle.ps1',
    'installer/windows/installer/install.ps1',
    'installer/windows/installer/start-cine-prompt.ps1',
    'installer/windows/installer/uninstall.ps1',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /[^\x00-\x7f]/, `${file} must stay ASCII`);
  }
});

test('Photoshop download page targets the stable GitHub release asset', () => {
  const source = fs.readFileSync(path.join(root, 'src/pages/InstallPhotoshop.jsx'), 'utf8');
  assert.match(source, /releases\/latest\/download\/CinePrompt-Photoshop-Windows\.zip/);
  assert.match(source, /不需要管理员权限，也不需要另装 Node\.js/);
});
