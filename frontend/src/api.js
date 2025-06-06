import axios from 'axios';

const API = axios.create({
    baseURL: 'http://127.0.0.1:8000/api/',
});

// Attach the access token to each request
API.interceptors.request.use(
    config => {
        const token = localStorage.getItem('access_token');
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    error => Promise.reject(error)
);

// Intercept failed responses and try to refresh the token
API.interceptors.response.use(
    response => response,
    async error => {
        const originalRequest = error.config;

        // If 401 error, try to refresh the token
        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;
            try {
                const refresh_token = localStorage.getItem('refresh_token');
                const response = await axios.post('http://127.0.0.1:8000/api/token/refresh/', {
                    refresh: refresh_token,
                });

                const new_access = response.data.access;
                localStorage.setItem('access_token', new_access);

                // Retry the original request with the new token
                originalRequest.headers['Authorization'] = `Bearer ${new_access}`;
                return axios(originalRequest);
            } catch (refreshError) {
                // Refresh failed — logout user
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
                window.location.reload();  // or redirect to login
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);

export default API;
