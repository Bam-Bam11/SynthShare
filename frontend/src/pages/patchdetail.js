import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as Tone from 'tone';
import API from '../api';

const PatchDetail = () => {
    const { id } = useParams();
    const [patch, setPatch] = useState(null);

    useEffect(() => {
        const fetchPatch = async () => {
            try {
                const res = await API.get(`/patches/${id}/`);
                setPatch(res.data);
            } catch (err) {
                console.error('Failed to load patch:', err);
            }
        };

        fetchPatch();
    }, [id]);

    const playPatch = async () => {
        if (!patch) return;

        await Tone.start();

        const note = patch.parameters.note || 'C4';
        const duration = patch.parameters.duration || '8n';

        const synth = new Tone.Synth({
            oscillator: { type: patch.parameters.oscillator || 'sine' },
            envelope: patch.parameters.envelope || {}
        }).toDestination();

        synth.triggerAttackRelease(note, duration);
    };

    if (!patch) return <p>Loading patch details...</p>;

    return (
        <div style={{ padding: '20px' }}>
            <h2>{patch.name}</h2>
            <p><strong>Description:</strong> {patch.description || 'No description provided.'}</p>
            <p><strong>Uploaded by:</strong> {patch.uploaded_by}</p>
            <p><strong>Created at:</strong> {new Date(patch.created_at).toLocaleString()}</p>
            <p><strong>Downloads:</strong> {patch.downloads}</p>
            <p><strong>Forks:</strong> {patch.forks}</p>

            <h3>Parameters:</h3>
            <pre style={{ background: '#f0f0f0', padding: '10px', borderRadius: '5px' }}>
                {JSON.stringify(patch.parameters, null, 2)}
            </pre>

            <button onClick={playPatch}>Play Patch</button>
        </div>
    );
};

export default PatchDetail;
