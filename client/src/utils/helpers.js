// ── LOCALSTORAGE HELPER ──────────────────────────────
export const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
  init(k, d) { if (localStorage.getItem(k) === null) LS.set(k, d); return LS.get(k); },
};

// ── SYNC KEYS ───────────────────────────────────────
export const SYNC_KEYS = [
  'ap_users','ap_depts','ap_auds','ap_cps','ap_finds','ap_learns',
  'ap_completed_audits','ap_planned_audits','ap_import_logs','ap_capa_due',
  'ap_secs','ap_notifs','ap_stds','ap_permissions','ap_email_master',
  'ap_email_templates','ap_email_logs','ap_required_cc_emails','ap_root_causes',
  'ap_media_library','ap_escalation_matrix','ap_audit_drafts','ap_local_storage_backup',
];

export const LOCAL_STORAGE_BACKUP_KEY = 'ap_local_storage_backup';
export const PENDING_SYNC_KEY = 'ap_pending_sync_queue';

// ── SANITIZE ─────────────────────────────────────────
export function sanitize(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

// ── DATES ────────────────────────────────────────────
export function parseAuditDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}
export function fmtDate(raw) {
  const d = parseAuditDate(raw);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateTime(raw) {
  const d = parseAuditDate(raw);
  if (!d) return '—';
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
export function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── FINDING UTILS ─────────────────────────────────────
export const SEV_BADGE = { critical:'b-red', major:'b-amber', minor:'b-teal', obs:'b-purple' };
export const SEV_LABEL = { critical:'Critical', major:'Major', minor:'Minor', obs:'Observation' };
export const STAT_BADGE = { open:'b-red', 'in-progress':'b-amber', delayed:'b-red', closed:'b-green', 'pending-closure':'b-purple' };
export const STAT_LABEL = { open:'Open', 'in-progress':'In Progress', delayed:'Delayed', closed:'Closed', 'pending-closure':'Submit For Review' };
export const ROLE_COLORS = { admin:'#7c3aed', auditor:'#2563eb', spoc:'#16a34a', manager:'#d97706', viewer:'#6b7280' };
export const ROLE_LABELS = { admin:'Master Admin', auditor:'Auditor', spoc:'Dept SPOC', manager:'Manager', viewer:'Mgmt Viewer' };
export const ROLE_BADGE  = { admin:'b-purple', auditor:'b-blue', spoc:'b-green', manager:'b-amber', viewer:'b-gray' };

export function findingWorkflowStatus(f) {
  if (!f) return '';
  const status = String(f.status || '').toLowerCase();
  const capa = String(f.capaStatus || '').toLowerCase();
  if (status === 'closed' || capa === 'closed') return 'closed';
  if (status === 'pending-closure' || capa === 'submitted') return 'pending-closure';
  return status || capa || 'open';
}

export function normalizeFindingsData(data) {
  if (!Array.isArray(data)) return { value: [], changed: !!data };
  const seen = new Set(); let changed = false;
  const value = data.map((raw, idx) => {
    const f = (raw && typeof raw === 'object') ? raw : {};
    const updates = {};
    const id = String(f.id || '').trim();
    if (!id || seen.has(id)) { updates.id = `find_${idx}_${Date.now()}`; changed = true; } else seen.add(id);
    if (!String(f.ref || '').trim()) { updates.ref = updates.id || id; changed = true; }
    if (!String(f.status || '').trim()) { updates.status = 'open'; changed = true; }
    if (!String(f.capaStatus || '').trim()) { updates.capaStatus = f.status || 'open'; changed = true; }
    if (!Array.isArray(f.activityLog)) { updates.activityLog = []; changed = true; }
    return Object.keys(updates).length ? Object.assign({}, f, updates) : f;
  });
  return { value, changed };
}

// ── PERMISSIONS ──────────────────────────────────────
export const DEFAULT_PERMS = {
  admin:   { ocp:1,dashboard:1,analytics:1,planning:1,execution:1,reports:1,findings:1,capa:1,learnings:1,media:1,masterdata:1,adminpanel:1,mytasks:1,managerpanel:1,mastertracker:1,importdata:1 },
  auditor: { ocp:1,dashboard:1,analytics:1,planning:1,execution:1,reports:1,findings:1,capa:1,learnings:1,media:1,masterdata:0,adminpanel:0,mytasks:1,managerpanel:1,mastertracker:1,importdata:1 },
  spoc:    { ocp:1,dashboard:1,analytics:1,planning:0,execution:0,reports:1,findings:1,capa:1,learnings:1,media:1,masterdata:0,adminpanel:0,mytasks:1,managerpanel:0,mastertracker:1,importdata:0 },
  manager: { ocp:1,dashboard:1,analytics:1,planning:0,execution:0,reports:1,findings:1,capa:1,learnings:1,media:1,masterdata:0,adminpanel:0,mytasks:1,managerpanel:1,mastertracker:1,importdata:0 },
  viewer:  { ocp:1,dashboard:1,analytics:1,planning:0,execution:0,reports:1,findings:1,capa:0,learnings:0,media:1,masterdata:0,adminpanel:0,mytasks:1,managerpanel:0,mastertracker:0,importdata:0 },
};
export function loadPermissions() {
  const saved = LS.get('ap_permissions', null);
  const roles = (saved && saved.roles) || saved || {};
  const base = JSON.parse(JSON.stringify(DEFAULT_PERMS));
  if (roles && typeof roles === 'object') {
    Object.keys(base).forEach(role => {
      if (!roles[role] || typeof roles[role] !== 'object') return;
      Object.keys(base[role]).forEach(page => {
        if (Object.prototype.hasOwnProperty.call(roles[role], page)) base[role][page] = roles[role][page] ? 1 : 0;
      });
    });
  }
  base.admin = Object.keys(base.admin).reduce((a, p) => { a[p] = 1; return a; }, {});
  return base;
}

// ── GENERATE ID ──────────────────────────────────────
export function genId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── MANAGER DEPT CODES ───────────────────────────────
export function managerDeptCodes(user) {
  if (!user) return [];
  if (Array.isArray(user.managedDepts)) return user.managedDepts;
  if (typeof user.managedDepts === 'string') return [user.managedDepts];
  return user.dept ? [user.dept] : [];
}

// ── AUDIT SCORE ──────────────────────────────────────
export function auditScore(findings = []) {
  let score = 100;
  findings.forEach(f => {
    const sev = String(f.sev || f.severity || 'obs').toLowerCase();
    if (sev.includes('critical')) score -= 15;
    else if (sev.includes('major')) score -= 10;
    else if (sev.includes('minor')) score -= 5;
    else score -= 2;
  });
  return Math.min(100, Math.max(0, Math.round(score)));
}

// ── TOAST HELPER (imperative) ─────────────────────────
let _toastTimer = null;
export function showToast(msg, ms = 3000) {
  const el = document.getElementById('app-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
