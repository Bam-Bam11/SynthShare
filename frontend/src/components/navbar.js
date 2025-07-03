import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ChannelRack from './ChannelRack';

const Navbar = () => {
    const [query, setQuery] = useState('');
    const [channelRackVisible, setChannelRackVisible] = useState(
        localStorage.getItem('channelRackVisible') === 'true'
    );
    const navigate = useNavigate();

    const handleSearch = (e) => {
        e.preventDefault();
        if (query.trim()) {
            navigate(`/search?query=${encodeURIComponent(query.trim())}`);
        }
    };

    const toggleChannelRack = () => {
        const newState = !channelRackVisible;
        setChannelRackVisible(newState);
        localStorage.setItem('channelRackVisible', newState.toString());
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
                    <a href="/build" style={{ marginRight: '10px' }}>Build</a>
                    <button onClick={toggleChannelRack}>
                        {channelRackVisible ? 'Hide Rack' : 'Show Rack'}
                    </button>
                </div>
            </nav>

            <ChannelRack visible={channelRackVisible} onClose={() => toggleChannelRack()} />
        </>
    );
};

export default Navbar;
