import React, { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import API from '../api';
import PlayPatch from '../components/PlayPatch';
import { useChannelRack } from '../context/ChannelRackContext';
import { postPatch, savePatch, deletePatch, unpostPatch, downloadPatch } from '../utils/patchActions';

const UserProfile = ({ isSelfProfile: propIsSelfProfile = false }) => {
    const { username } = useParams();
    const [user, setUser] = useState(null);
    const [patches, setPatches] = useState([]);
    const [savedPatches, setSavedPatches] = useState([]);
    const [isFollowing, setIsFollowing] = useState(false);
    const [currentUserId, setCurrentUserId] = useState(null);
    const [isSelfProfile, setIsSelfProfile] = useState(propIsSelfProfile);

    const { assignPatchToFirstEmptyChannel } = useChannelRack();

    const checkFollowStatus = useCallback((targetId, currentId) => {
        if (!targetId || !currentId) return;
        API.get('/follows/')
            .then(res => {
                const following = res.data.some(
                    f => f.follower === currentId && f.following === targetId
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
            setCurrentUserId(decoded.user_id);
            console.log("Param 'username':", username);
            console.log("Decoded token username:", decoded.username);

            const targetUsername = username || decoded.username;

            API.get(`/users/${targetUsername}/`)
                .then(res => {
                    setUser(res.data);
                    const targetId = res.data.id;
                    setIsSelfProfile(decoded.user_id === targetId);

                    API.get(`/patches/?uploaded_by=${targetId}`)
                        .then(res => {
                            console.log("Fetched patches from backend:", res.data);
                            const all = res.data;
                            setSavedPatches(all);
                            setPatches(all.filter(p => p.is_posted));
                        })
                        .catch(err => {
                            console.error('Could not fetch patches', err);
                            setPatches([]);
                            setSavedPatches([]);
                        });

                    checkFollowStatus(targetId, decoded.user_id);
                })
                .catch(err => {
                    console.error('User not found', err);
                    setUser(null);
                });

        } catch (err) {
            console.error('Token decoding failed:', err);
        }
    }, [username, checkFollowStatus]);

    const handleFollow = async () => {
        try {
            await API.post('/follows/', { following: user.id });
            checkFollowStatus(user.id, currentUserId);
        } catch (err) {
            console.error('Failed to follow:', err.response?.data || err);
        }
    };

    const handleUnfollow = async () => {
        try {
            await API.post('/follows/unfollow/', { following: user.id });
            checkFollowStatus(user.id, currentUserId);
        } catch (err) {
            console.error('Failed to unfollow:', err.response?.data || err);
        }
    };

    const handlePostPatch = async (patchId) => {
        try {
            await postPatch(patchId);
            setSavedPatches(prev =>
                prev.map(p => p.id === patchId ? { ...p, is_posted: true } : p)
            );
            setPatches(prev => {
                const already = prev.find(p => p.id === patchId);
                if (already) return prev;
                const justPosted = savedPatches.find(p => p.id === patchId);
                return [...prev, { ...justPosted, is_posted: true }];
            });
        } catch (err) {
            console.error('Failed to post patch:', err);
        }
    };

    const handleUnpostPatch = async (patchId) => {
        try {
            await unpostPatch(patchId);
            setPatches(prev => prev.filter(p => p.id !== patchId));
            setSavedPatches(prev =>
                prev.map(p => p.id === patchId ? { ...p, is_posted: false } : p)
            );
        } catch (err) {
            console.error('Failed to unpost patch:', err);
        }
    };

    const handleDeletePatch = async (patchId) => {
        try {
            await deletePatch(patchId);
            setSavedPatches(prev => prev.filter(p => p.id !== patchId));
            setPatches(prev => prev.filter(p => p.id !== patchId));
        } catch (err) {
            console.error('Failed to delete patch:', err);
        }
    };

    if (!user) return <p>Loading user...</p>;

    return (
        <div style={{ padding: '20px' }}>
            <h2>Profile: {user.username}</h2>
            <p>User ID: {user.id}</p>

            {!isSelfProfile && (
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
                            <strong>
                                <Link to={`/patches/${patch.id}`} style={{ textDecoration: 'none', color: 'blue' }}>
                                    {patch.name}
                                </Link>
                            </strong>{' '}
                            ({new Date(patch.created_at).toLocaleString()})
                            <button style={{ marginLeft: '10px' }} onClick={() => PlayPatch(patch)}>Play</button>
                            <button style={{ marginLeft: '10px' }} onClick={() => assignPatchToFirstEmptyChannel(patch)}>Add to Rack</button>
                            {isSelfProfile && (
                                <>
                                    <button style={{ marginLeft: '10px' }} onClick={() => handleUnpostPatch(patch.id)}>Unpost</button>
                                    <button style={{ marginLeft: '10px' }} onClick={() => handleDeletePatch(patch.id)}>Delete</button>
                                </>
                            )}
                        </li>
                    ))}
                </ul>
            ) : (
                <p>This user has not posted any patches yet.</p>
            )}

            {isSelfProfile && (
                <>
                    <h3>Saved Patches (All Created)</h3>
                    {savedPatches.length > 0 ? (
                        <ul>
                            {savedPatches.map(patch => (
                                <li key={patch.id}>
                                    <strong>
                                        <Link to={`/patches/${patch.id}`} style={{ textDecoration: 'none', color: 'blue' }}>
                                            {patch.name}
                                        </Link>
                                    </strong>{' '}
                                    ({new Date(patch.created_at).toLocaleString()})
                                    <button style={{ marginLeft: '10px' }} onClick={() => PlayPatch(patch)}>Play</button>
                                    <button style={{ marginLeft: '10px' }} onClick={() => assignPatchToFirstEmptyChannel(patch)}>Add to Rack</button>
                                    {!patch.is_posted && (
                                        <button style={{ marginLeft: '10px' }} onClick={() => handlePostPatch(patch.id)}>Post</button>
                                    )}
                                    <button style={{ marginLeft: '10px' }} onClick={() => handleDeletePatch(patch.id)}>Delete</button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>You have not created any patches yet.</p>
                    )}
                </>
            )}

        </div>
    );
};

export default UserProfile;
