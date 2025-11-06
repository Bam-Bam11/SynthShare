// src/pages/patchdetail.js (or PatchDetail.jsx)
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
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
  useEffect(() => {
    if (!patch) return;

    const loadAncestors = async () => {
      try {
        const line = await API.get(`/patches/${patch.id}/lineage/`);
        const nodeMap = new Map((line.data?.nodes || []).map(n => [n.id, n])); // id -> node (has .version)

        const rootId = patch.root || patch.id;
        const stemId = patch.stem || null;
        const predId = patch.immediate_predecessor || null;

        const targets = [
          ['root', rootId],
          ['stem', stemId],
          ['immediate_predecessor', predId],
        ];

        const results = await Promise.all(
          targets.map(async ([key, tid]) => {
            if (!tid) return [key, null];

            const versionFromLineage = nodeMap.get(tid)?.version || null;

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
                version: versionFromLineage,
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

  if (!patch) return <p className="p-5">Loading patch details...</p>;

  const LineageRow = ({ label, meta }) => {
    if (!meta) return <p><strong>{label}:</strong> —</p>;
    const verText = meta.version ? `v${meta.version}` : '(version unknown)';
    return (
      <p>
        <strong>{label}:</strong>{' '}
        {meta.exists ? (
          <Link to={`/patches/${meta.id}`} className="text-blue-600 dark:text-blue-400 no-underline">
            {verText}
          </Link>
        ) : (
          <span>{verText}</span>
        )}
      </p>
    );
  };

  return (
    <div className="p-5">
      <h2>{patch.name}</h2>
      <p><strong>Description:</strong> {patch.description || 'No description provided.'}</p>
      <p><strong>Uploaded by:</strong>{' '}
        <Link to={`/profile/${patch.uploaded_by}`} className="text-green-600 dark:text-green-400 no-underline">
          {patch.uploaded_by}
        </Link>
      </p>
      <p><strong>Created at:</strong> {new Date(patch.created_at).toLocaleString()}</p>
      <p><strong>Downloads:</strong> {patch.downloads}</p>
      <p><strong>Forks:</strong> {patch.forks}</p>
      <p><strong>Version:</strong> {patch.version}</p>

      {/* Lineage links */}
      <LineageRow label="Immediate predecessor" meta={ancMeta.immediate_predecessor} />
      <LineageRow label="Stem" meta={ancMeta.stem} />
      <LineageRow label="Root" meta={ancMeta.root} />

      <h3 className="mt-4">Parameters:</h3>
      <pre className="rounded p-3 bg-gray-100 text-gray-800 dark:bg-slate-900 dark:text-gray-100 overflow-auto text-sm">
        {JSON.stringify(patch.parameters, null, 2)}
      </pre>

      <div className="mt-4 inline-flex flex-wrap gap-2">
        <button className="btn btn-play" onClick={() => PlayPatch(patch)}>Play Patch</button>
        <button className="btn btn-add" onClick={() => assignPatchToFirstEmptyChannel(patch)}>Add to Rack</button>
        {currentUserId && (
          <button className="btn btn-primary btn-edit" onClick={handleEditOrFork}>
            {currentUserId === patch.uploaded_by_id ? 'Edit Patch' : 'Fork Patch'}
          </button>
        )}
      </div>


      {patch && (
        <div className="mt-7">
          <h3>Version Tree</h3>
          <PatchLineageGraph patchId={patch.id} />
        </div>
      )}
    </div>
  );
};

export default PatchDetail;
