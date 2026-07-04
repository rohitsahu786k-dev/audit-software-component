import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, Tabs, Pagination, EmptyState, ConfirmModal } from '../components/UI';
import { fmtDate, SEV_BADGE, SEV_LABEL, STAT_BADGE, STAT_LABEL, showToast, genId, today } from '../utils/helpers';
import { Icon } from '../components/UI';

const PAGE_SIZE = 15;

export default function Findings({ dateFrom, dateTo }) {
  const { getFindings, getDepts, writeSyncKey, currentUser } = useApp();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [filterSev, setFilterSev] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editItem, setEditItem] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const findings = getFindings();
  const depts = getDepts();

  const filtered = useMemo(() => {
    let list = findings;
    if (tab === 'open')    list = list.filter(f => ['open','in-progress'].includes(String(f.status||'').toLowerCase()));
    if (tab === 'delayed') list = list.filter(f => String(f.status||'').toLowerCase() === 'delayed');
    if (tab === 'closed')  list = list.filter(f => String(f.status||'').toLowerCase() === 'closed');
    if (tab === 'pending') list = list.filter(f => String(f.status||'').toLowerCase() === 'pending-closure');
    if (filterSev)  list = list.filter(f => String(f.sev||f.severity||'').toLowerCase() === filterSev);
    if (filterDept) list = list.filter(f => String(f.dept||'').toLowerCase() === filterDept.toLowerCase());
    if (filterStatus) list = list.filter(f => String(f.status||'').toLowerCase() === filterStatus);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(f => (f.ref||'').toLowerCase().includes(q) || (f.desc||f.description||'').toLowerCase().includes(q) || (f.dept||'').toLowerCase().includes(q));
    }
    if (dateFrom) list = list.filter(f => (f.loggedAt||f.createdAt||'') >= dateFrom);
    if (dateTo)   list = list.filter(f => (f.loggedAt||f.createdAt||'') <= dateTo + 'T23:59:59');
    return list.slice().sort((a,b) => new Date(b.loggedAt||b.createdAt||0) - new Date(a.loggedAt||a.createdAt||0));
  }, [findings, tab, search, filterSev, filterDept, filterStatus, dateFrom, dateTo]);

  const paginated = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);

  const tabs = [
    { id:'all',     label:'All',              count: findings.length },
    { id:'open',    label:'Open',             count: findings.filter(f=>['open','in-progress'].includes(String(f.status||'').toLowerCase())).length },
    { id:'delayed', label:'Delayed',          count: findings.filter(f=>String(f.status||'').toLowerCase()==='delayed').length },
    { id:'pending', label:'Submit For Review', count: findings.filter(f=>String(f.status||'').toLowerCase()==='pending-closure').length },
    { id:'closed',  label:'Closed',           count: findings.filter(f=>String(f.status||'').toLowerCase()==='closed').length },
  ];

  const saveEdit = () => {
    if (!editItem) return;
    const current = getFindings();
    const updated = editItem.id
      ? current.map(f => f.id === editItem.id ? { ...f, ...editItem, updatedAt: new Date().toISOString(), updatedBy: currentUser?.loginId } : f)
      : [...current, { ...editItem, id: genId('find'), loggedAt: new Date().toISOString(), createdBy: currentUser?.loginId }];
    writeSyncKey('ap_finds', updated, currentUser?.loginId);
    setEditItem(null);
    showToast('Finding saved');
  };

  const deleteFinding = (id) => {
    const current = getFindings();
    const updated = current.map(f => f.id === id ? { ...f, deletedAt: new Date().toISOString(), deletedBy: currentUser?.loginId } : f);
    writeSyncKey('ap_finds', updated, currentUser?.loginId);
    setConfirmDelete(null);
    showToast('Finding deleted');
  };

  const exportCSV = () => {
    const rows = [['Ref','Description','Dept','Severity','Status','Due Date','Logged At']];
    filtered.forEach(f => rows.push([f.ref||f.id, (f.desc||f.description||'').replace(/,/g,' '), f.dept, f.sev||f.severity, f.status, f.dueDate||'', f.loggedAt||f.createdAt||'']));
    const csv = rows.map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `findings_${today()}.csv`;
    a.click();
  };

  return (
    <div className="space-y-3">
      <Tabs tabs={tabs} active={tab} onChange={t => { setTab(t); setPage(1); }} />
      <div className="flex flex-wrap gap-2 items-center">
        <input placeholder="Search findings..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ maxWidth: 200 }} />
        <select value={filterSev} onChange={e => { setFilterSev(e.target.value); setPage(1); }} style={{ maxWidth: 120 }}>
          <option value="">All Severity</option>
          {['critical','major','minor','obs'].map(s => <option key={s} value={s}>{SEV_LABEL[s]}</option>)}
        </select>
        <select value={filterDept} onChange={e => { setFilterDept(e.target.value); setPage(1); }} style={{ maxWidth: 120 }}>
          <option value="">All Depts</option>
          {depts.map(d => <option key={d.id||d.code} value={d.code||d.name}>{d.name||d.code}</option>)}
        </select>
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} style={{ maxWidth: 120 }}>
          <option value="">All Status</option>
          {Object.entries(STAT_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={exportCSV}><Icon name="download" /> CSV</button>
        {(currentUser?.role==='admin'||currentUser?.role==='auditor') && (
          <button className="btn btn-brand btn-sm ml-auto" onClick={() => setEditItem({ ref:'', dept:'', sev:'major', status:'open', desc:'' })}>
            <Icon name="plus" /> Add
          </button>
        )}
      </div>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState icon="search" title="No findings match filters" />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ref</th><th>Description</th><th>Dept</th><th>Severity</th><th>Status</th><th>Due Date</th><th>Date</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(f => (
                    <tr key={f.id}>
                      <td className="font-bold">{f.ref||f.id}</td>
                      <td className="max-w-[200px] truncate">{f.desc||f.description}</td>
                      <td><Badge type="b-blue">{f.dept}</Badge></td>
                      <td><Badge type={SEV_BADGE[f.sev||f.severity]||'b-gray'}>{SEV_LABEL[f.sev||f.severity]||f.sev}</Badge></td>
                      <td><Badge type={STAT_BADGE[f.status]||'b-gray'}>{STAT_LABEL[f.status]||f.status}</Badge></td>
                      <td style={{ color: f.dueDate && f.dueDate < today() ? 'var(--red)' : 'var(--text3)' }}>{fmtDate(f.dueDate)}</td>
                      <td>{fmtDate(f.loggedAt||f.createdAt)}</td>
                      <td>
                        <div className="flex gap-1">
                          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditItem({...f})}><Icon name="pencil" /></button>
                          {currentUser?.role==='admin' && (
                            <button className="btn btn-danger btn-icon btn-sm" onClick={() => setConfirmDelete(f.id)}><Icon name="trash-2" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination total={filtered.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
          </>
        )}
      </Card>

      {editItem && (
        <div className="modal-bg" onClick={() => setEditItem(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{editItem.id ? 'Edit Finding' : 'Add Finding'}</span>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditItem(null)}><Icon name="x" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div><label className="form-label">Finding No. *</label><input value={editItem.ref||''} onChange={e => setEditItem(p=>({...p,ref:e.target.value}))} /></div>
              <div><label className="form-label">Dept *</label>
                <select value={editItem.dept||''} onChange={e => setEditItem(p=>({...p,dept:e.target.value}))}>
                  <option value="">Select</option>
                  {depts.map(d => <option key={d.id||d.code} value={d.code||d.name}>{d.name||d.code}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div><label className="form-label">Severity *</label>
                <select value={editItem.sev||editItem.severity||'major'} onChange={e => setEditItem(p=>({...p,sev:e.target.value}))}>
                  {['critical','major','minor','obs'].map(s => <option key={s} value={s}>{SEV_LABEL[s]}</option>)}
                </select>
              </div>
              <div><label className="form-label">Status *</label>
                <select value={editItem.status||'open'} onChange={e => setEditItem(p=>({...p,status:e.target.value}))}>
                  {Object.entries(STAT_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div><label className="form-label">Clause</label><input value={editItem.clause||''} onChange={e => setEditItem(p=>({...p,clause:e.target.value}))} /></div>
              <div><label className="form-label">Due Date</label><input type="date" value={editItem.dueDate||''} onChange={e => setEditItem(p=>({...p,dueDate:e.target.value}))} /></div>
            </div>
            <div className="mb-2"><label className="form-label">Description *</label>
              <textarea value={editItem.desc||editItem.description||''} onChange={e => setEditItem(p=>({...p,desc:e.target.value}))} style={{ height:76, resize:'none' }} />
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setEditItem(null)}>Cancel</button>
              <button className="btn btn-primary flex-1" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmDelete}
        message="Delete this finding permanently?"
        onConfirm={() => deleteFinding(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
