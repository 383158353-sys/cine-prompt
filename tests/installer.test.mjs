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

test('desktop installer bundles the PS plugin and keeps local data on uninstall', () => {
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.main,'desktop/main.cjs');
  assert.match(pkg.scripts['package:windows'],/build-desktop-installer\.ps1/);
  assert.equal(pkg.build.win.artifactName,'CinePrompt-Photoshop-Windows.exe');
  assert.equal(pkg.build.nsis.oneClick,true);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall,false);
  assert.ok(pkg.build.extraResources.some(item=>item.to==='ps-plugin'));
  const main=fs.readFileSync(path.join(root,'desktop/main.cjs'),'utf8');
  assert.match(main,/setAlwaysOnTop/);
  assert.match(main,/bridge\/activity/);
  assert.match(main,/UXP.*Plugins.*External/s);
});

test('PowerShell installer sources stay ASCII for Windows PowerShell 5.1', () => {
  const files = [
    'scripts/build-windows-bundle.ps1',
    'scripts/build-desktop-installer.ps1',
    'installer/windows/installer/install.ps1',
    'installer/windows/installer/start-cine-prompt.ps1',
    'installer/windows/installer/uninstall.ps1',
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /[^\x00-\x7f]/, `${file} must stay ASCII`);
  }
});

test('Photoshop download page targets the stable one-click desktop installer', () => {
  const source = fs.readFileSync(path.join(root, 'src/pages/InstallPhotoshop.jsx'), 'utf8');
  assert.match(source, /releases\/latest\/download\/CinePrompt-Photoshop-Windows\.exe/);
  assert.match(source, /不需要管理员权限，也不需要另装 Node\.js/);
});
