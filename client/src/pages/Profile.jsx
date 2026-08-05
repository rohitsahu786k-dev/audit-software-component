import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Card } from '../components/UI';
import { ROLE_LABELS, showToast } from '../utils/helpers';
import { apiFetch } from '../utils/api';

export default function Profile() {
  const { currentUser, setCurrentUser, getDepts } = useApp();
  const depts = getDepts();
  const [form, setForm] = useState({
    name: currentUser?.name || '',
    email: currentUser?.email || '',
    dept: currentUser?.dept || '',
    pw: '',
    pw2: '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const name = form.name.trim();
    const email = form.email.trim();
    if (!name) { showToast('Name required'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Valid email required'); return; }
    if ((form.pw || form.pw2) && form.pw !== form.pw2) { showToast('Passwords do not match'); return; }
    if (form.pw && form.pw.length < 6) { showToast('Password must be at least 6 characters'); return; }

    setSaving(true);
    const payload = { name, email, dept: form.dept };
    if (form.pw) payload.password = form.pw;
    try {
      const data = await apiFetch('/api/auth/profile', { method: 'PUT', body: JSON.stringify(payload) });
      setCurrentUser(data.user);
      setForm(p => ({ ...p, pw: '', pw2: '' }));
      showToast('Profile updated');
    } catch (err) {
      showToast('Update failed: ' + err.message);
    }
    setSaving(false);
  };

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

          <div className="grid grid-cols-2 gap-2">
            <div><label className="form-label">Name</label><input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><label className="form-label">Login ID</label><input value={currentUser?.loginId || ''} disabled /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="form-label">Role</label><input value={ROLE_LABELS[currentUser?.role] || currentUser?.role || ''} disabled /></div>
            <div>
              <label className="form-label">Department</label>
              <select value={form.dept} onChange={e => setForm(p => ({ ...p, dept: e.target.value }))}>
                <option value="">All</option>
                {depts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div><label className="form-label">Email</label><input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="form-label">New Password</label><input type="password" placeholder="Leave blank to keep old" value={form.pw} onChange={e => setForm(p => ({ ...p, pw: e.target.value }))} /></div>
            <div><label className="form-label">Confirm Password</label><input type="password" value={form.pw2} onChange={e => setForm(p => ({ ...p, pw2: e.target.value }))} /></div>
          </div>
          <button className="btn btn-brand w-full" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Profile'}</button>
        </div>
      </Card>
    </div>
  );
}
