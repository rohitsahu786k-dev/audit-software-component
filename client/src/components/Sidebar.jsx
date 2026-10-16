import React from 'react';
import { useApp } from '../context/AppContext';
import { Icon } from './UI';
import { ROLE_COLORS, ROLE_LABELS } from '../utils/helpers';

const NAV_CFG = [
  { sec: 'My Workspace', items: [
    { id: 'mytasks',      l: 'My Pending Tasks', ico: 'clipboard-list' },
    { id: 'managerpanel', l: 'Manager Console',  ico: 'briefcase-business' },
  ]},
  { sec: 'Overview', items: [
    { id: 'dashboard', l: 'Dashboard', ico: 'layout-dashboard' },
    { id: 'analytics', l: 'Analytics',  ico: 'trending-up' },
  ]},
  { sec: 'Audit', items: [
    { id: 'planning',   l: 'Planning',   ico: 'calendar-days' },
    { id: 'execution',  l: 'Execution',  ico: 'circle-check' },
    { id: 'reports',    l: 'Reports',    ico: 'file-text' },
  ]},
  { sec: 'Compliance', items: [
    { id: 'findings',      l: 'Findings',       ico: 'triangle-alert', badge: 'findings' },
    { id: 'capa',          l: 'CAPA Tracker',   ico: 'wrench',         badge: 'capa' },
    { id: 'learnings',     l: 'Learnings',      ico: 'lightbulb' },
    { id: 'media',         l: 'Media Library',  ico: 'folder-open' },
    { id: 'mastertracker', l: 'Master Tracker', ico: 'files' },
  ]},
  { sec: 'Master Data', items: [
    { id: 'masterdata', l: 'Master Library', ico: 'database' },
    { id: 'importdata', l: 'Bulk Import',    ico: 'upload' },
  ]},
  { sec: 'Admin', items: [
    { id: 'emailcenter', l: 'Email Center', ico: 'mail', adminOnly: true },
    { id: 'adminpanel',  l: 'Admin Panel',  ico: 'shield', adminOnly: true },
  ]},
  { sec: 'Help', items: [
    { id: 'ocp', l: 'OCP Manual', ico: 'book-open' },
  ]},
];

export default function Sidebar({ open, onClose }) {
  const { currentUser, currentPage, navigate, canAccess, getFindings } = useApp();

  const findings = getFindings();
  const openFindings = findings.filter(f => f && String(f.status || '').toLowerCase() !== 'closed').length;
  const pendingCapa = findings.filter(f => String(f.capaStatus||'').toLowerCase() === 'submitted' || String(f.status||'').toLowerCase() === 'pending-closure').length;

  const badgeCounts = { findings: openFindings, capa: pendingCapa };

  const go = (id) => { navigate(id); if (onClose) onClose(); };

  return (
    <>
      {/* Overlay (mobile) */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-[190]" onClick={onClose} />
      )}

      <aside className={`sidebar ${open ? 'open' : ''}`} id="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <img src="/assets/onepws-dark-logo-scaled.png" alt="OnePWS" />
        </div>

        {/* Nav */}
        <nav className="flex-1 py-[9px] px-[9px] overflow-y-auto" role="navigation" aria-label="Main navigation">
          {NAV_CFG.map(sec => {
            const visibleItems = sec.items.filter(item => {
              if (item.adminOnly && currentUser?.role !== 'admin') return false;
              return canAccess(item.id);
            });
            if (!visibleItems.length) return null;
            return (
              <div key={sec.sec}>
                <div className="nav-section-label">{sec.sec}</div>
                {visibleItems.map(item => {
                  const cnt = item.badge ? badgeCounts[item.badge] : 0;
                  return (
                    <div
                      key={item.id}
                      className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                      onClick={() => go(item.id)}
                    >
                      <span className="nav-ico">
                        <Icon name={item.ico} />
                      </span>
                      <span>{item.l}</span>
                      {cnt > 0 && (
                        <span className={`nav-badge ${item.badge === 'capa' ? 'bg-[var(--amber)]' : 'bg-[var(--red)]'}`}>
                          {cnt > 99 ? '99+' : cnt}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="user-chip" onClick={() => go('profile')}>
            <div
              className="user-avatar"
              style={{ background: ROLE_COLORS[currentUser?.role] || ROLE_COLORS.viewer }}
            >
              {(currentUser?.name || currentUser?.loginId || 'U').substring(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold truncate user-name">{currentUser?.name || currentUser?.loginId}</div>
              <div className="text-[9px] user-role">{ROLE_LABELS[currentUser?.role] || currentUser?.role}</div>
            </div>
            <span className="text-[9px] user-chevron"><Icon name="chevron-down" /></span>
          </div>
        </div>
      </aside>
    </>
  );
}
