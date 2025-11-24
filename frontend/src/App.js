// src/App.js
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
import Navbar from './components/navbar';
import SearchResults from './pages/searchresults';
import UserProfile from './pages/userprofile';
import FeedPage from './pages/FeedPage';
import PatchDetail from './pages/patchdetail';
import { ChannelRackProvider } from './context/ChannelRackContext';
import TuneYourEarPage from './pages/TuneYourEarPage';
import FollowersList from './pages/FollowersList';
import FollowingList from './pages/FollowingList';
import UserPostedPatches from './pages/UserPostedPatches';
import UserSavedPatches from './pages/UserSavedPatches';
import BuildComposePage from './pages/BuildComposePage';
import TrackDetail from './pages/trackdetail';
import AppBackground from './components/AppBackground';
import MessagesPage from './pages/MessagesPage';

// Logos
import logoLight from './assets/synthspore-logo.PNG';            // Light mode
import logoDark from './assets/synthspore-logo_white.png';   // Dark mode
import logoLogin from './assets/synthspore-logo_white.png';  // Login page (inverted)

function InnerApp({ setUserId }) {
  const [token, setToken] = useState(localStorage.getItem('access_token') || '');
  const [username, setUsername] = useState('');
  const [formData, setFormData] = useState({ username: '', email: '', password: '' });
  const [showLogin, setShowLogin] = useState(true);

  // Theme state: light or dark
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  const navigate = useNavigate();
  const location = useLocation();

  // Apply theme class to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark');
    root.classList.add(theme === 'dark' ? 'theme-dark' : 'theme-light');
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const fetchCurrentUser = async () => {
      if (token) {
        try {
          const res = await API.get('/users/me/');
          setUsername(res.data.username);
          setUserId(res.data.id);
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

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      await API.post('/register/', formData);
      setShowLogin(true);
    } catch {
      alert('Registration failed.');
    }
  };

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  // LOGIN / REGISTER VIEW (with background)
  if (!token) {
    return (
      <>
        <AppBackground />

        <div style={{ padding: '20px', fontFamily: 'Arial' }}>
          {/* Header on login: inverted logo + white title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <img src={logoLogin} alt="SynthSpore logo" style={{ height: '40px' }} />
            <h1 style={{ margin: 0, color: '#fff' }}>SynthSpore</h1>
          </div>

          {showLogin ? (
            // Login form with CTA inside the box
            <LoginForm
              setToken={setToken}
              onShowRegister={() => setShowLogin(false)}
            />
          ) : (
            // REGISTER VIEW — same layout/classes as login
            <div className="login-page">
              <form onSubmit={handleRegister} className="login-form">
                <h2>Register</h2>

                <input
                  name="username"
                  placeholder="Username"
                  onChange={handleChange}
                  autoComplete="username"
                  required
                />
                <input
                  name="email"
                  placeholder="Email"
                  type="email"
                  onChange={handleChange}
                  autoComplete="email"
                  required
                />
                <input
                  name="password"
                  placeholder="Password"
                  type="password"
                  onChange={handleChange}
                  autoComplete="new-password"
                  required
                />

                <button type="submit" style={{ marginTop: '10px' }}>
                  Create account
                </button>

                {/* CTA inside the card, same style as login */}
                <div className="login-footer">
                  <span>Already have an account? </span>
                  <button
                    type="button"
                    className="login-cta__link"
                    onClick={() => setShowLogin(true)}
                  >
                    Login here
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </>
    );
  }

  // LOGGED-IN APP VIEW (theme-aware)
  const brandLogo = theme === 'dark' ? logoDark : logoLight;
  const brandTextColour = theme === 'dark' ? '#fff' : '#111';

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial', color: brandTextColour }}>
      {/* Persistent banner with theme-aware logo and title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <img src={brandLogo} alt="SynthSpore logo" style={{ height: 40 }} />
        <h1 style={{ margin: 0, color: brandTextColour }}>SynthSpore</h1>

        {/* Theme toggle */}
        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={toggleTheme}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid #888',
              background: theme === 'dark' ? '#222' : '#f7f7f7',
              color: theme === 'dark' ? '#fff' : '#111',
              cursor: 'pointer'
            }}
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </div>

      <p>Logged in as {username}</p>
      <button onClick={handleLogout}>Logout</button>

      <Navbar />

      <Routes>
        <Route path="/profile/:username" element={<UserProfile />} />
        <Route path="/feed" element={<FeedPage />} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/patches/:id" element={<PatchDetail />} />
        <Route path="/tracks/:id" element={<TrackDetail />} />
        <Route path="/tune" element={<TuneYourEarPage />} />
        <Route path="/profile/:username/followers" element={<FollowersList />} />
        <Route path="/profile/:username/following" element={<FollowingList />} />
        <Route path="/users/:username/posted" element={<UserPostedPatches />} />
        <Route path="/users/:username/saved" element={<UserSavedPatches />} />
        <Route path="/build" element={<BuildComposePage />} />
        <Route path="*" element={<Navigate to={`/profile/${username}`} />} />
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/messages/:username" element={<MessagesPage />} />
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
