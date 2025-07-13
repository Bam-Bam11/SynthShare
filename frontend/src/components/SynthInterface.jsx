import React, { useState, useEffect, useRef } from 'react';
import * as Tone from 'tone';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

//remember to import save from utils

const noteOptions = [
    'C2', 'D2', 'E2', 'F2', 'G2', 'A2', 'B2',
    'C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3',
    'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4',
    'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5'
];

const durationOptions = ['1n', '2n', '4n', '8n', '16n', '32n'];

const SynthInterface = () => {
    const canvasRef = useRef(null);
    const navigate = useNavigate();

    // Tone.js & Synth State
    const [synth, setSynth] = useState(null);
    const [noise, setNoise] = useState(null);
    const [analyser, setAnalyser] = useState(null);

    // User Input / Patch Parameters
    const [patchName, setPatchName] = useState('');
    const [description, setDescription] = useState('');
    const [oscType, setOscType] = useState('sine');
    const [attack, setAttack] = useState(0.1);
    const [decay, setDecay] = useState(0.2);
    const [sustain, setSustain] = useState(0.7);
    const [release, setRelease] = useState(0.5);
    const [detune, setDetune] = useState(0);
    const [resonance, setResonance] = useState(1);
    const [filterType, setFilterType] = useState('none');
    const [cutoff, setCutoff] = useState(1000);
    const [bandLow, setBandLow] = useState(300);
    const [bandHigh, setBandHigh] = useState(3000);
    const [portamento, setPortamento] = useState(0);
    const [noiseLevel, setNoiseLevel] = useState(0);
    const [note, setNote] = useState('C4');
    const [duration, setDuration] = useState('8n');

    // Patch Save State
    const [savedPatch, setSavedPatch] = useState(null);
    const [action, setAction] = useState(null);
    const [stemId, setStemId] = useState(null);
    const [rootId, setRootId] = useState(null);
    const [immediatePredecessorId, setImmediatePredecessorId] = useState(null);

    useEffect(() => {
    const patchToLoad = localStorage.getItem('patchToLoad');
    //console.log('patchToLoad full object:', patch);
    if (patchToLoad) {
        try {
            const patch = JSON.parse(patchToLoad);
            console.log('Loaded parameters:', patch.parameters);

            const params = patch.parameters || {};

            // Top-level
            setPatchName(patch.name || '');
            setDescription(patch.description || '');
            setOscType(params.oscillator || 'sine');
            setDetune(params.detune ?? 0);
            setPortamento(params.portamento ?? 0);
            setNoiseLevel(params.noiseLevel ?? 0);
            setNote(patch.note || 'C4');
            setDuration(patch.duration || '8n');
            setAction(patch.action || null);
            setStemId(patch.stem || patch.id || null);
            setRootId(patch.root || patch.id || null);
            setImmediatePredecessorId(patch.id || null);


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

            localStorage.removeItem('patchToLoad');
        } catch (err) {
            console.error('Failed to load patch from storage:', err);
        }
    }
}, []);

    useEffect(() => {
        let filter = null;

        if (filterType !== 'none') {
            if (filterType === 'lowpass' || filterType === 'highpass') {
                filter = new Tone.Filter({
                    type: filterType,
                    frequency: cutoff,
                    Q: resonance,
                });
            } else if (filterType === 'bandpass') {
                const centerFreq = (bandLow + bandHigh) / 2;
                const bandwidth = bandHigh - bandLow;
                filter = new Tone.Filter({
                    type: 'bandpass',
                    frequency: centerFreq,
                    Q: centerFreq / bandwidth,
                });
            }
        }

        const analyser = new Tone.Analyser('fft', 128);

        const newSynth = new Tone.Synth({
            oscillator: { type: oscType, detune: detune },
            envelope: { attack, decay, sustain, release },
            portamento: portamento,
        });

        const newNoise = new Tone.Noise({ type: 'white' });
        newNoise.volume.value = noiseLevel;

        if (filter) {
            newSynth.connect(filter);
            newNoise.connect(filter);
            filter.connect(analyser);
        } else {
            newSynth.connect(analyser);
            newNoise.connect(analyser);
        }

        analyser.toDestination();

        setSynth(newSynth);
        setNoise(newNoise);
        setAnalyser(analyser);

        return () => {
            newSynth.dispose();
            newNoise.dispose();
            analyser.dispose();
            if (filter) filter.dispose();
        };
    }, [
        oscType, attack, decay, sustain, release, detune,
        resonance, filterType, cutoff, bandLow, bandHigh,
        portamento, noiseLevel
    ]);

    useEffect(() => {
        if (!analyser || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const canvasCtx = canvas.getContext('2d');
        let animationId;

        const draw = () => {
            const buffer = analyser.getValue();
            canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
            canvasCtx.beginPath();

            const sliceWidth = canvas.width / buffer.length;
            buffer.forEach((val, i) => {
                const x = i * sliceWidth;
                const y = (1 - (val + 140) / 140) * canvas.height;
                if (i === 0) {
                    canvasCtx.moveTo(x, y);
                } else {
                    canvasCtx.lineTo(x, y);
                }
            });

            canvasCtx.strokeStyle = 'blue';
            canvasCtx.lineWidth = 2;
            canvasCtx.stroke();

            animationId = requestAnimationFrame(draw);
        };

        draw();

        return () => cancelAnimationFrame(animationId);
    }, [analyser]);

    const playNote = () => {
        Tone.start();
        synth.triggerAttackRelease(note, duration);

        if (noiseLevel > -60) {
            noise.start();
            setTimeout(() => noise.stop(), Tone.Time(duration).toMilliseconds());
        }
    };

 const handleSavePatch = async () => {
    const token = localStorage.getItem('access_token');
    const name = patchName.trim() || 'Untitled Patch';
    const desc = description.trim().slice(0, 500);  // Max 500 chars

    const patch = {
        patchName,
        description,
        oscillator: oscType,
        detune,
        envelope: { attack, decay, sustain, release },
        filter: {
            type: filterType,
            resonance,
            ...(filterType === 'lowpass' || filterType === 'highpass' ? { cutoff } : {}),
            ...(filterType === 'bandpass' ? { bandLow, bandHigh } : {}),
        },
        portamento,
        noiseLevel,
        note,
        duration,
    };

    const payload = {
        name,
        description: desc,
        parameters: patch,
        synth_type: 'basic',
        note,
        duration,
        is_posted: false,
        ...(stemId && { stem: stemId }),
        ...(rootId && { root: rootId }),
        ...(immediatePredecessorId && { immediate_predecessor: immediatePredecessorId }),
    
    };
    console.log('Payload being sent to backend:', payload);


    try {
        const res = await axios.post('http://localhost:8000/api/patches/', payload, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        setSavedPatch({ ...patch, backendId: res.data.id }); // store ID for later post
        alert('Patch saved successfully!');
        console.log('Saved patch response:', res.data);
    } catch (err) {
        console.error('Error saving patch:', err);
        alert('Failed to save patch.');
    }
};


const handlePostPatch = async () => {
    if (!savedPatch?.backendId) {
        alert('Please save the patch first.');
        return;
    }

    const token = localStorage.getItem('access_token');

    try {
        const response = await axios.post(
            `http://localhost:8000/api/patches/${savedPatch.backendId}/post/`,
            {},
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        alert('Patch has been posted and is now public!');
        console.log('Post patch response:', response.data);
    } catch (error) {
        console.error('Error posting patch:', error);
        alert('Error posting patch');
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

            <div>Detune: {detune} cents</div>
            <input type="range" min="-1200" max="1200" step="1" value={detune} onChange={(e) => setDetune(parseInt(e.target.value))} />

            <div>Filter Type:</div>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
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
            />

                    {(filterType === 'lowpass' || filterType === 'highpass') && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: '10px', maxWidth: '300px' }}>
                <label style={{ marginBottom: '4px' }}>Cutoff Frequency: {cutoff} Hz</label>
                <input
                    type="range"
                    min="50"
                    max="10000"
                    step="10"
                    value={cutoff}
                    onChange={(e) => setCutoff(parseInt(e.target.value))}
                    style={{ width: '100%' }}
                />
            </div>
        )}

        {filterType === 'bandpass' && (
            <>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: '10px', maxWidth: '300px' }}>
                    <label style={{ marginBottom: '4px' }}>Band Low: {bandLow} Hz</label>
                    <input
                        type="range"
                        min="50"
                        max={bandHigh - 10}
                        step="10"
                        value={bandLow}
                        onChange={(e) => setBandLow(parseInt(e.target.value))}
                        style={{ width: '100%' }}
                    />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: '10px', maxWidth: '300px' }}>
                    <label style={{ marginBottom: '4px' }}>Band High: {bandHigh} Hz</label>
                    <input
                        type="range"
                        min={bandLow + 10}
                        max="10000"
                        step="10"
                        value={bandHigh}
                        onChange={(e) => setBandHigh(parseInt(e.target.value))}
                        style={{ width: '100%' }}
                    />
                </div>
            </>
        )}


             <div>Portamento (Glide): {portamento}</div>
            <input type="range" min="0" max="1" step="0.01" value={portamento} onChange={(e) => setPortamento(parseFloat(e.target.value))} />

            <div>Noise Level (dB): {noiseLevel}</div>
            <input type="range" min="-60" max="0" step="1" value={noiseLevel} onChange={(e) => setNoiseLevel(parseInt(e.target.value))} />

            <div></div>

            <div className="mt-4">
                <label>Note (key):</label>
                <select
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="p-2 border rounded w-full"
                >
                    {noteOptions.map((n) => (
                        <option key={n} value={n}>{n}</option>
                    ))}
                </select>
            </div>

            <div className="mt-4">
                <label>Duration:</label>
                <select
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="p-2 border rounded w-full"
                >
                    {durationOptions.map((d) => (
                        <option key={d} value={d}>{d}</option>
                    ))}
                </select>
            </div>

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

            <div className="mt-4">
                <h3>Frequency Visualisation:</h3>
                <canvas
                    ref={canvasRef}
                    width={300}
                    height={100}
                    style={{ border: '1px solid black' }}
                />
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
