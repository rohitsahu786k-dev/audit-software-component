import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge } from '../components/UI';
import { SEV_BADGE, SEV_LABEL, STAT_BADGE, STAT_LABEL, sanitize, showToast } from '../utils/helpers';
import { delayDays, managerDeptCodes } from '../utils/dashboardHelpers';

export default function ManagerPanel() {
  const { getFindings, getDepts, getEmailMaster, currentUser, navigate, setCapaSelectedId, canAccess } = useApp();
  const findings = getFindings();
  const depts = getDepts();
  const emailMaster = getEmailMaster();

  const { codes, open, overdue, byDept } = useMemo(() => {
    const u = currentUser || {};
    const codes = managerDeptCodes(u, depts, emailMaster);
    const managed = findings.filter(f => codes.includes(f.dept));
    const open = managed.filter(f => f.status !== 'closed');
    const overdue = open.filter(f => delayDays(f) > 0);
    const byDept = codes.map(code => {
      const d = depts.find(x => x.code === code) || { code, name: code };
      const df = open.filter(f => f.dept === code);
      return {
        code, name: d.name,
        total: df.length,
        overdue: df.filter(f => delayDays(f) > 0).length,
        critical: df.filter(f => f.sev === 'critical').length,
      };
    });
    return { codes, open, overdue, byDept };
  }, [findings, depts, emailMaster, currentUser]);

  if (!canAccess('managerpanel')) {
    return <div className="info-box">Manager Console access is disabled for your role.</div>;
  }

  const openCapa = (f) => { setCapaSelectedId(f.ref || f.id); navigate('capa'); };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="stat-card"><div className="stat-label">Managed Depts</div><div className="stat-value">{codes.length}</div></div>
        <div className="stat-card"><div className="stat-label">Open NCs</div><div className="stat-value">{open.length}</div></div>
        <div className="stat-card"><div className="stat-label">Overdue</div><div className="stat-value" style={{ color: 'var(--red)' }}>{overdue.length}</div></div>
      </div>

      <Card title="Department Control">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Dept</th><th>Open</th><th>Overdue</th><th>Critical</th><th>Action</th></tr>
            </thead>
            <tbody>
              {byDept.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text3)', padding: 12 }}>No managed departments mapped</td></tr>
              ) : byDept.map(r => (
                <tr key={r.code}>
                  <td className="font-bold">{r.name}</td>
                  <td>{r.total}</td>
                  <td style={{ color: 'var(--red)', fontWeight: 800 }}>{r.overdue}</td>
                  <td>{r.critical}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => showToast('Reminder email dispatch is handled by the server email service')}>Reminder</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Overdue / Open NCs"
        action={<button className="btn btn-brand btn-sm" onClick={() => showToast('Summary email dispatch is handled by the server email service')}>Send Summary</button>}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Ref</th><th>Dept</th><th>Issue</th><th>Severity</th><th>Due</th><th>Delay</th><th>Status</th><th>Action</th></tr>
            </thead>
            <tbody>
              {open.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text3)', padding: 12 }}>No open NCs for managed departments</td></tr>
              ) : open.map(f => (
                <tr key={f.id || f.ref}>
                  <td className="font-bold">{f.ref}</td>
                  <td>{f.deptName || f.dept}</td>
                  <td style={{ maxWidth: 260 }} className="truncate">{sanitize((f.desc || '').substring(0, 95))}</td>
                  <td><Badge type={SEV_BADGE[f.sev] || 'b-gray'}>{SEV_LABEL[f.sev] || f.sev}</Badge></td>
                  <td>{f.due || '-'}</td>
                  <td style={{ fontWeight: 800, color: delayDays(f) > 0 ? 'var(--red)' : 'var(--text2)' }}>{delayDays(f)}d</td>
                  <td><Badge type={STAT_BADGE[f.status] || 'b-gray'}>{STAT_LABEL[f.status] || f.status}</Badge></td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => openCapa(f)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
