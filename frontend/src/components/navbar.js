import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ChannelRack from './ChannelRack';
import { useChannelRack } from '../context/ChannelRackContext';

const Navbar = () => {
    const [query, setQuery] = useState('');
    const navigate = useNavigate();
    const { isVisible, toggleVisibility } = useChannelRack(); 

    const handleSearch = (e) => {
        e.preventDefault();
        if (query.trim()) {
            navigate(`/search?query=${encodeURIComponent(query.trim())}`);
        }
    };

    return (
        <>
            <nav style={{ padding: '10px', borderBottom: '1px solid #ccc' }}>
                <form onSubmit={handleSearch} style={{ display: 'inline' }}>
                    <input
                        type="text"
                        placeholder="Search users"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        style={{ padding: '5px', marginRight: '5px' }}
                    />
                    <button type="submit">Search</button>
                </form>

                <div style={{ float: 'right' }}>
                    <a href="/profile" style={{ marginRight: '10px' }}>Profile</a>
                    <a href="/feed" style={{ marginRight: '10px' }}>Feed</a>
                    <a href="/build" style={{ marginRight: '10px' }}>Build & Compose</a>
                    <a href="/tune" style={{ marginRight: '10px' }}>Tune Your Ear</a>

                    <button onClick={toggleVisibility}>
                        {isVisible ? 'Hide Rack' : 'Show Rack'}
                    </button>
                </div>
            </nav>

            <ChannelRack />
        </>
    );
};

export default Navbar;
