import React, { useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Badge } from '../components/UI';
import { Icon } from '../components/UI';
import { findingWorkflowStatus, showToast } from '../utils/helpers';
import { delayDays, managerDeptCodes } from '../utils/dashboardHelpers';

export default function MyTasks() {
  const { getFindings, getDepts, getEmailMaster, getPlannedAudits, currentUser, navigate, setCapaSelectedId, refreshSync, setPageAction } = useApp();

  useEffect(() => {
    setPageAction(() => () => { refreshSync(); showToast('Refreshing…'); });
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const findings = getFindings();
  const depts = getDepts();
  const emailMaster = getEmailMaster();
  const planned = getPlannedAudits();

  const tasks = useMemo(() => {
    const u = currentUser || {};
    const role = u.role || 'viewer';
    const list = [];
    const pri = (f) => (f.sev === 'critical' ? 'P1' : f.sev === 'major' ? 'P2' : 'P3');
    const dueBucket = (f) => {
      const dl = delayDays(f);
      if (dl > 0) return 'overdue';
      const d = f.due ? Math.round((new Date(f.due) - new Date()) / 86400000) : 99;
      return d <= 3 ? 'due-soon' : 'upcoming';
    };

    if (role === 'spoc') {
      const spocDept = u.dept || '';
      findings.filter(f => f.status !== 'closed' && f.dept === spocDept).forEach(f => {
        list.push({ id: f.id || f.ref, ref: f.ref, title: `CAPA Action Required: ${f.ref} - ${(f.desc || '').substring(0, 45)}`, status: dueBucket(f), dueDate: f.due, pri: pri(f), link: 'capa' });
      });
    } else if (role === 'auditor') {
      findings.filter(f => findingWorkflowStatus(f) === 'pending-closure').forEach(f => {
        list.push({ id: f.id || f.ref, ref: f.ref, title: `Review Closure: ${f.ref} (${f.deptName || f.dept})`, status: 'due-soon', dueDate: 'ASAP', pri: 'P1', link: 'capa' });
      });
      (planned || []).forEach((a, i) => {
        list.push({ id: `pa_${i}`, title: `Execute: ${a.deptName || a.dept} - ${a.type || 'Audit'}`, status: 'upcoming', dueDate: a.date || '-', pri: 'P2', link: 'execution' });
      });
    } else if (role === 'manager') {
      const codes = managerDeptCodes(u, depts, emailMaster);
      findings.filter(f => codes.includes(f.dept) && f.status !== 'closed').forEach(f => {
        const ws = findingWorkflowStatus(f);
        list.push({ id: f.id || f.ref, ref: f.ref, title: `Manager Follow-up: ${f.ref} - ${f.deptName || f.dept}`, status: delayDays(f) > 0 ? 'overdue' : ws === 'pending-closure' ? 'due-soon' : 'upcoming', dueDate: f.due || 'ASAP', pri: pri(f), link: 'capa' });
      });
    } else if (role === 'admin') {
      findings.filter(f => f.status !== 'closed').forEach(f => {
        list.push({ id: f.id || f.ref, ref: f.ref, title: `CAPA: ${f.ref} - ${f.deptName || f.dept} (SPOC resp.)`, status: dueBucket(f), dueDate: f.due, pri: pri(f), link: 'capa' });
      });
      findings.filter(f => findingWorkflowStatus(f) === 'pending-closure').forEach(f => {
        list.push({ id: `rev_${f.id || f.ref}`, ref: f.ref, title: `Review Closure: ${f.ref}`, status: 'due-soon', dueDate: 'ASAP', pri: 'P1', link: 'capa' });
      });
    } else {
      list.push({ id: 'tv1', title: 'Review Compliance Dashboard', status: 'upcoming', dueDate: '—', pri: 'P3', link: 'dashboard' });
    }
    return list;
  }, [findings, depts, emailMaster, planned, currentUser]);

  const overdue = tasks.filter(t => t.status === 'overdue').length;
  const dueSoon = tasks.filter(t => t.status === 'due-soon').length;

  const openTask = (t) => {
    if (t.link === 'capa' && t.ref) { setCapaSelectedId(t.ref); navigate('capa'); }
    else navigate(t.link || 'dashboard');
  };

  const statusLabel = { overdue: 'Overdue', 'due-soon': 'Due Soon', upcoming: 'Upcoming' };
  const statusBadge = { overdue: 'b-red', 'due-soon': 'b-amber', upcoming: 'b-teal' };
  const priBadge = { P1: 'b-red', P2: 'b-amber', P3: 'b-gray' };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="stat-card">
          <div className="stat-label">Total Pending</div>
          <div className="stat-value">{tasks.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Overdue</div>
          <div className="stat-value" style={{ color: 'var(--red)' }}>{overdue}</div>
          <div className="stat-delta" style={{ color: 'var(--red)' }}>Immediate action</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Due in 3 Days</div>
          <div className="stat-value" style={{ color: 'var(--amber)' }}>{dueSoon}</div>
        </div>
      </div>

      {tasks.length ? (
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.id} className={`task-card ${t.status}`} onClick={() => openTask(t)}>
              <div style={{ flex: 1 }}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-bold">{t.title}</span>
                  <Badge type={priBadge[t.pri]}>{t.pri}</Badge>
                </div>
                <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text3)' }}>
                  <Badge type={statusBadge[t.status]}>{statusLabel[t.status]}</Badge>
                  <span>{t.dueDate}</span>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm"><Icon name="arrow-right" /></button>
            </div>
          ))}
        </div>
      ) : (
        <div className="info-box">No pending tasks. Great work!</div>
      )}
    </div>
  );
}
