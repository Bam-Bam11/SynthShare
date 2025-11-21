// src/pages/trackdetail.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import API from '../api';
import { jwtDecode } from 'jwt-decode';
import { useChannelRack } from '../context/ChannelRackContext';
import TrackLineageGraph from '../components/TrackLineageGraph';
import PlayPatch from '../components/PlayPatch';
import * as Tone from 'tone';

const fmtDateTime = (s) => { try { return new Date(s).toLocaleString(); } catch { return s; } };
const MIN_BEAT_LEN = 0.25;

// Match ComposePanel button styles
const BTN = {
  play: 'px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600',
  stop: 'px-4 py-2 border rounded',
  disabled: 'opacity-60 cursor-not-allowed',
};

const TrackDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [track, setTrack] = useState(null);
  const [error, setError] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [busy, setBusy] = useState(false);

  const [ancMeta, setAncMeta] = useState({ root: null, stem: null, immediate_predecessor: null });

  // Channel rack hook guarded
  let assignPatchToFirstEmptyChannel = () => {};
  try {
    const rack = useChannelRack?.();
    if (rack && typeof rack.assignPatchToFirstEmptyChannel === 'function') {
      assignPatchToFirstEmptyChannel = rack.assignPatchToFirstEmptyChannel;
    }
  } catch {}

  // Patch cache (for preview / add-to-rack)
  const patchCacheRef = useRef(new Map());
  const resolvePatchById = async (maybeId) => {
    const idNum = typeof maybeId === 'number'
      ? maybeId
      : typeof maybeId === 'string'
        ? Number(maybeId)
        : (maybeId?.id ?? null);
    if (!idNum) return null;
    
    const cache = patchCacheRef.current;
    
    // Only return cached data if it's not a deleted placeholder
    if (cache.has(idNum)) {
      const cached = cache.get(idNum);
      // If we have actual patch data (not a deleted placeholder), return it
      if (cached && !cached.is_deleted) {
        return cached;
      }
      // If it's a deleted placeholder, we'll try to refetch to be sure
    }
    
    try {
      const { data } = await API.get(`/patches/${idNum}/`);
      cache.set(idNum, data);
      return data;
    } catch (error) {
      if (error.response?.status === 404) {
        console.warn(`Patch ${idNum} not found (deleted)`);
        // Cache the fact that this patch doesn't exist to avoid repeated requests
        const deletedPatch = { 
          id: idNum, 
          is_deleted: true,
          name: 'Deleted Patch',
          parameters: null
        };
        cache.set(idNum, deletedPatch);
        return deletedPatch;
      }
      console.error(`Error fetching patch ${idNum}:`, error);
      throw error;
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token) {
      try {
        const decoded = jwtDecode(token);
        setCurrentUserId(decoded.user_id);
      } catch {}
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const { data } = await API.get(`/tracks/${id}/`);
        if (!cancelled) {
          setTrack(data);
        }
      } catch (e) {
        if (cancelled) return;
        const msg =
          e?.response?.data?.detail ||
          e?.response?.data?.error ||
          (e?.response?.status === 404 ? 'Track not found.' :
           e?.response?.status === 403 ? 'You do not have permission to view this track.' :
           'Failed to load track.');
        setError(msg);
        setTrack(null);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Load ancestor linkability + versions
  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    (async () => {
      try {
        const line = await API.get(`/tracks/${track.id}/lineage/`);
        const nodeMap = new Map((line.data?.nodes || []).map(n => [n.id, n]));
        const rootId = track.root || track.id;
        const stemId = track.stem || null;
        const predId = track.immediate_predecessor || null;
        const targets = [
          ['immediate_predecessor', predId],
          ['stem', stemId],
          ['root', rootId],
        ];
        const results = await Promise.all(
          targets.map(async ([key, tid]) => {
            if (!tid) return [key, null];
            const versionFromLineage = nodeMap.get(tid)?.version || null;
            let exists = false;
            try { await API.get(`/tracks/${tid}/`); exists = true; } catch { exists = false; }
            return [key, { id: tid, version: versionFromLineage, exists }];
          })
        );
        if (!cancelled) {
          const meta = { root: null, stem: null, immediate_predecessor: null };
          results.forEach(([k, v]) => (meta[k] = v));
          setAncMeta(meta);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [track]);

  const isOwner = useMemo(() => {
    if (!track || currentUserId == null) return false;
    return Number(track.uploaded_by_id) === Number(currentUserId);
  }, [track, currentUserId]);

  // --- Post/Unpost/Delete handlers ---
  const handlePost = async () => {
    if (!track) return;
    setBusy(true);
    try {
      await API.post(`/tracks/${track.id}/post/`);
      setTrack(t => (t ? { ...t, is_posted: true } : t));
      alert('Track posted successfully.');
    } catch (e) {
      console.error('Post failed:', e?.response?.data || e);
      alert('Post failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnpost = async () => {
    if (!track) return;
    setBusy(true);
    try {
      await API.post(`/tracks/${track.id}/unpost/`);
      setTrack(t => (t ? { ...t, is_posted: false } : t));
      alert('Track unposted.');
    } catch (e) {
      console.error('Unpost failed:', e?.response?.data || e);
      alert('Unpost failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!track) return;
    if (!window.confirm('Delete this track? This cannot be undone.')) return;
    setBusy(true);
    try {
      await API.delete(`/tracks/${track.id}/`);
      alert('Track deleted.');
      navigate(-1);
    } catch (e) {
      console.error('Delete failed:', e?.response?.data || e);
      alert('Delete failed.');
      setBusy(false);
    }
  };

  // ===== UPDATED: Fork/Edit handler =====
  const handleEditOrFork = async () => {
    if (!track) return;

    const isEdit = isOwner;

    // Fetch all patches used in the track composition
    const patchIds = Array.from(new Set(composition.map(row => row.patchId).filter(Boolean)));

    const patches = [];
    
    for (const patchId of patchIds) {
      try {
        const patch = await resolvePatchById(patchId);
        if (patch) {
          patches.push(patch);
        }
      } catch (error) {
        console.error(`Failed to fetch patch ${patchId}:`, error);
      }
    }

    // Create a mapping of patchId to patch data for the composer
    const patchesMap = {};
    patches.forEach(patch => {
      if (patch && patch.id) {
        patchesMap[patch.id] = patch;
      }
    });

    const trackData = {
      action: isEdit ? 'edit' : 'fork',
      id: track.id,
      stem: track.id,
      immediate_predecessor: track.id,
      root: track.root || track.id,
      name: track.name + (isEdit ? '' : ' (fork)'),
      description: track.description || '',
      bpm: track.bpm,
      composition: track.composition, // Keep the original composition structure
      // Include the patches data and normalized composition for channel hydration
      patches: patchesMap,
      normalizedComposition: composition
    };
    
    // Clear any existing track data first
    localStorage.removeItem('trackToLoad');
    
    // Store the track data
    localStorage.setItem('trackToLoad', JSON.stringify(trackData));
    
    // Also set the active tab to track
    localStorage.setItem('buildcompose_active_tab', 'track');
    
    navigate('/build');
  };

  // ===== Composition normalisation (handles composition.clips and legacy arrays) =====
  const composition = useMemo(() => {
    if (!track) return [];

    // Prefer new shape: composition.clips
    const clips = Array.isArray(track?.composition?.clips)
      ? track.composition.clips
      : (Array.isArray(track?.composition) ? track.composition : []);

    const normalise = (r) => {
      // support both start/end and start_beat/end_beat; support lane/rack order
      const startBeat = Number((r.start ?? r.start_beat) ?? 0);
      const endBeat   = Number((r.end ?? r.end_beat) ?? (startBeat + 1));
      const lane      = Number(r.lane ?? r.order_index ?? 0);
      const patchId   = Number(
        r.patch_id ?? r.patchId ?? r.patch ?? (r.patch?.id ?? r.id ?? 0)
      ) || null;

      return {
        lane,
        startBeat,
        endBeat: Math.max(startBeat + MIN_BEAT_LEN, endBeat),
        patchId
      };
    };

    const normalized = clips
      .map(normalise)
      .filter(c => c.patchId != null)
      .sort((a, b) => (a.startBeat - b.startBeat) || (a.lane - b.lane));

    return normalized;
  }, [track]);

  const bpm = Number(track?.bpm) || 120;
  const beatsToSeconds = (beats) => (60 / bpm) * beats;
  const totalBeats = useMemo(
    () => Math.max(0, ...composition.map(r => r.endBeat), 0),
    [composition]
  );
  const totalSeconds = beatsToSeconds(totalBeats);

  // Calculate deleted patches count
  const deletedPatchesCount = useMemo(() => {
    if (!composition.length) return 0;
    const patchIds = Array.from(new Set(composition.map(r => r.patchId).filter(Boolean)));
    return patchIds.filter(pid => {
      const cached = patchCacheRef.current.get(pid);
      return cached?.is_deleted;
    }).length;
  }, [composition]);

  // Calculate total unique patches
  const totalUniquePatches = useMemo(() => {
    if (!composition.length) return 0;
    return Array.from(new Set(composition.map(r => r.patchId).filter(Boolean))).length;
  }, [composition]);

  // ===== SoundCloud-style waveform =====
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [wrapWidth, setWrapWidth] = useState(800);
  const [hoverSec, setHoverSec] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(320, Math.floor(e.contentRect.width));
        setWrapWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const BAR_W = 2;
  const GAP_W = 1;
  const NUM_BARS = Math.max(120, Math.floor(wrapWidth / (BAR_W + GAP_W)));

  const bars = useMemo(() => {
    const peaks = new Float32Array(NUM_BARS);
    if (!composition.length || totalSeconds <= 0) {
      for (let i = 0; i < NUM_BARS; i++) peaks[i] = 0.05; // faint baseline
      return peaks;
    }

    for (let i = 0; i < NUM_BARS; i++) {
      const t = ((i + 0.5) / NUM_BARS) * totalSeconds;
      let amp = 0;
      for (const row of composition) {
        const s = beatsToSeconds(row.startBeat);
        const e = beatsToSeconds(row.endBeat);
        if (t < s || t > e) continue;
        const p = (t - s) / Math.max(0.001, e - s);
        const envelope = Math.sin(Math.PI * p);
        amp += envelope;
      }
      peaks[i] = amp;
    }

    // normalise
    let mx = 0;
    for (let i = 0; i < NUM_BARS; i++) mx = Math.max(mx, peaks[i]);
    const k = mx > 0 ? 1 / mx : 1;
    for (let i = 0; i < NUM_BARS; i++) peaks[i] *= k;

    // smooth
    const sm = new Float32Array(NUM_BARS);
    for (let i = 0; i < NUM_BARS; i++) {
      let sum = 0, wsum = 0;
      for (let d = -2; d <= 2; d++) {
        const j = i + d;
        if (j >= 0 && j < NUM_BARS) {
          const w = 3 - Math.abs(d);
          sum += peaks[j] * w;
          wsum += w;
        }
      }
      sm[i] = sum / wsum;
    }
    return sm;
  }, [composition, totalSeconds, NUM_BARS, bpm]);

  // draw bars
  const [isPlaying, setIsPlaying] = useState(false);
  const [progressSec, setProgressSec] = useState(0);
  const rafRef = useRef(0);

  const fmtTime = (seconds) => {
    if (!isFinite(seconds)) return '0:00';
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  };

  const drawWave = () => {
    const canvas = canvasRef.current;
    const W = wrapWidth;
    const H = 120;
    if (!canvas || W <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const BG = '#ffffff';
    const BAR_UNPLAYED = '#e5e7eb'; // gray-200
    const BAR_PLAYED = '#111827';   // gray-900
    const HOVER_LINE = '#6b7280';   // gray-500

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    const midY = H / 2;
    const maxBarH = H * 0.44;
    const step = BAR_W + GAP_W;
    const N = Math.min(NUM_BARS, Math.floor(W / step));
    const progressIdx = (totalSeconds > 0) ? Math.floor((progressSec / totalSeconds) * N) : 0;

    // unplayed
    ctx.fillStyle = BAR_UNPLAYED;
    for (let i = 0; i < N; i++) {
      const a = bars[i];
      const h = Math.max(1, a * maxBarH);
      const x = i * step;
      ctx.fillRect(x, midY - h, BAR_W, h);
      ctx.fillRect(x, midY, BAR_W, h);
    }

    // played overlay
    ctx.fillStyle = BAR_PLAYED;
    for (let i = 0; i < Math.min(progressIdx, N); i++) {
      const a = bars[i];
      const h = Math.max(1, a * maxBarH);
      const x = i * step;
      ctx.fillRect(x, midY - h, BAR_W, h);
      ctx.fillRect(x, midY, BAR_W, h);
    }

    // hover guide
    if (hoverSec != null && totalSeconds > 0) {
      const hx = Math.max(0, Math.min(W, (hoverSec / totalSeconds) * W));
      ctx.beginPath();
      ctx.moveTo(hx + 0.5, 0);
      ctx.lineTo(hx + 0.5, H);
      ctx.strokeStyle = HOVER_LINE;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  useEffect(() => { drawWave(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wrapWidth, bars, progressSec, hoverSec, totalSeconds]);

  // ===== Transport / scheduling (mirrors ComposePanel approach) =====
  useEffect(() => {
    return () => {
      try {
        const t = Tone.getTransport();
        t.stop();
        t.cancel();
      } catch {}
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const scheduleFullPreview = async (startAtSec = 0) => {
    if (!composition.length || totalSeconds <= 0) return;

    await Tone.start();
    
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    transport.bpm.value = bpm;
    setProgressSec(startAtSec);

    // fetch unique patches (so every clip can play)
    const ids = Array.from(new Set(composition.map(r => r.patchId).filter(Boolean)));
    const fetched = await Promise.all(ids.map(async (pid) => {
      try { 
        const patch = await resolvePatchById(pid);
        return [pid, patch];
      } catch (error) {
        console.warn(`Patch ${pid} not found or deleted:`, error.response?.data || error.message);
        return [pid, { 
          id: pid, 
          is_deleted: true,
          name: 'Deleted Patch',
          parameters: null
        }];
      }
    }));
    
    const byId = new Map(fetched);

    // schedule each clip
    composition.forEach((row) => {
      const patch = byId.get(row.patchId);
      if (!patch || !patch.parameters || patch.is_deleted) {
        return;
      }
      
      const s = beatsToSeconds(row.startBeat);
      const e = beatsToSeconds(row.endBeat);
      const dur = Math.max(0.05, e - s);
      
      transport.schedule((time) => {
        try {
          PlayPatch({ 
            ...patch, 
            note: patch.note || 'C4', 
            duration: dur 
          }, time);
        } catch (error) {
          console.error(`Failed to play patch ${row.patchId}:`, error);
        }
      }, s);
    });

    // hard stop at end
    transport.scheduleOnce(() => {
      try { 
        transport.stop(); 
        transport.seconds = 0; 
      } catch {}
      setIsPlaying(false);
      setProgressSec(0);
      cancelAnimationFrame(rafRef.current);
    }, totalSeconds + 0.05);

    // Small delay to ensure everything is set up
    setTimeout(() => {
      transport.start('+0.1', Math.max(0, Math.min(totalSeconds, startAtSec)));
      setIsPlaying(true);
    }, 100);

    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const sec = Tone.getTransport().seconds;
      setProgressSec(Math.max(0, Math.min(totalSeconds, sec)));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const onPlayClick = async () => {
    if (!isPlaying) {
      await scheduleFullPreview(progressSec || 0);
    } else {
      try { Tone.getTransport().pause(); } catch {}
      setIsPlaying(false);
      cancelAnimationFrame(rafRef.current);
    }
  };

  const onStopClick = () => {
    try {
      const t = Tone.getTransport();
      t.stop();
      t.seconds = 0;
    } catch {}
    setIsPlaying(false);
    setProgressSec(0);
    cancelAnimationFrame(rafRef.current);
  };

  const onCanvasPointer = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = totalSeconds * (x / rect.width);
    setHoverSec(Math.max(0, Math.min(totalSeconds, t)));
  };

  const onCanvasLeave = () => setHoverSec(null);

  const onCanvasClick = async (e) => {
    if (totalSeconds <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = totalSeconds * (x / rect.width);
    setProgressSec(Math.max(0, Math.min(totalSeconds, t)));
    try { Tone.getTransport().seconds = t; } catch {}
    if (!isPlaying) {
      await scheduleFullPreview(t);
    }
  };

  // Helper to render a single lineage row
  const LineageRow = ({ label, meta }) => {
    if (!meta) return <p><strong>{label}:</strong> —</p>;
    const verText = meta.version ? `v${meta.version}` : '(version unknown)';
    return (
      <p>
        <strong>{label}:</strong>{' '}
        {meta.exists ? (
          <Link to={`/tracks/${meta.id}`}>{verText}</Link>
        ) : (
          <span>{verText}</span>
        )}
      </p>
    );
  };

  if (error) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Track {id}</h2>
        <p style={{ color: 'crimson' }}>{error}</p>
      </div>
    );
  }

  if (!track) return <div style={{ padding: 20 }}><p>Loading track...</p></div>;

  return (
    <div style={{ padding: 20 }}>
      <h2>{track.name || `Track ${track.id}`}</h2>

      <p>
        <strong>Uploaded by:</strong>{' '}
        <Link to={`/profile/${track.uploaded_by}`} style={{ textDecoration: 'none' }}>
          {track.uploaded_by}
        </Link>
      </p>
      <p><strong>Created at:</strong> {track.created_at ? fmtDateTime(track.created_at) : '—'}</p>
      <p><strong>Downloads:</strong> {track.downloads}</p>
      <p><strong>Forks:</strong> {track.forks}</p>
      <p><strong>Version:</strong> {track.version}</p>

      <LineageRow label="Immediate predecessor" meta={ancMeta.immediate_predecessor} />
      <LineageRow label="Stem" meta={ancMeta.stem} />
      <LineageRow label="Root" meta={ancMeta.root} />

      {track.description ? (
        <div style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>
          <strong>Description:</strong>
          <div>{track.description}</div>
        </div>
      ) : null}

      {/* ===== Waveform / Audio Profile ===== */}
      <h3 style={{ marginTop: 20 }}>Audio Profile</h3>
      <div style={{ marginBottom: 10 }}>
        <strong>BPM:</strong> {bpm} &nbsp;•&nbsp; <strong>Length:</strong> {fmtTime(totalSeconds)}
        {deletedPatchesCount > 0 && (
          <span style={{ color: '#d32f2f', marginLeft: 12 }}>
            ⚠️ {deletedPatchesCount} of {totalUniquePatches} patches deleted
          </span>
        )}
      </div>

      {/* Controls use same styling as ComposePanel */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <button
          onClick={onPlayClick}
          className={`${BTN.play} ${(totalSeconds <= 0 || deletedPatchesCount === totalUniquePatches) ? BTN.disabled : ''}`}
          disabled={totalSeconds <= 0 || deletedPatchesCount === totalUniquePatches}
          title={deletedPatchesCount === totalUniquePatches ? "Cannot play - all patches have been deleted" : ""}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={onStopClick}
          className={`${BTN.stop} ${totalSeconds <= 0 && progressSec === 0 ? BTN.disabled : ''}`}
          disabled={totalSeconds <= 0 && progressSec === 0}
        >
          Stop
        </button>
        <div style={{ marginLeft: 8, fontFamily: 'monospace' }}>
          {fmtTime(progressSec)} / {fmtTime(totalSeconds)}
        </div>
      </div>

      <div
        ref={wrapRef}
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 8,
          background: '#fff'
        }}
      >
        <canvas
          ref={canvasRef}
          onMouseMove={onCanvasPointer}
          onMouseLeave={onCanvasLeave}
          onClick={onCanvasClick}
          style={{ width: '100%', height: 120, display: 'block', cursor: totalSeconds > 0 ? 'pointer' : 'default' }}
        />
      </div>
      <div style={{ marginTop: 8, color: '#666', fontSize: 12 }}>
        Tip: click the waveform to seek. Click again to start playing from that point.
      </div>

      {/* ===== UPDATED: Action buttons with Fork/Edit logic ===== */}
      {currentUserId && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {isOwner ? (
            <>
              {!track.is_posted ? (
                <button onClick={handlePost} disabled={busy}>Post</button>
              ) : (
                <button onClick={handleUnpost} disabled={busy}>Unpost</button>
              )}
              <button onClick={handleDelete} disabled={busy}>Delete</button>
              <button onClick={handleEditOrFork} disabled={busy}>
                Edit Track
              </button>
            </>
          ) : (
            <button onClick={handleEditOrFork} disabled={busy}>
              Fork Track
            </button>
          )}
        </div>
      )}

      <div style={{ marginTop: 30 }}>
        <h3>Version Tree</h3>
        <TrackLineageGraph trackId={track.id} />
      </div>
    </div>
  );
};

export default TrackDetail;