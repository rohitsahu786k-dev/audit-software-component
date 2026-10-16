import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, Icon, EvidenceUploader } from '../components/UI';
import { SEV_BADGE, SEV_LABEL, STAT_BADGE, STAT_LABEL, showToast, today, sanitize, findingWorkflowStatus, mediaUrl, isImageMedia } from '../utils/helpers';
import { managerDeptCodes, filterFindingsByDateRange, findingMatchesDeptCode, deptCodeInList, deptValuesMatch } from '../utils/dashboardHelpers';

const STEPS = ['Logged', 'In Progress', 'Submit For Review', 'Closed'];
const STEP_INDEX = { open: 0, 'in-progress': 1, delayed: 1, 'pending-closure': 2, submitted: 2, closed: 3 };
const ESCALATION = [
  ['Overdue 3-6d', 'Delayed NC email -> SPOC · Every 3rd day'],
  ['Overdue 7-14d', 'Escalation -> HOD (SPOC in CC) · Every 2 days'],
  ['Overdue 15-21d', 'Escalation -> MD Sir (HOD + SPOC CC) · Monthly'],
  ['Overdue 22d+', 'Escalation -> MD Sir (HOD + SPOC CC) · Monthly'],
];
const nowStamp = () => new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

function capaSortRank(f) {
  const ws = findingWorkflowStatus(f);
  return { 'pending-closure': 0, delayed: 1, open: 2, 'in-progress': 3, closed: 9 }[ws] ?? 5;
}

