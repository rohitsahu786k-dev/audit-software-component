import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, Tabs, ConfirmModal, Icon } from '../components/UI';
import { ROLE_BADGE, ROLE_LABELS, showToast, genId, loadPermissions } from '../utils/helpers';
import { CAPA_DUE_DEFAULTS } from '../utils/auditEngine';
import { apiFetch } from '../utils/api';

const PAGE_LABELS = {
  dashboard: 'Executive Dashboard', analytics: 'Analytics & Insights', planning: 'Audit Planning',
  execution: 'Audit Execution', reports: 'Audit Reports', findings: 'Findings Register',
  capa: 'CAPA Tracker', learnings: 'Learnings Repository', media: 'Media Library',
  masterdata: 'Master Data Library', adminpanel: 'Admin Panel', mytasks: 'My Pending Tasks',
  managerpanel: 'Manager Console', mastertracker: 'Master Tracker', ocp: 'OCP Manual',
  importdata: 'Bulk Import',
};
const ROLE_ORDER = ['admin', 'auditor', 'spoc', 'manager', 'viewer'];
const SYSTEM_TOGGLES = [
  { key: 'emailNotifications', label: 'Email Notifications (in-app alerts to all roles when findings/CAPAs change)' },
  { key: 'autoEscalation', label: 'Auto-escalation Rules' },
  { key: 'requireEvidenceForNCs', label: 'Require Evidence for NCs' },
  { key: 'allowAuditorsDeleteFindings', label: 'Allow Auditors to Delete Findings' },
  { key: 'spocCommentRequiredForClosure', label: 'SPOC Comment Required for Closure' },
];

