import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, EmptyState, Icon } from '../components/UI';
import { buildAuditReportPdf } from '../utils/auditReportPdf';
import { SEV_BADGE, SEV_LABEL, STAT_BADGE, STAT_LABEL, sanitize, showToast } from '../utils/helpers';
import {
  auditFindingCounts, latestDeptAudit, latestDeptAuditScore,
  completedAuditsSorted, auditScoreColorVar, parseAuditDate, filterFindingsByDateRange,
  findingMatchesDeptCode, deptValuesMatch, deptToken, auditMatchesDeptCode,
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
  const [deptFilters, setDeptFilters] = useState([]);
  const [selected, setSelected] = useState(null);

  const isSpoc = currentUser?.role === 'spoc';

  const toggleStd = (id) => setStandards(prev => { let s = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]; if (!s.length) s = ['as9100d']; return s; });

  const dateFindings = useMemo(() => filterFindingsByDateRange(allFindings, dateFrom, dateTo), [allFindings, dateFrom, dateTo]);

  const reportDeptHasData = useCallback((d) => {
    if (statusFilter === 'completed') return completedAuditsSorted(completed, allFindings, depts, d.code).length > 0;
    return dateFindings.some(f => findingMatchesDeptCode(depts, f, d.code))
      || completedAuditsSorted(completed, allFindings, depts).some(a => auditMatchesDeptCode(depts, a, d.code));
  }, [statusFilter, completed, allFindings, depts, dateFindings]);

  const reportDeptList = useMemo(() => {
    let list = isSpoc
      ? depts.filter(d => deptValuesMatch(depts, d.code, currentUser?.dept) || deptValuesMatch(depts, d.name, currentUser?.dept))
      : deptFilters.length
        ? depts.filter(d => deptFilters.some(code => deptValuesMatch(depts, d.code, code) || deptValuesMatch(depts, d.name, code)))
        : depts;
    if (statusFilter === 'completed') list = list.filter(reportDeptHasData);
    const byAlias = new Map();
    list.forEach(d => {
      const key = deptToken(d.name) || deptToken(d.code);
      const previous = byAlias.get(key);
      if (!previous) { byAlias.set(key, d); return; }
      const wanted = deptFilters.length ? deptFilters : [currentUser?.dept || ''];
      const exact = wanted.some(code => deptValuesMatch(depts, d.code, code));
      const previousExact = wanted.some(code => deptValuesMatch(depts, previous.code, code));
      const audited = completedAuditsSorted(completed, allFindings, depts).some(a => String(a.dept || '').toUpperCase() === String(d.code || '').toUpperCase());
      const previousAudited = completedAuditsSorted(completed, allFindings, depts).some(a => String(a.dept || '').toUpperCase() === String(previous.code || '').toUpperCase());
      if ((exact && !previousExact) || (audited && !previousAudited)) byAlias.set(key, d);
    });
    return [...byAlias.values()];
  }, [depts, isSpoc, currentUser, deptFilters, statusFilter, completed, allFindings, reportDeptHasData]);

  const cardData = (d) => {
    // One scoring path for every status filter: the average of the latest on-portal audit and
    // the latest imported external audit (identical to Dashboard / Analytics).
    const info = latestDeptAuditScore(completed, allFindings, depts, d.code);
    const score = info && typeof info.score === 'number' ? info.score : null;
    const internalScore = info && typeof info.internalScore === 'number' ? info.internalScore : null;
    const externalScore = info && typeof info.externalScore === 'number' ? info.externalScore : null;
    const date = info && info.audit ? auditDateText(info.audit) : (d.lastAudit || 'Not audited');
    if (statusFilter === 'completed') {
      const counts = (info && info.counts) || auditFindingCounts(allFindings.filter(f => findingMatchesDeptCode(depts, f, d.code)));
      return { counts, score, internalScore, externalScore, total: counts.total, date };
    }
    const df = dateFindings.filter(f => findingMatchesDeptCode(depts, f, d.code));
    return { counts: auditFindingCounts(df), score, internalScore, externalScore, total: df.length, date };
  };

  const scoreBreakdown = (internalScore, externalScore) => (
    internalScore !== null && externalScore !== null
      ? `On-portal ${internalScore}% + External ${externalScore}% (average)`
      : externalScore !== null ? `External audit ${externalScore}%` : internalScore !== null ? `On-portal audit ${internalScore}%` : '');
  const sourceLabel = (f) => (f.externalAudit ? 'External' : 'On-portal');

  const activeStdLabel = standards.map(id => AUDIT_STANDARDS.find(s => s.id === id)?.label || id).join(' + ');

  const deptFindings = (code) => dateFindings.filter(f => findingMatchesDeptCode(depts, f, code));

  const toggleDept = (code) => {
    setDeptFilters(current => current.some(selectedCode => deptValuesMatch(depts, selectedCode, code))
      ? current.filter(selectedCode => !deptValuesMatch(depts, selectedCode, code))
      : [...current, code]);
  };

  const genDeptPDF = (d) => {
    if (!window.jspdf) { showToast('PDF loading...'); return; }
    const { counts, score } = cardData(d);
    const audit = latestDeptAudit(completed, allFindings, depts, d.code);
    let df = deptFindings(d.code);
    // Scope the finding list to the audit the report is about (matches the checklist and score tiles).
    const refs = audit && Array.isArray(audit.findingRefs) ? new Set(audit.findingRefs) : null;
    if (refs && refs.size) df = df.filter(f => refs.has(f.ref));
    const hasExternal = df.some(f => f.externalAudit) || (audit && audit.externalAudit);
    const doc = buildAuditReportPdf(window.jspdf.jsPDF, { dept: d, audit, score, counts, findings: df, standardsLabel: activeStdLabel, hasExternal });
    doc.save('OnePWS_' + d.code + '_Report_' + Date.now() + '.pdf');
    showToast('PDF downloaded');
  };

  const genDeptExcel = (d) => {
    if (!window.XLSX) { showToast('Excel loading...'); return; }
    const XLSX = window.XLSX;
    const df = deptFindings(d.code);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(df.map(f => ({ ID: f.ref, Source: sourceLabel(f), 'Audit Ref': f.auditRef || '', Topic: f.topic || '', Description: f.desc, Severity: SEV_LABEL[f.sev] || f.sev, Clause: f.clause, Owner: f.responsibleOwner || '', Due: f.due, Status: STAT_LABEL[f.status] || f.status }))), d.code);
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
            <span className={`badge ${deptFilters.length === 0 ? 'b-brand' : 'b-gray'}`} style={{ cursor: 'pointer', padding: '5px 10px', fontSize: 11 }} onClick={() => setDeptFilters([])}>All Depts</span>
          )}
          {(isSpoc ? depts.filter(d => deptValuesMatch(depts, d.code, currentUser?.dept) || deptValuesMatch(depts, d.name, currentUser?.dept)) : depts).map(d => {
            const selectedDept = deptFilters.some(code => deptValuesMatch(depts, code, d.code));
            const hasData = reportDeptHasData(d);
            return <span key={d.code} title={hasData ? '' : 'No report data for the current status filter'} className={`badge ${selectedDept ? 'b-brand' : 'b-gray'}`} style={{ cursor: 'pointer', padding: '5px 10px', fontSize: 11, opacity: hasData ? 1 : 0.45 }} onClick={() => toggleDept(d.code)}>{d.code}</span>;
          })}
        </div>
      </div>

      {/* Report cards */}
      {reportDeptList.length === 0 ? (
        <EmptyState icon="file-text" title="No departments found" subtitle="No completed audits for the current filter." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {reportDeptList.map(d => {
            const { counts, score, total, date, internalScore, externalScore } = cardData(d);
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
                {scoreBreakdown(internalScore, externalScore) && (
                  <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{scoreBreakdown(internalScore, externalScore)}</div>
                )}
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
        const { counts, score, internalScore, externalScore } = cardData(d);
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
            {scoreBreakdown(internalScore, externalScore) && (
              <div className="text-[10px] mb-3" style={{ color: 'var(--text3)' }}>Audit Score basis: {scoreBreakdown(internalScore, externalScore)}</div>
            )}
            <div className="card-heading"><span className="dot w-[7px] h-[7px] rounded-full bg-[var(--red)] flex-shrink-0" />Non-Conformances ({df.length})</div>
            <div className="table-wrap mb-3">
              <table>
                <thead><tr><th>ID</th><th>Source</th><th>Description</th><th>Severity</th><th>Owner</th><th>Clause</th><th>Status</th></tr></thead>
                <tbody>
                  {df.length ? df.map(f => (
                    <tr key={f.id || f.ref}>
                      <td className="font-bold">{f.ref}</td>
                      <td><Badge type={f.externalAudit ? 'b-purple' : 'b-gray'}>{f.externalAudit ? 'External' : 'On-portal'}</Badge></td>
                      <td style={{ maxWidth: 280 }}>{sanitize(f.desc || '')}</td>
                      <td><Badge type={SEV_BADGE[f.sev]}>{SEV_LABEL[f.sev]}</Badge></td>
                      <td>{sanitize(f.responsibleOwner || '-')}</td>
                      <td><Badge type="b-blue">{f.clause}</Badge></td>
                      <td><Badge type={STAT_BADGE[f.status]}>{STAT_LABEL[f.status]}</Badge></td>
                    </tr>
                  )) : <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: 12 }}>No non-conformances</td></tr>}
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
