import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge } from '../components/UI';
import { ROLE_BADGE, ROLE_LABELS, showToast, genId } from '../utils/helpers';
import { Icon } from '../components/UI';

export default function AdminPanel() {
  const { getUsers, writeSyncKey, currentUser } = useApp();
  const [editItem, setEditItem] = useState(null);
  const users = getUsers();

  const handleSave = () => {
    if (!editItem.loginId || !editItem.role) {
      showToast('Please fill all required fields');
      return;
    }
    const current = getUsers();
    const updated = editItem.id
      ? current.map(u => u.id === editItem.id ? editItem : u)
      : [...current, { ...editItem, id: genId('user'), createdAt: new Date().toISOString() }];

    writeSyncKey('ap_users', updated, currentUser?.loginId);
    setEditItem(null);
    showToast('User saved successfully');
  };

  const handleDelete = (id) => {
    if (id === currentUser.id) {
      showToast('Cannot delete currently logged-in admin user.');
      return;
    }
    const current = getUsers();
    const updated = current.filter(u => u.id !== id);
    writeSyncKey('ap_users', updated, currentUser?.loginId);
    showToast('User account removed');
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-xs" style={{ color: 'var(--text3)' }}>QMS Portal User Management</span>
        <button
          className="btn btn-brand btn-sm"
          onClick={() => setEditItem({ loginId: '', name: '', role: 'spoc', email: '', dept: '' })}
        >
          <Icon name="plus" /> Add User
        </button>
      </div>

      <Card>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Login ID</th>
                <th>Name</th>
                <th>Role</th>
                <th>Dept</th>
                <th>Email</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td className="font-bold">{u.loginId}</td>
                  <td>{u.name}</td>
                  <td>
                    <Badge type={ROLE_BADGE[u.role]}>{ROLE_LABELS[u.role] || u.role}</Badge>
                  </td>
                  <td>{u.dept || '—'}</td>
                  <td>{u.email}</td>
                  <td>
                    <div className="flex gap-1">
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(u)}><Icon name="pencil" /></button>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(u.id)}><Icon name="trash-2" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editItem && (
        <div className="modal-bg" onClick={() => setEditItem(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{editItem.id ? 'Edit User' : 'Add User'}</span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(null)}><Icon name="x" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="form-label">Login ID *</label>
                <input value={editItem.loginId} onChange={e => setEditItem(p => ({ ...p, loginId: e.target.value }))} disabled={!!editItem.id} />
              </div>
              <div>
                <label className="form-label">Name</label>
                <input value={editItem.name} onChange={e => setEditItem(p => ({ ...p, name: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="form-label">Role *</label>
                <select value={editItem.role} onChange={e => setEditItem(p => ({ ...p, role: e.target.value }))}>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Dept</label>
                <input value={editItem.dept} onChange={e => setEditItem(p => ({ ...p, dept: e.target.value }))} placeholder="E.g. DES, QA" />
              </div>
            </div>
            <div className="mb-3">
              <label className="form-label">Email *</label>
              <input value={editItem.email} onChange={e => setEditItem(p => ({ ...p, email: e.target.value }))} placeholder="user@company.com" />
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setEditItem(null)}>Cancel</button>
              <button className="btn btn-primary flex-1" onClick={handleSave}>Save User</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
