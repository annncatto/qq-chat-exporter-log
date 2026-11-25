import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MissingLogImages } from './qce/log-export';
import type { DraftEntry, DraftFormat, DraftTemplate, DraftExportOptions, ReviewDraft } from './qce/log-review';

type EntrySelection = {
  mode: 'link' | 'delete';
  entries: Map<string, DraftEntry>;
  anchor?: string;
};

type DeleteHold = { key: string; pointer: number; x: number; y: number; revealed: boolean };

const DELETE_HOLD_MS = 700;
const entryKey = (entry: DraftEntry) => `${entry.key}:${entry.index}`;

export function LogDraft({ draft, full, onOpenFull, onEdit, onLink, onUnlink, onDelete, canUndoDelete, onUndoDelete, onExport, onClose }: {
  draft: ReviewDraft;
  full: boolean;
  onOpenFull: () => void;
  onEdit: (entry: DraftEntry, text: string) => void;
  onLink: (entries: DraftEntry[]) => void;
  onUnlink: (entry: DraftEntry) => void;
  onDelete: (entries: DraftEntry[]) => void;
  canUndoDelete: boolean;
  onUndoDelete: () => void;
  onExport: (format: DraftFormat, options: DraftExportOptions) => Promise<void>;
  onClose: () => void;
}) {
  const [role, setRole] = useState('');
  const [template, setTemplate] = useState<DraftTemplate>(() => {
    try { const value=localStorage.getItem('qce-log-export-template'); if(value==='langdu' || value==='sealdice')return value; } catch {}
    return 'standard';
  });
  const [includeImages, setIncludeImages] = useState(() => {try {return localStorage.getItem('qce-log-export-images')!=='false';}catch{return true;}});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [missingSources, setMissingSources] = useState<Array<{key:string;label:string}>>([]);
  const [folderSource, setFolderSource] = useState('');
  const imageSource = useRef('');
  const pendingFormat = useRef<DraftFormat>('txt');
  const imageFolder = useRef<HTMLInputElement>(null);
  const imageFiles = useRef<File[]>([]);
  async function exportDocument(format: DraftFormat, files = imageFiles.current): Promise<void> {
    if(exporting)return;
    pendingFormat.current=format;setExporting(true);setExportError('');setMissingSources([]);
    try {await onExport(format,{template,includeImages,files,fileSource:imageSource.current});}
    catch(error) {setExportError(error instanceof Error?error.message:'导出失败。');if(error instanceof MissingLogImages){setMissingSources(error.sources);setFolderSource(error.sources[0]?.key ?? '');}}
    finally {setExporting(false);}
  }

  const [chapter, setChapter] = useState('');
  const [limit, setLimit] = useState(60);
  const [editing, setEditing] = useState<DraftEntry | null>(null);
  const [text, setText] = useState('');
  const [selection, setSelection] = useState<EntrySelection | null>(null);
  const [revealedDelete, setRevealedDelete] = useState<string | null>(null);
  const revealTimer = useRef<number | null>(null);
  const touchHold = useRef<DeleteHold | null>(null);
  const suppressClick = useRef<{ key: string; until: number } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const scrollTop = useRef(0);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number }>();
  const { project, entries } = draft;
  const people = useMemo(() => new Map(project.people.map(person => [person.id, person])), [project.people]);
  const roleFilter = people.has(role) ? role : '';
  const chapterFilter = project.state.sections.includes(chapter) ? chapter : '';
  const visible = useMemo(() => project.messages.flatMap((message, n) => {
    const round = project.state.rounds[n] || '';
    return (!roleFilter || message.personId === roleFilter) && (!chapterFilter || round === chapterFilter) ? [n] : [];
  }), [project, roleFilter, chapterFilter]);
  const linkSource = selection?.mode === 'link' ? selection.entries.values().next().value?.key : undefined;

  function selectEntry(position: number, extend: boolean): void {
    const entry = entries[visible[position]!]!;
    if (linkSource && linkSource !== entry.key) return;
    const key = entryKey(entry);
    setSelection(previous => {
      if (!previous) return previous;
      const selected = new Map(previous.entries);
      const anchorPosition = extend && previous.mode === 'delete' && previous.anchor
        ? visible.findIndex(index => entryKey(entries[index]!) === previous.anchor) : -1;
      if (anchorPosition >= 0) {
        for (let i = Math.min(position, anchorPosition); i <= Math.max(position, anchorPosition); i++) {
          const item = entries[visible[i]!]!;
          selected.set(entryKey(item), item);
        }
      } else if (!selected.delete(key)) selected.set(key, entry);
      return { ...previous, entries: selected, anchor: key };
    });
  }

  function clearRevealTimer(): void {
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    revealTimer.current = null;
  }

  function revealAfterHold(key: string, touch?: DeleteHold): void {
    clearRevealTimer();
    revealTimer.current = window.setTimeout(() => {
      revealTimer.current = null;
      if (touch) touch.revealed = true;
      setRevealedDelete(key);
    }, DELETE_HOLD_MS);
  }

  useEffect(() => clearRevealTimer, []);

  function startSelection(mode: EntrySelection['mode']): void {
    clearRevealTimer();
    setRevealedDelete(null);
    setSelection({ mode, entries: new Map() });
  }

  function finishTouchHold(pointer: number, cancelled = false): void {
    const hold = touchHold.current;
    if (!hold || hold.pointer !== pointer) return;
    clearRevealTimer();
    touchHold.current = null;
    if (cancelled) setRevealedDelete(null);
    else if (hold.revealed) suppressClick.current = { key: hold.key, until: performance.now() + 500 };
  }

  function clamp(left: number, top: number) {
    const root = panel.current?.offsetParent;
    const box = panel.current?.getBoundingClientRect();
    if (!root || !box) return { left, top };
    return {
      left: Math.max(0, Math.min(left, root.clientWidth - box.width)),
      top: Math.max(0, Math.min(top, root.clientHeight - box.height)),
    };
  }

  useEffect(() => {
    const root = panel.current?.offsetParent;
    if (!root) return;
    const observer = new ResizeObserver(() => setPlacement(previous => {
      if (!previous) return previous;
      const next = clamp(previous.left, previous.top);
      return next.left === previous.left && next.top === previous.top ? previous : next;
    }));
    observer.observe(root);
    if (panel.current) observer.observe(panel.current);
    return () => observer.disconnect();
  }, [full]);

  useLayoutEffect(() => {
    const modal = dialog.current;
    if (modal) modal.showModal();
    if (scroll.current) scroll.current.scrollTop = scrollTop.current;
    return () => modal?.close();
  }, [full]);

  useEffect(() => {
    if (!full || !more.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setLimit(value => value + 60);
    }, { root: scroll.current, rootMargin: '160px' });
    observer.observe(more.current);
    return () => observer.disconnect();
  }, [full, limit, visible.length]);

  const content = <>
    <div className="qce-log-draft-bar">
      {full ? <h2 className="font-semibold">完整成稿</h2> : <button type="button" className="qce-log-draft-handle" aria-label="移动成稿" title="拖动成稿"
        onPointerDown={event => {
          if (event.button !== 0 || !panel.current) return;
          drag.current = { x: event.clientX, y: event.clientY, left: panel.current.offsetLeft, top: panel.current.offsetTop };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const start = drag.current;
          if (start) setPlacement(clamp(start.left + event.clientX - start.x, start.top + event.clientY - start.y));
        }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={event => {
          const delta = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[event.key];
          if (!delta || !panel.current) return;
          event.preventDefault();
          setPlacement(clamp(panel.current.offsetLeft + delta[0]!, panel.current.offsetTop + delta[1]!));
        }}>成稿预览</button>}
      <select aria-label="成稿角色" value={roleFilter} onChange={event => { setRole(event.target.value); setLimit(60); }}>
        <option value="">全部角色</option>
        {project.people.map(person => <option key={person.id} value={person.id}>{person.role}</option>)}
      </select>
      <select aria-label="成稿章节" value={chapterFilter} onChange={event => { setChapter(event.target.value); setLimit(60); }}>
        <option value="">全部章节</option>
        {project.state.sections.map(round => <option key={round} value={round}>{round}</option>)}
      </select>
      {!full && <Button size="sm" variant="ghost" aria-haspopup="dialog" onClick={onOpenFull}>完整成稿</Button>}
      <Button size="sm" variant="ghost" onClick={onClose}>{full ? '返回' : '关闭'}</Button>
    </div>
    <div ref={scroll} className="qce-log-draft-text" onScroll={event => { scrollTop.current = event.currentTarget.scrollTop; }}>
      {visible.slice(0, limit).map((n, i) => {
        const message = project.messages[n]!;
        const entry = entries[n]!;
        const body = project.state.edits[n] ?? message.text;
        const round = project.state.rounds[n] ?? '';
        const previous = i > 0 ? project.state.rounds[visible[i - 1]!] ?? '' : '';
        const before = i > 0 ? entries[visible[i - 1]!] : undefined;
        const startsExchange = entry.exchange !== undefined && (before?.key !== entry.key || before.exchange !== entry.exchange);
        const key = entryKey(entry);
        const selected = selection?.entries.has(key);
        const canDeleteRow = !selection && editing === null;
        return <Fragment key={key}>
          {round !== previous && <h2 className="qce-log-draft-round">{round || '未归类'}</h2>}
          <article className={entry.exchange !== undefined ? 'qce-log-draft-exchange' : undefined}
            onPointerEnter={event => {
              if (canDeleteRow && event.pointerType !== 'touch') revealAfterHold(key);
            }}
            onPointerLeave={event => {
              if (event.pointerType === 'touch') return;
              clearRevealTimer();
              setRevealedDelete(previous => previous === key ? null : previous);
            }}
            onPointerDown={event => {
              if (!canDeleteRow || event.pointerType !== 'touch' || (event.target as HTMLElement).closest('.qce-log-draft-delete')) return;
              setRevealedDelete(null);
              const hold: DeleteHold = { key, pointer: event.pointerId, x: event.clientX, y: event.clientY, revealed: false };
              touchHold.current = hold;
              revealAfterHold(key, hold);
            }}
            onPointerMove={event => {
              const hold = touchHold.current;
              if (hold?.pointer === event.pointerId && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 8) {
                finishTouchHold(event.pointerId, true);
              }
            }}
            onPointerUp={event => finishTouchHold(event.pointerId)}
            onPointerCancel={event => finishTouchHold(event.pointerId, true)}
            onContextMenu={event => {
              if (touchHold.current?.key === key) event.preventDefault();
            }}
            onClickCapture={event => {
              const suppressed = suppressClick.current;
              if (suppressed?.key !== key) return;
              suppressClick.current = null;
              if (performance.now() < suppressed.until && !(event.target as HTMLElement).closest('.qce-log-draft-delete')) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}>
            {startsExchange && !selection && <div className="qce-log-exchange-header">
              <span>已连成一段</span>
              <button type="button" onClick={() => onUnlink(entry)}>拆开此段</button>
            </div>}
            <header className="qce-log-draft-entry-heading">
              <span>【{people.get(message.personId)?.role || '系统'}】</span>
              {canDeleteRow && <button type="button" className="qce-log-draft-delete" data-visible={revealedDelete === key}
                onClick={() => { setRevealedDelete(null); onDelete([entry]); }}>删除</button>}
            </header>
            {selection?.mode === 'link' && <p className="qce-log-draft-source">{entry.source}{message.time && ` · ${message.time}`}</p>}
            {selection ? <button type="button" className="qce-log-manuscript-line"
              aria-pressed={selected} disabled={Boolean(linkSource && linkSource !== entry.key)}
              onClick={event => selectEntry(i, event.shiftKey)}>{body}</button>
            : editing?.key === entry.key && editing.index === entry.index ? <form onSubmit={event => {
              event.preventDefault();
              if (!text.trim()) return;
              onEdit(entry, text);
              setEditing(null);
            }}>
              <textarea aria-label="成稿正文" value={text} onChange={event => setText(event.target.value)} autoFocus />
              <Button size="sm" type="submit" disabled={!text.trim()}>保存</Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>取消</Button>
            </form> : <button type="button" className="qce-log-manuscript-line" onClick={() => { setEditing(entry); setText(body); }}>{body}</button>}
          </article>
        </Fragment>;
      })}
      {!visible.length && <p>{entries.length ? '此筛选下暂无成稿。' : '暂无成稿消息。'}</p>}
      {visible.length > limit && <Button ref={more} size="sm" variant="outline" onClick={() => setLimit(limit + 60)}>显示更多</Button>}
    </div>
    {selection ? <div className="qce-log-draft-bar">
      <span className="mr-auto" aria-live="polite">{selection.entries.size ? `已选 ${selection.entries.size} 条` : selection.mode === 'link' ? '选择同一窗口的消息' : '选择要删除的消息'}</span>
      <Button size="sm" variant="ghost" onClick={() => setSelection(null)}>取消</Button>
      <Button size="sm" disabled={selection.entries.size < (selection.mode === 'link' ? 2 : 1)} onClick={() => {
        const picked = [...selection.entries.values()];
        if (selection.mode === 'link') onLink(picked);
        else onDelete(picked);
        setSelection(null);
      }}>{selection.mode === 'link' ? '确认连段' : '删除所选'}</Button>
    </div> : <div className="qce-log-draft-bar">
      <Button size="sm" variant="ghost" disabled={entries.length < 2 || editing !== null}
        onClick={() => startSelection('link')}>连成一段</Button>
      <Button size="sm" variant="ghost" disabled={!entries.length || editing !== null}
        onClick={() => startSelection('delete')}>批量删除</Button>
      {canUndoDelete && <Button size="sm" variant="ghost" onClick={onUndoDelete}>撤销删除</Button>}
      <div className="qce-log-tool-group ml-auto">
        <select aria-label="导出模板" value={template} disabled={exporting} onChange={event => {
          const value=event.currentTarget.value as DraftTemplate;setTemplate(value);setExportError('');setMissingSources([]);
          try {localStorage.setItem('qce-log-export-template',value);} catch {}
        }}><option value="standard">标准</option><option value="langdu">朗读女</option><option value="sealdice">豹骰</option></select>
        <label><input type="checkbox" aria-label="TXT/JSON 附带图片" checked={includeImages} disabled={exporting} onChange={event => {
          setIncludeImages(event.currentTarget.checked);try {localStorage.setItem('qce-log-export-images',String(event.currentTarget.checked));}catch{}
        }} />{template === 'sealdice' ? '附图' : 'TXT 附图'}</label>
        <Button size="sm" variant="outline" disabled={!entries.length || exporting || editing !== null} onClick={() => void exportDocument('txt')}>TXT</Button>
        {template === 'sealdice' && <Button size="sm" variant="outline" disabled={!entries.length || exporting || editing !== null} onClick={() => void exportDocument('json')}>JSON</Button>}
        {template === 'standard' && <><Button size="sm" variant="outline" disabled={!entries.length || exporting || editing !== null} onClick={() => void exportDocument('md')}>Markdown</Button>
        <Button size="sm" variant="outline" disabled={!entries.length || exporting || editing !== null} onClick={() => void exportDocument('html')}>HTML</Button></>}
      </div>
    </div>}
    {(exportError || exporting) && <div className="qce-log-export-status" role="status">{exporting?'正在生成文件…':exportError}
      {missingSources.length > 1 && <select aria-label="图片所属记录" value={folderSource} onChange={event=>setFolderSource(event.currentTarget.value)}>{missingSources.map(source=><option key={source.key} value={source.key}>{source.label}</option>)}</select>}
      {missingSources.length > 0 && !exporting && <Button size="sm" variant="outline" onClick={() => imageFolder.current?.click()}>选择图片文件夹</Button>}
    </div>}
    <input type="file" hidden aria-label="选择图片文件夹" ref={element=>{imageFolder.current=element;element?.setAttribute('webkitdirectory','');}} onChange={event=>{
      const files=Array.from(event.currentTarget.files ?? []);event.currentTarget.value='';
      if(files.length){imageFiles.current=files;imageSource.current=folderSource;void exportDocument(pendingFormat.current,files);}
    }} />
  </>;

  return full ? <dialog ref={dialog} className="qce-log-draft-full" aria-label="完整成稿" onCancel={event => {
    event.preventDefault();
    onClose();
  }}>{content}</dialog> : <aside ref={panel} className="qce-log-draft" aria-label="成稿预览"
    style={placement && { ...placement, right: 'auto', bottom: 'auto' }}>{content}</aside>;
}
