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
            <nav style={navStyles}>
                {/* Left section - Search bar */}
                <div style={leftSectionStyles}>
                    <form onSubmit={handleSearch} style={searchFormStyles}>
                        <input
                            type="text"
                            placeholder="Search users"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            style={searchInputStyles}
                            className="nav-search-input"
                        />
                        <button type="submit" style={searchButtonStyles} className="btn nav-search-button">
                            🔍
                        </button>
                    </form>
                </div>

                {/* Right section - Navigation links */}
                <div style={rightSectionStyles}>
                    <a href="/profile" style={navLinkStyles} className="nav-link">Profile</a>
                    <a href="/feed" style={navLinkStyles} className="nav-link">Feed</a>
                    <a href="/build" style={navLinkStyles} className="nav-link">Build & Compose</a>
                    <a href="/tune" style={navLinkStyles} className="nav-link">Tune Your Ear</a>
                    <a href="/messages" style={navLinkStyles} className="nav-link">Messages</a>
                    
                    <button onClick={toggleVisibility} style={rackButtonStyles} className="btn rack-button">
                        {isVisible ? 'Hide Rack' : 'Show Rack'}
                    </button>
                </div>
            </nav>

            <ChannelRack />
        </>
    );
};

// Styling constants using your CSS custom properties
const navStyles = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    borderBottom: '1px solid var(--input-border)',
    backgroundColor: 'var(--panel-bg)',
    color: 'var(--panel-fg)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    height: '60px',
    boxSizing: 'border-box',
    position: 'sticky',
    top: 0,
    zIndex: 1000
};

const leftSectionStyles = {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center'
};

const searchFormStyles = {
    display: 'flex',
    width: '100%',
    maxWidth: '400px'
};

const searchInputStyles = {
    flex: '1',
    padding: '8px 12px',
    border: '1px solid var(--input-border)',
    borderRight: 'none',
    borderRadius: '6px 0 0 6px',
    fontSize: '14px',
    outline: 'none',
    backgroundColor: 'var(--input-bg)',
    color: 'var(--input-fg)',
    transition: 'all 0.2s ease'
};

const searchButtonStyles = {
    padding: '8px 16px',
    border: '1px solid var(--input-border)',
    borderLeft: 'none',
    borderRadius: '0 6px 6px 0',
    backgroundColor: 'var(--btn-bg)',
    color: 'var(--btn-fg)',
    cursor: 'pointer',
    fontSize: '16px',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
};

const rightSectionStyles = {
    flex: '1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '20px'
};

const navLinkStyles = {
    textDecoration: 'none',
    color: 'var(--panel-fg)',
    fontSize: '14px',
    fontWeight: '500',
    padding: '6px 0',
    transition: 'color 0.2s ease',
    whiteSpace: 'nowrap'
};

const rackButtonStyles = {
    padding: '8px 16px',
    border: '1px solid var(--btn-border)',
    borderRadius: '6px',
    backgroundColor: 'var(--btn-bg)',
    color: 'var(--btn-fg)',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap'
};

// Add hover effects using your design tokens
const addHoverEffects = `
    .nav-search-input:focus {
        background-color: var(--input-bg);
        border-color: var(--input-ring);
        box-shadow: 0 0 0 2px var(--input-ring);
    }
    
    .nav-search-button:hover {
        background-color: var(--btn-hover) !important;
    }
    
    .nav-link:hover {
        color: var(--input-placeholder);
    }
    
    .rack-button:hover {
        background-color: var(--btn-hover) !important;
        border-color: var(--input-ring);
    }

    /* Focus states for accessibility */
    .nav-search-input:focus {
        box-shadow: 0 0 0 2px var(--input-ring);
    }

    .nav-link:focus,
    .rack-button:focus {
        outline: none;
        box-shadow: 0 0 0 2px var(--input-ring);
    }
`;

// Add the hover effects to the document
if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = addHoverEffects;
    document.head.append(style);
}

export default Navbar;