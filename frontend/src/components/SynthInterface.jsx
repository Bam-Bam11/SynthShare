// src/components/SynthInterface.jsx
import React, { useState, useEffect, useRef } from 'react';
import * as Tone from 'tone';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

/* =========================
   Pitch helpers (Hz ↔ note)
   ========================= */
const A4_FREQ = 440;
const A4_MIDI = 69;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToHz(midi) {
  return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
}
function hzToMidi(hz) {
  return 12 * (Math.log(hz / A4_FREQ) / Math.log(2)) + A4_MIDI;
}
function midiToName(midi) {
  const n = Math.round(midi);
  const name = NOTE_NAMES[(n + 1200) % 12];
  const octave = Math.floor(n / 12) - 1;
  return `${name}${octave}`;
}
/** Given Hz, return nearest ET note, ideal Hz, and cents deviation */
function describeHz(hz) {
  if (!hz || hz <= 0) return { label: '—', idealHz: null, cents: null };
  const exactMidi = hzToMidi(hz);
  const nearestMidi = Math.round(exactMidi);
  const idealHz = midiToHz(nearestMidi);
  const cents = Math.round(1200 * Math.log(hz / idealHz) / Math.log(2));
  return { label: midiToName(nearestMidi), idealHz, cents };
}

/* =========================
   UI constants
   ========================= */
const durationOptions = ['1n', '2n', '4n', '8n', '16n', '32n'];

