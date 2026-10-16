import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, Pagination, ConfirmModal, Icon } from '../components/UI';
import { SEV_BADGE, SEV_LABEL, STAT_BADGE, STAT_LABEL, showToast, today } from '../utils/helpers';
import { managerDeptCodes, filterFindingsByDateRange, normalizeAuditSeverity, findingMatchesDeptCode, deptCodeInList } from '../utils/dashboardHelpers';

const PAGE_SIZE = 15;

export default function Findings({ dateFrom, dateTo }) {
  const { getFindings, getDepts, getEmailMaster, getSystemSettings, writeSyncKey, currentUser, findingsDeptFilter, setFindingsDeptFilter, navigate, setCapaSelectedId, setPageAction } = useApp();
  const findings = getFindings();
  const depts = getDepts();
  const role = currentUser?.role;
  const settings = getSystemSettings();
  const codes = useMemo(() => managerDeptCodes(currentUser, depts, getEmailMaster()), [currentUser, depts, getEmailMaster]);

  const [search, setSearch] = useState('');
  const [filterSev, setFilterSev] = useState('');
  const [filterDept, setFilterDept] = useState(findingsDeptFilter || '');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortField, setSortField] = useState('ref');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [editItem, setEditItem] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  React.useEffect(() => {
    if (findingsDeptFilter) { setFilterDept(findingsDeptFilter); setFindingsDeptFilter(''); }
  }, [findingsDeptFilter, setFindingsDeptFilter]);

  const isManagedFinding = (f) => deptCodeInList(depts, f?.dept, codes) || deptCodeInList(depts, f?.deptName, codes);
  const canEditRecord = (f) => role === 'admin' || role === 'auditor' || (role === 'manager' && isManagedFinding(f));
  const canDeleteRecord = (f) => role === 'admin' || (role === 'auditor' && settings.allowAuditorsDeleteFindings) || (role === 'manager' && isManagedFinding(f));

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = filterFindingsByDateRange(findings, dateFrom, dateTo, ['due']);
    list = list.filter(f => {
      if (filterDept && !findingMatchesDeptCode(depts, f, filterDept)) return false;
      if (filterSev && normalizeAuditSeverity(f.sev || f.severity) !== filterSev) return false;
      if (filterStatus && f.status !== filterStatus) return false;
      if (q && ![f.ref, f.deptName, f.desc, f.clause, SEV_LABEL[f.sev], STAT_LABEL[f.status]].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    return list.slice().sort((a, b) => {
      const va = String(a[sortField] || '').toLowerCase(), vb = String(b[sortField] || '').toLowerCase();
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [findings, depts, dateFrom, dateTo, filterDept, filterSev, filterStatus, search, sortField, sortAsc]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const sort = (field) => { if (sortField === field) setSortAsc(a => !a); else { setSortField(field); setSortAsc(true); } };
  const clearFilters = () => { setSearch(''); setFilterDept(''); setFilterSev(''); setFilterStatus(''); setPage(1); };
  const openCapa = (f) => { setCapaSelectedId(f.ref || f.id); navigate('capa'); };

  const saveEdit = () => {
    const updated = findings.map(f => f.id === editItem.id ? { ...f, ...editItem, updatedAt: new Date().toISOString(), updatedBy: currentUser?.loginId } : f);
    writeSyncKey('ap_finds', updated, currentUser?.loginId);
    setEditItem(null); showToast('Finding saved');
  };
  const deleteFinding = (id) => {
    const updated = findings.map(f => f.id === id ? { ...f, deletedAt: new Date().toISOString(), deletedBy: currentUser?.loginId } : f);
    writeSyncKey('ap_finds', updated, currentUser?.loginId);
    setConfirmDelete(null); showToast('Finding deleted');
  };

  const exportExcel = () => {
    if (!window.XLSX) { showToast('Excel loading...'); return; }
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtered.map(f => ({ ID: f.ref, Dept: f.deptName, Description: f.desc, Severity: SEV_LABEL[f.sev] || f.sev, Clause: f.clause, Due: f.due, Status: STAT_LABEL[f.status] || f.status }))), 'Findings');
    XLSX.writeFile(wb, `OnePWS_Findings_${today()}.xlsx`);
    showToast('Exported');
  };

  const exportExcelRef = useRef(exportExcel);
  exportExcelRef.current = exportExcel;
  useEffect(() => {
    setPageAction(() => () => exportExcelRef.current());
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Sortable = ({ field, children }) => (
    <th style={{ cursor: 'pointer' }} onClick={() => sort(field)}>{children} {sortField === field ? (sortAsc ? '↑' : '↓') : '↕'}</th>
  );

  return (
    <div className="space-y-3">
      <Card title="Advanced Search & Filter">
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex flex-col gap-[3px]"><label className="form-label">Search</label><input placeholder="Any field..." style={{ minWidth: 160 }} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
          <div className="flex flex-col gap-[3px]"><label className="form-label">Dept</label>
            <select value={filterDept} onChange={e => { setFilterDept(e.target.value); setPage(1); }} style={{ minWidth: 120 }}><option value="">All</option>{depts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select>
          </div>
          <div className="flex flex-col gap-[3px]"><label className="form-label">Severity</label>
            <select value={filterSev} onChange={e => { setFilterSev(e.target.value); setPage(1); }} style={{ minWidth: 110 }}><option value="">All</option>{['critical', 'major', 'minor', 'obs'].map(s => <option key={s} value={s}>{SEV_LABEL[s]}</option>)}</select>
          </div>
          <div className="flex flex-col gap-[3px]"><label className="form-label">Status</label>
            <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} style={{ minWidth: 120 }}><option value="">All</option><option value="open">Open</option><option value="delayed">Delayed</option><option value="pending-closure">Submit For Review</option><option value="closed">Closed</option></select>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear</button>
          <button className="btn btn-brand btn-sm" onClick={exportExcel}><Icon name="table" /> Export</button>
        </div>
      </Card>

      <Card>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <Sortable field="ref">ID</Sortable>
                <Sortable field="deptName">Dept</Sortable>
                <th>Description</th>
                <Sortable field="sev">Severity</Sortable>
                <th>Clause</th>
                <Sortable field="due">Due</Sortable>
                <Sortable field="status">Status</Sortable>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 18, color: 'var(--text3)' }}>No findings match filters</td></tr>
              ) : paged.map(f => (
                <tr key={f.id}>
                  <td className="font-bold">{f.ref}</td>
                  <td>{f.deptName}</td>
                  <td style={{ maxWidth: 200 }} className="truncate">{f.desc}</td>
                  <td><Badge type={SEV_BADGE[f.sev] || 'b-gray'}>{SEV_LABEL[f.sev] || f.sev}</Badge></td>
                  <td><Badge type="b-blue">{f.clause}</Badge></td>
                  <td style={{ color: f.status === 'delayed' ? 'var(--red)' : 'inherit', fontWeight: f.status === 'delayed' ? 800 : 400 }}>{f.due}</td>
                  <td><Badge type={STAT_BADGE[f.status] || 'b-gray'}>{STAT_LABEL[f.status] || f.status}</Badge>{f.type === 'repeat' ? <> <Badge type="b-purple">Repeat</Badge></> : null}{f.externalAudit ? <> <span title={`External audit ${f.auditRef || ''}${f.responsibleOwner ? ' · Owner: ' + f.responsibleOwner : ''}`}><Badge type="b-blue">External</Badge></span></> : null}</td>
                  <td>
                    {role === 'viewer' ? '-' : (
                      <div className="flex gap-1 flex-wrap">
                        <button className="btn btn-ghost btn-sm" onClick={() => openCapa(f)}>CAPA</button>
                        {canEditRecord(f) && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditItem({ ...f })}><Icon name="pencil" /></button>}
                        {canDeleteRecord(f) && <button className="btn btn-danger btn-icon btn-sm" onClick={() => setConfirmDelete(f.id)}><Icon name="trash-2" /></button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination total={filtered.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
        <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{filtered.length} record(s)</div>
      </Card>

      {editItem && (
        <div className="modal-bg" onClick={() => setEditItem(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span>Edit Finding</span><button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditItem(null)}><Icon name="x" /></button></div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div><label className="form-label">Finding No.</label><input value={editItem.ref || ''} onChange={e => setEditItem(p => ({ ...p, ref: e.target.value }))} /></div>
              <div><label className="form-label">Dept</label>
                <select value={editItem.dept || ''} onChange={e => setEditItem(p => ({ ...p, dept: e.target.value, deptName: depts.find(d => d.code === e.target.value)?.name || e.target.value }))}>
                  <option value="">Select</option>{depts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div><label className="form-label">Severity</label><select value={editItem.sev || 'major'} onChange={e => setEditItem(p => ({ ...p, sev: e.target.value }))}>{['critical', 'major', 'minor', 'obs'].map(s => <option key={s} value={s}>{SEV_LABEL[s]}</option>)}</select></div>
              <div><label className="form-label">Status</label><select value={editItem.status || 'open'} onChange={e => setEditItem(p => ({ ...p, status: e.target.value, capaStatus: e.target.value === 'pending-closure' ? 'submitted' : e.target.value }))}>{Object.entries(STAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div><label className="form-label">Clause</label><input value={editItem.clause || ''} onChange={e => setEditItem(p => ({ ...p, clause: e.target.value }))} /></div>
              <div><label className="form-label">Due Date</label><input type="date" value={editItem.due || ''} onChange={e => setEditItem(p => ({ ...p, due: e.target.value }))} /></div>
            </div>
            <div className="mb-2"><label className="form-label">Description</label><textarea value={editItem.desc || ''} onChange={e => setEditItem(p => ({ ...p, desc: e.target.value }))} style={{ height: 76, resize: 'none' }} /></div>
            <div className="flex gap-2"><button className="btn btn-ghost flex-1" onClick={() => setEditItem(null)}>Cancel</button><button className="btn btn-primary flex-1" onClick={saveEdit}>Save</button></div>
          </div>
        </div>
      )}

      <ConfirmModal open={!!confirmDelete} message="Delete this finding permanently?" onConfirm={() => deleteFinding(confirmDelete)} onCancel={() => setConfirmDelete(null)} />
    </div>
  );
}
