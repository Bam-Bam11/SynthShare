import React, { useState } from 'react';
import API from './api';
import { jwtDecode } from 'jwt-decode';

function LoginForm({ setToken }) {
    const [formData, setFormData] = useState({ username: '', password: '' });
    const [error, setError] = useState('');

    const handleChange = e => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async e => {
        e.preventDefault();

        //  Add this to check what you're submitting
        console.log('Logging in with:', formData);

        try {
            const response = await API.post('/token/', formData);

            const access = response.data.access;
            const refresh = response.data.refresh;

            // Decode access token
            const decoded = jwtDecode(access);

            // Store tokens and user ID
            localStorage.setItem('access_token', access);
            localStorage.setItem('refresh_token', refresh);
            localStorage.setItem('user_id', decoded.user_id);

            setToken(access);
            setError('');
        } catch (err) {
            //  Log full error from backend
            console.error('Login error:', err.response?.data || err);
            setError('Login failed. Please check your credentials.');
        }
    };

    return (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', maxWidth: '300px' }}>
            <h2>Login</h2>
            <input
                type="text"
                name="username"
                placeholder="Username"
                value={formData.username}
                onChange={handleChange}
                style={{ marginBottom: '8px' }}
            />
            <input
                type="password"
                name="password"
                placeholder="Password"
                value={formData.password}
                onChange={handleChange}
                style={{ marginBottom: '8px' }}
            />
            <button type="submit" style={{ marginTop: '10px' }}>Login</button>
            {error && <p style={{ color: 'red' }}>{error}</p>}
        </form>
    );
}

export default LoginForm;
