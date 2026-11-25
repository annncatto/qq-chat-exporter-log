import { useEffect, useMemo, useRef, useState } from 'react';
import type { DataSource } from './hyperscroll';
import { FilteredDataSource, HyperScroll } from './hyperscroll';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FileIcon,
  ImageIcon,
  LayersIcon,
  MapPinIcon,
  MicIcon,
  MoonIcon,
  MoveRightIcon,
  PanelLeftIcon,
  PanelsTopLeftIcon,
  ReplyIcon,
  SearchIcon,
  SettingsIcon,
  Share2Icon,
  SmileIcon,
  SunIcon,
  TypeIcon,
  VideoIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Loader } from '@/components/ui/loader';
import { MediaPreview, downloadUrl, type MediaItem } from '@/components/ui/media-preview';
import { createTextBloomProbe, createTokenBloomProbe } from './qce/bloom';
import { ChunkStore, loadManifest } from './qce/chunk-store';
import { reviewKey, roleAlias, roleKey, type DraftEntry } from './qce/log-review';
import { loadLogWorkspace, openStoredRecording, readRecording, readRecordingFolder, saveLogWorkspace, type LogRecording, type StoredRecording } from './qce/log-workspace';
import { useLogReview, useReviewRows, type ReviewTarget } from './useLogReview';
import { LogDraft } from './LogDraft';
import { LogSources } from './LogSources';
import { LogCompare } from './LogCompare';
import {
  installMediaFallback,
  replaceMediaWithFallback,
} from './qce/media-fallback';

const QCE_REPO = 'https://github.com/shuakami/qq-chat-exporter';
const HS_REPO = 'https://github.com/shuakami/hyperscroll';
const SIDEBAR_DESKTOP_QUERY = '(min-width: 48rem)';

type IconComponent = React.ComponentType<{ className?: string }>;

const KIND_OPTIONS: ReadonlyArray<readonly [string, string, IconComponent]> = [
  ['text', '文本', TypeIcon],
  ['img', '图片', ImageIcon],
  ['sticker', '表情', SmileIcon],
  ['voice', '语音', MicIcon],
  ['video', '视频', VideoIcon],
  ['file', '文件', FileIcon],
  ['reply', '回复', ReplyIcon],
  ['forward', '转发', Share2Icon],
  ['card', '卡片', PanelsTopLeftIcon],
  ['location', '位置', MapPinIcon],
];

interface QceSettings {
  rememberScroll: boolean;
  prefetchChunks: boolean;
  showGroupMemberTitles: boolean;
}

const DEFAULT_SETTINGS: QceSettings = {
  rememberScroll: false,
  prefetchChunks: false,
  showGroupMemberTitles: true,
};

function loadSettings(): QceSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('qce-settings') ?? '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface Filters {
  sender: string;
  kind: string;
  startMs: number;
  endMs: number;
}

const NO_FILTERS: Filters = { sender: '', kind: '', startMs: 0, endMs: 0 };

function hasFilters(f: Filters): boolean {
  return Boolean(f.sender || f.kind || f.startMs || f.endMs);
}

function RustMark({ className }: { className?: string }): React.ReactElement {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M23.8346 11.7033l-1.0073-.6236a13.7268 13.7268 0 00-.0283-.2936l.8656-.8069a.3483.3483 0 00-.1154-.578l-1.1066-.414a8.4958 8.4958 0 00-.087-.2856l.6904-.9587a.3462.3462 0 00-.2257-.5446l-1.1663-.1894a9.3574 9.3574 0 00-.1407-.2622l.49-1.0761a.3437.3437 0 00-.0274-.3361.3486.3486 0 00-.3006-.154l-1.1845.0416a6.7444 6.7444 0 00-.1873-.2268l.2723-1.153a.3472.3472 0 00-.417-.4172l-1.1532.2724a14.0183 14.0183 0 00-.2278-.1873l.0415-1.1845a.3442.3442 0 00-.49-.328l-1.076.491c-.0872-.0476-.1742-.0952-.2623-.1407l-.1903-1.1673A.3483.3483 0 0016.256.955l-.9597.6905a8.4867 8.4867 0 00-.2855-.086l-.414-1.1066a.3483.3483 0 00-.5781-.1154l-.8069.8666a9.2936 9.2936 0 00-.2936-.0284L12.2946.1683a.3462.3462 0 00-.5892 0l-.6236 1.0073a13.7383 13.7383 0 00-.2936.0284L9.9803.3374a.3462.3462 0 00-.578.1154l-.4141 1.1065c-.0962.0274-.1903.0567-.2855.086L7.744.955a.3483.3483 0 00-.5447.2258L7.009 2.348a9.3574 9.3574 0 00-.2622.1407l-1.0762-.491a.3462.3462 0 00-.49.328l.0416 1.1845a7.9826 7.9826 0 00-.2278.1873L3.8413 3.425a.3472.3472 0 00-.4171.4171l.2713 1.1531c-.0628.075-.1255.1509-.1863.2268l-1.1845-.0415a.3462.3462 0 00-.328.49l.491 1.0761a9.167 9.167 0 00-.1407.2622l-1.1662.1894a.3483.3483 0 00-.2258.5446l.6904.9587a13.303 13.303 0 00-.087.2855l-1.1065.414a.3483.3483 0 00-.1155.5781l.8656.807a9.2936 9.2936 0 00-.0283.2935l-1.0073.6236a.3442.3442 0 000 .5892l1.0073.6236c.008.0982.0182.1964.0283.2936l-.8656.8079a.3462.3462 0 00.1155.578l1.1065.4141c.0273.0962.0567.1914.087.2855l-.6904.9587a.3452.3452 0 00.2268.5447l1.1662.1893c.0456.088.0922.1751.1408.2622l-.491 1.0762a.3462.3462 0 00.328.49l1.1834-.0415c.0618.0769.1235.1528.1873.2277l-.2713 1.1541a.3462.3462 0 00.4171.4161l1.153-.2713c.075.0638.151.1255.2279.1863l-.0415 1.1845a.3442.3442 0 00.49.327l1.0761-.49c.087.0486.1741.0951.2622.1407l.1903 1.1662a.3483.3483 0 00.5447.2268l.9587-.6904a9.299 9.299 0 00.2855.087l.414 1.1066a.3452.3452 0 00.5781.1154l.8079-.8656c.0972.0111.1954.0203.2936.0294l.6236 1.0073a.3472.3472 0 00.5892 0l.6236-1.0073c.0982-.0091.1964-.0183.2936-.0294l.8069.8656a.3483.3483 0 00.578-.1154l.4141-1.1066a8.4626 8.4626 0 00.2855-.087l.9587.6904a.3452.3452 0 00.5447-.2268l.1903-1.1662c.088-.0456.1751-.0931.2622-.1407l1.0762.49a.3472.3472 0 00.49-.327l-.0415-1.1845a6.7267 6.7267 0 00.2267-.1863l1.1531.2713a.3472.3472 0 00.4171-.416l-.2713-1.1542c.0628-.0749.1255-.1508.1863-.2278l1.1845.0415a.3442.3442 0 00.328-.49l-.49-1.076c.0475-.0872.0951-.1742.1407-.2623l1.1662-.1893a.3483.3483 0 00.2258-.5447l-.6904-.9587.087-.2855 1.1066-.414a.3462.3462 0 00.1154-.5781l-.8656-.8079c.0101-.0972.0202-.1954.0283-.2936l1.0073-.6236a.3442.3442 0 000-.5892zm-6.7413 8.3551a.7138.7138 0 01.2986-1.396.714.714 0 11-.2997 1.396zm-.3422-2.3142a.649.649 0 00-.7715.5l-.3573 1.6685c-1.1035.501-2.3285.7795-3.6193.7795a8.7368 8.7368 0 01-3.6951-.814l-.3574-1.6684a.648.648 0 00-.7714-.499l-1.473.3158a8.7216 8.7216 0 01-.7613-.898h7.1676c.081 0 .1356-.0141.1356-.088v-2.536c0-.074-.0536-.0881-.1356-.0881h-2.0966v-1.6077h2.2677c.2065 0 1.1065.0587 1.394 1.2088.0901.3533.2875 1.5044.4232 1.8729.1346.413.6833 1.2381 1.2685 1.2381h3.5716a.7492.7492 0 00.1296-.0131 8.7874 8.7874 0 01-.8119.9526zM6.8369 20.024a.714.714 0 11-.2997-1.396.714.714 0 01.2997 1.396zM4.1177 8.9972a.7137.7137 0 11-1.304.5791.7137.7137 0 011.304-.579zm-.8352 1.9813l1.5347-.6824a.65.65 0 00.33-.8585l-.3158-.7147h1.2432v5.6025H3.5669a8.7753 8.7753 0 01-.2834-3.348zm6.7343-.5437V8.7836h2.9601c.153 0 1.0792.1772 1.0792.8697 0 .575-.7107.7815-1.2948.7815zm10.7574 1.4862c0 .2187-.008.4363-.0243.651h-.9c-.09 0-.1265.0586-.1265.1477v.413c0 .973-.5487 1.1846-1.0296 1.2382-.4576.0517-.9648-.1913-1.0275-.4717-.2704-1.5186-.7198-1.8436-1.4305-2.4034.8817-.5599 1.799-1.386 1.799-2.4915 0-1.1936-.819-1.9458-1.3769-2.3153-.7825-.5163-1.6491-.6195-1.883-.6195H5.4682a8.7651 8.7651 0 014.907-2.7699l1.0974 1.151a.648.648 0 00.9182.0213l1.227-1.1743a8.7753 8.7753 0 016.0044 4.2762l-.8403 1.8982a.652.652 0 00.33.8585l1.6178.7188c.0283.2875.0425.577.0425.8717zm-9.3006-9.5993a.7128.7128 0 11.984 1.0316.7137.7137 0 01-.984-1.0316zm8.3389 6.71a.7107.7107 0 01.9395-.3625.7137.7137 0 11-.9405.3635z" />
    </svg>
  );
}

