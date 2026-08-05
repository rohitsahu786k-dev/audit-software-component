import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, Icon } from '../components/UI';
import { SEV_BADGE, SEV_LABEL, showToast } from '../utils/helpers';

export default function Learnings() {
  const { getLearnings, getDepts, writeSyncKey, currentUser, setPageAction } = useApp();
  const learnings = getLearnings();
  const depts = getDepts();
  const role = currentUser?.role;

  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ title: '', dept: '', sev: 'major', clause: '', rc: '', pa: '', repeat: false, crossDept: false });
  const titleInputRef = useRef(null);

  useEffect(() => {
    setPageAction(() => () => { titleInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); titleInputRef.current?.focus(); });
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return learnings;
    return learnings.filter(l => [l.title, l.rc, l.pa, l.clause].join(' ').toLowerCase().includes(q));
  }, [learnings, search]);

  const addLearning = () => {
    if (!form.title.trim()) { showToast('Title required'); return; }
    const item = { id: 'l' + Date.now(), title: form.title.trim(), dept: form.dept, sev: form.sev, clause: form.clause, rc: form.rc, pa: form.pa, repeat: form.repeat, crossDept: form.crossDept };
    writeSyncKey('ap_learns', [item, ...getLearnings()], currentUser?.loginId);
    setForm({ title: '', dept: '', sev: 'major', clause: '', rc: '', pa: '', repeat: false, crossDept: false });
    showToast('Learning saved!');
  };

  const delLearning = (id) => { writeSyncKey('ap_learns', getLearnings().filter(x => x.id !== id), currentUser?.loginId); showToast('Deleted'); };

  const exportExcel = () => {
    if (!window.XLSX) { showToast('Excel loading...'); return; }
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(learnings.map(l => ({ Title: l.title, Dept: l.dept || 'All', Clause: l.clause, Severity: SEV_LABEL[l.sev], 'Root Cause': l.rc, 'Preventive Action': l.pa }))), 'Learnings');
    XLSX.writeFile(wb, `OnePWS_Learnings_${Date.now()}.xlsx`);
    showToast('Exported!');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Repository */}
      <Card title={`Learnings Repository (${learnings.length})`}>
        <div className="mb-2"><label className="form-label">Search</label><input placeholder="calibration, traceability..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="text-[11px] text-center py-3" style={{ color: 'var(--text3)' }}>No learnings yet</div>
          ) : filtered.map(l => (
            <div key={l.id} className={`finding-card ${l.sev}`}>
              <div className="flex justify-between items-start"><span className="font-bold text-xs">{l.title}</span><Badge type={SEV_BADGE[l.sev] || 'b-gray'}>{SEV_LABEL[l.sev] || l.sev}</Badge></div>
              <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{l.dept || 'All'} · {l.clause}</div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--text2)' }}><strong>RC:</strong> {l.rc}</div>
              <div className="text-[11px]" style={{ color: 'var(--text2)' }}><strong>PA:</strong> {l.pa}</div>
              <div className="flex gap-2 mt-2 items-center">
                {l.repeat && <Badge type="b-purple">Repeat</Badge>}
                {l.crossDept && <Badge type="b-blue">X-dept</Badge>}
                {role === 'admin' && <button className="btn btn-danger btn-icon btn-sm ml-auto" onClick={() => delLearning(l.id)}><Icon name="trash-2" /></button>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Add form */}
      <Card title="Add New Learning">
        <div className="flex flex-col gap-2">
          <div><label className="form-label">Title *</label><input ref={titleInputRef} placeholder="Learning title..." value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="form-label">Dept</label><select value={form.dept} onChange={e => setForm(p => ({ ...p, dept: e.target.value }))}><option value="">All</option>{depts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></div>
            <div><label className="form-label">Severity</label><select value={form.sev} onChange={e => setForm(p => ({ ...p, sev: e.target.value }))}><option value="critical">Critical</option><option value="major">Major</option><option value="minor">Minor</option><option value="obs">Observation</option></select></div>
          </div>
          <div><label className="form-label">Clause</label><input placeholder="§8.5.2" value={form.clause} onChange={e => setForm(p => ({ ...p, clause: e.target.value }))} /></div>
          <div><label className="form-label">Root Cause</label><textarea style={{ height: 52, resize: 'none' }} placeholder="Describe root cause..." value={form.rc} onChange={e => setForm(p => ({ ...p, rc: e.target.value }))} /></div>
          <div><label className="form-label">Preventive Action</label><textarea style={{ height: 52, resize: 'none' }} placeholder="What prevents recurrence?" value={form.pa} onChange={e => setForm(p => ({ ...p, pa: e.target.value }))} /></div>
          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-[5px] text-xs" style={{ cursor: 'pointer' }}><input type="checkbox" style={{ width: 'auto' }} checked={form.repeat} onChange={e => setForm(p => ({ ...p, repeat: e.target.checked }))} /> Repeat Issue</label>
            <label className="flex items-center gap-[5px] text-xs" style={{ cursor: 'pointer' }}><input type="checkbox" style={{ width: 'auto' }} checked={form.crossDept} onChange={e => setForm(p => ({ ...p, crossDept: e.target.checked }))} /> Cross-dept</label>
          </div>
          <button className="btn btn-brand w-full" onClick={addLearning}><Icon name="lightbulb" /> Save to Knowledge Base</button>
          <button className="btn btn-ghost btn-sm w-full" onClick={exportExcel}><Icon name="table" /> Export Excel</button>
        </div>
      </Card>
    </div>
  );
}
