// src/pages/ComposePanel.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { useChannelRack } from '../context/ChannelRackContext';
import PlayPatch from '../components/PlayPatch';
import API from '../api'; // central axios helper

// ---- constants ----
const LANES_MIN = 8;
const LANE_HEIGHT = 48;
const LANE_GUTTER = 220;            // space for name/color + M/S buttons
const INITIAL_PX_PER_BEAT = 60;     // pixels per beat (zoom)
const DEFAULT_BPM = 120;
const DEFAULT_BEATS = 64;           // visible beats
const DRAFT_KEY = 'trackDraft_v6';  // bump on schema changes

// ---- helpers ----
const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
const fmtTime = (seconds) => {
  if (seconds < 0 || !isFinite(seconds)) return '00:00.000';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${pad2(m)}:${pad2(s)}.${ms.toString().padStart(3, '0')}`;
};
const snap16 = (beats) => Math.max(0, Math.round(beats * 4) / 4); // 1/16 note
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// serialisable patch summary only (for persistence)
const toSerializablePatch = (p) => {
  if (!p) return null;
  const { id, name, displayName, note, duration, parameters, params } = p;
  return {
    id: id ?? null,
    name: name ?? null,
    displayName: displayName ?? null,
    note: note ?? 'C4',
    duration: duration ?? '8n',
    parameters: parameters ?? params ?? null,
  };
};

// sync load draft once
const loadDraft = () => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

// default lane meta
const defaultLaneMeta = (i) => ({
  name: `Ch ${i + 1}`,
  color: ['#b3e5fc', '#ffcdd2', '#c8e6c9', '#d1c4e9', '#ffe0b2', '#f0f4c3', '#f8bbd0', '#bbdefb'][i % 8],
  mute: false,
  solo: false,
});

// ---------- NEW: robust API helpers (user + pagination) ----------
async function getCurrentUserId() {
  const { data } = await API.get('/users/me/');
  if (data?.id) return String(data.id);
  throw new Error('Could not resolve current user id');
}

async function fetchAllPatchesForUser(uid, basePath = '/patches/') {
  const out = [];
  let page = 1;
  while (true) {
    const { data } = await API.get(basePath, {
      params: { uploaded_by: uid, page, page_size: 100 },
    });
    if (Array.isArray(data)) {
      out.push(...data);
      break;
    }
    const results = Array.isArray(data?.results) ? data.results : [];
    out.push(...results);
    if (!data?.next) break;
    page += 1;
  }
  return out;
}

async function loadUserPatches() {
  const uid = await getCurrentUserId();
  try {
    return await fetchAllPatchesForUser(uid, '/patches/');
  } catch {
    return await fetchAllPatchesForUser(uid, '/api/patches/');
  }
}
// -----------------------------------------------------------------

export default function ComposePanel() {
  // Defensive Channel Rack hook
  const rack = useChannelRack();
  const channels = Array.isArray(rack.channels) ? rack.channels : [];

  const draft = loadDraft();

  // ---- core timeline state ----
  const [bpm, setBpm] = useState(() =>
    typeof draft?.bpm === 'number' ? draft.bpm : DEFAULT_BPM
  );
  const [lanes, setLanes] = useState(() =>
    typeof draft?.lanes === 'number' ? Math.max(LANES_MIN, draft.lanes) : LANES_MIN
  );
  const [pxPerBeat, setPxPerBeat] = useState(() =>
    typeof draft?.pxPerBeat === 'number' ? Math.max(10, draft.pxPerBeat) : INITIAL_PX_PER_BEAT
  );
  const [lengthBeats, setLengthBeats] = useState(() =>
    typeof draft?.lengthBeats === 'number' ? Math.max(1, draft.lengthBeats) : DEFAULT_BEATS
  );
  const [clips, setClips] = useState(() =>
    Array.isArray(draft?.clips) ? draft.clips : []
  );

  // lane metadata (name/color/mute/solo)
  const [laneMeta, setLaneMeta] = useState(() => {
    const arr = Array.isArray(draft?.laneMeta) ? draft.laneMeta : [];
    return Array.from({ length: Math.max(lanes, arr.length || 0) }).map((_, i) => arr[i] ?? defaultLaneMeta(i));
  });

  // ensure laneMeta size follows lanes
  useEffect(() => {
    setLaneMeta((prev) => {
      const out = prev.slice(0, lanes);
      while (out.length < lanes) out.push(defaultLaneMeta(out.length));
      return out;
    });
  }, [lanes]);

  // ---- persist on change ----
  useEffect(() => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ bpm, lanes, pxPerBeat, lengthBeats, clips, laneMeta })
      );
    } catch (e) {
      console.warn('Failed to save track draft', e);
    }
  }, [bpm, lanes, pxPerBeat, lengthBeats, clips, laneMeta]);

  // ---- derived layout/time ----
  const secPerBeat = 60 / bpm;
  const totalWidthPx = lengthBeats * pxPerBeat;
  const totalSeconds = lengthBeats * secPerBeat;

  // ---- refs + UI state ----
  const gridRef = useRef(null);
  const rulerRef = useRef(null);
  const [hoverSeconds, setHoverSeconds] = useState(null);

  // transport / playhead
  const [isPlaying, setIsPlaying] = useState(false);
  const [followOn, setFollowOn] = useState(true);
  const [playheadBeat, setPlayheadBeat] = useState(0);
  const rafRef = useRef(0);

  // Loop region picking + state
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [pickingLoop, setPickingLoop] = useState(false);
  const [pendingLoopPoints, setPendingLoopPoints] = useState([]); // seconds[]
  const [loopRegion, setLoopRegion] = useState(null); // { startSec, endSec } | null

  // selection
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [lastSelectionWasBox, setLastSelectionWasBox] = useState(false);

  // box select
  const [box, setBox] = useState(null); // {x1,y1,x2,y2,active}

  // dragging / resizing
  const dragRef = useRef(null); // { mode, baseClips, startBeat, startLane, clone }

  // ---- ticks (seconds only, no bars) ----
  const ticks = useMemo(() => {
    const major = []; // each second
    const minor = []; // each 100 ms
    const totalMs = Math.ceil(totalSeconds * 1000);
    for (let ms = 0; ms <= totalMs; ms += 100) {
      const seconds = ms / 1000;
      const beatAtSecond = seconds / secPerBeat;
      const x = beatAtSecond * pxPerBeat;
      if (ms % 1000 === 0) major.push({ x, label: fmtTime(seconds) });
      else minor.push({ x });
    }
    return { major, minor };
  }, [pxPerBeat, secPerBeat, totalSeconds]);

  // sync ruler scroll with grid
  useEffect(() => {
    const grid = gridRef.current, ruler = rulerRef.current;
    if (!grid || !ruler) return;
    const onScroll = () => { ruler.scrollLeft = grid.scrollLeft; };
    grid.addEventListener('scroll', onScroll);
    return () => grid.removeEventListener('scroll', onScroll);
  }, []);

  // hover readout
  const onMouseMoveGrid = (e) => {
    const grid = e.currentTarget;
    const rect = grid.getBoundingClientRect();
    const xInGrid = e.clientX - rect.left + grid.scrollLeft - LANE_GUTTER;
    const beat = xInGrid / pxPerBeat;
    const secs = beat * secPerBeat;
    setHoverSeconds(secs >= 0 ? secs : 0);

    if (box?.active) {
      setBox((b) => ({ ...b, x2: e.clientX, y2: e.clientY }));
    }
  };
  const clearHover = () => setHoverSeconds(null);

  // ---- Import (no BPM), with mapping ----
  const [showImportMap, setShowImportMap] = useState(false);
  const [importMap, setImportMap] = useState({});
  useEffect(() => {
    if (!showImportMap) return;
    const defaults = {};
    channels.forEach((_, i) => { defaults[i] = Math.min(i, Math.max(lanes - 1, 0)); });
    setImportMap(defaults);
  }, [showImportMap, channels, lanes]);

  const doImportMapped = () => {
    if (!channels.length) {
      alert('No Channel Rack content to import.');
      setShowImportMap(false);
      return;
    }

    const newClips = [];
    let maxLane = lanes;

    channels.forEach((ch, rackIdx) => {
      if (!ch || !Array.isArray(ch.steps) || ch.steps.length === 0) return;

      const targetLane = Number.isFinite(importMap[rackIdx])
        ? importMap[rackIdx]
        : rackIdx;

      maxLane = Math.max(maxLane, targetLane + 1);

      ch.steps.forEach((on, stepIndex) => {
        if (!on) return;
        const startBeat = stepIndex / 4;
        const lengthBeatsLocal = 1 / 4;

        newClips.push({
          id: `${targetLane}-${stepIndex}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          lane: targetLane,
          startBeat,
          lengthBeats: lengthBeatsLocal,
          label:
            ch.patch?.displayName ||
            ch.patch?.name ||
            (laneMeta?.[targetLane]?.name ?? `Ch ${targetLane + 1}`),
          patch: toSerializablePatch(ch.patch),
        });
      });
    });

    if (!newClips.length) {
      alert('Nothing to import (no active steps found).');
      setShowImportMap(false);
      return;
    }

    const lastEndBeat = Math.max(...newClips.map(c => c.startBeat + c.lengthBeats));
    if (lastEndBeat > lengthBeats) setLengthBeats(Math.ceil(lastEndBeat));

    setLanes(Math.max(LANES_MIN, maxLane));
    setClips(newClips);
    setShowImportMap(false);
  };

  // optional quick import (1:1 lanes) — function kept
  const quickImportAll = () => {
    if (!channels.length) return;

    const newClips = [];
    let maxLane = lanes;

    channels.forEach((ch, i) => {
      if (!ch || !Array.isArray(ch.steps)) return;
      const lane = Math.min(i, Math.max(lanes - 1, 0));
      maxLane = Math.max(maxLane, lane + 1);

      ch.steps.forEach((on, stepIndex) => {
        if (!on) return;
        newClips.push({
          id: `${lane}-${stepIndex}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          lane,
          startBeat: stepIndex / 4,
          lengthBeats: 1 / 4,
          label: ch.patch?.displayName || ch.patch?.name || `Ch ${lane + 1}`,
          patch: toSerializablePatch(ch.patch),
        });
      });
    });

    if (newClips.length) {
      const lastEnd = Math.max(...newClips.map(c => c.startBeat + c.lengthBeats));
      if (lastEnd > lengthBeats) setLengthBeats(Math.ceil(lastEnd));
      setLanes(Math.max(LANES_MIN, maxLane));
      setClips(newClips);
    } else {
      alert('Nothing to import (no active steps found).');
    }
  };

  // ---- hit helpers ----
  const pxToBeat = (px) => px / pxPerBeat;
  const beatToPx = (beat) => beat * pxPerBeat;
  const pxToSec = (px) => pxToBeat(px) * secPerBeat;
  const secToPx = (sec) => beatToPx(sec / secPerBeat);

  // ---- Playback (mute/solo aware) ----
  useEffect(() => { Tone.getTransport().bpm.value = bpm; }, [bpm]);

  // Keep Tone.Transport loop settings in sync with UI;
  // also jump playhead on loop enable/disable as requested.
  useEffect(() => {
    const transport = Tone.getTransport();
    if (loopEnabled && loopRegion && loopRegion.endSec > loopRegion.startSec) {
      transport.loop = true;
      transport.loopStart = loopRegion.startSec;
      transport.loopEnd = loopRegion.endSec;

      // Jump playhead to loop start immediately
      const startBeat = loopRegion.startSec / secPerBeat;
      setPlayheadBeat(startBeat);
      try { transport.seconds = loopRegion.startSec; } catch {}
    } else {
      // Loop disabled: reset to start
      transport.loop = false;
      transport.loopStart = 0;
      transport.loopEnd = lengthBeats * secPerBeat;
      setPlayheadBeat(0);
      try { transport.seconds = 0; } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopEnabled, loopRegion]); // lengthBeats/secPerBeat changes are handled at start

  const scheduleAndStart = async () => {
    await Tone.start();
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    transport.bpm.value = bpm;

    if (loopEnabled && loopRegion && loopRegion.endSec > loopRegion.startSec) {
      transport.loop = true;
      transport.loopStart = loopRegion.startSec;
      transport.loopEnd = loopRegion.endSec;
    } else {
      transport.loop = false;
      transport.loopStart = 0;
      transport.loopEnd = lengthBeats * secPerBeat; // seconds
    }

    const anySolo = laneMeta.some(m => m.solo);
    clips.forEach((clip) => {
      const lane = laneMeta[clip.lane];
      const lanePlayable = lane && (anySolo ? lane.solo : !lane.mute);
      if (!lanePlayable) return;
      if (!clip.patch) return;

      const triggerAtSec = clip.startBeat * secPerBeat;
      transport.schedule((time) => {
        try {
          PlayPatch({
            ...clip.patch,
            note: clip.patch?.note || 'C4',
            duration: clip.patch?.duration || '8n',
          }, time);
        } catch (e) {
          console.warn('PlayPatch failed for clip', clip, e);
        }
      }, triggerAtSec);
    });

    // Start at loop start if looping, else at 0
    const startAt = (loopEnabled && loopRegion) ? loopRegion.startSec : 0;
    transport.start('+0.0', startAt);
    setIsPlaying(true);

    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const sec = transport.seconds % Math.max(lengthBeats * secPerBeat, 0.0001);
      const beat = sec / secPerBeat;
      setPlayheadBeat(beat);

      if (followOn && gridRef.current) {
        const x = beat * pxPerBeat + LANE_GUTTER;
        const grid = gridRef.current;
        const viewLeft = grid.scrollLeft;
        const viewRight = viewLeft + grid.clientWidth;
        const margin = 80;
        if (x < viewLeft + margin || x > viewRight - margin) {
          grid.scrollLeft = Math.max(0, x - grid.clientWidth / 2);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const togglePlay = async () => {
    if (isPlaying) {
      Tone.getTransport().pause();
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
    } else {
      await scheduleAndStart();
    }
  };

  const stop = () => {
    const t = Tone.getTransport();
    t.stop();
    t.seconds = loopEnabled && loopRegion ? loopRegion.startSec : 0; // keep stop consistent
    setIsPlaying(false);
    setPlayheadBeat(loopEnabled && loopRegion ? loopRegion.startSec / secPerBeat : 0);
    cancelAnimationFrame(rafRef.current);
  };

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      try {
        Tone.getTransport().stop();
        Tone.getTransport().cancel(0);
      } catch {}
    };
  }, []);

  // ---- selection helpers ----
  const isSelected = (id) => selectedIds.has(id);
  const setSelection = (ids) => setSelectedIds(new Set(ids));
  const toggleInSelection = (id) => setSelectedIds((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e) => {
      const targetIsInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
      if (targetIsInput) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size) {
        e.preventDefault();
        setClips((prev) => prev.filter((c) => !selectedIds.has(c.id)));
        setSelectedIds(new Set());
        setLastSelectionWasBox(false);
      } else if ((e.key.toLowerCase() === 'd') && (e.ctrlKey || e.metaKey) && selectedIds.size) {
        e.preventDefault();
        setClips((prev) => {
          const copies = prev.filter(c => selectedIds.has(c.id)).map((c) => ({
            ...c,
            id: c.id + '-dup-' + Date.now() + Math.random().toString(36).slice(2,4),
            startBeat: snap16(c.startBeat + 1),
          }));
          return [...prev, ...copies];
        });
      } else if (selectedIds.size && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const dBeat = (e.key === 'ArrowLeft' ? -0.25 : e.key === 'ArrowRight' ? 0.25 : 0);
        const dLane = (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0);
        setClips((prev) => prev.map((c) =>
          selectedIds.has(c.id)
            ? {
                ...c,
                startBeat: snap16(c.startBeat + dBeat),
                lane: clamp(c.lane + dLane, 0, lanes - 1),
              }
            : c
        ));
      } else if (e.key === 'Escape') {
        setSelectedIds(new Set());
        setBox(null);
        setPickingLoop(false);
        setPendingLoopPoints([]);
        setLastSelectionWasBox(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, lanes]);

  // ---- lane UI ----
  const updateLaneName = (i, name) =>
    setLaneMeta((prev) => prev.map((m, idx) => (idx === i ? { ...m, name } : m)));
  const updateLaneColor = (i, color) =>
    setLaneMeta((prev) => prev.map((m, idx) => (idx === i ? { ...m, color } : m)));
  const toggleMute = (i) =>
    setLaneMeta((prev) => prev.map((m, idx) => (idx === i ? { ...m, mute: !m.mute } : m)));
  const toggleSolo = (i) =>
    setLaneMeta((prev) => prev.map((m, idx) => (idx === i ? { ...m, solo: !m.solo } : m)));

  // ---- drag & drop (move/resize/copy) ----
  const startDrag = (mode, startEvent, baseClips, clone) => {
    const grid = gridRef.current;
    const rect = grid.getBoundingClientRect();
    const xInGrid = startEvent.clientX - rect.left + grid.scrollLeft - LANE_GUTTER;
    const yInGrid = startEvent.clientY - rect.top;
    const startBeat = pxToBeat(xInGrid);
    const startLane = clamp(Math.floor(yInGrid / LANE_HEIGHT), 0, lanes - 1);

    dragRef.current = { mode, baseClips, startBeat, startLane, clone: !!clone };
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
  };

const onClipMouseDown = (e, clip, handle = null) => {
  e.stopPropagation();
  if (pickingLoop) return;

  const wasShift = e.shiftKey;
  let nextSelected = new Set(selectedIds);

  const keepBoxGroup =
    lastSelectionWasBox && nextSelected.size > 1 && nextSelected.has(clip.id);

  if (wasShift) {
    // Shift toggles membership but does NOT establish a "box group"
    if (nextSelected.has(clip.id)) nextSelected.delete(clip.id);
    else nextSelected.add(clip.id);
    setLastSelectionWasBox(false);
  } else if (!keepBoxGroup) {
    // Plain click focuses to this clip unless we are clicking inside a box group
    nextSelected = new Set([clip.id]);
    setLastSelectionWasBox(false);
  }
  // else: keep the whole box group as-is

  setSelectedIds(nextSelected);

  const baseClips = clips
    .filter(c => nextSelected.has(c.id))
    .map(c => ({ ...c }));

  if (handle === 'l' || handle === 'r') {
    startDrag(handle === 'l' ? 'resize-l' : 'resize-r', e, baseClips, false);
  } else {
    const isAlt = e.altKey || e.metaKey; // optional clone
    startDrag('move', e, baseClips, isAlt);
  }
};



  const onDragMove = (e) => {
    const ds = dragRef.current;
    if (!ds || pickingLoop) return;

    const grid = gridRef.current;
    const rect = grid.getBoundingClientRect();
    const xInGrid = e.clientX - rect.left + grid.scrollLeft - LANE_GUTTER;
    const yInGrid = e.clientY - rect.top;

    const curBeat = snap16(pxToBeat(xInGrid));
    const lane = clamp(Math.floor(yInGrid / LANE_HEIGHT), 0, lanes - 1);
    const dBeat = curBeat - snap16(ds.startBeat);

    setClips((prev) => {
      const setIds = new Set(ds.baseClips.map(c => c.id));
      return prev.map((c) => {
        if (!setIds.has(c.id)) return c;
        const base = ds.baseClips.find(b => b.id === c.id);
        if (!base) return c;

        if (ds.mode === 'move') {
          const newStart = snap16(base.startBeat + dBeat);
          const newLane = clamp(base.lane + (lane - ds.startLane), 0, lanes - 1);
          return { ...c, startBeat: newStart, lane: newLane };
        } else if (ds.mode === 'resize-l') {
          const right = base.startBeat + base.lengthBeats;
          let newStart = snap16(Math.min(right - 0.25, Math.max(0, curBeat)));
          let newLen = Math.max(0.25, snap16(right - newStart));
          return { ...c, startBeat: newStart, lengthBeats: newLen };
        } else if (ds.mode === 'resize-r') {
          let newLen = Math.max(0.25, snap16(curBeat - base.startBeat));
          return { ...c, lengthBeats: newLen };
        }
        return c;
      });
    });
  };

  const onDragEnd = () => {
    const ds = dragRef.current;
    dragRef.current = null;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);

    if (!ds || !ds.clone || pickingLoop) return;

    setClips((prev) => {
      const baseMap = new Map(ds.baseClips.map(c => [c.id, c]));
      const clones = [];
      const restored = prev.map((c) => {
        if (!baseMap.has(c.id)) return c;
        const current = c;
        const original = baseMap.get(c.id);
        const dup = { ...current, id: current.id + '-clone-' + Date.now() + Math.random().toString(36).slice(2,3) };
        clones.push(dup);
        return original;
      });
      return [...restored, ...clones];
    });
  };

  // ---- grid mouse for loop picking and box select ----
  const onGridMouseDown = (e) => {
    const grid = gridRef.current;

    // If we are picking loop points, consume the click and do not start box select
    if (pickingLoop) {
      const rect = grid.getBoundingClientRect();
      const xInGridPx = e.clientX - rect.left + grid.scrollLeft - LANE_GUTTER;
      const clampedPx = Math.max(0, Math.min(xInGridPx, totalWidthPx));

      // Snap to 1/16th grid for neat looping
      const beat = snap16(pxToBeat(clampedPx));
      const sec = beat * secPerBeat;

      setPendingLoopPoints((prev) => {
        const next = [...prev, sec];
        if (next.length < 2) return next;

        const [a, b] = next;
        const startSec = Math.max(0, Math.min(a, b));
        const endSecRaw = Math.min(totalSeconds, Math.max(a, b));
        const MIN_SPAN = 0.1; // 100 ms minimum to avoid a zero-length loop
        const endSec = (endSecRaw - startSec < MIN_SPAN) ? startSec + MIN_SPAN : endSecRaw;

        // Apply immediately
        setLoopRegion({ startSec, endSec });
        setLoopEnabled(true);

        // Jump the playhead now
        setPlayheadBeat(startSec / secPerBeat);
        try { Tone.getTransport().seconds = startSec; } catch {}

        setPickingLoop(false);
        return [];
      });

      return;
    }

    // Start box select (only if not clicking a clip)
    if (e.target.getAttribute('data-clip') === '1') return;
    setSelectedIds(new Set());
    setBox({ active: true, x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
  };

  useEffect(() => {
    if (!box?.active) return;
    const finish = () => {
      setBox((b) => {
        if (!b) return null;
        const grid = gridRef.current;
        const rectGrid = grid.getBoundingClientRect();

        const leftPx = Math.min(b.x1, b.x2) - rectGrid.left + grid.scrollLeft - LANE_GUTTER;
        const rightPx = Math.max(b.x1, b.x2) - rectGrid.left + grid.scrollLeft - LANE_GUTTER;
        const topPx = Math.min(b.y1, b.y2) - rectGrid.top;
        const bottomPx = Math.max(b.y1, b.y2) - rectGrid.top;

        const sel = [];
        clips.forEach((c) => {
          const cLeft = beatToPx(c.startBeat);
          const cRight = beatToPx(c.startBeat + c.lengthBeats);
          const cTop = c.lane * LANE_HEIGHT + 6;
          const cBottom = cTop + (LANE_HEIGHT - 12);
          const overlap = !(cLeft > rightPx || cRight < leftPx || cTop > bottomPx || cBottom < topPx);
          if (overlap) sel.push(c.id);
        });
        setSelection(sel);
        setLastSelectionWasBox(sel.length > 1); // NEW: remember if this was a box group
        return null;
      });
      window.removeEventListener('mouseup', finish);
    };
    window.addEventListener('mouseup', finish);
    return () => window.removeEventListener('mouseup', finish);
  }, [box, clips, pxPerBeat]);

  // ---- computed playhead (only declared once) ----
  const playheadX = LANE_GUTTER + playheadBeat * pxPerBeat;

  const clearDraft = () => localStorage.removeItem(DRAFT_KEY);

  // ===== Import Patch (saved + posted) → into a selected lane at playhead =====
  const [patches, setPatches] = useState([]);
  const [selectedPatchId, setSelectedPatchId] = useState('');
  const [selectedImportLane, setSelectedImportLane] = useState(0);
  const [isFetchingPatches, setIsFetchingPatches] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const loadPatches = async () => {
    setIsFetchingPatches(true);
    setFetchError('');
    try {
      const list = await loadUserPatches();
      setPatches(list);
    } catch (err) {
      console.error('Failed to load patches for import:', err);
      setFetchError('Could not load your patches.');
      setPatches([]);
    } finally {
      setIsFetchingPatches(false);
    }
  };

  useEffect(() => {
    loadPatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importPatchIntoLane = () => {
    if (!selectedPatchId) return;
    const p = patches.find(pp => String(pp.id) === String(selectedPatchId));
    if (!p) return;

    const lane = clamp(Number(selectedImportLane) || 0, 0, Math.max(0, lanes - 1));

    // Insert at current playhead (snapped), fallback to 0
    const startBeatLocal = snap16(playheadBeat || 0);
    const lengthBeatsLocal = 1;

    const label =
      p.displayName?.trim?.() ||
      p.name?.trim?.() ||
      laneMeta?.[lane]?.name ||
      `Lane ${lane + 1}`;

    const clip = {
      id: `${lane}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      lane,
      startBeat: startBeatLocal,
      lengthBeats: lengthBeatsLocal,
      label,
      patch: toSerializablePatch(p),
    };

    setClips(prev => [...prev, clip]);

    const neededBeats = Math.ceil(startBeatLocal + lengthBeatsLocal);
    if (neededBeats > lengthBeats) setLengthBeats(neededBeats);
    if (lane + 1 > lanes) setLanes(Math.max(LANES_MIN, lane + 1));
  };
  // ===== END Import =====

  // ----- render -----
  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <button onClick={togglePlay}>{isPlaying ? 'Pause' : 'Play'}</button>
        <button onClick={stop}>Stop</button>

        {/* Loop controls */}
        {!loopEnabled && !pickingLoop && (
          <button
            onClick={() => { setPickingLoop(true); setPendingLoopPoints([]); }}
            title="Click twice on the grid to set loop start and end"
          >
            Set loop region
          </button>
        )}
        {pickingLoop && (
          <span style={{ fontStyle: 'italic' }}>
            Picking loop... click {pendingLoopPoints.length === 0 ? 'start' : 'end'}
          </span>
        )}
        {loopEnabled && !pickingLoop && (
          <>
            <span style={{ fontFamily: 'monospace' }}>
              Loop: {fmtTime(loopRegion?.startSec ?? 0)} - {fmtTime(loopRegion?.endSec ?? 0)}
            </span>
            <button
              onClick={() => {
                setLoopEnabled(false);
                setLoopRegion(null);
                setPlayheadBeat(0);
                try { Tone.getTransport().seconds = 0; } catch {}
              }}
            >
              Clear loop
            </button>
          </>
        )}

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={followOn} onChange={(e) => setFollowOn(e.target.checked)} />
          Follow
        </label>

        <label>BPM:&nbsp;
          <input type="number" value={bpm}
                 onChange={(e)=>setBpm(Math.max(1, parseInt(e.target.value||'120',10)))}
                 style={{ width: 80 }} />
        </label>
        <label>Length (beats):&nbsp;
          <input type="number" value={lengthBeats}
                 onChange={(e)=>setLengthBeats(Math.max(1, parseInt(e.target.value||'1',10)))}
                 style={{ width: 110 }} />
        </label>
        <label>Zoom (px/beat):&nbsp;
          <input type="range" min="30" max="200" step="2" value={pxPerBeat}
                 onChange={(e)=>setPxPerBeat(parseInt(e.target.value,10))}
                 style={{ width: 220 }} />
          &nbsp;<span style={{ fontVariantNumeric: 'tabular-nums' }}>{pxPerBeat}</span>
        </label>

        <button onClick={() => setShowImportMap(true)}>Import Channelrack...</button>

        {/* Import Patch into lane */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <label htmlFor="importPatchSelect" style={{ fontWeight: 600 }}>Import Patch:</label>
          <select
            id="importPatchSelect"
            value={selectedPatchId}
            onChange={(e) => setSelectedPatchId(e.target.value)}
            disabled={isFetchingPatches}
          >
            <option value="">{isFetchingPatches ? 'Loading...' : 'Select a patch...'}</option>
            {patches.map((p) => (
              <option key={p.id} value={p.id}>
                {(p.name && p.name.trim()) || `Patch ${p.id}`} {p.is_posted ? '(posted)' : '(saved)'}
              </option>
            ))}
          </select>

          <label htmlFor="importLaneSelect">to lane:</label>
          <select
            id="importLaneSelect"
            value={selectedImportLane}
            onChange={(e) => setSelectedImportLane(parseInt(e.target.value, 10))}
          >
            {Array.from({ length: Math.max(lanes, LANES_MIN) }).map((_, i) => (
              <option key={i} value={i}>
                {laneMeta[i]?.name || `Lane ${i + 1}`}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={importPatchIntoLane}
            disabled={!selectedPatchId || isFetchingPatches}
            title="Insert the selected patch as a clip on the chosen lane at the current playhead"
          >
            Add to Lane
          </button>

          <button
            type="button"
            onClick={loadPatches}
            disabled={isFetchingPatches}
            title="Reload your saved and posted patches"
          >
            Reload
          </button>

          {fetchError ? <span style={{ color: 'crimson' }}>{fetchError}</span> : null}
        </div>

        <div style={{ marginLeft: 'auto', display:'flex', gap:8 }}>
          <div style={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
            Hover:&nbsp;{hoverSeconds == null ? '—' : fmtTime(hoverSeconds)}
          </div>
          <button onClick={() => { localStorage.removeItem(DRAFT_KEY); }} title="Remove saved draft from localStorage">Clear Draft</button>
        </div>
      </div>

      {/* Time ruler (seconds only) */}
      <div
        ref={rulerRef}
        style={{
          position: 'relative',
          height: 40,
          border: '1px solid #ccc',
          borderBottom: 'none',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          background: '#fff',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: totalWidthPx + LANE_GUTTER,
            height: '100%',
            marginLeft: LANE_GUTTER,
          }}
        >
          {ticks.major.map((t, i) => (
            <div key={`maj-${i}`} style={{ position: 'absolute', left: t.x, bottom: 0, width: 1, height: '100%' }}>
              <div style={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: 16, background: '#555' }} />
              <div
                style={{
                  position: 'absolute',
                  transform: 'translateX(-50%)',
                  bottom: 2,
                  fontSize: 12,
                  color: '#333',
                  fontFamily: 'monospace',
                  fontVariantNumeric: 'tabular-nums',
                  background: 'rgba(255,255,255,0.85)',
                  padding: '0 4px',
                  borderRadius: 3,
                }}
              >
                {fmtTime(i)}
              </div>
            </div>
          ))}
          {ticks.minor.map((t, i) => (
            <div key={`min-${i}`} style={{ position: 'absolute', left: t.x, bottom: 0, width: 1, height: 8, background: '#bbb' }} />
          ))}
        </div>
      </div>

      {/* Scrollable timeline */}
      <div
        ref={gridRef}
        onMouseDown={onGridMouseDown}
        onMouseMove={onMouseMoveGrid}
        onMouseLeave={clearHover}
        style={{
          position: 'relative',
          border: '1px solid #ccc',
          overflowX: 'auto',
          overflowY: 'hidden',
          height: LANE_HEIGHT * lanes + 2,
          userSelect: 'none',
          cursor: pickingLoop ? 'crosshair' : (box?.active ? 'crosshair' : 'default'),
        }}
      >
        {/* Lane labels (name/color + M/S) */}
        <div
          style={{
            position: 'sticky',
            left: 0,
            top: 0,
            width: LANE_GUTTER,
            height: '100%',
            background: '#fafafa',
            borderRight: '1px solid #ddd',
            zIndex: 2,
            boxSizing: 'border-box',
            padding: '0 8px',
          }}
        >
          {Array.from({ length: lanes }).map((_, i) => {
            const meta = laneMeta[i] || defaultLaneMeta(i);
            return (
              <div
                key={i}
                style={{
                  height: LANE_HEIGHT,
                  display: 'grid',
                  gridTemplateColumns: '24px 1fr auto auto',
                  alignItems: 'center',
                  columnGap: 8,
                  borderBottom: '1px solid #eee',
                  paddingRight: 6,
                }}
              >
                <input
                  type="color"
                  value={meta.color}
                  onChange={(e) => updateLaneColor(i, e.target.value)}
                  title="Lane color"
                  style={{ width: 24, height: 24, border: 'none', background: 'transparent', cursor: 'pointer' }}
                />
                <input
                  value={meta.name}
                  onChange={(e) => updateLaneName(i, e.target.value)}
                  title="Lane name"
                  style={{ width: '100%', border: '1px solid #ddd', borderRadius: 6, padding: '4px 6px' }}
                />
                <button
                  onClick={() => toggleMute(i)}
                  title="Mute"
                  style={{
                    padding: '2px 6px',
                    borderRadius: 6,
                    border: '1px solid #ccc',
                    background: meta.mute ? '#ffebee' : '#fff',
                    color: meta.mute ? '#d32f2f' : '#333',
                  }}
                >M</button>
                <button
                  onClick={() => toggleSolo(i)}
                  title="Solo"
                  style={{
                    padding: '2px 6px',
                    borderRadius: 6,
                    border: '1px solid #ccc',
                    background: meta.solo ? '#e8f5e9' : '#fff',
                    color: meta.solo ? '#2e7d32' : '#333',
                  }}
                >S</button>
              </div>
            );
          })}
        </div>

        {/* Grid background */}
        <div
          style={{
            position: 'absolute',
            left: LANE_GUTTER,
            top: 0,
            height: '100%',
            width: totalWidthPx,
            backgroundImage: `
              linear-gradient(#eee 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.12) 1px, transparent 1px)
            `,
            backgroundSize: `
              100% ${LANE_HEIGHT}px,
              ${pxPerBeat/4}px 100%,
              ${pxPerBeat}px 100%
            `,
            zIndex: 0,
          }}
        />

        {/* Loop overlay */}
        {loopEnabled && loopRegion && loopRegion.endSec > loopRegion.startSec && (
          <div
            style={{
              position: 'absolute',
              left: LANE_GUTTER + secToPx(loopRegion.startSec),
              top: 0,
              width: Math.max(2, secToPx(loopRegion.endSec) - secToPx(loopRegion.startSec)),
              height: '100%',
              background: '#81c78455',
              borderLeft: '2px solid #2e7d32',
              borderRight: '2px solid #2e7d32',
              pointerEvents: 'none',
              zIndex: 1
            }}
            title={`Loop ${fmtTime(loopRegion.startSec)} -> ${fmtTime(loopRegion.endSec)}`}
          />
        )}

        {/* Clips */}
        <div style={{ position: 'absolute', left: LANE_GUTTER, top: 0, height: '100%', width: totalWidthPx }}>
          {clips.map((c) => {
            const left = c.startBeat * pxPerBeat;
            const width = Math.max(6, c.lengthBeats * pxPerBeat - 2);
            const top = c.lane * LANE_HEIGHT + 6;
            const meta = laneMeta[c.lane] || defaultLaneMeta(c.lane);
            const laneColor = meta.color || '#cfe8ff';
            const sel = isSelected(c.id);
            return (
              <div
                key={c.id}
                data-clip="1"
                onMouseDown={(e) => {
                  if (pickingLoop) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  if (x <= 8) onClipMouseDown(e, c, 'l');
                  else if (x >= rect.width - 8) onClipMouseDown(e, c, 'r');
                  else onClipMouseDown(e, c, null);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                }}

                title={`${c.label} @ ${fmtTime(c.startBeat * secPerBeat)} • ${meta.name}`}
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width,
                  height: LANE_HEIGHT - 12,
                  background: laneColor + '33',
                  border: `2px solid ${sel ? '#ff5a5a' : laneColor}`,
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  cursor: pickingLoop ? 'crosshair' : 'grab',
                }}
              >
                {/* resize handles */}
                <div
                  style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0, width: 8,
                    cursor: 'ew-resize', background: sel ? '#00000012' : 'transparent',
                  }}
                />
                <div
                  style={{
                    position: 'absolute', right: 0, top: 0, bottom: 0, width: 8,
                    cursor: 'ew-resize', background: sel ? '#00000012' : 'transparent',
                  }}
                />
                <div style={{ padding: '4px 8px', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Playhead */}
        <div
          style={{
            position: 'absolute',
            left: Math.max(LANE_GUTTER, playheadX),
            top: 0,
            width: 1,
            height: '100%',
            background: '#ff5a5a',
            opacity: 0.75,
            pointerEvents: 'none',
          }}
        />

        {/* Box select overlay */}
        {box?.active && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(box.x1, box.x2) - gridRef.current.getBoundingClientRect().left + gridRef.current.scrollLeft,
              top: Math.min(box.y1, box.y2) - gridRef.current.getBoundingClientRect().top,
              width: Math.abs(box.x2 - box.x1),
              height: Math.abs(box.y2 - box.y1),
              border: '1px dashed #2a63d4',
              background: '#2a63d433',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {/* Import mapping modal */}
      {showImportMap && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex',
          alignItems:'center', justifyContent:'center', zIndex: 50
        }}>
          <div style={{ background:'#fff', padding:16, borderRadius:8, width:620, maxHeight:'80vh', overflow:'auto' }}>
            <h3 style={{ marginTop:0 }}>Import from Channel Rack</h3>
            <p>Select the target lane for each rack channel:</p>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 160px', gap:8 }}>
              {channels.map((ch, idx) => (
                <React.Fragment key={idx}>
                  <div style={{ padding:'6px 0' }}>
                    <strong>Rack {idx + 1}</strong> — {ch?.patch?.displayName || ch?.patch?.name || '(empty)'}
                  </div>
                  <select
                    value={importMap[idx] ?? Math.min(idx, Math.max(lanes - 1, 0))}
                    onChange={(e)=>setImportMap(m => ({ ...m, [idx]: parseInt(e.target.value,10) }))}
                  >
                    {Array.from({ length: Math.max(lanes, channels.length) }).map((_, laneIdx) => (
                      <option key={laneIdx} value={laneIdx}>
                        {laneMeta[laneIdx]?.name || `Lane ${laneIdx + 1}`}
                      </option>
                    ))}
                  </select>
                </React.Fragment>
              ))}
            </div>

            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
              <button onClick={()=>setShowImportMap(false)}>Cancel</button>
              <button onClick={doImportMapped}>Import</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
