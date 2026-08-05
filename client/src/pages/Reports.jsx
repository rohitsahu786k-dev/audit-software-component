import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, EmptyState, Icon } from '../components/UI';
import { SEV_BADGE, SEV_LABEL, STAT_BADGE, STAT_LABEL, sanitize, showToast } from '../utils/helpers';
import {
  auditFindingCounts, latestDeptAudit, latestDeptAuditScore, frozenAuditScore,
  completedAuditsSorted, auditScoreColorVar, parseAuditDate, filterFindingsByDateRange,
} from '../utils/dashboardHelpers';

const AUDIT_STANDARDS = [
  { id: 'as9100d', label: 'AS9100 Rev D', color: 'var(--brand)' },
  { id: 'iso9001', label: 'ISO 9001:2015', color: 'var(--green)' },
  { id: 'iso14001', label: 'ISO 14001:2015', color: 'var(--teal)' },
  { id: 'iso45001', label: 'ISO 45001:2018', color: 'var(--amber)' },
];

function auditDateText(audit) {
  if (!audit) return '';
  const d = parseAuditDate(audit.submittedAt || audit.date);
  if (!d) return String(audit.submittedAt || audit.date || '');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function Reports({ dateFrom, dateTo }) {
  const { getFindings, getDepts, getCompletedAudits, getCheckpoints, currentUser, setPageAction } = useApp();
  const allFindings = getFindings();
  const depts = getDepts();
  const completed = getCompletedAudits();
  const checkpoints = getCheckpoints();

  const [standards, setStandards] = useState(['as9100d']);
  const [statusFilter, setStatusFilter] = useState('completed');
  const [deptFilter, setDeptFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const isSpoc = currentUser?.role === 'spoc';

  const toggleStd = (id) => setStandards(prev => { let s = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]; if (!s.length) s = ['as9100d']; return s; });

  const dateFindings = useMemo(() => filterFindingsByDateRange(allFindings, dateFrom, dateTo), [allFindings, dateFrom, dateTo]);

  const reportDeptList = useMemo(() => {
    let list = isSpoc ? depts.filter(d => d.code === currentUser?.dept) : (deptFilter !== 'all' ? depts.filter(d => d.code === deptFilter) : depts);
    if (statusFilter === 'completed') {
      const done = new Set(completedAuditsSorted(completed, allFindings, depts).map(a => a.dept));
      list = list.filter(d => done.has(d.code));
    }
    return list;
  }, [depts, isSpoc, currentUser, deptFilter, statusFilter, completed, allFindings]);

  const cardData = (d) => {
    if (statusFilter === 'completed') {
      const latest = latestDeptAudit(completed, allFindings, depts, d.code);
      const counts = (latest && latest.auditFindingCountsFrozen) || auditFindingCounts(allFindings.filter(f => f.dept === d.code));
      const score = latest ? frozenAuditScore(latest) : null;
      return { counts, score, total: counts.total, date: latest ? auditDateText(latest) : (d.lastAudit || 'Not audited') };
    }
    const df = dateFindings.filter(f => f.dept === d.code);
    const counts = auditFindingCounts(df);
    const info = latestDeptAuditScore(completed, allFindings, depts, d.code);
    const score = info && typeof info.score === 'number' ? info.score : null;
    return { counts, score, total: df.length, date: info && info.audit ? auditDateText(info.audit) : (d.lastAudit || 'Not audited') };
  };

  const activeStdLabel = standards.map(id => AUDIT_STANDARDS.find(s => s.id === id)?.label || id).join(' + ');

  const deptFindings = (code) => dateFindings.filter(f => f.dept === code);

  const genDeptPDF = (d) => {
    if (!window.jspdf) { showToast('PDF loading...'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pw = doc.internal.pageSize.getWidth();
    const { counts, score } = cardData(d);
    const df = deptFindings(d.code);
    doc.setFillColor(192, 57, 43); doc.rect(0, 0, pw, 28, 'F');
    doc.setTextColor(255); doc.setFontSize(15); doc.setFont('helvetica', 'bold');
    doc.text('OnePWS Pvt. Ltd.', pw / 2, 11, { align: 'center' });
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('Internal Quality Audit Report — ' + d.name, pw / 2, 18, { align: 'center' });
    doc.setFontSize(7);
    doc.text('SPOC: ' + (d.spoc || 'TBD') + ' | Date: ' + new Date().toLocaleDateString() + ' | Standards: ' + activeStdLabel, pw / 2, 24, { align: 'center' });
    doc.setTextColor(30, 30, 50);
    doc.autoTable({
      startY: 34, head: [['Audit Score', 'Critical', 'Major', 'Minor', 'Observation']],
      body: [[score === null ? 'N/A' : score + '%', counts.critical, counts.major, counts.minor, counts.obs]],
      styles: { fontSize: 9, halign: 'center' }, headStyles: { fillColor: [37, 99, 235], textColor: 255 }, margin: { left: 14, right: 14 },
    });
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8, head: [['ID', 'Description', 'Severity', 'Clause', 'Status']],
      body: df.map(f => [f.ref, f.desc, SEV_LABEL[f.sev] || f.sev, f.clause, STAT_LABEL[f.status] || f.status]),
      styles: { fontSize: 8 }, headStyles: { fillColor: [192, 57, 43], textColor: 255 }, margin: { left: 14, right: 14 },
    });
    doc.save('OnePWS_' + d.code + '_Report_' + Date.now() + '.pdf');
    showToast('PDF downloaded');
  };

  const genDeptExcel = (d) => {
    if (!window.XLSX) { showToast('Excel loading...'); return; }
    const XLSX = window.XLSX;
    const df = deptFindings(d.code);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(df.map(f => ({ ID: f.ref, Description: f.desc, Severity: SEV_LABEL[f.sev] || f.sev, Clause: f.clause, Due: f.due, Status: STAT_LABEL[f.status] || f.status }))), d.code);
    XLSX.writeFile(wb, 'OnePWS_' + d.code + '_Report_' + Date.now() + '.xlsx');
    showToast('Excel downloaded');
  };

  const generateReport = () => {
    const d = (selected && depts.find(x => x.code === selected)) || reportDeptList[0];
    if (!d) { showToast('No department available to report on'); return; }
    genDeptPDF(d);
  };
  const generateReportRef = useRef(generateReport);
  generateReportRef.current = generateReport;
  useEffect(() => {
    setPageAction(() => () => generateReportRef.current());
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      {/* Standards */}
      <Card title={<>Active Audit Standards: <span style={{ color: 'var(--brand)', fontWeight: 800 }}>{activeStdLabel}</span></>}>
        <div className="text-[10px] mb-2" style={{ color: 'var(--text3)' }}>Select/deselect standards to filter which audit framework reports are shown below.</div>
        <div className="stdc">
          {AUDIT_STANDARDS.map(s => (
            <div key={s.id} className={`stdchip ${standards.includes(s.id) ? 'sel' : ''}`} onClick={() => toggleStd(s.id)}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />{s.label}
            </div>
          ))}
          <div className="stdchip sel" style={{ borderColor: '#7c3aed', background: '#f5f3ff', color: '#7c3aed', cursor: 'default' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7c3aed', display: 'inline-block' }} />OnePWS Internal ({checkpoints.length})
          </div>
        </div>
      </Card>

      {/* Status filter */}
      <div>
        <div className="card-heading"><span className="dot w-[7px] h-[7px] rounded-full bg-[var(--green)] flex-shrink-0" />Audit Status Filter</div>
        <div className="flex gap-2 flex-wrap">
          {[['all', 'All'], ['completed', 'Completed']].map(([v, l]) => (
            <button key={v} className={`btn btn-sm ${statusFilter === v ? 'btn-brand' : 'btn-ghost'}`} onClick={() => setStatusFilter(v)}>{l}</button>
          ))}
        </div>
      </div>

      {/* Dept chips */}
      <div>
        <div className="card-heading"><span className="dot w-[7px] h-[7px] rounded-full bg-[var(--accent)] flex-shrink-0" />Department-wise Reports</div>
        <div className="flex gap-1 flex-wrap">
          {!isSpoc && (
            <span className={`badge ${deptFilter === 'all' ? 'b-brand' : 'b-gray'}`} style={{ cursor: 'pointer', padding: '5px 10px', fontSize: 11 }} onClick={() => setDeptFilter('all')}>All Depts</span>
          )}
          {(isSpoc ? depts.filter(d => d.code === currentUser?.dept) : depts).map(d => (
            <span key={d.code} className={`badge ${deptFilter === d.code ? 'b-brand' : 'b-gray'}`} style={{ cursor: 'pointer', padding: '5px 10px', fontSize: 11 }} onClick={() => setDeptFilter(d.code)}>{d.code}</span>
          ))}
        </div>
      </div>

      {/* Report cards */}
      {reportDeptList.length === 0 ? (
        <EmptyState icon="file-text" title="No departments found" subtitle="No completed audits for the current filter." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {reportDeptList.map(d => {
            const { counts, score, total, date } = cardData(d);
            const c = counts.critical, ma = counts.major, mi = counts.minor, ob = counts.obs;
            const sc = score === null ? 'text3' : auditScoreColorVar(score);
            return (
              <div key={d.code} className="card" style={{ cursor: 'pointer' }} onClick={() => setSelected(d.code)}>
                <div className="flex justify-between items-center mb-2">
                  <Badge type={c > 0 ? 'b-red' : ma > 0 ? 'b-amber' : 'b-green'}>{c > 0 ? 'Critical' : ma > 0 ? 'Major' : 'Compliant'}</Badge>
                  <span className="text-[9px]" style={{ color: 'var(--text3)' }}>{date || 'Not audited'}</span>
                </div>
                <div className="text-xs font-bold">{d.name}</div>
                <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{d.spoc || 'TBD'} · {total} finding(s)</div>
                <div className="flex justify-between items-center mt-2">
                  <span style={{ fontSize: 18, fontWeight: 900, color: `var(--${sc})` }}>{score === null ? 'N/A' : score + '%'}</span>
                  <div className="flex gap-2 text-[11px]">
                    <span style={{ color: 'var(--red)' }}>{c}C</span><span style={{ color: 'var(--amber)' }}>{ma}M</span><span style={{ color: 'var(--teal)' }}>{mi}m</span><span style={{ color: 'var(--purple)' }}>{ob}O</span>
                  </div>
                </div>
                <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--border)', display: 'flex', gap: 5 }}>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={e => { e.stopPropagation(); genDeptPDF(d); }}><Icon name="file-text" /> PDF</button>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={e => { e.stopPropagation(); genDeptExcel(d); }}><Icon name="table" /> Excel</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dept report preview */}
      {selected && (() => {
        const d = depts.find(x => x.code === selected); if (!d) return null;
        const { counts, score } = cardData(d);
        const sc = score === null ? 'text3' : auditScoreColorVar(score);
        const df = deptFindings(d.code);
        const latest = latestDeptAudit(completed, allFindings, depts, d.code);
        return (
          <Card>
            <div className="flex justify-between items-start mb-3" style={{ borderBottom: '2px solid var(--brand)', paddingBottom: 11 }}>
              <div>
                <div className="text-sm font-extrabold">INTERNAL QUALITY AUDIT REPORT</div>
                <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>OnePWS Pvt. Ltd. · {d.name} · {activeStdLabel}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px]" style={{ color: 'var(--text3)' }}>SPOC: {d.spoc || 'TBD'}</div>
                <div className="text-[10px]" style={{ color: 'var(--text3)' }}>Last: {latest ? auditDateText(latest) : (d.lastAudit || '—')}</div>
                <button className="btn btn-ghost btn-icon btn-sm mt-1" onClick={() => setSelected(null)}><Icon name="x" /></button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
              {[['Audit Score', score === null ? 'N/A' : score + '%', sc], ['Critical', counts.critical, 'red'], ['Major', counts.major, 'amber'], ['Minor', counts.minor, 'teal'], ['Observation', counts.obs, 'purple']].map(([l, v, col]) => (
                <div key={l} style={{ textAlign: 'center', background: 'var(--bg3)', borderRadius: 7, padding: 9 }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: `var(--${col})` }}>{v}</div>
                  <div className="text-[9px]" style={{ color: 'var(--text3)' }}>{l}</div>
                </div>
              ))}
            </div>
            <div className="card-heading"><span className="dot w-[7px] h-[7px] rounded-full bg-[var(--red)] flex-shrink-0" />Non-Conformances ({df.length})</div>
            <div className="table-wrap mb-3">
              <table>
                <thead><tr><th>ID</th><th>Description</th><th>Severity</th><th>Clause</th><th>Status</th></tr></thead>
                <tbody>
                  {df.length ? df.map(f => (
                    <tr key={f.id || f.ref}>
                      <td className="font-bold">{f.ref}</td>
                      <td style={{ maxWidth: 280 }}>{sanitize(f.desc || '')}</td>
                      <td><Badge type={SEV_BADGE[f.sev]}>{SEV_LABEL[f.sev]}</Badge></td>
                      <td><Badge type="b-blue">{f.clause}</Badge></td>
                      <td><Badge type={STAT_BADGE[f.status]}>{STAT_LABEL[f.status]}</Badge></td>
                    </tr>
                  )) : <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text3)', padding: 12 }}>No non-conformances</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button className="btn btn-brand btn-sm" onClick={() => genDeptPDF(d)}><Icon name="file-text" /> Download PDF</button>
              <button className="btn btn-ghost btn-sm" onClick={() => genDeptExcel(d)}><Icon name="table" /> Download Excel</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}><Icon name="x" /> Close</button>
            </div>
          </Card>
        );
      })()}
    </div>
  );
}
