import { createContext, useContext, useState, useEffect } from 'react';

// Create the context
export const ChannelRackContext = createContext();

// Provider component
export const ChannelRackProvider = ({ userId, children }) => {
    const [channels, setChannels] = useState([]);
    const [tempo, setTempo] = useState(120); // Default BPM
    const [isVisible, setIsVisible] = useState(true); // Default visible
    const [loaded, setLoaded] = useState(false); // Prevent premature localStorage writes

    // Load saved state from localStorage when mounted or userId changes
    useEffect(() => {
        if (!userId) return;

        try {
            const savedChannelsRaw = localStorage.getItem(`channelRackChannels_user_${userId}`);
            const savedTempoRaw = localStorage.getItem(`channelRackTempo_user_${userId}`);
            const savedVisibleRaw = localStorage.getItem(`channelRackVisible_user_${userId}`);

            console.log(`[Load] Channels (user ${userId}):`, savedChannelsRaw);
            console.log(`[Load] Tempo (user ${userId}):`, savedTempoRaw);
            console.log(`[Load] Visible (user ${userId}):`, savedVisibleRaw);

            if (savedChannelsRaw) {
                setChannels(JSON.parse(savedChannelsRaw));
            } else {
                setChannels([]);
            }

            if (savedTempoRaw) {
                const parsedTempo = parseInt(savedTempoRaw);
                if (!isNaN(parsedTempo)) setTempo(parsedTempo);
            } else {
                setTempo(120);
            }

            if (savedVisibleRaw) {
                setIsVisible(savedVisibleRaw === 'true');
            } else {
                setIsVisible(true);
            }

            setLoaded(true);
        } catch (err) {
            console.error('Failed to load channel rack state from localStorage:', err);
        }
    }, [userId]);

    // Save to localStorage when state changes (after load)
    useEffect(() => {
        if (loaded && userId) {
            console.log(`[Save] Channels (user ${userId}):`, channels);
            localStorage.setItem(`channelRackChannels_user_${userId}`, JSON.stringify(channels));
            localStorage.setItem(`channelRackTempo_user_${userId}`, tempo.toString());
        }
    }, [channels, tempo, loaded, userId]);

    // Save visibility to localStorage when it changes (after load)
    useEffect(() => {
        if (loaded && userId) {
            console.log(`[Save] Visible (user ${userId}):`, isVisible);
            localStorage.setItem(`channelRackVisible_user_${userId}`, isVisible.toString());
        }
    }, [isVisible, loaded, userId]);

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
