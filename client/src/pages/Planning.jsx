import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, Icon, ConfirmModal } from '../components/UI';
import { fmtDate, showToast, today } from '../utils/helpers';
import { buildChecklist, EMPTY_SESSION } from '../utils/auditEngine';

const STD_META = {
  as9100d: { id: 'as9100d', label: 'AS9100 Rev D', short: 'AS9100D', color: '#c0392b' },
  iso9001: { id: 'iso9001', label: 'ISO 9001:2015', short: 'ISO 9001', color: '#2563eb' },
  iso14001: { id: 'iso14001', label: 'ISO 14001:2015', short: 'ISO 14001', color: '#0d9488' },
  iso45001: { id: 'iso45001', label: 'ISO 45001:2018', short: 'ISO 45001', color: '#d97706' },
  internal: { id: 'internal', label: 'OnePWS Internal', short: 'Internal', color: '#7c3aed' },
};
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function Planning() {
  const { getPlannedAudits, getDepts, getAuditors, getCheckpoints, getCompletedAudits, writeSyncKey, currentUser, navigate, setActiveAudit, setAuditSession } = useApp();
  const planned = getPlannedAudits();
  const depts = getDepts();
  const auditors = getAuditors();
  const checkpoints = getCheckpoints();
  const completed = getCompletedAudits();

  const [standards, setStandards] = useState(['as9100d']);
  const [form, setForm] = useState({ dept: '', auditor: '', date: today(), type: 'Full Internal Audit' });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [viewDate, setViewDate] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });

  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'auditor';

  const todayD = useMemo(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }, []);
  const overdue = planned.filter(a => a.date && new Date(a.date) < todayD).length;
  const next30 = planned.filter(a => { const d = new Date(a.date); return !isNaN(d) && d >= todayD && d <= new Date(todayD.getTime() + 30 * 86400000); }).length;
  const annualTarget = useMemo(() => depts.reduce((sum, d) => sum + (Number(d.freq) || 4), 0), [depts]);

  const toggleStd = (id) => {
    setStandards(prev => { let s = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]; if (!s.length) s = ['as9100d']; return s; });
  };

  const buildAudit = (status) => {
    if (!form.dept || !form.auditor || !form.date) { showToast('Please select department, auditor and date'); return null; }
    const d = depts.find(x => x.code === form.dept || x.name === form.dept);
    const code = d?.code || form.dept;
    const sections = buildChecklist(code, standards, depts, checkpoints);
    return {
      id: 'aud_' + Date.now(), dept: code, deptName: d?.name || form.dept,
      auditor: form.auditor, date: form.date, type: form.type,
      standards: standards.slice(), sections,
      ref: code + '-AUD-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-4),
      createdAt: new Date().toISOString(), status,
    };
  };

  const startAudit = (audit) => {
    setActiveAudit(audit);
    setAuditSession(EMPTY_SESSION);
    navigate('execution');
  };

  const scheduleAudit = () => {
    const audit = buildAudit('planned'); if (!audit) return;
    writeSyncKey('ap_planned_audits', [...getPlannedAudits(), audit], currentUser?.loginId);
    setForm({ dept: '', auditor: '', date: today(), type: 'Full Internal Audit' });
    showToast(`Scheduled ${audit.deptName} audit on ${audit.date}`);
  };

  const createAndStart = () => {
    const audit = buildAudit('in-progress'); if (!audit) return;
    const total = (audit.sections || []).reduce((t, s) => t + s._checkpoints.length, 0);
    startAudit(audit);
    showToast(`Audit created. Checklist ready with ${total} questions.`);
  };

  const startPlanned = (audit) => {
    writeSyncKey('ap_planned_audits', getPlannedAudits().filter(p => p.id !== audit.id), currentUser?.loginId);
    startAudit(audit);
    showToast(`Starting ${audit.deptName} audit...`);
  };

  const removePlan = (id) => {
    writeSyncKey('ap_planned_audits', getPlannedAudits().filter(p => p.id !== id), currentUser?.loginId);
    setConfirmDelete(null);
    showToast('Scheduled audit canceled');
  };

  // Calendar geometry
  const cal = useMemo(() => {
    const y = viewDate.getFullYear(), m = viewDate.getMonth();
    const first = new Date(y, m, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-based
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));
    while (cells.length % 7 !== 0) cells.push(null);
    const plannedByDay = {};
    planned.forEach(a => { const key = String(a.date || '').slice(0, 10); if (key) plannedByDay[key] = (plannedByDay[key] || 0) + 1; });
    return { cells, plannedByDay, title: viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }, [viewDate, planned]);

  const navCal = (dir) => setViewDate(v => new Date(v.getFullYear(), v.getMonth() + dir, 1));
  const isToday = (d) => d && d.getTime() === todayD.getTime();
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat-card"><div className="stat-label">Annual Target</div><div className="stat-value">{annualTarget}</div><div className="stat-delta">{depts.length} departments tracked</div></div>
        <div className="stat-card"><div className="stat-label">Completed</div><div className="stat-value" style={{ color: 'var(--green)' }}>{completed.length}</div><div className="stat-delta">Submitted audits</div></div>
        <div className="stat-card"><div className="stat-label">Scheduled</div><div className="stat-value" style={{ color: 'var(--accent)' }}>{planned.length}</div><div className="stat-delta">{next30} next 30 days</div></div>
        <div className="stat-card"><div className="stat-label">Overdue</div><div className="stat-value" style={{ color: 'var(--red)' }}>{overdue}</div><div className="stat-delta" style={{ color: 'var(--red)' }}>Action needed</div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Calendar */}
        <div className="lg:col-span-2">
          <Card
            title={`Audit Calendar — ${cal.title}`}
            action={<div className="flex gap-1"><button className="btn btn-ghost btn-sm" onClick={() => navCal(-1)}>‹</button><button className="btn btn-ghost btn-sm" onClick={() => navCal(1)}>›</button></div>}
          >
            <div className="cal-grid mb-1">{DOW.map((d, i) => <div key={i} className="text-[9px] font-bold text-center" style={{ color: 'var(--text3)', padding: 3 }}>{d}</div>)}</div>
            <div className="cal-grid">
              {cal.cells.map((d, i) => d ? (
                <div key={i} className={`cal-cell ${isToday(d) ? 'today' : ''}`}>
                  <span className="font-bold">{d.getDate()}</span>
                  {cal.plannedByDay[dayKey(d)] ? <span className="cal-dot mt-1" /> : null}
                </div>
              ) : <div key={i} className="cal-cell muted" />)}
            </div>
          </Card>
        </div>

        {/* Create New Audit */}
        <div>
          <div className="card" style={{ border: '1.5px solid var(--brand)' }}>
            <div className="card-heading"><span className="dot w-[7px] h-[7px] rounded-full bg-[var(--brand)] flex-shrink-0" />Create New Audit</div>
            <div className="mb-2">
              <label className="form-label">Department *</label>
              <select value={form.dept} onChange={e => setForm(p => ({ ...p, dept: e.target.value }))}>
                <option value="">Select department...</option>
                {depts.map(d => <option key={d.id || d.code} value={d.code}>{d.name}</option>)}
              </select>
            </div>
            <div className="mb-2">
              <label className="form-label">Select Audit Standard(s) * — tick all that apply</label>
              <div className="stdc">
                {Object.values(STD_META).filter(s => s.id !== 'internal').map(s => (
                  <div key={s.id} className={`stdchip ${standards.includes(s.id) ? 'sel' : ''}`} onClick={() => toggleStd(s.id)}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />{s.label}
                  </div>
                ))}
                <div className={`stdchip ${standards.includes('internal') ? 'sel' : ''}`} onClick={() => toggleStd('internal')}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7c3aed', display: 'inline-block' }} />OnePWS Internal ({checkpoints.length} checkpoints)
                </div>
              </div>
            </div>
            <div className="mb-2">
              <label className="form-label">Auditor *</label>
              <select value={form.auditor} onChange={e => setForm(p => ({ ...p, auditor: e.target.value }))}>
                <option value="">Select auditor...</option>
                {auditors.map(a => <option key={a.id || a.name} value={a.name}>{a.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div><label className="form-label">Date</label><input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} /></div>
              <div><label className="form-label">Type</label>
                <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                  <option>Full Internal Audit</option><option>Follow-up Audit</option><option>Supplier Audit</option><option>Process Audit</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-brand w-full" onClick={scheduleAudit} disabled={!canEdit}><Icon name="calendar-plus" /> Schedule Audit</button>
              <button className="btn btn-primary w-full" onClick={createAndStart} disabled={!canEdit}><Icon name="play" /> Create & Start</button>
            </div>
          </div>
        </div>
      </div>

      {/* Planned audits list */}
      <Card title="Planned Audits" action={<Badge type="b-blue">{planned.length}</Badge>}>
        {planned.length === 0 ? (
          <div className="info-box">No planned audits yet. Select department, standards and date, then click Schedule Audit.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Department</th><th>Auditor</th><th>Standards</th><th>Type</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {planned.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).map(a => (
                  <tr key={a.id}>
                    <td className="font-bold">{fmtDate(a.date)}</td>
                    <td>{a.deptName || a.dept}</td>
                    <td>{a.auditor || '-'}</td>
                    <td>{(a.standards || []).map(s => STD_META[s]?.short || s).join(', ') || '-'}</td>
                    <td>{a.type || 'Full Internal Audit'}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-brand btn-sm" onClick={() => startPlanned(a)}><Icon name="play" /> Start</button>
                        {currentUser?.role === 'admin' && <button className="btn btn-danger btn-icon btn-sm" onClick={() => setConfirmDelete(a.id)}><Icon name="trash-2" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmModal open={!!confirmDelete} message="Cancel this scheduled audit?" onConfirm={() => removePlan(confirmDelete)} onCancel={() => setConfirmDelete(null)} />
    </div>
  );
}
