import axios from 'axios';

// Use one source of truth for the API base.
const BASE = (process.env.REACT_APP_API_BASE || 'http://127.0.0.1:8000/api').replace(/\/$/, '');

const API = axios.create({
  baseURL: BASE, // e.g. http://127.0.0.1:8000/api
  // timeout: 15000,
});

// --- tiny helpers for readable logs ---
const fullURL = (cfg) => `${cfg?.baseURL || ''}${cfg?.url || ''}`;
const safe = (v) => {
  try { return typeof v === 'string' ? v : JSON.stringify(v); }
  catch { return v; }
};

// REQUEST interceptor: attach token + log outgoing request
API.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) config.headers['Authorization'] = `Bearer ${token}`;

    // Log request line + params/body
    const method = (config.method || 'GET').toUpperCase();
    const url = fullURL(config);
    // Only log params/body if present
    console.log(
      '[API →]',
      method,
      url,
      config.params ? { params: config.params } : '',
      config.data ? { data: config.data } : ''
    );

    return config;
  },
  (error) => {
    console.warn('[API →] request setup error:', error);
    return Promise.reject(error);
  }
);

// RESPONSE interceptor: log responses; keep your refresh flow
API.interceptors.response.use(
  (response) => {
    const { config, status } = response || {};
    console.log('[API ←]', status, (config?.method || 'GET').toUpperCase(), fullURL(config));
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Network-level failure (e.g., server down)
    if (error.code === 'ERR_NETWORK') {
      console.error('[API ×] network error:', error.message);
      return Promise.reject(error);
    }

    const status = error?.response?.status;
    const data = error?.response?.data;

    // Log the failure before any retry logic
    try {
      console.warn(
        '[API ×]',
        status || error.code || 'unknown',
        (originalRequest?.method || 'GET').toUpperCase(),
        fullURL(originalRequest),
        data ? `payload: ${safe(data)}` : (error.message || '')
      );
    } catch {
      // ignore logging failure
    }

    // Don’t attempt refresh loops for the auth endpoints themselves
    const isAuthEndpoint = originalRequest?.url?.includes('/token/');

    const looksLikeExpiredAccess =
      status === 401 &&
      !isAuthEndpoint &&
      (data?.code === 'token_not_valid' ||
        data?.detail?.toString()?.toLowerCase()?.includes('not valid') ||
        data?.messages?.some?.((m) =>
          (m?.message || '').toLowerCase().includes('expired')
        ));

    if (looksLikeExpiredAccess && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refresh = localStorage.getItem('refresh_token');
        if (!refresh) throw new Error('No refresh token');

        console.log('[API] attempting token refresh…');
        const resp = await API.post('/token/refresh/', { refresh });
        const newAccess = resp.data.access;
        localStorage.setItem('access_token', newAccess);

        originalRequest.headers['Authorization'] = `Bearer ${newAccess}`;
        console.log('[API] retrying original request:', fullURL(originalRequest));
        return API(originalRequest);
      } catch (refreshErr) {
        console.warn('[API] refresh failed; clearing tokens.');
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        alert('Session expired. Please log in again.');
        window.location.href = '/';
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(error);
  }
);

export default API;
