import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Card, StatCard, ProgressBar } from '../components/UI';
import { SEV_LABEL } from '../utils/helpers';

export default function Analytics() {
  const { getFindings, getDepts } = useApp();
  const findings = getFindings();
  const depts = getDepts();

  const metrics = useMemo(() => {
    const total = findings.length;
    if (!total) return { criticalPct: 0, majorPct: 0, complianceRate: 100 };
    const critical = findings.filter(f => String(f.sev || f.severity || '').toLowerCase() === 'critical').length;
    const major = findings.filter(f => String(f.sev || f.severity || '').toLowerCase() === 'major').length;
    const closed = findings.filter(f => String(f.status || '').toLowerCase() === 'closed').length;
    return {
      criticalPct: Math.round((critical / total) * 100),
      majorPct: Math.round((major / total) * 100),
      complianceRate: Math.round((closed / total) * 100),
    };
  }, [findings]);

  return (
    <div className="space-y-4">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Overall Compliance" value={`${metrics.complianceRate}%`} color="var(--green)" />
        <StatCard label="Critical NCs Ratio" value={`${metrics.criticalPct}%`} color="var(--red)" />
        <StatCard label="Major NCs Ratio" value={`${metrics.majorPct}%`} color="var(--amber)" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Severity chart mock */}
        <Card title="Non-Conformance Distribution">
          <div className="space-y-4 py-3">
            {['critical', 'major', 'minor', 'obs'].map(s => {
              const cnt = findings.filter(f => String(f.sev || f.severity || '').toLowerCase() === s).length;
              const pct = findings.length ? Math.round((cnt / findings.length) * 100) : 0;
              return (
                <div key={s} className="space-y-1">
                  <div className="flex justify-between text-xs font-bold">
                    <span>{SEV_LABEL[s]}</span>
                    <span>{cnt} ({pct}%)</span>
                  </div>
                  <ProgressBar value={pct} color={s === 'critical' ? 'var(--red)' : s === 'major' ? 'var(--amber)' : 'var(--teal)'} />
                </div>
              );
            })}
          </div>
        </Card>

        {/* Dept Compliance chart mock */}
        <Card title="Department Compliance Scorecard">
          <div className="space-y-3">
            {depts.slice(0, 6).map(d => {
              const df = findings.filter(f => String(f.dept || '').toLowerCase() === String(d.code || d.name || '').toLowerCase());
              const closed = df.filter(f => String(f.status || '').toLowerCase() === 'closed').length;
              const score = df.length ? Math.round((closed / df.length) * 100) : 100;
              return (
                <div key={d.id || d.code} className="flex items-center gap-3">
                  <span className="text-xs font-bold w-24 truncate">{d.name || d.code}</span>
                  <div className="flex-1">
                    <ProgressBar value={score} color={score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--amber)' : 'var(--red)'} />
                  </div>
                  <span className="text-xs font-extrabold w-8 text-right">{score}%</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
