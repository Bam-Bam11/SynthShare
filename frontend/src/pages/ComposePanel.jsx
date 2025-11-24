// src/pages/ComposePanel.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as Tone from 'tone';
import { useChannelRack } from '../context/ChannelRackContext';
import PlayPatch from '../components/PlayPatch';
import API from '../api';

// ---- constants ----
const LANES_MIN = 8;
const LANE_HEIGHT = 48;
const LANE_GUTTER = 220;            // space for name/color + M/S buttons
const INITIAL_PX_PER_BEAT = 60;     // pixels per beat (zoom)
const DEFAULT_BPM = 120;
const DEFAULT_BEATS = 64;           // visible beats
const DRAFT_KEY = 'trackDraft_v9';  // bump on schema changes

// Server mount points (resolved via axios baseURL)
const PATCH_BASES = ['/patches/'];
const TRACK_BASES = ['/tracks/'];

// ---- shared button styles (use global tokenised classes) ----
const BTN = {
  play: 'btn btn-play',
  stop: 'btn btn-stop',
  loop: 'btn btn-loop',
  warning: 'btn btn-warning',
  refresh: 'btn btn-refresh',
  save: 'btn btn-primary btn-save',
  download: 'btn btn-info btn-download',
  neutral: 'btn',                       // default neutral button
  ghost: 'btn-ghost',
  danger: 'btn btn-danger',
  add: 'btn btn-add',
  disabled: 'opacity-60 cursor-not-allowed',
};

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

// NEW: Convert Tone.js durations to beats
const convertDurationToBeats = (duration, bpm = 120) => {
  if (typeof duration === 'number') {
    return duration; // Assume it's already in beats
  }
  
  // Convert Tone.js duration strings to beats
  const durationMap = {
    '1n': 4,    // whole note = 4 beats
    '2n': 2,    // half note = 2 beats  
    '4n': 1,    // quarter note = 1 beat
    '8n': 0.5,  // eighth note = 0.5 beats
    '16n': 0.25, // sixteenth note = 0.25 beats
    '32n': 0.125 // thirty-second note = 0.125 beats
  };
  
  return durationMap[duration] || 1; // Default to 1 beat
};

// Extract a patch id from various shapes we might see
const getPatchId = (p) => {
  if (!p) return null;
  if (typeof p === 'number') return p;
  if (typeof p === 'string' && /^\d+$/.test(p)) return Number(p);
  const direct =
    p.id ?? p.patch_id ?? p.patchId ?? p._id ??
    (typeof p.patch === 'number' ? p.patch : null) ??
    (typeof p.patch === 'string' && /^\d+$/.test(p.patch) ? Number(p.patch) : null) ??
    (p.patch && (p.patch.id ?? p.patch.patch_id ?? p.patch.patchId ?? p.patch._id));
  return (typeof direct === 'number' || typeof direct === 'string') ? Number(direct) : null;
};

// serialisable patch summary only (for persistence & quick labels)
const toSerializablePatch = (p) => {
  if (!p) return null;
  const id = getPatchId(p);
  return {
    id: id ?? null,
    name: p.name ?? p.displayName ?? null,
    displayName: p.displayName ?? null,
    note: p.note ?? 'C4',
    duration: p.duration ?? '8n', // Preserve duration
    parameters: p.parameters ?? p.params ?? null,
    is_deleted: p.is_deleted ?? false,
  };
};

// Normalise any server Patch payload into what PlayPatch/UI expect
const normalizeServerPatch = (p, idOverride = null) => {
  const id = idOverride ?? getPatchId(p) ?? null;
  const nameLike = p?.displayName ?? p?.name ?? p?.title ?? null;
  const params = p?.parameters ?? p?.params ?? p?.patch_snapshot ?? null;
  return {
    id,
    name: nameLike ?? (id != null ? `Patch ${id}` : null),
    displayName: nameLike ?? undefined,
    note: p?.note || 'C4',
    duration: p?.duration || '8n', // Preserve duration
    parameters: params,
    is_deleted: p?.is_deleted ?? false,
  };
};

// sync load draft once - NOW USER-SCOPED
const loadDraft = async () => {
  try {
    const userId = await getCurrentUserId();
    const userDraftKey = `${DRAFT_KEY}_${userId}`;
    const raw = localStorage.getItem(userDraftKey);
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

// ---------- API helpers ----------
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
    if (Array.isArray(data)) { out.push(...data); break; }
    const results = Array.isArray(data?.results) ? data.results : [];
    out.push(...results);
    if (!data?.next) break;
    page += 1;
  }
  return out;
}

// UPDATED: Filter out deleted patches from import list
async function loadUserPatches() {
  const uid = await getCurrentUserId();
  for (const base of PATCH_BASES) {
    try { 
      const patches = await fetchAllPatchesForUser(uid, base);
      // Filter out deleted patches from the import list
      return patches.filter(patch => !patch.is_deleted);
    }
    catch { /* try next base */ }
  }
  return [];
}

// UPDATED: Handle deleted tracks
async function fetchTrackById(trackId) {
  for (const base of TRACK_BASES) {
    try {
      const { data } = await API.get(`${base}${trackId}/`);
      // Check if track is deleted and handle appropriately
      if (data.is_deleted) {
        throw new Error('This track has been deleted');
      }
      return data; // composition-based now
    } catch { /* try next base */ }
  }
  throw new Error('Could not fetch track');
}

// UPDATED: Handle deleted patches
async function fetchPatchById(id) {
  for (const base of PATCH_BASES) {
    try {
      const { data } = await API.get(`${base}${id}/`);
      // Check if patch is deleted and handle appropriately
      if (data.is_deleted) {
        throw new Error('This patch has been deleted');
      }
      return data;
    } catch { /* try next base */ }
  }
  throw new Error('Patch not found');
}

// -----------------------------------------------------------------

