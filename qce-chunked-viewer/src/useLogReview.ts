import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import type { FilteredDataSource, HyperScroll } from './hyperscroll';
import type { ChunkStore, QceManifest, QceRecord } from './qce/chunk-store';
import { buildLogExport } from './qce/log-export';
import type { LogRecording } from './qce/log-workspace';
import {
  emptyReview, loadReviewRecord, makeReviewProject, renderLogRow,
  progressBackup, readProgressBackup, restoreReview, reviewBody, reviewKey, saveReviewFile,
  type Decision, type DraftEntry, type DraftFormat, type DraftExportOptions, type ReviewDraft, type ReviewProgress,
} from './qce/log-review';

type DragState = { id: number; index: number; x: number; y: number; started: boolean; end?: number };

export interface ReviewTarget {
  store: RefObject<ChunkStore | null>;
  engine: RefObject<HyperScroll | null>;
  filter: RefObject<FilteredDataSource | null>;
  viewport: RefObject<HTMLDivElement | null>;
}

export function useReviewRows(pane: ReviewTarget, progress: ReviewProgress | null, active: boolean, selection: ReadonlySet<number>): void {
  const { engine, viewport } = pane;
  const cursor = active ? progress?.cursor ?? null : null;
  const selected = active ? selection : null;

  useLayoutEffect(() => {
    const rows = viewport.current?.querySelectorAll<HTMLElement>('.hs-list > .hs-item[data-i]');
    if (!rows) return;
    for (const row of rows) {
      const index = Number(row.dataset.i);
      row.classList.toggle('qce-log-current', index === cursor);
      row.classList.toggle('qce-log-selected', selected?.has(index) ?? false);
    }
  }, [viewport, cursor, selected]);

  // Cursor and range changes only affect the classes of mounted rows. Rebuild
  // the pane when persisted review content changes, keeping its visible anchor.
  useEffect(() => {
    engine.current?.syncAnchorToViewport();
    engine.current?.refresh();
  }, [engine, progress?.decisions, progress?.edits, progress?.chapters, progress?.roles]);
}

