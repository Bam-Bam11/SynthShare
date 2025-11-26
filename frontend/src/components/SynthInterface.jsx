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
  if (!hz || hz <= 0 || isNaN(hz)) return { label: '—', idealHz: null, cents: null };
  const exactMidi = hzToMidi(hz);
  const nearestMidi = Math.round(exactMidi);
  const idealHz = midiToHz(nearestMidi);
  const cents = Math.round(1200 * Math.log(hz / idealHz) / Math.log(2));
  return { label: midiToName(nearestMidi), idealHz, cents };
}

/* =========================
   Input validation helpers
   ========================= */
const clampFrequency = (value) => {
  const num = parseFloat(value);
  if (isNaN(num)) return 440; // Default to A4 for invalid frequency
  return Math.max(10, Math.min(20000, num));
};

const clampDetune = (value) => {
  const num = parseInt(value, 10);
  if (isNaN(num)) return 0; // Default to 0 for invalid detune
  return Math.max(-1200, Math.min(1200, num));
};

// Simple input handlers that allow empty values
const handleFrequencyInput = (value, setter) => {
  if (value === '') {
    setter(''); // Allow empty input
  } else {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setter(num);
    }
    // If NaN, don't update the state (keep current display)
  }
};

const handleDetuneInput = (value, setter) => {
  if (value === '') {
    setter(''); // Allow empty input
  } else {
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      setter(num);
    }
    // If NaN, don't update the state (keep current display)
  }
};

// Get the actual value for audio/saving (treats empty as 0)
const getFrequencyValue = (value) => {
  if (value === '') return 0;
  const num = parseFloat(value);
  return isNaN(num) ? 440 : num; // Default to A4 if completely invalid
};

const getDetuneValue = (value) => {
  if (value === '') return 0;
  const num = parseInt(value, 10);
  return isNaN(num) ? 0 : num;
};

// ... other validation functions remain the same ...
const validateGain = (value, defaultValue = 1, min = 0, max = 2) => {
  const num = parseFloat(value);
  if (isNaN(num) || num < min || num > max) return defaultValue;
  return num;
};

const validateEnvelopeTime = (value, defaultValue = 0.1, min = 0, max = 3) => {
  const num = parseFloat(value);
  if (isNaN(num) || num < min || num > max) return defaultValue;
  return num;
};

const validateSustain = (value, defaultValue = 0.7, min = 0, max = 1) => {
  const num = parseFloat(value);
  if (isNaN(num) || num < min || num > max) return defaultValue;
  return num;
};

const validateResonance = (value, defaultValue = 1, min = 0.5, max = 30) => {
  const num = parseFloat(value);
  if (isNaN(num) || num < min || num > max) return defaultValue;
  return num;
};

const validateCutoff = (value, defaultValue = 1000, min = 50, max = 10000) => {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < min || num > max) return defaultValue;
  return num;
};

const validateBandFrequency = (value, defaultValue = 300, min = 50, max = 10000) => {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < min || num > max) return defaultValue;
  return num;
};

const validateNoiseLevel = (value, defaultValue = 0, min = -60, max = 0) => {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < min || num > max) return defaultValue;
  return num;
};

