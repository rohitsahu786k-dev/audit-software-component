import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, EmptyState } from '../components/UI';
import { fmtDate, SEV_BADGE, SEV_LABEL, STAT_BADGE, STAT_LABEL } from '../utils/helpers';

export default function MyTasks() {
  const { getFindings, currentUser } = useApp();
  const findings = getFindings();

  const myTasks = useMemo(() => {
    return findings.filter(f => {
      const matchDept = currentUser?.dept && String(f.dept).toLowerCase() === String(currentUser.dept).toLowerCase();
      const isOpen = ['open', 'in-progress', 'delayed'].includes(String(f.status || '').toLowerCase());
      return matchDept && isOpen;
    });
  }, [findings, currentUser]);

  return (
    <div className="space-y-3">
      <Card title={`Pending Action Items — Dept: ${currentUser?.dept || 'N/A'}`}>
        {myTasks.length === 0 ? (
          <EmptyState icon="smile" title="All caught up!" subtitle="No pending compliance findings logged for your department." />
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
                {myTasks.map(f => (
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