export function useLogReview(target: RefObject<ReviewTarget>) {
  const [progress, setProgress] = useState(emptyReview);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [chapter, setChapter] = useState('');
  const [autoChapter, setAutoChapter] = useState(false);
  const [rangeMode, setRangeMode] = useState(false);
  const [edit, setEditState] = useState<{ index: number; text: string } | null>(null);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const state = useRef(progress);
  const selection = useRef(selected);
  const storageKey = useRef('');
  const roleStorageKey = useRef('');
  const perSource = useRef(new Map<string, ReviewProgress>());
  const unfinishedEdits = useRef(new Map<string, NonNullable<typeof edit>>());
  const aliases = useRef<ReviewProgress['roles'] | undefined>(undefined);
  const undoStack = useRef<ReviewProgress[]>([]);
  const dragging = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  function recordingProgress(manifest: QceManifest, initial?: ReviewProgress): ReviewProgress {
    const key = reviewKey(manifest);
    let saved = perSource.current.get(key);
    if (!saved) {
      saved = restoreReview(key, manifest.stats.totalMessages, initial);
      perSource.current.set(key, saved);
    }
    return { ...saved, roles: aliases.current ?? saved.roles };
  }

  function initialize(manifest: QceManifest, workspaceKey: string, initial?: ReviewProgress): number | null {
    storageKey.current = reviewKey(manifest);
    if (aliases.current === undefined) {
      roleStorageKey.current = workspaceKey + ':roles';
      try {
        const saved = localStorage.getItem(roleStorageKey.current);
        if (saved) aliases.current = JSON.parse(saved);
      } catch { /* Use the names from this recording. */ }
    }
    const restored = recordingProgress(manifest, initial);
    aliases.current = restored.roles;
    state.current = restored;
    setProgress(restored);
    undoStack.current = [];
    clearSelection();
    setEditState(unfinishedEdits.current.get(storageKey.current) ?? null);
    setStatus('');
    return restored.cursor;
  }

  function setEdit(next: typeof edit): void {
    if (next) unfinishedEdits.current.set(storageKey.current, next);
    else unfinishedEdits.current.delete(storageKey.current);
    setEditState(next);
  }

  function persist(key: string, next: ReviewProgress): void {
    perSource.current.set(key, next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      setStatus('浏览器无法自动保存。关闭前请备份进度。');
    }
  }

  function commit(next: ReviewProgress, remember = true): void {
    if (remember) {
      undoStack.current.push(state.current);
      if (undoStack.current.length > 30) undoStack.current.shift();
    }
    if (aliases.current !== next.roles) {
      aliases.current = next.roles;
      try {
        localStorage.setItem(roleStorageKey.current, JSON.stringify(next.roles));
      } catch {
        setStatus('浏览器无法自动保存角色名称。');
      }
    }
    state.current = next;
    setProgress(next);
    persist(storageKey.current, next);
  }

  function includeRoles(recordings: LogRecording[]): void {
    const imported = Object.assign({}, ...recordings.map(recording => recording.initial?.roles ?? {}));
    if (Object.keys(imported).length > 0) commit({ ...state.current, roles: { ...imported, ...state.current.roles } }, false);
  }

  function sourceIndex(position: number): number | null {
    if (position < 0 || position >= (target.current.filter.current?.count ?? target.current.store.current?.manifest.stats.totalMessages ?? 0)) return null;
    return target.current.filter.current?.sourceIndex(position) ?? position;
  }

  function visiblePosition(index: number): number {
    return target.current.filter.current?.indexOf(index) ?? index;
  }

  function currentIndex(): number | null {
    const index = state.current.cursor;
    if (index !== null) {
      const row = target.current.viewport.current?.querySelector(`[data-i="${index}"]`);
      if (row) {
        const box = row.getBoundingClientRect();
        const bounds = target.current.viewport.current!.getBoundingClientRect();
        if (box.bottom > bounds.top && box.top < bounds.bottom) return index;
      }
    }
    return sourceIndex(target.current.engine.current?.getStats().anchor.index ?? 0);
  }

  function reveal(index: number | null): void {
    if (index !== null) {
      const position = visiblePosition(index);
      if (position >= 0) target.current.engine.current?.centerOnIndex(position);
    }
    target.current.viewport.current?.focus({ preventScroll: true });
  }

  function selectRow(index: number): void {
    if (suppressClick.current || unfinishedEdits.current.has(storageKey.current)) return;
    if (state.current.cursor !== index) commit({ ...state.current, cursor: index }, false);
    target.current.viewport.current?.focus({ preventScroll: true });
  }

  function clearSelection(): void {
    if (!selection.current.size) return;
    selection.current = new Set();
    setSelected(selection.current);
  }

  function nextUnreviewed(position: number, decisions: ReviewProgress['decisions']): number | null {
    let index = sourceIndex(position);
    while (index !== null && decisions[index]) index = sourceIndex(++position);
    return index;
  }

  function excludeSelection(): void {
    const previous = state.current;
    const decisions = { ...previous.decisions };
    let last = -1;
    let count = 0;
    for (const index of selection.current) {
      const position = visiblePosition(index);
      if (sourceIndex(position) !== index) continue;
      decisions[index] = 'exclude';
      last = Math.max(last, position);
      count++;
    }
    if (!count) return;

    const cursor = nextUnreviewed(last + 1, decisions) ?? sourceIndex(last);
    clearSelection();
    setRangeMode(false);
    commit({ ...previous, cursor, decisions });
    setStatus(`已排除 ${count.toLocaleString()} 条消息。`);
    reveal(cursor);
  }

  function decide(decision: Decision, editResult?: { index: number; text: string }): void {
    if (busy) return;
    if (decision === 'exclude' && selection.current.size) {
      excludeSelection();
      return;
    }
    const index = editResult?.index ?? currentIndex();
    if (index === null) return;
    const previous = state.current;
    const label = chapter.trim();
    if (autoChapter && !label) { setStatus('请填写当前章节或回合。'); return; }
    const position = visiblePosition(index);
    const next = previous.decisions[index]
      ? sourceIndex(position + 1)
      : nextUnreviewed(position + 1, previous.decisions);
    setEdit(null);
    clearSelection();
    setStatus(next === null ? '已到当前列表末尾。' : '');
    commit({
      ...previous,
      cursor: next ?? index,
      decisions: { ...previous.decisions, [index]: decision },
      edits: editResult ? { ...previous.edits, [index]: editResult.text } : previous.edits,
      chapters: autoChapter ? { ...previous.chapters, [index]: label } : previous.chapters,
    });
    reveal(next ?? index);
  }

  async function beginEdit(): Promise<void> {
    const index = currentIndex();
    const pane = target.current;
    const source = pane.store.current;
    if (index === null || busy || !source) return;
    setBusy(true);
    try {
      const row = await loadReviewRecord(source, index);
      if (target.current !== pane || pane.store.current !== source) return;
      setEdit({ index, text: state.current.edits[index] ?? reviewBody(row) });
      selectRow(index);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法读取消息。');
    } finally {
      setBusy(false);
    }
  }

  function undo(): void {
    const previous = undoStack.current.pop();
    if (!previous) return;
    commit(previous, false);
    setStatus('');
    clearSelection();
    reveal(previous.cursor);
  }

  function cancelEdit(): void {
    setEdit(null);
    target.current.viewport.current?.focus({ preventScroll: true });
  }

  function range(start: number, end: number): void {
    const a = visiblePosition(start);
    const b = visiblePosition(end);
    if (a < 0 || b < 0) return;
    const ids = new Set<number>();
    for (let pos = Math.min(a, b); pos <= Math.max(a, b); pos++) {
      const index = sourceIndex(pos);
      if (index !== null) ids.add(index);
    }
    selection.current = ids;
    setSelected(ids);
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    if (dragging.current || unfinishedEdits.current.has(storageKey.current) || event.button !== 0 || (event.pointerType === 'touch' && !rangeMode)) return;
    if (target.closest('a,button,input,textarea,label,select,[role="button"],.image-content img,.sticker-wrap,.forward-card')) return;
    const row = target.closest<HTMLElement>('.hs-item[data-i]');
    if (!row || row.querySelector('.skel-row')) return;
    dragging.current = { id: event.pointerId, index: Number(row.dataset.i), x: event.clientX, y: event.clientY, started: false };
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragging.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      drag.started = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      window.getSelection()?.removeAllRanges();
    }
    event.preventDefault();
    const viewport = event.currentTarget;
    const box = viewport.getBoundingClientRect();
    const x = Math.max(box.left + 3, Math.min(event.clientX, box.right - 3));
    const y = Math.max(box.top + 3, Math.min(event.clientY, box.bottom - 3));
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('.hs-item[data-i]');
    if (row && viewport.contains(row)) {
      const end = Number(row.dataset.i);
      if (drag.end !== end) {
        drag.end = end;
        range(drag.index, end);
      }
    }
    if (y < box.top + 20) target.current.engine.current?.scrollBy(-20);
    if (y > box.bottom - 20) target.current.engine.current?.scrollBy(20);
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragging.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.started && event.type === 'pointerup') {
      pointerMove(event);
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      if (event.pointerType === 'touch') setRangeMode(false);
    }
    dragging.current = null;
    if (!drag.started && event.type === 'pointerup') selectRow(drag.index);
  }

  function assign(): void {
    if (!chapter.trim() || !selection.current.size) return;
    const chapters = { ...state.current.chapters };
    for (const index of selection.current) chapters[index] = chapter.trim();
    commit({ ...state.current, chapters });
    clearSelection();
    setRangeMode(false);
    target.current.viewport.current?.focus({ preventScroll: true });
  }

  function jumpChapter(chapter: string): void {
    const match = Object.entries(state.current.chapters).find(([index, label]) => label === chapter && visiblePosition(Number(index)) >= 0);
    if (!match) { setStatus('当前筛选下没有此章节的消息。'); return; }
    const index = Number(match[0]);
    selectRow(index);
    reveal(index);
  }

  function openRow(index: number): void {
    commit({ ...state.current, cursor: index }, false);
    reveal(index);
  }

  function renameRole(key: string, name: string): void {
    if ((state.current.roles[key] || '') === name.trim()) return;
    const roles = { ...state.current.roles };
    if (name.trim()) roles[key] = name.trim();
    else delete roles[key];
    commit({ ...state.current, roles });
  }

  function decorate(index: number, row: QceRecord, html: string, manifest: QceManifest, active: boolean): string {
    const progress = reviewKey(manifest) === storageKey.current ? state.current : recordingProgress(manifest);
    return renderLogRow(index, row, html, active ? progress : { ...progress, cursor: null }, manifest,
      active && selection.current.has(index));
  }

  function saveProgress(): void {
    const manifest = target.current.store.current?.manifest;
    if (manifest) saveReviewFile(manifest.chat.name, 'qcelog', progressBackup(manifest, state.current));
  }

  async function openProgress(file: File): Promise<void> {
    const pane = target.current;
    const source = pane.store.current;
    if (!source || busy) return;
    setBusy(true);
    try {
      const next = readProgressBackup(await file.text(), source.manifest);
      if (target.current !== pane || pane.store.current !== source) return;
      setEdit(null);
      setDraft(null);
      clearSelection();
      setStatus('已恢复整理进度。');
      commit(next);
      reveal(next.cursor);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '无法恢复整理进度。');
    } finally {
      setBusy(false);
    }
  }

  function buildDraft(recordings: LogRecording[], title: string, allowEmpty: boolean): Promise<ReviewDraft> {
    return makeReviewProject(title, recordings.filter(recording => recording.included).map(recording => ({
      key: recording.key, label: recording.label, store: recording.store,
      progress: recordingProgress(recording.store.manifest, recording.initial),
    })), allowEmpty);
  }

  function refreshDraft(recordings: LogRecording[], title: string): () => void {
    let cancelled = false;
    void buildDraft(recordings, title, true).then(next => {
      if (!cancelled) setDraft(previous => previous ? next : null);
    }).catch(error => {
      if (!cancelled) setStatus(error instanceof Error ? error.message : '无法更新成稿。');
    });
    return () => { cancelled = true; };
  }

  async function showDraft(recordings: LogRecording[], title: string, format?: DraftFormat, options?: DraftExportOptions): Promise<void> {
    if (busy || !target.current.store.current) return;
    setBusy(true);
    setStatus(format ? '正在生成文件…' : '正在生成成稿…');
    try {
      const result = await buildDraft(recordings, title, !format);
      if (format) {
        const exported = await buildLogExport(result, recordings, format, options);
        saveReviewFile(title, exported.extension, exported.blob);
      } else setDraft(result);
      setStatus('');
    } catch (error) {
      if (format) { setStatus(''); throw error; }
      setStatus(error instanceof Error ? error.message : '无法生成成稿。');
    } finally {
      setBusy(false);
    }
  }

  function updateDraftProgress(recording: LogRecording, update: (before: ReviewProgress) => ReviewProgress, remember = true): void {
    const manifest = recording.store.manifest;
    const key = reviewKey(manifest);
    const before = recordingProgress(manifest, recording.initial);
    const next = update(before);
    if (next === before) return;
    if (key === storageKey.current) commit(next, remember);
    else {
      persist(key, next);
      setDraftRevision(previous => previous + 1);
    }
  }

  function setDraftDecisions(recordings: LogRecording[], entries: DraftEntry[], decision: Decision): DraftEntry[] {
    const sources = new Map<string, DraftEntry[]>();
    for (const entry of entries) {
      const source = sources.get(entry.key);
      if (source) source.push(entry);
      else sources.set(entry.key, [entry]);
    }
    const changed: DraftEntry[] = [];
    const expected = decision === 'exclude' ? 'keep' : 'exclude';
    for (const recording of recordings) {
      const source = sources.get(recording.key);
      if (!source) continue;
      updateDraftProgress(recording, before => {
        const matches = source.filter(entry => before.decisions[entry.index] === expected);
        if (!matches.length) return before;
        const decisions = { ...before.decisions };
        for (const entry of matches) {
          decisions[entry.index] = decision;
          changed.push(entry);
        }
        return { ...before, decisions };
      }, false);
    }
    return changed;
  }

  function editDraft(recording: LogRecording, entry: DraftEntry, text: string): void {
    updateDraftProgress(recording, before => ({ ...before, edits: { ...before.edits, [entry.index]: text } }));
  }

  function linkDraftEntries(recording: LogRecording, entries: DraftEntry[]): void {
    updateDraftProgress(recording, before => {
      const members = new Set(entries.filter(entry => entry.key === recording.key && before.decisions[entry.index] === 'keep')
        .map(entry => entry.index));
      if (members.size < 2) return before;
      const exchanges = { ...before.exchanges };
      const group = Object.values(exchanges).reduce<number>((max, value) => Math.max(max, value ?? 0), 0) + 1;
      for (const index of members) exchanges[index] = group;
      return { ...before, exchanges };
    });
  }

  function unlinkDraftExchange(recording: LogRecording, group: number): void {
    updateDraftProgress(recording, before => ({
      ...before,
      exchanges: Object.fromEntries(Object.entries(before.exchanges ?? {}).filter(([, value]) => value !== group)),
    }));
  }

  return {
    progress, selected, initialize, chapter, setChapter, autoChapter, setAutoChapter, rangeMode, setRangeMode,
    edit, setEdit, cancelEdit, draft, setDraft, draftRevision, refreshDraft, status, busy, selectRow, clearSelection, decide, beginEdit,
    undo, canUndo: undoStack.current.length > 0, pointerDown, pointerMove, pointerEnd, assign, jumpChapter, openRow, renameRole,
    recordingProgress, includeRoles,
    decorate, saveProgress, openProgress, showDraft, editDraft, linkDraftEntries, unlinkDraftExchange, setDraftDecisions,
  };
}
