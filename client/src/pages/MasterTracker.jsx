import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge } from '../components/UI';
import { fmtDate, SEV_BADGE, SEV_LABEL, STAT_BADGE, STAT_LABEL } from '../utils/helpers';

export default function MasterTracker() {
  const { getFindings } = useApp();
  const findings = getFindings();

  return (
    <Card title="Global Compliance Matrix">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ref</th>
              <th>Description</th>
              <th>Dept</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Due Date</th>
              <th>Logged At</th>
              <th>Updated At</th>
            </tr>
          </thead>
          <tbody>
            {findings.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-6">No compliance records tracked.</td>
              </tr>
            ) : findings.map(f => (
              <tr key={f.id}>
                <td className="font-bold">{f.ref || f.id}</td>
                <td className="max-w-[180px] truncate">{f.desc || f.description}</td>
                <td><Badge type="b-blue">{f.dept}</Badge></td>
                <td><Badge type={SEV_BADGE[f.sev || f.severity]}>{SEV_LABEL[f.sev || f.severity]}</Badge></td>
                <td><Badge type={STAT_BADGE[f.status]}>{STAT_LABEL[f.status]}</Badge></td>
                <td>{fmtDate(f.dueDate)}</td>
                <td>{fmtDate(f.loggedAt || f.createdAt)}</td>
                <td>{fmtDate(f.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
