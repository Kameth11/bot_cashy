import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('cashy_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => {
    const refreshed = res.headers?.['x-refreshed-token'];
    if (refreshed) localStorage.setItem('cashy_token', refreshed);
    return res;
  },
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('cashy_token');
      localStorage.removeItem('cashy_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
