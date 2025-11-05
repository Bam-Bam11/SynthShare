import React from 'react';
import bg from '../assets/background_new_mono.png';

export default function AppBackground() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        backgroundImage: `url(${bg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed'
      }}
    >
      {/* Optional readability overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(0,0,0,0.15), rgba(0,0,0,0.35))'
        }}
      />
    </div>
  );
}
