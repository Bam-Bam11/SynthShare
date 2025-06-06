import React, { useState, useEffect } from 'react';
import API from './api';
import { jwtDecode } from 'jwt-decode';
import LoginForm from './LoginForm';
import SynthComponent from './SynthComponent';


function App() {
    const [showLogin, setShowLogin] = useState(false);
    const [token, setToken] = useState(localStorage.getItem('access_token') || '');
    const [username, setUsername] = useState('');
    const [formData, setFormData] = useState({ username: '', email: '', password: '' });

    useEffect(() => {
        if (token) {
            try {
                const decoded = jwtDecode(token);
                setUsername(decoded && decoded.username ? decoded.username : decoded.user_id);
            } catch (err) {
                console.error('Failed to decode token:', err);
                setUsername('');
            }
        } else {
            setUsername('');
        }
    }, [token]);

    const handleLogout = () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        setToken('');
    };

    const handleChange = e => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleRegister = async e => {
        e.preventDefault();
        try {
            await API.post('/register/', formData);
            setShowLogin(true); // Switch to login form after registration
        } catch (error) {
            alert('Registration failed.');
        }
    };

    return (
        <div style={{ padding: '20px', fontFamily: 'Arial' }}>
            <h1>SynthShare</h1>
            {!token ? (
                <>
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
                            <form
                                onSubmit={handleRegister}
                                style={{ display: 'flex', flexDirection: 'column', maxWidth: '300px' }}
                            >
                                <h2>Register</h2>
                                <input
                                    type="text"
                                    name="username"
                                    placeholder="Username"
                                    onChange={handleChange}
                                    style={{ marginBottom: '8px' }}
                                />
                                <input
                                    type="email"
                                    name="email"
                                    placeholder="Email"
                                    onChange={handleChange}
                                    style={{ marginBottom: '8px' }}
                                />
                                <input
                                    type="password"
                                    name="password"
                                    placeholder="Password"
                                    onChange={handleChange}
                                    style={{ marginBottom: '8px' }}
                                />
                                <button type="submit" style={{ marginTop: '10px' }}>Register</button>
                            </form>
                            <p>
                                Already have an account?{' '}
                                <button onClick={() => setShowLogin(true)}>Login here</button>
                            </p>
                        </>
                    )}
                </>
            ) : (
                <div>
                     <p>You are logged in as {username}</p>
                     <button onClick={handleLogout}>Logout</button>
                     <SynthComponent />
                </div>

            )}
        </div>
    );
}

export default App;
