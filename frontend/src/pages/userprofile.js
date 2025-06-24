import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import * as Tone from 'tone';
import API from '../api';

const UserProfile = ({ isSelfProfile = false }) => {
    const { id } = useParams();
    const [user, setUser] = useState(null);
    const [patches, setPatches] = useState([]);
    const [isFollowing, setIsFollowing] = useState(false);
    const [currentUserId, setCurrentUserId] = useState(null);

    const checkFollowStatus = useCallback((targetId, currentId) => {
        if (!targetId || !currentId) return;

        API.get('/follows/')
            .then(res => {
                const following = res.data.some(
                    f => f.follower === currentId && f.following === parseInt(targetId)
                );
                setIsFollowing(following);
            })
            .catch(err => console.error('Error checking follow status', err));
    }, []);

    useEffect(() => {
        const token = localStorage.getItem('access_token');
        if (!token) return;

        try {
            const decoded = jwtDecode(token);
            const currentId = decoded.user_id;
            const targetId = id || currentId;

            setCurrentUserId(currentId);

            API.get(`/users/${targetId}/`)
                .then(res => setUser(res.data))
                .catch(err => {
                    console.error('User not found', err);
                    setUser(null);
                });

            API.get(`/patches/?uploaded_by=${targetId}`)
                .then(res => setPatches(res.data))
                .catch(err => {
                    console.error('Could not fetch patches', err);
                    setPatches([]);
                });

            checkFollowStatus(targetId, currentId);
        } catch (err) {
            console.error('Token decoding failed:', err);
        }
    }, [id, checkFollowStatus]);

    const handleFollow = async () => {
        try {
            await API.post('/follows/', { following: id });
            checkFollowStatus(id, currentUserId);
        } catch (err) {
            console.error('Failed to follow:', err.response?.data || err);
        }
    };

    const handleUnfollow = async () => {
        try {
            await API.post('/follows/unfollow/', { following: id });
            checkFollowStatus(id, currentUserId);
        } catch (err) {
            console.error('Failed to unfollow:', err.response?.data || err);
        }
    };

    const playPatch = async (patch) => {
        await Tone.start();
        const note = patch.note || patch.parameters?.note || 'C4';
        const duration = patch.duration || patch.parameters?.duration || '8n';

        const synth = new Tone.Synth({
            oscillator: { type: patch.parameters?.oscillator || 'sine' },
            envelope: patch.parameters?.envelope || {}
        }).toDestination();

        synth.triggerAttackRelease(note, duration);
    };

    if (!user) return <p>Loading user...</p>;

    return (
        <div style={{ padding: '20px' }}>
            <h2>Profile: {user.username}</h2>
            <p>User ID: {user.id}</p>

            {currentUserId !== user.id && (
                isFollowing ? (
                    <button onClick={handleUnfollow}>Unfollow</button>
                ) : (
                    <button onClick={handleFollow}>Follow</button>
                )
            )}

            <h3>Posted Patches</h3>
            {patches.length > 0 ? (
                <ul>
                    {patches.map(patch => (
                        <li key={patch.id}>
                            <strong>{patch.name}</strong> ({new Date(patch.created_at).toLocaleString()})
                            <button style={{ marginLeft: '10px' }} onClick={() => playPatch(patch)}>Play</button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p>This user has not posted any patches yet.</p>
            )}
        </div>
    );
};

export default UserProfile;
