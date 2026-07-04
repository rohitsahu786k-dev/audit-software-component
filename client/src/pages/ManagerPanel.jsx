import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, EmptyState, StatCard } from '../components/UI';
import { fmtDate, SEV_BADGE, SEV_LABEL, STAT_BADGE, STAT_LABEL } from '../utils/helpers';

export default function ManagerPanel() {
  const { getFindings, currentUser } = useApp();
  const findings = getFindings();

  // Simple selector fallback for dept manager views
  const deptCode = currentUser?.dept || '';

  const deptFindings = useMemo(() => {
    return findings.filter(f => String(f.dept).toLowerCase() === deptCode.toLowerCase());
  }, [findings, deptCode]);

  const stats = useMemo(() => {
    const open = deptFindings.filter(f => ['open', 'in-progress'].includes(String(f.status || '').toLowerCase())).length;
    const pending = deptFindings.filter(f => String(f.status || '').toLowerCase() === 'pending-closure').length;
    const closed = deptFindings.filter(f => String(f.status || '').toLowerCase() === 'closed').length;
    return { open, pending, closed };
  }, [deptFindings]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Dept Open NCs" value={stats.open} color="var(--red)" />
        <StatCard label="Pending Approval" value={stats.pending} color="var(--purple)" />
        <StatCard label="Dept Closed NCs" value={stats.closed} color="var(--green)" />
      </div>

      <Card title={`Department Review: ${deptCode || 'N/A'}`}>
        {deptFindings.length === 0 ? (
          <EmptyState icon="folder" title="No departmental records found" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Description</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Due Date</th>
                  <th>Logged At</th>
                </tr>
              </thead>
              <tbody>
                {deptFindings.map(f => (
                  <tr key={f.id}>
                    <td className="font-bold">{f.ref || f.id}</td>
                    <td className="max-w-[250px] truncate">{f.desc || f.description}</td>
                    <td><Badge type={SEV_BADGE[f.sev || f.severity]}>{SEV_LABEL[f.sev || f.severity]}</Badge></td>
                    <td><Badge type={STAT_BADGE[f.status]}>{STAT_LABEL[f.status]}</Badge></td>
                    <td>{fmtDate(f.dueDate)}</td>
                    <td>{fmtDate(f.loggedAt || f.createdAt)}</td>
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
