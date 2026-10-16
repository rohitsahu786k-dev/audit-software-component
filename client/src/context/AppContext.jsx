import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { SYNC_KEYS, normalizeFindingsData, loadPermissions, genId } from '../utils/helpers';
import { mergeEmailRules } from '../utils/emailRules';
import { apiFetch } from '../utils/api';
import { signIn, signOut, fetchCurrentUser } from '../utils/authApi';
import { EMPTY_SESSION } from '../utils/auditEngine';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

const SYNC_POLL_INTERVAL_MS = 15 * 60 * 1000;
const SYNC_WRITE_DEBOUNCE_MS = 1200;

// Keys mirrored into in-memory state with a getXxx() accessor. Everything else in
// SYNC_KEYS (ap_notifs, ap_permissions, ...) has its own dedicated state below —
// nothing here is ever persisted to localStorage; a refresh re-fetches from MongoDB.
const DATA_KEYS = [
  'ap_finds', 'ap_users', 'ap_depts', 'ap_auds', 'ap_cps', 'ap_learns',
  'ap_email_master', 'ap_email_templates', 'ap_email_logs', 'ap_root_causes',
  'ap_media_library', 'ap_completed_audits', 'ap_planned_audits', 'ap_import_logs',
  'ap_audit_drafts', 'ap_required_cc_emails', 'ap_capa_due', 'ap_system_settings',
  'ap_email_rules',
];

const SYSTEM_SETTINGS_DEFAULTS = {
  emailNotifications: true,
  autoEscalation: true,
  requireEvidenceForNCs: true,
  allowAuditorsDeleteFindings: false,
  spocCommentRequiredForClosure: true,
};

function isDeletedFinding(f) { return !!(f && f.deletedAt) || (f && String(f.status || '').toLowerCase() === 'draft' && f.audit && f.session); }