function GithubMark({ className }: { className?: string }): React.ReactElement {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

// Highlights matches inside the message bubble only, never in sender names or
// other chrome, and never inside tags/attributes.
let highlightQuery = '';
let highlightRegex: RegExp | null = null;

function getHighlightRegex(q: string): RegExp {
  if (q !== highlightQuery || !highlightRegex) {
    highlightQuery = q;
    highlightRegex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  }
  highlightRegex.lastIndex = 0;
  return highlightRegex;
}

function highlightHtml(html: string, q: string): string {
  const at = html.indexOf('class="message-bubble');
  if (at === -1) return html;
  const open = html.indexOf('>', at);
  if (open === -1) return html;
  const re = getHighlightRegex(q);
  let out = html.slice(0, open + 1);
  let i = open + 1;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    const text = lt === -1 ? html.slice(i) : html.slice(i, lt);
    re.lastIndex = 0;
    out += text.replace(re, (m) => `<mark class="hl">${m}</mark>`);
    if (lt === -1) break;
    const gt = html.indexOf('>', lt);
    out += html.slice(lt, gt === -1 ? html.length : gt + 1);
    i = gt === -1 ? html.length : gt + 1;
  }
  return out;
}

function skeletonHtml(i: number): string {
  return (
    `<div class="hs-item" data-i="${i}"><div class="skel-row">` +
    `<span class="skel skel-avatar"></span>` +
    `<div class="skel-body"><span class="skel skel-name"></span>` +
    `<span class="skel skel-bubble" style="width:${180 + ((i * 97) % 260)}px"></span></div>` +
    `</div></div>`
  );
}

const SEEK_AVATAR = /<div class="avatar">[\s\S]*?<\/div>/gi;
const SEEK_IMAGE = /<div class="image-content">\s*<img\b[^>]*>\s*<\/div>/gi;
const SEEK_STICKER = /<span class="sticker-wrap">\s*<img\b[^>]*>\s*<\/span>/gi;
const SEEK_REMAINING_IMAGE = /<img\b[^>]*>/gi;
const SEEK_MEDIA_TAG = /<(?:video|audio|source)\b[^>]*>/gi;
const SEEK_MEDIA_SOURCE = /\s(?:src|srcset|poster)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

function withoutSeekMediaSources(html: string): string {
  return html
    .replace(
      SEEK_AVATAR,
      '<div class="avatar"><span class="seek-media-placeholder seek-avatar-placeholder" aria-hidden="true"></span></div>',
    )
    .replace(
      SEEK_IMAGE,
      '<div class="image-content"><span class="seek-media-placeholder seek-image-placeholder" aria-hidden="true"></span></div>',
    )
    .replace(
      SEEK_STICKER,
      '<span class="sticker-wrap"><span class="seek-media-placeholder seek-sticker-placeholder" aria-hidden="true"></span></span>',
    )
    .replace(
      SEEK_REMAINING_IMAGE,
      '<span class="seek-media-placeholder seek-inline-placeholder" aria-hidden="true"></span>',
    )
    .replace(SEEK_MEDIA_TAG, (tag) => tag.replace(SEEK_MEDIA_SOURCE, ''));
}

/**
 * Estimates a row's rendered height from its content so the virtual scroller
 * places offscreen rows close to their real size — this is what keeps big
 * jumps from thrashing. Undefined (not-yet-loaded) rows fall back to a
 * neutral guess matching the skeleton.
 */
function estimateRowHeight(rec: { html: string; text?: string } | null | undefined): number {
  if (!rec) return 96;
  const h = rec.html;
  if (h.includes('image-content') || h.includes('video-bubble')) return 300;
  if (h.includes('sticker-wrap')) return 176;
  if (h.includes('message-file')) return 92;
  if (h.includes('voice-bubble')) return 88;
  const len = (rec.text ?? '').length;
  const lines = Math.max(1, Math.ceil(len / 34));
  return 64 + Math.min(lines - 1, 12) * 22;
}

const AVATAR_HUES = [14, 44, 96, 152, 200, 232, 262, 312, 348];

