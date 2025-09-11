// src/pages/BuildComposePage.jsx
import React, { useEffect, useState } from 'react';
import SynthInterface from '../components/SynthInterface';
import ComposePanel from './ComposePanel';

const TAB_KEY = 'buildcompose_active_tab';
const normalise = v => (v === 'patch' || v === 'track') ? v : 'patch';

export default function BuildComposePage() {
  const [activeTab, setActiveTab] = useState(() => normalise(localStorage.getItem(TAB_KEY)));
  useEffect(() => {
    console.log('BuildComposePage mounted, activeTab =', activeTab);
    localStorage.setItem(TAB_KEY, activeTab);
  }, [activeTab]);

  return (
    <div style={{ padding: 20 }}>
      <h2>Build & Compose</h2>

      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <button
          onClick={() => setActiveTab('patch')}
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid #aaa',
            background: activeTab === 'patch' ? '#e9f3ff' : '#fff'
          }}
        >
          Patch
        </button>
        <button
          onClick={() => setActiveTab('track')}
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid #aaa',
            background: activeTab === 'track' ? '#e9f3ff' : '#fff'
          }}
        >
          Track
        </button>
      </div>

      {/* Keep both mounted so state persists */}
      <section role="tabpanel" hidden={activeTab !== 'patch'}>
        <SynthInterface hideNameAndDescription={false} />
      </section>
      <section role="tabpanel" hidden={activeTab !== 'track'}>
        <ComposePanel />
      </section>
    </div>
  );
}
