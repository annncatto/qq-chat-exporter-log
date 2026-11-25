/* ZIP32 store entries, using Blob parts so image bytes need not be concatenated. */
const table = Uint32Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
async function checksum(blob) {
  const reader = blob.stream().getReader();
  let crc = 0xffffffff, work = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return (crc ^ 0xffffffff) >>> 0;
      for (const byte of value) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
      work += value.length;
      if (work >= 8 * 1024 * 1024) { work = 0; await new Promise(resolve => setTimeout(resolve, 0)); }
    }
  } finally { reader.releaseLock(); }
}
function header(size) { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; }
export async function makeLogZip(files) {
  if (files.length > 65535) throw new Error('图片过多，请分章节导出。');
  const parts = [], directory = [], names = new Set();
  let offset = 0, directorySize = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    if (!file.name || /[\\\x00-\x1f]/.test(file.name) || file.name.startsWith('/') || /^[a-z]:/i.test(file.name) || file.name.split('/').some(part => part === '..' || !part) || names.has(file.name) || name.length > 65535)
      throw new Error('压缩包文件名无效或重复。');
    names.add(file.name);
    if (file.data.size > 0xffffffff || offset + 30 + name.length + file.data.size > 0xffffffff) throw new Error('文件超过 ZIP32 上限，请分章节导出。');
    const crc = await checksum(file.data), local = header(30), central = header(46);
    local.view.setUint32(0, 0x04034b50, true); local.view.setUint16(4, 20, true); local.view.setUint16(6, 0x800, true);
    local.view.setUint16(12, 0x21, true); local.view.setUint32(14, crc, true); local.view.setUint32(18, file.data.size, true); local.view.setUint32(22, file.data.size, true); local.view.setUint16(26, name.length, true);
    central.view.setUint32(0, 0x02014b50, true); central.view.setUint16(4, 20, true); central.view.setUint16(6, 20, true); central.view.setUint16(8, 0x800, true);
    central.view.setUint16(14, 0x21, true); central.view.setUint32(16, crc, true); central.view.setUint32(20, file.data.size, true); central.view.setUint32(24, file.data.size, true); central.view.setUint16(28, name.length, true); central.view.setUint32(42, offset, true);
    parts.push(local.bytes, name, file.data); directory.push(central.bytes, name);
    offset += 30 + name.length + file.data.size; directorySize += 46 + name.length;
  }
  if (offset + directorySize + 22 > 0xffffffff) throw new Error('文件超过 ZIP32 上限，请分章节导出。');
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, files.length, true); end.view.setUint16(10, files.length, true); end.view.setUint32(12, directorySize, true); end.view.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end.bytes], { type: 'application/zip' });
}
