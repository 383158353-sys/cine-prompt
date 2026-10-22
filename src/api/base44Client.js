import { compressImage } from '../lib/compressImage';
function resolveAutoModel(data) { return data; }
// Compatibility facade: the existing UI now calls only the local server.
async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch {
    data = {error: response.status === 413
      ? `上传/部署入口返回 HTTP 413（${url}）；未收到应用 JSON 响应，请检查代理或部署层体积限制`
      : `服务返回非 JSON 响应（HTTP ${response.status}）`};
  }
  if (!response.ok || data?.error) {
    const error = Object.assign(new Error(data.error || '服务请求失败'), {response:{data,status:response.status}});
    throw error;
  }
  return data;
}
const rpc = data => request('/api/local/rpc', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const goHome = () => window.location.assign('/');
/** @returns {Promise<{access_token?: string}>} */
const localOnly = async (..._args) => {throw new Error('本地版无需注册、密码或第三方登录，请直接打开首页');};
export const base44 = {
  entities:Object.fromEntries(['Prompt','Direction','StyleLibrary','ColorPalette'].map(name => [name,Object.fromEntries(['list','filter','get','create','bulkCreate','update','delete'].map(action=>[action,(...args)=>rpc({kind:'entity',name,action,args})]))])),
  functions:{invoke:async(name,data)=>({data:await rpc({kind:'function',name,data:resolveAutoModel(data)})})},
  integrations:{Core:{UploadFile:async({file})=>{const form=new FormData();form.append('file',await compressImage(file));return request('/api/local/upload',{method:'POST',body:form});}}},
  auth:{me:()=>request('/api/local/user'),isAuthenticated:async()=>true,logout:goHome,redirectToLogin:goHome,loginViaEmailPassword:localOnly,loginWithProvider:localOnly,register:localOnly,verifyOtp:localOnly,resendOtp:localOnly,resetPasswordRequest:localOnly,resetPassword:localOnly,setToken:(..._args)=>{}}
};
