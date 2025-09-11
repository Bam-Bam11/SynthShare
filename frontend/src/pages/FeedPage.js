import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { useChannelRack } from '../context/ChannelRackContext';
import PlayPatch from '../components/PlayPatch';
import API from '../api';

/**
 * DRAG SOURCES (how other pages can start a drag):
 * 1) Patch element:
 *    <div {...makePatchDragProps(patch)}>Drag me</div>
 *
 * 2) Channel Rack bundle (optional button/handle in your rack UI):
 *    <button {...makeRackDragProps(channels, tempo)}>Drag rack to timeline</button>
 */
export const makePatchDragProps = (patch) => ({
  draggable: true,
  onDragStart: (e) => {
    e.dataTransfer.setData('application/x-patch', JSON.stringify(patch));
    e.dataTransfer.effectAllowed = 'copy';
  },
});

export const makeRackDragProps = (channels, tempo) => ({
  draggable: true,
  onDragStart: (e) => {
    const payload = { type: 'rack', tempo, channels };
    e.dataTransfer.setData('application/x-channelrack', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  },
});

// ==== Timeline constants (MVP) ====
const STEPS_PER_BAR = 16;     // 16th notes per bar (FL-style)
const DEFAULT_BARS = 4;       // grid length (you can add a zoom/length control)
const LANES_MIN = 8;          // minimum vertical lanes (auto-expands)

const emptySteps = (n = 16) => Array(n).fill(false);

// ==== ComposePanel ====
export default function ComposePanel() {
  const { channels, tempo: rackTempo } = useChannelRack();
  const [bpm, setBpm] = useState(120);
  const [bars, setBars] = useState(DEFAULT_BARS);
  const [lanes, setLanes] = useState(LANES_MIN);

  // Clips: { id, lane, startStep, lengthSteps, patch, stepPattern?, note, duration, gain }
  const [clips, setClips] = useState([]);

  // selection / drag state
  const [selectedId, setSelectedId] = useState(null);
  const [dragging, setDragging] = useState(null);       // { id, offsetSteps }
  const [resizing, setResizing] = useState(null);       // { id, edge: 'left'|'right', startLen, startPos }
  const trackRef = useRef(null);

  // grid math
  const totalSteps = bars * STEPS_PER_BAR;
  const [pxPerStep, setPxPerStep] = useState(24);       // zoom X
  const laneHeight = 48;                                 // fixed height per lane

  useEffect(() => {
    // Ensure Tone BPM reflects our track BPM
    Tone.getTransport().bpm.value = bpm;
  }, [bpm]);

  // ---- helpers ----
  const snap = (steps) => Math.max(0, Math.min(totalSteps, Math.round(steps)));

  const addClip = (clip) => {
    setClips((prev) => {
      const id = Date.now().toString() + Math.random().toString(36).slice(2, 7);
      return [...prev, { id, note: 'C4', duration: '8n', gain: 1.0, ...clip }];
    });
    setLanes((l) => Math.max(l, (clip.lane ?? 0) + 1, LANES_MIN));
  };

  const importFromRack = () => {
    // Map each populated channel to a lane of one-step clips at their active steps
    const baseLane = clips.length ? Math.max(...clips.map(c => c.lane)) + 1 : 0;
    let lane = baseLane;
    channels.forEach((ch) => {
      if (!ch.patch) return;
      ch.steps.forEach((on, s) => {
        if (on) {
          addClip({
            lane,
            startStep: s,
            lengthSteps: 1,
            patch: ch.patch,
            stepPattern: null, // single trigger
          });
        }
      });
      lane += 1;
    });
  };

  const dropPatchAt = (patch, lane, step) => {
    addClip({
      lane,
      startStep: step,
      lengthSteps: STEPS_PER_BAR, // default 1 bar
      patch,
      // Provide a per-step pattern if desired (null = fire at clip start only)
      stepPattern: null,
    });
  };

  const dropRackAt = (rack, laneStart, stepStart) => {
    // rack: { tempo, channels: [{ steps, patch }, ...] }
    if (rack.tempo) setBpm(rack.tempo);
    let lane = laneStart;
    rack.channels.forEach((ch) => {
      if (!ch.patch) { lane += 1; return; }
      // If pattern extends past grid, extend grid (bars) as needed:
      const lastOn = ch.steps.slice().reverse().findIndex(Boolean);
      const lastIndex = lastOn >= 0 ? ch.steps.length - 1 - lastOn : 0;
      const neededSteps = stepStart + lastIndex + 1;
      if (neededSteps > totalSteps) {
        const extraBars = Math.ceil((neededSteps - totalSteps) / STEPS_PER_BAR);
        setBars((b) => b + extraBars);
      }
      // Represent as a clip with per-clip stepPattern (so it fires on active steps)
      addClip({
        lane,
        startStep: stepStart,
        lengthSteps: Math.max(1, ch.steps.length), // visual span equals pattern length
        patch: ch.patch,
        stepPattern: ch.steps,
      });
      lane += 1;
    });
  };

  // ---- drag & drop handlers on the grid ----
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  const onDrop = (e) => {
    e.preventDefault();
    const rect = trackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const step = snap(x / pxPerStep);
    const lane = Math.max(0, Math.floor(y / laneHeight));

    const patchData = e.dataTransfer.getData('application/x-patch');
    const rackData = e.dataTransfer.getData('application/x-channelrack');

    if (patchData) {
      try {
        const patch = JSON.parse(patchData);
        dropPatchAt(patch, lane, step);
        return;
      } catch {}
    }
    if (rackData) {
      try {
        const rack = JSON.parse(rackData);
        dropRackAt(rack, lane, step);
        return;
      } catch {}
    }
  };

  // ---- mouse drag move/resize on clips ----
  const onClipMouseDown = (e, clip, edge = null) => {
    e.stopPropagation();
    setSelectedId(clip.id);

    const rect = trackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const stepAtMouse = x / pxPerStep;

    if (edge) {
      setResizing({
        id: clip.id,
        edge,
        startLen: clip.lengthSteps,
        startPos: clip.startStep,
        mouseStart: stepAtMouse,
      });
    } else {
      setDragging({
        id: clip.id,
        mouseOffset: stepAtMouse - clip.startStep,
        laneOffset: 0,
      });
    }
  };

  const onMouseMove = (e) => {
    if (!trackRef.current) return;
    if (!dragging && !resizing) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (dragging) {
      const step = snap(x / pxPerStep - dragging.mouseOffset);
      const lane = Math.max(0, Math.min(lanes - 1, Math.floor(y / laneHeight)));
      setClips(prev => prev.map(c => c.id === dragging.id ? { ...c, startStep: step, lane } : c));
    }

    if (resizing) {
      const deltaSteps = (x / pxPerStep) - resizing.mouseStart;
      if (resizing.edge === 'right') {
        const newLen = Math.max(1, snap(resizing.startLen + deltaSteps));
        setClips(prev => prev.map(c => c.id === resizing.id ? { ...c, lengthSteps: newLen } : c));
      } else {
        // left edge: move start and reduce length
        const newStart = snap(resizing.startPos + deltaSteps);
        const newLen = Math.max(1, resizing.startLen + (resizing.startPos - newStart));
        setClips(prev => prev.map(c => c.id === resizing.id ? { ...c, startStep: newStart, lengthSteps: newLen } : c));
      }
    }
  };

  const onMouseUp = () => { setDragging(null); setResizing(null); };

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  });

  // ---- transport & playback ----
  const [isPlaying, setIsPlaying] = useState(false);
  const loopRef = useRef(null);

  const schedulePlayback = async () => {
    await Tone.start();
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    transport.bpm.value = bpm;

    // For each clip, schedule triggers:
    clips.forEach((clip) => {
      const secPerStep = Tone.Time('16n').toSeconds();
      const clipStartSec = clip.startStep * secPerStep;

      if (clip.stepPattern && clip.stepPattern.some(Boolean)) {
        // pattern clip: fire on relative active steps inside the clip span
        clip.stepPattern.forEach((on, i) => {
          if (!on) return;
          const t = clipStartSec + i * secPerStep;
          transport.schedule((time) => {
            PlayPatch({
              ...clip.patch,
              // override per-clip note/duration
              note: clip.note || clip.patch.note || 'C4',
              duration: clip.duration || clip.patch.duration || '8n',
              parameters: {
                ...(clip.patch.parameters || {}),
              },
            }, time);
          }, t);
        });
      } else {
        // single hit at clip start, sustain by duration
        transport.schedule((time) => {
          PlayPatch({
            ...clip.patch,
            note: clip.note || clip.patch.note || 'C4',
            duration: clip.duration || clip.patch.duration || '8n',
          }, time);
        }, clipStartSec);
      }
    });

    // Loop over total grid length
    const totalSec = totalSteps * Tone.Time('16n').toSeconds();
    transport.loop = true;
    transport.loopStart = 0;
    transport.loopEnd = totalSec;
    transport.start();
  };

  const togglePlay = async () => {
    if (isPlaying) {
      Tone.getTransport().stop();
      setIsPlaying(false);
    } else {
      await schedulePlayback();
      setIsPlaying(true);
    }
  };

  const stop = () => {
    Tone.getTransport().stop();
    setIsPlaying(false);
  };

  // ---- clip inspector (selected) ----
  const sel = useMemo(() => clips.find(c => c.id === selectedId) || null, [clips, selectedId]);
  const updateSel = (patch) => setClips(prev => prev.map(c => c.id === selectedId ? { ...c, ...patch } : c));
  const deleteSel = () => setClips(prev => prev.filter(c => c.id !== selectedId));

  // ---- quick load by patch ID (keeps your earlier workflow handy) ----
  const loadPatchById = async (patchId, lane = 0, step = 0) => {
    try {
      const { data } = await API.get(`/patches/${patchId}/`);
      dropPatchAt(data, lane, step);
    } catch {
      alert('Patch not found');
    }
  };

  return (
    <div>
      {/* Top bar */}
      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
        <button onClick={togglePlay}>{isPlaying ? 'Pause' : 'Play'}</button>
        <button onClick={stop}>Stop</button>
        <label style={{ marginLeft:8 }}>BPM:&nbsp;
          <input type="number" value={bpm}
                 onChange={(e)=>setBpm(parseInt(e.target.value||'120',10))}
                 style={{ width:70 }} />
        </label>
        <label>Bars:&nbsp;
          <input type="number" value={bars}
                 onChange={(e)=>setBars(Math.max(1, parseInt(e.target.value||'1',10)))}
                 style={{ width:60 }} />
        </label>
        <label>Zoom:&nbsp;
          <input type="range" min="12" max="48" step="1" value={pxPerStep}
                 onChange={(e)=>setPxPerStep(parseInt(e.target.value,10))} />
        </label>
        <button onClick={importFromRack}>Import from Channel Rack</button>
        <div style={{ marginLeft: 'auto' }}>
          <input placeholder="Load patch by ID" style={{ width:160 }}
                 onKeyDown={(e)=> e.key==='Enter' && loadPatchById(e.currentTarget.value)} />
        </div>
      </div>

      {/* Timeline header (bar markers) */}
      <div style={{ marginBottom:4, marginLeft:64, position:'relative', height:20 }}>
        <div style={{ position:'absolute', inset:0, display:'grid',
                      gridTemplateColumns:`repeat(${bars}, ${STEPS_PER_BAR*pxPerStep}px)` }}>
          {Array.from({ length: bars }).map((_, b) => (
            <div key={b} style={{ borderLeft:'1px solid #999', color:'#555', fontSize:12 }}>
              <div style={{ position:'absolute', transform:`translateX(${b*STEPS_PER_BAR*pxPerStep}px)` }}>
                Bar {b+1}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Track grid */}
      <div
        ref={trackRef}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onMouseDown={() => setSelectedId(null)}
        style={{
          position:'relative',
          width: 64 + totalSteps*pxPerStep,
          maxWidth:'100%',
          border:'1px solid #ccc',
          overflowX:'auto',
          userSelect:'none'
        }}
      >
        {/* lane labels */}
        <div style={{ position:'sticky', left:0, top:0, width:64, background:'#fafafa', borderRight:'1px solid #ddd' }}>
          {Array.from({ length: lanes }).map((_, i) => (
            <div key={i}
                 style={{ height: laneHeight, lineHeight: `${laneHeight}px`, textAlign:'center', borderBottom:'1px solid #eee' }}>
              Ch {i+1}
            </div>
          ))}
        </div>

        {/* grid columns */}
        <div style={{
          position:'absolute', top:0, left:64, right:0, height: lanes*laneHeight,
          backgroundImage: `
            linear-gradient(#eee 1px, transparent 1px),
            linear-gradient(90deg, #f0f0f0 1px, transparent 1px),
            linear-gradient(90deg, rgba(180,200,255,0.2) ${pxPerStep*STEPS_PER_BAR-1}px, transparent 1px)
          `,
          backgroundSize: `
            100% ${laneHeight}px,
            ${pxPerStep}px 100%,
            ${pxPerStep*STEPS_PER_BAR}px 100%
          `
        }} />

        {/* clips */}
        <div style={{ position:'absolute', top:0, left:64, right:0 }}>
          {clips.map((c) => {
            const style = {
              position:'absolute',
              top: c.lane*laneHeight + 6,
              left: c.startStep*pxPerStep,
              width: Math.max(8, c.lengthSteps*pxPerStep),
              height: laneHeight - 12,
              background: c.id===selectedId ? '#a0d3ff' : '#cfe8ff',
              border: '1px solid #5aa0e0',
              borderRadius: 6,
              boxSizing:'border-box',
              overflow:'hidden',
              cursor:'move'
            };
            return (
              <div key={c.id}
                   style={style}
                   onMouseDown={(e)=>onClipMouseDown(e, c, null)}
                   onClick={(e)=>{ e.stopPropagation(); setSelectedId(c.id);} }
              >
                {/* resize handles */}
                <div
                  onMouseDown={(e)=>onClipMouseDown(e, c, 'left')}
                  style={{ position:'absolute', left:0, top:0, bottom:0, width:6, cursor:'ew-resize', background:'#5aa0e0' }}
                />
                <div
                  onMouseDown={(e)=>onClipMouseDown(e, c, 'right')}
                  style={{ position:'absolute', right:0, top:0, bottom:0, width:6, cursor:'ew-resize', background:'#5aa0e0' }}
                />
                {/* name */}
                <div style={{ padding:'4px 10px', fontSize:12, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {c.patch?.displayName || c.patch?.name || 'Clip'}
                  {c.stepPattern ? ' • pattern' : ''}
                </div>
                {/* mini step view */}
                {c.stepPattern && (
                  <div style={{ display:'grid', gridTemplateColumns:`repeat(${c.stepPattern.length}, 1fr)`, gap:1, padding:'0 6px' }}>
                    {c.stepPattern.map((on, i) => (
                      <div key={i} style={{ height:8, background: on ? '#2f7edb':'#9cc3ff' }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Inspector */}
      <div style={{ marginTop:12, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <div>
          <h4>Selected Clip</h4>
          {!sel ? <div>None</div> : (
            <div style={{ display:'grid', gridTemplateColumns:'120px 1fr', gap:8, alignItems:'center' }}>
              <div>Lane</div>
              <input type="number" value={sel.lane} min={0}
                     onChange={(e)=>updateSel({ lane: Math.max(0, parseInt(e.target.value||'0',10)) })} />
              <div>Start step</div>
              <input type="number" value={sel.startStep}
                     onChange={(e)=>updateSel({ startStep: snap(parseInt(e.target.value||'0',10)) })} />
              <div>Length (steps)</div>
              <input type="number" value={sel.lengthSteps} min={1}
                     onChange={(e)=>updateSel({ lengthSteps: Math.max(1, parseInt(e.target.value||'1',10)) })} />
              <div>Note</div>
              <input value={sel.note || 'C4'} onChange={(e)=>updateSel({ note: e.target.value })} />
              <div>Duration</div>
              <select value={sel.duration || '8n'} onChange={(e)=>updateSel({ duration: e.target.value })}>
                {['1n','2n','4n','8n','16n','32n'].map(d => <option key={d}>{d}</option>)}
              </select>
              <div>Gain</div>
              <input type="number" step="0.1" value={sel.gain ?? 1.0}
                     onChange={(e)=>updateSel({ gain: parseFloat(e.target.value||'1') })} />
              <div>Actions</div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={()=>setSelectedId(null)}>Deselect</button>
                <button onClick={deleteSel}>Delete</button>
              </div>
            </div>
          )}
        </div>

        <div>
          <h4>Tips / Drag sources</h4>
          <ul style={{ marginTop:6 }}>
            <li>Drag a patch from any list that uses <code>makePatchDragProps(patch)</code>.</li>
            <li>Drag the whole Channel Rack using <code>makeRackDragProps(channels, tempo)</code>.</li>
            <li>Or hit ‘Import from Channel Rack’ above.</li>
            <li>Resize clips from their edges. Move by dragging the body.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
