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

  // Global synthesis
  const [portamento, setPortamento] = useState(0);
  const [noiseLevel, setNoiseLevel] = useState(0); // dB
  const [duration, setDuration] = useState('8n');
  const [masterGain, setMasterGain] = useState(1); // Add Master Gain

  // Oscillator 1
  const [osc1Type, setOsc1Type] = useState('sine');
  const [osc1Detune, setOsc1Detune] = useState(0); // cents
  const [osc1Gain, setOsc1Gain] = useState(1);
  const [osc1Freq, setOsc1Freq] = useState(440);   // Hz; default to A4
  const [osc1SlideFrom, setOsc1SlideFrom] = useState(null); // Hz; optional glide start

  // Oscillator 1 Filter
  const [osc1FilterType, setOsc1FilterType] = useState('none');
  const [osc1Resonance, setOsc1Resonance] = useState(1);
  const [osc1Cutoff, setOsc1Cutoff] = useState(1000);
  const [osc1BandLow, setOsc1BandLow] = useState(300);
  const [osc1BandHigh, setOsc1BandHigh] = useState(3000);

  // Oscillator 2
  const [osc2Enabled, setOsc2Enabled] = useState(false);
  const [osc2Type, setOsc2Type] = useState('square');
  const [osc2Detune, setOsc2Detune] = useState(0);
  const [osc2Gain, setOsc2Gain] = useState(0.8);
  const [osc2Freq, setOsc2Freq] = useState(440);   // Hz; default to A4
  const [osc2SlideFrom, setOsc2SlideFrom] = useState(null); // Hz; optional glide start

  // Oscillator 2 Filter
  const [osc2FilterType, setOsc2FilterType] = useState('none');
  const [osc2Resonance, setOsc2Resonance] = useState(1);
  const [osc2Cutoff, setOsc2Cutoff] = useState(1000);
  const [osc2BandLow, setOsc2BandLow] = useState(300);
  const [osc2BandHigh, setOsc2BandHigh] = useState(3000);

  // Source patch (when editing/forking)
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

      // Global
      setPortamento(params.portamento ?? 0);
      setNoiseLevel(params.noiseLevel ?? 0);
      setDuration(patch.duration || '8n');
      setMasterGain(params.masterGain ?? 1); // Load Master Gain

      // Oscillators - only new format supported
      if (Array.isArray(params.oscillators) && params.oscillators.length) {
        const [o1, o2] = params.oscillators;
        if (o1) {
          setOsc1Type(o1.type || 'sine');
          setOsc1Detune(o1.detune || 0);
          setOsc1Gain(o1.gain ?? 1);
          setOsc1Freq(o1.frequency ?? 440);  // Default to A4 if not specified
          setOsc1SlideFrom(o1.slideFrom ?? null);
          
          // Oscillator 1 filter
          if (o1.filter) {
            setOsc1FilterType(o1.filter.type || 'none');
            setOsc1Resonance(o1.filter.resonance ?? 1);
            setOsc1Cutoff(o1.filter.cutoff ?? 1000);
            setOsc1BandLow(o1.filter.bandLow ?? 300);
            setOsc1BandHigh(o1.filter.bandHigh ?? 3000);
          }
        }
        if (o2) {
          setOsc2Enabled(true);
          setOsc2Type(o2.type || 'square');
          setOsc2Detune(o2.detune || 0);
          setOsc2Gain(o2.gain ?? 0.8);
          setOsc2Freq(o2.frequency ?? 440);  // Default to A4 if not specified
          setOsc2SlideFrom(o2.slideFrom ?? null);
          
          // Oscillator 2 filter
          if (o2.filter) {
            setOsc2FilterType(o2.filter.type || 'none');
            setOsc2Resonance(o2.filter.resonance ?? 1);
            setOsc2Cutoff(o2.filter.cutoff ?? 1000);
            setOsc2BandLow(o2.filter.bandLow ?? 300);
            setOsc2BandHigh(o2.filter.bandHigh ?? 3000);
          }
        }
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

    // Fixed reference frame settings with 0dB at top
    const minDB = -100;
    const maxDB = 0;
    const dbRange = maxDB - minDB;
    
    // Margins for labels
    const margin = {
      top: 25,
      right: 20,
      bottom: 35,
      left: 80
    };
    
    const graphWidth = canvas.width - margin.left - margin.right;
    const graphHeight = canvas.height - margin.top - margin.bottom;

    // Track audio state
    let isPlaying = false;
    let lastAudioTime = 0;

    // Draw static reference grid
    const drawReferenceGrid = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw graph background
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(margin.left, margin.top, graphWidth, graphHeight);
      
      // Vertical dB reference lines
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;
      ctx.font = '10px monospace';
      ctx.fillStyle = '#666';
      ctx.textAlign = 'right';
      
      const dbLevels = [0, -20, -40, -60, -80];
      dbLevels.forEach(db => {
        const normalized = (db - minDB) / dbRange;
        const y = margin.top + (1 - normalized) * graphHeight;
        
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left + graphWidth, y);
        ctx.stroke();
        
        ctx.fillText(`${db} dB`, margin.left - 10, y + 3);
      });

      // Horizontal frequency references
      ctx.textAlign = 'center';
      ctx.fillStyle = '#666';
      const freqLevels = [100, 500, 1000, 2000, 5000, 10000];
      freqLevels.forEach(freq => {
        const logFreq = Math.log10(freq);
        const logMin = Math.log10(50);
        const logMax = Math.log10(18000);
        const x = margin.left + ((logFreq - logMin) / (logMax - logMin)) * graphWidth;
        
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, margin.top + graphHeight);
        ctx.stroke();
        
        const label = freq < 1000 ? `${freq}` : `${freq/1000}k`;
        ctx.fillText(label, x, margin.top + graphHeight + 15);
      });

      // Extreme frequency labels
      ctx.fillText('0', margin.left, margin.top + graphHeight + 15);
      ctx.fillText('20k', margin.left + graphWidth, margin.top + graphHeight + 15);

      // Axis titles
      ctx.textAlign = 'center';
      ctx.fillText('Frequency (Hz)', canvas.width / 2, canvas.height - 10);
      
      // Vertical amplitude label
      ctx.save();
      ctx.translate(15, canvas.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('Amplitude (dB)', 0, 0);
      ctx.restore();

      // Graph border
      ctx.strokeStyle = '#ccc';
      ctx.lineWidth = 1;
      ctx.strokeRect(margin.left, margin.top, graphWidth, graphHeight);
    };

    // Draw the dynamic spectrum
    const drawSpectrum = () => {
      const buffer = analyser.getValue();
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawReferenceGrid();

      let totalMagnitude = 0;
      let validPoints = 0;
      
      buffer.forEach(val => {
        if (val < -1) {
          totalMagnitude += Math.abs(val);
          validPoints++;
        }
      });
      
      const averageMagnitude = validPoints > 0 ? totalMagnitude / validPoints : 0;
      const currentTime = Date.now();
      
      const hasAudioContent = averageMagnitude > 5 && validPoints > 10;
      
      if (hasAudioContent) {
        isPlaying = true;
        lastAudioTime = currentTime;
      } else if (currentTime - lastAudioTime > 50) {
        isPlaying = false;
      }

      if (isPlaying) {
        ctx.beginPath();
        ctx.strokeStyle = 'blue';
        ctx.lineWidth = 2;
        
        const sampleRate = 44100;
        const logMin = Math.log10(50);
        const logMax = Math.log10(18000);
        
        let firstPoint = true;
        let pointsDrawn = 0;
        
        buffer.forEach((val, i) => {
          const freq = (i / buffer.length) * (sampleRate / 2);
          
          if (freq < 50 || freq > 18000) return;
          if (val >= -1) return;
          
          const logFreq = Math.log10(freq);
          const x = margin.left + ((logFreq - logMin) / (logMax - logMin)) * graphWidth;
          
          const clampedDB = Math.max(minDB, Math.min(maxDB, val));
          const normalized = (clampedDB - minDB) / dbRange;
          const y = margin.top + (1 - normalized) * graphHeight;
          
          const clampedY = Math.max(margin.top, Math.min(margin.top + graphHeight, y));
          
          if (firstPoint) {
            ctx.moveTo(x, clampedY);
            firstPoint = false;
          } else {
            ctx.lineTo(x, clampedY);
          }
          pointsDrawn++;
        });
        
        if (pointsDrawn > 5) {
          ctx.stroke();
        }
      }

      raf = requestAnimationFrame(drawSpectrum);
    };

    drawReferenceGrid();
    raf = requestAnimationFrame(drawSpectrum);
    
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  /* =========================
     Build & play the graph
     ========================= */
  const playNote = async () => {
    await Tone.start();

    const now = Tone.now();

    // Envelope
    const envelope = new Tone.AmplitudeEnvelope({ attack, decay, sustain, release });

    // Route: oscillators -> (individual filters) -> envelope -> master gain -> analyser -> destination
    const analyserNode = analyser || new Tone.Analyser('fft', 128);
    
    // Add master gain
    const master = new Tone.Gain(masterGain);
    envelope.connect(master);
    master.connect(analyserNode);
    analyserNode.toDestination();

    // Helper to create filter for an oscillator
    const createFilter = (filterType, resonance, cutoff, bandLow, bandHigh) => {
      if (filterType === 'none') return null;
      
      if (filterType === 'bandpass') {
        const center = (bandLow + bandHigh) / 2;
        const bw = Math.max(10, bandHigh - bandLow);
        return new Tone.Filter({ type: 'bandpass', frequency: center, Q: center / bw });
      } else {
        return new Tone.Filter({ type: filterType, frequency: cutoff, Q: resonance });
      }
    };

    // Helper to create an oscillator with optional glide and individual filter
    const buildOsc = ({ 
      type, 
      gain = 1, 
      detuneCents = 0, 
      freqHz = 440, 
      slideFromHz = null,
      filterType,
      filterResonance,
      filterCutoff,
      filterBandLow,
      filterBandHigh
    }) => {
      const target = freqHz;
      const startHz = (portamento > 0 && slideFromHz != null) ? slideFromHz : target;

      const osc = new Tone.Oscillator({ type, frequency: startHz, detune: detuneCents });
      const g = new Tone.Gain(gain);
      osc.connect(g);
      
      // Create individual filter for this oscillator
      const filter = createFilter(filterType, filterResonance, filterCutoff, filterBandLow, filterBandHigh);
      if (filter) {
        g.connect(filter);
        filter.connect(envelope);
      } else {
        g.connect(envelope);
      }

      if (portamento > 0 && startHz !== target) {
        osc.frequency.exponentialRampToValueAtTime(target, now + portamento);
      }
      return { osc, gain: g, filter };
    };

    // Oscillator 1 with individual filter
    const osc1 = buildOsc({
      type: osc1Type,
      gain: osc1Gain,
      detuneCents: osc1Detune,
      freqHz: osc1Freq,
      slideFromHz: osc1SlideFrom,
      filterType: osc1FilterType,
      filterResonance: osc1Resonance,
      filterCutoff: osc1Cutoff,
      filterBandLow: osc1BandLow,
      filterBandHigh: osc1BandHigh
    });

    // Oscillator 2 with individual filter
    const osc2 = osc2Enabled
      ? buildOsc({
          type: osc2Type,
          gain: osc2Gain,
          detuneCents: osc2Detune,
          freqHz: osc2Freq,
          slideFromHz: osc2SlideFrom,
          filterType: osc2FilterType,
          filterResonance: osc2Resonance,
          filterCutoff: osc2Cutoff,
          filterBandLow: osc2BandLow,
          filterBandHigh: osc2BandHigh
        })
      : null;

    // Noise
    const noiseNode = new Tone.Noise('white');
    noiseNode.volume.value = noiseLevel;
    if (noiseLevel > -60) {
      noiseNode.connect(envelope);
    }

    // Start + trigger
    osc1.osc.start(now);
    if (osc2) osc2.osc.start(now);
    if (noiseLevel > -60) {
      noiseNode.start(now);
      noiseNode.stop(now + Tone.Time(duration).toSeconds());
    }
    envelope.triggerAttackRelease(duration, now);

    // Stop oscs after duration
    const stopAt = now + Tone.Time(duration).toSeconds() + 0.01;
    osc1.osc.stop(stopAt);
    if (osc2) osc2.osc.stop(stopAt);

    // Cleanup
    setTimeout(() => {
      osc1.osc.dispose();
      osc1.gain.dispose();
      if (osc1.filter) osc1.filter.dispose();
      
      if (osc2) {
        osc2.osc.dispose();
        osc2.gain.dispose();
        if (osc2.filter) osc2.filter.dispose();
      }
      
      if (noiseLevel > -60) noiseNode.dispose();
      if (!analyser) analyserNode.dispose();
      envelope.dispose();
      master.dispose(); // Add master to cleanup
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
      oscillators: [
        {
          type: osc1Type,
          gain: osc1Gain,
          detune: osc1Detune,
          frequency: osc1Freq,
          slideFrom: osc1SlideFrom,
          filter: {
            type: osc1FilterType,
            resonance: osc1Resonance,
            ...(osc1FilterType === 'lowpass' || osc1FilterType === 'highpass' ? { cutoff: osc1Cutoff } : {}),
            ...(osc1FilterType === 'bandpass' ? { bandLow: osc1BandLow, bandHigh: osc1BandHigh } : {}),
          }
        },
        ...(osc2Enabled ? [{
          type: osc2Type,
          gain: osc2Gain,
          detune: osc2Detune,
          frequency: osc2Freq,
          slideFrom: osc2SlideFrom,
          filter: {
            type: osc2FilterType,
            resonance: osc2Resonance,
            ...(osc2FilterType === 'lowpass' || osc2FilterType === 'highpass' ? { cutoff: osc2Cutoff } : {}),
            ...(osc2FilterType === 'bandpass' ? { bandLow: osc2BandLow, bandHigh: osc2BandHigh } : {}),
          }
        }] : [])
      ],
      envelope: { attack, decay, sustain, release },
      portamento,
      noiseLevel,
      masterGain // Add Master Gain to parameters
    };

    const payload = {
      name,
      description: desc,
      parameters,
      synth_type: 'tone',
      duration,
      is_posted: false,
      ...(sourcePatchId ? { stem: sourcePatchId } : {})
    };

    console.log('Saving patch with payload:', payload);

    try {
      const res = await axios.post('http://localhost:8000/api/patches/', payload, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      setCurrentPatch(res.data);
      alert(`Patch saved successfully as v${res.data.version || '0.0'}`);
      console.log('Saved patch response:', res.data);
    } catch (err) {
      console.error('Full error object:', err);
      console.error('Error response:', err.response);
      console.error('Error status:', err.response?.status);
      console.error('Error data:', err.response?.data);
      alert(`Failed to save patch: ${err.response?.data?.detail || err.message}`);
    }
  };
  
  const handleDownloadPatch = () => {
    const name = (patchName || 'untitled').trim();
    const parameters = {
      oscillators: [
        {
          type: osc1Type,
          gain: osc1Gain,
          detune: osc1Detune,
          frequency: osc1Freq,
          slideFrom: osc1SlideFrom,
          filter: {
            type: osc1FilterType,
            resonance: osc1Resonance,
            ...(osc1FilterType === 'lowpass' || osc1FilterType === 'highpass' ? { cutoff: osc1Cutoff } : {}),
            ...(osc1FilterType === 'bandpass' ? { bandLow: osc1BandLow, bandHigh: osc1BandHigh } : {}),
          }
        },
        ...(osc2Enabled ? [{
          type: osc2Type,
          gain: osc2Gain,
          detune: osc2Detune,
          frequency: osc2Freq,
          slideFrom: osc2SlideFrom,
          filter: {
            type: osc2FilterType,
            resonance: osc2Resonance,
            ...(osc2FilterType === 'lowpass' || osc2FilterType === 'highpass' ? { cutoff: osc2Cutoff } : {}),
            ...(osc2FilterType === 'bandpass' ? { bandLow: osc2BandLow, bandHigh: osc2BandHigh } : {}),
          }
        }] : [])
      ],
      envelope: { attack, decay, sustain, release },
      portamento,
      noiseLevel,
      masterGain // Add Master Gain to parameters
    };
    const savedPatch = { 
      name, 
      description, 
      parameters, 
      duration 
    };

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
        { 
          type: osc1Type, 
          gain: osc1Gain, 
          detune: osc1Detune, 
          frequency: osc1Freq, 
          slideFrom: osc1SlideFrom,
          filter: {
            type: osc1FilterType,
            resonance: osc1Resonance,
            ...(osc1FilterType === 'lowpass' || osc1FilterType === 'highpass' ? { cutoff: osc1Cutoff } : {}),
            ...(osc1FilterType === 'bandpass' ? { bandLow: osc1BandLow, bandHigh: osc1BandHigh } : {})
          }
        },
        ...(osc2Enabled ? [{ 
          type: osc2Type, 
          gain: osc2Gain, 
          detune: osc2Detune, 
          frequency: osc2Freq, 
          slideFrom: osc2SlideFrom,
          filter: {
            type: osc2FilterType,
            resonance: osc2Resonance,
            ...(osc2FilterType === 'lowpass' || osc2FilterType === 'highpass' ? { cutoff: osc2Cutoff } : {}),
            ...(osc2FilterType === 'bandpass' ? { bandLow: osc2BandLow, bandHigh: osc2BandHigh } : {})
          }
        }] : [])
      ],
      portamento, noiseLevel, duration, masterGain, // Add masterGain here
      envelope: { attack, decay, sustain, release }
    };
    onParamsChange(current);
  }, [
    osc1Type, osc1Detune, osc1Gain, osc1Freq, osc1SlideFrom,
    osc2Enabled, osc2Type, osc2Gain, osc2Detune, osc2Freq, osc2SlideFrom,
    attack, decay, sustain, release,
    osc1FilterType, osc1Resonance, osc1Cutoff, osc1BandLow, osc1BandHigh,
    osc2FilterType, osc2Resonance, osc2Cutoff, osc2BandLow, osc2BandHigh,
    portamento, noiseLevel, duration, masterGain, // Add masterGain here
    onParamsChange
  ]);

  /* =========================
     UI helpers for frequency
     ========================= */
  const HzHelper = ({ valueHz }) => {
    const d = describeHz(valueHz ?? 0);
    if (!valueHz) return <div className="text-sm text-gray-600 mt-1">Enter a frequency to see the nearest musical note</div>;
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

  // Filter UI component for reusability
  const FilterUI = ({ 
    filterType, setFilterType, 
    resonance, setResonance, 
    cutoff, setCutoff, 
    bandLow, setBandLow, 
    bandHigh, setBandHigh,
    title 
  }) => (
    <div className="mt-3 p-3 border rounded">
      <h4 className="font-semibold mb-2">{title}</h4>
      <div>Type</div>
      <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="p-2 border rounded w-full mb-3">
        <option value="none">No Filter</option>
        <option value="lowpass">Lowpass</option>
        <option value="highpass">Highpass</option>
        <option value="bandpass">Bandpass</option>
      </select>

      {filterType !== 'none' && (
        <>
          <div>Resonance (Q): {resonance.toFixed(1)}</div>
          <input
            type="range"
            min="0.5"
            max="30"
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
        </>
      )}
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
          value={osc1Type}
          onChange={(e) => setOsc1Type(e.target.value)}
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
        <input type="number" step="1" value={osc1Detune}
               onChange={(e) => setOsc1Detune(parseInt(e.target.value || '0', 10))}
               className="p-2 border rounded w-full mb-3" />

        <label className="block">Frequency (Hz)</label>
        <input
          type="number"
          min="10"
          max="20000"
          step="0.1"
          value={osc1Freq}
          onChange={(e) => setOsc1Freq(parseFloat(e.target.value))}
          className="p-2 border rounded w-full"
        />
        <HzHelper valueHz={osc1Freq} />
        <SnapButtons onSnap={(hz) => setOsc1Freq(hz)} />

        <label className="block mt-3">Slide from (Hz, optional for glide)</label>
        <input
          type="number"
          placeholder="none"
          value={osc1SlideFrom ?? ''}
          onChange={(e) => setOsc1SlideFrom(e.target.value === '' ? null : parseFloat(e.target.value))}
          className="p-2 border rounded w-full"
        />

        {/* Oscillator 1 Filter */}
        <FilterUI
          filterType={osc1FilterType}
          setFilterType={setOsc1FilterType}
          resonance={osc1Resonance}
          setResonance={setOsc1Resonance}
          cutoff={osc1Cutoff}
          setCutoff={setOsc1Cutoff}
          bandLow={osc1BandLow}
          setBandLow={setOsc1BandLow}
          bandHigh={osc1BandHigh}
          setBandHigh={setOsc1BandHigh}
          title="Oscillator 1 Filter"
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

            <label className="block">Frequency (Hz)</label>
            <input
              type="number"
              min="10"
              max="20000"
              step="0.1"
              value={osc2Freq}
              onChange={(e) => setOsc2Freq(parseFloat(e.target.value))}
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

            {/* Oscillator 2 Filter */}
            <FilterUI
              filterType={osc2FilterType}
              setFilterType={setOsc2FilterType}
              resonance={osc2Resonance}
              setResonance={setOsc2Resonance}
              cutoff={osc2Cutoff}
              setCutoff={setOsc2Cutoff}
              bandLow={osc2BandLow}
              setBandLow={setOsc2BandLow}
              bandHigh={osc2BandHigh}
              setBandHigh={setOsc2BandHigh}
              title="Oscillator 2 Filter"
            />
          </>
        )}
      </div>

      {/* Env / Glide / Noise / Master Gain */}
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

        {/* Add Master Gain control */}
        <div className="mt-3">
          <div>Master Gain: {masterGain.toFixed(2)}</div>
          <input type="range" min="0" max="2" step="0.01" value={masterGain}
                 onChange={(e) => setMasterGain(parseFloat(e.target.value))} className="w-full" />
        </div>

        <div className="mt-3">
          <label className="block">Duration</label>
          <select value={duration} onChange={(e) => setDuration(e.target.value)} className="p-2 border rounded w-full">
            {durationOptions.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Transport / Actions */}
      <div className="mt-4 flex gap-2">
        <button className="btn btn-play" onClick={playNote}>Play</button>
        {!hideNameAndDescription && (
          <>
            <button className="btn btn-primary btn-save" onClick={handleSavePatch}>Save patch</button>
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