export default function ComposePanel() {
  // Channel Rack
  const rack = useChannelRack();
  const channels = Array.isArray(rack.channels) ? rack.channels : [];

  // State for draft loading
  const [draft, setDraft] = useState(null);
  const [draftLoaded, setDraftLoaded] = useState(false);

  // Track loading state
  const [hasLoadedTrack, setHasLoadedTrack] = useState(false);
  const [isLoadingTrack, setIsLoadingTrack] = useState(false);

  // Load user-scoped draft on component mount
  useEffect(() => {
    const loadUserDraft = async () => {
      try {
        const userDraft = await loadDraft();
        setDraft(userDraft);
      } catch (error) {
        console.warn('Could not load user draft:', error);
        setDraft(null);
      } finally {
        setDraftLoaded(true);
      }
    };
    loadUserDraft();
  }, []);

  // ---- core timeline state ----
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [lanes, setLanes] = useState(LANES_MIN);
  const [pxPerBeat, setPxPerBeat] = useState(INITIAL_PX_PER_BEAT);
  const [lengthBeats, setLengthBeats] = useState(DEFAULT_BEATS);
  const [clips, setClips] = useState([]);

  // lane metadata (name/color/mute/solo)
  const [laneMeta, setLaneMeta] = useState(() => 
    Array.from({ length: LANES_MIN }, (_, i) => defaultLaneMeta(i))
  );

  // project meta + save
  const [projectName, setProjectName] = useState('Untitled');
  const [projectDesc, setProjectDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [trackId, setTrackId] = useState(null);

  // Keep lineage hints between saves (root/stem)
  const lineageRef = useRef({ root: null, stem: null });
  // Add this ref to track loading state
  const isProcessingLoadRef = useRef(false);
  // Add this ref to track current clips for confirmation dialogs
  const clipsRef = useRef([]);
  // Add this ref to prevent draft interference during track loading
  const isLoadingTrackRef = useRef(false);

  // Initialize state from draft once it's loaded - BUT skip if we're loading a track
  useEffect(() => {
    if (draftLoaded && draft && !isLoadingTrackRef.current) {
      setBpm(typeof draft.bpm === 'number' ? draft.bpm : DEFAULT_BPM);
      setLanes(typeof draft.lanes === 'number' ? Math.max(LANES_MIN, draft.lanes) : LANES_MIN);
      setPxPerBeat(typeof draft.pxPerBeat === 'number' ? Math.max(10, draft.pxPerBeat) : INITIAL_PX_PER_BEAT);
      setLengthBeats(typeof draft.lengthBeats === 'number' ? Math.max(1, draft.lengthBeats) : DEFAULT_BEATS);
      setClips(Array.isArray(draft.clips) ? draft.clips : []);
      setProjectName(draft.projectName || 'Untitled');
      setProjectDesc(draft.projectDesc || '');
      
      // Initialize laneMeta from draft or create defaults
      if (Array.isArray(draft.laneMeta) && draft.laneMeta.length > 0) {
        const draftLanes = typeof draft.lanes === 'number' ? Math.max(LANES_MIN, draft.lanes) : LANES_MIN;
        const laneMetaFromDraft = draft.laneMeta.slice(0, draftLanes);
        while (laneMetaFromDraft.length < draftLanes) {
          laneMetaFromDraft.push(defaultLaneMeta(laneMetaFromDraft.length));
        }
        setLaneMeta(laneMetaFromDraft);
      }
    }
  }, [draftLoaded, draft]);

  // If we came from /tracks/:id/edit, capture the id from route
  const { id: routeTrackId } = useParams();
  useEffect(() => {
    if (routeTrackId) setTrackId(routeTrackId);
  }, [routeTrackId]);

  // ensure laneMeta size follows lanes
  useEffect(() => {
    setLaneMeta((prev) => {
      const out = prev.slice(0, lanes);
      while (out.length < lanes) out.push(defaultLaneMeta(out.length));
      return out;
    });
  }, [lanes]);

  // Update clipsRef whenever clips change
  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  // ===== FIXED: Load track data from localStorage (fork/edit) =====
  useEffect(() => {
    if (!draftLoaded || isProcessingLoadRef.current) return;
    
    const loadTrackData = async () => {
      // Use ref to get current clips value to avoid stale closure
      const currentClips = clipsRef.current;
      
      try {
        const raw = localStorage.getItem('trackToLoad');
        if (!raw) return;
        
        const seed = JSON.parse(raw);
        console.log('[localStorage] Loading track data into composer from localStorage:', seed);

        // Check if there are existing clips and ask for confirmation
        if (currentClips.length > 0) {
          const shouldOverwrite = window.confirm(
            'You have unsaved changes in your current project. Do you want to overwrite them with the selected track?'
          );
          
          if (!shouldOverwrite) {
            console.log('[localStorage] User cancelled track load to preserve current work');
            localStorage.removeItem('trackToLoad');
            return;
          }
        }

        // Set loading flags IMMEDIATELY
        isProcessingLoadRef.current = true;
        setIsLoadingTrack(true);
        isLoadingTrackRef.current = true; // Prevent draft interference
        
        // MARK AS LOADED FROM LOCALSTORAGE FIRST - this prevents hydrate
        setHasLoadedTrack(true);

        // Clear the storage FIRST so hydrate doesn't trigger prematurely
        localStorage.removeItem('trackToLoad');

        // Clear existing state first
        setProjectName(seed.name || 'Untitled');
        setProjectDesc(seed.description || '');
        setBpm(seed.bpm || DEFAULT_BPM);
        setClips([]); // IMPORTANT: Clear clips immediately

        // Set lineage for saving
        lineageRef.current = {
          root: seed.root || seed.id || null,
          stem: seed.id || null,
        };

        let newClips = [];
        
        // If we have pre-loaded patches and composition, use them
        if (seed.patches && seed.normalizedComposition) {
          console.log('[localStorage] Loading from normalized composition with patches:', seed.patches);
          
          newClips = seed.normalizedComposition.map((clip, i) => {
            const patchData = seed.patches[clip.patchId];
            console.log(`[localStorage] Clip ${i}:`, clip, 'Patch data:', patchData);
            
            const labelText = patchData?.displayName || patchData?.name || 
                            (clip.patchId ? `Patch ${clip.patchId}` : 'Patch');
            
            return {
              id: `seedc-${i}-${Date.now()}`,
              lane: Number(clip.lane ?? i),
              startBeat: clip.startBeat,
              lengthBeats: Math.max(0.25, clip.endBeat - clip.startBeat),
              label: labelText,
              patch: patchData || { id: clip.patchId || null },
            };
          });
        }
        // Handle case where we have composition data but no pre-loaded patches
        else if (seed.composition && Array.isArray(seed.composition.clips)) {
          console.log('[localStorage] Loading from composition.clips without pre-loaded patches');
          
          newClips = seed.composition.clips.map((clip, i) => {
            const start = Number((clip.start ?? clip.start_beat) ?? 0);
            const end = Number((clip.end ?? clip.end_beat) ?? start);
            const pid = getPatchId(clip.patch ?? clip.patch_id);
            
            return {
              id: `comp-${i}-${Date.now()}`,
              lane: Number(clip.lane ?? i),
              startBeat: start,
              lengthBeats: Math.max(0.25, end - start),
              label: `Patch ${pid ?? ''}`.trim(),
              patch: { id: pid || null },
            };
          });
        }
        else {
          console.warn('[localStorage] No valid track data found in seed:', seed);
          newClips = [];
        }

        console.log('[localStorage] Created new clips:', newClips);

        // Calculate layout requirements
        const maxLane = newClips.length > 0 ? Math.max(LANES_MIN, ...newClips.map(c => c.lane + 1)) : LANES_MIN;
        const lastEnd = newClips.length > 0 ? Math.max(0, ...newClips.map(c => c.startBeat + c.lengthBeats)) : DEFAULT_BEATS;
        
        // Update all state in a single batch to prevent race conditions
        setLanes(maxLane);
        setLengthBeats(Math.max(DEFAULT_BEATS, Math.ceil(lastEnd)));
        setClips(newClips); // Set clips last to ensure everything else is ready
        
        console.log(`[localStorage] Loaded ${newClips.length} clips, ${maxLane} lanes, ${lastEnd} beats`);

        // IMPORTANT: Set trackId LAST after all other state is populated
        // This prevents the hydrate effect from running prematurely
        if (seed.id) {
          console.log('[localStorage] Setting trackId to:', seed.id);
          setTrackId(seed.id);
        }
        
      } catch (error) {
        console.error('[localStorage] Failed to load track data:', error);
        localStorage.removeItem('trackToLoad');
        // Reset hasLoadedTrack on error
        setHasLoadedTrack(false);
      } finally {
        // Reset loading flags after a short delay to ensure track data is fully loaded
        setTimeout(() => {
          console.log('[localStorage] Resetting isLoading flags');
          isProcessingLoadRef.current = false;
          setIsLoadingTrack(false);
          isLoadingTrackRef.current = false;
        }, 1000);
      }
    };

    loadTrackData();
  }, [draftLoaded]); // Remove clips.length from dependencies to prevent infinite loops

  // ---- persist auto-draft on change - NOW USER-SCOPED ----
  useEffect(() => {
    if (!draftLoaded || isLoadingTrack || isLoadingTrackRef.current) return; // Don't persist if we're loading a track
      
    const persistDraft = async () => {
      try {
        const userId = await getCurrentUserId();
        const userDraftKey = `${DRAFT_KEY}_${userId}`;
        localStorage.setItem(
          userDraftKey,
          JSON.stringify({
            projectName,
            projectDesc,
            bpm, lanes, pxPerBeat, lengthBeats, clips, laneMeta
          })
        );
      } catch (e) {
        console.warn('Failed to save user track draft', e);
      }
    };

    persistDraft();
  }, [projectName, projectDesc, bpm, lanes, pxPerBeat, lengthBeats, clips, laneMeta, draftLoaded, isLoadingTrack]);

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
    candles(); // keep React hooks discipline happy (no-op)
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

  // APPEND imported patches; do not clear existing
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

      // 16 steps -> 16ths -> 1/4 beat per step
      ch.steps.forEach((on, stepIndex) => {
        if (!on) return;
        const startBeat = stepIndex / 4;
        
        // Use the patch's actual duration or default to 1 beat
        const patchDuration = ch.patch?.duration || '4n';
        const lengthBeatsLocal = convertDurationToBeats(patchDuration, bpm);

        const patchSer = toSerializablePatch(ch.patch);
        if (!patchSer?.id) {
          console.warn('Channel Rack patch missing id at rack', rackIdx, 'step', stepIndex, ch.patch);
        }

        newClips.push({
          id: `${targetLane}-${stepIndex}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          lane: targetLane,
          startBeat,
          lengthBeats: lengthBeatsLocal,
          label:
            ch.patch?.displayName ||
            ch.patch?.name ||
            (laneMeta?.[targetLane]?.name ?? `Ch ${targetLane + 1}`),
          patch: {
            ...patchSer,
            duration: patchDuration, // Preserve the original duration string
          },
        });
      });
    });

    if (!newClips.length) {
      alert('Nothing to import (no active steps found).');
      setShowImportMap(false);
      return;
    }

    setClips((prev) => {
      const merged = [...prev, ...newClips];
      const lastEndBeat = Math.max(0, ...merged.map(c => c.startBeat + c.lengthBeats));
      setLengthBeats((lb) => Math.max(lb, Math.ceil(lastEndBeat)));
      const maxLaneIdx = Math.max(-1, ...merged.map(c => c.lane));
      setLanes((ln) => Math.max(ln, maxLaneIdx + 1, LANES_MIN));
      return merged;
    });

    setShowImportMap(false);
  };

  // APPEND quick import (1:1 lanes)
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

        // Use the patch's actual duration or default to 1 beat
        const patchDuration = ch.patch?.duration || '4n';
        const lengthBeatsLocal = convertDurationToBeats(patchDuration, bpm);

        const patchSer = toSerializablePatch(ch.patch);
        if (!patchSer?.id) {
          console.warn('Channel Rack patch missing id at lane', lane, 'step', stepIndex, ch.patch);
        }

        newClips.push({
          id: `${lane}-${stepIndex}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          lane,
          startBeat: stepIndex / 4,
          lengthBeats: lengthBeatsLocal,
          label: ch.patch?.displayName || ch.patch?.name || `Ch ${lane + 1}`,
          patch: {
            ...patchSer,
            duration: patchDuration, // Preserve the original duration string
          },
        });
      });
    });

    if (newClips.length) {
      setClips((prev) => {
        const merged = [...prev, ...newClips];
        const lastEnd = Math.max(0, ...merged.map(c => c.startBeat + c.lengthBeats));
        setLengthBeats((lb) => Math.max(lb, Math.ceil(lastEnd)));
        const maxLaneIdx = Math.max(-1, ...merged.map(c => c.lane));
        setLanes((ln) => Math.max(ln, maxLaneIdx + 1, LANES_MIN));
        return merged;
      });
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

  // Keep Tone.Transport loop settings in sync with UI and jump playhead on change
  useEffect(() => {
    const transport = Tone.getTransport();
    if (loopEnabled && loopRegion && loopRegion.endSec > loopRegion.startSec) {
      transport.loop = true;
      transport.loopStart = loopRegion.startSec;
      transport.loopEnd = loopRegion.endSec;
      const startBeat = loopRegion.startSec / secPerBeat;
      setPlayheadBeat(startBeat);
      try { transport.seconds = loopRegion.startSec; } catch (e) {}
    } else {
      transport.loop = false;
      transport.loopStart = 0;
      transport.loopEnd = lengthBeats * secPerBeat;
      setPlayheadBeat(0);
      try { transport.seconds = 0; } catch (e) {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopEnabled, loopRegion]);

  // ===== scheduleAndStart with just-in-time enrichment AND duration handling =====
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

    // Determine playable clips (mute/solo aware)
    const anySolo = laneMeta.some(m => m.solo);
    const playable = clips.filter((clip) => {
      const lane = laneMeta[clip.lane];
      const lanePlayable = lane && (anySolo ? lane.solo : !lane.mute);
      const patchId = getPatchId(clip.patch);
      const isDeleted = clip.patch?.is_deleted;
      return lanePlayable && patchId != null && !isDeleted;
    });

    // Just-in-time enrichment: fetch any patches missing parameters or a name
    const idsNeeded = Array.from(new Set(playable.map(c => getPatchId(c.patch))));
    const missingIds = idsNeeded.filter(id => {
      const clip = playable.find(c => getPatchId(c.patch) === id);
      return !(clip?.patch?.parameters) || !(clip?.patch?.name || clip?.patch?.displayName);
    });

    let enrichMap = new Map();
    if (missingIds.length) {
      const fetched = await Promise.allSettled(missingIds.map(id => fetchPatchById(id)));
      fetched.forEach((res, i) => {
        const id = missingIds[i];
        if (res.status === 'fulfilled' && res.value) {
          enrichMap.set(id, normalizeServerPatch(res.value, id));
        } else if (res.status === 'rejected') {
          // Handle deleted patches - mark them as unavailable
          console.warn(`Patch ${id} could not be loaded:`, res.reason);
          enrichMap.set(id, { 
            id, 
            name: 'Unavailable Patch', 
            displayName: 'Unavailable Patch',
            note: 'C4',
            duration: '8n',
            parameters: null,
            is_deleted: true 
          });
        }
      });

      if (enrichMap.size) {
        // Update state so UI labels also improve
        setClips(prev =>
          prev.map((c) => {
            const id = getPatchId(c.patch);
            return enrichMap.has(id) ? { ...c, patch: enrichMap.get(id) } : c;
          })
        );
      }
    }

    // Schedule all playable clips with resolved parameters AND duration handling
    playable.forEach((clip) => {
      const pid = getPatchId(clip.patch);
      const resolved =
        clip.patch?.parameters
          ? clip.patch
          : (enrichMap.get(pid) ?? { ...clip.patch }); // if enrichment failed, still try

      if (!resolved?.parameters || resolved?.is_deleted) return; // cannot play without a synth snapshot or if deleted

      const triggerAtSec = clip.startBeat * secPerBeat;
      
      // NEW: Calculate the actual playback duration - the shorter of:
      // 1. The visual clip length (user-resized)
      // 2. The patch's configured duration
      const visualDurationSec = clip.lengthBeats * secPerBeat;
      const patchDurationSec = Tone.Time(resolved.duration || '8n').toSeconds();
      const actualDurationSec = Math.min(visualDurationSec, patchDurationSec);
      
      transport.schedule((time) => {
        try {
          PlayPatch({
            ...resolved,
            // ensure sane defaults
            note: resolved.note || 'C4',
            duration: actualDurationSec, // Use the shorter duration
          }, time);
        } catch (e) {
          console.warn('PlayPatch failed for patch', clip, e);
        }
      }, triggerAtSec);
    });

    // When not looping, schedule a hard stop at track end as a backup
    if (!(loopEnabled && loopRegion && loopRegion.endSec > loopRegion.startSec)) {
      const endSec = lengthBeats * secPerBeat;
      transport.scheduleOnce(() => {
        try {
          transport.stop();
          transport.seconds = 0;
        } catch (e) {}
        setIsPlaying(false);
        setPlayheadBeat(0);
        cancelAnimationFrame(rafRef.current);
      }, endSec + 0.0001);
    }

    const startAt = (loopEnabled && loopRegion) ? loopRegion.startSec : 0;
    transport.start('+0.0', startAt);
    setIsPlaying(true);

    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const transport = Tone.getTransport();
      const trackEndSec = lengthBeats * secPerBeat;
      const secNow = transport.seconds;

      const looping = loopEnabled && loopRegion && loopRegion.endSec > loopRegion.startSec;
      let followBeat;

      if (!looping) {
        if (secNow >= trackEndSec - 0.001) {
          try { transport.stop(); transport.seconds = 0; } catch (e) {}
          setIsPlaying(false);
          setPlayheadBeat(0);
          cancelAnimationFrame(rafRef.current);
          return;
        }
        const displaySec = Math.min(secNow, trackEndSec);
        followBeat = displaySec / secPerBeat;
        setPlayheadBeat(followBeat);
      } else {
        const start = loopRegion.startSec;
        const end = loopRegion.endSec;
        const span = Math.max(0.001, end - start);
        const phase = ((secNow - start) % span + span) % span;
        const displaySec = start + phase;
        followBeat = displaySec / secPerBeat;
        setPlayheadBeat(followBeat);
      }

      if (followOn && gridRef.current) {
        const x = followBeat * pxPerBeat + LANE_GUTTER;
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
    t.seconds = loopEnabled && loopRegion ? loopRegion.startSec : 0;
    setIsPlaying(false);
    setPlayheadBeat(loopEnabled && loopRegion ? loopRegion.startSec / secPerBeat : 0);
    cancelAnimationFrame(rafRef.current);
  };

  // ---- Start New Project (clear state) ----
  const startNewProject = async () => {
    try {
      const t = Tone.getTransport();
      t.stop();
      t.cancel(0);
    } catch {}
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;

    // Set loading flag to prevent draft persistence during reset
    setIsLoadingTrack(true);
    isLoadingTrackRef.current = true;

    // reset UI/transport state
    setIsPlaying(false);
    setPlayheadBeat(0);
    setLoopEnabled(false);
    setLoopRegion(null);
    setPickingLoop(false);
    setPendingLoopPoints([]);
    setSelectedIds(new Set());
    setBox(null);

    // reset project settings
    setProjectName('Untitled');
    setProjectDesc('');
    setBpm(DEFAULT_BPM);
    setPxPerBeat(INITIAL_PX_PER_BEAT);
    setLengthBeats(DEFAULT_BEATS);

    // reset lanes + meta
    setLanes(LANES_MIN);
    setLaneMeta(Array.from({ length: LANES_MIN }, (_, i) => defaultLaneMeta(i)));

    // clear placed patches
    setClips([]);

    // clear lineage / server link
    lineageRef.current = { root: null, stem: null };
    setTrackId(null);
    setHasLoadedTrack(false); // Reset track loading state

    // clear local persisted draft + any pending seed
    try { 
      const userId = await getCurrentUserId();
      const userDraftKey = `${DRAFT_KEY}_${userId}`;
      localStorage.removeItem(userDraftKey); 
    } catch {}
    try { localStorage.removeItem('trackToLoad'); } catch {}

    // Reset loading flag after state is cleared
    setTimeout(() => {
      setIsLoadingTrack(false);
      isLoadingTrackRef.current = false;
    }, 500);
  };

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      try {
        Tone.getTransport().stop();
        Tone.getTransport().cancel(0);
      } catch (e) {}
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
  
  // FIXED: Proper mute toggle functionality with visual feedback
  const toggleMute = (i) => {
    setLaneMeta((prev) => {
      const newMeta = prev.map((m, idx) => 
        idx === i ? { ...m, mute: !m.mute } : m
      );
      return newMeta;
    });
  };

  // FIXED: Proper solo toggle functionality  
  const toggleSolo = (i) => {
    setLaneMeta((prev) => {
      // If we're soloing this lane, unsolo all others
      const newMeta = prev.map((m, idx) => 
        idx === i 
          ? { ...m, solo: !m.solo } 
          : { ...m, solo: false }
      );
      return newMeta;
    });
  };

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
      if (nextSelected.has(clip.id)) nextSelected.delete(clip.id);
      else nextSelected.add(clip.id);
      setLastSelectionWasBox(false);
    } else if (!keepBoxGroup) {
      nextSelected = new Set([clip.id]);
      setLastSelectionWasBox(false);
    }
    setSelectedIds(nextSelected);

    const baseClips = clips.filter(c => nextSelected.has(c.id)).map(c => ({ ...c }));

    // Don't allow dragging/resizing of deleted patches
    if (clip.patch?.is_deleted) return;

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

        // Don't allow moving/resizing deleted patches
        if (c.patch?.is_deleted) return c;

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
        // Don't clone deleted patches
        if (current.patch?.is_deleted) return current;
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

    // loop picking
    if (pickingLoop) {
      const rect = grid.getBoundingClientRect();
      const xInGridPx = e.clientX - rect.left + grid.scrollLeft - LANE_GUTTER;
      const clampedPx = Math.max(0, Math.min(xInGridPx, totalWidthPx));
      const beat = snap16(pxToBeat(clampedPx));
      const sec = beat * secPerBeat;

      setPendingLoopPoints((prev) => {
        const next = [...prev, sec];
        if (next.length < 2) return next;

        const [a, b] = next;
        const startSec = Math.max(0, Math.min(a, b));
        const endSecRaw = Math.min(totalSeconds, Math.max(a, b));
        const MIN_SPAN = 0.1;
        const endSec = (endSecRaw - startSec < MIN_SPAN) ? startSec + MIN_SPAN : endSecRaw;

        setLoopRegion({ startSec, endSec });
        setLoopEnabled(true);
        setPlayheadBeat(startSec / secPerBeat);
        try { Tone.getTransport().seconds = startSec; } catch (e) {}

        setPickingLoop(false);
        return [];
      });
      return;
    }

    // box select (only if not clicking a patch tile)
    if (e.target.getAttribute('data-patch') === '1') return;
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
        setLastSelectionWasBox(sel.length > 1);
        return null;
      });
      window.removeEventListener('mouseup', finish);
    };
    window.addEventListener('mouseup', finish);
    return () => window.removeEventListener('mouseup', finish);
  }, [box, clips, pxPerBeat]);

  // ---- computed playhead ----
  const playheadX = LANE_GUTTER + playheadBeat * pxPerBeat;

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
  }, []);

  const importPatchIntoLane = () => {
    if (!selectedPatchId) return;
    const p = patches.find(pp => String(getPatchId(pp)) === String(selectedPatchId));
    if (!p) return;

    const lane = clamp(Number(selectedImportLane) || 0, 0, Math.max(0, lanes - 1));
    const startBeatLocal = snap16(playheadBeat || 0);
    
    // NEW: Use the patch's actual duration or default to 1 beat
    const patchDuration = p.duration || '4n';
    const lengthBeatsLocal = convertDurationToBeats(patchDuration, bpm);

    const label = p.displayName?.trim?.() || p.name?.trim?.() || laneMeta?.[lane]?.name || `Lane ${lane + 1}`;

    const patchSer = toSerializablePatch(p);
    if (!patchSer?.id) {
      console.warn('Selected patch is missing id', p);
    }

    const clip = {
      id: `${lane}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      lane,
      startBeat: startBeatLocal,
      lengthBeats: lengthBeatsLocal, // Use actual duration instead of fixed 1
      label,
      patch: {
        ...patchSer,
        duration: patchDuration, // Preserve the original duration string
      },
    };

    setClips(prev => {
      const merged = [...prev, clip];
      const neededBeats = Math.ceil(startBeatLocal + lengthBeatsLocal);
      if (neededBeats > lengthBeats) setLengthBeats(neededBeats);
      if (lane + 1 > lanes) setLanes(Math.max(LANES_MIN, lane + 1));
      return merged;
    });
  };
  // ===== END Import =====

  // ===== Project persistence =====
  const buildCompositionObject = () => ({
    clips: clips
      .map((c) => {
        const patchId = getPatchId(c.patch);
        if (patchId == null) return null;
        const start = Number((c.startBeat ?? 0).toFixed(3));
        const end   = Number(((c.startBeat ?? 0) + (c.lengthBeats ?? 1)).toFixed(3));
        return {
          patch: patchId,
          lane: Number(c.lane ?? 0),
          start, // beats
          end,   // beats
        };
      })
      .filter(Boolean)
  });

  const buildProjectPayload = () => ({
    name: projectName,
    description: projectDesc,
    bpm,
    lengthBeats,
    lanes,
    pxPerBeat,
    clips,
    laneMeta,
    loopRegion,
    version: 1
  });

  // IMPORTANT: send plain text description + composition object now
  const buildTrackBody = (compositionObj) => ({
    name: (projectName || 'Untitled').trim(),
    description: String(projectDesc || ''),
    bpm,
    composition: compositionObj || buildCompositionObject(),
  });

  const downloadJson = (filename, data) => {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('Download failed', e);
    }
  };

  const downloadProject = () => {
    try {
      const payload = buildProjectPayload();
      const fname = `${(projectName || 'project').trim()}.json`;
      downloadJson(fname, payload);
    } catch (e) {
      console.error(e);
      alert('Could not download project.');
    }
  };

  const saveProject = async () => {
    setSaving(true);
    try {
      const comp = buildCompositionObject();
      if (!comp.clips.length) {
        alert('Nothing to save: add at least one patch.');
        return;
      }

      let body = buildTrackBody(comp);

      // Pass lineage like patches: root + stem
      const lin = lineageRef.current || {};
      const stem = trackId || lin.stem || null;
      const root = lin.root || null;
      if (stem) body.stem = stem;
      if (root) body.root = root;

      try {
        console.log('[save] POST body ->', JSON.parse(JSON.stringify(body)));
      } catch {
        console.log('[save] POST body (stringify failed)', body);
      }

      let created = null;
      let lastError = null;

      for (const base of TRACK_BASES) {
        try {
          console.log(`[save] trying ${base}`);
          const { data } = await API.post(base, body);
          created = data;
          console.log(`[save] success @ ${base}`, data);
          break;
        } catch (e) {
          lastError = e;
          const status = e?.response?.status;
          const payload = e?.response?.data || e?.message;
          console.warn(`[save] failed @ ${base}`, status, payload);
        }
      }

      if (!created?.id) {
        const serverMsg = lastError?.response?.data || lastError?.message || 'Unknown error';
        alert(`Server save failed: ${typeof serverMsg === 'string' ? serverMsg : JSON.stringify(serverMsg)}`);
        throw lastError || new Error('Create failed');
      }

      // Advance lineage so the next Save keeps incrementing the edit index
      setTrackId(created.id);
      lineageRef.current = {
        root: root ?? created.root ?? created.id,
        stem: created.id,
      };

      const v = created?.version;
      alert(`Project saved successfully${v != null ? ` as v${v}` : ''}.`);
    } catch (e) {
      console.warn('Server save failed, keeping a local copy as backup:', e);
      try {
        const key = `savedProject:${projectName || 'Untitled'}`;
        localStorage.setItem(key, JSON.stringify(buildProjectPayload()));
        alert('Server save failed. A local backup was stored. See console for server error details.');
      } catch {
        alert('Server save failed and local backup also failed.');
      }
    } finally {
      setSaving(false);
    }
  };
  // ===== END Project persistence =====

  // ===== FIXED: Hydrate from server when editing an existing track (eager enrichment) =====
  useEffect(() => {
    // Only hydrate if we have a trackId AND we haven't already loaded a track from localStorage
    // AND we're not currently loading a track
    if (!trackId || hasLoadedTrack || isLoadingTrack) {
      console.log(`[hydrate] Skipping track hydration: trackId=${trackId}, hasLoadedTrack=${hasLoadedTrack}, isLoadingTrack=${isLoadingTrack}`);
      return;
    }
    
    // ... rest of hydrate effect
    
    (async () => {
      try {
        console.log('[hydrate] Starting server hydration for track:', trackId);
        const data = await fetchTrackById(trackId);
        console.log('[hydrate] GET track', data);

        // Set loading flag to prevent draft persistence
        setIsLoadingTrack(true);
        isLoadingTrackRef.current = true;

        // 1) Rows from composition.clips
        const rows = Array.isArray(data?.composition?.clips) ? data.composition.clips : [];

        // 2) Fetch ALL patch details upfront so names/params are ready before UI render
        const needIds = Array.from(
          new Set(
            rows
              .map(r => getPatchId(r.patch ?? r.patch_id))
              .filter(id => id != null)
          )
        );

        const fetched = await Promise.allSettled(needIds.map(id => fetchPatchById(id)));
        const byId = new Map();
        fetched.forEach((res, i) => {
          const id = needIds[i];
          if (res.status === 'fulfilled' && res.value) {
            byId.set(id, normalizeServerPatch(res.value, id));
          } else if (res.status === 'rejected') {
            // Handle deleted patches in track composition
            console.warn(`[hydrate] Patch ${id} in track composition could not be loaded:`, res.reason);
            byId.set(id, { 
              id, 
              name: 'Unavailable Patch', 
              displayName: 'Unavailable Patch',
              note: 'C4',
              duration: '8n',
              parameters: null,
              is_deleted: true 
            });
          }
        });

        // 3) Build clips with already-normalised patch objects (names + parameters)
        const rebuilt = rows.map((row, idx) => {
          const start = Number((row.start ?? row.start_beat) ?? 0);
          const end   = Number((row.end   ?? row.end_beat)   ?? start);
          const pid   = getPatchId(row.patch ?? row.patch_id);
          const patchObj = byId.get(pid) ?? { id: pid };

          const labelText =
            patchObj.displayName || patchObj.name || (pid != null ? `Patch ${pid}` : 'Patch');

          return {
            id: `srv-${data.id}-${idx}`,
            lane: Number(row.lane ?? idx),
            startBeat: start,
            lengthBeats: Math.max(0.25, end - start),
            label: labelText,
            patch: patchObj,
          };
        });

        setClips(rebuilt);

        // 4) Resize lanes/length to fit content
        const maxLane = rebuilt.reduce((m, c) => Math.max(m, c.lane), 0);
        const lastEnd = rebuilt.reduce((m, c) => Math.max(m, c.startBeat + c.lengthBeats), 0);
        setLanes((prev) => Math.max(prev, maxLane + 1, LANES_MIN));
        setLengthBeats((prev) => Math.max(prev, Math.ceil(lastEnd), 1));

        // 5) Populate text fields
        if (typeof data.bpm === 'number') setBpm(data.bpm);
        if (data.name) setProjectName(data.name);
        setProjectDesc(typeof data.description === 'string' ? data.description : '');

        // 6) Lineage so the next Save creates a new version in same fork
        lineageRef.current = { root: data.root ?? null, stem: data.id ?? null };
        
        // 7) Mark that we've loaded the track from server
        setHasLoadedTrack(true);
        
        console.log(`[hydrate] Hydrated track ${trackId} with ${rebuilt.length} clips`);
      } catch (e) {
        console.error('[hydrate] Failed to load track for edit:', e);
        alert('Could not load track details.');
      } finally {
        // Reset loading flag after a short delay to ensure track data is fully loaded
        setTimeout(() => {
          console.log('[hydrate] Resetting isLoadingTrack flag');
          setIsLoadingTrack(false);
          isLoadingTrackRef.current = false;
        }, 1000);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]); // Remove hasLoadedTrack from dependencies
  // ===== End hydrate =====

  // ===== auto-enrich whenever clips contain patches missing names/params =====
  const enrichingRef = useRef(new Set());
  useEffect(() => {
    const ids = Array.from(
      new Set(
        clips.map(c => getPatchId(c.patch)).filter(Boolean)
      )
    ).filter((id) => {
      const clip = clips.find(c => getPatchId(c.patch) === id);
      const p = clip?.patch;
      // Need enrichment if either name/displayName or parameters are missing
      const needs = !(p?.name || p?.displayName) || !p?.parameters;
      return needs && !enrichingRef.current.has(id);
    });

    if (!ids.length) return;
    let cancelled = false;

    ids.forEach((id) => enrichingRef.current.add(id));

    (async () => {
      const results = await Promise.allSettled(ids.map((id) => fetchPatchById(id)));
      if (cancelled) return;

      const map = new Map();
      results.forEach((res, i) => {
        const id = ids[i];
        if (res.status === 'fulfilled' && res.value) {
          map.set(id, normalizeServerPatch(res.value, id));
        } else if (res.status === 'rejected') {
          // Handle deleted patches - mark them as unavailable
          console.warn(`Patch ${id} could not be loaded:`, res.reason);
          map.set(id, { 
            id, 
            name: 'Unavailable Patch', 
            displayName: 'Unavailable Patch',
            note: 'C4',
            duration: '8n',
            parameters: null,
            is_deleted: true 
          });
        }
      });

      if (map.size) {
        setClips(prev =>
          prev.map((c) => {
            const id = getPatchId(c.patch);
            return map.has(id) ? { ...c, patch: map.get(id) } : c;
          })
        );
      }

      ids.forEach((id) => enrichingRef.current.delete(id));
    })();

    return () => { cancelled = true; };
  }, [clips]);

  // ----- render -----
  // Precompute safe grid geometry to avoid null deref in overlay
  const gridNode = gridRef.current;
  const gridRect = gridNode ? gridNode.getBoundingClientRect() : { left: 0, top: 0 };
  const gridLeft = gridRect.left;
  const gridTop = gridRect.top;
  const gridScrollLeft = gridNode ? gridNode.scrollLeft : 0;

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <button onClick={togglePlay} className={BTN.play}>{isPlaying ? 'Pause' : 'Play'}</button>
        <button onClick={stop} className={BTN.stop}>Stop</button>

        {/* Loop controls */}
        {!loopEnabled && !pickingLoop && (
          <button
            onClick={() => { setPickingLoop(true); setPendingLoopPoints([]); }}
            title="Click twice on the grid to set loop start and end"
            className={BTN.loop}
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
                try { Tone.getTransport().seconds = 0; } catch (e) {}
              }}
              className={BTN.warning}
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
          <input
            type="number"
            value={bpm}
            onChange={(e)=>setBpm(Math.max(1, parseInt(e.target.value || '120', 10)))}
            style={{ width: 80 }}
          />
        </label>
        <label>Length (beats):&nbsp;
          <input
            type="number"
            value={lengthBeats}
            onChange={(e)=>setLengthBeats(Math.max(1, parseInt(e.target.value || '1', 10)))}
            style={{ width: 110 }}
          />
        </label>
        <label>Zoom (px/beat):&nbsp;
          <input
            type="range"
            min="30"
            max="200"
            step="2"
            value={pxPerBeat}
            onChange={(e)=>setPxPerBeat(parseInt(e.target.value, 10))}
            style={{ width: 220 }}
          />
          &nbsp;<span style={{ fontVariantNumeric: 'tabular-nums' }}>{pxPerBeat}</span>
        </label>

        <button onClick={() => setShowImportMap(true)} className={BTN.neutral}>Import Channelrack...</button>

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
            {patches.map((p) => {
              const patchId = getPatchId(p);
              const isDeleted = p.is_deleted;
              return (
                <option key={patchId} value={patchId} disabled={isDeleted}>
                  {(p.name && p.name.trim()) || `Patch ${patchId}`} 
                  {p.is_posted ? '(posted)' : '(saved)'}
                  {isDeleted && ' (deleted)'}
                </option>
              );
            })}
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
            title="Insert the selected patch on the chosen lane at the current playhead"
            className={BTN.add}
          >
            Add to Lane
          </button>

          <button
            type="button"
            onClick={loadPatches}
            disabled={isFetchingPatches}
            title="Reload your saved and posted patches"
            className={BTN.refresh}
          >
            Reload
          </button>

          {fetchError ? <span style={{ color: 'crimson' }}>{fetchError}</span> : null}
        </div>

        {/* Start New Project */}
        <button
          onClick={startNewProject}
          className={BTN.neutral}
          title="Clear the timeline and reset settings"
        >
          New Project
        </button>

        {/* Project save controls */}
        <div className="ml-auto inline-flex items-center gap-2">
          <label htmlFor="projectName" className="font-semibold mr-1">Project:</label>
          <input
            id="projectName"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Untitled"
            className="border rounded px-2 py-1 w-[220px]"
          />

          <button
            onClick={downloadProject}
            title="Download a .json snapshot of your project"
            className={BTN.download}
          >
            Download Project
          </button>

          <button
            onClick={saveProject}
            disabled={saving}
            title="Save to your profile"
            className={`${BTN.save} ${saving ? BTN.disabled : ''}`}
          >
            {saving ? 'Saving...' : 'Save Project'}
          </button>
        </div>
      </div>

      {/* Description (user text) */}
      <div style={{ marginBottom: 10 }}>
        <label htmlFor="projectDesc" className="font-semibold block mb-1">Description</label>
        <textarea
          id="projectDesc"
          value={projectDesc}
          onChange={(e) => setProjectDesc(e.target.value)}
          placeholder="Describe your track..."
          rows={3}
          className="w-full border rounded px-2 py-2"
          style={{ resize: 'vertical', minHeight: 72 }}
        />
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
        {/* Lane labels */}
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
                  // FIXED: Visual feedback for muted lanes
                  opacity: meta.mute ? 0.6 : 1,
                  background: meta.mute ? '#f5f5f5' : 'transparent',
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
                {/* FIXED: Mute button with proper toggle and visual feedback */}
                <button
                  onClick={() => toggleMute(i)}
                  title={meta.mute ? "Unmute lane" : "Mute lane"}
                  style={{
                    padding: '2px 6px',
                    borderRadius: 6,
                    border: '1px solid #ccc',
                    background: meta.mute ? '#ffebee' : '#fff',
                    color: meta.mute ? '#d32f2f' : '#333',
                    fontWeight: meta.mute ? 'bold' : 'normal',
                  }}
                >M</button>
                {/* FIXED: Solo button with proper toggle and visual feedback */}
                <button
                  onClick={() => toggleSolo(i)}
                  title={meta.solo ? "Unsolo lane" : "Solo lane"}
                  style={{
                    padding: '2px 6px',
                    borderRadius: 6,
                    border: '1px solid #ccc',
                    background: meta.solo ? '#e8f5e9' : '#fff',
                    color: meta.solo ? '#2e7d32' : '#333',
                    fontWeight: meta.solo ? 'bold' : 'normal',
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
              linear-gradient(var(--grid-hline) 1px, transparent 1px),
              linear-gradient(90deg, var(--grid-minor-vline) 1px, transparent 1px),
              linear-gradient(90deg, var(--grid-major-vline) 1px, transparent 1px)
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

        {/* Patches (tiles) - UPDATED: Visual feedback for deleted patches */}
        <div style={{ position: 'absolute', left: LANE_GUTTER, top: 0, height: '100%', width: totalWidthPx }}>
          {clips.map((c) => {
            const left = c.startBeat * pxPerBeat;
            const width = Math.max(6, c.lengthBeats * pxPerBeat - 2);
            const top = c.lane * LANE_HEIGHT + 6;
            const meta = laneMeta[c.lane] || defaultLaneMeta(c.lane);
            const laneColor = meta.color || '#cfe8ff';
            const sel = isSelected(c.id);

            const pid = getPatchId(c.patch);
            const pName = c.patch?.displayName ?? c.patch?.name ?? null;
            const isDeleted = c.patch?.is_deleted;
            const labelText = isDeleted 
              ? 'Deleted Patch'
              : pName
                ? `${pName} (${pid ?? ''})`
                : (c.label || (pid != null ? `Patch ${pid}` : 'Patch'));

            return (
              <div
                key={c.id}
                data-patch="1"
                onMouseDown={(e) => {
                  if (pickingLoop) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  if (x <= 8) onClipMouseDown(e, c, 'l');
                  else if (x >= rect.width - 8) onClipMouseDown(e, c, 'r');
                  else onClipMouseDown(e, c, null);
                }}
                onClick={(e) => { e.stopPropagation(); }}
                title={`Patch: ${labelText} @ ${fmtTime(c.startBeat * secPerBeat)} • ${meta.name}${meta.mute ? ' (MUTED)' : ''}${meta.solo ? ' (SOLO)' : ''}${isDeleted ? ' (DELETED)' : ''}`}
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width,
                  height: LANE_HEIGHT - 12,
                  background: isDeleted 
                    ? '#ffebee33' 
                    : (meta.mute ? laneColor + '11' : laneColor + '33'),
                  border: `2px solid ${isDeleted ? '#f44336' : (sel ? '#ff5a5a' : (meta.mute ? laneColor + '66' : laneColor))}`,
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  cursor: pickingLoop ? 'crosshair' : (isDeleted ? 'not-allowed' : 'grab'),
                  opacity: isDeleted ? 0.5 : (meta.mute ? 0.4 : 1),
                }}
              >
                {/* resize handles - disabled for deleted patches */}
                {!isDeleted && (
                  <>
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
                  </>
                )}
                <div style={{ 
                  padding: '4px 8px', 
                  fontSize: 12, 
                  whiteSpace: 'nowrap', 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis',
                  opacity: meta.mute ? 0.7 : 1,
                  textDecoration: isDeleted ? 'line-through' : 'none',
                  color: isDeleted ? '#f44336' : 'inherit',
                }}>
                  {labelText}
                  {meta.mute && ' 🔇'}
                  {meta.solo && ' 🎵'}
                  {isDeleted && ' ❌'}
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
            left: Math.min(box.x1, box.x2) - gridLeft + gridScrollLeft,
            top: Math.min(box.y1, box.y2) - gridTop,
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
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: '#111827',           // dark surface
              color: '#f9fafb',                // light text
              padding: 16,
              borderRadius: 8,
              width: 620,
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>Import from Channel Rack</h3>
            <p style={{ marginBottom: 12 }}>
              Select the target lane for each rack channel:
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 160px',
                gap: 8,
              }}
            >
              {channels.map((ch, idx) => (
                <React.Fragment key={idx}>
                  <div style={{ padding: '6px 0' }}>
                    <strong>Rack {idx + 1}</strong> —{' '}
                    {ch?.patch?.displayName || ch?.patch?.name || '(empty)'}
                  </div>
                  <select
                    value={importMap[idx] ?? Math.min(idx, Math.max(lanes - 1, 0))}
                    onChange={(e) =>
                      setImportMap((m) => ({
                        ...m,
                        [idx]: parseInt(e.target.value, 10),
                      }))
                    }
                    style={{
                      backgroundColor: '#111827',
                      color: '#f9fafb',
                      border: '1px solid #4b5563',
                      borderRadius: 6,
                      padding: '4px 6px',
                    }}
                  >
                    {Array.from({ length: Math.max(lanes, channels.length) }).map(
                      (_, laneIdx) => (
                        <option key={laneIdx} value={laneIdx}>
                          {laneMeta[laneIdx]?.name || `Lane ${laneIdx + 1}`}
                        </option>
                      ),
                    )}
                  </select>
                </React.Fragment>
              ))}
            </div>

            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
                marginTop: 12,
              }}
            >
              <button
                onClick={() => setShowImportMap(false)}
                className={BTN.neutral}
              >
                Cancel
              </button>
              <button onClick={doImportMapped} className={BTN.neutral}>
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Tiny no-op to appease linting on an inline hook call site
function candles() { return null; }