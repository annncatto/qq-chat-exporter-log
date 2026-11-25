import { outputDraft, type DraftExportOptions, type DraftFormat, type ReviewDraft } from './log-review';
import type { ChunkStore } from './chunk-store';
import type { LogRecording } from './log-workspace';
import { imageFormat, imageName, imagePath, type LogImage } from './log-media';
import { makeLogZip } from './log-zip.mjs';

export class MissingLogImages extends Error {
  constructor(readonly count: number, readonly sources: Array<{ key: string; label: string }>) {
    super(`${sources.length === 1 ? `「${sources[0]!.label}」的 ` : ""}${count} 张图片尚未读取，请选择原导出文件夹后重试。`);
    this.name = 'MissingLogImages';
  }
}
interface PackedImage { path: string; blob: Blob; mime: string; data?: string }
function pickedImage(image: LogImage, files: File[]): File | undefined {
  const path = imagePath(image.src);
  const exact = path ? files.filter(file => [imagePath(file.webkitRelativePath), imagePath(file.webkitRelativePath.replace(/^[^/]+\//, ''))].includes(path)) : [];
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return;
  const names = new Set([image.name, imageName(image.src)]);
  const byName = files.filter(file => names.has(file.name));
  return byName.length === 1 ? byName[0] : undefined;
}
async function readImage(image: LogImage, store: ChunkStore, files: File[]): Promise<Blob> {
  const resourceKey = image.src || `name:${image.name}`;
  const cached = store.imageFile(resourceKey) ?? (/^(data:|blob:)/i.test(image.src) ? undefined : pickedImage(image, files));
  if (cached) { await imageFormat(cached); store.rememberImage(resourceKey, cached); return cached; }
  if (!image.src || /^[/\\]/.test(image.src) || /^[a-z]:[/\\]/i.test(image.src)) throw new Error('需要原图片文件。');
  const url = new URL(store.imageUrl(image.src));
  if (url.username || url.password || !['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) throw new Error('需要原图片文件。');
  if (url.protocol === 'data:' && !/^data:image\//i.test(url.href)) throw new Error('不是图片。');
  const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('读取图片失败。');
    const blob = await response.blob(); await imageFormat(blob); return blob;
  } finally { window.clearTimeout(timeout); }
}
async function dataUri(image: PackedImage): Promise<string> {
  if (image.data) return image.data;
  image.data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(`data:${image.mime};base64,${String(reader.result).split(',', 2)[1]}`);
    reader.onerror = () => reject(new Error('无法读取图片数据。'));
    reader.readAsDataURL(image.blob);
  });
  return image.data;
}
function replaceImageMarker(text: string, image: LogImage, index: number, replacement: string): string {
  const names = [...new Set([image.name, imageName(image.src)])].filter(Boolean);
  const markers = names.flatMap(name => [`[图片:${name}]`, `[图片：${name}]`, `[表情:${name}]`, `[表情：${name}]`]);
  markers.push(`[图片${index + 1}]`, '[图片]', '[表情]');
  const marker = markers.find(value => text.includes(value));
  return marker ? text.replace(marker, replacement) : `${text}${text ? '\n' : ''}${replacement}`;
}
/** A snapshot export: only retained entries from included windows are inspected. */
export async function buildLogExport(
  draft: ReviewDraft, recordings: LogRecording[], format: DraftFormat,
  options: DraftExportOptions = { template: 'standard', includeImages: true },
): Promise<{ blob: Blob; extension: string }> {
  const template = format === 'txt' || format === 'json' ? options.template : 'standard';
  if (!['txt','json'].includes(format) || !options.includeImages || !draft.entries.some(entry => entry.images?.length)) {
    return { blob: new Blob([outputDraft(draft.project, format, template)], { type: `${format === 'html' ? 'text/html' : format === 'json' ? 'application/json' : 'text/plain'};charset=utf-8` }), extension: format };
  }
  const sources = new Map(recordings.map(recording => [recording.key, recording.store]));
  const images = new Map<string, PackedImage>();
  const messageImages: Array<Array<{ source: LogImage; packed: PackedImage }>> = [];
  const missing = new Set<string>();
  const missingSources = new Set<string>();
  for (const entry of draft.entries) {
    const picked: Array<{ source: LogImage; packed: PackedImage }> = [];
    for (const [index, image] of (entry.images ?? []).entries()) {
      const key = `${entry.key}\0${image.src || `${entry.index}:${index}`}`;
      if (missing.has(key)) continue;
      let packed = images.get(key);
      if (!packed) {
        try {
          const store = sources.get(entry.key);
          if (!store) throw new Error('原记录已关闭。');
          const blob = await readImage(image, store, options.fileSource === entry.key ? options.files ?? [] : []), kind = await imageFormat(blob);
          packed = { path: `images/${String(images.size + 1).padStart(4, '0')}.${kind.extension}`, blob, mime: kind.mime };
          images.set(key, packed);
        } catch { missing.add(key); missingSources.add(entry.key); continue; }
      }
      picked.push({ source: image, packed });
    }
    messageImages.push(picked);
  }
  if (missing.size) throw new MissingLogImages(missing.size, recordings.filter(source => missingSources.has(source.key)).map(({key,label})=>({key,label})));
  const edits = { ...draft.project.state.edits };
  for (const [index, selected] of messageImages.entries()) {
    if (!selected.length) continue;
    let text = edits[index] ?? draft.project.messages[index]!.text;
    const replacements: Array<[string,string]> = [];
    let prefix = '\0qce:image:';
    while (text.includes(prefix)) prefix += ':';
    for (const [n, { source, packed }] of selected.entries()) {
      const marker = template === 'sealdice' ? `[CQ:image,file=${packed.path},url=${await dataUri(packed)}]` : `[图片：${packed.path}]`;
      const token = `${prefix}${n}\0`;
      replacements.push([token,marker]);
      text = replaceImageMarker(text, source, n, token);
    }
    for(const [token,replacement] of replacements)text=text.replaceAll(token,replacement);
    edits[index] = text;
  }
  const project = { ...draft.project, state: { ...draft.project.state, edits } };
  const text = outputDraft(project, format, template);
  if(format==='json')return {blob:new Blob([text],{type:'application/json;charset=utf-8'}),extension:'json'};
  const name = draft.project.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || '跑团记录';
  const files = [{ name: `${name}.txt`, data: new Blob([text], { type: 'text/plain;charset=utf-8' }) },
    ...Array.from(images.values(), image => ({ name: image.path, data: image.blob }))];
  return { blob: await makeLogZip(files), extension: 'zip' };
}
