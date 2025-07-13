import React, { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import axios from 'axios';

const SearchResults = () => {
    const [results, setResults] = useState([]);
    const location = useLocation();

    const query = new URLSearchParams(location.search).get('query');

    useEffect(() => {
        if (query) {
            axios
                .get(`http://localhost:8000/api/users/?search=${query}`)
                .then(res => setResults(res.data))
                .catch(err => console.error(err));
        }
    }, [query]);

    return (
        <div style={{ padding: '20px' }}>
            <h2>Search Results for "{query}"</h2>
            {results.length > 0 ? (
                <ul>
                    {results.map(user => (
                        <li key={user.id}>
                            <Link to={`/profile/${user.username}`}>{user.username}</Link>
                        </li>
                    ))}
                </ul>
            ) : (
                <p>No users found.</p>
            )}
        </div>
    );
};

export default SearchResults;
