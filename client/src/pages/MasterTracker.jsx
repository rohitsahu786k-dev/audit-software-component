import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, Tabs, Pagination, Icon } from '../components/UI';
import { SEV_BADGE, SEV_LABEL, STAT_BADGE, STAT_LABEL, showToast } from '../utils/helpers';
import { managerDeptCodes, filterFindingsByDateRange } from '../utils/dashboardHelpers';

const PAGE_SIZE = 15;

export default function MasterTracker({ dateFrom, dateTo }) {
  const { getFindings, getLearnings, getDepts, getEmailMaster, getCompletedAudits, currentUser, navigate, setCapaSelectedId, setPageAction } = useApp();
  const [tab, setTab] = useState('findings');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const role = currentUser?.role;
  const codes = useMemo(() => managerDeptCodes(currentUser, getDepts(), getEmailMaster()), [currentUser, getDepts, getEmailMaster]);
  const canGlobal = role === 'admin' || role === 'auditor';

  const baseFindings = useMemo(() => {
    let list = filterFindingsByDateRange(getFindings(), dateFrom, dateTo);
    if (role === 'spoc') list = list.filter(f => f.dept === currentUser?.dept);
    else if (role === 'manager') list = list.filter(f => codes.includes(f.dept));
    return list;
  }, [getFindings, dateFrom, dateTo, role, currentUser, codes]);

  const learnings = useMemo(() => {
    let list = getLearnings();
    if (role === 'spoc') list = list.filter(l => l.dept === currentUser?.dept || !l.dept || l.dept === 'All');
    else if (role === 'manager') list = list.filter(l => !l.dept || l.dept === 'All' || codes.includes(l.dept));
    return list;
  }, [getLearnings, role, currentUser, codes]);

  const q = search.toLowerCase().trim();

  const data = useMemo(() => {
    if (tab === 'findings') {
      let d = baseFindings;
      if (q) d = d.filter(f => [f.ref, f.deptName, f.desc, f.clause].join(' ').toLowerCase().includes(q));
      return d;
    }
    if (tab === 'capa') {
      let d = baseFindings.filter(f => f.status !== 'closed');
      if (q) d = d.filter(f => [f.ref, f.deptName, f.desc].join(' ').toLowerCase().includes(q));
      return d;
    }
    let d = learnings;
    if (q) d = d.filter(l => [l.title, l.rc, l.pa, l.clause].join(' ').toLowerCase().includes(q));
    return d;
  }, [tab, baseFindings, learnings, q]);

  const paged = data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const openCapa = (f) => { setCapaSelectedId(f.ref || f.id); navigate('capa'); };
  const changeTab = (t) => { setTab(t); setPage(1); };

  const exportTab = () => {
    if (!window.XLSX) { showToast('Excel loading...'); return; }
    const XLSX = window.XLSX;
    let rows = [];
    if (tab === 'findings') rows = data.map(f => ({ ID: f.ref, Dept: f.deptName, Desc: f.desc, Sev: SEV_LABEL[f.sev], Clause: f.clause, Due: f.due, Status: STAT_LABEL[f.status] }));
    else if (tab === 'capa') rows = data.map(f => ({ Ref: f.ref, Dept: f.deptName, Issue: f.desc, Due: f.due, Status: STAT_LABEL[f.status] }));
    else rows = data.map(l => ({ Title: l.title, Dept: l.dept || 'All', Clause: l.clause, Sev: SEV_LABEL[l.sev], 'Root Cause': l.rc, 'Preventive Action': l.pa }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), tab);
    XLSX.writeFile(wb, `OnePWS_${tab}_${Date.now()}.xlsx`);
    showToast('Excel exported');
  };

  const exportAll = () => {
    if (!window.XLSX) { showToast('Excel loading...'); return; }
    if (!canGlobal) { showToast('Only Master Admin and Auditor can export all department data'); return; }
    const XLSX = window.XLSX;
    const all = getFindings();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(all.map(f => ({ ID: f.ref, Department: f.deptName, Description: f.desc, Severity: SEV_LABEL[f.sev] || f.sev, Clause: f.clause, DueDate: f.due, Status: STAT_LABEL[f.status] || f.status, Type: f.type || '', AuditRef: f.auditRef || '' }))), 'All Findings');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(all.filter(f => f.status !== 'closed').map(f => ({ Ref: f.ref, Dept: f.deptName, Issue: f.desc, Severity: SEV_LABEL[f.sev], Due: f.due, Status: STAT_LABEL[f.status], ClosureEvidence: f.closureEvidence || '' }))), 'Open CAPA');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(getLearnings().map(l => ({ Title: l.title, Dept: l.dept || 'All', Clause: l.clause, Severity: SEV_LABEL[l.sev], 'Root Cause': l.rc, 'Preventive Action': l.pa }))), 'Learnings');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(getCompletedAudits().map(a => ({ Ref: a.ref || '', Department: a.deptName || '', Auditor: a.auditor || '', Date: a.date || '', Type: a.type || '', Standards: (a.standards || []).join(', '), SubmittedAt: a.submittedAt || '', Findings: (a.findingRefs || []).length }))), 'Completed Audits');
    XLSX.writeFile(wb, 'OnePWS_MasterTracker_Full_' + Date.now() + '.xlsx');
    showToast('Full Master Tracker exported');
  };

  const exportAllRef = useRef(exportAll);
  exportAllRef.current = exportAll;
  useEffect(() => {
    setPageAction(() => () => exportAllRef.current());
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportPDF = () => {
    if (!window.jspdf) { showToast('PDF loading...'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pw = doc.internal.pageSize.getWidth();
    doc.setFillColor(192, 57, 43); doc.rect(0, 0, pw, 22, 'F');
    doc.setTextColor(255); doc.setFontSize(12); doc.setFont('helvetica', 'bold');
    doc.text(`OnePWS Pvt. Ltd. — ${tab.toUpperCase()} Tracker`, pw / 2, 14, { align: 'center' });
    doc.setTextColor(30, 30, 50);
    let head = [], rows = [];
    if (tab === 'findings') { head = [['ID', 'Dept', 'Description', 'Severity', 'Status']]; rows = data.map(f => [f.ref, f.deptName, f.desc, SEV_LABEL[f.sev], STAT_LABEL[f.status]]); }
    else if (tab === 'capa') { head = [['Ref', 'Dept', 'Issue', 'Status', 'Due']]; rows = data.map(f => [f.ref, f.deptName, f.desc, STAT_LABEL[f.status], f.due]); }
    else { head = [['Title', 'Dept', 'Clause', 'Severity']]; rows = data.map(l => [l.title, l.dept || 'All', l.clause, SEV_LABEL[l.sev]]); }
    doc.autoTable({ startY: 26, head, body: rows, styles: { fontSize: 8 }, headStyles: { fillColor: [192, 57, 43], textColor: 255 }, margin: { left: 14, right: 14 } });
    doc.save(`OnePWS_${tab}_${Date.now()}.pdf`);
    showToast('PDF exported');
  };

  const dl = (f) => Math.round((new Date(f.due) - new Date()) / 86400000);

  return (
    <div className="space-y-3">
      <Tabs tabs={[{ id: 'findings', label: 'Findings' }, { id: 'capa', label: 'CAPA' }, { id: 'learnings', label: 'Learnings' }]} active={tab} onChange={changeTab} />

      <div className="flex gap-2 flex-wrap items-center">
        <input placeholder="Search..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ minWidth: 200, maxWidth: 260 }} />
        <button className="btn btn-brand btn-sm" onClick={exportTab}><Icon name="table" /> Export Tab</button>
        {canGlobal && <button className="btn btn-primary btn-sm" onClick={exportAll}><Icon name="table" /> Export All (Excel)</button>}
        <button className="btn btn-ghost btn-sm" onClick={exportPDF}><Icon name="file-text" /> Export PDF</button>
      </div>

      <Card>
        <div className="table-wrap">
          {tab === 'findings' && (
            <table>
              <thead><tr><th>ID</th><th>Dept</th><th>Description</th><th>Severity</th><th>Clause</th><th>Due</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {paged.map(f => (
                  <tr key={f.id || f.ref}>
                    <td className="font-bold">{f.ref}</td>
                    <td>{f.deptName}</td>
                    <td style={{ maxWidth: 180 }} className="truncate">{f.desc}</td>
                    <td><Badge type={SEV_BADGE[f.sev] || 'b-gray'}>{SEV_LABEL[f.sev] || f.sev}</Badge></td>
                    <td><Badge type="b-blue">{f.clause}</Badge></td>
                    <td style={{ color: f.status === 'delayed' ? 'var(--red)' : 'inherit' }}>{f.due}</td>
                    <td><Badge type={STAT_BADGE[f.status] || 'b-gray'}>{STAT_LABEL[f.status] || f.status}</Badge></td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => openCapa(f)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'capa' && (
            <table>
              <thead><tr><th>Ref</th><th>Dept</th><th>Issue</th><th>Severity</th><th>Due</th><th>Days</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {paged.map(f => { const d = dl(f); return (
                  <tr key={f.id || f.ref}>
                    <td className="font-bold">{f.ref}</td>
                    <td>{f.deptName}</td>
                    <td style={{ maxWidth: 160 }} className="truncate">{(f.desc || '').substring(0, 55)}</td>
                    <td><Badge type={SEV_BADGE[f.sev] || 'b-gray'}>{SEV_LABEL[f.sev] || f.sev}</Badge></td>
                    <td>{f.due}</td>
                    <td style={{ color: d < 0 ? 'var(--red)' : d <= 3 ? 'var(--amber)' : 'inherit', fontWeight: d < 0 ? 800 : 400 }}>{d < 0 ? `${Math.abs(d)}d over` : `${d}d`}</td>
                    <td><Badge type={STAT_BADGE[f.status] || 'b-gray'}>{STAT_LABEL[f.status] || f.status}</Badge></td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => openCapa(f)}>Open</button></td>
                  </tr>
                ); })}
              </tbody>
            </table>
          )}
          {tab === 'learnings' && (
            <table>
              <thead><tr><th>Title</th><th>Dept</th><th>Clause</th><th>Severity</th><th>Root Cause</th><th>Preventive Action</th></tr></thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text3)', padding: 12 }}>No learnings recorded</td></tr>
                ) : paged.map(l => (
                  <tr key={l.id}>
                    <td className="font-bold">{l.title}</td>
                    <td>{l.dept || 'All'}</td>
                    <td><Badge type="b-blue">{l.clause || '—'}</Badge></td>
                    <td><Badge type={SEV_BADGE[l.sev] || 'b-gray'}>{SEV_LABEL[l.sev] || l.sev}</Badge></td>
                    <td style={{ maxWidth: 140, fontSize: 11 }}>{l.rc}</td>
                    <td style={{ maxWidth: 140, fontSize: 11 }}>{l.pa}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Pagination total={data.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
        <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>
          {data.length} {tab === 'findings' ? 'record(s)' : tab === 'capa' ? 'open CAPA(s)' : 'learning(s)'}
        </div>
      </Card>
    </div>
  );
}