export default function CAPA({ dateFrom, dateTo }) {
  const { getFindings, getDepts, getEmailMaster, getSystemSettings, writeSyncKey, currentUser, capaSelectedId, setCapaSelectedId, setPageAction } = useApp();
  const findings = getFindings();
  const depts = getDepts();
  const role = currentUser?.role;
  const settings = getSystemSettings();
  const codes = useMemo(() => managerDeptCodes(currentUser, depts, getEmailMaster()), [currentUser, depts, getEmailMaster]);

  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [deptF, setDeptF] = useState('');
  const [statusF, setStatusF] = useState('');
  const [closureModal, setClosureModal] = useState(null);
  const [reviewModal, setReviewModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [closureEv, setClosureEv] = useState('');
  const [closureFiles, setClosureFiles] = useState([]);
  const [decision, setDecision] = useState('accept');
  const [decisionComments, setDecisionComments] = useState('');

  // permissions
  const canEditStatus = role === 'admin' || role === 'auditor' || role === 'spoc';
  const canSubmitClosure = role === 'spoc' || role === 'admin';
  const canReview = role === 'auditor' || role === 'admin';
  const canEditDue = role === 'admin' || role === 'auditor';
  const isManagedFinding = (f) => deptCodeInList(depts, f?.dept, codes) || deptCodeInList(depts, f?.deptName, codes);
  const canEditRecord = (f) => role === 'admin' || role === 'auditor' || (role === 'manager' && isManagedFinding(f));
  const canDeleteRecord = (f) => role === 'admin' || (role === 'auditor' && settings.allowAuditorsDeleteFindings) || (role === 'manager' && isManagedFinding(f));

  const scoped = useMemo(() => {
    let list = filterFindingsByDateRange(findings, dateFrom, dateTo);
    if (role === 'spoc') list = list.filter(f => findingMatchesDeptCode(depts, f, currentUser?.dept));
    else if (role === 'manager') list = list.filter(f => deptCodeInList(depts, f?.dept, codes) || deptCodeInList(depts, f?.deptName, codes));
    return list.slice().sort((a, b) => capaSortRank(a) - capaSortRank(b) || (Date.parse(a.due || 0) - Date.parse(b.due || 0)) || String(a.ref || '').localeCompare(String(b.ref || '')));
  }, [findings, depts, dateFrom, dateTo, role, currentUser, codes]);

  const open = scoped.filter(f => f.status !== 'closed');

  useEffect(() => {
    if (capaSelectedId) { setSelectedId(capaSelectedId); setCapaSelectedId(''); }
  }, [capaSelectedId, setCapaSelectedId]);

  const active = useMemo(() => {
    return scoped.find(f => f.ref === selectedId || f.id === selectedId) || open[0] || scoped[0] || null;
  }, [scoped, selectedId, open]);

  const filteredList = useMemo(() => {
    const q = search.toLowerCase().trim();
    return scoped.filter(f => {
      const ws = findingWorkflowStatus(f);
      if (statusF && ws !== statusF) return false;
      if (deptF && !findingMatchesDeptCode(depts, f, deptF)) return false;
      if (q && ![f.ref, f.deptName, f.desc, f.clause].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [scoped, depts, search, statusF, deptF]);

  const commit = (updater, msg) => {
    const updated = findings.map(x => (x.id === active.id ? updater(x) : x));
    writeSyncKey('ap_finds', updated, currentUser?.loginId);
    if (msg) showToast(msg);
  };

  const statusOptions = (f) => {
    const ws = findingWorkflowStatus(f);
    const allowed = canReview ? ['open', 'in-progress', 'closed'] : (canSubmitClosure ? ['open', 'in-progress', 'pending-closure'] : []);
    const out = [];
    if (allowed.indexOf(ws) < 0 && ws) out.push({ value: ws, label: STAT_LABEL[ws] || ws, disabled: true });
    allowed.forEach(s => out.push({ value: s, label: STAT_LABEL[s] || s, disabled: false }));
    return out;
  };

  const onStatusChange = (f, status) => {
    if (status === findingWorkflowStatus(f)) return;
    if (status === 'pending-closure') { if (canSubmitClosure) { setClosureModal(f); setClosureEv(f.closureEvidence || ''); setClosureFiles(f.closureFiles || []); } else showToast('Add closure evidence to submit for review'); return; }
    if (status === 'closed' && findingWorkflowStatus(f) === 'pending-closure') { setReviewModal(f); setDecision('accept'); setDecisionComments(''); return; }
    if (status === 'closed' && role !== 'admin') { showToast('Only Master Admin can force close without review'); return; }
    applyStatus(f, status);
  };

  const applyStatus = (f, status) => {
    commit(x => ({
      ...x, status, capaStatus: status === 'pending-closure' ? 'submitted' : status,
      updatedAt: new Date().toISOString(), statusChangedAt: new Date().toISOString(),
      ...(status === 'pending-closure' ? { decision: null, decisionComments: '', decisionDate: null, auditClosureDate: null, closedAt: null } : {}),
      ...(status === 'closed' ? { auditClosureDate: today(), closedAt: new Date().toISOString() } : { auditClosureDate: null, closedAt: null }),
      activityLog: [...(x.activityLog || []), { user: currentUser?.name || 'System', action: 'Status → ' + (STAT_LABEL[status] || status), ts: nowStamp() }],
    }), 'Status updated: ' + (STAT_LABEL[status] || status));
  };

  const setDue = (due) => commit(x => ({ ...x, due, updatedAt: new Date().toISOString(), activityLog: [...(x.activityLog || []), { user: currentUser?.name || 'System', action: 'Due date -> ' + (due || 'Not set'), ts: nowStamp() }] }), 'Due date updated');

  const submitClosure = () => {
    if (settings.spocCommentRequiredForClosure && !closureEv.trim()) { showToast('Describe the closure'); return; }
    if (settings.requireEvidenceForNCs && closureFiles.length === 0) { showToast('Evidence photo required for closure'); return; }
    // Resubmitting after a rejection must clear the stale decision, otherwise the sync
    // normalizer can read the old 'reject' as the latest verdict and reopen the finding.
    commit(x => ({ ...x, status: 'pending-closure', capaStatus: 'submitted', closureEvidence: closureEv.trim(), closureFiles, closureSubmittedBy: currentUser?.name || currentUser?.loginId, closureDate: today(), decision: null, decisionComments: '', decisionDate: null, auditClosureDate: null, closedAt: null, closureSubmittedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), activityLog: [...(x.activityLog || []), { user: currentUser?.name || 'System', action: 'Closure submitted for review', ts: nowStamp() }] }), 'Closure submitted for review');
    setClosureModal(null); setClosureEv(''); setClosureFiles([]);
  };

  const submitReview = () => {
    const accept = decision === 'accept';
    // A rejected closure goes back to In Progress (not Open) so the SPOC can revise and
    // resubmit; capaStatus must move off 'submitted' or the finding stays on "Submit For Review".
    const nextStatus = accept ? 'closed' : 'in-progress';
    commit(x => ({ ...x, status: nextStatus, capaStatus: nextStatus, decision, decisionComments: decisionComments.trim(), decisionDate: today(), decisionAt: new Date().toISOString(), auditClosureDate: accept ? today() : null, closedAt: accept ? new Date().toISOString() : null, updatedAt: new Date().toISOString(), statusChangedAt: new Date().toISOString(), activityLog: [...(x.activityLog || []), { user: currentUser?.name || 'System', action: accept ? 'Closure accepted' : 'Closure rejected — reopened for resubmission', ts: nowStamp() }] }), accept ? 'CAPA closed' : 'Closure rejected — back to In Progress');
    setReviewModal(null); setDecisionComments('');
  };

  const saveEdit = () => {
    commit(x => ({ ...x, ...editModal, updatedAt: new Date().toISOString(), activityLog: [...(x.activityLog || []), { user: currentUser?.name || 'System', action: 'Finding edited', ts: nowStamp() }] }), 'Finding updated');
    setEditModal(null);
  };
  const deleteFinding = (f) => { const updated = findings.map(x => x.id === f.id ? { ...x, deletedAt: new Date().toISOString(), deletedBy: currentUser?.loginId } : x); writeSyncKey('ap_finds', updated, currentUser?.loginId); showToast('Finding deleted'); setSelectedId(''); };

  const exportCapa = () => {
    if (!window.XLSX) { showToast('Excel loading...'); return; }
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(open.map(f => ({ Ref: f.ref, Dept: f.deptName, Issue: f.desc, Severity: SEV_LABEL[f.sev], Due: f.due, Status: STAT_LABEL[f.status], ClosureEvidence: f.closureEvidence || '' }))), 'CAPA');
    XLSX.writeFile(wb, 'OnePWS_CAPA_' + Date.now() + '.xlsx');
    showToast('CAPA exported');
  };

  const exportCapaRef = useRef(exportCapa);
  exportCapaRef.current = exportCapa;
  useEffect(() => {
    setPageAction(() => () => exportCapaRef.current());
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deptOptions = role === 'spoc'
    ? depts.filter(d => deptValuesMatch(depts, d.code, currentUser?.dept) || deptValuesMatch(depts, d.name, currentUser?.dept))
    : role === 'manager' ? depts.filter(d => deptCodeInList(depts, d.code, codes)) : depts;

  const renderDetail = (f) => {
    const ws = findingWorkflowStatus(f);
    const si = STEP_INDEX[ws] ?? 0;
    return (
      <>
        <div className="stepper">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div className="flex flex-col items-center">
                <div className={`step-circle ${i < si ? 'done' : i === si ? 'active' : ''}`}>{i < si ? <Icon name="check" className="w-3 h-3" /> : i + 1}</div>
                <div className="text-[9px] mt-1" style={{ color: 'var(--text3)' }}>{s}</div>
              </div>
              {i < STEPS.length - 1 && <div className={`step-line ${i < si ? 'done' : ''}`} />}
            </React.Fragment>
          ))}
        </div>
        <div style={{ background: 'var(--red-bg)', borderRadius: 8, padding: 10, marginBottom: 12, borderLeft: '3px solid var(--red)' }}>
          <div className="text-xs font-bold">{f.desc}</div>
          <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{f.deptName} · {f.clause}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div><label className="form-label">Status</label>
            <select value={ws} disabled={!canEditStatus} onChange={e => onStatusChange(f, e.target.value)}>
              {statusOptions(f).map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
            </select>
          </div>
          <div><label className="form-label">Due Date</label><input type="date" value={f.due || ''} disabled={!canEditDue} onChange={e => setDue(e.target.value)} /></div>
        </div>
        {f.closureEvidence && (
          <div style={{ background: 'var(--green-bg)', border: '1px solid #86efac', borderRadius: 7, padding: 9, marginBottom: 11 }}>
            <div className="text-[11px] font-bold mb-1 flex items-center gap-1"><Icon name="clipboard-list" className="w-3 h-3" /> Closure Evidence Submitted For Review</div>
            <div className="text-[11px]" style={{ color: 'var(--text2)' }}>{f.closureEvidence}</div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>By {f.closureSubmittedBy || '—'} · {f.closureDate || '—'}</div>
            {(f.closureFiles || []).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {f.closureFiles.map((cf, i) => (
                  <a key={i} href={mediaUrl(cf)} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1" style={{ width: 90 }}>
                    {isImageMedia(cf) ? (
                      <img src={mediaUrl(cf)} alt={cf.file_name || cf.name} style={{ width: 90, height: 70, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                    ) : (
                      <div className="flex items-center justify-center" style={{ width: 90, height: 70, borderRadius: 6, background: 'var(--bg3)', border: '1px solid var(--border)' }}><Icon name="file-text" className="w-5 h-5 opacity-50" /></div>
                    )}
                    <span className="text-[9px] truncate w-full text-center" style={{ color: 'var(--text3)' }}>{cf.file_name || cf.name}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
        {f.decision && (
          <div style={{ background: f.decision === 'accept' ? 'var(--green-bg)' : 'var(--red-bg)', border: `1px solid ${f.decision === 'accept' ? '#86efac' : '#fca5a5'}`, borderRadius: 7, padding: 9, marginBottom: 11 }}>
            <div className="text-[11px] font-bold">{f.decision === 'accept' ? 'Accepted' : 'Rejected'} — {f.decisionDate || ''}</div>
            {f.decisionComments && <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{f.decisionComments}</div>}
          </div>
        )}
        <div className="card-heading mt-2"><span className="dot w-[7px] h-[7px] rounded-full bg-[var(--teal)] flex-shrink-0" />Activity Log</div>
        <div className="space-y-2">
          {(f.activityLog || []).length === 0 ? <div className="text-[11px]" style={{ color: 'var(--text3)' }}>No activity recorded</div> : (f.activityLog || []).slice().reverse().map((l, i) => (
            <div key={i} className="timeline-item">
              <div className="timeline-dot">i</div>
              <div><div className="text-[11px] font-bold">{sanitize(l.user || 'System')}: {sanitize(l.action || 'Updated')}</div><div className="text-[10px]" style={{ color: 'var(--text3)' }}>{sanitize(l.ts || l.at || '')}</div></div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap mt-3">
          {canEditRecord(f) && <button className="btn btn-primary btn-sm" onClick={() => setEditModal({ ...f })}>Edit Finding</button>}
          {canDeleteRecord(f) && <button className="btn btn-danger btn-sm" onClick={() => deleteFinding(f)}>Delete</button>}
          {canSubmitClosure && ws !== 'closed' && ws !== 'pending-closure' && <button className="btn btn-success btn-sm" onClick={() => { setClosureModal(f); setClosureEv(f.closureEvidence || ''); setClosureFiles(f.closureFiles || []); }}>Submit For Review</button>}
          {canReview && ws === 'pending-closure' && <button className="btn btn-primary btn-sm" onClick={() => { setReviewModal(f); setDecision('accept'); setDecisionComments(''); }}>Review Closure</button>}
          {role === 'admin' && ws !== 'closed' && ws !== 'pending-closure' && <button className="btn btn-amber btn-sm" onClick={() => applyStatus(f, 'closed')}>Force Close</button>}
          {ws === 'closed' && <Badge type="b-green">Verified &amp; Closed</Badge>}
          <button className="btn btn-ghost btn-sm" onClick={() => showToast('Reminder email dispatch is handled by the server email service')}><Icon name="mail" /> Remind</button>
        </div>
      </>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{scoped.length}</div></div>
        <div className="stat-card"><div className="stat-label">Overdue</div><div className="stat-value" style={{ color: 'var(--red)' }}>{scoped.filter(f => findingWorkflowStatus(f) === 'delayed').length}</div><div className="stat-delta" style={{ color: 'var(--red)' }}>Escalation active</div></div>
        <div className="stat-card"><div className="stat-label">Submit For Review</div><div className="stat-value" style={{ color: 'var(--purple)' }}>{scoped.filter(f => findingWorkflowStatus(f) === 'pending-closure').length}</div></div>
        <div className="stat-card"><div className="stat-label">Closed</div><div className="stat-value" style={{ color: 'var(--green)' }}>{scoped.filter(f => f.status === 'closed').length}</div><div className="stat-delta">This cycle</div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Detail */}
        <div className="lg:col-span-2">
          <Card title={<>CAPA Detail — {active?.ref || '—'}</>} action={active ? <Badge type={SEV_BADGE[active.sev] || 'b-gray'}>{SEV_LABEL[active.sev] || active.sev}</Badge> : null}>
            {active ? renderDetail(active) : <div className="info-box">No open CAPAs found.{role === 'spoc' ? ' Findings for your department will appear here after audits are conducted.' : ''}</div>}
          </Card>
        </div>

        {/* List + escalation */}
        <div className="space-y-3">
          <Card title="CAPA List">
            <div className="flex flex-col gap-2 mb-2">
              <input placeholder="Search CAPA no, dept, issue..." value={search} onChange={e => setSearch(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <select value={deptF} onChange={e => setDeptF(e.target.value)}><option value="">All Dept</option>{deptOptions.map(d => <option key={d.code} value={d.code}>{d.code}</option>)}</select>
                <select value={statusF} onChange={e => setStatusF(e.target.value)}>
                  <option value="">All status</option><option value="open">Open</option><option value="in-progress">In Progress</option><option value="delayed">Delayed</option><option value="pending-closure">Submit For Review</option><option value="closed">Closed</option>
                </select>
              </div>
            </div>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {filteredList.length === 0 ? <div className="text-[11px]" style={{ color: 'var(--text3)' }}>No CAPAs found</div> : filteredList.map(f => {
                const ws = findingWorkflowStatus(f);
                const isActive = active && (active.id === f.id);
                return (
                  <div key={f.id} className={`capa-item ${isActive ? 'active' : ''}`} onClick={() => setSelectedId(f.ref || f.id)}>
                    <div className="flex justify-between items-start gap-1"><span className="font-bold text-xs">{f.ref}</span><Badge type={STAT_BADGE[ws] || 'b-gray'}>{STAT_LABEL[ws] || ws}</Badge></div>
                    <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{f.deptName} · {(f.desc || '').substring(0, 45)}</div>
                  </div>
                );
              })}
            </div>
            <button className="btn btn-ghost btn-sm w-full mt-2" onClick={exportCapa}><Icon name="table" /> Export CAPA</button>
          </Card>

          <Card title="Escalation Rules">
            <div className="text-[11px]" style={{ lineHeight: 2.2 }}>
              {ESCALATION.map(([t, a]) => (
                <div key={t} className="flex justify-between gap-2"><span style={{ color: 'var(--text3)' }}>{t}</span><span className="text-right">{a}</span></div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Closure modal */}
      {closureModal && (
        <div className="modal-bg" onClick={() => setClosureModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span>Submit Closure For Review</span><button className="btn btn-ghost btn-icon btn-sm" onClick={() => setClosureModal(null)}><Icon name="x" /></button></div>
            <div className="mb-2 text-xs"><strong>{closureModal.ref}</strong>: {closureModal.desc}<div className="text-[10px]" style={{ color: 'var(--text3)' }}>{closureModal.deptName} · {closureModal.clause}</div></div>
            <div className="mb-3"><label className="form-label">Closure Explanation *</label><textarea value={closureEv} onChange={e => setClosureEv(e.target.value)} style={{ height: 80, resize: 'none' }} placeholder="Describe the corrective actions taken..." /></div>
            <div className="mb-3"><EvidenceUploader files={closureFiles} onChange={setClosureFiles} label="Closure Evidence Photos" /></div>
            <div className="flex gap-2"><button className="btn btn-ghost flex-1" onClick={() => { setClosureModal(null); setClosureFiles([]); }}>Cancel</button><button className="btn btn-success flex-1" onClick={submitClosure}>Submit For Review</button></div>
          </div>
        </div>
      )}

      {/* Review modal */}
      {reviewModal && (
        <div className="modal-bg" onClick={() => setReviewModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span>Review Closure — {reviewModal.ref}</span><button className="btn btn-ghost btn-icon btn-sm" onClick={() => setReviewModal(null)}><Icon name="x" /></button></div>
            {reviewModal.closureEvidence && <div className="mb-2 p-2 rounded text-xs" style={{ background: 'var(--bg3)' }}>{reviewModal.closureEvidence}</div>}
            <div className="mb-2"><label className="form-label">Decision</label>
              <select value={decision} onChange={e => setDecision(e.target.value)}><option value="accept">Accept &amp; Close</option><option value="reject">Reject &amp; Reopen</option></select>
            </div>
            <div className="mb-3"><label className="form-label">Comments</label><textarea value={decisionComments} onChange={e => setDecisionComments(e.target.value)} style={{ height: 60, resize: 'none' }} /></div>
            <div className="flex gap-2"><button className="btn btn-ghost flex-1" onClick={() => setReviewModal(null)}>Cancel</button><button className="btn btn-primary flex-1" onClick={submitReview}>Submit Decision</button></div>
          </div>
        </div>
      )}

      {/* Edit finding modal */}
      {editModal && (
        <div className="modal-bg" onClick={() => setEditModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span>Edit Finding</span><button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditModal(null)}><Icon name="x" /></button></div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div><label className="form-label">Severity</label><select value={editModal.sev || 'major'} onChange={e => setEditModal(p => ({ ...p, sev: e.target.value }))}>{['critical', 'major', 'minor', 'obs'].map(s => <option key={s} value={s}>{SEV_LABEL[s]}</option>)}</select></div>
              <div><label className="form-label">Clause</label><input value={editModal.clause || ''} onChange={e => setEditModal(p => ({ ...p, clause: e.target.value }))} /></div>
            </div>
            <div className="mb-2"><label className="form-label">Due Date</label><input type="date" value={editModal.due || ''} onChange={e => setEditModal(p => ({ ...p, due: e.target.value }))} /></div>
            <div className="mb-3"><label className="form-label">Description</label><textarea value={editModal.desc || ''} onChange={e => setEditModal(p => ({ ...p, desc: e.target.value }))} style={{ height: 76, resize: 'none' }} /></div>
            <div className="flex gap-2"><button className="btn btn-ghost flex-1" onClick={() => setEditModal(null)}>Cancel</button><button className="btn btn-primary flex-1" onClick={saveEdit}>Save</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
