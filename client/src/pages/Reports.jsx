import React from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, EmptyState } from '../components/UI';
import { fmtDate } from '../utils/helpers';
import { Icon } from '../components/UI';

export default function Reports() {
  const { getCompletedAudits } = useApp();
  const completed = getCompletedAudits();

  const exportReport = (item) => {
    // Standard basic text report export placeholder matching PDF template needs
    const text = `QMS Audit Report\n\nDept: ${item.dept}\nAuditor: ${item.auditor}\nScore: ${item.score}%\nDate: ${fmtDate(item.date)}\nFindings: ${item.findingsCount}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `AuditReport_${item.dept}_${item.date}.txt`;
    a.click();
  };

  return (
    <Card title="Completed Audits">
      {completed.length === 0 ? (
        <EmptyState icon="file-text" title="No completed audits" subtitle="Submit execution reports to generate compliance files." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Dept</th>
                <th>Auditor</th>
                <th>Score</th>
                <th>Findings Logged</th>
                <th>Audit Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {completed.map(item => (
                <tr key={item.id}>
                  <td className="font-bold">{item.dept}</td>
                  <td>{item.auditor}</td>
                  <td className="font-extrabold" style={{ color: item.score >= 80 ? 'var(--green)' : 'var(--red)' }}>
                    {item.score}%
                  </td>
                  <td>
                    <Badge type={item.findingsCount > 0 ? 'b-red' : 'b-green'}>
                      {item.findingsCount} NC
                    </Badge>
                  </td>
                  <td>{fmtDate(item.date)}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => exportReport(item)}>
                      <Icon name="download" /> Report
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
