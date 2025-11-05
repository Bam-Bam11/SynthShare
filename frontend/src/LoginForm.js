// src/LoginForm.js
import React, { useState } from 'react';
import API from './api';
import { jwtDecode } from 'jwt-decode';
import './LoginForm.css';

function LoginForm({ setToken, onShowRegister }) {
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await API.post('/token/', formData);
      const { access, refresh } = res.data;
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

  return (
    <div className="login-page">
      <form onSubmit={handleSubmit} className="login-form">
        <h2>Login</h2>

        <input
          type="text"
          name="username"
          placeholder="Username"
          value={formData.username}
          onChange={handleChange}
          autoComplete="username"
        />

        <input
          type="password"
          name="password"
          placeholder="Password"
          value={formData.password}
          onChange={handleChange}
          autoComplete="current-password"
        />

        <button type="submit">Login</button>

        {error && <p className="error">{error}</p>}

        {/* CTA inside the card */}
        <div className="login-footer">
          <span>Don't have an account? </span>
          <button
            type="button"
            className="login-cta__link"
            onClick={onShowRegister}
          >
            Register here
          </button>
        </div>
      </form>
    </div>
  );
}

export default LoginForm;
