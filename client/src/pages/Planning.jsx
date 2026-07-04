import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, EmptyState, ConfirmModal } from '../components/UI';
import { fmtDate, showToast, genId, today } from '../utils/helpers';
import { Icon } from '../components/UI';

export default function Planning() {
  const { getPlannedAudits, getDepts, getAuditors, writeSyncKey, currentUser } = useApp();
  const [editItem, setEditItem] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const planned = getPlannedAudits();
  const depts = getDepts();
  const auditors = getAuditors();

  const saveEdit = () => {
    if (!editItem.dept || !editItem.auditor || !editItem.date) {
      showToast('Please fill all required fields');
      return;
    }
    const current = getPlannedAudits();
    const updated = editItem.id
      ? current.map(p => p.id === editItem.id ? { ...p, ...editItem, updatedAt: new Date().toISOString() } : p)
      : [...current, { ...editItem, id: genId('plan'), status: 'scheduled', createdAt: new Date().toISOString() }];

    writeSyncKey('ap_planned_audits', updated, currentUser?.loginId);
    setEditItem(null);
    showToast('Audit scheduled successfully');
  };

  const deletePlan = (id) => {
    const current = getPlannedAudits();
    const updated = current.filter(p => p.id !== id);
    writeSyncKey('ap_planned_audits', updated, currentUser?.loginId);
    setConfirmDelete(null);
    showToast('Scheduled audit canceled');
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-bold" style={{ color: 'var(--text2)' }}>Audit Schedule</h2>
        {(currentUser?.role === 'admin' || currentUser?.role === 'auditor') && (
          <button className="btn btn-brand btn-sm" onClick={() => setEditItem({ dept: '', auditor: '', date: today(), type: 'Full Internal Audit' })}>
            <Icon name="plus" /> Schedule Audit
          </button>
        )}
      </div>

      <Card>
        {planned.length === 0 ? (
          <EmptyState icon="calendar" title="No audits scheduled" subtitle="Click '+ Schedule Audit' to plan a new QMS audit." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dept</th>
                  <th>Auditor</th>
                  <th>Scheduled Date</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {planned.map(p => (
                  <tr key={p.id}>
                    <td className="font-bold">{p.dept}</td>
                    <td>{p.auditor}</td>
                    <td>{fmtDate(p.date)}</td>
                    <td>{p.type || 'Full Internal Audit'}</td>
                    <td>
                      <Badge type={p.date < today() ? 'b-red' : 'b-green'}>
                        {p.date < today() ? 'Overdue' : 'Scheduled'}
                      </Badge>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditItem({ ...p })}><Icon name="pencil" /></button>
                        {currentUser?.role === 'admin' && (
                          <button className="btn btn-danger btn-icon btn-sm" onClick={() => setConfirmDelete(p.id)}><Icon name="trash-2" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Edit Modal */}
      {editItem && (
        <div className="modal-bg" onClick={() => setEditItem(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{editItem.id ? 'Edit Scheduled Audit' : 'Schedule Audit'}</span>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditItem(null)}><Icon name="x" /></button>
            </div>
            <div className="mb-2">
              <label className="form-label">Department *</label>
              <select value={editItem.dept} onChange={e => setEditItem(p => ({ ...p, dept: e.target.value }))}>
                <option value="">Select Dept</option>
                {depts.map(d => <option key={d.id || d.code} value={d.code || d.name}>{d.name || d.code}</option>)}
              </select>
            </div>
            <div className="mb-2">
              <label className="form-label">Auditor *</label>
              <select value={editItem.auditor} onChange={e => setEditItem(p => ({ ...p, auditor: e.target.value }))}>
                <option value="">Select Auditor</option>
                {auditors.map(a => <option key={a.id || a.name} value={a.name}>{a.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="form-label">Date *</label>
                <input type="date" value={editItem.date} onChange={e => setEditItem(p => ({ ...p, date: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Audit Type</label>
                <select value={editItem.type || 'Full Internal Audit'} onChange={e => setEditItem(p => ({ ...p, type: e.target.value }))}>
                  <option>Full Internal Audit</option>
                  <option>Follow-up Audit</option>
                  <option>Supplier Audit</option>
                  <option>Process Audit</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setEditItem(null)}>Cancel</button>
              <button className="btn btn-primary flex-1" onClick={saveEdit}>Schedule</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmDelete}
        message="Cancel this scheduled audit?"
        onConfirm={() => deletePlan(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
