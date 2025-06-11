import React, { useState, useEffect } from 'react';
import {
    BrowserRouter as Router,
    Routes,
    Route,
    Navigate,
    Link,
    useNavigate,
    useLocation
} from 'react-router-dom';
import API from './api';
import { jwtDecode } from 'jwt-decode';
import LoginForm from './LoginForm';
import SynthInterface from './components/SynthInterface';

// Placeholder components
const ProfilePage = () => <h2>Welcome to your profile</h2>;
const FeedPage = () => <h2>Here is your feed</h2>;

function App() {
    const [token, setToken] = useState(localStorage.getItem('access_token') || '');
    const [username, setUsername] = useState('');
    const [formData, setFormData] = useState({ username: '', email: '', password: '' });
    const [showLogin, setShowLogin] = useState(true);
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (token) {
            try {
                const decoded = jwtDecode(token);
                setUsername(decoded.username || decoded.user_id);
                if (location.pathname === '/') {
                    navigate('/profile'); // redirect after login
                }
            } catch (err) {
                console.error('Failed to decode token:', err);
                setUsername('');
            }
        } else {
            setUsername('');
        }
    }, [token, location.pathname, navigate]);

    const handleLogout = () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        setToken('');
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

            {/* Persistent Nav Bar */}
            <nav style={{ margin: '10px 0' }}>
                <Link to="/profile" style={{ marginRight: '15px' }}>Profile</Link>
                <Link to="/feed" style={{ marginRight: '15px' }}>Feed</Link>
                <Link to="/build">Build</Link>
            </nav>

            <Routes>
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/feed" element={<FeedPage />} />
                <Route path="/build" element={<SynthInterface />} />
                <Route path="*" element={<Navigate to="/profile" />} />
            </Routes>
        </div>
    );
}

export default function WrappedApp() {
    return (
        <Router>
            <App />
        </Router>
    );
}
