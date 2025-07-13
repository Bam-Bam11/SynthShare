import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import API from '../api';
import PlayPatch from '../components/PlayPatch';
import { useChannelRack } from '../context/ChannelRackContext';
import { jwtDecode } from 'jwt-decode';

const PatchDetail = () => {
    const { id } = useParams();
    const [patch, setPatch] = useState(null);
    const [currentUserId, setCurrentUserId] = useState(null);
    const { assignPatchToFirstEmptyChannel } = useChannelRack();
    const navigate = useNavigate();

    useEffect(() => {
        const fetchPatch = async () => {
            try {
                const res = await API.get(`/patches/${id}/`);
                setPatch(res.data);
            } catch (err) {
                console.error('Failed to load patch:', err);
            }
        };

        const token = localStorage.getItem('access_token');
        if (token) {
            try {
                const decoded = jwtDecode(token);
                setCurrentUserId(decoded.user_id);
            } catch (err) {
                console.error('Token decoding failed:', err);
            }
        }

        fetchPatch();
    }, [id]);

    const handleEditOrFork = () => {
        if (!patch) return;

        const isEdit = currentUserId === patch.uploaded_by_id;

        const patchData = {
            parameters: patch.parameters,
            synth_type: patch.synth_type,
            note: patch.note,
            duration: patch.duration,
            name: patch.name + (isEdit ? '' : ' (fork)'),
            description: patch.description || '',
            action: isEdit ? 'edit' : 'fork',
            stem: patch.id,
            immediate_predecessor: patch.id,
            root: patch.root || patch.id,
        };

        localStorage.setItem('patchToLoad', JSON.stringify(patchData));
        navigate('/build');
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
            <p><strong>Version:</strong> {patch.version}</p>

            <h3>Parameters:</h3>
            <pre style={{ background: '#f9f9f9', color: '#333', padding: '10px', borderRadius: '5px' }}>
                {JSON.stringify(patch.parameters, null, 2)}
            </pre>

            <button onClick={() => PlayPatch(patch)} style={{ marginRight: '10px' }}>Play Patch</button>
            <button onClick={() => assignPatchToFirstEmptyChannel(patch)} style={{ marginRight: '10px' }}>
                Add to Rack
            </button>
            {currentUserId && (
                <button onClick={handleEditOrFork}>
                    {currentUserId === patch.uploaded_by_id ? 'Edit Patch' : 'Fork Patch'}
                </button>
            )}
        </div>
    );
};

export default PatchDetail;
