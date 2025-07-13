import { createContext, useContext, useState, useEffect } from 'react';

// Create the context
export const ChannelRackContext = createContext();

// Provider component
export const ChannelRackProvider = ({ children }) => {
    const [channels, setChannels] = useState([]);
    const [tempo, setTempo] = useState(120); // Default BPM
    const [isVisible, setIsVisible] = useState(true); // Default visible
    const [loaded, setLoaded] = useState(false); // Prevent premature localStorage writes

    // Load saved state from localStorage when mounted
    useEffect(() => {
        try {
            const savedChannelsRaw = localStorage.getItem('channelRackChannels');
            const savedTempoRaw = localStorage.getItem('channelRackTempo');
            const savedVisibleRaw = localStorage.getItem('channelRackVisible');

            console.log('[Load] Channels:', savedChannelsRaw);
            console.log('[Load] Tempo:', savedTempoRaw);
            console.log('[Load] Visible:', savedVisibleRaw);

            if (savedChannelsRaw) {
                setChannels(JSON.parse(savedChannelsRaw));
            }

            if (savedTempoRaw) {
                const parsedTempo = parseInt(savedTempoRaw);
                if (!isNaN(parsedTempo)) setTempo(parsedTempo);
            }

            if (savedVisibleRaw) {
                setIsVisible(savedVisibleRaw === 'true');
            }

            setLoaded(true); // mark load complete
        } catch (err) {
            console.error('Failed to load channel rack state from localStorage:', err);
        }
    }, []);

    // Save to localStorage when state changes (after load)
    useEffect(() => {
        if (loaded) {
            console.log('[Save] Channels:', channels);
            localStorage.setItem('channelRackChannels', JSON.stringify(channels));
            localStorage.setItem('channelRackTempo', tempo.toString());
        }
    }, [channels, tempo, loaded]);

    // Save visibility to localStorage when it changes (after load)
    useEffect(() => {
        if (loaded) {
            console.log('[Save] Visible:', isVisible);
            localStorage.setItem('channelRackVisible', isVisible.toString());
        }
    }, [isVisible, loaded]);

    // Toggle visibility
    const toggleVisibility = () => {
        setIsVisible(prev => !prev);
    };

    // Add a new channel with default values
    const addChannel = () => {
        const newChannel = {
            id: Date.now(),
            name: `Channel ${Date.now()}`,
            steps: Array(16).fill(false),
            patch: null,
        };
        setChannels(prev => [...prev, newChannel]);
    };

    // Remove a channel by ID
    const removeChannel = (id) => {
        setChannels(prev => prev.filter(ch => ch.id !== id));
    };

    // Toggle a specific step for a specific channel
    const toggleStep = (channelId, stepIndex) => {
        setChannels(prev =>
            prev.map(ch =>
                ch.id === channelId
                    ? {
                        ...ch,
                        steps: ch.steps.map((s, i) =>
                            i === stepIndex ? !s : s
                        )
                    }
                    : ch
            )
        );
    };

    const assignPatchToChannel = (channelId, patch) => {
        const safePatch = JSON.parse(JSON.stringify(patch)); // Deep clone

        const userLabel = prompt('Name this patch for your channel:', patch.name || 'New Patch');
        if (userLabel) {
            safePatch.displayName = userLabel.slice(0, 30); // Optional limit
        }

        setChannels(prev =>
            prev.map(ch =>
                ch.id === channelId ? { ...ch, patch: safePatch } : ch
            )
        );
    };


    const assignPatchToFirstEmptyChannel = (patch) => {
        const emptyChannel = channels.find(ch => ch.patch === null);
        if (emptyChannel) {
            assignPatchToChannel(emptyChannel.id, patch);
            alert(`Assigned "${patch.name}" to ${emptyChannel.name}`);
        } else {
            alert('No empty channels available.');
        }
    };

    const updateChannelLabel = (channelId, newLabel) => {
        setChannels(prev =>
            prev.map(ch =>
                ch.id === channelId && ch.patch
                    ? {
                        ...ch,
                        patch: {
                            ...ch.patch,
                            displayName: newLabel
                        }
                    }
                    : ch
            )
        );
    };


    return (
        <ChannelRackContext.Provider
            value={{
                channels,
                tempo,
                setTempo,
                addChannel,
                removeChannel,
                toggleStep,
                isVisible,
                toggleVisibility,
                assignPatchToChannel,
                assignPatchToFirstEmptyChannel,
                updateChannelLabel,
            }}
        >
            {children}
        </ChannelRackContext.Provider>
    );
};

// Custom hook for easier access
export const useChannelRack = () => useContext(ChannelRackContext);
