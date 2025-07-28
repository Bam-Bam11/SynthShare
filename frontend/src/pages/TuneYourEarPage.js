import React, { useEffect, useState } from 'react';
import API from '../api';
import PlayPatch from '../components/PlayPatch';
import SynthInterface from '../components/SynthInterface'; 
import { calculateSimilarityScore, getSimilarityBreakdown } from '../utils/similarity'; 

const TuneYourEarPage = () => {
    const [targetPatch, setTargetPatch] = useState(null);
    const [currentParams, setCurrentParams] = useState({});
    const [score, setScore] = useState(null);

    const loadRandomPatch = async () => {
        try {
            const res = await API.get('/patches/random/');
            setTargetPatch(res.data);
            setScore(null); // Reset score on load
        } catch (err) {
            console.error('Failed to load random patch:', err);
        }
    };

const handleSubmit = () => {
    if (!targetPatch) return;

    console.log('Current Params:', currentParams);
    console.log('Target Params:', targetPatch.parameters);

    const breakdown = getSimilarityBreakdown(currentParams, targetPatch.parameters);
    console.log('Per-parameter similarity:', breakdown);

    const simScore = calculateSimilarityScore(currentParams, targetPatch.parameters);
    setScore(simScore);
};

    return (
        <div style={{ padding: '20px' }}>
            <h2>Tune Your Ear</h2>

            <button onClick={loadRandomPatch}>Load Random Synth</button>
            {' '}
            <button onClick={() => targetPatch && PlayPatch(targetPatch)}>Play Target</button>
            {' '}
            <button onClick={handleSubmit}>Submit</button>

            {score !== null && (
                <p><strong>Similarity Score:</strong> {score.toFixed(1)} / 100</p>
            )}

            <hr />

            <SynthInterface
                onParamsChange={setCurrentParams}
                initialParams={null}
                hideNameAndDescription={true}
            />
        </div>
    );
};

export default TuneYourEarPage;


