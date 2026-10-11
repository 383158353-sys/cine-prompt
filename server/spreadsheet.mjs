import fs from 'node:fs/promises';
import readXlsxFile from 'read-excel-file/node';
import { uploadPath } from './ai.mjs';
export function parseCSV(text) {
  const delimiter = text.split(/\r?\n/,1)[0].includes('\t') ? '\t' : ',';
  const rows=[]; let row=[], field='', quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') {if(quoted && text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===delimiter && !quoted){row.push(field);field='';}
    else if((c==='\n' || c==='\r') && !quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted) throw new Error('CSV 引号未闭合');
  if(field || row.length){row.push(field);rows.push(row);}
  return rows;
}
export async function parseStoryboard(req) {
  try {
    const {file_url}=await req.json();
    const file=uploadPath(file_url || '');
    const values=file.endsWith('.xlsx') ? await readXlsxFile(file) : parseCSV((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
    const headers=(values[0] || []).map(v=>String(v ?? ''));
    const rows=values.slice(1).filter(row=>row.some(v=>v!==''&&v!=null)).map(row=>Object.fromEntries(headers.map((h,i)=>[h,String(row[i] ?? '')])));
    if(!rows.length) return Response.json({error:'未检测到数据行'},{status:400});
    return Response.json({headers,rows});
  } catch {return Response.json({error:'分镜表格解析失败，请上传 CSV 或 XLSX 文件'},{status:400});}
}
