import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Icon, SyncIndicator } from './UI';
import { showToast } from '../utils/helpers';

const PAGE_META = {
  dashboard:    { title: 'Executive Dashboard',       sub: 'Integrated QMS Portal · AS9100D',           act: '+ New Audit' },
  analytics:    { title: 'Analytics & Insights',      sub: 'Real-time compliance intelligence',          act: 'Export PDF' },
  planning:     { title: 'Audit Planning',             sub: 'Annual schedule · 4 cycles/year',           act: '+ Schedule Audit' },
  execution:    { title: 'Audit Execution',            sub: 'Active audit session',                      act: 'Save Draft' },
  reports:      { title: 'Audit Reports',              sub: 'Department-wise PDF & Excel reports',       act: 'Generate Report' },
  findings:     { title: 'Findings Register',          sub: 'Non-conformances · AS9100D §10.2',          act: 'Export Findings' },
  capa:         { title: 'CAPA Tracker',               sub: 'Corrective & Preventive Actions',           act: 'Export CAPA' },
  learnings:    { title: 'Learnings Repository',       sub: 'AI-assisted knowledge base',                act: '+ Add Learning' },
  media:        { title: 'Media Library',              sub: 'Cloudinary documents and evidence',         act: 'Refresh' },
  masterdata:   { title: 'Master Data Library',        sub: 'Single source of truth',                   act: '+ Add Record' },
  adminpanel:   { title: 'Admin Panel',                sub: 'Master Admin Controls · Restricted',        act: '+ Add User' },
  mytasks:      { title: 'My Pending Tasks',           sub: 'Personalized task view',                   act: 'Refresh' },
  managerpanel: { title: 'Manager Console',            sub: 'Department NC review and escalation',       act: 'Send Summary' },
  mastertracker:{ title: 'Master Tracker',             sub: 'Central findings, CAPA & learnings',       act: 'Export All' },
  ocp:          { title: 'OCP Manual',                 sub: 'Viewer access only',                       act: 'View Manual' },
  importdata:   { title: 'Bulk Import',                sub: 'Import findings/checkpoints via Excel',     act: 'Import Excel' },
  profile:      { title: 'My Profile',                 sub: 'Account settings',                         act: '' },
};

export default function Topbar({ onMenuClick, onAction, dateFrom, dateTo, onDateFrom, onDateTo, onApplyDate, onClearDate }) {
  const { currentUser, currentPage, syncStatus, notifications, logout, navigate } = useApp();
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);
  const meta = PAGE_META[currentPage] || { title: currentPage, sub: '', act: '' };
  const unread = notifications.filter(n => !n.read).length;

  useEffect(() => {
    function handleClick(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const showDateBar = ['findings', 'capa', 'mastertracker', 'analytics', 'reports'].includes(currentPage);

  return (
    <div className="topbar">
      {/* Left */}
      <div className="flex items-center gap-[7px] min-w-0">
        <button className="btn btn-ghost btn-icon hamburger hidden" onClick={onMenuClick} title="Menu">
          <Icon name="menu" />
        </button>
        <div>
          <div className="topbar-title">{meta.title}</div>
          <div className="topbar-sub">{meta.sub}</div>
        </div>
      </div>

      {/* Date Range Bar */}
      {showDateBar && (
        <div className="flex items-center gap-2 text-[11px]" id="date-range-bar">
          <span style={{ color: 'var(--text3)' }}>From:</span>
          <input type="date" value={dateFrom} onChange={e => onDateFrom(e.target.value)} style={{ width: 110, padding: '4px 5px', fontSize: 10 }} />
          <span style={{ color: 'var(--text3)' }}>To:</span>
          <input type="date" value={dateTo} onChange={e => onDateTo(e.target.value)} style={{ width: 110, padding: '4px 5px', fontSize: 10 }} />
          <button className="btn btn-brand btn-sm" style={{ padding: '3px 8px', fontSize: 10 }} onClick={onApplyDate}>
            <Icon name="filter" /> Apply
          </button>
          <button className="btn btn-ghost btn-sm" style={{ padding: '3px 6px', fontSize: 10 }} onClick={onClearDate}>
            <Icon name="x" /> Clear
          </button>
        </div>
      )}

      {/* Right */}
      <div className="flex items-center gap-[6px] flex-shrink-0" ref={notifRef}>
        {/* Notifications */}
        <div className="notif-bell" onClick={() => setNotifOpen(p => !p)} title="Notifications">
          <Icon name="bell" />
          {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
        </div>

        {/* Notif Panel */}
        {notifOpen && (
          <div className="notif-panel" style={{ position: 'fixed', top: 52, right: 10 }}>
            <div className="flex items-center justify-between px-3 py-[10px] border-b" style={{ borderColor: 'var(--border)' }}>
              <span className="font-bold text-sm">Notifications</span>
              <div className="flex gap-2">
                <button className="btn btn-ghost btn-sm" onClick={() => setNotifOpen(false)}>Mark all read</button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setNotifOpen(false)}><Icon name="x" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="text-xs text-center py-6" style={{ color: 'var(--text3)' }}>No notifications</div>
              ) : notifications.slice(0, 50).map((n, i) => (
                <div key={n.id || i} className={`notif-item ${!n.read ? 'unread' : ''}`}>
                  <div className="text-[11px] font-bold">{n.title || n.type}</div>
                  <div className="text-[11px] mt-[1px]" style={{ color: 'var(--text2)' }}>{n.body}</div>
                  <div className="text-[10px] mt-[2px]" style={{ color: 'var(--text3)' }}>{n.ts || n.at}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button className="btn btn-ghost btn-sm" onClick={() => window.print()} title="Print">
          <Icon name="printer" />
        </button>
        {meta.act && (
          <button className="btn btn-brand btn-sm" onClick={onAction}>{meta.act}</button>
        )}
        <SyncIndicator status={syncStatus} />
        <button className="btn btn-ghost btn-sm" onClick={logout}>Logout</button>
      </div>
    </div>
  );
}
