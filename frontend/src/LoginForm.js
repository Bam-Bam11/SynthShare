import React, { useState } from 'react';
import API from './api';

function LoginForm({ setToken }) {
    const [formData, setFormData] = useState({ username: '', password: '' });
    const [error, setError] = useState('');

    const handleChange = e => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async e => {
        e.preventDefault();
        try {
            const response = await API.post('/token/', formData);
            setToken(response.data.access);
            localStorage.setItem('access_token', response.data.access);
            localStorage.setItem('refresh_token', response.data.refresh);
            setError('');
        } catch (err) {
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
