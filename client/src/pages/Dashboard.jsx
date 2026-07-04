import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { StatCard, Card, ProgressBar, Badge } from '../components/UI';
import { fmtDate, SEV_BADGE, SEV_LABEL, STAT_BADGE, STAT_LABEL, auditScore } from '../utils/helpers';

export default function Dashboard() {
  const { getFindings, getDepts, getAuditors, getCompletedAudits, getPlannedAudits, getCheckpoints } = useApp();

  const findings = getFindings();
  const depts = getDepts();
  const auditors = getAuditors();
  const completed = getCompletedAudits();
  const planned = getPlannedAudits();
  const cps = getCheckpoints();

  const stats = useMemo(() => {
    const open   = findings.filter(f => ['open','in-progress'].includes(String(f.status||'').toLowerCase())).length;
    const delayed= findings.filter(f => String(f.status||'').toLowerCase() === 'delayed').length;
    const closed = findings.filter(f => String(f.status||'').toLowerCase() === 'closed').length;
    const critical = findings.filter(f => String(f.sev||f.severity||'').toLowerCase() === 'critical').length;
    const major    = findings.filter(f => String(f.sev||f.severity||'').toLowerCase() === 'major').length;
    const pending  = findings.filter(f => String(f.status||'').toLowerCase() === 'pending-closure').length;
    const compliance = findings.length ? Math.round((closed / findings.length) * 100) : 100;
    return { open, delayed, closed, critical, major, pending, compliance };
  }, [findings]);

  const recentFindings = findings.slice().sort((a,b) => new Date(b.loggedAt||b.createdAt||0) - new Date(a.loggedAt||a.createdAt||0)).slice(0, 8);

  return (
    <div className="space-y-4">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Open Findings"    value={stats.open}       color="var(--red)"   />
        <StatCard label="Delayed"          value={stats.delayed}    color="var(--amber)" />
        <StatCard label="Submit For Review" value={stats.pending}   color="var(--purple)" />
        <StatCard label="Closed"           value={stats.closed}     color="var(--green)" />
        <StatCard label="Compliance %"     value={`${stats.compliance}%`} color="var(--accent)" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Summary */}
        <div className="lg:col-span-2">
          <Card title="Findings by Severity">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { sev: 'critical', color: 'var(--red)',    label: 'Critical' },
                { sev: 'major',    color: 'var(--amber)',  label: 'Major' },
                { sev: 'minor',    color: 'var(--teal)',   label: 'Minor' },
                { sev: 'obs',      color: 'var(--purple)', label: 'Obs' },
              ].map(({ sev, color, label }) => {
                const cnt = findings.filter(f => String(f.sev||f.severity||'').toLowerCase() === sev).length;
                return (
                  <div key={sev} className="text-center p-3 rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg3)' }}>
                    <div className="text-2xl font-black" style={{ color }}>{cnt}</div>
                    <div className="text-[10px] font-bold mt-1" style={{ color: 'var(--text3)' }}>{label}</div>
                  </div>
                );
              })}
            </div>
            <div className="space-y-2">
              {depts.slice(0, 6).map(d => {
                const df = findings.filter(f => String(f.dept||'').toLowerCase() === String(d.code||d.name||'').toLowerCase());
                const closed = df.filter(f => String(f.status||'').toLowerCase() === 'closed').length;
                const pct = df.length ? Math.round((closed/df.length)*100) : 100;
                return (
                  <div key={d.id || d.code} className="flex items-center gap-3">
                    <div className="text-xs font-bold w-24 truncate flex-shrink-0">{d.name || d.code}</div>
                    <div className="flex-1">
                      <ProgressBar value={pct} color={pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)'} />
                    </div>
                    <div className="text-[10px] w-8 text-right font-bold" style={{ color: 'var(--text3)' }}>{pct}%</div>
                    <div className="text-[10px] w-12 text-right" style={{ color: 'var(--text3)' }}>{df.length} NC</div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Sidebar cards */}
        <div className="space-y-3">
          <Card title="Portal Snapshot">
            <div className="space-y-2">
              {[
                { l: 'Departments',     v: depts.length,    c: 'var(--accent)' },
                { l: 'Auditors',        v: auditors.length, c: 'var(--purple)' },
                { l: 'Checkpoints',     v: cps.length,      c: 'var(--teal)' },
                { l: 'Completed Audits',v: completed.length,c: 'var(--green)' },
                { l: 'Planned Audits',  v: planned.length,  c: 'var(--amber)' },
              ].map(({ l, v, c }) => (
                <div key={l} className="flex items-center justify-between py-1 border-b last:border-b-0" style={{ borderColor: 'var(--bg3)' }}>
                  <span className="text-xs" style={{ color: 'var(--text2)' }}>{l}</span>
                  <span className="text-sm font-extrabold" style={{ color: c }}>{v}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Recent Findings */}
      <Card title="Recent Non-Conformances">
        {recentFindings.length === 0 ? (
          <div className="text-center py-8 text-xs" style={{ color: 'var(--text3)' }}>No findings logged yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Description</th>
                  <th>Dept</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentFindings.map(f => (
                  <tr key={f.id}>
                    <td className="font-bold" style={{ color: 'var(--text)' }}>{f.ref || f.id}</td>
                    <td className="max-w-[200px] truncate">{f.desc || f.description}</td>
                    <td><Badge type="b-blue">{f.dept}</Badge></td>
                    <td><Badge type={SEV_BADGE[f.sev||f.severity] || 'b-gray'}>{SEV_LABEL[f.sev||f.severity] || f.sev}</Badge></td>
                    <td><Badge type={STAT_BADGE[f.status] || 'b-gray'}>{STAT_LABEL[f.status] || f.status}</Badge></td>
                    <td className="whitespace-nowrap text-[11px]" style={{ color: 'var(--text3)' }}>{fmtDate(f.loggedAt || f.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
