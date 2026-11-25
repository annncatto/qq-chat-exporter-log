import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeLogZip } from '../src/qce/log-zip.mjs';

test('ZIP is readable by Python zipfile with UTF-8 names and unchanged image bytes', async t => {
  if (spawnSync('python3', ['--version']).error) return t.skip('Python zipfile is not available.');
  const picture = new Uint8Array([137,80,78,71,13,10,26,10,0,1,2,255]);
  const zip = await makeLogZip([{name:'跑团记录.txt',data:new Blob(['【KP】\n地图 [图片：images/0001.png]'])},{name:'images/0001.png',data:new Blob([picture])}]);
  const result = spawnSync('python3',['-c', 'import io,zipfile,sys,json,base64; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))'],{input:Buffer.from(await zip.arrayBuffer())});
  assert.equal(result.status,0,result.stderr.toString());
  const files = JSON.parse(result.stdout.toString());
  assert.equal(Buffer.from(files['跑团记录.txt'],'base64').toString(),'【KP】\n地图 [图片：images/0001.png]');
  assert.deepEqual(Buffer.from(files['images/0001.png'],'base64'),Buffer.from(picture));
});
test('ZIP refuses traversal, absolute names, duplicate names and ZIP64-size inputs', async () => {
  for (const name of ['../outside.png','images/../../outside.png','/outside.png','C:/outside.png','images\\outside.png','a\0.txt','a//b'])
    await assert.rejects(()=>makeLogZip([{name,data:new Blob(['x'])}]),/文件名/);
  await assert.rejects(()=>makeLogZip([{name:'a',data:new Blob([])},{name:'a',data:new Blob([])}]),/重复/);
  await assert.rejects(()=>makeLogZip([{name:'a',data:{size:0x100000000}}]),/ZIP32/);
});
