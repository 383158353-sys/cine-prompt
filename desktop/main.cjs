const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PORT = 5173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let serverProcess;
let photoshopHelperProcess;
let mainWindow;
let tray;
let eventCursor = 0;
let stopping = false;

function appRoot() {
  return app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
}

function prepareLocalData() {
  const userData=app.getPath('userData');
  fs.mkdirSync(userData,{recursive:true});
  const legacyRoot=path.join(process.env.LOCALAPPDATA || '', 'CinePrompt','app');
  const legacyInstall=path.dirname(legacyRoot);
  const settings=path.join(userData,'.env.local');
  if(!fs.existsSync(settings) && fs.existsSync(path.join(legacyRoot,'.env.local')))fs.copyFileSync(path.join(legacyRoot,'.env.local'),settings);
  const data=path.join(userData,'local-data');
  if(!fs.existsSync(data) && fs.existsSync(path.join(legacyRoot,'local-data')))fs.cpSync(path.join(legacyRoot,'local-data'),data,{recursive:true});
  const legacyPidFile=path.join(legacyInstall,'cine-prompt.pid');
  if(fs.existsSync(legacyPidFile)){
    const pid=Number(fs.readFileSync(legacyPidFile,'utf8').trim());
    const expected=path.join(legacyRoot,'node.exe').replaceAll("'","''");
    if(Number.isInteger(pid) && pid>0)spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue;if($p -and $p.ExecutablePath -eq '${expected}'){Stop-Process -Id ${pid} -Force}`],{windowsHide:true});
  }
  const legacyStartup=path.join(process.env.APPDATA || '', 'Microsoft','Windows','Start Menu','Programs','Startup','CinePrompt Connector.cmd');
  if(fs.existsSync(legacyStartup))fs.unlinkSync(legacyStartup);
  if(app.isPackaged){
    const source=path.join(process.resourcesPath,'ps-plugin');
    const target=path.join(process.env.APPDATA || '', 'Adobe','UXP','Plugins','External','com.local.lk888.psedit');
    if(fs.existsSync(source)){fs.mkdirSync(target,{recursive:true});fs.cpSync(source,target,{recursive:true,force:true});}
    app.setLoginItemSettings({openAtLogin:true,path:process.execPath,args:['--hidden']});
  }
}

function startServer() {
  const root=appRoot();
  serverProcess=spawn(process.execPath,[path.join(root,'server','index.mjs')],{
    cwd:app.getPath('userData'),
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1',CINE_APP_ROOT:root,CINE_SETTINGS_FILE:path.join(app.getPath('userData'),'.env.local'),LOCAL_DATA_DIR:path.join(app.getPath('userData'),'local-data'),PORT:String(PORT)},
    windowsHide:true,
    stdio:'ignore'
  });
}

function startPhotoshopHelper() {
  if(!app.isPackaged)return;
  const helper=path.join(process.resourcesPath,'ps-companion','scripts','voice-server.cjs');
  if(!fs.existsSync(helper))return;
  photoshopHelperProcess=spawn(process.execPath,[helper],{cwd:path.dirname(helper),env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:'ignore'});
  photoshopHelperProcess.on('error',()=>{photoshopHelperProcess=null;});
}

async function waitForServer() {
  for(let attempt=0;attempt<80;attempt++){
    try{const response=await fetch(`${BASE_URL}/api/bridge/health`,{headers:{'X-Cine-Bridge':'1'}});if(response.ok)return;}
    catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('影词魔方服务启动超时');
}

function showWindow(url='/') {
  if(!mainWindow)return;
  if(url)mainWindow.loadURL(BASE_URL+url);
  mainWindow.show();mainWindow.restore();mainWindow.focus();
}

function createWindow() {
  mainWindow=new BrowserWindow({width:430,height:820,minWidth:360,minHeight:560,show:false,alwaysOnTop:true,autoHideMenuBar:true,title:'影词魔方',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false}});
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.on('close',event=>{if(!stopping){event.preventDefault();mainWindow.hide();}});
  mainWindow.webContents.setWindowOpenHandler(({url})=>{require('electron').shell.openExternal(url);return {action:'deny'};});
}

async function pollBridge() {
  if(stopping)return;
  try{
    const response=await fetch(`${BASE_URL}/api/bridge/activity?after=${eventCursor}`,{headers:{'X-Cine-Bridge':'1'}});
    const event=await response.json();
    if(event.sequence>eventCursor){eventCursor=event.sequence;if(event.sessionId && event.state==='waiting')showWindow(`/?bridge=${encodeURIComponent(event.sessionId)}`);}
  }catch{}
  setTimeout(pollBridge,500).unref?.();
}

function createTray() {
  const icon=nativeImage.createFromPath(path.join(appRoot(),'public','brand-icon.png'));
  tray=new Tray(icon.resize({width:20,height:20}));
  tray.setToolTip('影词魔方');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'打开影词魔方',click:()=>showWindow('/')},
    {type:'separator'},
    {label:'退出',click:()=>{stopping=true;app.quit();}}
  ]));
  tray.on('double-click',()=>showWindow('/'));
}

ipcMain.handle('cine:hide',()=>mainWindow.hide());

app.whenReady().then(async()=>{
  if(!app.requestSingleInstanceLock())return app.quit();
  prepareLocalData();
  startServer();startPhotoshopHelper();createWindow();createTray();
  try{await waitForServer();if(!process.argv.includes('--hidden'))showWindow('/');pollBridge();}catch(error){mainWindow.loadURL(`data:text/plain;charset=utf-8,${encodeURIComponent(error.message)}`);mainWindow.show();}
});
app.on('second-instance',()=>showWindow('/'));
app.on('window-all-closed',()=>{});
app.on('before-quit',()=>{stopping=true;serverProcess?.kill();photoshopHelperProcess?.kill();});

