import { test, expect, type Page, type Download } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

test.use({ video: 'off', colorScheme: 'light' });
const red = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const blue = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC';

type SourceRow = { text: string; image?: string; name?: string };
async function viewerFile(dir: string, name: string, source: SourceRow[]) {
  await mkdir(dir, { recursive: true });
  const records = source.map((row, i) => ({ id: `msg-${i}`, ts: 1795089600000 + i * 1000, date: '2026-11-19', uid: `u_${i % 2 + 1}`, uin: String(10001 + i % 2),
    name: row.name || (i % 2 ? '调查员' : 'KP'), nameLower: 'kp', text: row.text.toLowerCase(), logText: row.text,
    html: `<div class="message-block"><div class="message other"><div class="avatar">头像</div><div class="message-wrapper"><div class="message-header"><span class="sender">${row.name || (i % 2 ? '调查员' : 'KP')}</span></div><div class="message-bubble"><div class="content">${row.text}${row.image ? `<div class="image-content"><img src="${row.image}" alt="地图.png"></div>` : ''}</div></div></div></div></div>`,
  }));
  const manifest = { format: 'qce-modern-html-chunked', version: 1, exportTime: '2026-11-26T12:00:00+09:00', chat: { name, type: 'group' },
    stats: { totalMessages: records.length, minDateKey: '2026-11-19', maxDateKey: '2026-11-19' }, chunking: { maxMessagesPerChunk: 500 },
    bloom: { textBits: 0, textHashes: 0, senderBits: 0, senderHashes: 0 }, senders: [{ uid: 'u_1', displayName: 'KP', count: 2 }, { uid: 'u_2', displayName: '调查员', count: 1 }],
    chunks: [{ id: '0', file: 'data/0.js', count: records.length, bytes: 1000, startTs: records[0]!.ts, endTs: records.at(-1)!.ts, startDate: '2026-11-19', endDate: '2026-11-19', firstMsgId: 'msg-0', lastMsgId: records.at(-1)!.id, textBloom: '', senderBloom: '' }],
  };
  const js = (await readFile(join(__dirname, '../../qce-chunked-viewer/assets/modern_chunked_app.js'), 'utf8')).replace(/<\/script/gi, '<\\/script');
  const bootstrap = 'window.__QCE_INLINE__={chunks:{},msgid:{}};window.__QCE_MANIFEST__=m=>window.__QCE_INLINE__.manifest=m;window.__QCE_CHUNK__=c=>window.__QCE_INLINE__.chunks[c.id]=c.messages;';
  const path = join(dir, 'index.html');
  await writeFile(path, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>${bootstrap}</script><script>window.__QCE_MANIFEST__(${JSON.stringify(manifest)})</script><script>window.__QCE_CHUNK__(${JSON.stringify({ id: '0', messages: records })})</script><script>${js}</script>`);
  return path;
}
async function open(page: Page, path: string) {
  await page.route('https://**', route => route.abort());
  await page.goto(pathToFileURL(path).href);
  await expect(page.locator('#viewport [data-i="0"]')).toBeVisible();
}
async function keep(page: Page, n: number) {
  for (let i = 0; i < n; i++) await page.getByRole('button', { name: /^保留/ }).click();
}
async function draft(page: Page) {
  await page.getByRole('button', { name: '完整成稿', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '完整成稿' });
  await expect(panel).toBeVisible();
  return panel;
}
async function zipContents(download: Download): Promise<Record<string, string>> {
  const result = spawnSync('python3', ['-c', 'import io,zipfile,sys,json,base64; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))'], { input: await readFile((await download.path())!) });
  expect(result.status, result.stderr.toString()).toBe(0);
  return JSON.parse(result.stdout.toString());
}

test('text templates preserve sentences and SealDice native JSON keeps accounts and multiline messages', async ({ page }, info) => {
  const dir = await mkdtemp(join(tmpdir(), 'qce-log-template-'));
  try {
    await open(page, await viewerFile(dir, '模板记录', [{ text: '门前【线索】\n第二行' }, { text: '休息 20:00:00\n<引用>: 保留原样', name: '调查员(侦探)' }, { text: '不要导出的内容' }]));
    await keep(page, 2); await page.getByRole('button', { name: /^排除/ }).click();
    const panel = await draft(page);
    await panel.getByRole('combobox', { name: '导出模板' }).selectOption('langdu');
    const spoken = page.waitForEvent('download'); await panel.getByRole('button', { name: 'TXT', exact: true }).click();
    const spokenFile = await spoken;
    expect(spokenFile.suggestedFilename()).toMatch(/\.txt$/);
    const text = await readFile((await spokenFile.path())!, 'utf8');
    expect(text).toContain('[KP]\n门前【线索】\n第二行'); expect(text).not.toContain('不要导出的内容');
    await panel.getByRole('combobox', { name: '导出模板' }).selectOption('sealdice');
    const native = page.waitForEvent('download'); await panel.getByRole('button', { name: 'JSON', exact: true }).click();
    const nativeFile = await native; await nativeFile.saveAs(info.outputPath('sealdice.json'));
    const seal = JSON.parse(await readFile((await nativeFile.path())!, 'utf8'));
    expect(seal.version).toBe(1); expect(seal.items).toHaveLength(2);
    expect(seal.items.map((item: { IMUserId: string }) => item.IMUserId)).toEqual(['QQ:10001', 'QQ:10002']);
    expect(seal.items[1].nickname).toBe('调查员(侦探)'); expect(seal.items[1].message).toBe('休息 20:00:00\n<引用>: 保留原样');
    const compatible = page.waitForEvent('download'); await panel.getByRole('button', { name: 'TXT', exact: true }).click();
    await (await compatible).saveAs(info.outputPath('sealdice.txt'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('TXT bundles only retained pictures and SealDice JSON embeds reusable image data', async ({ page }, info) => {
  const dir = await mkdtemp(join(tmpdir(), 'qce-log-images-'));
  try {
    const png = `data:image/png;base64,${red}`;
    await open(page, await viewerFile(dir, '图片记录', [{ text: '看地图[图片:地图.png]', image: png }, { text: '仍是这张图[图片:地图.png]', image: png }, { text: '不保留的蓝图[图片:地图.png]', image: `data:image/png;base64,${blue}` }]));
    await keep(page, 2); await page.getByRole('button', { name: /^排除/ }).click();
    const panel = await draft(page);
    await expect(panel.getByRole('checkbox', { name: 'TXT/JSON 附带图片' })).toBeChecked();
    const zipped = page.waitForEvent('download'); await panel.getByRole('button', { name: 'TXT', exact: true }).click();
    const file = await zipped; expect(file.suggestedFilename()).toMatch(/\.zip$/);
    const zip = await zipContents(file); expect(Object.keys(zip)).toEqual(['图片记录.txt', 'images/0001.png']);
    expect(zip['images/0001.png']).toBe(red);
    const text = Buffer.from(zip['图片记录.txt']!, 'base64').toString();
    expect(text.match(/\[图片：images\/0001\.png\]/g)).toHaveLength(2); expect(text).not.toContain('不保留的蓝图');
    await expect(panel.locator('.qce-log-draft-text')).toContainText('看地图[图片:地图.png]');
    await panel.getByRole('combobox', { name: '导出模板' }).selectOption('sealdice');
    const native = page.waitForEvent('download'); await panel.getByRole('button', { name: 'JSON', exact: true }).click();
    const nativeFile = await native; await nativeFile.saveAs(info.outputPath('sealdice-media.json'));
    const contents = JSON.parse(await readFile((await nativeFile.path())!, 'utf8'));
    expect(contents.items).toHaveLength(2);
    expect(contents.items[0].message).toContain(`[CQ:image,file=images/0001.png,url=data:image/png;base64,${red}]`);
    const combined = page.waitForEvent('download'); await panel.getByRole('button', { name: 'TXT', exact: true }).click();
    const sealZip = await zipContents(await combined);
    await writeFile(info.outputPath('sealdice-media.txt'), Buffer.from(sealZip['图片记录.txt']!, 'base64'));
    expect(sealZip['images/0001.png']).toBe(red);
    await panel.getByRole('checkbox', { name: 'TXT/JSON 附带图片' }).uncheck();
    const plain = page.waitForEvent('download'); await panel.getByRole('button', { name: 'TXT', exact: true }).click();
    expect((await plain).suggestedFilename()).toMatch(/\.txt$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('local HTML pictures can be supplied once from the export folder and are never silently omitted', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'qce-log-local-'));
  try {
    await mkdir(join(dir, 'resources/images'), { recursive: true }); await writeFile(join(dir, 'resources/images/地图.png'), Buffer.from(blue, 'base64'));
    await open(page, await viewerFile(dir, '本地记录', [{ text: '本地地图[图片:地图.png]', image: './resources/images/地图.png' }])); await keep(page, 1);
    const panel = await draft(page); let count = 0; page.on('download', () => count++);
    await panel.getByRole('button', { name: 'TXT', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('1 张图片尚未读取'); expect(count).toBe(0);
    const complete = page.waitForEvent('download');
    await panel.locator('input[aria-label="选择图片文件夹"]').setInputFiles(dir);
    expect((await zipContents(await complete))['images/0001.png']).toBe(blue);
    await panel.getByRole('button', { name: '返回', exact: true }).click();
    const again = await draft(page); const repeated = page.waitForEvent('download'); await again.getByRole('button', { name: 'TXT', exact: true }).click();
    expect((await zipContents(await repeated))['images/0001.png']).toBe(blue);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('same-named pictures from different windows keep their own bytes when supplied separately', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'qce-log-two-images-'));
  try {
    const a = join(dir, 'A'), b = join(dir, 'B');
    const main = await viewerFile(a, '窗口 A', [{ text: 'A 的图[图片:地图.png]', image: './resources/images/地图.png' }]);
    const other = await viewerFile(b, '窗口 B', [{ text: 'B 的图[图片:地图.png]', image: './resources/images/地图.png' }]);
    for (const [folder, bytes] of [[a, red], [b, blue]]) { await mkdir(join(folder!, 'resources/images'), { recursive: true }); await writeFile(join(folder!, 'resources/images/地图.png'), Buffer.from(bytes!, 'base64')); }
    await open(page, main); await keep(page, 1);
    await page.locator('input[aria-label="选择记录文件"]').setInputFiles(other);
    await page.getByText('记录管理', { exact: true }).click();
    await page.getByRole('button', { name: '窗口 B', exact: true }).click(); await keep(page, 1);
    const panel = await draft(page); await panel.getByRole('button', { name: 'TXT', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('2 张图片尚未读取');
    await panel.getByRole('combobox', { name: '图片所属记录' }).selectOption({ label: '窗口 A' });
    await panel.locator('input[aria-label="选择图片文件夹"]').setInputFiles(a);
    await expect(panel.getByRole('status')).toContainText('「窗口 B」');
    const done = page.waitForEvent('download'); await panel.locator('input[aria-label="选择图片文件夹"]').setInputFiles(b);
    const zip = await zipContents(await done);
    expect(zip['images/0001.png']).toBe(red); expect(zip['images/0002.png']).toBe(blue);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('streaming-folder pictures remain exportable after the imported workspace is reopened', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'qce-log-stream-images-'));
  try {
    const primary = await viewerFile(join(dir, 'primary'), '主记录', [{ text: '暂不保留' }]);
    const folder = join(dir, 'streaming');
    const source = await readFile(await viewerFile(folder, '流式记录', [{ text: '目录中的地图[图片:地图.png]', image: './resources/images/地图.png' }]), 'utf8');
    const manifest = source.match(/<script>window\.__QCE_MANIFEST__\(([\s\S]*?)\)<\/script>/)![1]!;
    const chunk = source.match(/<script>window\.__QCE_CHUNK__\(([\s\S]*?)\)<\/script>/)![1]!;
    await mkdir(join(folder, 'data'), { recursive: true });
    await mkdir(join(folder, 'resources/images'), { recursive: true });
    await writeFile(join(folder, 'data/manifest.json'), manifest);
    await writeFile(join(folder, 'data/0.js'), `window.__QCE_CHUNK__(${chunk});`);
    await writeFile(join(folder, 'resources/images/地图.png'), Buffer.from(red, 'base64'));
    await open(page, primary);
    await page.locator('input[aria-label="选择流式导出目录"]').setInputFiles(folder);
    await page.getByText('记录管理', { exact: true }).click();
    await page.getByRole('button', { name: '流式记录', exact: true }).click();
    await keep(page, 1);
    for (const reopen of [false, true]) {
      if (reopen) {
        await page.reload();
        await expect(page.locator('#viewport [data-i="0"]')).toBeVisible();
        await page.getByText('记录管理', { exact: true }).click();
        await page.getByRole('button', { name: '流式记录', exact: true }).click();
      }
      const panel = await draft(page), download = page.waitForEvent('download');
      await panel.getByRole('button', { name: 'TXT', exact: true }).click();
      expect((await zipContents(await download))['images/0001.png']).toBe(red);
      await panel.getByRole('button', { name: '返回', exact: true }).click();
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('JSON message images survive text-only rendering on import', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'qce-log-json-images-'));
  try {
    const primary = await viewerFile(dir, '主记录', [{ text: '暂不保留' }]);
    const file = join(dir, 'import.json');
    await writeFile(file, JSON.stringify({ chatInfo: { name: 'JSON 记录' }, messages: [{
      id: 'original', time: '2026-11-19 20:00:00', sender: { uin: '10001', uid: 'u_1', name: 'KP' },
      content: { elements: [null, { type: 'text', data: { text: '先看红图再看蓝图' } },
        { type: 'image', data: { filename: '地图.png', dataUri: `data:image/png;base64,${red}` } },
        { type: 'image', data: { filename: '地图.png', dataUri: `data:image/png;base64,${blue}` } }] },
    }] }));
    await open(page, primary);
    await page.locator('input[aria-label="选择记录文件"]').setInputFiles(file);
    await page.getByText('记录管理', { exact: true }).click();
    await page.getByRole('button', { name: 'JSON 记录', exact: true }).click();
    await keep(page, 1);
    const panel = await draft(page), download = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'TXT', exact: true }).click();
    const zip = await zipContents(await download);
    expect(zip['images/0001.png']).toBe(red); expect(zip['images/0002.png']).toBe(blue);
    const text = Buffer.from(Object.entries(zip).find(([name]) => name.endsWith('.txt'))![1], 'base64').toString();
    expect(text).toContain('先看红图再看蓝图');
    expect(text.match(/\[图片：images\/000[12]\.png\]/g)).toHaveLength(2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an imported relative image never resolves to a different recording served by HTTP', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'qce-log-http-images-'));
  try {
    const a = join(dir, 'A'), b = join(dir, 'B');
    const main = await viewerFile(a, '网页记录', [{ text: '网页红图[图片:地图.png]', image: './resources/images/地图.png' }]);
    const other = await viewerFile(b, '导入记录', [{ text: '导入蓝图[图片:地图.png]', image: './resources/images/地图.png' }]);
    await mkdir(join(b, 'resources/images'), { recursive: true });
    await writeFile(join(b, 'resources/images/地图.png'), Buffer.from(blue, 'base64'));
    await page.route('https://**', route => route.abort());
    await page.route('http://qce-export.test/**', async route => {
      const html = new URL(route.request().url()).pathname === '/index.html';
      await route.fulfill({ contentType: html ? 'text/html' : 'image/png', body: html ? await readFile(main) : Buffer.from(red, 'base64') });
    });
    await page.goto('http://qce-export.test/index.html');
    await expect(page.locator('#viewport [data-i="0"]')).toBeVisible();
    await keep(page, 1);
    await page.locator('input[aria-label="选择记录文件"]').setInputFiles(other);
    await page.getByText('记录管理', { exact: true }).click();
    await page.getByRole('list', { name: '整理记录' }).getByRole('button', { name: '导入记录', exact: true }).click();
    await expect(page.locator('#viewport [data-i="0"]')).toContainText('导入蓝图');
    await keep(page, 1);
    const panel = await draft(page);
    await panel.getByRole('button', { name: 'TXT', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('「导入记录」的 1 张图片尚未读取');
    const download = page.waitForEvent('download');
    await panel.locator('input[aria-label="选择图片文件夹"]').setInputFiles(b);
    const zip = await zipContents(await download);
    expect(zip['images/0001.png']).toBe(red); expect(zip['images/0002.png']).toBe(blue);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
