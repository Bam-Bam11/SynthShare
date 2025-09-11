import API from '../api';

export const createTrack = async (payload) => {
  const { data } = await API.post('/tracks/', payload);
  return data;
};

export const updateTrack = async (id, payload) => {
  const { data } = await API.put(`/tracks/${id}/`, payload);
  return data;
};

export const postTrack = async (id) => API.post(`/tracks/${id}/post/`);
export const unpostTrack = async (id) => API.post(`/tracks/${id}/unpost/`);
export const forkTrack = async (id, payload) => {
  const { data } = await API.post(`/tracks/${id}/fork/`, payload);
  return data;
};
