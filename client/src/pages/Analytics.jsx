import React, { useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, Icon } from '../components/UI';
import { findingWorkflowStatus, sanitize, showToast } from '../utils/helpers';
import {
  closureRate, orgLatestAuditScore, auditFindingCounts,
  latestDeptAuditInMonth, frozenAuditScore, findingRaisedDate, findingClosedDate,
  cumulativeClosureRateAt, closureTrendDeptHasData, deptHasAuditInYear,
  latestDeptAuditScore, clauseName, clauseDescription, auditScoreColorVar, filterFindingsByDateRange,
} from '../utils/dashboardHelpers';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function Analytics({ dateFrom, dateTo }) {
  const { getFindings, getDepts, getCompletedAudits, currentUser, setPageAction } = useApp();

  const isSpoc = currentUser?.role === 'spoc';
  const sDept = currentUser?.dept || '';
  const allFindings = getFindings();
  const completed = getCompletedAudits();

  const F = useMemo(() => {
    const base = filterFindingsByDateRange(allFindings, dateFrom, dateTo);
    return isSpoc ? base.filter(f => f.dept === sDept) : base;
  }, [allFindings, dateFrom, dateTo, isSpoc, sDept]);

  const trendFindings = useMemo(() => (isSpoc ? allFindings.filter(f => f.dept === sDept) : allFindings), [allFindings, isSpoc, sDept]);
  const depts = useMemo(() => (isSpoc ? getDepts().filter(d => d.code === sDept) : getDepts()), [getDepts, isSpoc, sDept]);

  const closed = F.filter(f => f.status === 'closed').length;
  const capaRate = closureRate(F);
  const overallScore = orgLatestAuditScore(completed, allFindings, depts);
  const counts = auditFindingCounts(F);

  const now = new Date();
  const yr = now.getFullYear();

  const getMonthlyData = (deptCode) => {
    const data = [];
    for (let m = 0; m < 12; m++) {
      const monthEnd = new Date(yr, m + 1, 0, 23, 59, 59, 999);
      const isFuture = yr > now.getFullYear() || (yr === now.getFullYear() && m > now.getMonth());
      const auditThisMonth = latestDeptAuditInMonth(completed, allFindings, depts, deptCode, yr, m);
      const hasClosureData = !isFuture && trendFindings.some(f => {
        if (deptCode && f.dept !== deptCode) return false;
        const raised = findingRaisedDate(f, yr);
        return raised && raised <= monthEnd;
      });
      const asOf = hasClosureData ? monthEnd : null;
      const mFinds = hasClosureData ? trendFindings.filter(f => {
        if (deptCode && f.dept !== deptCode) return false;
        const raised = findingRaisedDate(f, yr);
        return raised && raised <= asOf;
      }) : [];
      const cl = hasClosureData ? mFinds.filter(f => {
        if (f.status !== 'closed') return false;
        const c = findingClosedDate(f, yr);
        return !c || c <= asOf;
      }).length : 0;
      const cr = hasClosureData ? cumulativeClosureRateAt(trendFindings, deptCode, asOf, yr) : null;
      const as = auditThisMonth ? frozenAuditScore(auditThisMonth) : null;
      data.push({ month: MONTHS[m], total: mFinds.length, closed: cl, cr, auditScore: as });
    }
    return data;
  };

  const closureRows = useMemo(() => depts
    .filter(d => closureTrendDeptHasData(trendFindings, d.code, yr) || deptHasAuditInYear(completed, allFindings, depts, d.code, yr))
    .map(d => {
      const md = getMonthlyData(d.code);
      const cells = md.map((cur, m) => {
        const val = cur.cr;
        const prev = m > 0 ? md[m - 1].cr : null;
        let arrow = null, color = 'text3';
        if (val !== null) {
          color = val >= 90 ? 'green' : val >= 60 ? 'amber' : 'red';
          if (prev !== null) {
            const diff = val - prev;
            arrow = diff > 0 ? { t: `▲${diff}`, c: 'green' } : diff < 0 ? { t: `▼${Math.abs(diff)}`, c: 'red' } : { t: '—', c: 'text3' };
          }
        }
        return { val, arrow, color };
      });
      return { name: d.name, cells };
    }), [depts, trendFindings, completed, allFindings]);

  const scoreRows = useMemo(() => depts
    .filter(d => deptHasAuditInYear(completed, allFindings, depts, d.code, yr))
    .map(d => {
      const md = getMonthlyData(d.code);
      const cells = md.map(cur => {
        const val = cur.auditScore;
        const color = val !== null ? (val >= 80 ? 'green' : val >= 60 ? 'amber' : 'red') : 'text3';
        const bg = val !== null ? (val >= 80 ? 'rgba(22,163,74,0.08)' : val >= 60 ? 'rgba(217,119,6,0.08)' : 'rgba(220,38,38,0.08)') : 'transparent';
        return { val, color, bg };
      });
      return { name: d.name, cells };
    }), [depts, trendFindings, completed, allFindings]);

  const aiRisk = useMemo(() => {
    const rows = depts.map(d => {
      const df = F.filter(f => f.dept === d.code && f.status !== 'closed');
      const p = df.length ? Math.min(100, df.length * 12) : 0;
      const col = p >= 60 ? 'red' : p >= 30 ? 'amber' : 'green';
      const clauses = [...new Set(df.map(f => f.clause))].slice(0, 3).join(', ') || 'No issues';
      return { name: d.name, p, col, clauses };
    }).filter(x => x.p > 0).sort((a, b) => b.p - a.p).slice(0, 3);
    return rows.length ? rows : [{ name: '-', p: 0, col: 'green', clauses: 'No data yet' }];
  }, [depts, F]);

  const recurringClauses = useMemo(() => {
    const ncSev = { critical: 1, major: 1, minor: 1 };
    const map = {};
    F.forEach(f => {
      const sev = String(f.sev || '').toLowerCase();
      if (!ncSev[sev]) return;
      const k = String(f.clause || '—').trim() || '—';
      if (!map[k]) map[k] = { clause: k, count: 0, critical: 0, major: 0, minor: 0 };
      map[k].count++; map[k][sev]++;
    });
    return Object.values(map).sort((a, b) => b.count - a.count || a.clause.localeCompare(b.clause)).slice(0, 10);
  }, [F]);

  const statusCounts = {
    open: F.filter(f => findingWorkflowStatus(f) === 'open').length,
    'in-progress': F.filter(f => findingWorkflowStatus(f) === 'in-progress').length,
    delayed: F.filter(f => findingWorkflowStatus(f) === 'delayed').length,
    'pending-closure': F.filter(f => findingWorkflowStatus(f) === 'pending-closure').length,
    closed: F.filter(f => findingWorkflowStatus(f) === 'closed').length,
  };

  const scoreColor = overallScore === null ? 'text3' : auditScoreColorVar(overallScore);
  const kpis = [
    ['Total Findings', '' + F.length, 'brand'],
    ['Open', '' + F.filter(f => f.status !== 'closed').length, 'red'],
    ['Audit Score', overallScore === null ? 'N/A' : overallScore + '%', scoreColor],
    ['Closure Rate', capaRate + '%', capaRate >= 90 ? 'green' : capaRate >= 60 ? 'amber' : 'red'],
    ['Closed', '' + closed, 'green'],
  ];

  const statusChips = [
    ['Open', statusCounts.open, 'red'],
    ['In Progress', statusCounts['in-progress'], 'amber'],
    ['Delayed', statusCounts.delayed, 'red'],
    ['Submit For Review', statusCounts['pending-closure'], 'purple'],
    ['Closed', statusCounts.closed, 'green'],
  ];

  const sevRows = [
    ['Critical', counts.critical, 'red', 15],
    ['Major', counts.major, 'amber', 10],
    ['Minor', counts.minor, 'teal', 5],
    ['Observation', counts.obs, 'purple', 2],
  ];

  const deptDelay = depts.slice(0, 5).map(d => ({
    name: d.name,
    od: F.filter(f => f.dept === d.code && findingWorkflowStatus(f) === 'delayed').length,
  })).filter(d => d.od > 0);

  const exportPDF = () => {
    if (!window.jspdf) { showToast('PDF library loading...'); return; }
    const jsPDF = window.jspdf.jsPDF;
    const doc = new jsPDF();
    const pw = doc.internal.pageSize.getWidth();
    doc.setFillColor(192, 57, 43); doc.rect(0, 0, pw, 26, 'F');
    doc.setTextColor(255); doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text('OnePWS Pvt. Ltd. — Analytics & KPI Report', pw / 2, 16, { align: 'center' });
    doc.setTextColor(30, 30, 50);
    doc.autoTable({
      startY: 30, head: [['KPI', 'Value']],
      body: kpis.map(([l, v]) => [l, v]),
      styles: { fontSize: 9 }, headStyles: { fillColor: [192, 57, 43], textColor: 255 }, margin: { left: 14, right: 14 },
    });
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8, head: [['Department', 'Total', 'Open', 'Closed', 'Audit Score', 'Closure %']],
      body: depts.filter(d => F.some(f => f.dept === d.code) || latestDeptAuditScore(completed, allFindings, depts, d.code)).map(d => {
        const df = F.filter(f => f.dept === d.code);
        const s = latestDeptAuditScore(completed, allFindings, depts, d.code);
        return [d.name, df.length, df.filter(f => f.status !== 'closed').length, df.filter(f => f.status === 'closed').length, (s && typeof s.score === 'number') ? s.score + '%' : 'N/A', closureRate(df) + '%'];
      }),
      styles: { fontSize: 9 }, headStyles: { fillColor: [37, 99, 235], textColor: 255 }, margin: { left: 14, right: 14 },
    });
    doc.save('OnePWS_Analytics_' + Date.now() + '.pdf');
    showToast('PDF downloaded');
  };

  useEffect(() => {
    setPageAction(() => exportPDF);
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportExcel = () => {
    if (!window.XLSX) { showToast('Excel library loading...'); return; }
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpis.map(([KPI, Value]) => ({ KPI, Value }))), 'KPIs');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recurringClauses.map(t => ({
      ClauseName: clauseName(t.clause), ClauseDescription: clauseDescription(t.clause), NCCount: t.count, Critical: t.critical, Major: t.major, Minor: t.minor,
    }))), 'Recurring Clauses');
    XLSX.writeFile(wb, 'OnePWS_Analytics_' + Date.now() + '.xlsx');
    showToast('Excel exported');
  };

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map(([l, v, c]) => (
          <div className="kpi-box" key={l}>
            <div className="kpi-value" style={{ color: `var(--${c})` }}>{v}</div>
            <div className="kpi-label">{l}</div>
          </div>
        ))}
      </div>

      {/* Three-panel row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card title="Findings by Status">
          <div className="flex gap-2 flex-wrap">
            {statusChips.map(([l, n, col]) => n > 0 ? (
              <div key={l} style={{ textAlign: 'center', background: `var(--${col}-bg)`, border: `1px solid var(--${col})`, borderRadius: 7, padding: '8px 12px', minWidth: 60 }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: `var(--${col})` }}>{n}</div>
                <div className="text-[9px] font-bold" style={{ color: `var(--${col})` }}>{l}</div>
              </div>
            ) : null)}
          </div>
          <div className="text-[10px] mt-2" style={{ color: 'var(--text3)' }}>{F.length} total findings across {new Set(F.map(f => f.dept)).size} departments</div>
        </Card>

        <Card title="Severity Distribution">
          {sevRows.map(([l, n, cl, w]) => (
            <div key={l}>
              <div className="flex justify-between text-[11px] mb-1"><span>{l}</span><span style={{ color: `var(--${cl})`, fontWeight: 800 }}>{n} (Deduction: {n * w}pts)</span></div>
              <div className="progress-bar mb-2"><div className="progress-fill" style={{ width: `${F.length ? Math.min(100, n / F.length * 100) : 0}%`, background: `var(--${cl})` }} /></div>
            </div>
          ))}
          <div className="text-[10px] mt-1" style={{ background: 'var(--bg3)', padding: '6px 8px', borderRadius: 6, color: 'var(--text3)' }}>
            <strong>Audit Score Formula:</strong> frozen at audit submit: 100 − (Critical×15) − (Major×10) − (Minor×5) − (Obs×2) = <strong style={{ color: `var(--${scoreColor})` }}>{overallScore === null ? 'N/A' : overallScore + '%'}</strong>
          </div>
        </Card>

        <Card title="Dept Delay Insights">
          {deptDelay.length ? deptDelay.map(d => (
            <div key={d.name}>
              <div className="flex justify-between items-center text-xs mb-1"><span className="font-bold">{d.name}</span><Badge type="b-red">{d.od} overdue</Badge></div>
              <div className="progress-bar mb-2"><div className="progress-fill" style={{ width: `${Math.min(100, d.od * 25)}%`, background: 'var(--red)' }} /></div>
            </div>
          )) : <div className="text-[10px]" style={{ color: 'var(--text3)' }}>No overdue CAPAs</div>}
        </Card>
      </div>

      {/* Monthly closure rate trend */}
      <Card title={`Monthly Closure Rate Trend — ${yr}`} action={<span className="text-[10px]" style={{ color: 'var(--text3)' }}>Closed till month-end / findings raised till month-end</span>}>
        {closureRows.length ? (
          <div className="table-wrap">
            <table style={{ fontSize: 11 }}>
              <thead><tr><th>Department</th>{MONTHS.map(m => <th key={m} style={{ textAlign: 'center' }}>{m}</th>)}</tr></thead>
              <tbody>
                {closureRows.map(r => (
                  <tr key={r.name}>
                    <td className="font-bold" style={{ whiteSpace: 'nowrap' }}>{r.name}</td>
                    {r.cells.map((c, i) => (
                      <td key={i} style={{ textAlign: 'center', fontWeight: c.val !== null ? 700 : 400, color: `var(--${c.color})` }}>
                        {c.val !== null ? `${c.val}%` : '—'}{c.arrow ? <span style={{ color: `var(--${c.arrow.c})`, fontSize: 9 }}> {c.arrow.t}</span> : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="text-[10px]" style={{ color: 'var(--text3)' }}>No findings yet — monthly closure rates will appear after findings are raised.</div>}
      </Card>

      {/* Monthly audit score */}
      <Card title={`Monthly Audit Score — ${yr}`} action={<span className="text-[10px]" style={{ color: 'var(--text3)' }}>Only audit months · score = 100 − weighted severity deductions</span>}>
        {scoreRows.length ? (
          <div className="table-wrap">
            <table style={{ fontSize: 11 }}>
              <thead><tr><th>Department</th>{MONTHS.map(m => <th key={m} style={{ textAlign: 'center', fontSize: 10 }}>{m}</th>)}</tr></thead>
              <tbody>
                {scoreRows.map(r => (
                  <tr key={r.name}>
                    <td className="font-bold" style={{ whiteSpace: 'nowrap' }}>{r.name}</td>
                    {r.cells.map((c, i) => (
                      <td key={i} style={{ textAlign: 'center', fontWeight: c.val !== null ? 800 : 400, color: `var(--${c.color})`, background: c.bg }}>{c.val !== null ? `${c.val}%` : '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="text-[10px]" style={{ color: 'var(--text3)' }}>No submitted audits yet — monthly scores will appear after audit submission.</div>}
        <div className="text-[10px] mt-2" style={{ background: 'var(--bg3)', padding: '6px 8px', borderRadius: 6, color: 'var(--text3)' }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(22,163,74,0.15)', border: '1px solid var(--green)', borderRadius: 2, marginRight: 3 }} />≥80% Compliant&nbsp;
          <span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(217,119,6,0.15)', border: '1px solid var(--amber)', borderRadius: 2, marginRight: 3 }} />60–79% At Risk&nbsp;
          <span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(220,38,38,0.15)', border: '1px solid var(--red)', borderRadius: 2, marginRight: 3 }} />&lt;60% Non-Compliant
        </div>
      </Card>

      {/* AI risk + recurring clauses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card title="AI Predictive Risk" action={<button className="btn btn-ghost btn-sm" onClick={exportPDF}><Icon name="download" /> Export PDF</button>}>
          {aiRisk.map((r, i) => (
            <div key={i} style={{ background: `var(--${r.col}-bg)`, border: `1px solid var(--${r.col})`, borderRadius: 8, padding: 9, marginBottom: 8 }}>
              <div className="flex justify-between items-center mb-1"><span className="font-bold text-xs">{r.name}</span><Badge type={`b-${r.col === 'red' ? 'red' : r.col === 'amber' ? 'amber' : 'green'}`}>{r.p}% risk</Badge></div>
              <div className="text-[10px] mb-2" style={{ color: 'var(--text3)' }}>{r.clauses}</div>
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${r.p}%`, background: `var(--${r.col})` }} /></div>
            </div>
          ))}
        </Card>

        <Card title="Top Recurring NC Clauses" action={<button className="btn btn-ghost btn-sm" onClick={exportExcel}><Icon name="download" /> Export Excel</button>}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Clause Name</th><th>Clause Description</th><th>NC Count</th><th>Severity Split</th></tr></thead>
              <tbody>
                {recurringClauses.length ? recurringClauses.map((t, i) => (
                  <tr key={t.clause}>
                    <td className="font-bold">{i + 1}</td>
                    <td><Badge type="b-blue">{clauseName(t.clause)}</Badge></td>
                    <td style={{ maxWidth: 210, fontSize: 11 }}>{sanitize(clauseDescription(t.clause))}</td>
                    <td style={{ fontWeight: 800, color: `var(--${t.count >= 5 ? 'red' : 'amber'})` }}>{t.count}</td>
                    <td><span className="text-[10px]">{t.critical} Critical / {t.major} Major / {t.minor} Minor</span></td>
                  </tr>
                )) : <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text3)', padding: 12 }}>No NC findings yet</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
