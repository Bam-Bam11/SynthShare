import React, { useState, useEffect } from 'react';
import {
    BrowserRouter as Router,
    Routes,
    Route,
    Navigate,
    useNavigate,
    useLocation
} from 'react-router-dom';

import API from './api';
import LoginForm from './LoginForm';
import SynthInterface from './components/SynthInterface';
import Navbar from './components/navbar';
import SearchResults from './pages/searchresults';
import UserProfile from './pages/userprofile';
import FeedPage from './pages/FeedPage';
import PatchDetail from './pages/patchdetail';
import { ChannelRackProvider } from './context/ChannelRackContext';
import TuneYourEarPage from './pages/TuneYourEarPage';

function InnerApp({ setUserId }) {
    const [token, setToken] = useState(localStorage.getItem('access_token') || '');
    const [username, setUsername] = useState('');
    const [formData, setFormData] = useState({ username: '', email: '', password: '' });
    const [showLogin, setShowLogin] = useState(true);
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const fetchCurrentUser = async () => {
            if (token) {
                try {
                    const res = await API.get('/users/me/');
                    setUsername(res.data.username);
                    setUserId(res.data.id); // Pass userId up to parent
                    if (location.pathname === '/') {
                        navigate(`/profile/${res.data.username}`);
                    }
                } catch (err) {
                    console.error('Failed to fetch current user:', err);
                    setUsername('');
                    setUserId(null);
                }
            } else {
                setUsername('');
                setUserId(null);
            }
        };
        fetchCurrentUser();
    }, [token, location.pathname, navigate, setUserId]);

    const handleLogout = () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        setToken('');
        setUsername('');
        setUserId(null);
        navigate('/');
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        try {
            await API.post('/register/', formData);
            setShowLogin(true);
        } catch {
            alert('Registration failed.');
        }
    };

    if (!token) {
        return (
            <div style={{ padding: '20px', fontFamily: 'Arial' }}>
                <h1>SynthShare</h1>
                {showLogin ? (
                    <>
                        <LoginForm setToken={setToken} />
                        <p>
                            Don't have an account?{' '}
                            <button onClick={() => setShowLogin(false)}>Register here</button>
                        </p>
                    </>
                ) : (
                    <>
                        <form onSubmit={handleRegister} style={{ maxWidth: '300px', display: 'flex', flexDirection: 'column' }}>
                            <h2>Register</h2>
                            <input name="username" placeholder="Username" onChange={handleChange} />
                            <input name="email" placeholder="Email" type="email" onChange={handleChange} />
                            <input name="password" placeholder="Password" type="password" onChange={handleChange} />
                            <button type="submit" style={{ marginTop: '10px' }}>Register</button>
                        </form>
                        <p>
                            Already have an account?{' '}
                            <button onClick={() => setShowLogin(true)}>Login here</button>
                        </p>
                    </>
                )}
            </div>
        );
    }

    return (
        <div style={{ padding: '20px', fontFamily: 'Arial' }}>
            <h1>SynthShare</h1>
            <p>Logged in as {username}</p>
            <button onClick={handleLogout}>Logout</button>

            <Navbar />

            <Routes>
                <Route path="/profile/:username" element={<UserProfile />} />
                <Route path="/feed" element={<FeedPage />} />
                <Route path="/build" element={<SynthInterface />} />
                <Route path="/search" element={<SearchResults />} />
                <Route path="/patches/:id" element={<PatchDetail />} />
                <Route path="*" element={<Navigate to={`/profile/${username}`} />} />
                <Route path="/tune" element={<TuneYourEarPage />} />
            </Routes>
        </div>
    );
}

// Top-level App entry point
export default function App() {
    const [userId, setUserId] = useState(null);

    return (
        <Router>
            <ChannelRackProvider userId={userId}>
                <InnerApp setUserId={setUserId} />
            </ChannelRackProvider>
        </Router>
    );
}
