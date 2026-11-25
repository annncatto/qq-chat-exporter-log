import type { QceRecord } from './chunk-store';

export interface LogImage { src: string; name: string }

/** Paths remain relative to an export root; never resolve outside a picked folder. */
export function imagePath(source: string): string | undefined {
  if (!source || /^[a-z][a-z\d+.-]*:/i.test(source) || /^[\\/]/.test(source)) return;
  let path;
  try { path = decodeURIComponent(source.split(/[?#]/, 1)[0]!); } catch { return; }
  const parts = path.replace(/\\/g, '/').split('/').filter(part => part && part !== '.');
  if (!parts.length || parts.some(part => part === '..' || /[\x00-\x1f]/.test(part))) return;
  return parts.join('/');
}

export function imageName(source: string): string {
  try { return decodeURIComponent(source.split(/[?#]/, 1)[0]!.replace(/\\/g, '/').split('/').pop() || '图片'); }
  catch { return '图片'; }
}

export function recordImages(record: QceRecord): LogImage[] {
  if (Array.isArray(record.images) && record.images.every(image => image && typeof image.src === 'string' && typeof image.name === 'string')) return record.images;
  if (!/<img\b|mf-(?:image|sticker)/i.test(record.html)) return [];
  if (!['img','sticker','emoji'].includes(record.kind) && !/image-content|sticker-wrap|mf-(?:image|sticker)|system-message-image|face-emoji-image/.test(record.html)) return [];
  const template = document.createElement('template');
  template.innerHTML = record.html;
  const content = template.content.querySelector('.message-bubble .content, .system-message-container');
  if (!content) return [];
  return Array.from(content.querySelectorAll('img, .media-fallback.mf-image, .media-fallback.mf-sticker'))
    .filter(node => !node.closest('.reply-content, .reply-preview, .forward-sender, .avatar'))
    .map(node => ({ src: node.getAttribute('src') || '', name: node.getAttribute('alt') || node.getAttribute('title') || imageName(node.getAttribute('src') || '') }));
}

export function jsonImages(original: unknown): LogImage[] {
  const value = original as { content?: { resources?: Array<Record<string, unknown>>; elements?: Array<{ type: string; data?: Record<string, unknown> }> } } | undefined;
  const content = value?.content;
  if (!content || typeof content !== 'object') return [];
  const resources: Array<Record<string, unknown>> = Array.isArray(content.resources) && content.resources.length ? content.resources
    : (Array.isArray(content.elements) ? content.elements.filter(item => item && typeof item === 'object').map(item => ({ ...item.data, type: item.type })) : []);
  return resources.filter(item => item && (item.type === 'image' || item.type === 'market_face')).map(item => {
    const src = [item.dataUri, item.localPath, item.url].find(v => typeof v === 'string' && v) as string | undefined;
    return { src: src || '', name: typeof item.filename === 'string' ? item.filename : imageName(src || '') };
  });
}

export function attachFolderImages<T extends { data: { chunks: Record<string, QceRecord[]>; assets?: Record<string, Blob> } }>(recording: T, files: File[]): T {
  const paths = new Map(files.map(file => [imagePath(file.webkitRelativePath.replace(/^[^/]+\//, '')), file]));
  const assets: Record<string, Blob> = Object.create(null);
  for (const rows of Object.values(recording.data.chunks)) for (const row of rows) for (const image of recordImages(row)) {
    const path = imagePath(image.src), file = path ? paths.get(path) : undefined;
    if (path && file) assets[path] = file;
  }
  recording.data.assets = assets;
  return recording;
}

/** Read image signatures instead of trusting a path extension or declared MIME. */
export async function imageFormat(blob: Blob): Promise<{ mime: string; extension: string }> {
  const bytes = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  const ascii = new TextDecoder().decode(bytes);
  if (bytes[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return { mime: 'image/png', extension: 'png' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (/^GIF8[79]a/.test(ascii)) return { mime: 'image/gif', extension: 'gif' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  if (ascii.startsWith('BM')) return { mime: 'image/bmp', extension: 'bmp' };
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return { mime: 'image/x-icon', extension: 'ico' };
  if (/^(II[\x2a\x2b]\0|MM\0[\x2a\x2b])/.test(ascii)) return { mime: 'image/tiff', extension: 'tif' };
  if (ascii.slice(4, 8) === 'ftyp') {
    const brand = ascii.slice(8, 64);
    if (/avif|avis/.test(brand)) return { mime: 'image/avif', extension: 'avif' };
    if (/heic|heix|hevc|hevx|mif1/.test(brand)) return { mime: 'image/heic', extension: 'heic' };
  }
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(ascii)) return { mime: 'image/svg+xml', extension: 'svg' };
  throw new Error('图片内容无法识别。');
}
