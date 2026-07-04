import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { LS, SYNC_KEYS, normalizeFindingsData, loadPermissions, findingWorkflowStatus } from '../utils/helpers';
import { apiFetch, saveAuthToken, clearAuthState, hasUsableAuthToken } from '../utils/api';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

const AUDITPRO_CLIENT_VERSION = 'AuditPro-Web/2026-07-02-sync-guard-2';
const SYNC_POLL_INTERVAL_MS = 15 * 60 * 1000;
const SYNC_WRITE_DEBOUNCE_MS = 1200;

export function AppProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => LS.get('ap_cu', null));
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [apiReady, setApiReady] = useState(false);
  const [perms, setPerms] = useState(() => loadPermissions());

  // App state mirrors original APP object
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [notifications, setNotifications] = useState(() => LS.get('ap_notifs', []));
  const [pendingCount, setPendingCount] = useState(0);

  // Sync refs
  const syncPollTimer = useRef(null);
  const myWrites = useRef({});
  const syncRemoteMeta = useRef({});
  const syncWriteTimers = useRef({});
  const apiReadyRef = useRef(false);

  // ── LS getters (reactive) ──────────────────────────
  const getFindings = useCallback(() => {
    const r = normalizeFindingsData(LS.get('ap_finds', []));
    if (r.changed) LS.set('ap_finds', r.value);
    return r.value.filter(f => !isDeletedFinding(f));
  }, []);

  function isDeletedFinding(f) { return !!(f && f.deletedAt) || (f && String(f.status||'').toLowerCase()==='draft' && f.audit && f.session); }

  const getUsers = () => LS.get('ap_users', []);
  const getDepts = () => LS.get('ap_depts', []);
  const getAuditors = () => LS.get('ap_auds', []);
  const getCheckpoints = () => LS.get('ap_cps', []);
  const getLearnings = () => LS.get('ap_learns', []);
  const getEmailMaster = () => LS.get('ap_email_master', []);
  const getEmailTemplates = () => LS.get('ap_email_templates', []);
  const getEmailLogs = () => LS.get('ap_email_logs', []);
  const getRootCauses = () => LS.get('ap_root_causes', []);
  const getMediaLibrary = () => LS.get('ap_media_library', []);
  const getCompletedAudits = () => LS.get('ap_completed_audits', []);
  const getPlannedAudits = () => LS.get('ap_planned_audits', []);

  // ── LOGIN ──────────────────────────────────────────
  const login = useCallback(async (identity, password) => {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identity, password }),
    });
    saveAuthToken(data.token, data.expiresInMs);
    LS.set('ap_cu', data.user);
    setCurrentUser(data.user);
    setPerms(loadPermissions());
    return data.user;
  }, []);

  const logout = useCallback(() => {
    clearAuthState();
    setCurrentUser(null);
    setApiReady(false);
    apiReadyRef.current = false;
    setSyncStatus('connecting');
    if (syncPollTimer.current) clearTimeout(syncPollTimer.current);
  }, []);

  // ── SYNC ───────────────────────────────────────────
  const mergeFindingsForSync = (local, remote) => {
    if (!Array.isArray(remote)) return remote;
    if (!Array.isArray(local) || !local.length) return remote;
    const byKey = new Map();
    local.forEach(f => { const k = String(f.id || f.ref || '').trim(); if (k) byKey.set(k, f); });
    const seen = new Set();
    const merged = remote.map(f => { const k = String(f.id || f.ref || '').trim(); if (k) { seen.add(k); const loc = byKey.get(k); if (loc) { const lt = Date.parse(loc.updatedAt||''), rt = Date.parse(f.updatedAt||''); return rt >= lt ? f : loc; } } return f; });
    local.forEach(f => { const k = String(f.id || f.ref || '').trim(); if (k && !seen.has(k)) merged.push(f); });
    return merged;
  };

  const initSync = useCallback(async () => {
    if (!currentUser || !hasUsableAuthToken()) return;
    setSyncStatus('syncing');
    try {
      await apiFetch('/api/health');
      setApiReady(true);
      apiReadyRef.current = true;
      const payload = await apiFetch('/api/sync');
      const cloud = payload.data || {};
      let updated = false;
      SYNC_KEYS.forEach(k => {
        if (k === 'ap_local_storage_backup') return;
        if (cloud[k] && Object.prototype.hasOwnProperty.call(cloud[k], 'value')) {
          let remote = cloud[k].value;
          if (k === 'ap_finds') remote = mergeFindingsForSync(LS.get(k, null), remote);
          const local = LS.get(k, null);
          if (JSON.stringify(remote) !== JSON.stringify(local)) {
            localStorage.setItem(k, JSON.stringify(remote));
            updated = true;
          }
          syncRemoteMeta.current[k] = cloud[k].updatedAt || '';
        }
      });
      if (updated) {
        setNotifications(LS.get('ap_notifs', []));
        setPerms(loadPermissions());
      }
      setSyncStatus('synced');
      schedulePoll();
    } catch (err) {
      console.warn('Sync init failed:', err.message);
      setSyncStatus('offline');
    }
  }, [currentUser]);

  const pollSync = useCallback(async () => {
    if (!apiReadyRef.current || !hasUsableAuthToken()) return;
    try {
      const payload = await apiFetch('/api/sync?manifest=1');
      const manifest = payload.data || {};
      const changedKeys = Object.keys(manifest).filter(k =>
        SYNC_KEYS.includes(k) && k !== 'ap_local_storage_backup' &&
        String(manifest[k]?.updatedAt || '') !== String(syncRemoteMeta.current[k] || '')
      );
      if (changedKeys.length) {
        const rows = await Promise.all(changedKeys.map(k => apiFetch(`/api/sync/${encodeURIComponent(k)}`).then(r => ({ k, r }))));
        rows.forEach(({ k, r }) => {
          let remote = r.value;
          if (k === 'ap_finds') remote = mergeFindingsForSync(LS.get(k, null), remote);
          const local = LS.get(k, null);
          if (JSON.stringify(remote) !== JSON.stringify(local)) {
            localStorage.setItem(k, JSON.stringify(remote));
            if (k === 'ap_notifs') setNotifications(remote || []);
            if (k === 'ap_permissions') setPerms(loadPermissions());
          }
          syncRemoteMeta.current[k] = manifest[k]?.updatedAt || '';
        });
      }
      setSyncStatus('synced');
    } catch (err) {
      if (err.status === 401) { logout(); return; }
      setSyncStatus('offline');
    }
    schedulePoll();
  }, [logout]);

  const schedulePoll = useCallback(() => {
    if (syncPollTimer.current) clearTimeout(syncPollTimer.current);
    syncPollTimer.current = setTimeout(pollSync, SYNC_POLL_INTERVAL_MS);
  }, [pollSync]);

  // Write to MongoDB with debounce
  const writeSyncKey = useCallback((k, v, by) => {
    if (!apiReadyRef.current || !SYNC_KEYS.includes(k)) return;
    LS.set(k, v);
    clearTimeout(syncWriteTimers.current[k]);
    syncWriteTimers.current[k] = setTimeout(async () => {
      myWrites.current[k] = Date.now();
      try {
        await apiFetch(`/api/sync/${encodeURIComponent(k)}`, {
          method: 'PUT',
          body: JSON.stringify({ value: v, by: by || currentUser?.loginId || 'browser' }),
        });
        setSyncStatus('synced');
      } catch (err) {
        if (err.status === 401) logout();
        else setSyncStatus('error');
      }
    }, SYNC_WRITE_DEBOUNCE_MS);
  }, [currentUser, logout]);

  // Start sync on login
  useEffect(() => {
    if (currentUser && hasUsableAuthToken()) {
      initSync();
    }
    return () => {
      if (syncPollTimer.current) clearTimeout(syncPollTimer.current);
    };
  }, [currentUser?.id]);

  // Notification count
  useEffect(() => {
    const unread = notifications.filter(n => !n.read).length;
    setPendingCount(unread);
  }, [notifications]);

  const canAccess = (page) => {
    const role = currentUser?.role || 'viewer';
    return !!(perms[role] && perms[role][page]);
  };

  const navigate = (page) => setCurrentPage(page);

  const value = {
    currentUser, setCurrentUser, login, logout,
    syncStatus, apiReady,
    perms, setPerms,
    currentPage, navigate,
    notifications, setNotifications, pendingCount,
    writeSyncKey,
    canAccess,
    // Data getters
    getFindings, getUsers, getDepts, getAuditors, getCheckpoints,
    getLearnings, getEmailMaster, getEmailTemplates, getEmailLogs,
    getRootCauses, getMediaLibrary, getCompletedAudits, getPlannedAudits,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