export default function AdminPanel() {
  const {
    getUsers, getDepts, getAuditors, getCheckpoints, getFindings, getLearnings,
    getMediaLibrary, getCompletedAudits, getImportLogs, getCapaDue, getSystemSettings,
    writeSyncKey, currentUser,
    perms, setPerms, setPageAction, navigate, addNotification,
  } = useApp();
  const [tab, setTab] = useState('users');
  const [editItem, setEditItem] = useState(null);
  const [pwModal, setPwModal] = useState(null);
  const [pwValue, setPwValue] = useState('');
  const [permsDraft, setPermsDraft] = useState(() => JSON.parse(JSON.stringify(perms)));
  const [dueDays, setDueDays] = useState(() => getCapaDue() || CAPA_DUE_DEFAULTS);
  const [settingsDraft, setSettingsDraft] = useState(() => getSystemSettings());
  const [confirmDeactivate, setConfirmDeactivate] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [resetModal, setResetModal] = useState(false);
  const [resetPw, setResetPw] = useState('');
  const [resetAck, setResetAck] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const users = getUsers();

  useEffect(() => {
    setPermsDraft(JSON.parse(JSON.stringify(perms)));
  }, [perms]);

  useEffect(() => {
    const due = getCapaDue();
    if (due) setDueDays(due);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCapaDue]);

  useEffect(() => {
    setSettingsDraft(getSystemSettings());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getSystemSettings]);

  useEffect(() => {
    setPageAction(() => () => { setTab('users'); setEditItem({ loginId: '', name: '', role: 'spoc', email: '', dept: '', password: '', active: true }); });
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (currentUser?.role !== 'admin') {
    return <div className="info-box"><Icon name="lock" /> Restricted to Master Admin.</div>;
  }

  // ── USERS ──────────────────────────────────────────
  const handleSave = () => {
    if (!editItem.loginId || !editItem.role) { showToast('Please fill all required fields'); return; }
    if (!editItem.id && !editItem.password) { showToast('Password required for new user'); return; }
    const current = getUsers();
    const conflict = current.find(u => u.loginId === editItem.loginId && u.id !== editItem.id);
    if (conflict) { showToast('Login ID already exists'); return; }
    const payload = { ...editItem };
    if (!payload.password) delete payload.password;
    const updated = editItem.id
      ? current.map(u => u.id === editItem.id ? { ...u, ...payload } : u)
      : [...current, { ...payload, id: genId('user'), active: true, createdAt: new Date().toISOString() }];

    writeSyncKey('ap_users', updated, currentUser?.loginId);
    setEditItem(null);
    showToast('User saved successfully');
  };

  const handleDelete = (id) => {
    if (id === currentUser.id) { showToast('Cannot delete currently logged-in admin user.'); return; }
    const updated = getUsers().filter(u => u.id !== id);
    writeSyncKey('ap_users', updated, currentUser?.loginId);
    setConfirmDelete(null);
    showToast('User account removed');
  };

  const toggleUserActive = (u) => {
    if (u.id === currentUser.id) { showToast('Cannot deactivate own account'); return; }
    const updated = getUsers().map(x => x.id === u.id ? { ...x, active: !x.active } : x);
    writeSyncKey('ap_users', updated, currentUser?.loginId);
    setConfirmDeactivate(null);
    showToast(`User ${u.name} ${u.active ? 'deactivated' : 'activated'}`);
  };

  const saveResetPassword = () => {
    if (!pwValue || pwValue.length < 6) { showToast('Password must be at least 6 characters'); return; }
    const updated = getUsers().map(u => u.id === pwModal.id ? { ...u, password: pwValue } : u);
    writeSyncKey('ap_users', updated, currentUser?.loginId);
    showToast(`Password reset for ${pwModal.name}`);
    setPwModal(null); setPwValue('');
  };

  // ── PERMISSIONS ────────────────────────────────────
  const togglePerm = (role, page, val) => {
    if (role === 'admin') return;
    setPermsDraft(prev => ({ ...prev, [role]: { ...(prev[role] || {}), [page]: val ? 1 : 0 } }));
  };
  const savePermissions = () => {
    writeSyncKey('ap_permissions', { roles: permsDraft }, currentUser?.loginId);
    setPerms(loadPermissions({ roles: permsDraft }));
    showToast('Permissions saved and synced');
  };

  // ── SYSTEM ─────────────────────────────────────────
  const saveDueDays = () => {
    writeSyncKey('ap_capa_due', dueDays, currentUser?.loginId);
    showToast('Due days saved');
  };

  const toggleSetting = (key) => {
    setSettingsDraft(prev => ({ ...prev, [key]: !prev[key] }));
  };
  const saveSystemSettings = () => {
    writeSyncKey('ap_system_settings', settingsDraft, currentUser?.loginId);
    showToast('Settings saved');
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify({
      users: getUsers(), depts: getDepts(), auditors: getAuditors(), checkpoints: getCheckpoints(),
      findings: getFindings(), learnings: getLearnings(), completedAudits: getCompletedAudits(),
      mediaLibrary: getMediaLibrary(), importLogs: getImportLogs(), at: new Date().toISOString(),
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'OnePWS_Backup_' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Full backup exported!');
  };

  const mergeTeamData = (evt) => {
    const file = evt.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        let merged = 0;
        if (Array.isArray(data.findings)) {
          const F = getFindings().slice();
          data.findings.forEach(f => { if (!F.find(x => x.ref === f.ref)) { F.push(f); merged++; } });
          writeSyncKey('ap_finds', F, currentUser?.loginId);
        }
        if (Array.isArray(data.learnings)) {
          const L = getLearnings().slice();
          data.learnings.forEach(l => { if (!L.find(x => x.id === l.id)) { L.unshift(l); merged++; } });
          writeSyncKey('ap_learns', L, currentUser?.loginId);
        }
        if (Array.isArray(data.checkpoints)) {
          const C = getCheckpoints().slice();
          data.checkpoints.forEach(cp => { if (!C.find(x => x.id === cp.id)) { C.push(cp); merged++; } });
          writeSyncKey('ap_cps', C, currentUser?.loginId);
        }
        if (Array.isArray(data.completedAudits)) {
          const CA = getCompletedAudits().slice();
          data.completedAudits.forEach(a => { if (!CA.find(x => x.id === a.id)) { CA.push(a); merged++; } });
          writeSyncKey('ap_completed_audits', CA, currentUser?.loginId);
        }
        showToast('Merged ' + merged + ' records from ' + file.name);
        addNotification('audit', 'Data Merged', merged + ' records merged from team export: ' + file.name, 'adminpanel', ['admin']);
      } catch (err) {
        showToast('Invalid file: ' + err.message);
      }
    };
    reader.readAsText(file);
    evt.target.value = '';
  };

  const runResetAll = async () => {
    if (!resetPw) { showToast('Password required'); return; }
    if (!resetAck) { showToast('Please confirm you understand this is permanent'); return; }
    setResetBusy(true);
    try {
      const data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ identity: currentUser.loginId, password: resetPw }) });
      if (!data.user || data.user.role !== 'admin') { showToast('Incorrect password. Reset denied.'); setResetBusy(false); return; }
      await apiFetch('/api/sync', { method: 'DELETE' });
      Object.keys(localStorage).filter(k => k.startsWith('ap_') || k.startsWith('imp_')).forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
      showToast('All data reset. Reloading...');
      setTimeout(() => { window.location.reload(); }, 1200);
    } catch (err) {
      showToast('Reset failed: ' + err.message);
      setResetBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="info-box"><Icon name="shield" /> <strong>Master Admin Panel</strong> — Full system control. Changes affect all users.</div>
      <Tabs
        tabs={[{ id: 'users', label: 'Users' }, { id: 'perms', label: 'Permissions' }, { id: 'sys', label: 'System' }]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'users' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs" style={{ color: 'var(--text3)' }}>QMS Portal User Management</span>
            <button className="btn btn-brand btn-sm" onClick={() => setEditItem({ loginId: '', name: '', role: 'spoc', email: '', dept: '', password: '', active: true })}>
              <Icon name="plus" /> Add User
            </button>
          </div>

          <Card>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Login ID</th><th>Name</th><th>Role</th><th>Dept</th><th>Email</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td className="font-bold">{u.loginId}</td>
                      <td>{u.name}</td>
                      <td><Badge type={ROLE_BADGE[u.role]}>{ROLE_LABELS[u.role] || u.role}</Badge></td>
                      <td>{u.dept || '—'}</td>
                      <td>{u.email}</td>
                      <td><Badge type={u.active !== false ? 'b-green' : 'b-gray'}>{u.active !== false ? 'Active' : 'Inactive'}</Badge></td>
                      <td>
                        <div className="flex gap-1">
                          <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => setEditItem(u)}><Icon name="pencil" /></button>
                          <button className="btn btn-primary btn-sm btn-icon" title="Reset Password" onClick={() => setPwModal({ id: u.id, name: u.name })}><Icon name="key" /></button>
                          <button className="btn btn-amber btn-sm" onClick={() => setConfirmDeactivate(u)}>{u.active !== false ? 'Deact' : 'Act'}</button>
                          {u.id !== currentUser?.id && (
                            <button className="btn btn-danger btn-sm btn-icon" onClick={() => setConfirmDelete(u)}><Icon name="trash-2" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'perms' && (
        <Card>
          <div className="card-heading"><span className="dot w-[7px] h-[7px] rounded-full bg-[var(--purple)] flex-shrink-0" />Role Permissions Matrix — Click checkboxes to modify</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Module</th>
                  {ROLE_ORDER.map(r => <th key={r} style={{ textAlign: 'center' }}><Badge type={ROLE_BADGE[r]}>{ROLE_LABELS[r]}</Badge></th>)}
                </tr>
              </thead>
              <tbody>
                {Object.keys(PAGE_LABELS).map(page => (
                  <tr key={page}>
                    <td className="font-bold">{PAGE_LABELS[page]}</td>
                    {ROLE_ORDER.map(role => (
                      <td key={role} style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          style={{ width: 'auto' }}
                          checked={!!(permsDraft[role] && permsDraft[role][page])}
                          disabled={role === 'admin'}
                          onChange={e => togglePerm(role, page, e.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-brand btn-sm mt-2" onClick={savePermissions}>Save Permissions</button>
        </Card>
      )}

      {tab === 'sys' && (
        <div className="space-y-3">
          <Card title="CAPA Target Due Days (by Severity)">
            <div className="grid grid-cols-4 gap-2 mb-3">
              {['critical', 'major', 'minor', 'obs'].map(k => (
                <div key={k}>
                  <label className="form-label" style={{ textTransform: 'capitalize' }}>{k === 'obs' ? 'Observation' : k}</label>
                  <input type="number" min={1} max={90} style={{ textAlign: 'center' }} value={dueDays[k]} onChange={e => setDueDays(p => ({ ...p, [k]: Number(e.target.value) || p[k] }))} />
                </div>
              ))}
            </div>
            <button className="btn btn-brand btn-sm" onClick={saveDueDays}>Save Due Day Settings</button>
          </Card>

          <Card title="System Settings">
            {SYSTEM_TOGGLES.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between py-2 border-b text-xs" style={{ borderColor: 'var(--bg3)' }}>
                <span>{label}</span>
                <label className="tgsw"><input type="checkbox" checked={!!settingsDraft[key]} onChange={() => toggleSetting(key)} /><span className="tgtr"></span></label>
              </div>
            ))}
            <button className="btn btn-brand btn-sm mt-3" onClick={saveSystemSettings}>Save Settings</button>
          </Card>

          <Card title="Danger Zone">
            <div className="flex gap-2 flex-wrap">
              <button className="btn btn-danger btn-sm" onClick={() => setResetModal(true)}><Icon name="refresh-cw" /> Reset All Data (Password Required)</button>
              <button className="btn btn-brand btn-sm" onClick={exportBackup}><Icon name="download" /> Export Full Backup (.json)</button>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('ocp')}><Icon name="book-open" /> View OCP Manual</button>
            </div>
          </Card>

          <Card title="Team Data Merge">
            <div className="info-box mb-2 text-xs">Team members can export their data using <strong>Export Full Backup</strong> and share the .json file. Master Admin can import and merge it here.</div>
            <button className="btn btn-primary btn-sm" onClick={() => document.getElementById('merge-file').click()}><Icon name="upload" /> Import &amp; Merge Team Data</button>
            <input type="file" id="merge-file" accept=".json" className="hidden" onChange={mergeTeamData} />
          </Card>
        </div>
      )}

      {/* Add/Edit user modal */}
      {editItem && (
        <div className="modal-bg" onClick={() => setEditItem(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{editItem.id ? 'Edit User' : 'Add User'}</span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(null)}><Icon name="x" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div><label className="form-label">Login ID *</label><input value={editItem.loginId} onChange={e => setEditItem(p => ({ ...p, loginId: e.target.value }))} disabled={!!editItem.id} /></div>
              <div><label className="form-label">Name</label><input value={editItem.name} onChange={e => setEditItem(p => ({ ...p, name: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="form-label">Role *</label>
                <select value={editItem.role} onChange={e => setEditItem(p => ({ ...p, role: e.target.value }))}>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div><label className="form-label">Dept</label><input value={editItem.dept} onChange={e => setEditItem(p => ({ ...p, dept: e.target.value }))} placeholder="E.g. DES, QA" /></div>
            </div>
            <div className="mb-2"><label className="form-label">Email *</label><input value={editItem.email} onChange={e => setEditItem(p => ({ ...p, email: e.target.value }))} placeholder="user@company.com" /></div>
            <div className="mb-3">
              <label className="form-label">{editItem.id ? 'Password (leave blank to keep current)' : 'Password *'}</label>
              <input type="password" value={editItem.password || ''} onChange={e => setEditItem(p => ({ ...p, password: e.target.value }))} placeholder="min 6 characters" />
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setEditItem(null)}>Cancel</button>
              <button className="btn btn-primary flex-1" onClick={handleSave}>Save User</button>
            </div>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {pwModal && (
        <div className="modal-bg" onClick={() => setPwModal(null)}>
          <div className="modal-box" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span>Reset Password — {pwModal.name}</span><button className="btn btn-ghost btn-sm btn-icon" onClick={() => setPwModal(null)}><Icon name="x" /></button></div>
            <div className="mb-3"><label className="form-label">New Password *</label><input type="password" value={pwValue} onChange={e => setPwValue(e.target.value)} placeholder="min 6 characters" /></div>
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setPwModal(null)}>Cancel</button>
              <button className="btn btn-primary flex-1" onClick={saveResetPassword}>Reset Password</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmDelete}
        message={`Delete ${confirmDelete?.name}? This cannot be undone.`}
        onConfirm={() => handleDelete(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />
      <ConfirmModal
        open={!!confirmDeactivate}
        message={`${confirmDeactivate?.active !== false ? 'Deactivate' : 'Activate'} ${confirmDeactivate?.name}?`}
        onConfirm={() => toggleUserActive(confirmDeactivate)}
        onCancel={() => setConfirmDeactivate(null)}
      />

      {/* Reset all data modal */}
      {resetModal && (
        <div className="modal-bg" onClick={() => !resetBusy && setResetModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span className="flex items-center gap-2" style={{ color: 'var(--red)' }}><Icon name="triangle-alert" /> Reset All Data</span><button className="btn btn-ghost btn-sm btn-icon" onClick={() => setResetModal(false)}><Icon name="x" /></button></div>
            <div className="warn-box mb-3 text-xs">This permanently deletes ALL data (users, findings, CAPA, learnings, audits) from the cloud database. Download a backup first using <strong>Export Full Backup</strong>. This action cannot be undone.</div>
            <div className="mb-2"><label className="form-label">Confirm your Master Admin password *</label><input type="password" value={resetPw} onChange={e => setResetPw(e.target.value)} /></div>
            <label className="flex items-center gap-2 text-xs mb-3" style={{ cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={resetAck} onChange={e => setResetAck(e.target.checked)} />
              I understand this permanently deletes all data and cannot be undone.
            </label>
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setResetModal(false)} disabled={resetBusy}>Cancel</button>
              <button className="btn btn-danger flex-1" onClick={runResetAll} disabled={resetBusy || !resetPw || !resetAck}>{resetBusy ? 'Resetting…' : 'Permanently Reset'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