export function AppProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [apiReady, setApiReady] = useState(false);
  const [perms, setPerms] = useState(() => loadPermissions());
  const [syncData, setSyncData] = useState({});

  // App state mirrors original APP object
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [notifications, setNotifications] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);

  // In-progress audit session — shared between Planning (starts it) and Execution
  // (fills it in). Pure in-memory; cross-device resume goes through ap_audit_drafts.
  const [activeAudit, setActiveAudit] = useState(null);
  const [auditSession, setAuditSession] = useState(EMPTY_SESSION);

  // Sync refs
  const syncPollTimer = useRef(null);
  const pollDeferred = useRef(false);
  const syncRemoteMeta = useRef({});
  const syncWriteTimers = useRef({});
  const apiReadyRef = useRef(false);

  const [findingsDeptFilter, setFindingsDeptFilter] = useState('');
  const [capaSelectedId, setCapaSelectedId] = useState('');
  const [pageAction, setPageAction] = useState(null);

  // ── In-memory data getters (reactive via syncData) ──
  // getFindings is memoized on the underlying array (not just recomputed on every call)
  // so it returns a stable reference across renders when ap_finds hasn't changed —
  // otherwise every consumer that puts its result in a useMemo/useEffect dependency
  // array would recompute (and refire) on every single render.
  const visibleFindings = useMemo(() => (syncData.ap_finds || []).filter(f => !isDeletedFinding(f)), [syncData.ap_finds]);
  const getFindings = useCallback(() => visibleFindings, [visibleFindings]);
  const usersData = useMemo(() => syncData.ap_users || [], [syncData.ap_users]);
  const getUsers = useCallback(() => usersData, [usersData]);
  const deptsData = useMemo(() => syncData.ap_depts || [], [syncData.ap_depts]);
  const getDepts = useCallback(() => deptsData, [deptsData]);
  const auditorsData = useMemo(() => syncData.ap_auds || [], [syncData.ap_auds]);
  const getAuditors = useCallback(() => auditorsData, [auditorsData]);
  const checkpointsData = useMemo(() => syncData.ap_cps || [], [syncData.ap_cps]);
  const getCheckpoints = useCallback(() => checkpointsData, [checkpointsData]);
  const learningsData = useMemo(() => syncData.ap_learns || [], [syncData.ap_learns]);
  const getLearnings = useCallback(() => learningsData, [learningsData]);
  const emailMasterData = useMemo(() => syncData.ap_email_master || [], [syncData.ap_email_master]);
  const getEmailMaster = useCallback(() => emailMasterData, [emailMasterData]);
  const emailTemplatesData = useMemo(() => syncData.ap_email_templates || [], [syncData.ap_email_templates]);
  const getEmailTemplates = useCallback(() => emailTemplatesData, [emailTemplatesData]);
  const emailLogsData = useMemo(() => syncData.ap_email_logs || [], [syncData.ap_email_logs]);
  const getEmailLogs = useCallback(() => emailLogsData, [emailLogsData]);
  const rootCausesData = useMemo(() => syncData.ap_root_causes || [], [syncData.ap_root_causes]);
  const getRootCauses = useCallback(() => rootCausesData, [rootCausesData]);
  const mediaLibraryData = useMemo(() => syncData.ap_media_library || [], [syncData.ap_media_library]);
  const getMediaLibrary = useCallback(() => mediaLibraryData, [mediaLibraryData]);
  const completedAuditsData = useMemo(() => (syncData.ap_completed_audits || []).filter(a => a && !a.deletedAt), [syncData.ap_completed_audits]);
  const getCompletedAudits = useCallback(() => completedAuditsData, [completedAuditsData]);
  const plannedAuditsData = useMemo(() => syncData.ap_planned_audits || [], [syncData.ap_planned_audits]);
  const getPlannedAudits = useCallback(() => plannedAuditsData, [plannedAuditsData]);
  const importLogsData = useMemo(() => syncData.ap_import_logs || [], [syncData.ap_import_logs]);
  const getImportLogs = useCallback(() => importLogsData, [importLogsData]);
  const auditDraftsData = useMemo(() => syncData.ap_audit_drafts || [], [syncData.ap_audit_drafts]);
  const getAuditDrafts = useCallback(() => auditDraftsData, [auditDraftsData]);
  const requiredCcEmailsData = useMemo(() => syncData.ap_required_cc_emails || [], [syncData.ap_required_cc_emails]);
  const getRequiredCcEmails = useCallback(() => requiredCcEmailsData, [requiredCcEmailsData]);
  const capaDueData = useMemo(() => syncData.ap_capa_due || null, [syncData.ap_capa_due]);
  const getCapaDue = useCallback(() => capaDueData, [capaDueData]);
  const systemSettingsData = useMemo(
    () => ({ ...SYSTEM_SETTINGS_DEFAULTS, ...(syncData.ap_system_settings || {}) }),
    [syncData.ap_system_settings]
  );
  const getSystemSettings = useCallback(() => systemSettingsData, [systemSettingsData]);
  const emailRulesData = useMemo(() => mergeEmailRules(syncData.ap_email_rules), [syncData.ap_email_rules]);
  const getEmailRules = useCallback(() => emailRulesData, [emailRulesData]);

  const applyIncoming = (key, value) => (key === 'ap_finds' ? normalizeFindingsData(value).value : value);

  // ── LOGIN ──────────────────────────────────────────
  const login = useCallback(async (identity, password) => {
    const user = await signIn(identity, password);
    setCurrentUser(user);
    // perms stay at their current (default) value until initSync fetches the real
    // ap_permissions from the server — do not overwrite with loadPermissions() here,
    // it requires the saved value as an argument and returns bare defaults without it.
    return user;
  }, []);

  const logout = useCallback(() => {
    signOut();
    setCurrentUser(null);
    setApiReady(false);
    apiReadyRef.current = false;
    setSyncStatus('connecting');
    setSyncData({});
    setNotifications([]);
    setFindingsDeptFilter('');
    setCapaSelectedId('');
    setActiveAudit(null);
    setAuditSession(EMPTY_SESSION);
    if (syncPollTimer.current) clearTimeout(syncPollTimer.current);
  }, []);

  // Resume an existing session cookie on page load (one /me request, no token handling).
  useEffect(() => {
    (async () => {
      try { setCurrentUser(await fetchCurrentUser()); } catch { /* network error: show login */ }
      setAuthChecked(true);
    })();
  }, []);

  // ── SYNC ───────────────────────────────────────────
  const mergeFindingsForSync = (local, remote) => {
    if (!Array.isArray(remote)) return remote;
    if (!Array.isArray(local) || !local.length) return remote;
    const byKey = new Map();
    local.forEach(f => { const k = String(f.id || f.ref || '').trim(); if (k) byKey.set(k, f); });
    const seen = new Set();
    const merged = remote.map(f => { const k = String(f.id || f.ref || '').trim(); if (k) { seen.add(k); const loc = byKey.get(k); if (loc) { const lt = Date.parse(loc.updatedAt || ''), rt = Date.parse(f.updatedAt || ''); return rt >= lt ? f : loc; } } return f; });
    local.forEach(f => { const k = String(f.id || f.ref || '').trim(); if (k && !seen.has(k)) merged.push(f); });
    return merged;
  };

  const initSync = useCallback(async () => {
    if (!currentUser) return;
    setSyncStatus('syncing');
    try {
      setApiReady(true);
      apiReadyRef.current = true;
      const payload = await apiFetch('/api/sync');
      const cloud = payload.data || {};
      const next = {};
      DATA_KEYS.forEach(k => {
        if (cloud[k] && Object.prototype.hasOwnProperty.call(cloud[k], 'value')) {
          next[k] = applyIncoming(k, cloud[k].value);
          syncRemoteMeta.current[k] = cloud[k].updatedAt || '';
        }
      });
      setSyncData(next);
      if (cloud.ap_notifs && cloud.ap_notifs.value) {
        setNotifications(cloud.ap_notifs.value);
        syncRemoteMeta.current.ap_notifs = cloud.ap_notifs.updatedAt || '';
      }
      if (cloud.ap_permissions && cloud.ap_permissions.value !== undefined) {
        setPerms(loadPermissions(cloud.ap_permissions.value));
        syncRemoteMeta.current.ap_permissions = cloud.ap_permissions.updatedAt || '';
      }
      setSyncStatus('synced');
      schedulePoll();
    } catch (err) {
      console.warn('Sync init failed:', err.message);
      setSyncStatus('offline');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const pollSync = useCallback(async () => {
    if (!apiReadyRef.current) return;
    // A hidden tab has nobody to show changes to; skip the request and catch up when it is shown again.
    if (document.hidden) { pollDeferred.current = true; return; }
    try {
      const payload = await apiFetch('/api/sync?manifest=1');
      const manifest = payload.data || {};
      const changedKeys = Object.keys(manifest).filter(k =>
        SYNC_KEYS.includes(k) && k !== 'ap_local_storage_backup' &&
        String(manifest[k]?.updatedAt || '') !== String(syncRemoteMeta.current[k] || '')
      );
      if (changedKeys.length) {
        const rows = await Promise.all(changedKeys.map(k => apiFetch(`/api/sync/${encodeURIComponent(k)}`).then(r => ({ k, r }))));
        setSyncData(prev => {
          const next = { ...prev };
          rows.forEach(({ k, r }) => {
            if (k === 'ap_notifs') { setNotifications(r.value || []); }
            else if (k === 'ap_permissions') { setPerms(loadPermissions(r.value)); }
            else if (DATA_KEYS.includes(k)) {
              let val = r.value;
              if (k === 'ap_finds') val = mergeFindingsForSync(prev.ap_finds, val);
              next[k] = applyIncoming(k, val);
            }
            syncRemoteMeta.current[k] = manifest[k]?.updatedAt || '';
          });
          return next;
        });
      }
      setSyncStatus('synced');
    } catch (err) {
      if (err.status === 401) { logout(); return; }
      setSyncStatus('offline');
    }
    schedulePoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logout]);

  const schedulePoll = useCallback(() => {
    if (syncPollTimer.current) clearTimeout(syncPollTimer.current);
    syncPollTimer.current = setTimeout(pollSync, SYNC_POLL_INTERVAL_MS);
  }, [pollSync]);

  // Write to MongoDB with debounce — optimistic in-memory update, no localStorage
  const writeSyncKey = useCallback((k, v, by) => {
    if (!apiReadyRef.current || !SYNC_KEYS.includes(k)) return;
    if (DATA_KEYS.includes(k)) setSyncData(prev => ({ ...prev, [k]: applyIncoming(k, v) }));
    clearTimeout(syncWriteTimers.current[k]);
    syncWriteTimers.current[k] = setTimeout(async () => {
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

  // Multi-key imports must reach MongoDB as one request so findings, completed-audit
  // snapshots and the import log cannot drift apart after a partial browser write.
  const writeSyncBulk = useCallback(async (items, by) => {
    const validItems = Object.fromEntries(Object.entries(items || {}).filter(([key]) => SYNC_KEYS.includes(key)));
    if (!apiReadyRef.current || !Object.keys(validItems).length) throw new Error('Database sync is not ready');
    setSyncData(prev => {
      const next = { ...prev };
      Object.entries(validItems).forEach(([key, value]) => {
        if (DATA_KEYS.includes(key)) next[key] = applyIncoming(key, value);
      });
      return next;
    });
    try {
      await apiFetch('/api/sync/bulk', {
        method: 'POST',
        body: JSON.stringify({ items: validItems, by: by || currentUser?.loginId || 'browser' }),
      });
      setSyncStatus('synced');
    } catch (err) {
      setSyncStatus(err.status === 401 ? 'offline' : 'error');
      if (err.status === 401) logout();
      throw err;
    }
  }, [currentUser, logout]);

  const addNotification = useCallback((type, title, body, link, roles) => {
    if (systemSettingsData.emailNotifications === false) return;
    setNotifications(prev => {
      const n = { id: genId('notif'), type, title, body, link: link || '', roles: roles || null, read: false, ts: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) };
      const list = [n, ...prev].slice(0, 200);
      writeSyncKey('ap_notifs', list);
      return list;
    });
  }, [writeSyncKey, systemSettingsData]);

  // Start sync once login is confirmed
  useEffect(() => {
    if (currentUser) {
      initSync();
    }
    return () => {
      if (syncPollTimer.current) clearTimeout(syncPollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // Resume polling when a tab that skipped its poll while hidden becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden || !pollDeferred.current) return;
      pollDeferred.current = false;
      pollSync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [pollSync]);

  // Notification count
  useEffect(() => {
    const unread = notifications.filter(n => !n.read).length;
    setPendingCount(unread);
  }, [notifications]);

  const canAccess = useCallback((page) => {
    const role = currentUser?.role || 'viewer';
    return !!(perms[role] && perms[role][page]);
  }, [currentUser, perms]);

  const navigate = useCallback((page) => setCurrentPage(page), []);

  const value = useMemo(() => ({
    currentUser, setCurrentUser, login, logout, authChecked,
    syncStatus, apiReady,
    perms, setPerms,
    currentPage, navigate,
    notifications, setNotifications, pendingCount, addNotification,
    writeSyncKey, writeSyncBulk,
    canAccess,
    findingsDeptFilter, setFindingsDeptFilter,
    capaSelectedId, setCapaSelectedId,
    pageAction, setPageAction,
    activeAudit, setActiveAudit, auditSession, setAuditSession,
    // Data getters
    getFindings, getUsers, getDepts, getAuditors, getCheckpoints,
    getLearnings, getEmailMaster, getEmailTemplates, getEmailLogs,
    getRootCauses, getMediaLibrary, getCompletedAudits, getPlannedAudits,
    getImportLogs, getAuditDrafts, getRequiredCcEmails, getCapaDue, getSystemSettings, getEmailRules,
    refreshSync: pollSync,
  }), [
    currentUser, login, logout, authChecked,
    syncStatus, apiReady,
    perms,
    currentPage, navigate,
    notifications, pendingCount, addNotification,
    writeSyncKey, writeSyncBulk,
    canAccess,
    findingsDeptFilter,
    capaSelectedId,
    pageAction,
    activeAudit, auditSession,
    getFindings, getUsers, getDepts, getAuditors, getCheckpoints,
    getLearnings, getEmailMaster, getEmailTemplates, getEmailLogs,
    getRootCauses, getMediaLibrary, getCompletedAudits, getPlannedAudits,
    getImportLogs, getAuditDrafts, getRequiredCcEmails, getCapaDue, getSystemSettings, getEmailRules,
    pollSync,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
