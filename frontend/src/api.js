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

        const isTokenExpired =
            error.response?.status === 401 &&
            error.response?.data?.code === 'token_not_valid' &&
            error.response?.data?.messages?.some(
                msg => msg.message === 'Token is expired' && msg.token_type === 'access'
            );

        if (isTokenExpired && !originalRequest._retry) {
            originalRequest._retry = true;

            try {
                const refresh_token = localStorage.getItem('refresh_token');
                const response = await axios.post('http://127.0.0.1:8000/api/token/refresh/', {
                    refresh: refresh_token,
                });

                const new_access = response.data.access;
                localStorage.setItem('access_token', new_access);

                // Retry original request with new access token
                originalRequest.headers['Authorization'] = `Bearer ${new_access}`;
                return API(originalRequest);
            } catch (refreshError) {
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
                alert('Session expired. Please log in again.');
                window.location.reload();
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);


export default API;