const validatePortamento = (value, defaultValue = 0, min = 0, max = 1) => {
  const num = parseFloat(value);
  if (isNaN(num) || num < min || num > max) return defaultValue;
  return num;
};

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
  const [masterGain, setMasterGain] = useState(1);

  // Oscillator 1 - now allow empty strings for display
  const [osc1Type, setOsc1Type] = useState('sine');
  const [osc1Detune, setOsc1Detune] = useState(0);
  const [osc1Gain, setOsc1Gain] = useState(1);
  const [osc1Freq, setOsc1Freq] = useState(440);
  const [osc1SlideFrom, setOsc1SlideFrom] = useState(null);

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
  const [osc2Freq, setOsc2Freq] = useState(440);
  const [osc2SlideFrom, setOsc2SlideFrom] = useState(null);

  // Oscillator 2 Filter
  const [osc2FilterType, setOsc2FilterType] = useState('none');
  const [osc2Resonance, setOsc2Resonance] = useState(1);
  const [osc2Cutoff, setOsc2Cutoff] = useState(1000);
  const [osc2BandLow, setOsc2BandLow] = useState(300);
  const [osc2BandHigh, setOsc2BandHigh] = useState(3000);

  // Source patch (when editing/forking)
  const [sourcePatchId, setSourcePatchId] = useState(null);
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
      setMasterGain(params.masterGain ?? 1);

      // Oscillators
      if (Array.isArray(params.oscillators) && params.oscillators.length) {
        const [o1, o2] = params.oscillators;
        if (o1) {
          setOsc1Type(o1.type || 'sine');
          setOsc1Detune(o1.detune || 0);
          setOsc1Gain(o1.gain ?? 1);
          setOsc1Freq(o1.frequency ?? 440);
          setOsc1SlideFrom(o1.slideFrom ?? null);
          
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
          setOsc2Freq(o2.frequency ?? 440);
          setOsc2SlideFrom(o2.slideFrom ?? null);
          
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
    Draw the analyser (unchanged)
    ========================= */
  useEffect(() => {
    if (!analyser || !canvasRef.current) return;
    // ... existing analyser drawing code ...
  }, [analyser]);

  /* =========================
     Build & play the graph
     ========================= */
  const playNote = async () => {
    await Tone.start();
    const now = Tone.now();

    // Use clamped values for audio engine safety (treat empty as 0)
    const clampedOsc1Freq = clampFrequency(getFrequencyValue(osc1Freq));
    const clampedOsc2Freq = clampFrequency(getFrequencyValue(osc2Freq));
    const clampedOsc1Detune = clampDetune(getDetuneValue(osc1Detune));
    const clampedOsc2Detune = clampDetune(getDetuneValue(osc2Detune));
    const clampedOsc1SlideFrom = osc1SlideFrom ? clampFrequency(getFrequencyValue(osc1SlideFrom)) : null;
    const clampedOsc2SlideFrom = osc2SlideFrom ? clampFrequency(getFrequencyValue(osc2SlideFrom)) : null;

    const envelope = new Tone.AmplitudeEnvelope({ attack, decay, sustain, release });
    const analyserNode = analyser || new Tone.Analyser('fft', 128);
    const master = new Tone.Gain(masterGain);
    envelope.connect(master);
    master.connect(analyserNode);
    analyserNode.toDestination();

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
      const startHz = (portamento > 0 && slideFromHz != null && slideFromHz !== target) 
        ? slideFromHz 
        : target;

      const osc = new Tone.Oscillator({ type, frequency: startHz, detune: detuneCents });
      const g = new Tone.Gain(gain);
      osc.connect(g);
      
      const filter = createFilter(filterType, filterResonance, filterCutoff, filterBandLow, filterBandHigh);
      if (filter) {
        g.connect(filter);
        filter.connect(envelope);
      } else {
        g.connect(envelope);
      }

      if (portamento > 0 && startHz !== target) {
        osc.frequency.linearRampToValueAtTime(target, now + portamento);
      }
      
      return { osc, gain: g, filter };
    };

    // Oscillator 1 with clamped values
    const osc1 = buildOsc({
      type: osc1Type,
      gain: osc1Gain,
      detuneCents: clampedOsc1Detune,
      freqHz: clampedOsc1Freq,
      slideFromHz: clampedOsc1SlideFrom,
      filterType: osc1FilterType,
      filterResonance: osc1Resonance,
      filterCutoff: osc1Cutoff,
      filterBandLow: osc1BandLow,
      filterBandHigh: osc1BandHigh
    });

    // Oscillator 2 with clamped values
    const osc2 = osc2Enabled
      ? buildOsc({
          type: osc2Type,
          gain: osc2Gain,
          detuneCents: clampedOsc2Detune,
          freqHz: clampedOsc2Freq,
          slideFromHz: clampedOsc2SlideFrom,
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
      master.dispose();
    }, Tone.Time(duration).toMilliseconds() + 50);
  };

  /* =========================
     Save / Post / Download
     ========================= */
  const handleSavePatch = async () => {
    const token = localStorage.getItem('access_token');
    const name = (patchName || '').trim() || 'Untitled Patch';
    const desc = (description || '').trim().slice(0, 500);

    // Use clamped values for saving (treat empty as 0)
    const clampedOsc1Freq = clampFrequency(getFrequencyValue(osc1Freq));
    const clampedOsc2Freq = clampFrequency(getFrequencyValue(osc2Freq));
    const clampedOsc1Detune = clampDetune(getDetuneValue(osc1Detune));
    const clampedOsc2Detune = clampDetune(getDetuneValue(osc2Detune));
    const clampedOsc1SlideFrom = osc1SlideFrom ? clampFrequency(getFrequencyValue(osc1SlideFrom)) : null;
    const clampedOsc2SlideFrom = osc2SlideFrom ? clampFrequency(getFrequencyValue(osc2SlideFrom)) : null;

    const parameters = {
      oscillators: [
        {
          type: osc1Type,
          gain: osc1Gain,
          detune: clampedOsc1Detune,
          frequency: clampedOsc1Freq,
          slideFrom: clampedOsc1SlideFrom,
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
          detune: clampedOsc2Detune,
          frequency: clampedOsc2Freq,
          slideFrom: clampedOsc2SlideFrom,
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
      masterGain
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
    } catch (err) {
      console.error('Failed to save patch:', err);
      alert(`Failed to save patch: ${err.response?.data?.detail || err.message}`);
    }
  };
  
  const handleDownloadPatch = () => {
    const name = (patchName || 'untitled').trim();
    
    // Use clamped values for download (treat empty as 0)
    const clampedOsc1Freq = clampFrequency(getFrequencyValue(osc1Freq));
    const clampedOsc2Freq = clampFrequency(getFrequencyValue(osc2Freq));
    const clampedOsc1Detune = clampDetune(getDetuneValue(osc1Detune));
    const clampedOsc2Detune = clampDetune(getDetuneValue(osc2Detune));
    const clampedOsc1SlideFrom = osc1SlideFrom ? clampFrequency(getFrequencyValue(osc1SlideFrom)) : null;
    const clampedOsc2SlideFrom = osc2SlideFrom ? clampFrequency(getFrequencyValue(osc2SlideFrom)) : null;

    const parameters = {
      oscillators: [
        {
          type: osc1Type,
          gain: osc1Gain,
          detune: clampedOsc1Detune,
          frequency: clampedOsc1Freq,
          slideFrom: clampedOsc1SlideFrom,
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
          detune: clampedOsc2Detune,
          frequency: clampedOsc2Freq,
          slideFrom: clampedOsc2SlideFrom,
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
      masterGain
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
    // Use clamped values for parent notification (treat empty as 0)
    const clampedOsc1Freq = clampFrequency(getFrequencyValue(osc1Freq));
    const clampedOsc2Freq = clampFrequency(getFrequencyValue(osc2Freq));
    const clampedOsc1Detune = clampDetune(getDetuneValue(osc1Detune));
    const clampedOsc2Detune = clampDetune(getDetuneValue(osc2Detune));
    const clampedOsc1SlideFrom = osc1SlideFrom ? clampFrequency(getFrequencyValue(osc1SlideFrom)) : null;
    const clampedOsc2SlideFrom = osc2SlideFrom ? clampFrequency(getFrequencyValue(osc2SlideFrom)) : null;

    const current = {
      oscillators: [
        { 
          type: osc1Type, 
          gain: osc1Gain, 
          detune: clampedOsc1Detune, 
          frequency: clampedOsc1Freq, 
          slideFrom: clampedOsc1SlideFrom,
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
          detune: clampedOsc2Detune, 
          frequency: clampedOsc2Freq, 
          slideFrom: clampedOsc2SlideFrom,
          filter: {
            type: osc2FilterType,
            resonance: osc2Resonance,
            ...(osc2FilterType === 'lowpass' || osc2FilterType === 'highpass' ? { cutoff: osc2Cutoff } : {}),
            ...(osc2FilterType === 'bandpass' ? { bandLow: osc2BandLow, bandHigh: osc2BandHigh } : {})
          }
        }] : [])
      ],
      portamento, noiseLevel, duration, masterGain,
      envelope: { attack, decay, sustain, release }
    };
    onParamsChange(current);
  }, [
    osc1Type, osc1Detune, osc1Gain, osc1Freq, osc1SlideFrom,
    osc2Enabled, osc2Type, osc2Gain, osc2Detune, osc2Freq, osc2SlideFrom,
    attack, decay, sustain, release,
    osc1FilterType, osc1Resonance, osc1Cutoff, osc1BandLow, osc1BandHigh,
    osc2FilterType, osc2Resonance, osc2Cutoff, osc2BandLow, osc2BandHigh,
    portamento, noiseLevel, duration, masterGain,
    onParamsChange
  ]);

  /* =========================
     UI helpers
     ========================= */
  const HzHelper = ({ valueHz }) => {
    const actualValue = getFrequencyValue(valueHz);
    if (actualValue <= 0 || isNaN(actualValue)) {
      return <div className="text-sm text-gray-600 mt-1">Enter a frequency to see the nearest musical note</div>;
    }
    
    const d = describeHz(actualValue);
    return (
      <div className="text-sm text-gray-600 mt-1">
        ≈ {d.label} ({d.idealHz?.toFixed(2)} Hz) • {d.cents > 0 ? '+' : ''}{d.cents ?? 0} cents
      </div>
    );
  };

  const FrequencyWarning = ({ value, type = "frequency" }) => {
    const actualValue = type === "frequency" ? getFrequencyValue(value) : getDetuneValue(value);
    
    if (type === "frequency") {
      if (actualValue < 10) {
        return <div className="text-sm text-amber-600 mt-1">Frequency below 10 Hz will be changed to 10 Hz when playing or saving</div>;
      }
      if (actualValue > 20000) {
        return <div className="text-sm text-amber-600 mt-1">Frequency above 20000 Hz will be changed to 20000 Hz when playing or saving</div>;
      }
    } else if (type === "detune") {
      if (actualValue < -1200) {
        return <div className="text-sm text-amber-600 mt-1">Detune below -1200 cents will be changed to -1200 cents when playing or saving</div>;
      }
      if (actualValue > 1200) {
        return <div className="text-sm text-amber-600 mt-1">Detune above 1200 cents will be changed to 1200 cents when playing or saving</div>;
      }
    }
    return null;
  };

  const SnapButtons = ({ onSnap }) => (
    <div className="flex gap-2 mt-2">
      <button className="px-2 py-1 border rounded" onClick={() => onSnap(midiToHz(69))}>A4</button>
      <button className="px-2 py-1 border rounded" onClick={() => onSnap(midiToHz(60))}>C4</button>
      <button className="px-2 py-1 border rounded" onClick={() => onSnap(midiToHz(64))}>E4</button>
      <button className="px-2 py-1 border rounded" onClick={() => onSnap(midiToHz(67))}>G4</button>
    </div>
  );

  // Filter UI component
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
            onChange={(e) => setResonance(validateResonance(e.target.value, resonance))}
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
                onChange={(e) => setCutoff(validateCutoff(e.target.value, cutoff))}
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
                  onChange={(e) => setBandLow(validateBandFrequency(e.target.value, bandLow))}
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
                  onChange={(e) => setBandHigh(validateBandFrequency(e.target.value, bandHigh))}
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
               onChange={(e) => setOsc1Gain(validateGain(e.target.value, osc1Gain))} className="w-full" />
        <div className="mb-3">{osc1Gain.toFixed(2)}</div>

        <label className="block">Detune (cents)</label>
        <input 
          type="number" 
          step="1" 
          value={osc1Detune}
          onChange={(e) => handleDetuneInput(e.target.value, setOsc1Detune)}
          className="p-2 border rounded w-full mb-3" 
        />
        <FrequencyWarning value={osc1Detune} type="detune" />

        <label className="block">Frequency (Hz)</label>
        <input
          type="number"
          step="0.1"
          value={osc1Freq}
          onChange={(e) => handleFrequencyInput(e.target.value, setOsc1Freq)}
          className="p-2 border rounded w-full"
        />
        <FrequencyWarning value={osc1Freq} type="frequency" />
        {getFrequencyValue(osc1Freq) >= 10 && getFrequencyValue(osc1Freq) <= 20000 && <HzHelper valueHz={getFrequencyValue(osc1Freq)} />}
        <SnapButtons onSnap={(hz) => setOsc1Freq(hz)} />

        <label className="block mt-3">Glide from (Hz) - sets starting frequency for glide</label>
        <input
          type="number"
          placeholder="same as target (no glide)"
          value={osc1SlideFrom ?? ''}
          onChange={(e) => {
            const value = e.target.value;
            if (value === '') {
              setOsc1SlideFrom(null);
            } else {
              handleFrequencyInput(value, setOsc1SlideFrom);
            }
          }}
          className="p-2 border rounded w-full"
        />
        {osc1SlideFrom && <FrequencyWarning value={osc1SlideFrom} type="frequency" />}

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
                   onChange={(e) => setOsc2Gain(validateGain(e.target.value, osc2Gain))} className="w-full" />
            <div className="mb-3">{osc2Gain.toFixed(2)}</div>

            <label className="block">Detune (cents)</label>
            <input 
              type="number" 
              step="1" 
              value={osc2Detune}
              onChange={(e) => handleDetuneInput(e.target.value, setOsc2Detune)}
              className="p-2 border rounded w-full mb-3" 
            />
            <FrequencyWarning value={osc2Detune} type="detune" />

            <label className="block">Frequency (Hz)</label>
            <input
              type="number"
              step="0.1"
              value={osc2Freq}
              onChange={(e) => handleFrequencyInput(e.target.value, setOsc2Freq)}
              className="p-2 border rounded w-full"
            />
            <FrequencyWarning value={osc2Freq} type="frequency" />
            {getFrequencyValue(osc2Freq) >= 10 && getFrequencyValue(osc2Freq) <= 20000 && <HzHelper valueHz={getFrequencyValue(osc2Freq)} />}
            <SnapButtons onSnap={(hz) => setOsc2Freq(hz)} />

            <label className="block mt-3">Glide from (Hz) - sets starting frequency for glide</label>
            <input
              type="number"
              placeholder="same as target (no glide)"
              value={osc2SlideFrom ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '') {
                  setOsc2SlideFrom(null);
                } else {
                  handleFrequencyInput(value, setOsc2SlideFrom);
                }
              }}
              className="p-2 border rounded w-full"
            />
            {osc2SlideFrom && <FrequencyWarning value={osc2SlideFrom} type="frequency" />}

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
               onChange={(e) => setAttack(validateEnvelopeTime(e.target.value, attack))} className="w-full" />

        <div className="mb-2">Decay: {decay.toFixed(2)} s</div>
        <input type="range" min="0" max="2" step="0.01" value={decay}
               onChange={(e) => setDecay(validateEnvelopeTime(e.target.value, decay))} className="w-full" />

        <div className="mb-2">Sustain: {Math.round(sustain * 100)}%</div>
        <input type="range" min="0" max="1" step="0.01" value={sustain}
               onChange={(e) => setSustain(validateSustain(e.target.value, sustain))} className="w-full" />

        <div className="mb-2">Release: {release.toFixed(2)} s</div>
        <input type="range" min="0" max="3" step="0.01" value={release}
               onChange={(e) => setRelease(validateEnvelopeTime(e.target.value, release))} className="w-full" />

        <div className="mt-3">Portamento (Glide): {portamento.toFixed(2)} s</div>
        <input type="range" min="0" max="1" step="0.01" value={portamento}
               onChange={(e) => setPortamento(validatePortamento(e.target.value, portamento))} className="w-full" />

        <div className="mt-3">Noise Level (dB): {noiseLevel}</div>
        <input type="range" min="-60" max="0" step="1" value={noiseLevel}
               onChange={(e) => setNoiseLevel(validateNoiseLevel(e.target.value, noiseLevel))} className="w-full" />

        <div className="mt-3">
          <div>Master Gain: {masterGain.toFixed(2)}</div>
          <input type="range" min="0" max="2" step="0.01" value={masterGain}
                 onChange={(e) => setMasterGain(validateGain(e.target.value, masterGain))} className="w-full" />
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