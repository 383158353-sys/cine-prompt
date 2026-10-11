import { InvokeLLM } from './ai.mjs';
try {
  const result = await InvokeLLM({prompt:'Return {"ok":true}.',response_json_schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok']}});
  if(result.ok!==true) throw new Error('模型没有返回预期结果');
  console.log('文本与结构化 JSON 兼容性检查通过');
  if (process.argv.includes('--vision')) {
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPhkAAAAASUVORK5CYII=';
    await InvokeLLM({prompt:'Briefly describe this test image.',file_urls:[pixel]});
    console.log('图片输入接口兼容性检查通过（测试图片）');
  }
} catch(error) {console.error(error.message);process.exitCode=1;}
