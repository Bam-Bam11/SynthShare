import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import API from '../api';  

const UserProfile = () => {
    const { id } = useParams();
    const [user, setUser] = useState(null);
    const [patches, setPatches] = useState([]);

    useEffect(() => {
        console.log('Fetching user with ID:', id);

        API.get(`/users/${id}/`)
            .then(res => {
                console.log('User response:', res.data);
                setUser(res.data);
            })
            .catch(err => console.error('User not found', err));

        API.get(`/patches/?uploaded_by=${id}`)
            .then(res => {
                console.log('Patches response:', res.data);
                setPatches(res.data);
            })
            .catch(err => console.error('Could not fetch patches', err));
    }, [id]);

    if (!user) return <p>Loading user...</p>;

    return (
        <div style={{ padding: '20px' }}>
            <h2>Profile: {user.username}</h2>
            <p>User ID: {user.id}</p>

            <h3>Posted Patches</h3>
            {patches.length > 0 ? (
                <ul>
                    {patches.map(patch => (
                        <li key={patch.id}>
                            <strong>{patch.name}</strong> ({new Date(patch.created_at).toLocaleString()})
                            {/* You can later add play and fork buttons here */}
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
