import API from '../api';

export const savePatch = async (patchData) => {
    try {
        const res = await API.post('/patches/', patchData);
        return res.data;
    } catch (err) {
        console.error('Error saving patch:', err.response?.data || err);
        throw err;
    }
};

export const postPatch = async (patchId) => {
    try {
        await API.post(`/patches/${patchId}/post/`);
        return true;
    } catch (err) {
        console.error('Error posting patch:', err.response?.data || err);
        throw err;
    }
};

export const unpostPatch = async (patchId) => {
    try {
        await API.post(`/patches/${patchId}/unpost/`);
        return true;
    } catch (err) {
        console.error('Error unposting patch:', err.response?.data || err);
        throw err;
    }
};

export const deletePatch = async (patchId) => {
    try {
        await API.delete(`/patches/${patchId}/`);
        return true;
    } catch (err) {
        console.error('Error deleting patch:', err.response?.data || err);
        throw err;
    }
};

export const downloadPatch = (patch) => {
    const name = patch.name?.trim() || 'untitled';
    const filename = `${name}.spatch.json`;
    const blob = new Blob([JSON.stringify(patch.parameters, null, 2)], {
        type: 'application/json',
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
