import { ChunkStore, kindOf, type QceInlineData, type QceManifest, type QceRecord } from './chunk-store';
import { attachFolderImages, recordImages, jsonImages, type LogImage } from './log-media';
import { emptyReview, escapeReviewText, parseLogProject, reviewBody, reviewKey, type ReviewProgress } from './log-review';

type SourceMessage = Pick<QceRecord, 'uid' | 'uin' | 'name' | 'ts'> & { body: string; kind?: string; images?: LogImage[]; system?: boolean; self?: boolean };

export interface StoredRecording {
  key: string;
  label: string;
  included: boolean;
  data: QceInlineData & { manifest: QceManifest };
  initial: ReviewProgress;
}

export interface LogRecording {
  key: string;
  label: string;
  included: boolean;
  store: ChunkStore;
  initial?: ReviewProgress;
  saved?: StoredRecording;
}

export interface SavedWorkspace {
  primaryIncluded: boolean;
  primaryLabel?: string;
  additions: StoredRecording[];
}

const MAX_IMPORTED_MESSAGES = 200000;

function dateKey(ts: number): string {
  if (!ts) return '';
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return '';
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(part => String(part).padStart(2, '0')).join('-');
}

function timestamp(value: number, label: string): number {
  const ts = value > 0 ? value < 1e11 ? value * 1000 : value : Date.parse(label.replace(/\//g, '-'));
  return Number.isFinite(ts) && Number.isFinite(new Date(ts).getTime()) ? ts : 0;
}

function importedRecording(
  key: string, label: string, messages: SourceMessage[],
  initial = emptyReview(), included = true, chat?: QceManifest['chat'],
): StoredRecording {
  if (!messages.length) throw new Error('文件中没有消息。');
  if (messages.length > MAX_IMPORTED_MESSAGES) throw new Error('请按日期拆分，每份导入记录最多支持 20 万条消息。');
  const members = new Map<string, QceManifest['senders'][number]>();
  const chunks: QceInlineData['chunks'] = {};
  const details: QceManifest['chunks'] = [];
  let minDate = '';
  let maxDate = '';
  let previousDate = '';
  for (let start = 0; start < messages.length; start += 500) {
    const id = String(details.length);
    let min = Infinity;
    let max = -Infinity;
    const rows = messages.slice(start, start + 500).map((message, i): QceRecord => {
      const { uid, uin, ts, name, body } = message;
      const date = dateKey(ts);
      if (date && (!minDate || date < minDate)) minDate = date;
      if (date > maxDate) maxDate = date;
      min = Math.min(min, ts);
      max = Math.max(max, ts);
      const escapedName = escapeReviewText(name);
      const content = escapeReviewText(body).replace(/\r?\n/g, '<br>');
      const msgId = `msg-import-${start + i}`;
      const dateDivider = date && date !== previousDate ? `<div class="date-divider">${date}</div>` : '';
      previousDate = date;
      let html;
      if (message.system) {
        html = `<div class="system-message-container" role="note">${content}</div>`;
      } else {
        const existing = members.get(uid);
        if (existing) existing.count++;
        else members.set(uid, {
          uid, displayName: name, count: 1,
          avatar: uin && /^[1-9]\d{3,11}$/.test(uin) ? `https://q.qlogo.cn/g?b=qq&nk=${uin}&s=100` : null,
        });
        const time = ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '';
        html = `<div class="message ${message.self ? 'self' : 'other'}" id="${msgId}"><div class="avatar"><span class="avatar-fallback">${escapeReviewText(Array.from(name)[0] ?? '?')}</span></div><div class="message-wrapper"><div class="message-header"><span class="sender">${escapedName}</span><span class="time">${time}</span></div><div class="message-bubble"><div class="content">${content}</div></div></div></div>`;
      }
      return {
        id: msgId, ts, date, uid, uin, name, nameLower: name.toLowerCase(), logText: body,
        text: body.toLowerCase(), kind: message.kind || (message.system ? 'system' : 'text'),
        images: message.images, html: `<div class="message-block">${dateDivider}${html}</div>`,
      };
    });
    chunks[id] = rows;
    details.push({
      id, file: '', count: rows.length, bytes: 0, startTs: min, endTs: max,
      startDate: dateKey(min), endDate: dateKey(max), firstMsgId: rows[0]!.id, lastMsgId: rows[rows.length - 1]!.id,
      textBloom: '', senderBloom: '',
    });
  }
  return { key, label, included, initial, data: {
    chunks, msgid: {}, manifest: {
      format: 'qce-modern-html-chunked', version: 1, exportTime: key,
      chat: { ...chat, type: chat?.type ?? 'local', name: label },
      stats: { totalMessages: messages.length, minDateKey: minDate, maxDateKey: maxDate },
      senders: [...members.values()], chunks: details, chunking: { maxMessagesPerChunk: 500 },
      bloom: { textBits: 0, textHashes: 0, senderBits: 0, senderHashes: 0 },
    },
  } };
}

function fromExport(manifest: QceManifest, rows: QceRecord[]): StoredRecording {
  if (manifest.format !== 'qce-modern-html-chunked' || rows.length !== manifest.stats?.totalMessages) {
    throw new Error('导出的消息数据不完整。流式 HTML 请导入解压后的文件夹。');
  }
  const messages = rows.map((row): SourceMessage => {
    if (!row || typeof row.html !== 'string' || typeof row.name !== 'string' || typeof row.uid !== 'string' ||
        typeof row.ts !== 'number' || typeof row.text !== 'string' ||
        (row.logText != null && typeof row.logText !== 'string')) throw new Error('导出的消息格式有误。');
    const kind = kindOf(row.html);
    return {
      ts: timestamp(row.ts, ''), uid: row.uid, uin: typeof row.uin === 'string' ? row.uin : null,
      name: row.name || '系统', body: reviewBody({ ...row, kind }), images: recordImages({ ...row, kind }), kind,
      system: row.html.includes('role="note"'),
      self: /<div class="message self"/.test(row.html),
    };
  });
  return importedRecording(reviewKey(manifest), manifest.chat.name, messages, emptyReview(), true, manifest.chat);
}

function readChunkPayload(payload: string): { id: string; messages: QceRecord[] } {
  // The exporter writes the envelope as a JavaScript literal and the messages as JSON.
  const parts = payload.trim().match(/^\{\s*"?id"?\s*:\s*("(?:[^"\\]|\\.)*")\s*,\s*"?messages"?\s*:\s*(\[[\s\S]*\])\s*\}$/);
  if (!parts) throw new Error('无法读取消息分块。');
  try {
    return { id: JSON.parse(parts[1]!), messages: JSON.parse(parts[2]!) };
  } catch {
    throw new Error('消息分块格式有误。');
  }
}

export async function readRecording(file: File): Promise<StoredRecording[]> {
  const text = await file.text();
  if (/\.html?$/i.test(file.name)) {
    let manifest: QceManifest | undefined;
    const chunks = new Map<string, QceRecord[]>();
    for (const [, callback, json] of text.matchAll(/<script>\s*(?:window\.__QCE_\w+__\s*&&\s*)?window\.__QCE_(MANIFEST|CHUNK)__\((.*?)\);?\s*<\/script>/gs)) {
      if (callback === 'MANIFEST') manifest = JSON.parse(json!);
      else {
        const { id, messages } = readChunkPayload(json!);
        chunks.set(id, messages);
      }
    }
    if (!manifest?.chunks?.length) throw new Error('请导入 QCE 导出的单文件 HTML 或解压后的流式文件夹。');
    if (manifest.stats?.totalMessages > MAX_IMPORTED_MESSAGES) throw new Error('请按日期拆分，每份导入记录最多支持 20 万条消息。');
    return [fromExport(manifest, manifest.chunks.flatMap(chunk => chunks.get(chunk.id) ?? []))];
  }
  const project = parseLogProject(text, file.name);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const key = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  const people = new Map(project.people.map(person => [person.id, person]));
  const grouped = new Map(project.windows.map(source => [source.id, [] as number[]]));
  project.messages.forEach((message, index) => grouped.get(message.windowId)?.push(index));
  return project.windows.flatMap((source, sourceIndex) => {
    const indexes = grouped.get(source.id)!;
    if (!indexes.length) return [];
    const initial = emptyReview();
    const messages = indexes.map((index, offset): SourceMessage => {
      const row = project.messages[index]!;
      const person = people.get(row.personId)!;
      const uid = person.uid || person.qq || person.id;
      const decision = project.state.decisions[index];
      if (decision && decision !== 'pending') initial.decisions[offset] = decision;
      if (project.state.edits[index] !== undefined) initial.edits[offset] = project.state.edits[index];
      if (project.state.rounds[index] !== undefined) initial.chapters[offset] = project.state.rounds[index];
      if (project.state.current === index) initial.cursor = offset;
      if (person.role && person.role !== person.name) initial.roles[person.qq ? `qq:${person.qq}` : `uid:${uid}`] = person.role;
      return {
        uid, uin: person.qq || null, name: person.name, body: row.text, ts: timestamp(row.timestamp, row.time),
        images: jsonImages(row.original), system: row.original?.system === true,
        self: Boolean((source.selfUin && source.selfUin === person.qq) || (source.selfUid && source.selfUid === person.uid)),
      };
    });
    return [importedRecording(`local:${key}:${sourceIndex}`, source.name, messages, initial, source.enabled)];
  });
}

export async function readRecordingFolder(files: File[]): Promise<StoredRecording> {
  const byName = new Map(files.map(file => [file.webkitRelativePath.replace(/^[^/]+\//, ''), file]));
  const manifestFile = byName.get('data/manifest.json');
  if (!manifestFile) throw new Error('请选择包含 index.html 和 data 文件夹的流式导出目录。');
  const manifest: QceManifest = JSON.parse(await manifestFile.text());
  if (!Array.isArray(manifest?.chunks) || manifest.format !== 'qce-modern-html-chunked') throw new Error('无法读取导出目录。');
  if (manifest.stats.totalMessages > MAX_IMPORTED_MESSAGES) throw new Error('请按日期拆分，每份导入记录最多支持 20 万条消息。');
  const rows: QceRecord[] = [];
  for (const chunk of manifest.chunks) {
    const file = byName.get(chunk.file.replace(/^\.\//, ''));
    if (!file) throw new Error('请保留流式导出的完整文件夹。');
    const match = (await file.text()).match(/window\.__QCE_CHUNK__\((.*)\);?\s*$/s);
    if (!match) throw new Error('无法读取消息分块。');
    const value = readChunkPayload(match[1]!);
    if (value.id !== chunk.id || !Array.isArray(value.messages) || value.messages.length !== chunk.count) throw new Error('消息分块不完整。');
    rows.push(...value.messages);
  }
  return attachFolderImages(fromExport(manifest, rows), files);
}

export function openStoredRecording(saved: StoredRecording): LogRecording {
  return { key: saved.key, label: saved.label, included: saved.included, initial: saved.initial,
    // An imported file's relative paths belong to its own export, never the open page.
    saved, store: new ChunkStore('.', saved.data.manifest, saved.data, false) };
}

async function workspaceRequest<T>(key: string, write?: SavedWorkspace): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('qce-html-log-recordings', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspaces');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('workspaces', write ? 'readwrite' : 'readonly');
      const table = tx.objectStore('workspaces');
      const request = write ? table.put(write, key) : table.get(key);
      tx.oncomplete = () => resolve(request.result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const loadLogWorkspace = (key: string) => workspaceRequest<SavedWorkspace | undefined>(key);
export const saveLogWorkspace = (key: string, state: SavedWorkspace) => workspaceRequest<IDBValidKey>(key, state);
