import React, { useState, useEffect } from 'react';
import API from './api';
import { jwtDecode } from 'jwt-decode';
import splashLogo from './assets/splash-logo.png'; 
import './LoginForm.css';

function LoginForm({ setToken }) {
    const [formData, setFormData] = useState({ username: '', password: '' });
    const [error, setError] = useState('');
    const [showSplash, setShowSplash] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => setShowSplash(false), 2000); // 2 sec splash
        return () => clearTimeout(timer);
    }, []);

    const handleChange = e => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async e => {
        e.preventDefault();
        console.log('Logging in with:', formData);

        try {
            const response = await API.post('/token/', formData);
            const { access, refresh } = response.data;
            const decoded = jwtDecode(access);

            localStorage.setItem('access_token', access);
            localStorage.setItem('refresh_token', refresh);
            localStorage.setItem('user_id', decoded.user_id);

            setToken(access);
            setError('');
        } catch (err) {
            console.error('Login error:', err.response?.data || err);
            setError('Login failed. Please check your credentials.');
        }
    };

    //  SPLASH SCREEN SECTION
    if (showSplash) {
        return (
            <div className="splash-screen">
                <img
                    src={splashLogo}
                    alt="SynthSpore Logo"
                    className="splash-image"
                />
            </div>
        );
    }

    //  LOGIN FORM SECTION
    return (
        <form onSubmit={handleSubmit} className="login-form">
            <h2>Login</h2>
            <input
                type="text"
                name="username"
                placeholder="Username"
                value={formData.username}
                onChange={handleChange}
            />
            <input
                type="password"
                name="password"
                placeholder="Password"
                value={formData.password}
                onChange={handleChange}
            />
            <button type="submit">Login</button>
            {error && <p className="error">{error}</p>}
        </form>
    );
}

export default LoginForm;
