// src/utils/patchActions.js
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
        // CHANGE: Use PATCH instead of DELETE to set is_deleted=true for soft delete
        await API.patch(`/patches/${patchId}/`, { is_deleted: true });
        return true;
    } catch (err) {
        console.error('Error deleting patch:', err.response?.data || err);
        throw err;
    }
};

// UPDATED: Standardized download function for server patches
export const downloadPatch = (patch) => {
    const name = patch.name?.trim() || 'untitled';
    const filename = `${name}.spatch.json`;
    
    // Create standardized patch object
    const patchFile = {
        name: patch.name,
        description: patch.description || '',
        parameters: patch.parameters,
        note: patch.note || 'C4',
        duration: patch.duration || '8n',
        // Include server metadata for context (optional)
        version: patch.version,
        id: patch.id,
        uploaded_by: patch.uploaded_by?.username,
        created_at: patch.created_at
    };
    
    const blob = new Blob([JSON.stringify(patchFile, null, 2)], {
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

// UPDATED: Now identical output format to downloadPatch
export const downloadPatchFromInterface = (patchData) => {
    const { name, description, parameters, note, duration } = patchData;
    const filename = `${(name || 'untitled').trim()}.spatch.json`;
    
    // Create the same standardized format as downloadPatch
    const patchFile = {
        name,
        description: description || '',
        parameters,
        note: note || 'C4',
        duration: duration || '8n'
        // No server metadata since this is from interface
    };
    
    const blob = new Blob([JSON.stringify(patchFile, null, 2)], { 
        type: 'application/json' 
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