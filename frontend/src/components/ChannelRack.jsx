import React, { useState, useEffect } from 'react';

const ChannelRack = ({ visible, onClose }) => {
    const [channels, setChannels] = useState([]);
    const [tempo, setTempo] = useState(120);

    // Load saved state from localStorage when component mounts
    useEffect(() => {
        const savedChannels = JSON.parse(localStorage.getItem('channelRackChannels')) || [];
        const savedTempo = parseInt(localStorage.getItem('channelRackTempo')) || 120;
        setChannels(savedChannels);
        setTempo(savedTempo);
    }, []);

    // Save state to localStorage when channels or tempo change
    useEffect(() => {
        localStorage.setItem('channelRackChannels', JSON.stringify(channels));
        localStorage.setItem('channelRackTempo', tempo.toString());
    }, [channels, tempo]);

    const addChannel = () => {
        const newChannel = { id: Date.now(), patchId: null }; // Later you could add patch selection
        setChannels([...channels, newChannel]);
    };

    const removeChannel = (id) => {
        setChannels(channels.filter(channel => channel.id !== id));
    };

    if (!visible) return null;

    return (
        <div style={{
            position: 'fixed',
            top: '20%',
            right: '20px',
            width: '300px',
            background: 'white',
            border: '1px solid black',
            padding: '10px',
            boxShadow: '0 0 10px rgba(0,0,0,0.5)',
            zIndex: 1000
        }}>
            <h3>Channel Rack</h3>

            <div style={{ marginBottom: '10px' }}>
                <label>Tempo: {tempo} BPM</label>
                <input
                    type="range"
                    min="60"
                    max="200"
                    value={tempo}
                    onChange={(e) => setTempo(parseInt(e.target.value))}
                    style={{ width: '100%' }}
                />
            </div>

            <ul>
                {channels.map(channel => (
                    <li key={channel.id} style={{ marginBottom: '5px' }}>
                        Channel {channel.id}
                        <button
                            onClick={() => removeChannel(channel.id)}
                            style={{ marginLeft: '10px' }}
                        >
                            Remove
                        </button>
                    </li>
                ))}
            </ul>

            <button onClick={addChannel}>Add Channel</button>
            <button onClick={onClose} style={{ marginLeft: '10px' }}>Close</button>
        </div>
    );
};

export default ChannelRack;