const SynthInterface = ({ onParamsChange, initialParams = null, hideNameAndDescription = false }) => {
  const canvasRef = useRef(null);
  const navigate = useNavigate();

  // Visualiser (we build the audio graph on-demand in playNote)
  const [analyser, setAnalyser] = useState(null);

  // Patch meta
  const [patchName, setPatchName] = useState('');
  const [description, setDescription] = useState('');

  // Envelope
  const [attack, setAttack] = useState(0.1);
  const [decay, setDecay] = useState(0.2);
  const [sustain, setSustain] = useState(0.7);
  const [release, setRelease] = useState(0.5);

  // Filter
  const [filterType, setFilterType] = useState('none'); // none | lowpass | highpass | bandpass
  const [resonance, setResonance] = useState(1);
  const [cutoff, setCutoff] = useState(1000);
  const [bandLow, setBandLow] = useState(300);
  const [bandHigh, setBandHigh] = useState(3000);

  // Global synthesis
  const [portamento, setPortamento] = useState(0);
  const [noiseLevel, setNoiseLevel] = useState(0); // dB
  const [note, setNote] = useState('C4'); // legacy fallback if frequency is null
  const [duration, setDuration] = useState('8n');

  // Oscillator 1 (always enabled)
  const [oscType, setOscType] = useState('sine');
  const [detune, setDetune] = useState(0); // cents
  const [osc1Gain, setOsc1Gain] = useState(1);
  const [osc1Freq, setOsc1Freq] = useState(null);         // Hz; null => follow note
  const [osc1SlideFrom, setOsc1SlideFrom] = useState(null); // Hz; optional glide start

  // Oscillator 2 (toggle)
  const [osc2Enabled, setOsc2Enabled] = useState(false);
  const [osc2Type, setOsc2Type] = useState('square');
  const [osc2Gain, setOsc2Gain] = useState(0.8);
  const [osc2Detune, setOsc2Detune] = useState(0);
  const [osc2Freq, setOsc2Freq] = useState(null);         // Hz; null => follow note
  const [osc2SlideFrom, setOsc2SlideFrom] = useState(null); // Hz; optional glide start

  // Source patch (when editing/forking) — used to send `stem` on save
  const [sourcePatchId, setSourcePatchId] = useState(null);

  // Latest server-saved patch (to show computed version)
  const [currentPatch, setCurrentPatch] = useState(null);

  /* =========================
     Load patchToLoad (edit/fork)
     ========================= */
  useEffect(() => {
    const patchToLoad = localStorage.getItem('patchToLoad');
    if (!patchToLoad) return;

    try {
      const patch = JSON.parse(patchToLoad);
      const params = patch.parameters || {};

      setSourcePatchId(patch.stem || patch.id || null);

      // Meta
      setPatchName(patch.name || '');
      setDescription(patch.description || '');

      // Envelope
      setAttack(params.envelope?.attack ?? 0.1);
      setDecay(params.envelope?.decay ?? 0.2);
      setSustain(params.envelope?.sustain ?? 0.7);
      setRelease(params.envelope?.release ?? 0.5);

      // Filter
      setFilterType(params.filter?.type || 'none');
      setResonance(params.filter?.resonance ?? 1);
      setCutoff(params.filter?.cutoff ?? 1000);
      setBandLow(params.filter?.bandLow ?? 300);
      setBandHigh(params.filter?.bandHigh ?? 3000);

      // Global
      setPortamento(params.portamento ?? 0);
      setNoiseLevel(params.noiseLevel ?? 0);
      setNote(patch.note || 'C4');
      setDuration(patch.duration || '8n');

      // Oscillators
      if (Array.isArray(params.oscillators) && params.oscillators.length) {
        const [o1, o2] = params.oscillators;
        if (o1) {
          setOscType(o1.type || 'sine');
          setDetune(o1.detune || 0);
          setOsc1Gain(o1.gain ?? 1);
          setOsc1Freq(o1.frequency ?? null);
          setOsc1SlideFrom(o1.slideFrom ?? null);
        }
        if (o2) {
          setOsc2Enabled(true);
          setOsc2Type(o2.type || 'square');
          setOsc2Detune(o2.detune || 0);
          setOsc2Gain(o2.gain ?? 0.8);
          setOsc2Freq(o2.frequency ?? null);
          setOsc2SlideFrom(o2.slideFrom ?? null);
        }
      } else {
        // Legacy single-osc fields
        setOscType(params.oscillator || 'sine');
        setDetune(params.detune ?? 0);
        setOsc1Gain(1);
        setOsc1Freq(null);
        setOsc1SlideFrom(null);
        setOsc2Enabled(false);
      }
    } catch (err) {
      console.error('Failed to load patch from storage:', err);
    } finally {
      localStorage.removeItem('patchToLoad');
    }
  }, []);

  /* =========================
     Create a shared analyser
     ========================= */
  useEffect(() => {
    const a = new Tone.Analyser('fft', 128);
    setAnalyser(a);
    return () => a.dispose();
  }, []);

  /* =========================
     Draw the analyser
     ========================= */
  useEffect(() => {
    if (!analyser || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf;

    const draw = () => {
      const buffer = analyser.getValue();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath();

      const sliceWidth = canvas.width / buffer.length;
      buffer.forEach((val, i) => {
        const x = i * sliceWidth;
        const y = (1 - (val + 140) / 140) * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      ctx.strokeStyle = 'blue';
      ctx.lineWidth = 2;
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  /* =========================
     Build & play the graph
     ========================= */
  const playNote = async () => {
    await Tone.start();

    const now = Tone.now();
    const targetHzFromNote = Tone.Frequency(note).toFrequency();

    // Envelope
    const envelope = new Tone.AmplitudeEnvelope({ attack, decay, sustain, release });

    // Filter
    let filterNode = null;
    if (filterType !== 'none') {
      if (filterType === 'bandpass') {
        const center = (bandLow + bandHigh) / 2;
        const bw = Math.max(10, bandHigh - bandLow);
        filterNode = new Tone.Filter({ type: 'bandpass', frequency: center, Q: center / bw });
      } else {
        filterNode = new Tone.Filter({ type: filterType, frequency: cutoff, Q: resonance });
      }
    }

    // Route: oscillators -> (filter?) -> envelope -> analyser -> destination
    const analyserNode = analyser || new Tone.Analyser('fft', 128);
    if (filterNode) filterNode.connect(envelope);
    envelope.connect(analyserNode);
    analyserNode.toDestination();

    // Helper to create an oscillator with optional glide
    const buildOsc = ({ type, gain = 1, detuneCents = 0, freqHz = null, slideFromHz = null }) => {
      const target = (freqHz ?? targetHzFromNote);
      const startHz = (portamento > 0 && slideFromHz != null) ? slideFromHz : target;

      const osc = new Tone.Oscillator({ type, frequency: startHz, detune: detuneCents });
      const g = new Tone.Gain(gain);
      osc.connect(g);
      if (filterNode) g.connect(filterNode);
      else g.connect(envelope);

      if (portamento > 0 && startHz !== target) {
        // Exponential glide sounds natural for pitch
        osc.frequency.exponentialRampToValueAtTime(target, now + portamento);
      }
      return osc;
    };

    // Oscillator 1 (always present)
    const osc1 = buildOsc({
      type: oscType,
      gain: osc1Gain,
      detuneCents: detune,
      freqHz: osc1Freq,
      slideFromHz: osc1SlideFrom
    });

    // Oscillator 2 (optional)
    const osc2 = osc2Enabled
      ? buildOsc({
          type: osc2Type,
          gain: osc2Gain,
          detuneCents: osc2Detune,
          freqHz: osc2Freq,
          slideFromHz: osc2SlideFrom
        })
      : null;

    // Noise
    const noiseNode = new Tone.Noise('white');
    noiseNode.volume.value = noiseLevel;
    if (noiseLevel > -60) {
      if (filterNode) noiseNode.connect(filterNode);
      else noiseNode.connect(envelope);
    }

    // Start + trigger
    osc1.start(now);
    if (osc2) osc2.start(now);
    if (noiseLevel > -60) {
      noiseNode.start(now);
      noiseNode.stop(now + Tone.Time(duration).toSeconds());
    }
    envelope.triggerAttackRelease(duration, now);

    // Stop oscs after duration
    const stopAt = now + Tone.Time(duration).toSeconds() + 0.01;
    osc1.stop(stopAt);
    if (osc2) osc2.stop(stopAt);

    // Cleanup
    setTimeout(() => {
      osc1.dispose();
      if (osc2) osc2.dispose();
      noiseNode.dispose();
      if (!analyser) analyserNode.dispose();
      if (filterNode) filterNode.dispose();
      envelope.dispose();
    }, Tone.Time(duration).toMilliseconds() + 50);
  };

  /* =========================
     Save / Post / Download
     ========================= */
  const handleSavePatch = async () => {
    const token = localStorage.getItem('access_token');
    const name = (patchName || '').trim() || 'Untitled Patch';
    const desc = (description || '').trim().slice(0, 500);

    const parameters = {
      // New multi-osc payload
      oscillators: [
        {
          type: oscType,
          gain: osc1Gain,
          detune,
          frequency: osc1Freq,       // null => follow global note
          slideFrom: osc1SlideFrom
        },
        ...(osc2Enabled ? [{
          type: osc2Type,
          gain: osc2Gain,
          detune: osc2Detune,
          frequency: osc2Freq,
          slideFrom: osc2SlideFrom
        }] : [])
      ],

      // Envelope / filter / global params
      envelope: { attack, decay, sustain, release },
      filter: {
        type: filterType,
        resonance,
        ...(filterType === 'lowpass' || filterType === 'highpass' ? { cutoff } : {}),
        ...(filterType === 'bandpass' ? { bandLow, bandHigh } : {}),
      },
      portamento,
      noiseLevel,

      // Legacy for backward compatibility
      oscillator: oscType,
      detune
    };

    const payload = {
      name,
      description: desc,
      parameters,
      synth_type: 'tone',
      note,
      duration,
      is_posted: false,
      ...(sourcePatchId ? { stem: sourcePatchId } : {})
    };

    try {
      const res = await axios.post('http://localhost:8000/api/patches/', payload, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      setCurrentPatch(res.data);
      alert(`Patch saved successfully as v${res.data.version || '0.0'}`);
      console.log('Saved patch response:', res.data);
    } catch (err) {
      console.error('Error saving patch:', err?.response?.status, err?.response?.data || err);
      alert('Failed to save patch.');
    }
  };

  const handlePostPatch = async () => {
    alert('Please post from the profile page after saving (unchanged workflow).');
  };

  const handleDownloadPatch = () => {
    const name = (patchName || 'untitled').trim();
    const parameters = {
      oscillators: [
        {
          type: oscType,
          gain: osc1Gain,
          detune,
          frequency: osc1Freq,
          slideFrom: osc1SlideFrom
        },
        ...(osc2Enabled ? [{
          type: osc2Type,
          gain: osc2Gain,
          detune: osc2Detune,
          frequency: osc2Freq,
          slideFrom: osc2SlideFrom
        }] : [])
      ],
      envelope: { attack, decay, sustain, release },
      filter: {
        type: filterType,
        resonance,
        ...(filterType === 'lowpass' || filterType === 'highpass' ? { cutoff } : {}),
        ...(filterType === 'bandpass' ? { bandLow, bandHigh } : {}),
      },
      portamento,
      noiseLevel,
      oscillator: oscType,
      detune
    };
    const savedPatch = { name, description, parameters, note, duration };

    const filename = `${name}spatch.json`;
    const blob = new Blob([JSON.stringify(savedPatch, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  /* =========================
     Notify parent (if any)
     ========================= */
  useEffect(() => {
    if (!onParamsChange) return;
    const current = {
      oscillators: [
        { type: oscType, gain: osc1Gain, detune, frequency: osc1Freq, slideFrom: osc1SlideFrom },
        ...(osc2Enabled ? [{ type: osc2Type, gain: osc2Gain, detune: osc2Detune, frequency: osc2Freq, slideFrom: osc2SlideFrom }] : [])
      ],
      detune, portamento, noiseLevel, note, duration,
      envelope: { attack, decay, sustain, release },
      filter: {
        type: filterType, resonance,
        ...(filterType === 'lowpass' || filterType === 'highpass' ? { cutoff } : {}),
        ...(filterType === 'bandpass' ? { bandLow, bandHigh } : {})
      }
    };
    onParamsChange(current);
  }, [
    oscType, detune, osc1Gain, osc1Freq, osc1SlideFrom,
    osc2Enabled, osc2Type, osc2Gain, osc2Detune, osc2Freq, osc2SlideFrom,
    attack, decay, sustain, release,
    filterType, resonance, cutoff, bandLow, bandHigh,
    portamento, noiseLevel, note, duration,
    onParamsChange
  ]);

  /* =========================
     UI helpers for frequency
     ========================= */
  const HzHelper = ({ valueHz }) => {
    const d = describeHz(valueHz ?? 0);
    if (!valueHz) return <div className="text-sm text-gray-600 mt-1">Type a frequency to see the nearest musical note</div>;
    return (
      <div className="text-sm text-gray-600 mt-1">
        ≈ {d.label} ({d.idealHz?.toFixed(2)} Hz) • {d.cents > 0 ? '+' : ''}{d.cents ?? 0} cents
      </div>
    );
  };

  const SnapButtons = ({ onSnap }) => (
    <div className="flex gap-2 mt-2">
      <button className="px-2 py-1 border rounded" onClick={() => onSnap(midiToHz(69))}>A4</button>
      <button className="px-2 py-1 border rounded" onClick={() => onSnap(midiToHz(60))}>C4</button>
      <button className="px-2 py-1 border rounded" onClick={() => onSnap(midiToHz(64))}>E4</button>
      <button className="px-2 py-1 border rounded" onClick={() => onSnap(midiToHz(67))}>G4</button>
    </div>
  );

  return (
    <div className="param-box p-4 max-w-3xl mx-auto rounded-xl shadow-lg">
      <h2 className="text-xl font-bold mb-4">Synth Interface</h2>

      {/* Show latest server version if available */}
      {currentPatch && (
        <div className="mb-3 p-2 rounded border bg-green-50 text-green-700">
          Saved as <strong>v{currentPatch.version || '0.0'}</strong>
          <button
            className="ml-3 px-2 py-1 text-sm border rounded hover:bg-green-100"
            onClick={() => navigate(`/patches/${currentPatch.id}`)}
          >
            View Lineage
          </button>
        </div>
      )}

      {!hideNameAndDescription && (
        <>
          <div className="mb-4">
            <label className="block mb-1 font-medium">Patch Name:</label>
            <input
              type="text"
              value={patchName}
              onChange={(e) => setPatchName(e.target.value)}
              className="p-2 border rounded w-full"
              placeholder="Enter patch name"
            />
          </div>
          <div className="mb-4">
            <label className="block mb-1 font-medium">Description (max 500 chars):</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              className="p-2 border rounded w-full"
              placeholder="Describe this patch"
              rows={4}
            />
          </div>
        </>
      )}

      {/* Oscillator 1 */}
      <div className="mt-2 p-3 border rounded">
        <h3 className="font-semibold mb-2">Oscillator 1</h3>
        <label className="block mb-1">Type</label>
        <select
          value={oscType}
          onChange={(e) => setOscType(e.target.value)}
          className="mb-3 p-2 border rounded w-full"
        >
          <option value="sine">Sine</option>
          <option value="square">Square</option>
          <option value="triangle">Triangle</option>
          <option value="sawtooth">Sawtooth</option>
        </select>

        <label className="block">Gain</label>
        <input type="range" min="0" max="2" step="0.01" value={osc1Gain}
               onChange={(e) => setOsc1Gain(parseFloat(e.target.value))} className="w-full" />
        <div className="mb-3">{osc1Gain.toFixed(2)}</div>

        <label className="block">Detune (cents)</label>
        <input type="number" step="1" value={detune}
               onChange={(e) => setDetune(parseInt(e.target.value || '0', 10))}
               className="p-2 border rounded w-full mb-3" />

        <label className="block">Frequency (Hz, blank = follow note)</label>
        <input
          type="number"
          min="10"
          max="20000"
          step="0.1"
          placeholder="follow note"
          value={osc1Freq ?? ''}
          onChange={(e) => setOsc1Freq(e.target.value === '' ? null : parseFloat(e.target.value))}
          className="p-2 border rounded w-full"
        />
        <HzHelper valueHz={osc1Freq} />
        <SnapButtons onSnap={(hz) => setOsc1Freq(hz)} />

        <label className="block mt-3">slideFrom (Hz, optional for glide)</label>
        <input
          type="number"
          placeholder="none"
          value={osc1SlideFrom ?? ''}
          onChange={(e) => setOsc1SlideFrom(e.target.value === '' ? null : parseFloat(e.target.value))}
          className="p-2 border rounded w-full"
        />
      </div>

      {/* Oscillator 2 */}
      <div className="mt-4 p-3 border rounded">
        <div className="flex items-center gap-2 mb-2">
          <input id="osc2en" type="checkbox" checked={osc2Enabled} onChange={(e) => setOsc2Enabled(e.target.checked)} />
          <label htmlFor="osc2en" className="font-semibold">Enable Oscillator 2</label>
        </div>

        {osc2Enabled && (
          <>
            <label className="block mb-1">Type</label>
            <select
              value={osc2Type}
              onChange={(e) => setOsc2Type(e.target.value)}
              className="mb-3 p-2 border rounded w-full"
            >
              <option value="sine">Sine</option>
              <option value="square">Square</option>
              <option value="triangle">Triangle</option>
              <option value="sawtooth">Sawtooth</option>
            </select>

            <label className="block">Gain</label>
            <input type="range" min="0" max="2" step="0.01" value={osc2Gain}
                   onChange={(e) => setOsc2Gain(parseFloat(e.target.value))} className="w-full" />
            <div className="mb-3">{osc2Gain.toFixed(2)}</div>

            <label className="block">Detune (cents)</label>
            <input type="number" step="1" value={osc2Detune}
                   onChange={(e) => setOsc2Detune(parseInt(e.target.value || '0', 10))}
                   className="p-2 border rounded w-full mb-3" />

            <label className="block">Frequency (Hz, blank = follow note)</label>
            <input
              type="number"
              min="10"
              max="20000"
              step="0.1"
              placeholder="follow note"
              value={osc2Freq ?? ''}
              onChange={(e) => setOsc2Freq(e.target.value === '' ? null : parseFloat(e.target.value))}
              className="p-2 border rounded w-full"
            />
            <HzHelper valueHz={osc2Freq} />
            <SnapButtons onSnap={(hz) => setOsc2Freq(hz)} />

            <label className="block mt-3">slideFrom (Hz, optional for glide)</label>
            <input
              type="number"
              placeholder="none"
              value={osc2SlideFrom ?? ''}
              onChange={(e) => setOsc2SlideFrom(e.target.value === '' ? null : parseFloat(e.target.value))}
              className="p-2 border rounded w-full"
            />
          </>
        )}
      </div>

      {/* Filter */}
      <div className="mt-4 p-3 border rounded">
        <h3 className="font-semibold mb-2">Filter</h3>
        <div>Type</div>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="p-2 border rounded w-full mb-3">
          <option value="none">No Filter</option>
          <option value="lowpass">Lowpass</option>
          <option value="highpass">Highpass</option>
          <option value="bandpass">Bandpass</option>
        </select>

        <div>Resonance (Q): {resonance}</div>
        <input
          type="range"
          min="0.1"
          max="10"
          step="0.1"
          value={resonance}
          onChange={(e) => setResonance(parseFloat(e.target.value))}
          className="w-full mb-3"
        />

        {(filterType === 'lowpass' || filterType === 'highpass') && (
          <div className="mb-3">
            <label className="block mb-1">Cutoff Frequency: {cutoff} Hz</label>
            <input
              type="range"
              min="50"
              max="10000"
              step="10"
              value={cutoff}
              onChange={(e) => setCutoff(parseInt(e.target.value || '0', 10))}
              className="w-full"
            />
          </div>
        )}

        {filterType === 'bandpass' && (
          <>
            <div className="mb-3">
              <label className="block mb-1">Band Low: {bandLow} Hz</label>
              <input
                type="range"
                min="50"
                max={Math.max(60, bandHigh - 10)}
                step="10"
                value={bandLow}
                onChange={(e) => setBandLow(parseInt(e.target.value || '0', 10))}
                className="w-full"
              />
            </div>
            <div className="mb-1">
              <label className="block mb-1">Band High: {bandHigh} Hz</label>
              <input
                type="range"
                min={Math.min(9990, bandLow + 10)}
                max="10000"
                step="10"
                value={bandHigh}
                onChange={(e) => setBandHigh(parseInt(e.target.value || '0', 10))}
                className="w-full"
              />
            </div>
          </>
        )}
      </div>

      {/* Env / Glide / Noise / Legacy note */}
      <div className="mt-4 p-3 border rounded">
        <h3 className="font-semibold mb-2">Envelope & Global</h3>

        <div className="mb-2">Attack: {attack.toFixed(2)} s</div>
        <input type="range" min="0" max="2" step="0.01" value={attack}
               onChange={(e) => setAttack(parseFloat(e.target.value))} className="w-full" />

        <div className="mb-2">Decay: {decay.toFixed(2)} s</div>
        <input type="range" min="0" max="2" step="0.01" value={decay}
               onChange={(e) => setDecay(parseFloat(e.target.value))} className="w-full" />

        <div className="mb-2">Sustain: {Math.round(sustain * 100)}%</div>
        <input type="range" min="0" max="1" step="0.01" value={sustain}
               onChange={(e) => setSustain(parseFloat(e.target.value))} className="w-full" />

        <div className="mb-2">Release: {release.toFixed(2)} s</div>
        <input type="range" min="0" max="3" step="0.01" value={release}
               onChange={(e) => setRelease(parseFloat(e.target.value))} className="w-full" />

        <div className="mt-3">Portamento (Glide): {portamento.toFixed(2)} s</div>
        <input type="range" min="0" max="1" step="0.01" value={portamento}
               onChange={(e) => setPortamento(parseFloat(e.target.value))} className="w-full" />

        <div className="mt-3">Noise Level (dB): {noiseLevel}</div>
        <input type="range" min="-60" max="0" step="1" value={noiseLevel}
               onChange={(e) => setNoiseLevel(parseInt(e.target.value || '-60', 10))} className="w-full" />

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="block">Legacy Note (fallback)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="p-2 border rounded w-full"
            />
          </div>
          <div>
            <label className="block">Duration</label>
            <select value={duration} onChange={(e) => setDuration(e.target.value)} className="p-2 border rounded w-full">
              {durationOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Transport / Actions */}
      <div className="mt-4 flex gap-2">
        <button className="btn btn-play" onClick={playNote}>Play</button>
        {!hideNameAndDescription && (
          <>
            <button className="btn btn-primary btn-save" onClick={handleSavePatch}>Save patch</button>
            <button className="btn btn-accent" onClick={handlePostPatch}>Post patch</button>
            <button className="btn btn-info btn-download" onClick={handleDownloadPatch}>Download patch</button>
          </>
        )}
      </div>

      {/* Visualiser */}
      <div className="mt-4">
        <h3>Frequency Visualisation:</h3>
        <canvas
          ref={canvasRef}
          width={500}
          height={120}
          style={{ border: '1px solid var(--panel-border)', width: '100%' }}
        />
      </div>
    </div>
  );
};

export default SynthInterface;
