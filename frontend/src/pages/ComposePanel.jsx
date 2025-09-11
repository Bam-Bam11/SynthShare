// src/pages/ComposePanel.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { useChannelRack } from '../context/ChannelRackContext';
import PlayPatch from '../components/PlayPatch'; // <-- adjust path if needed

// --- constants ---
const DEFAULT_BPM = 120;
const DEFAULT_BARS = 16;        // total bars shown (4/4)
const LANES_MIN = 8;
const LANE_HEIGHT = 48;         // px per lane
const INITIAL_PX_PER_SEC = 120; // horizontal zoom (pixels per second)
const LANE_GUTTER = 64;         // sticky lane label width

// helpers
const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
const fmtTime = (seconds) => {
  if (seconds < 0 || !isFinite(seconds)) return '00:00.000';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${pad2(m)}:${pad2(s)}.${ms.toString().padStart(3, '0')}`;
};

// Clip model (visual + playback)
// { id, lane, startSec, lengthSec, label, patch? }
export default function ComposePanel() {
  const { channels, tempo: rackTempo } = useChannelRack();

  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [bars, setBars] = useState(DEFAULT_BARS);
  const [lanes, setLanes] = useState(LANES_MIN);
  const [pxPerSec, setPxPerSec] = useState(INITIAL_PX_PER_SEC);
  const [clips, setClips] = useState([]);

  // derived timing (4/4)
  const secPerBeat = 60 / bpm;
  const beatsPerBar = 4;
  const secPerBar = secPerBeat * beatsPerBar;
  const secPerSixteenth = secPerBeat / 4;
  const totalSeconds = bars * secPerBar;

  // refs for sync + hover + playback
  const gridRef = useRef(null);
  const rulerRef = useRef(null);
  const [hoverTime, setHoverTime] = useState(null);
  const [hoverXAbs, setHoverXAbs] = useState(0); // absolute X inside scroll area

  const [isPlaying, setIsPlaying] = useState(false);
  const [loopOn, setLoopOn] = useState(true);
  const [followOn, setFollowOn] = useState(true);
  const [transportTime, setTransportTime] = useState(0); // seconds
  const rafRef = useRef(0);

  // compute ticks
  const ticks = useMemo(() => {
    const major = [];   // every 1s
    const minor = [];   // every 100ms
    const barLines = []; // every bar (bold)

    const totalMs = Math.ceil(totalSeconds * 1000);
    for (let ms = 0; ms <= totalMs; ms += 100) {
      const x = (ms / 1000) * pxPerSec;
      if (ms % 1000 === 0) {
        major.push({ x, label: fmtTime(ms / 1000) });
      } else {
        minor.push({ x });
      }
    }
    for (let b = 0; b <= bars; b += 1) {
      const x = b * secPerBar * pxPerSec;
      barLines.push({ x, label: `Bar ${b + 1}` });
    }
    return { major, minor, barLines };
  }, [pxPerSec, totalSeconds, secPerBar, bars]);

  // keep ruler scroll in sync with grid
  useEffect(() => {
    const grid = gridRef.current;
    const ruler = rulerRef.current;
    if (!grid || !ruler) return;
    const onScroll = () => { ruler.scrollLeft = grid.scrollLeft; };
    grid.addEventListener('scroll', onScroll);
    return () => grid.removeEventListener('scroll', onScroll);
  }, []);

  // hover time readout
  const onMouseMoveGrid = (e) => {
    const grid = e.currentTarget;
    const rect = grid.getBoundingClientRect();
    const xInGrid = e.clientX - rect.left + grid.scrollLeft - LANE_GUTTER;
    const secs = xInGrid / pxPerSec;
    setHoverXAbs(e.clientX - rect.left + grid.scrollLeft);
    setHoverTime(secs >= 0 ? secs : 0);
  };
  const clearHover = () => setHoverTime(null);

  // Import from Channel Rack: map every ON step to a tiny clip
  const importFromRack = () => {
    const newClips = [];
    let maxLane = 0;

    if (rackTempo && Number.isFinite(rackTempo)) {
      setBpm(rackTempo);
    }

    channels.forEach((ch, laneIndex) => {
      if (!ch || !Array.isArray(ch.steps)) return;
      maxLane = Math.max(maxLane, laneIndex + 1);

      ch.steps.forEach((on, stepIndex) => {
        if (!on) return;
        const startSec = stepIndex * secPerSixteenth;
        const lengthSec = secPerSixteenth; // one 16th by default
        newClips.push({
          id: `${laneIndex}-${stepIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          lane: laneIndex,
          startSec,
          lengthSec,
          label: ch.patch?.displayName || ch.patch?.name || `Ch ${laneIndex + 1}`,
          patch: ch.patch || null,
        });
      });
    });

    // Ensure the timeline shows at least as long as the imported pattern
    const lastEndSec = newClips.length
      ? Math.max(...newClips.map(c => c.startSec + c.lengthSec))
      : 0;
    const neededBars = Math.ceil(lastEndSec / secPerBar);
    if (neededBars > bars) setBars(neededBars);

    setLanes(Math.max(LANES_MIN, maxLane));
    setClips(newClips);
  };

  const clearImported = () => setClips([]);

  // ---------- Playback ----------
  // keep Tone.Transport BPM in sync
  useEffect(() => {
    Tone.getTransport().bpm.value = bpm;
  }, [bpm]);

  // schedule all clips, then start transport
  const scheduleAndStart = async () => {
    await Tone.start(); // ensure audio context is resumed
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    transport.bpm.value = bpm;

    // loop bounds
    transport.loop = loopOn;
    transport.loopStart = 0;
    transport.loopEnd = totalSeconds;

    // schedule every clip (single hit at clip start)
    clips.forEach((clip) => {
      if (!clip.patch) return;
      const triggerAt = clip.startSec; // seconds on transport timeline
      transport.schedule((time) => {
        try {
          // PlayPatch signature should match your project
          PlayPatch({
            ...clip.patch,
            // fallbacks (if your patch object already has note/duration, they will be used)
            note: clip.patch.note || 'C4',
            duration: clip.patch.duration || '8n',
          }, time);
        } catch (e) {
          // fail silently so one bad patch doesn't break transport
          // eslint-disable-next-line no-console
          console.warn('PlayPatch failed for clip', clip, e);
        }
      }, triggerAt);
    });

    // start from the current transport position if already moving, else from 0
    transport.start('+0.0', isPlaying ? transport.seconds : 0);
    setIsPlaying(true);

    // begin RAF to update playhead + optional follow scroll
    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const sec = transport.seconds % (totalSeconds || 1);
      setTransportTime(sec);

      if (followOn && gridRef.current) {
        const x = sec * pxPerSec + LANE_GUTTER;
        const grid = gridRef.current;
        const viewLeft = grid.scrollLeft;
        const viewRight = viewLeft + grid.clientWidth;
        const margin = 80; // keep some margin when following
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
    Tone.getTransport().stop();
    Tone.getTransport().seconds = 0;
    setIsPlaying(false);
    setTransportTime(0);
    cancelAnimationFrame(rafRef.current);
  };

  // cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      try {
        Tone.getTransport().stop();
        Tone.getTransport().cancel(0);
      } catch {}
    };
  }, []);

  // playhead X position
  const playheadX = LANE_GUTTER + transportTime * pxPerSec;

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <button onClick={togglePlay}>{isPlaying ? 'Pause' : 'Play'}</button>
        <button onClick={stop}>Stop</button>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={loopOn} onChange={(e) => setLoopOn(e.target.checked)} />
          Loop
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={followOn} onChange={(e) => setFollowOn(e.target.checked)} />
          Follow
        </label>

        <label>BPM:&nbsp;
          <input
            type="number"
            value={bpm}
            onChange={(e) => setBpm(Math.max(1, parseInt(e.target.value || '120', 10)))}
            style={{ width: 80 }}
          />
        </label>
        <label>Bars:&nbsp;
          <input
            type="number"
            value={bars}
            onChange={(e) => setBars(Math.max(1, parseInt(e.target.value || '1', 10)))}
            style={{ width: 80 }}
          />
        </label>
        <label>Zoom (px/s):&nbsp;
          <input
            type="range"
            min="40"
            max="300"
            step="5"
            value={pxPerSec}
            onChange={(e) => setPxPerSec(parseInt(e.target.value, 10))}
            style={{ width: 220, verticalAlign: 'middle' }}
          />
          &nbsp;<span style={{ fontVariantNumeric: 'tabular-nums' }}>{pxPerSec}</span>
        </label>

        <button onClick={importFromRack}>Import from Channel Rack</button>
        <button onClick={clearImported}>Clear Imported</button>

        <div style={{ marginLeft: 'auto', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
          Hover:&nbsp;{hoverTime == null ? '—' : fmtTime(hoverTime)}
          &nbsp;&nbsp;|&nbsp; Play:&nbsp;{fmtTime(transportTime)}
        </div>
      </div>

      {/* Time ruler (scroll-synced with grid) */}
      <div
        ref={rulerRef}
        style={{
          position: 'relative',
          height: 48,                 // two rows of labels
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
            width: totalSeconds * pxPerSec + LANE_GUTTER,
            height: '100%',
            marginLeft: LANE_GUTTER,
          }}
        >
          {/* Major ticks (1s) + labels (bottom row) */}
          {ticks.major.map((t, i) => (
            <div key={`maj-${i}`} style={{ position: 'absolute', left: t.x, bottom: 0, width: 1, height: '100%' }}>
              <div style={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: 18, background: '#555' }} />
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
                {t.label.slice(0, 5) /* mm:ss */}
              </div>
            </div>
          ))}

          {/* Minor ticks (100ms) */}
          {ticks.minor.map((t, i) => (
            <div key={`min-${i}`} style={{ position: 'absolute', left: t.x, bottom: 0, width: 1, height: 8, background: '#bbb' }} />
          ))}

          {/* Bar lines + labels (top row) */}
          {ticks.barLines.map((b, i) => (
            <div key={`bar-${i}`} style={{ position: 'absolute', left: b.x, top: 0, width: 2, height: '100%', background: '#2a63d4' }}>
              <div
                style={{
                  position: 'absolute',
                  transform: 'translateX(-50%)',
                  top: 2,
                  fontSize: 11,
                  color: '#2a63d4',
                  fontWeight: 700,
                  background: 'rgba(255,255,255,0.85)',
                  padding: '0 6px',
                  borderRadius: 3,
                  zIndex: 1,
                }}
              >
                {b.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Scrollable timeline grid */}
      <div
        ref={gridRef}
        onMouseMove={onMouseMoveGrid}
        onMouseLeave={clearHover}
        style={{
          position: 'relative',
          border: '1px solid #ccc',
          overflowX: 'auto',
          overflowY: 'hidden',
          height: LANE_HEIGHT * lanes + 2,
          userSelect: 'none',
          cursor: 'default',
        }}
      >
        {/* Sticky lane labels */}
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
          }}
        >
          {Array.from({ length: lanes }).map((_, i) => (
            <div
              key={i}
              style={{
                height: LANE_HEIGHT,
                lineHeight: `${LANE_HEIGHT}px`,
                textAlign: 'center',
                borderBottom: '1px solid #eee',
                fontSize: 12,
                color: '#333',
              }}
            >
              Ch {i + 1}
            </div>
          ))}
        </div>

        {/* Grid background (lanes + 100ms + 1s lines) */}
        <div
          style={{
            position: 'absolute',
            left: LANE_GUTTER,
            top: 0,
            height: '100%',
            width: totalSeconds * pxPerSec,
            backgroundImage: `
              linear-gradient(#eee 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.12) 1px, transparent 1px)
            `,
            backgroundSize: `
              100% ${LANE_HEIGHT}px,
              ${pxPerSec / 10}px 100%,
              ${pxPerSec}px 100%
            `,
            zIndex: 0,
          }}
        />

        {/* Bold bar guides over the grid */}
        <div style={{ position: 'absolute', left: LANE_GUTTER, top: 0, height: '100%', width: totalSeconds * pxPerSec, pointerEvents: 'none' }}>
          {ticks.barLines.map((b, i) => (
            <div key={`barbg-${i}`} style={{ position: 'absolute', left: b.x, top: 0, width: 2, height: '100%', background: 'rgba(42,99,212,0.3)' }} />
          ))}
        </div>

        {/* Render imported clips */}
        <div style={{ position: 'absolute', left: LANE_GUTTER, top: 0, height: '100%', width: totalSeconds * pxPerSec }}>
          {clips.map((c) => {
            const left = c.startSec * pxPerSec;
            const width = Math.max(6, c.lengthSec * pxPerSec - 2);
            const top = c.lane * LANE_HEIGHT + 6;
            return (
              <div
                key={c.id}
                title={`${c.label} @ ${fmtTime(c.startSec)} (${Math.round(c.lengthSec * 1000)} ms)`}
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width,
                  height: LANE_HEIGHT - 12,
                  background: '#cfe8ff',
                  border: '1px solid #5aa0e0',
                  borderRadius: 6,
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  pointerEvents: 'auto',
                }}
              >
                <div style={{ padding: '4px 8px', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Moving playhead */}
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
      </div>

      {/* Hover playhead line (sits on top of ruler + grid) */}
      {hoverTime != null && (
        <div style={{ position: 'relative', height: 0 }}>
          <div
            style={{
              position: 'absolute',
              left: Math.max(LANE_GUTTER, hoverXAbs),
              top: -(LANE_HEIGHT * lanes + 36),
              width: 1,
              height: LANE_HEIGHT * lanes + 36,
              background: '#ff5a5a',
              pointerEvents: 'none',
              opacity: 0.4,
            }}
          />
        </div>
      )}
    </div>
  );
}
