import React from 'react';
import { useApp } from '../context/AppContext';
import { Card } from '../components/UI';
import { ROLE_LABELS } from '../utils/helpers';

export default function Profile() {
  const { currentUser } = useApp();

  return (
    <div className="max-w-md space-y-3">
      <Card title="Account Profile">
        <div className="space-y-3">
          <div className="flex items-center gap-3 pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-lg"
              style={{ background: currentUser?.role === 'admin' ? '#7c3aed' : currentUser?.role === 'auditor' ? '#2563eb' : '#16a34a' }}
            >
              {(currentUser?.name || currentUser?.loginId || 'U').substring(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-bold">{currentUser?.name || currentUser?.loginId}</div>
              <div className="text-xs" style={{ color: 'var(--text3)' }}>{ROLE_LABELS[currentUser?.role] || currentUser?.role}</div>
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span style={{ color: 'var(--text3)' }}>Login ID:</span>
              <span className="font-bold">{currentUser?.loginId}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text3)' }}>Email:</span>
              <span className="font-bold">{currentUser?.email || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text3)' }}>Assigned Department:</span>
              <span className="font-bold">{currentUser?.dept || 'All'}</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
