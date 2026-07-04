import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Tabs } from '../components/UI';
import { showToast, genId } from '../utils/helpers';
import { Icon } from '../components/UI';

export default function MasterData() {
  const { getDepts, getAuditors, getCheckpoints, writeSyncKey, currentUser } = useApp();
  const [tab, setTab] = useState('depts');
  const [editItem, setEditItem] = useState(null);

  const depts = getDepts();
  const auditors = getAuditors();
  const cps = getCheckpoints();

  const handleSave = () => {
    if (!editItem) return;
    const current = tab === 'depts' ? getDepts() : tab === 'auditors' ? getAuditors() : getCheckpoints();
    const storageKey = tab === 'depts' ? 'ap_depts' : tab === 'auditors' ? 'ap_auds' : 'ap_cps';

    let updated;
    if (editItem.id) {
      updated = current.map(item => item.id === editItem.id ? editItem : item);
    } else {
      updated = [...current, { ...editItem, id: genId(tab) }];
    }

    writeSyncKey(storageKey, updated, currentUser?.loginId);
    setEditItem(null);
    showToast('Record saved successfully');
  };

  const handleDelete = (id) => {
    const current = tab === 'depts' ? getDepts() : tab === 'auditors' ? getAuditors() : getCheckpoints();
    const storageKey = tab === 'depts' ? 'ap_depts' : tab === 'auditors' ? 'ap_auds' : 'ap_cps';
    const updated = current.filter(item => item.id !== id);
    writeSyncKey(storageKey, updated, currentUser?.loginId);
    showToast('Record deleted');
  };

  return (
    <div className="space-y-3">
      <Tabs
        tabs={[
          { id: 'depts', label: 'Departments' },
          { id: 'auditors', label: 'Auditors List' },
          { id: 'cps', label: 'Checkpoints' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="flex justify-between items-center">
        <span className="text-xs" style={{ color: 'var(--text3)' }}>Manage compliance master lists</span>
        <button
          className="btn btn-brand btn-sm"
          onClick={() => {
            if (tab === 'depts') setEditItem({ name: '', code: '' });
            else if (tab === 'auditors') setEditItem({ name: '', email: '' });
            else setEditItem({ text: '', dept: '', tip: '' });
          }}
        >
          <Icon name="plus" /> Add Entry
        </button>
      </div>

      <Card>
        {tab === 'depts' && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dept Name</th>
                  <th>Dept Code</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {depts.map(d => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td>{d.code}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(d)}><Icon name="pencil" /></button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(d.id)}><Icon name="trash-2" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'auditors' && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Auditor Name</th>
                  <th>Email</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {auditors.map(a => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{a.email}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(a)}><Icon name="pencil" /></button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(a.id)}><Icon name="trash-2" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'cps' && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Checkpoint Text</th>
                  <th>Dept</th>
                  <th>Audit Tip</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {cps.map(c => (
                  <tr key={c.id}>
                    <td className="max-w-[200px] truncate">{c.text}</td>
                    <td>{c.dept || 'All'}</td>
                    <td className="max-w-[150px] truncate">{c.tip}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(c)}><Icon name="pencil" /></button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(c.id)}><Icon name="trash-2" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Edit modal */}
      {editItem && (
        <div className="modal-bg" onClick={() => setEditItem(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{editItem.id ? 'Edit Entry' : 'Add Entry'}</span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(null)}><Icon name="x" /></button>
            </div>
            {tab === 'depts' && (
              <>
                <div className="mb-2">
                  <label className="form-label">Department Name</label>
                  <input value={editItem.name} onChange={e => setEditItem(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="mb-3">
                  <label className="form-label">Code</label>
                  <input value={editItem.code} onChange={e => setEditItem(p => ({ ...p, code: e.target.value }))} />
                </div>
              </>
            )}
            {tab === 'auditors' && (
              <>
                <div className="mb-2">
                  <label className="form-label">Auditor Name</label>
                  <input value={editItem.name} onChange={e => setEditItem(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="mb-3">
                  <label className="form-label">Email</label>
                  <input value={editItem.email} onChange={e => setEditItem(p => ({ ...p, email: e.target.value }))} />
                </div>
              </>
            )}
            {tab === 'cps' && (
              <>
                <div className="mb-2">
                  <label className="form-label">Checkpoint Text</label>
                  <textarea value={editItem.text} onChange={e => setEditItem(p => ({ ...p, text: e.target.value }))} style={{ height: 60, resize: 'none' }} />
                </div>
                <div className="mb-2">
                  <label className="form-label">Department Code (Leave empty for All)</label>
                  <input value={editItem.dept} onChange={e => setEditItem(p => ({ ...p, dept: e.target.value }))} />
                </div>
                <div className="mb-3">
                  <label className="form-label">QMS Checklist Tip</label>
                  <input value={editItem.tip} onChange={e => setEditItem(p => ({ ...p, tip: e.target.value }))} />
                </div>
              </>
            )}
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setEditItem(null)}>Cancel</button>
              <button className="btn btn-primary flex-1" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
