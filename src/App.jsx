import React, { useState, useEffect, useRef } from 'react';
import {
  FileSpreadsheet, FileText, FileType, Folder, Link2, File as FileIcon,
  StickyNote, Trash2, X, GitBranch, Upload, Download, Eraser,
  ExternalLink, Paperclip, Save, Sparkles, Copy, Check,
  Image as ImageIcon, Share2, Home, Play, ChevronLeft, ChevronRight,
  ZoomIn, ZoomOut, Maximize2
} from 'lucide-react';
import LZString from 'lz-string';

const STORAGE_KEY = 'workflow-board-v1';
const VERSION = '1.9';
const URL_PARAM = 'd';
const URL_SAFE_LIMIT = 8000; // URLの実用上限（8KB目安）

const TYPES = {
  excel:  { Icon: FileSpreadsheet, color: '#1f7a3a', bg: '#eaf6ee', label: 'Excel' },
  word:   { Icon: FileText,        color: '#2b5797', bg: '#e8eef7', label: 'Word' },
  pdf:    { Icon: FileType,        color: '#a93226', bg: '#fbeae8', label: 'PDF' },
  folder: { Icon: Folder,          color: '#b88e1f', bg: '#faf2dc', label: 'フォルダ' },
  link:   { Icon: Link2,           color: '#5a4ba1', bg: '#ecebf7', label: 'リンク' },
  other:  { Icon: FileIcon,        color: '#555555', bg: '#efefef', label: 'その他' },
};

const detectType = (filename) => {
  const ext = (filename || '').toLowerCase().split('.').pop();
  if (['xlsx', 'xls', 'xlsm', 'csv', 'xlt'].includes(ext)) return 'excel';
  if (['docx', 'doc'].includes(ext)) return 'word';
  if (ext === 'pdf') return 'pdf';
  return 'other';
};

const uid = () => Math.random().toString(36).slice(2, 10);

// --- localStorage wrapper ---
const storage = {
  get(key) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? null : { value: v };
    } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore quota */ }
  },
};

// --- URL 共有用のシリアライズ／デシリアライズ ---
const toShareable = (cards, notes, connections) => {
  // id は name 参照に畳む、座標は四捨五入
  const idToName = {};
  cards.forEach(c => { idToName[c.id] = c.name; });
  return {
    v: 1,
    cards: cards.map(c => ({
      name: c.name, type: c.type, link: c.link || '',
      x: Math.round(c.x), y: Math.round(c.y)
    })),
    connections: connections
      .map(c => ({ from: idToName[c.from], to: idToName[c.to], label: c.label || '' }))
      .filter(c => c.from && c.to),
    notes: notes.map(n => ({
      text: n.text || '',
      attachTo: n.attachedTo ? idToName[n.attachedTo] : undefined,
      x: Math.round(n.x), y: Math.round(n.y)
    })),
  };
};

const encodeStateToUrlParam = (cards, notes, connections) => {
  const payload = toShareable(cards, notes, connections);
  return LZString.compressToEncodedURIComponent(JSON.stringify(payload));
};

const decodeUrlParam = (param) => {
  try {
    const json = LZString.decompressFromEncodedURIComponent(param);
    if (!json) return null;
    return JSON.parse(json);
  } catch { return null; }
};

const makeNewBoard = (name, seed = {}) => ({
  id: uid(),
  name: name || 'ページ1',
  cards: seed.cards || [],
  notes: seed.notes || [],
  connections: seed.connections || [],
});

