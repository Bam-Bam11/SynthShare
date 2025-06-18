import React, { useState, useEffect } from 'react';
import * as Tone from 'tone';
import axios from 'axios';

const SynthInterface = () => {
  const [patchName, setPatchName] = useState('');
  const [oscType, setOscType] = useState('sine');
  const [attack, setAttack] = useState(0.1);
  const [decay, setDecay] = useState(0.2);
  const [sustain, setSustain] = useState(0.7);
  const [release, setRelease] = useState(0.5);
  const [synth, setSynth] = useState(null);
  const [savedPatch, setSavedPatch] = useState(null);

  useEffect(() => {
    const newSynth = new Tone.Synth({
      oscillator: { type: oscType },
      envelope: { attack, decay, sustain, release },
    }).toDestination();

    setSynth(newSynth);

    return () => newSynth.dispose();
  }, [oscType, attack, decay, sustain, release]);

  const playNote = () => {
    Tone.start();
    synth.triggerAttackRelease('C4', '8n');
  };

  const handleSavePatch = () => {
    const patch = {
      oscillator: oscType,
      envelope: {
        attack,
        decay,
        sustain,
        release,
      },
    };
    setSavedPatch(patch);
    console.log('Saved patch:', patch);
  };

  const handlePostPatch = async () => {
    if (!savedPatch) {
      alert('Please save the patch first.');
      return;
    }

    const token = localStorage.getItem('access_token');
    const name = patchName.trim() || 'Untitled Patch';

    const payload = {
      name,
      parameters: savedPatch,
      synth_type: 'basic',
    };

    try {
      const response = await axios.post('http://localhost:8000/api/patches/', payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      alert('Patch successfully saved to backend!');
      console.log('Backend response:', response.data);
    } catch (error) {
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Status:', error.response.status);
        console.error('Headers:', error.response.headers);
        alert('Failed to save patch:\n' + JSON.stringify(error.response.data, null, 2));
      } else if (error.request) {
        console.error('No response received:', error.request);
        alert('No response from backend.');
      } else {
        console.error('Error setting up request:', error.message);
        alert('Error: ' + error.message);
      }
    }
  };

  const handleDownloadPatch = () => {
    if (!savedPatch) {
      alert('Please save the patch first.');
      return;
    }

    const name = patchName.trim() || 'untitled';
    const filename = `${name}spatch.json`;

    const blob = new Blob([JSON.stringify(savedPatch, null, 2)], {
      type: 'application/json',
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 max-w-md mx-auto rounded-xl shadow-lg bg-white">
      <h2 className="text-xl font-bold mb-4">Synth Interface</h2>

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

      <label className="block mb-2">Oscillator Type:</label>
      <select
        value={oscType}
        onChange={(e) => setOscType(e.target.value)}
        className="mb-4 p-2 border rounded w-full"
      >
        <option value="sine">Sine</option>
        <option value="square">Square</option>
        <option value="triangle">Triangle</option>
        <option value="sawtooth">Sawtooth</option>
      </select>

      <div className="mb-2">Attack: {attack.toFixed(2)} s</div>
      <input type="range" min="0" max="2" step="0.01" value={attack} onChange={(e) => setAttack(parseFloat(e.target.value))} />

      <div className="mb-2">Decay: {decay.toFixed(2)} s</div>
      <input type="range" min="0" max="2" step="0.01" value={decay} onChange={(e) => setDecay(parseFloat(e.target.value))} />

      <div className="mb-2">Sustain: {Math.round(sustain * 100)}%</div>
      <input type="range" min="0" max="1" step="0.01" value={sustain} onChange={(e) => setSustain(parseFloat(e.target.value))} />

      <div className="mb-2">Release: {release.toFixed(2)} s</div>
      <input type="range" min="0" max="3" step="0.01" value={release} onChange={(e) => setRelease(parseFloat(e.target.value))} />

      <button
        onClick={playNote}
        className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Play Note
      </button>

      <div className="mt-4 space-y-2">
        <button
          onClick={handleSavePatch}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          Save Patch
        </button>

        <button
          onClick={handlePostPatch}
          className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
        >
          Post Patch
        </button>

        <button
          onClick={handleDownloadPatch}
          className="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600"
        >
          Download Patch
        </button>
      </div>

      {savedPatch && (
        <pre className="mt-4 text-sm bg-gray-100 p-2 rounded">
          {JSON.stringify(savedPatch, null, 2)}
        </pre>
      )}
    </div>
  );
};

export default SynthInterface;
