// src/pages/patchdetail.js (or PatchDetail.jsx)
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import API from '../api';
import PlayPatch from '../components/PlayPatch';
import { useChannelRack } from '../context/ChannelRackContext';
import { jwtDecode } from 'jwt-decode';
import PatchLineageGraph from '../components/PatchLineageGraph';

const PatchDetail = () => {
  const { id } = useParams();
  const [patch, setPatch] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const { assignPatchToFirstEmptyChannel } = useChannelRack();
  const navigate = useNavigate();

  // Ancestor link + label cache
  const [ancMeta, setAncMeta] = useState({
    root: null,
    stem: null,
    immediate_predecessor: null,
  });

  useEffect(() => {
    const fetchPatch = async () => {
      try {
        const res = await API.get(`/patches/${id}/`);
        setPatch(res.data);
      } catch (err) {
        console.error('Failed to load patch:', err);
      }
    };

    const token = localStorage.getItem('access_token');
    if (token) {
      try {
        const decoded = jwtDecode(token);
        setCurrentUserId(decoded.user_id);
      } catch (err) {
        console.error('Token decoding failed:', err);
      }
    }

    fetchPatch();
  }, [id]);

  // Load ancestor versions and link availability.
  // Uses /patches/:id/lineage to grab version strings, then probes each target to see if it exists.
  useEffect(() => {
    if (!patch) return;

    const loadAncestors = async () => {
      try {
        // lineage gives us id -> version for visible nodes
        const line = await API.get(`/patches/${patch.id}/lineage/`);
        const nodeMap = new Map((line.data?.nodes || []).map(n => [n.id, n])); // id -> node (has .version) :contentReference[oaicite:1]{index=1}

        // Prepare ids (root may be null on the original root; treat self as root for display)
        const rootId = patch.root || patch.id;
        const stemId = patch.stem || null;
        const predId = patch.immediate_predecessor || null; // direct parent if any
        const targets = [
          ['root', rootId],
          ['stem', stemId],
          ['immediate_predecessor', predId],
        ];

        const results = await Promise.all(
          targets.map(async ([key, tid]) => {
            if (!tid) return [key, null];

            // Version from lineage (works even when ancestor is unposted but visible via path)
            const versionFromLineage = nodeMap.get(tid)?.version || null;

            // Existence check: if 200 -> linkable; if 404 -> show plain text only.
            let exists = false;
            try {
              await API.get(`/patches/${tid}/`);
              exists = true;
            } catch {
              exists = false;
            }

            return [
              key,
              {
                id: tid,
                version: versionFromLineage, // cached text to show even if link disabled later
                exists,
              },
            ];
          })
        );

        const meta = { root: null, stem: null, immediate_predecessor: null };
        results.forEach(([k, v]) => (meta[k] = v));
        setAncMeta(meta);
      } catch (e) {
        console.warn('Failed to load lineage meta:', e);
      }
    };

    loadAncestors();
  }, [patch]);

  const handleEditOrFork = () => {
    if (!patch) return;

    const isEdit = currentUserId === patch.uploaded_by_id;

    const patchData = {
      parameters: patch.parameters,
      synth_type: patch.synth_type,
      note: patch.note,
      duration: patch.duration,
      name: patch.name + (isEdit ? '' : ' (fork)'),
      description: patch.description || '',
      action: isEdit ? 'edit' : 'fork',
      stem: patch.id,
      immediate_predecessor: patch.id,
      root: patch.root || patch.id,
    };

    localStorage.setItem('patchToLoad', JSON.stringify(patchData));
    navigate('/build');
  };

  if (!patch) return <p>Loading patch details...</p>;

  // Small helper to render a single lineage row
  const LineageRow = ({ label, meta }) => {
    if (!meta) return (
      <p><strong>{label}:</strong> —</p>
    );
    const verText = meta.version ? `v${meta.version}` : '(version unknown)';
    return (
      <p>
        <strong>{label}:</strong>{' '}
        {meta.exists ? (
          <a href={`/patches/${meta.id}`}>{verText}</a>
        ) : (
          <span>{verText}</span>
        )}
      </p>
    );
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>{patch.name}</h2>
      <p><strong>Description:</strong> {patch.description || 'No description provided.'}</p>
      <p><strong>Uploaded by:</strong> {patch.uploaded_by}</p>
      <p><strong>Created at:</strong> {new Date(patch.created_at).toLocaleString()}</p>
      <p><strong>Downloads:</strong> {patch.downloads}</p>
      <p><strong>Forks:</strong> {patch.forks}</p>
      <p><strong>Version:</strong> {patch.version}</p>

      {/* NEW: Lineage links under Version */}
      <LineageRow label="Immediate predecessor" meta={ancMeta.immediate_predecessor} />
      <LineageRow label="Stem" meta={ancMeta.stem} />
      <LineageRow label="Root" meta={ancMeta.root} />

      <h3>Parameters:</h3>
      <pre style={{ background: '#f9f9f9', color: '#333', padding: '10px', borderRadius: '5px' }}>
        {JSON.stringify(patch.parameters, null, 2)}
      </pre>

      <button onClick={() => PlayPatch(patch)} style={{ marginRight: '10px' }}>Play Patch</button>
      <button onClick={() => assignPatchToFirstEmptyChannel(patch)} style={{ marginRight: '10px' }}>
        Add to Rack
      </button>
      {currentUserId && (
        <button onClick={handleEditOrFork}>
          {currentUserId === patch.uploaded_by_id ? 'Edit Patch' : 'Fork Patch'}
        </button>
      )}

      {patch && (
        <div style={{ marginTop: '30px' }}>
          <h3>Version Tree</h3>
          <PatchLineageGraph patchId={patch.id} />
        </div>
      )}
    </div>
  );
};

export default PatchDetail;
