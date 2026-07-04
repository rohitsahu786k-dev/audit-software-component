import React, { useEffect } from 'react';

// Lucide icon wrapper — uses the globally loaded lucide library
export function Icon({ name, className = '' }) {
  useEffect(() => {
    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons();
    }
  });
  return (
    <i data-lucide={name} className={`ico-svg ${className}`} aria-hidden="true" />
  );
}

export function Badge({ type, children }) {
  return <span className={`badge ${type || 'b-gray'}`}>{children}</span>;
}

export function Spinner({ size = 'sm' }) {
  const s = size === 'sm' ? 'w-4 h-4' : 'w-8 h-8';
  return (
    <div className={`${s} border-2 border-[var(--border2)] border-t-[var(--brand)] rounded-full animate-spin`} />
  );
}

export function EmptyState({ icon = 'inbox', title = 'No data', subtitle = '' }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon name={icon} className="w-10 h-10 mb-3 opacity-30" />
      <div className="text-sm font-bold" style={{ color: 'var(--text2)' }}>{title}</div>
      {subtitle && <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>{subtitle}</div>}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs-bar">
      {tabs.map(t => (
        <div
          key={t.id}
          className={`tab-item ${active === t.id ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count != null && (
            <span className="ml-1 text-[9px] font-extrabold px-1 rounded-full" style={{ background: 'var(--bg3)', color: 'var(--text3)' }}>
              {t.count}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function StatCard({ label, value, delta, color, icon }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: color || 'var(--text)' }}>{value ?? '—'}</div>
      {delta && <div className="stat-delta">{delta}</div>}
    </div>
  );
}

export function Card({ title, children, action }) {
  return (
    <div className="card">
      {title && (
        <div className="card-heading">
          <span className="dot w-[7px] h-[7px] rounded-full bg-[var(--brand)] flex-shrink-0" />
          {title}
          {action && <div className="ml-auto">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function ProgressBar({ value, color }) {
  return (
    <div className="progress-bar">
      <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, value || 0))}%`, background: color || 'var(--brand)' }} />
    </div>
  );
}

export function Pagination({ total, page, pageSize, onChange }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  const pages = [];
  for (let p = start; p <= end; p++) pages.push(p);
  return (
    <div className="flex items-center justify-center gap-[5px] mt-3 py-2">
      <button className="btn btn-ghost btn-sm" onClick={() => onChange(page - 1)} disabled={page <= 1}>‹ Prev</button>
      {start > 1 && <span className="text-[10px]" style={{ color: 'var(--text3)' }}>1…</span>}
      {pages.map(p => (
        <button key={p} className={`btn btn-sm ${p === page ? 'btn-brand' : 'btn-ghost'}`} style={{ minWidth: 28 }} onClick={() => onChange(p)}>{p}</button>
      ))}
      {end < totalPages && <span className="text-[10px]" style={{ color: 'var(--text3)' }}>…{totalPages}</span>}
      <button className="btn btn-ghost btn-sm" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>Next ›</button>
      <span className="text-[10px] ml-2" style={{ color: 'var(--text3)' }}>Page {page} of {totalPages}</span>
    </div>
  );
}

export function ConfirmModal({ open, message, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal-box" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">⚠️ Confirm</div>
        <div className="text-sm mb-4" style={{ color: 'var(--text2)' }}>{message}</div>
        <div className="flex gap-2">
          <button className="btn btn-ghost flex-1" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger flex-1" onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  return <div className="toast" id="app-toast" />;
}

export function SyncIndicator({ status }) {
  const map = {
    synced:     ['● MongoDB Synced', '#16a34a'],
    connecting: ['◌ Connecting...', '#d97706'],
    error:      ['⚠ Sync Error', '#dc2626'],
    syncing:    ['↻ Syncing...', '#2563eb'],
    offline:    ['○ Offline', '#6b7280'],
  };
  const [text, color] = map[status] || map.offline;
  return (
    <span className="sync-indicator" style={{ color }}>{text}</span>
  );
}