export default function App() {
  // 複数ページ対応：boards配列と、現在アクティブなページのID
  const [boards, setBoards] = useState(() => [makeNewBoard('ページ1')]);
  const [activeBoardId, setActiveBoardId] = useState(() => null);

  // 派生値：active board とそのcards/notes/connections
  const activeBoard = boards.find(b => b.id === activeBoardId) || boards[0];
  const cards = activeBoard.cards;
  const notes = activeBoard.notes;
  const connections = activeBoard.connections;

  // setter: active board に書き込むラッパー（既存のコードが setCards/setNotes/setConnections を使うため互換保持）
  const setCards = (updater) => setBoards(bs => bs.map(b =>
    b.id === activeBoard.id
      ? { ...b, cards: typeof updater === 'function' ? updater(b.cards) : updater }
      : b));
  const setNotes = (updater) => setBoards(bs => bs.map(b =>
    b.id === activeBoard.id
      ? { ...b, notes: typeof updater === 'function' ? updater(b.notes) : updater }
      : b));
  const setConnections = (updater) => setBoards(bs => bs.map(b =>
    b.id === activeBoard.id
      ? { ...b, connections: typeof updater === 'function' ? updater(b.connections) : updater }
      : b));

  const [selected, setSelected] = useState(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [jsonModal, setJsonModal] = useState(null); // 'paste' | 'copy' | 'share' | null
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [jsonMode, setJsonMode] = useState('add');
  const [copyDone, setCopyDone] = useState(false);
  const [sharedBannerUrl, setSharedBannerUrl] = useState(null); // 共有URLから読み込んだとき
  const [shareInfo, setShareInfo] = useState(null); // { url, length, overLimit }
  // スライドショー再生状態: null | { phase: 'overview'|'detail', step: number, order: string[] }
  const [slideshow, setSlideshow] = useState(null);
  // キャンバスのズーム倍率（0.3〜2.0）
  const [zoom, setZoom] = useState(1);

  const scrollRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const importInputRef = useRef(null);
  const dragState = useRef(null);
  const panMovedRef = useRef(false); // パンでドラッグしたかどうか（直後のonClick抑止用）
  const cardsRef = useRef(cards);
  const notesRef = useRef(notes);

  useEffect(() => { cardsRef.current = cards; }, [cards]);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  // --- Load from URL or storage on mount ---
  useEffect(() => {
    // 1) localStorage から既存のboards（または旧形式）を読み込む
    let loadedBoards = null;
    const r = storage.get(STORAGE_KEY);
    if (r && r.value) {
      try {
        const d = JSON.parse(r.value);
        if (Array.isArray(d.boards) && d.boards.length > 0) {
          // 新形式
          loadedBoards = d.boards;
        } else if (Array.isArray(d.cards)) {
          // 旧形式 → ページ1にラップして移行
          loadedBoards = [makeNewBoard('ページ1', { cards: d.cards, notes: d.notes, connections: d.connections })];
        }
      } catch { /* ignore */ }
    }
    if (!loadedBoards || loadedBoards.length === 0) {
      loadedBoards = [makeNewBoard('ページ1')];
    }
    let loadedActiveId = (r && r.value && (() => { try { return JSON.parse(r.value).activeBoardId; } catch { return null; } })()) || loadedBoards[0].id;
    if (!loadedBoards.find(b => b.id === loadedActiveId)) loadedActiveId = loadedBoards[0].id;

    // 2) URL 共有データがあれば「新しいページ」として追加
    const params = new URLSearchParams(window.location.search);
    const shared = params.get(URL_PARAM);
    if (shared) {
      const data = decodeUrlParam(shared);
      if (data && Array.isArray(data.cards)) {
        const ok = window.confirm(
          '共有された盤面があります。\n「共有された盤面」という新しいページとして追加しますか？\n\n（キャンセルすると共有データは破棄してローカル盤面だけ開きます）'
        );
        if (ok) {
          const sharedBoard = importDataToNewBoard(data, '共有された盤面');
          loadedBoards = [...loadedBoards, sharedBoard];
          loadedActiveId = sharedBoard.id;
          setSharedBannerUrl(window.location.href);
        }
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
    setBoards(loadedBoards);
    setActiveBoardId(loadedActiveId);
    setLoaded(true);
  }, []);

  // --- Auto-save (debounced) ---
  useEffect(() => {
    if (!loaded) return;
    setSaveStatus('保存中');
    const t = setTimeout(() => {
      storage.set(STORAGE_KEY, JSON.stringify({
        version: 2,
        boards,
        activeBoardId,
      }));
      setSaveStatus('保存済');
      setTimeout(() => setSaveStatus(''), 1200);
    }, 500);
    return () => clearTimeout(t);
  }, [boards, activeBoardId, loaded]);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      const editing = tag === 'INPUT' || tag === 'TEXTAREA';
      // スライドショー中はこちらが優先
      if (slideshow && !editing) {
        if (e.key === ' ' || e.key === 'ArrowRight') {
          e.preventDefault(); slideshowNext(); return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault(); slideshowPrev(); return;
        }
        if (e.key === 'Escape') {
          e.preventDefault(); endSlideshow(); return;
        }
      }
      if (e.key === 'Escape') {
        setConnectMode(false);
        setConnectFrom(null);
        setEditingNoteId(null);
        if (!editing) setSelected(null);
      }
      if (!editing && (e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        deleteSelected();
      }
      if (!editing) {
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); return; }
        if (e.key === '-') { e.preventDefault(); zoomOut(); return; }
        if (e.key === '0') { e.preventDefault(); zoomReset(); return; }
        if (e.key === 'f' || e.key === 'F') { e.preventDefault(); zoomFit(); return; }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, slideshow, zoom, cards, notes]);

  // --- Auto-scroll to current slideshow card ---
  useEffect(() => {
    if (!slideshow || !scrollRef.current) return;
    const currentId = slideshow.order[slideshow.step];
    const card = cardsRef.current.find(c => c.id === currentId);
    if (!card) return;
    const s = scrollRef.current;
    const targetX = card.x * zoom - s.clientWidth / 2 + 100 * zoom;
    const targetY = card.y * zoom - s.clientHeight / 2 + 40 * zoom;
    s.scrollTo({
      left: Math.max(0, targetX),
      top: Math.max(0, targetY),
      behavior: 'smooth'
    });
  }, [slideshow?.phase, slideshow?.step]);

  // --- Helpers ---
  const viewportCenter = () => {
    const s = scrollRef.current;
    if (!s) return { x: 300, y: 200 };
    return {
      x: s.scrollLeft + s.clientWidth / 2 - 100,
      y: s.scrollTop + s.clientHeight / 2 - 60,
    };
  };

  const updateCard = (id, patch) => setCards(c => c.map(x => x.id === id ? { ...x, ...patch } : x));
  const updateNote = (id, patch) => setNotes(n => n.map(x => x.id === id ? { ...x, ...patch } : x));
  const updateConn = (id, patch) => setConnections(cs => cs.map(x => x.id === id ? { ...x, ...patch } : x));

  // --- Add ---
  const addCard = (type, x, y, name = '', link = '') => {
    const pos = (x == null || y == null) ? viewportCenter() : { x, y };
    pos.x += cards.length * 12 % 60;
    pos.y += cards.length * 12 % 60;
    const id = uid();
    setCards(c => [...c, {
      id, type,
      x: pos.x, y: pos.y,
      name: name || `${TYPES[type].label} ${c.length + 1}`,
      link
    }]);
    setSelected({ kind: 'card', id });
  };

  const addNote = () => {
    const pos = viewportCenter();
    const id = uid();
    const attachedTo = selected?.kind === 'card' ? selected.id : null;
    let nx = pos.x + 30, ny = pos.y + 30;
    if (attachedTo) {
      const c = cardsRef.current.find(c => c.id === attachedTo);
      if (c) { nx = c.x + 220; ny = c.y; }
    }
    setNotes(n => [...n, {
      id, x: nx, y: ny,
      text: '', attachedTo
    }]);
    setSelected({ kind: 'note', id });
    setEditingNoteId(id);
  };

  // --- Delete ---
  const deleteCard = (id) => {
    setCards(c => c.filter(x => x.id !== id));
    setConnections(cs => cs.filter(c => c.from !== id && c.to !== id));
    setNotes(n => n.map(x => x.attachedTo === id ? { ...x, attachedTo: null } : x));
    setSelected(null);
  };
  const deleteNote = (id) => { setNotes(n => n.filter(x => x.id !== id)); setSelected(null); };
  const deleteConn = (id) => { setConnections(cs => cs.filter(x => x.id !== id)); setSelected(null); };
  const deleteSelected = () => {
    if (!selected) return;
    if (selected.kind === 'card') deleteCard(selected.id);
    else if (selected.kind === 'note') deleteNote(selected.id);
    else if (selected.kind === 'connection') deleteConn(selected.id);
  };

  // --- Drag ---
  const startDrag = (e, kind, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (connectMode && kind === 'card') {
      handleConnectClick(id);
      return;
    }
    setSelected({ kind, id });
    const item = kind === 'card'
      ? cardsRef.current.find(c => c.id === id)
      : notesRef.current.find(n => n.id === id);
    if (!item) return;

    const attachedNotes = kind === 'card'
      ? notesRef.current.filter(n => n.attachedTo === id).map(n => ({ id: n.id, ox: n.x, oy: n.y }))
      : [];

    dragState.current = {
      kind, id,
      sx: e.clientX, sy: e.clientY,
      ox: item.x, oy: item.y,
      attachedNotes, moved: false, startTime: Date.now()
    };

    const onMove = (ev) => {
      const ds = dragState.current; if (!ds) return;
      const dx = (ev.clientX - ds.sx) / zoom;
      const dy = (ev.clientY - ds.sy) / zoom;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) ds.moved = true;
      if (ds.kind === 'card') {
        updateCard(ds.id, { x: ds.ox + dx, y: ds.oy + dy });
        ds.attachedNotes.forEach(an => updateNote(an.id, { x: an.ox + dx, y: an.oy + dy }));
      } else {
        updateNote(ds.id, { x: ds.ox + dx, y: ds.oy + dy });
      }
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // --- Connect ---
  const handleConnectClick = (cardId) => {
    if (!connectFrom) {
      setConnectFrom(cardId);
    } else if (connectFrom === cardId) {
      setConnectFrom(null);
    } else {
      const exists = connections.find(c => c.from === connectFrom && c.to === cardId);
      if (!exists) {
        setConnections(cs => [...cs, { id: uid(), from: connectFrom, to: cardId, label: '' }]);
      }
      setConnectFrom(null);
      setConnectMode(false);
    }
  };

  // --- Open link ---
  const openLink = (link) => {
    if (!link) return;
    let url = link.trim();
    if (!/^(https?:|file:|mailto:)/.test(url)) {
      if (/^[\w.-]+\.[a-z]{2,}/i.test(url)) url = 'https://' + url;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // --- File upload / drop ---
  const handleFiles = (files, basePos = null) => {
    const pos = basePos || viewportCenter();
    Array.from(files).forEach((f, i) => {
      const id = uid();
      const card = {
        id, type: detectType(f.name),
        x: pos.x + (i % 4) * 220,
        y: pos.y + Math.floor(i / 4) * 110,
        name: f.name, link: f.name
      };
      setCards(c => [...c, card]);
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (!e.dataTransfer.files?.length) return;
    const rect = canvasRef.current.getBoundingClientRect();
    handleFiles(e.dataTransfer.files, {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
    });
  };

  // --- Board (page) management ---
  const switchBoard = (id) => {
    if (id === activeBoardId) return;
    setActiveBoardId(id);
    setSelected(null);
    setConnectMode(false);
    setConnectFrom(null);
    setEditingNoteId(null);
    setSlideshow(null);
  };

  const addBoard = () => {
    const newBoard = makeNewBoard(`ページ${boards.length + 1}`);
    setBoards(bs => [...bs, newBoard]);
    switchBoard(newBoard.id);
  };

  const deleteBoard = (id) => {
    if (boards.length <= 1) {
      alert('最後のページは削除できません。');
      return;
    }
    const board = boards.find(b => b.id === id);
    if (!board) return;
    const hasContent = board.cards.length > 0 || board.notes.length > 0;
    const msg = hasContent
      ? `ページ「${board.name}」を削除します。\n（カード${board.cards.length}枚・メモ${board.notes.length}枚が失われます）`
      : `ページ「${board.name}」を削除します。`;
    if (!window.confirm(msg + '\nよろしいですか？')) return;
    setBoards(bs => bs.filter(b => b.id !== id));
    if (id === activeBoardId) {
      const remaining = boards.filter(b => b.id !== id);
      setActiveBoardId(remaining[0].id);
      setSelected(null);
    }
  };

  const renameBoard = (id) => {
    const board = boards.find(b => b.id === id);
    if (!board) return;
    const name = window.prompt('ページ名', board.name);
    if (name && name.trim()) {
      setBoards(bs => bs.map(b => b.id === id ? { ...b, name: name.trim() } : b));
    }
  };

  // URL共有データから新しいboardを作る（applyImportDataDirectと近いが、stateに直接書き込まない）
  const importDataToNewBoard = (data, boardName = '共有された盤面') => {
    const inputCards = data.cards || [];
    const inputConns = data.connections || [];
    const inputNotes = data.notes || [];
    const needsLayout = inputCards.some(c => c.x === undefined || c.y === undefined);
    const positions = needsLayout ? autoLayout(inputCards, inputConns, 100, 80) : {};
    const nameToId = {};
    const newCards = inputCards.map((c, i) => {
      const id = uid();
      nameToId[c.name] = id;
      const pos = (c.x !== undefined && c.y !== undefined)
        ? { x: c.x, y: c.y }
        : positions[c.name] || { x: 100 + i * 30, y: 80 + i * 30 };
      return { id, name: c.name || `カード${i + 1}`, type: c.type || 'other', link: c.link || '', x: pos.x, y: pos.y };
    });
    const newConnections = inputConns
      .filter(conn => nameToId[conn.from] && nameToId[conn.to])
      .map(conn => ({ id: uid(), from: nameToId[conn.from], to: nameToId[conn.to], label: conn.label || '' }));
    const newNotes = inputNotes.map((n, i) => {
      const attachedTo = (n.attachTo || n.attachedTo) ? nameToId[n.attachTo || n.attachedTo] || null : null;
      let nx, ny;
      if (n.x !== undefined && n.y !== undefined) { nx = n.x; ny = n.y; }
      else if (attachedTo) { const card = newCards.find(c => c.id === attachedTo); nx = card.x + 220; ny = card.y; }
      else { nx = 100 + (i % 4) * 200; ny = 600 + Math.floor(i / 4) * 100; }
      return { id: uid(), text: n.text || '', attachedTo, x: nx, y: ny };
    });
    return { id: uid(), name: boardName, cards: newCards, notes: newNotes, connections: newConnections };
  };

  // --- Auto-layout ---
  const autoLayout = (newCards, newConnections, startX = 100, startY = 80) => {
    const incoming = {}, outgoing = {};
    newCards.forEach(c => { incoming[c.name] = []; outgoing[c.name] = []; });
    newConnections.forEach(conn => {
      if (outgoing[conn.from] !== undefined) outgoing[conn.from].push(conn.to);
      if (incoming[conn.to] !== undefined) incoming[conn.to].push(conn.from);
    });
    const depth = {};
    const roots = newCards.filter(c => incoming[c.name].length === 0).map(c => c.name);
    const queue = roots.map(r => ({ name: r, d: 0 }));
    while (queue.length) {
      const { name, d } = queue.shift();
      if (depth[name] !== undefined && depth[name] >= d) continue;
      depth[name] = d;
      (outgoing[name] || []).forEach(child => queue.push({ name: child, d: d + 1 }));
    }
    newCards.forEach(c => { if (depth[c.name] === undefined) depth[c.name] = 0; });
    const levels = {};
    newCards.forEach(c => {
      const d = depth[c.name];
      if (!levels[d]) levels[d] = [];
      levels[d].push(c.name);
    });
    const positions = {};
    const X_SPACING = 280, Y_SPACING = 120;
    Object.keys(levels).sort((a, b) => +a - +b).forEach(d => {
      levels[d].forEach((name, i) => {
        positions[name] = {
          x: startX + parseInt(d) * X_SPACING,
          y: startY + i * Y_SPACING
        };
      });
    });
    return positions;
  };

  // --- Slideshow helpers ---
  const computeSlideshowOrder = (cardsArg, connsArg) => {
    const incoming = {}, outgoing = {};
    cardsArg.forEach(c => { incoming[c.id] = []; outgoing[c.id] = []; });
    connsArg.forEach(conn => {
      if (outgoing[conn.from] !== undefined) outgoing[conn.from].push(conn.to);
      if (incoming[conn.to] !== undefined) incoming[conn.to].push(conn.from);
    });
    const depth = {};
    const queue = cardsArg.filter(c => incoming[c.id].length === 0).map(c => {
      depth[c.id] = 0;
      return c.id;
    });
    while (queue.length) {
      const id = queue.shift();
      (outgoing[id] || []).forEach(childId => {
        const newDepth = depth[id] + 1;
        if (depth[childId] === undefined || depth[childId] < newDepth) {
          depth[childId] = newDepth;
          queue.push(childId);
        }
      });
    }
    cardsArg.forEach(c => { if (depth[c.id] === undefined) depth[c.id] = 0; });
    return cardsArg
      .slice()
      .sort((a, b) => (depth[a.id] - depth[b.id]) || (a.y - b.y) || (a.x - b.x))
      .map(c => c.id);
  };

  const startSlideshow = () => {
    if (cards.length === 0) {
      alert('盤面が空です。カードを追加してから再生してください。');
      return;
    }
    const order = computeSlideshowOrder(cards, connections);
    setSelected(null);
    // 再生前に全体フィットして、後続カードの登場が常に見えるようにする
    zoomFit();
    setSlideshow({ phase: 'overview', step: 0, order });
  };

  const endSlideshow = () => setSlideshow(null);

  const slideshowNext = () => {
    setSlideshow(s => {
      if (!s) return s;
      const total = s.order.length;
      if (s.phase === 'overview') {
        if (s.step < total - 1) return { ...s, step: s.step + 1 };
        return { ...s, phase: 'detail', step: 0 }; // フェーズ切替
      }
      if (s.step < total - 1) return { ...s, step: s.step + 1 };
      return null; // 最後で終了
    });
  };

  const slideshowPrev = () => {
    setSlideshow(s => {
      if (!s) return s;
      if (s.phase === 'detail') {
        if (s.step > 0) return { ...s, step: s.step - 1 };
        return { ...s, phase: 'overview', step: s.order.length - 1 };
      }
      if (s.step > 0) return { ...s, step: s.step - 1 };
      return s;
    });
  };

  // 表示状態の判定
  const slideCardState = (cardId) => {
    if (!slideshow) return null;
    const idx = slideshow.order.indexOf(cardId);
    if (idx === -1) return { visible: false, current: false, dim: false };
    if (slideshow.phase === 'overview') {
      return { visible: idx <= slideshow.step, current: idx === slideshow.step, dim: false };
    }
    return { visible: true, current: idx === slideshow.step, dim: idx !== slideshow.step };
  };

  const slideConnState = (conn) => {
    if (!slideshow) return null;
    const fromIdx = slideshow.order.indexOf(conn.from);
    const toIdx = slideshow.order.indexOf(conn.to);
    if (slideshow.phase === 'overview') {
      const visible = fromIdx <= slideshow.step && toIdx <= slideshow.step;
      const flowing = visible && toIdx === slideshow.step;
      return { visible, flowing, dim: false };
    }
    const currentId = slideshow.order[slideshow.step];
    const touches = conn.from === currentId || conn.to === currentId;
    return { visible: true, flowing: false, dim: !touches };
  };

  const slideNoteVisible = (note) => {
    if (!slideshow) return true;
    if (slideshow.phase === 'overview') return false;
    return note.attachedTo === slideshow.order[slideshow.step];
  };

  // --- Pan (drag empty area to move view) ---
  const handlePanMouseDown = (e) => {
    if (e.button !== 0) return;
    const t = e.target;
    // 空いている場所（scrollArea自身・wrapper・canvas）だけ対象
    const isEmpty = t === scrollRef.current
      || t === canvasRef.current
      || t?.dataset?.canvasWrapper === '1';
    if (!isEmpty) return;

    const s = scrollRef.current;
    const startX = e.clientX, startY = e.clientY;
    const startScrollLeft = s.scrollLeft, startScrollTop = s.scrollTop;
    let moved = false;

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        moved = true;
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      }
      if (moved) {
        s.scrollLeft = startScrollLeft - dx;
        s.scrollTop = startScrollTop - dy;
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      if (moved) panMovedRef.current = true;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // --- Zoom helpers ---
  const ZOOM_MIN = 0.3, ZOOM_MAX = 2.0, ZOOM_STEP = 0.1;
  const setZoomClamped = (z) => setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)));
  const zoomIn = () => setZoomClamped(Math.round((zoom + ZOOM_STEP) * 10) / 10);
  const zoomOut = () => setZoomClamped(Math.round((zoom - ZOOM_STEP) * 10) / 10);
  const zoomReset = () => setZoom(1);
  const zoomFit = () => {
    if (!scrollRef.current || cards.length === 0) return;
    const margin = 80;
    const CARD_W = 200, CARD_H = 80, NOTE_W = 160, NOTE_H = 80;
    const xs = [
      ...cards.map(c => c.x), ...cards.map(c => c.x + CARD_W),
      ...notes.map(n => n.x), ...notes.map(n => n.x + NOTE_W),
    ];
    const ys = [
      ...cards.map(c => c.y), ...cards.map(c => c.y + CARD_H),
      ...notes.map(n => n.y), ...notes.map(n => n.y + NOTE_H),
    ];
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const contentW = (maxX - minX) + margin * 2;
    const contentH = (maxY - minY) + margin * 2;
    const s = scrollRef.current;
    const fitZoom = Math.min(s.clientWidth / contentW, s.clientHeight / contentH, 1);
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitZoom));
    setZoom(newZoom);
    requestAnimationFrame(() => {
      s.scrollTo({
        left: Math.max(0, (minX - margin) * newZoom),
        top: Math.max(0, (minY - margin) * newZoom),
        behavior: 'smooth',
      });
    });
  };

  // --- Import: shared across URL-load, paste-modal, file-load ---
  const applyImportDataDirect = (data, mode = 'replace') => {
    if (!data || !Array.isArray(data.cards)) {
      throw new Error('cards 配列が必要です');
    }
    const inputCards = data.cards;
    const inputConns = data.connections || [];
    const inputNotes = data.notes || [];

    const needsLayout = inputCards.some(c => c.x === undefined || c.y === undefined);
    const xOffsetForMerge = (mode === 'add' && cardsRef.current.length > 0)
      ? Math.max(...cardsRef.current.map(c => c.x + 220)) + 80
      : 0;
    const positions = needsLayout
      ? autoLayout(inputCards, inputConns, 100 + xOffsetForMerge, 80)
      : {};

    const nameToId = {};
    const newCards = inputCards.map((c, i) => {
      const id = uid();
      nameToId[c.name] = id;
      const pos = (c.x !== undefined && c.y !== undefined)
        ? { x: c.x + xOffsetForMerge, y: c.y }
        : positions[c.name] || { x: 100 + xOffsetForMerge + (i * 30), y: 80 + (i * 30) };
      return {
        id,
        name: c.name || `カード${i + 1}`,
        type: c.type || 'other',
        link: c.link || '',
        x: pos.x,
        y: pos.y,
      };
    });

    const newConnections = inputConns
      .filter(conn => nameToId[conn.from] && nameToId[conn.to])
      .map(conn => ({
        id: uid(),
        from: nameToId[conn.from],
        to: nameToId[conn.to],
        label: conn.label || ''
      }));

    const newNotes = inputNotes.map((n, i) => {
      const attachedTo = (n.attachTo || n.attachedTo) ? nameToId[n.attachTo || n.attachedTo] || null : null;
      let nx, ny;
      if (n.x !== undefined && n.y !== undefined) {
        nx = n.x + xOffsetForMerge; ny = n.y;
      } else if (attachedTo) {
        const card = newCards.find(c => c.id === attachedTo);
        nx = card.x + 220; ny = card.y;
      } else {
        nx = 100 + xOffsetForMerge + (i % 4) * 200;
        ny = 600 + Math.floor(i / 4) * 100;
      }
      return {
        id: uid(),
        text: n.text || '',
        attachedTo,
        x: nx,
        y: ny
      };
    });

    if (mode === 'replace') {
      setCards(newCards);
      setNotes(newNotes);
      setConnections(newConnections);
    } else {
      setCards(c => [...c, ...newCards]);
      setNotes(n => [...n, ...newNotes]);
      setConnections(cs => [...cs, ...newConnections]);
    }
    setSelected(null);
    return { cards: newCards.length, notes: newNotes.length, connections: newConnections.length };
  };

  // --- JSON modal handlers ---
  const openJsonPaste = () => {
    setJsonText(''); setJsonError('');
    setJsonMode('add'); setJsonModal('paste');
  };

  const openJsonCopy = () => {
    const data = toShareable(cards, notes, connections);
    setJsonText(JSON.stringify(data, null, 2));
    setCopyDone(false);
    setJsonModal('copy');
  };

  // --- URL share ---
  const openShare = () => {
    if (cards.length === 0 && notes.length === 0) {
      alert('盤面が空です。何か追加してから共有してください。');
      return;
    }
    const encoded = encodeStateToUrlParam(cards, notes, connections);
    const base = `${window.location.origin}${window.location.pathname}`;
    const url = `${base}?${URL_PARAM}=${encoded}`;
    const overLimit = url.length > URL_SAFE_LIMIT;
    setShareInfo({ url, length: url.length, overLimit });
    setCopyDone(false);
    setJsonModal('share');
  };

  const copyShareUrl = async () => {
    if (!shareInfo) return;
    try {
      await navigator.clipboard.writeText(shareInfo.url);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 1500);
    } catch {
      setJsonError('クリップボードへのコピーに失敗しました');
    }
  };

  const submitJsonPaste = () => {
    try {
      const cleaned = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      const result = applyImportDataDirect(parsed, jsonMode);
      setJsonModal(null);
      setSaveStatus(`読込: カード${result.cards} 接続${result.connections} メモ${result.notes}`);
      setTimeout(() => setSaveStatus(''), 2500);
    } catch (err) {
      setJsonError(err.message || 'JSONの解析に失敗しました');
    }
  };

  const copyJsonToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 1500);
    } catch {
      setJsonError('クリップボードへのコピーに失敗しました');
    }
  };

  // --- Image export (SVG → PNG) ---
  const buildSvgExport = () => {
    if (cards.length === 0 && notes.length === 0) return null;
    const padding = 50;
    const cardW = 200, cardH = 80;
    const noteW = 160;
    const allItemsX = [
      ...cards.map(c => c.x), ...cards.map(c => c.x + cardW),
      ...notes.map(n => n.x), ...notes.map(n => n.x + noteW),
    ];
    const allItemsY = [
      ...cards.map(c => c.y), ...cards.map(c => c.y + cardH),
      ...notes.map(n => n.y), ...notes.map(n => n.y + 80),
    ];
    const minX = Math.min(...allItemsX) - padding;
    const minY = Math.min(...allItemsY) - padding;
    const maxX = Math.max(...allItemsX) + padding;
    const maxY = Math.max(...allItemsY) + padding;
    const w = Math.max(400, maxX - minX);
    const h = Math.max(300, maxY - minY);
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const attachLines = notes.filter(n => n.attachedTo).map(n => {
      const c = cards.find(c => c.id === n.attachedTo);
      if (!c) return '';
      const cx = c.x + cardW / 2 - minX;
      const cy = c.y + cardH / 2 - minY;
      const nx = n.x + 70 - minX;
      const ny = n.y + 20 - minY;
      return `<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="#b8941f" stroke-width="1" stroke-dasharray="3,3" opacity="0.45" />`;
    }).join('\n');

    const connSvg = connections.map(conn => {
      const from = cards.find(c => c.id === conn.from);
      const to = cards.find(c => c.id === conn.to);
      if (!from || !to) return '';
      const fc = { x: from.x + cardW / 2 - minX, y: from.y + cardH / 2 - minY };
      const tc = { x: to.x + cardW / 2 - minX, y: to.y + cardH / 2 - minY };
      const dx = tc.x - fc.x, dy = tc.y - fc.y;
      const tx = Math.abs(dx) > 1 ? Math.abs((cardW / 2) / dx) : Infinity;
      const ty = Math.abs(dy) > 1 ? Math.abs((cardH / 2) / dy) : Infinity;
      const t1 = Math.min(tx, ty);
      const p1 = { x: fc.x + dx * t1, y: fc.y + dy * t1 };
      const p2 = { x: tc.x - dx * t1, y: tc.y - dy * t1 };
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const labelW = (conn.label || '').length * 13 + 16;
      return `
        <line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#3a3a3a" stroke-width="1.6" marker-end="url(#arrow)" />
        ${conn.label ? `
        <rect x="${mid.x - labelW / 2}" y="${mid.y - 11}" width="${labelW}" height="20" fill="#fafaf6" stroke="#d4d4ce" rx="3" />
        <text x="${mid.x}" y="${mid.y + 4}" text-anchor="middle" font-size="12" fill="#222">${esc(conn.label)}</text>` : ''}
      `;
    }).join('\n');

    const cardSvg = cards.map(c => {
      const t = TYPES[c.type] || TYPES.other;
      const x = c.x - minX, y = c.y - minY;
      const truncName = c.name.length > 20 ? c.name.slice(0, 18) + '..' : c.name;
      const meta = t.label + (c.link ? ' · リンクあり' : '');
      return `
        <g>
          <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" fill="#ffffff" stroke="#dcdcd5" stroke-width="1.5" rx="6" />
          <rect x="${x}" y="${y}" width="${cardW}" height="4" fill="${t.color}" />
          <rect x="${x + 12}" y="${y + 22}" width="36" height="36" fill="${t.bg}" rx="6" />
          <text x="${x + 30}" y="${y + 45}" text-anchor="middle" font-size="14" font-weight="700" fill="${t.color}">${esc(t.label.slice(0, 1))}</text>
          <text x="${x + 60}" y="${y + 40}" font-size="13" font-weight="600" fill="#222">${esc(truncName)}</text>
          <text x="${x + 60}" y="${y + 56}" font-size="11" fill="#888">${esc(meta)}</text>
        </g>
      `;
    }).join('\n');

    const noteSvg = notes.map(n => {
      const x = n.x - minX, y = n.y - minY;
      const lines = (n.text || '(空メモ)').split('\n');
      const textElements = lines.map((line, i) =>
        `<text x="${x + 12}" y="${y + 22 + i * 18}" font-size="13" fill="#222">${esc(line)}</text>`
      ).join('\n');
      const noteH = Math.max(50, lines.length * 18 + 18);
      return `
        <g>
          <rect x="${x}" y="${y}" width="${noteW}" height="${noteH}" fill="#fef3a3" />
          ${textElements}
        </g>
      `;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#3a3a3a" />
    </marker>
  </defs>
  <rect width="${w}" height="${h}" fill="#fafaf6" />
  ${attachLines}
  ${connSvg}
  ${cardSvg}
  ${noteSvg}
</svg>`;
  };

  const exportSvg = () => {
    const svg = buildSvgExport();
    if (!svg) { alert('盤面が空です'); return; }
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-board-${new Date().toISOString().slice(0, 10)}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPng = () => {
    const svg = buildSvgExport();
    if (!svg) { alert('盤面が空です'); return; }
    const img = new Image();
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const wMatch = svg.match(/width="(\d+)"/);
      const hMatch = svg.match(/height="(\d+)"/);
      const w = wMatch ? parseInt(wMatch[1]) : img.width;
      const h = hMatch ? parseInt(hMatch[1]) : img.height;
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (!blob) { alert('PNG生成に失敗しました'); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `workflow-board-${new Date().toISOString().slice(0, 10)}.png`;
        a.click();
        URL.revokeObjectURL(url);
        URL.revokeObjectURL(svgUrl);
      }, 'image/png');
    };
    img.onerror = () => {
      alert('PNG生成に失敗しました（SVG読込エラー）');
      URL.revokeObjectURL(svgUrl);
    };
    img.src = svgUrl;
  };

  // --- Export / Import JSON file ---
  const exportJson = () => {
    const data = JSON.stringify({ version: VERSION, cards, notes, connections }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-board-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const d = JSON.parse(e.target.result);
        if (window.confirm('現在の盤面を読み込んだもので置き換えます。よろしいですか？')) {
          applyImportDataDirect(d, 'replace');
        }
      } catch {
        alert('読み込み失敗：JSONが不正です');
      }
    };
    reader.readAsText(file);
  };

  const reset = () => {
    if (window.confirm('全部消します。よろしいですか？\n（戻せません）')) {
      setCards([]); setNotes([]); setConnections([]); setSelected(null);
    }
  };

  // --- Connection geometry ---
  const cardCenter = (c) => ({ x: c.x + 100, y: c.y + 40 });
  const cardEdgePoint = (from, to) => {
    const c = cardCenter(from);
    const t = cardCenter(to);
    const dx = t.x - c.x, dy = t.y - c.y;
    const w = 100, h = 40;
    const tx = Math.abs(dx) > 1 ? Math.abs(w / dx) : Infinity;
    const ty = Math.abs(dy) > 1 ? Math.abs(h / dy) : Infinity;
    const t1 = Math.min(tx, ty);
    return { x: c.x + dx * t1, y: c.y + dy * t1 };
  };

  const selectedItem = (() => {
    if (!selected) return null;
    if (selected.kind === 'card') return { kind: 'card', item: cards.find(c => c.id === selected.id) };
    if (selected.kind === 'note') return { kind: 'note', item: notes.find(n => n.id === selected.id) };
    if (selected.kind === 'connection') return { kind: 'connection', item: connections.find(c => c.id === selected.id) };
    return null;
  })();

  return (
    <div style={styles.root}>
      <style>{globalCss}</style>

      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.title}>Workflow Board</div>
          <div style={styles.versionTag}>v{VERSION}</div>
        </div>

        <div style={styles.toolGroup}>
          {Object.entries(TYPES).map(([key, t]) => {
            const I = t.Icon;
            return (
              <button key={key} onClick={() => addCard(key)}
                style={{ ...styles.typeBtn, color: t.color }} title={`${t.label}を追加`}>
                <I size={16} /><span>{t.label}</span>
              </button>
            );
          })}
        </div>

        <div style={styles.toolGroup}>
          <button onClick={addNote} style={styles.actionBtn} title="付箋メモを追加">
            <StickyNote size={16} /> メモ
          </button>
          <button
            onClick={() => { setConnectMode(m => !m); setConnectFrom(null); }}
            style={{
              ...styles.actionBtn,
              background: connectMode ? '#2b5d6b' : '#fff',
              color: connectMode ? '#fff' : '#222',
              borderColor: connectMode ? '#2b5d6b' : '#d4d4ce'
            }}
            title="2つのカードをクリックして接続"
          >
            <GitBranch size={16} /> 接続{connectMode ? '中' : ''}
          </button>
          <button onClick={() => fileInputRef.current?.click()} style={styles.actionBtn} title="ファイルから一括登録">
            <Paperclip size={16} /> ファイル
          </button>
          <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
        </div>

        <div style={styles.toolGroup}>
          <button onClick={openJsonPaste} style={{ ...styles.actionBtn, color: '#5a4ba1', borderColor: '#c8c2e0' }} title="ChatでもらったJSONを貼り付けて生成">
            <Sparkles size={14} /> AI / JSON 取込
          </button>
          <button onClick={openJsonCopy} style={styles.actionBtn} title="現在の盤面をJSONテキストで取得（AIに渡す用）">
            <Copy size={14} /> JSON出力
          </button>
        </div>

        <div style={styles.toolGroup}>
          <button onClick={startSlideshow}
            style={{ ...styles.actionBtn, color: '#b8470a', borderColor: '#e6c8a8' }}
            title="業務フローをスライドショー再生（1枚ずつ・2フェーズ）">
            <Play size={14} /> 再生
          </button>
          <button onClick={openShare} style={{ ...styles.actionBtn, color: '#2b5d6b', borderColor: '#b6d1d7' }} title="盤面をURLに埋め込んで共有リンクを作成">
            <Share2 size={14} /> 共有リンク
          </button>
          <button onClick={exportPng} style={{ ...styles.actionBtn, color: '#1f7a3a', borderColor: '#c2dcc9' }} title="盤面をPNG画像で書き出し（クライアント共有用）">
            <ImageIcon size={14} /> PNG
          </button>
          <button onClick={exportSvg} style={styles.actionBtn} title="SVGで書き出し（拡大しても綺麗・編集可能）">
            <ImageIcon size={14} /> SVG
          </button>
        </div>

        <div style={styles.toolGroup}>
          <button onClick={exportJson} style={styles.actionBtn} title="盤面をJSONファイルでダウンロード">
            <Download size={14} /> 書出
          </button>
          <button onClick={() => importInputRef.current?.click()} style={styles.actionBtn} title="JSONファイルを読み込み（置き換え）">
            <Upload size={14} /> 読込
          </button>
          <input ref={importInputRef} type="file" accept="application/json" style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; }} />
          <button onClick={reset} style={{ ...styles.actionBtn, color: '#a93226' }} title="全消去">
            <Eraser size={14} />
          </button>
        </div>

        <div style={styles.saveStatus}>
          {saveStatus && <><Save size={12} /> {saveStatus}</>}
        </div>
      </header>

      {/* ページタブ */}
      <div style={styles.tabBar}>
        {boards.map((b) => {
          const isActive = b.id === activeBoardId;
          const itemCount = b.cards.length + b.notes.length;
          return (
            <div
              key={b.id}
              style={{ ...styles.tab, ...(isActive ? styles.tabActive : null) }}
              onClick={() => switchBoard(b.id)}
              onDoubleClick={() => renameBoard(b.id)}
              title="クリック: 切替 / ダブルクリック: 名前変更"
            >
              <span style={styles.tabName}>{b.name}</span>
              {itemCount > 0 && <span style={styles.tabCount}>{itemCount}</span>}
              {boards.length > 1 && (
                <button
                  style={styles.tabCloseBtn}
                  onClick={(e) => { e.stopPropagation(); deleteBoard(b.id); }}
                  title="このページを削除"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}
        <button onClick={addBoard} style={styles.tabAdd} title="新しいページを追加">+ 新規</button>
      </div>

      {sharedBannerUrl && (
        <div style={styles.sharedBanner}>
          <Home size={14} />
          共有URLから読み込んだ盤面を表示しています（以降の編集は自分のブラウザにのみ保存されます）
          <button style={styles.sharedBannerBtn} onClick={() => setSharedBannerUrl(null)}>
            <X size={12} /> 閉じる
          </button>
        </div>
      )}

      {connectMode && (
        <div style={styles.banner}>
          {connectFrom ? '接続先のカードをクリック（ESCでキャンセル）' : '接続元のカードをクリック'}
        </div>
      )}

      <main style={styles.main}>
        <div
          ref={scrollRef} style={styles.scrollArea}
          onMouseDown={handlePanMouseDown}
          onClick={(e) => {
            if (panMovedRef.current) { panMovedRef.current = false; return; }
            if (e.target === e.currentTarget
                || e.target === canvasRef.current
                || e.target?.dataset?.canvasWrapper === '1') {
              setSelected(null);
            }
          }}
        >
          <div
            data-canvas-wrapper="1"
            style={{
              width: 4000 * zoom,
              height: 3000 * zoom,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
          <div
            ref={canvasRef}
            style={{
              ...styles.canvas,
              position: 'absolute', top: 0, left: 0,
              transform: `scale(${zoom})`,
              transformOrigin: '0 0',
            }}
            onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}
          >
            <svg style={styles.svg} width="4000" height="3000">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#3a3a3a" />
                </marker>
                <marker id="arrowSel" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#2b5d6b" />
                </marker>
                <marker id="arrowFlow" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#b8470a" />
                </marker>
              </defs>
              {notes.filter(n => n.attachedTo).map(n => {
                const c = cards.find(c => c.id === n.attachedTo);
                if (!c) return null;
                // スライドショー中はメモ線は対象メモと一緒に見え隠れ
                if (slideshow && !slideNoteVisible(n)) return null;
                const cc = cardCenter(c);
                const nc = { x: n.x + 70, y: n.y + 20 };
                return (
                  <line key={`attach-${n.id}`}
                    x1={cc.x} y1={cc.y} x2={nc.x} y2={nc.y}
                    stroke="#b8941f" strokeWidth="1" strokeDasharray="3,3" opacity="0.45"
                    style={{ transition: 'opacity 0.35s ease' }} />
                );
              })}
              {connections.map(conn => {
                const from = cards.find(c => c.id === conn.from);
                const to = cards.find(c => c.id === conn.to);
                if (!from || !to) return null;
                const p1 = cardEdgePoint(from, to);
                const p2 = cardEdgePoint(to, from);
                const isSel = selected?.kind === 'connection' && selected.id === conn.id;
                const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                const ss = slideConnState(conn);
                if (ss && !ss.visible) return null;
                const opacity = ss ? (ss.dim ? 0.18 : 1) : 1;
                const isFlowing = ss?.flowing;
                return (
                  <g key={conn.id}
                    style={{ cursor: 'pointer', pointerEvents: slideshow ? 'none' : 'all', opacity, transition: 'opacity 0.35s ease' }}
                    onClick={(e) => { e.stopPropagation(); setSelected({ kind: 'connection', id: conn.id }); }}>
                    <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                      className={isFlowing ? 'flow-line' : ''}
                      stroke={isSel ? '#2b5d6b' : (isFlowing ? '#b8470a' : '#3a3a3a')}
                      strokeWidth={isSel || isFlowing ? 2.4 : 1.6}
                      markerEnd={`url(#${isSel ? 'arrowSel' : (isFlowing ? 'arrowFlow' : 'arrow')})`} />
                    {!slideshow && (
                      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                        stroke="transparent" strokeWidth="14" />
                    )}
                    {conn.label && (
                      <g>
                        <rect x={mid.x - conn.label.length * 4 - 6} y={mid.y - 11}
                          width={conn.label.length * 8 + 12} height="20"
                          fill="#fafaf6" stroke={isSel ? '#2b5d6b' : (isFlowing ? '#b8470a' : '#d4d4ce')} rx="3" />
                        <text x={mid.x} y={mid.y + 4} textAnchor="middle"
                          fontSize="12" fill="#222" fontFamily="'IBM Plex Sans JP', sans-serif">
                          {conn.label}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>

            {cards.map(card => {
              const t = TYPES[card.type] || TYPES.other;
              const I = t.Icon;
              const isSel = selected?.kind === 'card' && selected.id === card.id;
              const isConnSrc = connectFrom === card.id;
              const ss = slideCardState(card.id);
              // スライドショー中の外観計算
              const ssOpacity = ss ? (ss.visible ? (ss.dim ? 0.22 : 1) : 0) : 1;
              const ssScale = (ss?.current && slideshow?.phase === 'detail') ? 1.06 : 1;
              const ssSpotlight = ss?.current;
              const borderColor = ssSpotlight
                ? '#b8470a'
                : (isSel ? '#2b5d6b' : (isConnSrc ? '#d97706' : '#dcdcd5'));
              const boxShadow = ssSpotlight
                ? '0 0 0 3px #f4c79b, 0 8px 24px rgba(184,71,10,0.25)'
                : (isSel ? '0 4px 14px rgba(43,93,107,0.18)' : '0 1px 3px rgba(0,0,0,0.08)');
              return (
                <div key={card.id}
                  style={{
                    ...styles.card, left: card.x, top: card.y,
                    borderColor, boxShadow,
                    cursor: slideshow ? 'default' : (connectMode ? 'crosshair' : 'grab'),
                    opacity: ssOpacity,
                    transform: `scale(${ssScale})`,
                    transformOrigin: 'center center',
                    transition: slideshow
                      ? 'opacity 0.45s ease, transform 0.35s ease, box-shadow 0.3s ease, border-color 0.2s ease'
                      : 'none',
                    pointerEvents: slideshow ? 'none' : 'auto',
                  }}
                  onMouseDown={slideshow ? undefined : (e) => startDrag(e, 'card', card.id)}
                  onDoubleClick={slideshow ? undefined : (e) => { e.stopPropagation(); openLink(card.link); }}
                >
                  <div style={{ ...styles.cardBar, background: t.color }} />
                  <div style={styles.cardBody}>
                    <div style={{ ...styles.cardIcon, background: t.bg, color: t.color }}>
                      <I size={18} />
                    </div>
                    <div style={styles.cardText}>
                      <div style={styles.cardName} title={card.name}>{card.name}</div>
                      <div style={styles.cardMeta}>
                        {t.label}
                        {card.link && !slideshow && <span style={styles.linkDot}> · リンクあり</span>}
                        {slideshow?.phase === 'detail' && ss?.current && card.link && (
                          <span style={styles.linkDot}> · {card.link.length > 28 ? card.link.slice(0, 26) + '..' : card.link}</span>
                        )}
                      </div>
                    </div>
                    {card.link && !slideshow && (
                      <button style={styles.openBtn} title="リンクを開く"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); openLink(card.link); }}>
                        <ExternalLink size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {notes.map(note => {
              const isSel = selected?.kind === 'note' && selected.id === note.id;
              const isEditing = editingNoteId === note.id;
              const visible = slideNoteVisible(note);
              const spotlighted = slideshow?.phase === 'detail'
                && note.attachedTo === slideshow.order[slideshow.step];
              if (slideshow && !visible) return null;
              return (
                <div key={note.id}
                  style={{
                    ...styles.note, left: note.x, top: note.y,
                    outline: isSel ? '2px solid #2b5d6b' : 'none', outlineOffset: '2px',
                    cursor: slideshow ? 'default' : (isEditing ? 'text' : 'grab'),
                    transform: spotlighted
                      ? 'rotate(0deg) scale(1.1)'
                      : (isEditing ? 'rotate(0deg)' : 'rotate(-0.5deg)'),
                    transformOrigin: 'left top',
                    boxShadow: spotlighted
                      ? '4px 6px 14px rgba(0,0,0,0.22)'
                      : '2px 3px 6px rgba(0,0,0,0.12)',
                    transition: slideshow
                      ? 'transform 0.35s ease, box-shadow 0.35s ease, opacity 0.35s ease'
                      : 'none',
                    pointerEvents: slideshow ? 'none' : 'auto',
                  }}
                  onMouseDown={slideshow ? undefined : (e) => {
                    if (isEditing) { e.stopPropagation(); return; }
                    startDrag(e, 'note', note.id);
                  }}
                  onDoubleClick={slideshow ? undefined : (e) => {
                    e.stopPropagation();
                    setSelected({ kind: 'note', id: note.id });
                    setEditingNoteId(note.id);
                  }}
                >
                  {isEditing ? (
                    <textarea autoFocus className="note-inline-edit" style={styles.noteEdit}
                      value={note.text} placeholder="ここに書く..."
                      onChange={(e) => updateNote(note.id, { text: e.target.value })}
                      onBlur={() => setEditingNoteId(null)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { e.preventDefault(); setEditingNoteId(null); }
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault(); setEditingNoteId(null);
                        }
                      }}
                      onFocus={(e) => {
                        const v = e.target.value;
                        e.target.value = '';
                        e.target.value = v;
                      }}
                    />
                  ) : (
                    <div style={styles.noteText}>
                      {note.text || <span style={styles.notePlaceholder}>(ダブルクリックで編集)</span>}
                    </div>
                  )}
                  {note.attachedTo && <div style={styles.noteClip}><Paperclip size={11} /></div>}
                </div>
              );
            })}
          </div>
          </div>
        </div>

        {selectedItem && (
          <aside style={styles.sidebar}>
            <div style={styles.sidebarHeader}>
              <div style={styles.sidebarTitle}>
                {selectedItem.kind === 'card' && 'カード編集'}
                {selectedItem.kind === 'note' && 'メモ編集'}
                {selectedItem.kind === 'connection' && '接続編集'}
              </div>
              <button style={styles.iconBtn} onClick={() => setSelected(null)}>
                <X size={16} />
              </button>
            </div>

            {selectedItem.kind === 'card' && selectedItem.item && (
              <div style={styles.sidebarBody}>
                <Field label="名前">
                  <input style={styles.input} value={selectedItem.item.name}
                    onChange={(e) => updateCard(selectedItem.item.id, { name: e.target.value })} />
                </Field>
                <Field label="種類">
                  <select style={styles.input} value={selectedItem.item.type}
                    onChange={(e) => updateCard(selectedItem.item.id, { type: e.target.value })}>
                    {Object.entries(TYPES).map(([k, t]) => (
                      <option key={k} value={k}>{t.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="リンク（URLまたはファイルパス）">
                  <input style={styles.input} value={selectedItem.item.link}
                    placeholder="https://... または C:\path\to\file.xlsx"
                    onChange={(e) => updateCard(selectedItem.item.id, { link: e.target.value })} />
                  {selectedItem.item.link && (
                    <button style={{ ...styles.smallBtn, marginTop: 6 }}
                      onClick={() => openLink(selectedItem.item.link)}>
                      <ExternalLink size={13} /> 開く
                    </button>
                  )}
                </Field>
                <div style={styles.hint}>
                  ヒント：カードをダブルクリックでもリンクを開けます
                </div>
                <button style={styles.deleteBtn} onClick={() => deleteCard(selectedItem.item.id)}>
                  <Trash2 size={14} /> このカードを削除
                </button>
              </div>
            )}

            {selectedItem.kind === 'note' && selectedItem.item && (
              <div style={styles.sidebarBody}>
                <Field label="本文">
                  <textarea style={{ ...styles.input, minHeight: 100, resize: 'vertical', fontFamily: 'inherit' }}
                    value={selectedItem.item.text}
                    onChange={(e) => updateNote(selectedItem.item.id, { text: e.target.value })} />
                </Field>
                <Field label="紐付け（このカードと一緒に動く）">
                  <select style={styles.input} value={selectedItem.item.attachedTo || ''}
                    onChange={(e) => updateNote(selectedItem.item.id, { attachedTo: e.target.value || null })}>
                    <option value="">（紐付けなし）</option>
                    {cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <button style={styles.deleteBtn} onClick={() => deleteNote(selectedItem.item.id)}>
                  <Trash2 size={14} /> このメモを削除
                </button>
              </div>
            )}

            {selectedItem.kind === 'connection' && selectedItem.item && (
              <div style={styles.sidebarBody}>
                <Field label="ラベル">
                  <input style={styles.input} placeholder="例：転記、参照、集計 など"
                    value={selectedItem.item.label}
                    onChange={(e) => updateConn(selectedItem.item.id, { label: e.target.value })} />
                </Field>
                <div style={styles.connInfo}>
                  <div style={styles.connInfoRow}>
                    <span style={styles.connInfoLabel}>FROM</span>
                    <span>{cards.find(c => c.id === selectedItem.item.from)?.name || '?'}</span>
                  </div>
                  <div style={styles.connInfoRow}>
                    <span style={styles.connInfoLabel}>TO</span>
                    <span>{cards.find(c => c.id === selectedItem.item.to)?.name || '?'}</span>
                  </div>
                </div>
                <button style={styles.deleteBtn} onClick={() => deleteConn(selectedItem.item.id)}>
                  <Trash2 size={14} /> この接続を削除
                </button>
              </div>
            )}
          </aside>
        )}
      </main>

      {/* Floating zoom controls */}
      <div style={styles.zoomControls}>
        <button onClick={zoomOut} style={styles.zoomBtn} title="縮小 (−)" disabled={zoom <= ZOOM_MIN + 0.01}>
          <ZoomOut size={14} />
        </button>
        <button onClick={zoomReset} style={styles.zoomLabel} title="100%に戻す (0)">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={zoomIn} style={styles.zoomBtn} title="拡大 (+)" disabled={zoom >= ZOOM_MAX - 0.01}>
          <ZoomIn size={14} />
        </button>
        <button onClick={zoomFit} style={styles.zoomBtn} title="全体にフィット (F)">
          <Maximize2 size={14} />
        </button>
      </div>

      {slideshow && (() => {
        const total = slideshow.order.length;
        const currentCard = cards.find(c => c.id === slideshow.order[slideshow.step]);
        const phaseLabel = slideshow.phase === 'overview' ? 'フェーズ1 / 全体像' : 'フェーズ2 / 詳細';
        const phaseHint = slideshow.phase === 'overview'
          ? '起点から順に1枚ずつ登場します'
          : '各カードの詳細（紐付きメモ）を順番に見ていきます';
        const isLast = slideshow.phase === 'detail' && slideshow.step === total - 1;
        const canPrev = !(slideshow.phase === 'overview' && slideshow.step === 0);
        return (
          <>
            <div style={styles.slideshowTopBar}>
              <div style={styles.slideshowPhase}>
                <span style={styles.slideshowPhaseBadge}>{phaseLabel}</span>
                <span style={styles.slideshowPhaseHint}>{phaseHint}</span>
              </div>
              <div style={styles.slideshowCounter}>
                {slideshow.step + 1} / {total}
              </div>
            </div>
            <div style={styles.slideshowBar}>
              <button
                onClick={slideshowPrev}
                disabled={!canPrev}
                style={{ ...styles.slideshowBtn, opacity: canPrev ? 1 : 0.35, cursor: canPrev ? 'pointer' : 'not-allowed' }}
                title="前へ（←）">
                <ChevronLeft size={16} /> 戻る
              </button>
              <div style={styles.slideshowCurrent}>
                {currentCard ? currentCard.name : '(なし)'}
              </div>
              <button onClick={slideshowNext} style={styles.slideshowBtnPrimary} title="次へ（Space / →）">
                {isLast ? '終了' : '次へ'} <ChevronRight size={16} />
              </button>
              <button onClick={endSlideshow} style={styles.slideshowBtnGhost} title="中断（Esc）">
                <X size={14} />
              </button>
            </div>
          </>
        );
      })()}

      {cards.length === 0 && notes.length === 0 && (
        <div style={styles.emptyHint}>
          <div style={styles.emptyHintInner}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>はじめかた</div>
            <div>① カード追加ボタン or ファイルD&D、または「AI / JSON 取込」でClaudeから貰ったJSONを貼り付け</div>
            <div>② カードをドラッグで配置、「メモ」で付箋追加（カード選択中なら自動で紐付け）</div>
            <div>③ 付箋はダブルクリックでその場で編集、ESC または Cmd+Enter で確定</div>
            <div>④ 「共有リンク」ボタンで盤面をURL化、他の人に送れます</div>
          </div>
        </div>
      )}

      {jsonModal && (
        <div style={styles.modalBackdrop} onClick={() => setJsonModal(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>
                {jsonModal === 'paste' && <><Sparkles size={16} /> AI / JSON から取り込み</>}
                {jsonModal === 'copy' && <><Copy size={16} /> 現在の盤面をJSONで取得</>}
                {jsonModal === 'share' && <><Share2 size={16} /> 共有リンク</>}
              </div>
              <button style={styles.iconBtn} onClick={() => setJsonModal(null)}>
                <X size={18} />
              </button>
            </div>

            <div style={styles.modalBody}>
              {jsonModal === 'paste' && (
                <>
                  <div style={styles.modalDesc}>
                    Claude などに業務フローを説明して、下記フォーマットのJSONを貰って貼り付けてください。
                    座標（x,y）は省略可（自動で左→右に配置されます）。
                  </div>
                  <div style={styles.formatBox}>
                    <div style={styles.formatLabel}>Claudeに渡すフォーマット指示の例：</div>
                    <pre style={styles.formatPre}>{FORMAT_EXAMPLE}</pre>
                  </div>
                  <div style={styles.modeRow}>
                    <label style={styles.radioLabel}>
                      <input type="radio" checked={jsonMode === 'add'} onChange={() => setJsonMode('add')} />
                      既存盤面に追加
                    </label>
                    <label style={styles.radioLabel}>
                      <input type="radio" checked={jsonMode === 'replace'} onChange={() => setJsonMode('replace')} />
                      置き換え（現在の盤面を消去）
                    </label>
                  </div>
                  <textarea style={styles.modalTextarea} value={jsonText}
                    onChange={(e) => { setJsonText(e.target.value); setJsonError(''); }}
                    placeholder='{ "cards": [...], "connections": [...], "notes": [...] }' />
                  {jsonError && <div style={styles.modalError}>エラー: {jsonError}</div>}
                  <div style={styles.modalActions}>
                    <button style={styles.modalCancelBtn} onClick={() => setJsonModal(null)}>キャンセル</button>
                    <button style={{ ...styles.modalPrimaryBtn, opacity: jsonText.trim() ? 1 : 0.4 }}
                      disabled={!jsonText.trim()} onClick={submitJsonPaste}>
                      取り込む
                    </button>
                  </div>
                </>
              )}

              {jsonModal === 'copy' && (
                <>
                  <div style={styles.modalDesc}>
                    現在の盤面のJSONです。コピーしてClaude Chatなどに貼り付けて、続きの相談に使えます。
                  </div>
                  <textarea style={{ ...styles.modalTextarea, minHeight: 280 }}
                    value={jsonText} readOnly onClick={(e) => e.target.select()} />
                  <div style={styles.modalActions}>
                    <button style={styles.modalCancelBtn} onClick={() => setJsonModal(null)}>閉じる</button>
                    <button style={styles.modalPrimaryBtn} onClick={copyJsonToClipboard}>
                      {copyDone ? <><Check size={14} /> コピーしました</> : <><Copy size={14} /> クリップボードにコピー</>}
                    </button>
                  </div>
                </>
              )}

              {jsonModal === 'share' && shareInfo && (
                <>
                  <div style={styles.modalDesc}>
                    盤面データを圧縮してURLに埋め込みました。<br/>
                    このリンクを送れば、相手のブラウザで同じ盤面が開きます（サーバ不要）。
                  </div>
                  {shareInfo.overLimit && (
                    <div style={styles.modalWarn}>
                      ⚠ URLが長め（{shareInfo.length.toLocaleString()} 文字）です。
                      一部のメッセンジャーで途切れる可能性があります。
                      大きな盤面は「書出」でJSONを送る方が確実です。
                    </div>
                  )}
                  <textarea style={{ ...styles.modalTextarea, minHeight: 140, fontSize: 11 }}
                    value={shareInfo.url} readOnly onClick={(e) => e.target.select()} />
                  <div style={styles.shareInfoRow}>
                    URL長: {shareInfo.length.toLocaleString()} 文字（目安: 8,000 以下）
                  </div>
                  {jsonError && <div style={styles.modalError}>{jsonError}</div>}
                  <div style={styles.modalActions}>
                    <button style={styles.modalCancelBtn} onClick={() => setJsonModal(null)}>閉じる</button>
                    <button style={styles.modalPrimaryBtn} onClick={copyShareUrl}>
                      {copyDone ? <><Check size={14} /> コピーしました</> : <><Copy size={14} /> URLをコピー</>}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const FORMAT_EXAMPLE = `次のJSONフォーマットで業務フローを表現してください：

{
  "cards": [
    { "name": "売上データ.xlsx", "type": "excel", "link": "" },
    { "name": "請求書.docx", "type": "word" },
    { "name": "顧客フォルダ", "type": "folder" }
  ],
  "connections": [
    { "from": "売上データ.xlsx", "to": "請求書.docx", "label": "転記" }
  ],
  "notes": [
    { "text": "月初に更新", "attachTo": "売上データ.xlsx" }
  ]
}

- type: excel / word / pdf / folder / link / other
- 座標(x,y)は不要、自動で左→右に配置されます
- JSONのみ出力、コードフェンス（\\\`\\\`\\\`）は不要`;

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={styles.fieldLabel}>{label}</div>
      {children}
    </div>
  );
}

const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; }
  button { font-family: inherit; }
  input, textarea, select { font-family: inherit; }
  input:focus, textarea:focus, select:focus {
    outline: 2px solid #2b5d6b; outline-offset: -1px; border-color: #2b5d6b;
  }
  textarea.note-inline-edit:focus {
    outline: none !important; border: none !important;
  }
  @keyframes flow-dash {
    to { stroke-dashoffset: -16; }
  }
  .flow-line {
    stroke-dasharray: 8 4;
    animation: flow-dash 0.7s linear infinite;
  }
  @keyframes ss-pulse {
    0%,100% { box-shadow: 0 0 0 3px #f4c79b, 0 8px 24px rgba(184,71,10,0.25); }
    50%     { box-shadow: 0 0 0 5px #f0b578, 0 10px 26px rgba(184,71,10,0.35); }
  }
`;

const styles = {
  root: {
    fontFamily: "'IBM Plex Sans JP', system-ui, sans-serif",
    height: '100vh', display: 'flex', flexDirection: 'column',
    background: '#fafaf6', color: '#222', fontSize: 14,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 16,
    padding: '10px 16px', background: '#ffffff',
    borderBottom: '1px solid #e6e6df', flexWrap: 'wrap',
  },
  headerLeft: { display: 'flex', alignItems: 'baseline', gap: 8 },
  title: { fontWeight: 700, fontSize: 16, letterSpacing: '0.02em' },
  versionTag: {
    fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
    color: '#999', padding: '2px 6px', border: '1px solid #e6e6df', borderRadius: 4,
  },
  toolGroup: {
    display: 'flex', gap: 4, alignItems: 'center',
    paddingRight: 12, borderRight: '1px solid #ececde',
  },
  typeBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '6px 10px', background: '#fff', border: '1px solid #d4d4ce',
    borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
  actionBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '6px 10px', background: '#fff', border: '1px solid #d4d4ce',
    borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#222',
  },
  saveStatus: {
    display: 'flex', alignItems: 'center', gap: 4,
    fontSize: 12, color: '#666', marginLeft: 'auto',
    fontFamily: "'IBM Plex Mono', monospace",
  },
  banner: {
    background: '#2b5d6b', color: '#fff', padding: '6px 16px',
    fontSize: 13, textAlign: 'center', letterSpacing: '0.02em',
  },
  sharedBanner: {
    background: '#fef3a3', color: '#665818', padding: '8px 16px',
    fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
    borderBottom: '1px solid #e0cc74',
  },
  sharedBannerBtn: {
    marginLeft: 'auto', padding: '4px 10px', background: '#fff',
    border: '1px solid #d4c77a', borderRadius: 4, cursor: 'pointer',
    fontSize: 12, color: '#665818',
    display: 'inline-flex', alignItems: 'center', gap: 4,
  },
  main: { flex: 1, display: 'flex', overflow: 'hidden' },
  scrollArea: { flex: 1, overflow: 'auto', position: 'relative', cursor: 'grab' },
  canvas: {
    position: 'relative', width: 4000, height: 3000,
    backgroundImage: `radial-gradient(circle, #e0e0d8 1px, transparent 1px)`,
    backgroundSize: '24px 24px',
  },
  svg: { position: 'absolute', top: 0, left: 0, pointerEvents: 'none' },
  card: {
    position: 'absolute', width: 200, minHeight: 80,
    background: '#fff', border: '1.5px solid #dcdcd5',
    borderRadius: 6, overflow: 'hidden', userSelect: 'none',
  },
  cardBar: { height: 4, width: '100%' },
  cardBody: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' },
  cardIcon: {
    width: 36, height: 36, borderRadius: 6,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cardText: { flex: 1, minWidth: 0 },
  cardName: {
    fontSize: 13, fontWeight: 600,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3,
  },
  cardMeta: { fontSize: 11, color: '#888', marginTop: 2 },
  linkDot: { color: '#2b5d6b' },
  openBtn: {
    width: 26, height: 26, padding: 0,
    border: '1px solid #d4d4ce', background: '#fff',
    borderRadius: 4, cursor: 'pointer', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666',
  },
  note: {
    position: 'absolute', minWidth: 140, maxWidth: 200,
    padding: '10px 12px', background: '#fef3a3',
    boxShadow: '2px 3px 6px rgba(0,0,0,0.12)',
    fontSize: 13, lineHeight: 1.4, userSelect: 'none',
    transform: 'rotate(-0.5deg)',
  },
  noteText: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  notePlaceholder: { color: '#a08a1e', opacity: 0.55, fontStyle: 'italic' },
  noteEdit: {
    width: '100%', minHeight: 60,
    border: 'none', background: 'transparent',
    resize: 'none', padding: 0, margin: 0,
    fontSize: 13, lineHeight: 1.4, outline: 'none', color: '#222',
    fontFamily: "'IBM Plex Sans JP', system-ui, sans-serif",
  },
  noteClip: {
    position: 'absolute', top: 4, right: 4, color: '#a08a1e', display: 'flex',
  },
  sidebar: {
    width: 320, background: '#fff', borderLeft: '1px solid #e6e6df',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  sidebarHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid #e6e6df',
  },
  sidebarTitle: { fontWeight: 600, fontSize: 14 },
  sidebarBody: { padding: 16, overflow: 'auto' },
  iconBtn: {
    border: 'none', background: 'transparent', cursor: 'pointer',
    padding: 4, color: '#666', display: 'flex',
  },
  fieldLabel: { fontSize: 12, fontWeight: 500, color: '#666', marginBottom: 4 },
  input: {
    width: '100%', padding: '8px 10px', border: '1px solid #d4d4ce',
    borderRadius: 4, fontSize: 13, background: '#fff',
  },
  smallBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '5px 10px', background: '#fff', border: '1px solid #d4d4ce',
    borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  hint: { fontSize: 11, color: '#888', marginTop: -8, marginBottom: 14, lineHeight: 1.5 },
  deleteBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 12px', background: '#fbeae8', color: '#a93226',
    border: '1px solid #f0c8c4', borderRadius: 4, cursor: 'pointer',
    fontSize: 13, marginTop: 8,
  },
  connInfo: {
    background: '#f7f7f1', padding: 10, borderRadius: 4,
    fontSize: 12, marginBottom: 8,
  },
  connInfoRow: { display: 'flex', gap: 8, padding: '3px 0' },
  connInfoLabel: {
    fontFamily: "'IBM Plex Mono', monospace", color: '#999',
    width: 40, fontSize: 11,
  },
  emptyHint: {
    position: 'fixed', bottom: 24, left: '50%',
    transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 100,
  },
  emptyHintInner: {
    background: 'rgba(255,255,255,0.95)',
    padding: '14px 20px', borderRadius: 8,
    border: '1px solid #e6e6df',
    boxShadow: '0 4px 14px rgba(0,0,0,0.06)',
    fontSize: 12, lineHeight: 1.7, color: '#555',
  },
  modalBackdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(20, 20, 18, 0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 20,
  },
  modal: {
    background: '#fff', borderRadius: 10,
    width: '100%', maxWidth: 640, maxHeight: '90vh',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '1px solid #e6e6df',
  },
  modalTitle: {
    display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15,
  },
  modalBody: {
    padding: 18, overflow: 'auto', flex: 1,
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  modalDesc: { fontSize: 13, lineHeight: 1.6, color: '#555' },
  formatBox: {
    background: '#f7f7f1', border: '1px solid #e6e6df',
    borderRadius: 6, padding: 12,
  },
  formatLabel: { fontSize: 11, color: '#888', marginBottom: 6, fontWeight: 500 },
  formatPre: {
    margin: 0, fontSize: 11, lineHeight: 1.5,
    fontFamily: "'IBM Plex Mono', monospace",
    color: '#333', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    maxHeight: 180, overflow: 'auto',
  },
  modeRow: {
    display: 'flex', gap: 16, padding: '8px 12px',
    background: '#fafaf6', borderRadius: 6, border: '1px solid #ececde',
  },
  radioLabel: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 13, cursor: 'pointer',
  },
  modalTextarea: {
    width: '100%', minHeight: 180, padding: 12,
    border: '1px solid #d4d4ce', borderRadius: 6,
    fontSize: 12, lineHeight: 1.5, resize: 'vertical',
    fontFamily: "'IBM Plex Mono', monospace",
  },
  modalError: {
    padding: '8px 12px', background: '#fbeae8',
    color: '#a93226', border: '1px solid #f0c8c4',
    borderRadius: 4, fontSize: 12,
  },
  modalWarn: {
    padding: '8px 12px', background: '#fef3a3',
    color: '#665818', border: '1px solid #e0cc74',
    borderRadius: 4, fontSize: 12, lineHeight: 1.5,
  },
  shareInfoRow: {
    fontSize: 11, color: '#888',
    fontFamily: "'IBM Plex Mono', monospace",
  },
  modalActions: {
    display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4,
  },
  modalCancelBtn: {
    padding: '8px 16px', background: '#fff',
    border: '1px solid #d4d4ce', borderRadius: 5,
    cursor: 'pointer', fontSize: 13, color: '#555',
  },
  modalPrimaryBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 16px', background: '#2b5d6b',
    color: '#fff', border: 'none', borderRadius: 5,
    cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
  slideshowTopBar: {
    position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(255,255,255,0.96)', border: '1px solid #e6e6df',
    borderRadius: 999, padding: '6px 18px',
    display: 'flex', alignItems: 'center', gap: 14,
    boxShadow: '0 6px 16px rgba(0,0,0,0.08)',
    zIndex: 500, fontSize: 12, pointerEvents: 'none',
  },
  slideshowPhase: { display: 'flex', alignItems: 'center', gap: 10 },
  slideshowPhaseBadge: {
    padding: '2px 10px', background: '#b8470a', color: '#fff',
    borderRadius: 999, fontSize: 11, fontWeight: 600,
  },
  slideshowPhaseHint: { color: '#666', fontSize: 12 },
  slideshowCounter: {
    fontFamily: "'IBM Plex Mono', monospace",
    color: '#b8470a', fontWeight: 600,
  },
  slideshowBar: {
    position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
    background: '#1f1f1a', color: '#fff', borderRadius: 10,
    padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
    boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
    zIndex: 600, minWidth: 420, maxWidth: '85vw',
  },
  slideshowBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '8px 12px', background: 'transparent',
    color: '#fff', border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 6, fontSize: 13,
  },
  slideshowBtnPrimary: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '8px 14px', background: '#b8470a',
    color: '#fff', border: 'none', borderRadius: 6,
    cursor: 'pointer', fontSize: 13, fontWeight: 600,
  },
  slideshowBtnGhost: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: 8, background: 'transparent',
    color: 'rgba(255,255,255,0.7)', border: 'none',
    borderRadius: 6, cursor: 'pointer',
  },
  slideshowCurrent: {
    flex: 1, textAlign: 'center', fontSize: 13, fontWeight: 500,
    padding: '0 8px',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  zoomControls: {
    position: 'fixed', right: 16, bottom: 16, zIndex: 400,
    background: '#fff', border: '1px solid #e6e6df',
    borderRadius: 8, padding: 4,
    display: 'flex', alignItems: 'center', gap: 2,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
  },
  zoomBtn: {
    width: 30, height: 28, padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none',
    borderRadius: 4, cursor: 'pointer', color: '#444',
  },
  zoomLabel: {
    minWidth: 48, height: 28, padding: '0 6px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none',
    borderRadius: 4, cursor: 'pointer', color: '#222',
    fontSize: 12, fontFamily: "'IBM Plex Mono', monospace",
    fontWeight: 500,
  },
  tabBar: {
    display: 'flex', alignItems: 'flex-end', gap: 2,
    padding: '6px 12px 0',
    background: '#f4f4ed', borderBottom: '1px solid #e6e6df',
    flexWrap: 'wrap', minHeight: 38,
  },
  tab: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '7px 10px 7px 12px', cursor: 'pointer',
    fontSize: 12, color: '#555',
    background: '#ebebe2',
    borderRadius: '6px 6px 0 0',
    borderTop: '2px solid transparent',
    marginBottom: -1,
    userSelect: 'none',
  },
  tabActive: {
    background: '#fff', color: '#222',
    borderTop: '2px solid #2b5d6b',
    fontWeight: 600,
    boxShadow: '0 -2px 4px rgba(0,0,0,0.04)',
  },
  tabName: { maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tabCount: {
    fontSize: 10, color: '#999',
    fontFamily: "'IBM Plex Mono', monospace",
    background: 'rgba(0,0,0,0.05)',
    padding: '1px 5px', borderRadius: 8,
  },
  tabCloseBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 16, height: 16, padding: 0,
    background: 'transparent', border: 'none',
    color: '#888', cursor: 'pointer', borderRadius: 3,
    marginLeft: 2,
  },
  tabAdd: {
    padding: '6px 10px', background: 'transparent',
    border: '1px dashed #c8c8c0', color: '#666',
    cursor: 'pointer', fontSize: 12, marginLeft: 4,
    borderRadius: 4, marginBottom: 4,
  },
};