function SenderDot({ name, avatar }: { name: string; avatar?: string }): React.ReactElement {
  const [failed, setFailed] = useState(false);
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = AVATAR_HUES[h % AVATAR_HUES.length];
  if (avatar && !failed) {
    return (
      <img
        src={avatar}
        alt=""
        aria-hidden
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-4 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
      style={{ background: `hsl(${hue} 55% 55%)` }}
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

function fmtDate(key: string | undefined): string {
  if (!key) return '--';
  return new Date(`${key}T00:00:00`).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface SearchState {
  matches: number[];
  cursor: number;
  running: boolean;
  chunksScanned: number;
  chunksSkipped: number;
  cancelled: boolean;
}

declare global {
  interface Window {
    showImageModal?: (src: string) => void;
    hideImageModal?: () => void;
    scrollToMessage?: (msgId: string) => void;
  }
}

function fnv1a32(str: string, seed: number): number {
  let h = seed >>> 0 || 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export default function Viewer(): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<HyperScroll | null>(null);
  const compareViewportRef = useRef<HTMLDivElement>(null);
  const compareEngineRef = useRef<HyperScroll | null>(null);
  const storeRef = useRef<ChunkStore | null>(null);
  const compareStoreRef = useRef<ChunkStore | null>(null);
  const highlightRef = useRef('');
  const filterSourceRef = useRef<FilteredDataSource | null>(null);
  const noFilterRef = useRef<FilteredDataSource | null>(null);
  const searchRef = useRef<SearchState | null>(null);
  const filterRunRef = useRef(0);
  const replyReturnTimerRef = useRef<number | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement>(
    typeof Audio !== 'undefined' ? new Audio() : ({} as HTMLAudioElement),
  );
  const playingVoiceRef = useRef<HTMLElement | null>(null);
  const playingSrcRef = useRef('');
  const mainTarget = useMemo<ReviewTarget>(() => ({ store: storeRef, engine: engineRef, filter: filterSourceRef, viewport: viewportRef }), []);
  const compareTarget = useMemo<ReviewTarget>(() => ({ store: compareStoreRef, engine: compareEngineRef, filter: noFilterRef, viewport: compareViewportRef }), []);
  const reviewTarget = useRef(mainTarget);
  const [reviewPane, setReviewPane] = useState<'main' | 'compare'>('main');
  const review = useLogReview(reviewTarget);

  const [recordings, setRecordings] = useState<LogRecording[]>([]);
  const recordingsRef = useRef<LogRecording[]>([]);
  const pendingWrites = useRef<Promise<unknown>>(Promise.resolve());
  const [activeKey, setActiveKey] = useState('');
  const [compareKey, setCompareKey] = useState('');
  const [layout, setLayout] = useState<'single' | 'horizontal' | 'vertical'>('single');
  const [importing, setImporting] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState('');
  const panePositions = useRef(new Map<string, { index: number; offset: number }>());
  const pendingRow = useRef<{ key: string; index: number } | null>(null);
  const rootRecording = recordings[0];
  const activeRecording = recordings.find(recording => recording.key === activeKey) ?? rootRecording;
  const comparison = recordings.find(recording => recording.key === compareKey) ?? rootRecording;
  const manifest = activeRecording?.store.manifest ?? null;
  const mainProgress = activeRecording ? review.recordingProgress(activeRecording.store.manifest, activeRecording.initial) : null;
  const compareProgress = layout !== 'single' && comparison ? review.recordingProgress(comparison.store.manifest, comparison.initial) : null;
  useReviewRows(mainTarget, mainProgress, reviewPane === 'main', review.selected);
  useReviewRows(compareTarget, compareProgress, reviewPane === 'compare', review.selected);

  function activateReviewPane(pane: typeof reviewPane, recording = pane === 'main' ? activeRecording : comparison): void {
    if (!recording || !rootRecording) return;
    const nextTarget = pane === 'main' ? mainTarget : compareTarget;
    const previousStore = reviewTarget.current.store.current;
    if (reviewTarget.current === nextTarget && previousStore === recording.store) return;
    preserveReadingPosition();
    if (pane === 'compare') compareStoreRef.current = recording.store;
    reviewTarget.current = nextTarget;
    setReviewPane(pane);
    if (previousStore !== recording.store) review.initialize(recording.store.manifest, rootRecording.key, recording.initial);
    else review.clearSelection();
  }

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const filtersRef = useRef<Filters>(NO_FILTERS);
  const [query, setQuery] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [canNav, setCanNav] = useState(false);
  const [canClear, setCanClear] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOnDesktop, setSidebarOnDesktop] = useState(() => window.matchMedia(SIDEBAR_DESKTOP_QUERY).matches);
  const [flowMode, setFlowMode] = useState(false);
  const [draftMode, setDraftMode] = useState<'preview' | 'full'>('preview');
  const [lastDraftDeletion, setLastDraftDeletion] = useState<DraftEntry[]>([]);
  const returnToDraftPreview = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const sidebarExpanded = !flowMode && (sidebarOnDesktop ? !sidebarCollapsed : sidebarOpen);
  const [roleSender, setRoleSender] = useState('');
  const [loadedChunks, setLoadedChunks] = useState(0);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [searching, setSearching] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<QceSettings>(loadSettings);
  const [replyReturnId, setReplyReturnId] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  const progressFileRef = useRef<HTMLInputElement>(null);
  const [dark, setDark] = useState(
    () =>
      document.documentElement.classList.contains('dark') ||
      (localStorage.getItem('qce-theme') === null &&
        window.matchMedia('(prefers-color-scheme: dark)').matches) ||
      localStorage.getItem('qce-theme') === 'dark',
  );

  useEffect(() => {
    const media = window.matchMedia(SIDEBAR_DESKTOP_QUERY);
    const update = () => {
      setSidebarOnDesktop(media.matches);
      if (media.matches) setSidebarOpen(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    let wasFullscreen = false;
    const onFullscreenChange = () => {
      const isFullscreen = document.fullscreenElement === shellRef.current;
      if (wasFullscreen && !isFullscreen) {
        preserveReadingPosition();
        setFlowMode(false);
      }
      wasFullscreen = isFullscreen;
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  function preserveReadingPosition(): void {
    engineRef.current?.syncAnchorToViewport();
    compareEngineRef.current?.syncAnchorToViewport();
  }

  function exitFlowMode(): void {
    preserveReadingPosition();
    setFlowMode(false);
    if (shellRef.current && document.fullscreenElement === shellRef.current) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }

  function toggleFlowMode(): void {
    if (flowMode) {
      exitFlowMode();
      return;
    }
    preserveReadingPosition();
    setSidebarOpen(false);
    setFlowMode(true);
    void shellRef.current?.requestFullscreen?.().catch(() => undefined);
    if (!review.edit) reviewTarget.current.viewport.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    // MODERN_CSS (assets/style.css) themes the message layer via data-theme.
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('qce-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem('qce-settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    document.documentElement.classList.toggle(
      'qce-hide-group-member-titles',
      !settings.showGroupMemberTitles,
    );
  }, [settings.showGroupMemberTitles]);

  useEffect(() => () => {
    if (replyReturnTimerRef.current !== null) {
      window.clearTimeout(replyReturnTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    return viewport ? installMediaFallback(viewport) : undefined;
  }, []);

  // Exported message HTML calls these globals (image onclick / reply jump).
  useEffect(() => {
    window.showImageModal = (src: string) => {
      const name = src.startsWith('data:')
        ? '图片'
        : decodeURIComponent(src.split('/').pop()?.split('?')[0] || '图片');
      setPreview({ type: 'image', src, name, thumb: src });
    };
    window.hideImageModal = () => setPreview(null);
    window.scrollToMessage = (msgId: string) => {
      void jumpToMessageId(msgId);
    };
    return () => {
      delete window.showImageModal;
      delete window.hideImageModal;
      delete window.scrollToMessage;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rich-media clicks inside the exported message HTML: voice playback,
  // video preview, and voice download. Delegated from the viewport container.
  function onViewportClick(
    e: React.MouseEvent,
    select = review.selectRow,
    jump = (id: string, from?: string) => { void jumpToMessageId(id, from); },
  ): void {
    const target = e.target as HTMLElement;

    const forwardToggle = target.closest('.forward-card-toggle');
    if (forwardToggle instanceof HTMLButtonElement) {
      const card = forwardToggle.closest('.forward-card');
      if (!(card instanceof HTMLElement)) return;
      const expanded = card.classList.toggle('is-expanded');
      forwardToggle.setAttribute('aria-expanded', String(expanded));
      const label = forwardToggle.querySelector('.forward-card-toggle-label');
      if (label) {
        const count = forwardToggle.dataset.count ?? card.querySelectorAll(
          ':scope > .forward-card-content > .forward-card-line',
        ).length;
        label.textContent = expanded ? '收起' : `展开全部 ${count} 条`;
      }
      return;
    }

    const reply = target.closest('.reply-content[data-reply-to]');
    if (reply instanceof HTMLElement && !target.closest('a, button')) {
      const msgId = reply.getAttribute('data-reply-to');
      const sourceId = reply.closest('.message[id]')?.id;
      if (msgId) jump(msgId, sourceId);
      return;
    }

    const voice = target.closest('.voice-bubble');
    if (voice instanceof HTMLElement) {
      const src = voice.getAttribute('data-src') ?? '';
      if (target.closest('.vdl')) {
        e.preventDefault();
        if (src) void downloadUrl(src, voice.getAttribute('data-name') || 'voice');
        return;
      }
      toggleVoice(voice, src);
      return;
    }

    const video = target.closest('.video-bubble');
    if (video instanceof HTMLElement) {
      const src = video.getAttribute('data-src') ?? '';
      if (src) setPreview({ type: 'video', src, name: video.getAttribute('data-name') || '视频' });
      return;
    }
    if (!target.closest('a,button,input,textarea,label,select,[role="button"],.image-content img,.sticker-wrap')) {
      const row = target.closest<HTMLElement>('.hs-item[data-i]');
      if (row && !row.querySelector('.skel-row')) select(Number(row.dataset.i));
    }
  }

  function onViewportKeyDown(e: React.KeyboardEvent, jump = (id: string, from?: string) => { void jumpToMessageId(id, from); }): void {
    if (!e.repeat && !e.altKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      review.undo();
      return;
    }
    if (!e.repeat && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && !review.edit) {
      const key = e.key.toLowerCase();
      if (key === 'a' || key === 's' || key === 'e') {
        e.preventDefault();
        if (key === 'e') void review.beginEdit();
        else review.decide(key === 'a' ? 'keep' : 'exclude');
        return;
      }
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target as HTMLElement;
    const reply = target.closest('.reply-content[data-reply-to]');
    if (!(reply instanceof HTMLElement) || reply !== target) return;
    const msgId = reply.getAttribute('data-reply-to');
    if (!msgId) return;
    e.preventDefault();
    const sourceId = reply.closest('.message[id]')?.id;
    jump(msgId, sourceId);
  }

  function toggleVoice(el: HTMLElement, src: string): void {
    if (!src) return;
    const audio = voiceAudioRef.current;
    const prev = playingVoiceRef.current;
    if (prev && prev !== el) prev.classList.remove('playing');
    if (playingSrcRef.current === src && !audio.paused) {
      audio.pause();
      el.classList.remove('playing');
      playingVoiceRef.current = null;
      return;
    }
    if (playingSrcRef.current !== src) {
      audio.src = src;
      playingSrcRef.current = src;
    }
    audio.onended = () => {
      el.classList.remove('playing');
      playingVoiceRef.current = null;
    };
    void audio.play().then(() => {
      el.classList.add('playing');
      playingVoiceRef.current = el;
    }).catch(() => {
      el.classList.remove('playing');
      replaceMediaWithFallback(el, 'audio');
    });
  }

  function clearReplyReturn(): void {
    if (replyReturnTimerRef.current !== null) {
      window.clearTimeout(replyReturnTimerRef.current);
      replyReturnTimerRef.current = null;
    }
    setReplyReturnId(null);
  }

  function showReplyReturn(msgId: string): void {
    if (replyReturnTimerRef.current !== null) {
      window.clearTimeout(replyReturnTimerRef.current);
    }
    setReplyReturnId(msgId);
    replyReturnTimerRef.current = window.setTimeout(() => {
      replyReturnTimerRef.current = null;
      setReplyReturnId(null);
    }, 20_000);
  }

  async function findMessageIndex(store: ChunkStore, msgId: string): Promise<number | null> {
    const idx = store.manifest.msgidIndex;
    if (!idx?.bucketCount) return null;
    const bucket = fnv1a32(String(msgId), 0x811c9dc5) % idx.bucketCount;
    const chunkId = await store.msgIdToChunkId(msgId, bucket);
    if (!chunkId) return null;
    const c = store.manifest.chunks.findIndex((m) => m.id === chunkId);
    if (c < 0) return null;
    const records = await store.load(c);
    const k = records.findIndex((r) => r.id === msgId);
    return k < 0 ? null : store.chunkStarts[c]! + k;
  }

  async function jumpToMessageId(msgId: string, returnMsgId?: string): Promise<void> {
    const store = storeRef.current;
    const engine = engineRef.current;
    if (!store || !engine) return;
    const globalIdx = await findMessageIndex(store, msgId);
    if (globalIdx === null || engineRef.current !== engine) return;
    const filterSource = filterSourceRef.current;
    if (filterSource) {
      const p = filterSource.indexOf(globalIdx);
      if (p >= 0) engine.scrollToIndex(p, -80);
    } else {
      engine.scrollToIndex(globalIdx, -80);
    }
    if (returnMsgId && returnMsgId !== msgId) {
      showReplyReturn(returnMsgId);
    }
    let attempts = 0;
    const highlight = (): void => {
      const el = document.getElementById(msgId);
      if (!el) {
        if (attempts++ < 60) requestAnimationFrame(highlight);
        return;
      }
      const bubble = el.querySelector('.message-bubble');
      if (!(bubble instanceof HTMLElement)) return;
      bubble.classList.remove('reply-jump-highlight');
      void bubble.offsetWidth;
      bubble.classList.add('reply-jump-highlight');
      window.setTimeout(() => {
        bubble.classList.remove('reply-jump-highlight');
      }, 700);
    };
    requestAnimationFrame(highlight);
  }

  function withHighlight(src: DataSource): DataSource {
    const highlight = (html: string): string =>
      highlightRef.current ? highlightHtml(html, highlightRef.current) : html;
    const renderSeek = src.renderSeekToString?.bind(src);
    return {
      get count() {
        return src.count;
      },
      renderToString: (i) => highlight(src.renderToString(i)),
      renderSeekToString: renderSeek ? (i) => highlight(renderSeek(i)) : undefined,
      estimateHeight: src.estimateHeight?.bind(src),
    };
  }

  useEffect(() => {
    let disposed = false;
    void loadManifest('.').then(async m => {
      const key = reviewKey(m);
      const store = new ChunkStore('.', m);
      const saved = await loadLogWorkspace(key).catch(() => undefined);
      if (disposed) return;
      const primary = { key, store, label: saved?.primaryLabel || m.chat.name, included: saved?.primaryIncluded ?? true };
      const restored = [primary, ...(saved?.additions.map(openStoredRecording) ?? [])];
      recordingsRef.current = restored;
      setRecordings(restored);
      if (m.chat?.name) document.title = `聊天记录 - ${m.chat.name}`;
    });
    return () => {
      disposed = true;
    };
  }, []);

  function updateRecordings(next: LogRecording[]): void {
    const primary = next[0];
    if (!primary) return;
    recordingsRef.current = next;
    setRecordings(next);
    const additions = next.flatMap(recording => recording.saved ? [{
      ...recording.saved, included: recording.included, label: recording.label,
    }] : []);
    pendingWrites.current = pendingWrites.current.then(() => saveLogWorkspace(primary.key, {
      primaryIncluded: primary.included, primaryLabel: primary.label, additions,
    })).catch(() => setRecordingStatus('浏览器未能保存导入记录。'));
  }

  function updateRecording(key: string, changes: Partial<Pick<LogRecording, 'label' | 'included'>>): void {
    const previous = recordingsRef.current.find(recording => recording.key === key);
    if (!previous || (changes.label ?? previous.label) === previous.label &&
        (changes.included ?? previous.included) === previous.included) return;
    updateRecordings(recordingsRef.current.map(recording => recording === previous ? { ...recording, ...changes } : recording));
  }

  async function importRecordings(files: File[], folder: boolean): Promise<void> {
    if (!files.length || importing) return;
    setImporting(true);
    setRecordingStatus('正在读取记录…');
    const staged: StoredRecording[] = [];
    const errors: string[] = [];
    if (folder) {
      try { staged.push(await readRecordingFolder(files)); }
      catch (error) { errors.push(error instanceof Error ? error.message : '读取文件夹失败。'); }
    } else {
      for (const file of files) {
        try { staged.push(...await readRecording(file)); }
        catch (error) { errors.push(`${file.name}：${error instanceof Error ? error.message : '读取失败。'}`); }
      }
    }
    const keys = new Set(recordingsRef.current.map(recording => recording.key));
    const imported = [];
    for (const item of staged) {
      if (keys.has(item.key)) continue;
      keys.add(item.key);
      imported.push(openStoredRecording(item));
    }
    if (imported.length) {
      review.includeRoles(imported);
      updateRecordings([...recordingsRef.current, ...imported]);
    }
    const duplicateCount = staged.length - imported.length;
    setRecordingStatus([
      imported.length ? `已导入 ${imported.length} 份记录。` : '',
      duplicateCount ? `已跳过 ${duplicateCount} 份重复记录。` : '',
      ...errors,
    ].join(' '));
    setImporting(false);
  }

  function openRecording(key: string, index?: number): void {
    activateReviewPane('main');
    if (key === activeRecording?.key) {
      if (index !== undefined) {
        if (filterSourceRef.current) applyFilters(NO_FILTERS);
        review.openRow(index);
      }
      return;
    }
    if (index !== undefined) pendingRow.current = { key, index };
    setActiveKey(key);
    setSidebarOpen(false);
  }

  useEffect(() => {
    if (!activeRecording || !rootRecording) return;
    const el = viewportRef.current;
    if (!el) return;
    const { store, key, initial } = activeRecording;
    const { manifest } = store;
    storeRef.current = store;
    reviewTarget.current = mainTarget;
    setReviewPane('main');
    const reviewPosition = review.initialize(manifest, rootRecording.key, initial);
    filterRunRef.current++;
    filterSourceRef.current = null;
    filtersRef.current = NO_FILTERS;
    setFilters(NO_FILTERS);
    setFilterStatus('');
    setQuery('');
    setRoleSender('');
    setDateStart('');
    setDateEnd('');
    resetSearch();
    clearReplyReturn();
    setLoadedChunks(store.loadedChunkCount());
    const engine = new HyperScroll(el, {
      dataSource: withHighlight(fullSourceOf(store)),
      keyboard: true,
    });
    engineRef.current = engine;
    let refreshQueued = false;
    let frame = 0;
    const unsubscribe = store.subscribe(() => {
      setLoadedChunks(store.loadedChunkCount());
      if (refreshQueued) return;
      refreshQueued = true;
      frame = requestAnimationFrame(() => {
        refreshQueued = false;
        engine.refresh();
      });
    });

    const restore = panePositions.current.get(key);
    const choice = pendingRow.current;
    if (choice?.key === key) {
      pendingRow.current = null;
      review.openRow(choice.index);
    } else if (restore) {
      engine.scrollToIndex(restore.index, restore.offset);
    } else if (reviewPosition !== null && reviewPosition >= 0 && reviewPosition < manifest.stats.totalMessages) {
      engine.scrollToIndex(reviewPosition, -12);
    } else if (settingsRef.current.rememberScroll) {
      const saved = Number(localStorage.getItem(key + ':scroll') ?? (key === rootRecording.key ? localStorage.getItem('qce-scroll') : null) ?? -1);
      if (saved > 0 && saved < manifest.stats.totalMessages) engine.scrollToIndex(saved);
    }
    let lastSavedAnchor: number | null = null;
    const settingsTimer = window.setInterval(() => {
      const s = settingsRef.current;
      if (filterSourceRef.current) return;
      if (!s.rememberScroll && !s.prefetchChunks) return;
      const a = engine.getStats().anchor;
      if (s.rememberScroll && a.index !== lastSavedAnchor) {
        localStorage.setItem(key + ':scroll', String(a.index));
        lastSavedAnchor = a.index;
      }
      if (s.prefetchChunks) {
        const c = store.chunkOf(a.index);
        if (c + 1 < store.manifest.chunks.length && !store.isLoaded(c + 1)) void store.load(c + 1);
        if (c > 0 && !store.isLoaded(c - 1)) void store.load(c - 1);
      }
    }, 800);

    return () => {
      window.clearInterval(settingsTimer);
      cancelAnimationFrame(frame);
      unsubscribe();
      if (searchRef.current) searchRef.current.cancelled = true;
      if (!filterSourceRef.current) panePositions.current.set(key, engine.getStats().anchor);
      engine.destroy();
      engineRef.current = null;
      storeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRecording?.store]);

  function fullSourceOf(store: ChunkStore): DataSource {
    return {
      count: store.manifest.stats.totalMessages,
      renderToString(i) {
        const rec = store.get(i);
        return rec ? review.decorate(i, rec, rec.html, store.manifest, reviewTarget.current === mainTarget) : skeletonHtml(i);
      },
      renderSeekToString(i) {
        const rec = store.get(i);
        return rec ? review.decorate(i, rec, withoutSeekMediaSources(rec.html), store.manifest, reviewTarget.current === mainTarget) : skeletonHtml(i);
      },
      estimateHeight: (i) => estimateRowHeight(store.get(i)),
    };
  }

  function resetSearch(): void {
    if (searchRef.current) searchRef.current.cancelled = true;
    searchRef.current = null;
    setSearching(false);
    setSearchStatus('');
    setCanNav(false);
    setCanClear(false);
    if (highlightRef.current) {
      highlightRef.current = '';
      engineRef.current?.refresh();
    }
  }

  function applyFilters(next: Filters): void {
    const engine = engineRef.current;
    const store = storeRef.current;
    if (!engine || !store) return;
    activateReviewPane('main');
    review.clearSelection();
    const run = ++filterRunRef.current;
    resetSearch();
    filtersRef.current = next;
    setFilters(next);
    if (!hasFilters(next)) {
      filterSourceRef.current = null;
      setFilterStatus('');
      engine.setDataSource(withHighlight(fullSourceOf(store)));
      return;
    }
    const src = new FilteredDataSource(fullSourceOf(store));
    filterSourceRef.current = src;
    engine.setDataSource(withHighlight(src));
    setFilterStatus('筛选中…');
    const senderProbe = createTokenBloomProbe(next.sender);
    void (async () => {
      for (let c = 0; c < store.manifest.chunks.length; c++) {
        if (filterRunRef.current !== run) return;
        const meta = store.manifest.chunks[c]!;
        const outsideRange =
          (next.endMs > 0 && meta.startTs > next.endMs) ||
          (next.startMs > 0 && meta.endTs < next.startMs);
        if (outsideRange || (next.sender && !store.senderMayContain(c, senderProbe))) {
          continue;
        }
        const records = await store.load(c);
        if (filterRunRef.current !== run) return;
        const base = store.chunkStarts[c]!;
        const batch: number[] = [];
        for (let k = 0; k < records.length; k++) {
          const r = records[k]!;
          if (next.sender && r.uid !== next.sender) continue;
          if (next.kind && r.kind !== next.kind) continue;
          if (next.startMs > 0 && r.ts < next.startMs) continue;
          if (next.endMs > 0 && r.ts > next.endMs) continue;
          batch.push(base + k);
        }
        if (batch.length > 0) src.append(batch);
        engine.refresh();
        setFilterStatus(
          `${src.count.toLocaleString()} 条结果，已扫描 ${Math.round(((c + 1) / store.manifest.chunks.length) * 100)}%`,
        );
      }
      if (filterRunRef.current !== run) return;
      engine.refresh();
      setFilterStatus(`${src.count.toLocaleString()} 条结果`);
    })();
  }

  function jumpToMatch(pos: number): void {
    const s = searchRef.current;
    const engine = engineRef.current;
    if (!s || !engine) return;
    const n = s.matches.length;
    if (n === 0) return;
    s.cursor = ((pos % n) + n) % n;
    const srcIdx = s.matches[s.cursor]!;
    setSearchStatus(
      `第 ${(s.cursor + 1).toLocaleString()} / ${n.toLocaleString()} 条${s.running ? '，搜索中…' : ''}`,
    );
    const filterSource = filterSourceRef.current;
    if (filterSource) {
      const p = filterSource.indexOf(srcIdx);
      if (p >= 0) engine.scrollToIndex(p, -8);
    } else {
      engine.scrollToIndex(srcIdx, -8);
    }
  }

  function runSearch(): void {
    const engine = engineRef.current;
    const store = storeRef.current;
    if (!engine || !store) return;
    activateReviewPane('main');
    const q = query.trim().toLowerCase();
    resetSearch();
    if (!q) return;
    setCanClear(true);
    setSearching(true);
    highlightRef.current = q;
    engine.refresh();
    const s: SearchState = {
      matches: [],
      cursor: -1,
      running: true,
      chunksScanned: 0,
      chunksSkipped: 0,
      cancelled: false,
    };
    searchRef.current = s;
    const f = filtersRef.current;
    const textProbe = createTextBloomProbe(q);
    void (async () => {
      let firstJump = true;
      for (let c = 0; c < store.manifest.chunks.length; c++) {
        if (s.cancelled) return;
        const meta = store.manifest.chunks[c]!;
        const outsideRange =
          (f.endMs > 0 && meta.startTs > f.endMs) || (f.startMs > 0 && meta.endTs < f.startMs);
        if (outsideRange || !store.textMayContain(c, textProbe)) {
          s.chunksSkipped += 1;
          continue;
        }
        const records = await store.load(c);
        if (s.cancelled) return;
        s.chunksScanned += 1;
        const base = store.chunkStarts[c]!;
        for (let k = 0; k < records.length; k++) {
          const r = records[k]!;
          if (f.sender && r.uid !== f.sender) continue;
          if (f.kind && r.kind !== f.kind) continue;
          if (f.startMs > 0 && r.ts < f.startMs) continue;
          if (f.endMs > 0 && r.ts > f.endMs) continue;
          if (r.text.toLowerCase().includes(q)) s.matches.push(base + k);
        }
        if (s.matches.length > 0 && firstJump) {
          firstJump = false;
          setCanNav(true);
          jumpToMatch(0);
        } else {
          const pos = s.cursor >= 0 ? `第 ${(s.cursor + 1).toLocaleString()} / ` : '';
          setSearchStatus(
            `${pos}${s.matches.length.toLocaleString()} 条匹配，${Math.round(((c + 1) / store.manifest.chunks.length) * 100)}%`,
          );
        }
      }
      if (s.cancelled) return;
      s.running = false;
      setSearching(false);
      if (s.matches.length === 0) {
        setSearchStatus('没有匹配的消息');
      } else {
        jumpToMatch(Math.max(s.cursor, 0));
      }
    })();
  }

  const chat = manifest?.chat;
  const stats = manifest?.stats;
  const label = activeRecording?.label || '聊天记录';
  const senderEntry = manifest?.senders.find((s) => s.uid === filters.sender);
  const senderName = manifest && senderEntry ? roleAlias(senderEntry, manifest, review.progress.roles) ?? senderEntry.displayName : undefined;
  const selectedRole = manifest?.senders.find(sender => sender.uid === roleSender);
  const selectedRoleKey = manifest && selectedRole ? roleKey(selectedRole, manifest) : '';
  const reviewedCount = Object.keys(review.progress.decisions).length;
  const reviewTotal = (reviewPane === 'compare' ? comparison : activeRecording)?.store.manifest.stats.totalMessages ?? 0;
  const canDraft = lastDraftDeletion.length > 0 || recordings.some(recording => recording.included &&
    Object.values(review.recordingProgress(recording.store.manifest, recording.initial).decisions).includes('keep'));
  const draftTitle = recordings.filter(recording => recording.included).length > 1 ? (rootRecording?.label ?? label) + ' - 合并成稿' : label;
  const draftOpen = Boolean(review.draft);

  function openDraft(mode: typeof draftMode): void {
    if (mode === 'full') returnToDraftPreview.current = draftOpen && draftMode === 'preview';
    setDraftMode(mode);
    if (!draftOpen) void review.showDraft(recordings, draftTitle);
  }

  function closeDraft(): void {
    if (draftMode === 'full' && returnToDraftPreview.current) {
      setDraftMode('preview');
      return;
    }
    review.setDraft(null);
  }

  useEffect(() => {
    if (!draftOpen) return;
    return review.refreshDraft(recordings, draftTitle);
  }, [draftOpen, recordings, draftTitle, review.progress.decisions, review.progress.edits,
    review.progress.chapters, review.progress.roles, review.progress.exchanges, review.draftRevision]);
  const chapters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chapter of Object.values(review.progress.chapters)) {
      if (chapter) counts.set(chapter, (counts.get(chapter) || 0) + 1);
    }
    return [...counts];
  }, [review.progress.chapters]);

  return (
    <div ref={shellRef} className="qce-log-shell relative flex h-dvh text-foreground"
      data-sidebar-open={sidebarExpanded} data-flow={flowMode}
      onKeyDown={event => {
        if (event.key === 'Escape' && flowMode && !event.defaultPrevented && !review.edit && !preview && !settingsOpen) {
          event.preventDefault();
          exitFlowMode();
        }
      }}>
      {/* Sidebar */}
      <aside
        id="qce-viewer-sidebar"
        className="qce-log-sidebar-frame"
        inert={!sidebarExpanded}
      >
        <div className="qce-log-sidebar flex h-full flex-col overflow-y-auto px-4 py-4">
        <div>
          <div className="font-semibold text-base tracking-tight">{activeRecording?.label ?? '加载中…'}</div>
          {chat ? (
            <div className="mt-0.5 text-muted-foreground text-xs">
              {chat.type === 'group' ? '群聊记录' : chat.type === 'local' ? '导入记录' : '私聊记录'}
            </div>
          ) : null}
        </div>

        {manifest && stats ? (
          <>
            <dl className="mt-5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
              <div className="contents">
                <dt className="text-muted-foreground">消息数</dt>
                <dd className="text-right font-medium tabular-nums">{stats.totalMessages.toLocaleString()}</dd>
              </div>
              <div className="contents">
                <dt className="text-muted-foreground">范围</dt>
                <dd className="flex flex-wrap items-center justify-end gap-1.5 text-right font-medium tabular-nums">
                  {fmtDate(stats.minDateKey)}
                  {stats.minDateKey !== stats.maxDateKey && <>
                    <MoveRightIcon className="size-3 shrink-0 text-muted-foreground" />
                    {fmtDate(stats.maxDateKey)}
                  </>}
                </dd>
              </div>
            </dl>
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer">导出详情</summary>
              <dl className="qce-log-export-details">
                <dt>分块</dt><dd>{manifest.chunks.length} × {manifest.chunking.maxMessagesPerChunk.toLocaleString()}</dd>
                <dt>已加载分块</dt><dd>{loadedChunks}</dd>
                <dt>导出时间</dt><dd>{new Date(manifest.exportTime).toLocaleDateString('zh-CN')}</dd>
              </dl>
            </details>

            <div className="mt-5">
              <div className="font-medium text-muted-foreground text-xs">搜索</div>
              <InputGroup className="mt-2 w-full">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  size="sm"
                  type="search"
                  placeholder="搜索消息"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runSearch();
                  }}
                />
                {searching ? (
                  <InputGroupAddon align="inline-end">
                    <Loader className="text-muted-foreground" />
                  </InputGroupAddon>
                ) : null}
              </InputGroup>
              <div className="mt-2 flex items-center gap-1.5">
                <Button size="sm" onClick={runSearch}>
                  搜索
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="上一条"
                  disabled={!canNav}
                  onClick={() => jumpToMatch((searchRef.current?.cursor ?? 0) - 1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="下一条"
                  disabled={!canNav}
                  onClick={() => jumpToMatch((searchRef.current?.cursor ?? 0) + 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="清除搜索"
                  disabled={!canClear}
                  onClick={() => {
                    setQuery('');
                    resetSearch();
                  }}
                >
                  <XIcon />
                </Button>
              </div>
              {searchStatus ? (
                <div className="mt-2 text-muted-foreground text-xs">{searchStatus}</div>
              ) : null}
            </div>

            <div className="mt-8">
              <div className="font-medium text-muted-foreground text-xs">筛选</div>
              <Select
                value={filters.sender}
                onValueChange={(v) => applyFilters({ ...filtersRef.current, sender: v ?? '' })}
              >
                <SelectTrigger size="sm" className="mt-2 w-full">
                  <SelectValue>
                    {senderName ? (
                      <span className="flex items-center gap-2">
                        <SenderDot name={senderName} avatar={senderEntry?.avatar ?? undefined} />
                        {senderName}
                      </span>
                    ) : (
                      '全部成员'
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="">全部成员</SelectItem>
                  {manifest.senders
                    .filter((sd) => sd.uid && sd.uid !== '未知' && sd.displayName !== '0')
                    .map((sd) => (
                    <SelectItem key={sd.uid} value={sd.uid}>
                      <span className="flex items-center gap-2">
                        <SenderDot name={sd.displayName} avatar={sd.avatar ?? undefined} />
                        <span className="max-w-40 truncate">{roleAlias(sd, manifest, review.progress.roles) ?? sd.displayName}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Select
                value={filters.kind}
                onValueChange={(v) => applyFilters({ ...filtersRef.current, kind: v ?? '' })}
              >
                <SelectTrigger size="sm" className="mt-2 w-full">
                  <SelectValue>
                    {KIND_OPTIONS.find(([k]) => k === filters.kind)?.[1] ?? '全部类型'}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="">
                    <span className="flex items-center gap-2">
                      <LayersIcon className="size-3.5 text-muted-foreground" />
                      全部类型
                    </span>
                  </SelectItem>
                  {KIND_OPTIONS.map(([k, label, Icon]) => (
                    <SelectItem key={k} value={k}>
                      <span className="flex items-center gap-2">
                        <Icon className="size-3.5 text-muted-foreground" />
                        {label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <DateRangePicker
                className="mt-2"
                startTime={dateStart}
                endTime={dateEnd}
                placeholder="全部日期"
                defaultMonth={stats.minDateKey ? new Date(`${stats.minDateKey}T00:00:00`) : undefined}
                onChange={(s, e) => {
                  setDateStart(s);
                  setDateEnd(e);
                  applyFilters({
                    ...filtersRef.current,
                    startMs: s ? new Date(s).getTime() : 0,
                    endMs: e ? new Date(e).getTime() + 59_999 : 0,
                  });
                }}
              />
              {filterStatus ? (
                <div className="mt-2 text-muted-foreground text-xs">{filterStatus}</div>
              ) : null}
            </div>
          </>
        ) : null}

        {activeRecording && <LogSources recordings={recordings} active={activeRecording} busy={importing}
          status={recordingStatus} onOpen={openRecording}
          onRename={(key, name) => { if (name.trim()) updateRecording(key, { label: name.trim() }); }}
          onInclude={(key, included) => updateRecording(key, { included })}
          onImport={(files, folder) => void importRecordings(files, folder)} />}

        {manifest && manifest.senders.length > 0 && <details className="qce-log-roles mt-5 text-xs">
          <summary className="cursor-pointer font-medium">角色管理</summary>
          <select aria-label="选择角色账号" value={roleSender} onChange={event => setRoleSender(event.target.value)}>
            <option value="">选择发言者</option>
            {manifest.senders.map(sender => <option key={sender.uid} value={sender.uid}>{sender.displayName}{review.progress.roles[roleKey(sender, manifest)] ? ` · ${review.progress.roles[roleKey(sender, manifest)]}` : ''}</option>)}
          </select>
          {selectedRole && <input key={`${selectedRoleKey}:${review.progress.roles[selectedRoleKey] ?? ''}`} aria-label="角色名" placeholder={selectedRole.displayName} maxLength={80}
            defaultValue={review.progress.roles[selectedRoleKey] ?? ''} onBlur={event => review.renameRole(selectedRoleKey, event.currentTarget.value)}
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />}
        </details>}

        {chapters.length > 0 && <details className="mt-4 text-xs">
          <summary className="cursor-pointer font-medium">章节／回合</summary>
          <table className="qce-log-chapters">
            <thead><tr><th>名称</th><th>消息</th></tr></thead>
            <tbody>{chapters.map(([chapter, count]) => <tr key={chapter}>
              <td><button type="button" onClick={() => { review.jumpChapter(chapter); setSidebarOpen(false); }}>{chapter}</button></td>
              <td>{count}</td>
            </tr>)}</tbody>
          </table>
        </details>}
        {stats && stats.totalMessages > 0 && <details className="mt-4 text-xs">
          <summary className="cursor-pointer font-medium">整理进度</summary>
          <div className="mt-2 flex flex-wrap gap-1">
            <Button variant="outline" size="sm" disabled={review.busy} onClick={review.saveProgress}>备份进度</Button>
            <Button variant="outline" size="sm" disabled={review.busy} onClick={() => progressFileRef.current?.click()}>恢复进度</Button>
            <input ref={progressFileRef} type="file" aria-label="整理进度文件" accept=".qcelog" hidden onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) {
                setSidebarOpen(false);
                void review.openProgress(file);
              }
            }} />
          </div>
        </details>}

        <div className="mt-auto space-y-2 pt-5 text-muted-foreground text-xs">
          <div className="flex items-center justify-between gap-1.5">
            <a
              href={QCE_REPO}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 hover:text-foreground"
            >
              <GithubMark className="size-3.5" />
              shuakami/qq-chat-exporter
            </a>
            <span className="flex items-center">
              <button
                type="button"
                aria-label="设置"
                className="flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={dark ? '切换到浅色模式' : '切换到深色模式'}
                className="flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setDark((v) => !v)}
              >
                {dark ? <SunIcon className="size-3.5" /> : <MoonIcon className="size-3.5" />}
              </button>
            </span>
          </div>
          {manifest?.exporter?.version ? (
            <span className="flex items-center gap-1.5">
              <RustMark className="size-3.5" />
              exporter v{manifest.exporter.version.replace(/^v/, '')}
            </span>
          ) : null}
          <a
            href={HS_REPO}
            target="_blank"
            rel="noreferrer"
            className="block hover:text-foreground"
          >
            QCE Viewer powered by <span className="italic">HyperScroll</span>
          </a>
        </div>
        </div>
      </aside>

      <button
        type="button"
        aria-label="关闭侧栏"
        className="qce-log-sidebar-overlay absolute inset-0 z-20 bg-black/20 md:hidden"
        disabled={sidebarOnDesktop || !sidebarExpanded}
        tabIndex={-1}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Main */}
      <div className="qce-log-main relative flex min-w-0 flex-1 flex-col">
        <header className="qce-log-top">
          <Button className="qce-log-chrome" variant="ghost" size="icon-sm" aria-label="切换侧栏" aria-controls="qce-viewer-sidebar" aria-expanded={sidebarExpanded} onClick={() => {
            if (sidebarOnDesktop) {
              preserveReadingPosition();
              setSidebarCollapsed(value => !value);
            } else setSidebarOpen(value => !value);
          }}><PanelLeftIcon /></Button>
          <span className="qce-log-title" aria-hidden={sidebarOnDesktop && sidebarExpanded}>{label}</span>
          {manifest && <span className="qce-log-count qce-log-chrome" aria-live="polite">已审 {reviewedCount.toLocaleString()} / {reviewTotal.toLocaleString()}</span>}
          <select className="qce-log-layout qce-log-chrome rounded border px-1.5 py-1 text-xs" aria-label="分屏布局" value={layout}
            onChange={event => {
              if (layout === 'single' && activeRecording) setCompareKey(recordings.find(item => item.key !== activeRecording.key)?.key ?? activeRecording.key);
              if (event.currentTarget.value === 'single') activateReviewPane('main');
              setLayout(event.currentTarget.value as typeof layout);
            }}>
            <option value="single">单窗</option>
            <option value="horizontal">左右分屏</option>
            <option value="vertical">上下分屏</option>
          </select>
          <Button className="qce-log-chrome" variant="outline" size="sm" disabled={review.busy || !canDraft}
            aria-pressed={draftOpen && draftMode === 'preview'}
            onClick={() => draftOpen && draftMode === 'preview' ? closeDraft() : openDraft('preview')}>成稿预览</Button>
          <Button className="qce-log-chrome" variant="outline" size="sm" disabled={review.busy || !canDraft}
            aria-haspopup="dialog" onClick={() => openDraft('full')}>完整成稿</Button>
          <Button variant={flowMode ? 'secondary' : 'ghost'} size="sm" aria-pressed={flowMode} onClick={toggleFlowMode}>
            {flowMode ? '退出心流' : '心流'}
          </Button>
        </header>

        <div className={`qce-log-panes qce-log-panes-${layout}`}>
        <div className="qce-log-reading relative min-h-0 min-w-0">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background to-transparent" />
          <div
            id="viewport"
            ref={viewportRef}
            className={`qce-viewport h-full${review.rangeMode && reviewPane === 'main' ? ' qce-log-range' : ''}`}
            tabIndex={0}
            onFocus={() => activateReviewPane('main')}
            onClick={event => onViewportClick(event)}
            onKeyDown={event => onViewportKeyDown(event)}
            onPointerDown={event => {
              if (event.button === 0) activateReviewPane('main');
              review.pointerDown(event);
            }}
            onPointerMove={review.pointerMove}
            onPointerUp={review.pointerEnd}
            onPointerCancel={review.pointerEnd}
            onPointerLeave={review.pointerEnd}
          />
          {replyReturnId ? (
            <button
              type="button"
              className="absolute bottom-6 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1 border-0 bg-transparent p-1 text-muted-foreground text-xs shadow-none hover:text-foreground"
              onClick={() => {
                const msgId = replyReturnId;
                clearReplyReturn();
                void jumpToMessageId(msgId);
              }}
            >
              <ReplyIcon className="size-3.5" />
              <span>回到消息</span>
            </button>
          ) : null}
        </div>
        {layout !== 'single' && comparison && <LogCompare recordings={recordings} recording={comparison}
          engine={compareEngineRef} view={compareViewportRef}
          decorate={(index, row, html) => review.decorate(index, row, html, comparison.store.manifest, reviewTarget.current === compareTarget)}
          rangeMode={review.rangeMode && reviewPane === 'compare'}
          onChoose={key => {
            if (reviewPane === 'compare') activateReviewPane('compare', recordings.find(recording => recording.key === key));
            setCompareKey(key);
          }} onOpen={index => openRecording(comparison.key, index)} onClick={onViewportClick}
          onActivate={() => activateReviewPane('compare')} onSelect={review.selectRow} onKeyDown={onViewportKeyDown}
          onPointerDown={review.pointerDown} onPointerMove={review.pointerMove} onPointerEnd={review.pointerEnd}
          findMessage={id => findMessageIndex(comparison.store, id)} />}
        </div>
        {review.edit && <form className="qce-log-edit" onSubmit={event => {
          event.preventDefault();
          if (review.edit?.text.trim()) review.decide('keep', review.edit);
        }}>
          <label htmlFor="qce-log-edit-text">编辑第 {review.edit.index + 1} 条</label>
          <textarea id="qce-log-edit-text" value={review.edit.text} autoFocus onChange={event => {
            if (review.edit) review.setEdit({ ...review.edit, text: event.target.value });
          }} onKeyDown={event => {
            if (event.key === 'Escape') review.cancelEdit();
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && review.edit?.text.trim()) {
              event.preventDefault();
              review.decide('keep', review.edit);
            }
          }} />
          <div className="qce-log-edit-actions">
            <Button type="button" size="sm" variant="ghost" onClick={review.cancelEdit}>取消</Button>
            <Button type="submit" size="sm" disabled={!review.edit.text.trim()}>确认并继续</Button>
          </div>
        </form>}
        {!review.edit && <footer className="qce-log-tools">
          <div className="qce-log-tool-group">
            {layout !== 'single' && <span className="qce-log-active-pane" aria-live="polite">审阅{reviewPane === 'compare' ? '对照窗' : '主窗'}</span>}
            <Button size="sm" disabled={review.busy || !reviewTotal} onClick={() => review.decide('keep')}>保留 <kbd>A</kbd></Button>
            <Button size="sm" variant="outline" disabled={review.busy || !reviewTotal} onClick={() => review.decide('exclude')}>
              {review.selected.size > 0 ? '排除所选' : '排除'} <kbd>S</kbd>
            </Button>
            <Button size="sm" variant="outline" disabled={review.busy || !reviewTotal} onClick={() => void review.beginEdit()}>编辑 <kbd>E</kbd></Button>
            <Button size="sm" variant="ghost" disabled={!review.canUndo || review.busy} onClick={review.undo}>撤销</Button>
          </div>
          <div className="qce-log-tool-group">
            <Button size="sm" variant="ghost" className="qce-log-touch" aria-pressed={review.rangeMode} onClick={() => review.setRangeMode(!review.rangeMode)}>选择范围</Button>
            {review.selected.size > 0 && <>
              <span aria-live="polite">已选 {review.selected.size} 条</span>
              <Button size="sm" variant="ghost" onClick={review.clearSelection}>取消选择</Button>
            </>}
            <label><input type="checkbox" checked={review.autoChapter} onChange={event => review.setAutoChapter(event.target.checked)} /> 当前整理</label>
            <input aria-label="章节或回合" placeholder="章节／回合" maxLength={60} value={review.chapter} onChange={event => review.setChapter(event.target.value)} />
            {review.selected.size > 0 && <Button size="sm" variant="outline" disabled={!review.chapter.trim()} onClick={review.assign}>归入</Button>}
          </div>
        </footer>}
        {review.status && <p className="qce-log-status" role="status">{review.status}</p>}
        {review.draft && <LogDraft draft={review.draft} full={draftMode === 'full'} onOpenFull={() => openDraft('full')}
          canUndoDelete={lastDraftDeletion.length > 0}
          onDelete={entries => {
            const removed = review.setDraftDecisions(recordings, entries, 'exclude');
            if (removed.length) setLastDraftDeletion(removed);
          }} onUndoDelete={() => {
            review.setDraftDecisions(recordings, lastDraftDeletion, 'keep');
            setLastDraftDeletion([]);
          }} onEdit={(entry, text) => {
          const recording = recordings.find(item => item.key === entry.key);
          if (recording) review.editDraft(recording, entry, text);
        }} onLink={entries => {
          const recording = recordings.find(item => item.key === entries[0]?.key);
          if (recording) review.linkDraftEntries(recording, entries);
        }} onUnlink={entry => {
          const recording = recordings.find(item => item.key === entry.key);
          if (recording && entry.exchange !== undefined) review.unlinkDraftExchange(recording, entry.exchange);
        }} onExport={(format, options) => review.showDraft(recordings, draftTitle, format, options)} onClose={closeDraft} />}
      </div>

      <MediaPreview item={preview} onClose={() => setPreview(null)} />
      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

function SettingsToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/60"
      onClick={() => onChange(!checked)}
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
      </span>
      <span
        aria-hidden
        className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? 'bg-primary' : 'bg-muted-foreground/25'
        }`}
      >
        <span
          className={`size-4 rounded-full bg-background shadow transition-transform ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </span>
    </button>
  );
}

function SettingsDialog({
  open,
  settings,
  onChange,
  onClose,
}: {
  open: boolean;
  settings: QceSettings;
  onChange: (s: QceSettings) => void;
  onClose: () => void;
}): React.ReactElement | null {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      let raf2 = 0;
      const raf = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true));
      });
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', onKey);
      return () => {
        cancelAnimationFrame(raf);
        cancelAnimationFrame(raf2);
        window.removeEventListener('keydown', onKey);
      };
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(t);
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/45 transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="设置"
        className="w-[380px] max-w-[92vw] rounded-xl border bg-background shadow-xl"
        style={{
          transform: visible ? 'scale(1)' : 'scale(0.86)',
          opacity: visible ? 1 : 0,
          transition: 'transform 520ms cubic-bezier(0.34, 1.36, 0.44, 1), opacity 200ms ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <span className="text-sm font-medium">设置</span>
          <button
            type="button"
            aria-label="关闭"
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
        <div className="px-5 pt-3 pb-1 text-xs text-muted-foreground">实验性功能</div>
        <div className="flex flex-col divide-y divide-border/60 px-2 pb-3">
          <SettingsToggle
            label="记住滚动位置"
            hint="下次打开时回到上次阅读的位置"
            checked={settings.rememberScroll}
            onChange={(v) => onChange({ ...settings, rememberScroll: v })}
          />
          <SettingsToggle
            label="预加载相邻分块"
            hint="阅读时在后台提前加载附近的消息分块"
            checked={settings.prefetchChunks}
            onChange={(v) => onChange({ ...settings, prefetchChunks: v })}
          />
          <SettingsToggle
            label="显示群成员头衔"
            hint="显示消息发送者的群专属头衔徽章"
            checked={settings.showGroupMemberTitles}
            onChange={(v) => onChange({ ...settings, showGroupMemberTitles: v })}
          />
        </div>
      </div>
    </div>
  );
}
