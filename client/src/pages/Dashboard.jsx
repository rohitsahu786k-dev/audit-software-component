import React, { useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Badge, Card, Icon } from '../components/UI';
import { fmtDate, SEV_BADGE, SEV_LABEL } from '../utils/helpers';
import {
  auditFindingCounts,
  closureRate,
  latestDeptAuditScore,
  orgLatestAuditScore,
  deptRecordForFinding,
  deptCodeForFinding,
  deptNameForFinding,
  findingMatchesDept,
  canonicalRootCauseName,
  dashboardRootCauseCategories,
  completedAuditsSorted,
  deptRecordForValue,
  deptValuesMatch,
  findingMatchesDeptCode,
  normalizeAuditSeverity,
  deptToken,
  delayDays
} from '../utils/dashboardHelpers';

export default function Dashboard({ dateFrom, dateTo }) {
  const {
    getFindings,
    getDepts,
    getCompletedAudits,
    currentUser,
    navigate,
    setFindingsDeptFilter,
    setCapaSelectedId,
    setPageAction
  } = useApp();

  useEffect(() => {
    setPageAction(() => () => navigate('planning'));
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rawFindings = getFindings();
  const depts = getDepts();
  const completed = getCompletedAudits();

  // Filter findings based on date range and currentUser department restriction (for SPOC role)
  const F = useMemo(() => {
    let list = rawFindings;
    if (dateFrom) {
      list = list.filter(f => (f.loggedAt || f.createdAt || '') >= dateFrom);
    }
    if (dateTo) {
      list = list.filter(f => (f.loggedAt || f.createdAt || '') <= dateTo + 'T23:59:59');
    }
    const role = currentUser?.role || 'viewer';
    const dept = currentUser?.dept || '';
    if (role === 'spoc') {
      list = list.filter(f => findingMatchesDeptCode(depts, f, dept));
    }
    return list;
  }, [rawFindings, dateFrom, dateTo, currentUser, depts]);

  const open = useMemo(() => F.filter(f => f.status !== 'closed').length, [F]);

  const visibleDepts = useMemo(() => {
    const role = currentUser?.role || 'viewer';
    const dept = currentUser?.dept || '';
    let list = depts;
    if (role === 'spoc') {
      list = depts.filter(d => deptValuesMatch(depts, d.code, dept) || deptValuesMatch(depts, d.name, dept));
    }
    const byAlias = new Map();
    list.forEach(d => {
      const key = deptToken(d.name) || deptToken(d.code);
      const prev = byAlias.get(key);
      if (!prev) {
        byAlias.set(key, d);
      } else {
        const hasFindings = rawFindings.some(f => f.dept === d.code || f.deptName === d.name);
        const prevHasFindings = rawFindings.some(f => f.dept === prev.code || f.deptName === prev.name);
        if (hasFindings && !prevHasFindings) byAlias.set(key, d);
      }
    });
    return [...byAlias.values()];
  }, [depts, currentUser, rawFindings]);

  const overallAuditScore = useMemo(() => {
    return orgLatestAuditScore(completed, rawFindings, visibleDepts);
  }, [completed, rawFindings, visibleDepts]);

  const deptScores = useMemo(() => {
    return visibleDepts.map(d => {
      const df = F.filter(f => findingMatchesDept(depts, f, d));
      const counts = auditFindingCounts(df);
      const scoreInfo = latestDeptAuditScore(completed, rawFindings, depts, d.code);
      const score = scoreInfo && typeof scoreInfo.score === 'number' ? scoreInfo.score : null;
      const closed = df.filter(f => f.status === 'closed').length;
      const inprog = df.filter(f => {
        const ws = String(f.status || '').toLowerCase();
        return ws === 'in-progress' || ws === 'pending-closure' || ws === 'open';
      }).length;
      const delayed = df.filter(f => f.status !== 'closed' && (f.status === 'delayed' || delayDays(f) > 0)).length;
      return {
        name: d.name,
        score,
        scoreInfo,
        findings: df.length,
        open: df.filter(f => f.status !== 'closed').length,
        delayed,
        inprog,
        closed,
        cr: closureRate(df),
        c: counts.critical,
        ma: counts.major,
        mi: counts.minor,
        ob: counts.obs,
        code: d.code
      };
    });
  }, [visibleDepts, F, completed, rawFindings, depts]);

  const sorted = useMemo(() => {
    return [...deptScores].filter(d => d.score !== null).sort((a, b) => b.score - a.score);
  }, [deptScores]);

  const top5 = useMemo(() => sorted.slice(0, 5), [sorted]);
  const bot5 = useMemo(() => sorted.slice(-5).reverse(), [sorted]);

  const activeDeptScores = useMemo(() => {
    return deptScores.filter(d => d.score !== null || d.findings > 0);
  }, [deptScores]);

  const auditScoreColor = (score) => {
    if (score === null) return 'var(--text3)';
    return score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--amber)' : 'var(--red)';
  };

  const auditScoreBadge = (score) => {
    if (score === null) return 'b-gray';
    return score >= 80 ? 'b-green' : score >= 60 ? 'b-amber' : 'b-red';
  };

  const auditScoreStatus = (score) => {
    if (score === null) return 'Not Audited';
    return score >= 80 ? 'Compliant' : score >= 60 ? 'At Risk' : 'Non-Compliant';
  };

  // Critical Alerts list (up to 3 non-closed critical severity findings)
  const criticalAlerts = useMemo(() => {
    return F.filter(f => f.status !== 'closed' && normalizeAuditSeverity(f.sev || f.severity) === 'critical').slice(0, 3);
  }, [F]);

  // Root Cause Analysis mapping
  const rcCats = useMemo(() => dashboardRootCauseCategories(F), [F]);
  const rcColors = ['#c0392b', '#2563eb', '#d97706', '#0d9488', '#7c3aed', '#16a34a', '#8b92a8', '#be123c', '#0f766e', '#4f46e5', '#a16207', '#15803d', '#7e22ce', '#475569'];

  const { rcDepts, rcMap } = useMemo(() => {
    const map = {};
    const rowMap = {};
    F.forEach(f => {
      const deptRec = deptRecordForFinding(depts, f);
      const dept = deptRec ? deptRec.name : deptNameForFinding(depts, f);
      const deptKey = deptRec ? deptRec.code : deptCodeForFinding(depts, f);
      const rc = canonicalRootCauseName(f.rc || f.rootCause || 'Unclassified');
      if (!rowMap[deptKey]) rowMap[deptKey] = { key: deptKey, name: dept, total: 0 };
      rowMap[deptKey].total++;
      const key = deptKey + '|' + rc;
      map[key] = (map[key] || 0) + 1;
    });
    const sortedDepts = Object.values(rowMap).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { rcDepts: sortedDepts, rcMap: map };
  }, [F, depts]);

  // Department Non-Closed Finding Matrix & SVG Chart logic
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const auditedRows = useMemo(() => {
    return completedAuditsSorted(completed, rawFindings, depts);
  }, [completed, rawFindings, depts]);

  const matrixDepts = useMemo(() => {
    const auditedCodes = new Set(auditedRows.map(a => String(a && a.dept || '').trim()).filter(Boolean));
    const list = visibleDepts.filter(d => auditedCodes.has(d.code) || completedAuditsSorted(completed, rawFindings, depts, d.code).length > 0);
    auditedRows.forEach(a => {
      const rec = deptRecordForValue(depts, a && a.dept) || deptRecordForValue(depts, a && a.deptName);
      const row = rec || { code: String((a && a.dept) || (a && a.deptName) || '').trim(), name: String((a && a.deptName) || (a && a.dept) || '').trim() };
      if (!row.code) return;
      const role = currentUser?.role || 'viewer';
      const dept = currentUser?.dept || '';
      if (role === 'spoc' && !deptValuesMatch(depts, row.code, dept) && !deptValuesMatch(depts, row.name, dept)) return;
      if (!list.some(d => deptValuesMatch(depts, d.code, row.code) || deptValuesMatch(depts, d.name, row.name))) {
        list.push(row);
      }
    });
    return list;
  }, [auditedRows, visibleDepts, completed, rawFindings, depts, currentUser]);

  const ncRows = useMemo(() => {
    return matrixDepts.map(d => {
      const df = F.filter(f => findingMatchesDept(depts, f, d) && f.status !== 'closed');
      const cr = df.filter(f => f.sev === 'critical').length;
      const ma = df.filter(f => f.sev === 'major').length;
      const mi = df.filter(f => f.sev === 'minor').length;
      const ob = df.filter(f => f.sev === 'obs').length;
      const od = df.filter(f => {
        if (!f.due && !f.dueDate) return false;
        const dueD = new Date(f.due || f.dueDate);
        return !isNaN(dueD) && dueD < today;
      }).length;
      const tot = df.length;
      return { code: d.code, name: d.name, cr, ma, mi, ob, od, tot };
    }).sort((a, b) => b.tot - a.tot || a.name.localeCompare(b.name));
  }, [matrixDepts, F, depts, today]);

  const ncTotals = useMemo(() => {
    return ncRows.reduce((acc, r) => {
      acc.cr += r.cr;
      acc.ma += r.ma;
      acc.mi += r.mi;
      acc.ob += r.ob;
      acc.od += r.od;
      acc.tot += r.tot;
      return acc;
    }, { cr: 0, ma: 0, mi: 0, ob: 0, od: 0, tot: 0 });
  }, [ncRows]);

  // Bar chart geometry
  const chartGeometry = useMemo(() => {
    const maxV = Math.max(...ncRows.map(r => r.tot), 1);
    const barH = 22, barGap = 8, labelW = 170, valW = 42, plotL = labelW + 8, plotR = valW + 8;
    const chartW = 860, plotW = chartW - plotL - plotR;
    const chartH = ncRows.length * (barH + barGap) + 20;
    const ticks = 4;
    const tickVals = Array.from({ length: ticks + 1 }, (_, i) => Math.ceil(maxV * i / ticks));
    const colorOf = (v) => v >= 10 ? 'var(--red)' : v >= 5 ? 'var(--amber)' : v >= 1 ? 'var(--teal)' : 'var(--green)';
    return { maxV, barH, barGap, labelW, valW, plotL, plotR, chartW, plotW, chartH, ticks, tickVals, colorOf };
  }, [ncRows]);

  const handleDeptClick = (code) => {
    setFindingsDeptFilter(code);
    navigate('findings');
  };

  const handleAlertClick = (finding) => {
    setCapaSelectedId(finding.id || finding.ref);
    navigate('capa');
  };

  return (
    <div className="space-y-4">
      {/* Critical Alerts Block (if any exist) */}
      {criticalAlerts.length > 0 && (
        <div className="p-3 bg-[var(--red-bg)] border border-red-200 rounded-xl space-y-2">
          <div className="text-xs font-extrabold text-[var(--red)] uppercase tracking-wider flex items-center gap-1">
            <Icon name="triangle-alert" className="w-3.5 h-3.5" /> Critical Actions Pending
          </div>
          <div className="space-y-1">
            {criticalAlerts.map(f => (
              <div
                key={f.id}
                className="text-xs text-[var(--text)] hover:underline cursor-pointer flex justify-between items-center bg-[var(--bg2)] p-2 rounded border border-[var(--border)]"
                onClick={() => handleAlertClick(f)}
              >
                <span>
                  Critical finding in <span className="font-bold">{f.deptName || f.dept}</span> logged on {fmtDate(f.loggedAt || f.createdAt)}. Action Required.
                </span>
                <span className="text-[10px] text-[var(--text3)] hover:text-[var(--brand)]">Resolve CAPA →</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="stat-label">Audit Score</div>
          <div className="stat-value" style={{ color: auditScoreColor(overallAuditScore) }}>
            {overallAuditScore === null ? 'N/A' : `${overallAuditScore}%`}
          </div>
          <div className="stat-delta text-[var(--text3)]">Latest frozen audit avg.</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Open Findings</div>
          <div className="stat-value" style={{ color: 'var(--amber)' }}>
            {open}
          </div>
          <div className="stat-delta text-[var(--red)] font-extrabold">
            {F.filter(f => normalizeAuditSeverity(f.sev || f.severity) === 'critical' && f.status !== 'closed').length} critical
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Closure Rate</div>
          <div className="stat-value" style={{ color: closureRate(F) >= 90 ? 'var(--green)' : closureRate(F) >= 60 ? 'var(--amber)' : 'var(--red)' }}>
            {closureRate(F)}%
          </div>
          <div className="stat-delta text-[var(--text3)]">Target 90%</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Completed Audits</div>
          <div className="stat-value">
            {completed.length}
          </div>
          <div className="stat-delta text-[var(--text3)]">Total to date</div>
        </div>
      </div>

      {/* Department Summary & Secondary Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <Card title="Department Summary">
            {activeDeptScores.length === 0 ? (
              <div className="text-center py-8 text-xs" style={{ color: 'var(--text3)' }}>No departments active for the selected date range.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th>Total</th>
                      <th style={{ color: 'var(--red)' }}>Open</th>
                      <th style={{ color: 'var(--red)' }}>Delayed</th>
                      <th style={{ color: 'var(--amber)' }}>In Process</th>
                      <th style={{ color: 'var(--green)' }}>Closed</th>
                      <th>Audit Score</th>
                      <th>Closure %</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeDeptScores.map(d => (
                      <tr key={d.code}>
                        <td className="font-bold text-[var(--text)]">{d.name}</td>
                        <td className="font-bold">{d.findings}</td>
                        <td style={{ color: 'var(--red)', fontWeight: d.open ? 800 : 400 }}>{d.open || '—'}</td>
                        <td style={{ color: 'var(--red)', fontWeight: d.delayed ? 800 : 400 }}>
                          {d.delayed ? <span className="badge b-red" style={{ padding: '2px 7px', fontSize: 11, fontWeight: 800 }}>{d.delayed}</span> : '—'}
                        </td>
                        <td style={{ color: 'var(--amber)', fontWeight: d.inprog ? 800 : 400 }}>{d.inprog || '—'}</td>
                        <td style={{ color: 'var(--green)', fontWeight: d.closed ? 800 : 400 }}>{d.closed || '—'}</td>
                        <td style={{ color: auditScoreColor(d.score), fontWeight: 800 }}>
                          {d.score === null ? 'N/A' : `${d.score}%`}
                          {d.scoreInfo && d.scoreInfo.delta !== null && (
                            <span
                              className="text-[10px] ml-1 inline-block"
                              style={{ color: d.scoreInfo.delta > 0 ? 'var(--green)' : d.scoreInfo.delta < 0 ? 'var(--red)' : 'var(--text3)' }}
                              title={`Previous: ${d.scoreInfo.prevScore}%${d.scoreInfo.prev ? ` on ${fmtDate(d.scoreInfo.prev.submittedAt || d.scoreInfo.prev.date)}` : ''}`}
                            >
                              {d.scoreInfo.delta > 0 ? '▲' : d.scoreInfo.delta < 0 ? '▼' : '→'}
                              {Math.abs(d.scoreInfo.delta)}
                            </span>
                          )}
                        </td>
                        <td style={{ color: d.cr >= 90 ? 'var(--green)' : d.cr >= 60 ? 'var(--amber)' : 'var(--red)' }}>{d.cr}%</td>
                        <td>
                          <Badge type={auditScoreBadge(d.score)}>
                            {auditScoreStatus(d.score)}
                          </Badge>
                        </td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleDeptClick(d.code)}>
                            →
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 900, background: 'var(--bg3)' }}>
                      <td>TOTAL</td>
                      <td>{activeDeptScores.reduce((s, d) => s + d.findings, 0)}</td>
                      <td style={{ color: 'var(--red)' }}>{activeDeptScores.reduce((s, d) => s + d.open, 0)}</td>
                      <td style={{ color: 'var(--red)' }}>
                        {activeDeptScores.reduce((s, d) => s + d.delayed, 0) ? (
                          <span className="badge b-red" style={{ padding: '2px 7px', fontSize: 11, fontWeight: 800 }}>
                            {activeDeptScores.reduce((s, d) => s + d.delayed, 0)}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ color: 'var(--amber)' }}>{activeDeptScores.reduce((s, d) => s + d.inprog, 0)}</td>
                      <td style={{ color: 'var(--green)' }}>{activeDeptScores.reduce((s, d) => s + d.closed, 0)}</td>
                      <td style={{ color: 'var(--brand)' }}>{overallAuditScore === null ? 'N/A' : `${overallAuditScore}%`}</td>
                      <td style={{ color: 'var(--brand)' }}>{closureRate(F)}%</td>
                      <td colSpan="2"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-3">
          {/* Recent Non-Conformances or Critical Highlights */}
          <Card title="Critical Highlights">
            <div className="space-y-2">
              {F.filter(f => f.status !== 'closed').slice(0, 3).map(f => (
                <div
                  key={f.id}
                  className={`finding-card cursor-pointer border-l-4 p-2 rounded bg-[var(--bg3)] hover:bg-[var(--bg2)] ${
                    normalizeAuditSeverity(f.sev || f.severity) === 'critical' ? 'border-red-500' : 'border-amber-500'
                  }`}
                  onClick={() => handleAlertClick(f)}
                >
                  <div className="flex justify-between items-start">
                    <span className="font-bold text-xs">{f.ref}</span>
                    <Badge type={SEV_BADGE[f.sev || f.severity] || 'b-gray'}>{SEV_LABEL[f.sev || f.severity] || f.sev}</Badge>
                  </div>
                  <div className="text-[11px] mt-1 text-[var(--text2)] truncate">
                    {f.deptName || f.dept} · {f.desc || f.description}
                  </div>
                  <div className="text-[10px] mt-1 flex justify-between" style={{ color: f.status === 'delayed' ? 'var(--red)' : 'var(--amber)' }}>
                    <span>{f.clause || 'Clause N/A'}</span>
                    <span>{f.status === 'delayed' ? 'Overdue' : (f.due || f.dueDate || '')}</span>
                  </div>
                </div>
              ))}
              {F.filter(f => f.status !== 'closed').length === 0 && (
                <div className="text-center py-4 text-xs text-[var(--text3)]">No open non-conformances.</div>
              )}
              <button className="btn btn-ghost btn-sm w-full mt-1" onClick={() => navigate('findings')}>
                View All Findings →
              </button>
            </div>
          </Card>

          {/* Findings by Clause */}
          <Card title="Findings by Clause">
            <div className="flex gap-2 flex-wrap mt-2">
              {(() => {
                const clauseMap = {};
                F.forEach(f => {
                  const cl = String(f.clause || 'Other');
                  const base = cl.split('.')[0];
                  clauseMap[base] = (clauseMap[base] || 0) + 1;
                });
                const entries = Object.entries(clauseMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
                return entries.length ? entries.map(([cl, n]) => {
                  const clr = n >= 5 ? 'red' : n >= 2 ? 'amber' : 'green';
                  return (
                    <div
                      key={cl}
                      style={{
                        background: `var(--${clr}-bg)`,
                        border: `1px solid var(--${clr})`,
                        borderRadius: '7px',
                        padding: '6px 8px',
                        textAlign: 'center',
                        minWidth: '54px'
                      }}
                    >
                      <div style={{ fontSize: '11px', fontWeight: 800, color: `var(--${clr})` }}>{cl}</div>
                      <div style={{ fontSize: '9px', color: `var(--${clr})`, fontWeight: 700 }}>{n} NC(s)</div>
                    </div>
                  );
                }) : (
                  <div className="text-xs text-[var(--text3)]">No findings data yet — conduct audits to populate this view.</div>
                );
              })()}
            </div>
          </Card>
        </div>
      </div>

      {/* Root Cause Analysis Matrix */}
      <Card title="Department-wise Root Cause Analysis">
        {F.length === 0 ? (
          <div className="text-xs py-4 text-[var(--text3)]">No findings data — conduct audits to see root cause analysis.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Department</th>
                  {rcCats.map((ct, ci) => (
                    <th key={ct} style={{ color: rcColors[ci % rcColors.length], fontSize: '9px', textAlign: 'center' }}>
                      {ct}
                    </th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {rcDepts.map(d => {
                  let total = 0;
                  return (
                    <tr key={d.key}>
                      <td className="font-bold text-[var(--text)]">{d.name}</td>
                      {rcCats.map((ct, ci) => {
                        const key = d.key + '|' + ct;
                        const v = rcMap[key] || 0;
                        total += v;
                        return (
                          <td key={ct} style={{ textAlign: 'center', fontWeight: v ? '800' : '400', color: v ? rcColors[ci % rcColors.length] : 'var(--text3)' }}>
                            {v || '—'}
                          </td>
                        );
                      })}
                      <td className="font-bold text-[var(--text)]">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Performers Split */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card title="Top 5 Performers">
          {top5.length === 0 ? (
            <div className="text-center py-4 text-xs text-[var(--text3)]">No audit data available yet.</div>
          ) : (
            <div className="space-y-2 mt-2">
              {top5.map((d, i) => (
                <div key={d.name} className="flex items-center gap-3">
                  <div
                    className="flex items-center justify-center text-xs font-bold w-6 h-6 rounded-full flex-shrink-0"
                    style={{
                      background: i === 0 ? '#fbbf24' : i === 1 ? '#9ca3af' : i === 2 ? '#c0905c' : 'var(--bg3)',
                      color: i < 3 ? '#fff' : 'var(--text2)'
                    }}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-bold">{d.name}</div>
                    <div className="progress-bar mt-1">
                      <div className="progress-fill" style={{ width: `${d.score}%`, background: 'var(--green)' }} />
                    </div>
                  </div>
                  <span className="text-xs font-extrabold" style={{ color: 'var(--green)' }}>{d.score}%</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Bottom 5 — Needs Attention">
          {bot5.length === 0 ? (
            <div className="text-center py-4 text-xs text-[var(--text3)]">No audit data available yet.</div>
          ) : (
            <div className="space-y-2 mt-2">
              {bot5.map((d, i) => (
                <div key={d.name} className="flex items-center gap-3">
                  <div
                    className="flex items-center justify-center text-xs font-bold w-6 h-6 rounded-full flex-shrink-0"
                    style={{ background: 'var(--bg3)', color: 'var(--text2)' }}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-bold">{d.name}</div>
                    <div className="progress-bar mt-1">
                      <div className="progress-fill" style={{ width: `${d.score}%`, background: 'var(--red)' }} />
                    </div>
                  </div>
                  <span className="text-xs font-extrabold" style={{ color: 'var(--red)' }}>{d.score}%</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* NC Status Matrix & SVG Horizontal Bar Chart */}
      {ncRows.length > 0 ? (
        <Card title="NC Status Matrix — Non-Closed Findings by Department">
          <div className="space-y-4">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Department</th>
                    <th style={{ textAlign: 'center', color: 'var(--red)' }}>Critical</th>
                    <th style={{ textAlign: 'center', color: 'var(--amber)' }}>Major</th>
                    <th style={{ textAlign: 'center', color: 'var(--teal)' }}>Minor</th>
                    <th style={{ textAlign: 'center', color: 'var(--purple)' }}>Obs</th>
                    <th style={{ textAlign: 'center', color: 'var(--red)' }}>Overdue</th>
                    <th style={{ textAlign: 'center' }}>Total Non-Closed</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ncRows.map(r => (
                    <tr key={r.code}>
                      <td className="font-bold text-[var(--text)]">{r.name} <span className="text-[10px] text-[var(--text3)]">({r.code})</span></td>
                      <td style={{ textAlign: 'center', color: 'var(--red)', fontWeight: r.cr ? 900 : 400 }}>{r.cr || '—'}</td>
                      <td style={{ textAlign: 'center', color: 'var(--amber)', fontWeight: r.ma ? 900 : 400 }}>{r.ma || '—'}</td>
                      <td style={{ textAlign: 'center', color: 'var(--teal)', fontWeight: r.mi ? 900 : 400 }}>{r.mi || '—'}</td>
                      <td style={{ textAlign: 'center', color: 'var(--purple)', fontWeight: r.ob ? 900 : 400 }}>{r.ob || '—'}</td>
                      <td style={{ textAlign: 'center', color: 'var(--red)', fontWeight: r.od ? 900 : 400 }}>{r.od || '—'}</td>
                      <td style={{ textAlign: 'center', fontWeight: 900, color: r.tot >= 10 ? 'var(--red)' : r.tot >= 5 ? 'var(--amber)' : 'var(--text)' }}>{r.tot}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleDeptClick(r.code)}>
                          →
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 900, background: 'var(--bg3)' }}>
                    <td>TOTAL</td>
                    <td style={{ textAlign: 'center', color: 'var(--red)' }}>{ncTotals.cr}</td>
                    <td style={{ textAlign: 'center', color: 'var(--amber)' }}>{ncTotals.ma}</td>
                    <td style={{ textAlign: 'center', color: 'var(--teal)' }}>{ncTotals.mi}</td>
                    <td style={{ textAlign: 'center', color: 'var(--purple)' }}>{ncTotals.ob}</td>
                    <td style={{ textAlign: 'center', color: 'var(--red)' }}>{ncTotals.od}</td>
                    <td style={{ textAlign: 'center', color: 'var(--brand)' }}>{ncTotals.tot}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Horizontal Bar Chart */}
            <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--bg3)]">
              <div className="text-xs font-bold text-[var(--text2)] mb-2">Total Non-Closed Findings by Department (descending)</div>
              <div className="w-full overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                <svg
                  viewBox={`0 0 ${chartGeometry.chartW} ${chartGeometry.chartH + 38}`}
                  preserveAspectRatio="xMinYMin meet"
                  style={{ width: '100%', minWidth: '560px', height: 'auto', fontFamily: 'var(--font)', display: 'block' }}
                >
                  {/* gridlines + x-axis tick labels */}
                  {chartGeometry.tickVals.map((v, i) => {
                    const x = chartGeometry.plotL + chartGeometry.plotW * i / chartGeometry.ticks;
                    return (
                      <g key={i}>
                        <line
                          x1={x}
                          y1="14"
                          x2={x}
                          y2={chartGeometry.chartH + 4}
                          stroke="var(--border)"
                          strokeWidth={i === 0 ? 1.4 : 0.6}
                          strokeDasharray={i === 0 ? '0' : '2,3'}
                        />
                        <text x={x} y={chartGeometry.chartH + 18} textAnchor="middle" fontSize="10" fill="var(--text3)" fontWeight="700">
                          {v}
                        </text>
                      </g>
                    );
                  })}
                  <text
                    x={chartGeometry.plotL + chartGeometry.plotW / 2}
                    y={chartGeometry.chartH + 34}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--text3)"
                    fontWeight="800"
                    letterSpacing="0.5"
                  >
                    NUMBER OF NON-CLOSED FINDINGS
                  </text>
                  {/* bars + labels */}
                  {ncRows.map((r, i) => {
                    const y = 20 + i * (chartGeometry.barH + chartGeometry.barGap);
                    const w = Math.max(2, chartGeometry.plotW * r.tot / chartGeometry.maxV);
                    const lbl = r.name.length > 26 ? r.name.slice(0, 24) + '…' : r.name;
                    return (
                      <g key={r.code}>
                        <text x={chartGeometry.labelW} y={y + chartGeometry.barH / 2 + 4} textAnchor="end" fontSize="11" fill="var(--text)" fontWeight="700">
                          {lbl}
                        </text>
                        <rect x={chartGeometry.plotL} y={y} width={w} height={chartGeometry.barH} rx="3" fill={chartGeometry.colorOf(r.tot)} opacity="0.9">
                          <title>{`${r.name} — ${r.tot} non-closed (C:${r.cr} Ma:${r.ma} Mi:${r.mi} Ob:${r.ob} Od:${r.od})`}</title>
                        </rect>
                        <text x={chartGeometry.plotL + w + 6} y={y + chartGeometry.barH / 2 + 4} fontSize="11" fill="var(--text)" fontWeight="900">
                          {r.tot}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="flex gap-3 flex-wrap mt-2 text-[10px] text-[var(--text3)] font-bold">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-[var(--red)] rounded-sm" /> &ge;10 findings
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-[var(--amber)] rounded-sm" /> 5–9 findings
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-[var(--teal)] rounded-sm" /> 1–4 findings
                </span>
                <span className="ml-auto italic">Hover bars for severity breakdown &middot; "Overdue" = past due date</span>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card title="NC Status Matrix — Non-Closed Findings by Department">
          <div className="text-xs text-[var(--text3)] py-4">No open non-conformities — all clear.</div>
        </Card>
      )}
    </div>
  );
}
