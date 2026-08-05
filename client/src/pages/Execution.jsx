import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, Icon, EvidenceUploader } from '../components/UI';
import { showToast, SEV_BADGE, SEV_LABEL, fmtDate, mediaUrl, isImageMedia } from '../utils/helpers';
import { auditFindingCounts, auditScore } from '../utils/dashboardHelpers';
import { STD_META, CAPA_DUE_DEFAULTS, EMPTY_SESSION } from '../utils/auditEngine';

function Stars({ n }) {
  return <>{Array.from({ length: 5 }).map((_, i) => <Icon key={i} name="star" className="w-3 h-3" style={{ color: i < n ? '#f59e0b' : '#d1d5db', fill: i < n ? '#f59e0b' : 'none' }} />)}</>;
}

export default function Execution() {
  const {
    getPlannedAudits, getCompletedAudits, getRootCauses, getAuditDrafts, getCapaDue, getFindings,
    writeSyncKey, currentUser, navigate, setPageAction,
    activeAudit: audit, setActiveAudit: setAuditState, auditSession: session, setAuditSession: setSession,
  } = useApp();
  const role = currentUser?.role;
  const [curSec, setCurSec] = useState(0);
  const [findingModal, setFindingModal] = useState(null);
  const [ff, setFf] = useState({ sev: 'major', desc: '', cont: '', rc: '', files: [] });
  const [addQ, setAddQ] = useState(null);
  const restoredRef = useRef(false);

  const draftUserKey = () => String(currentUser?.id || currentUser?.loginId || currentUser?.name || '').trim();

  const persistDraft = (a, s) => {
    const key = draftUserKey();
    if (!key) return;
    const rows = getAuditDrafts().filter(d => d.userKey !== key);
    if (a || s) {
      rows.unshift({
        id: 'draft_' + key.replace(/[^A-Za-z0-9_-]+/g, '_'),
        userKey: key, loginId: currentUser?.loginId || '', userName: currentUser?.name || '',
        audit: a || null, session: s || null, status: 'draft', updatedAt: new Date().toISOString(),
      });
    }
    writeSyncKey('ap_audit_drafts', rows.slice(0, 100), currentUser?.loginId);
  };
  const clearDraft = () => {
    const key = draftUserKey();
    if (!key) return;
    // The server-side merge unions by userKey and never drops a row missing from the
    // incoming array, so simply omitting our row here would NOT delete it — it would
    // silently keep resurrecting on the next merge. Mark it 'submitted' instead; the
    // restore check above already excludes status:'submitted' drafts.
    const rows = getAuditDrafts().filter(d => d.userKey !== key);
    rows.unshift({
      id: 'draft_' + key.replace(/[^A-Za-z0-9_-]+/g, '_'),
      userKey: key, loginId: currentUser?.loginId || '', userName: currentUser?.name || '',
      audit: null, session: null, status: 'submitted', updatedAt: new Date().toISOString(),
    });
    writeSyncKey('ap_audit_drafts', rows.slice(0, 100), currentUser?.loginId);
  };

  // Resume an in-progress audit saved from another device/session (this device has no
  // active audit in memory yet — e.g. first visit to Execution after a fresh page load).
  // getAuditDrafts() can still be [] on the very first render if the initial /api/sync
  // fetch hasn't resolved yet, so this re-checks whenever that data actually changes
  // (getAuditDrafts is a stable function reference until syncData updates) instead of
  // giving up permanently after a single empty check.
  useEffect(() => {
    if (restoredRef.current || audit) return;
    const key = draftUserKey();
    const draft = key ? getAuditDrafts().find(d => d.userKey === key && d.status !== 'submitted') : null;
    if (draft && (draft.audit || draft.session)) {
      restoredRef.current = true;
      if (draft.audit) setAuditState(draft.audit);
      if (draft.session) setSession(draft.session);
      showToast('Resumed your in-progress audit draft');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAuditDrafts, audit]);

  useEffect(() => {
    if (audit) persistDraft(audit, session);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (audit) {
      setPageAction(() => () => { persistDraft(audit, session); showToast('Draft saved'); });
    } else {
      setPageAction(null);
    }
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audit, session]);

  const setActive = (a) => {
    if (a) persistDraft(a, session);
    else clearDraft();
    setAuditState(a);
  };

  if (role !== 'auditor' && role !== 'admin') {
    return <div className="info-box">Audit Execution restricted to Auditors and Admins.</div>;
  }

  // ── LANDING (no active audit) ──
  if (!audit) {
    const planned = getPlannedAudits();
    const completed = getCompletedAudits();
    const startPlanned = (a) => {
      writeSyncKey('ap_planned_audits', planned.filter(p => p.id !== a.id), currentUser?.loginId);
      setSession(EMPTY_SESSION); setCurSec(0);
      setActive(a);
      showToast(`Starting ${a.deptName} audit...`);
    };
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="stat-card"><div className="stat-label">Planned</div><div className="stat-value" style={{ color: 'var(--accent)' }}>{planned.length}</div></div>
          <div className="stat-card"><div className="stat-label">In Progress</div><div className="stat-value" style={{ color: 'var(--amber)' }}>0</div></div>
          <div className="stat-card"><div className="stat-label">Completed</div><div className="stat-value" style={{ color: 'var(--green)' }}>{completed.length}</div></div>
        </div>

        <div className="card-heading"><span className="dot w-[7px] h-[7px] rounded-full bg-[var(--accent)] flex-shrink-0" />Planned Audits — Click to Start</div>
        {planned.length === 0 ? (
          <div className="info-box">No planned audits. <button className="btn btn-brand btn-sm ml-2" onClick={() => navigate('planning')}>Plan New Audit</button></div>
        ) : planned.map(a => (
          <div key={a.id} className="card" style={{ borderLeft: '3px solid var(--accent)', cursor: 'pointer' }} onClick={() => startPlanned(a)}>
            <div className="flex justify-between items-center">
              <div>
                <div className="text-xs font-bold">{a.deptName} — {a.type}</div>
                <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{a.auditor} · {a.date} · {(a.standards || []).map(s => STD_META[s]?.short || s).join(', ')}</div>
                <div className="text-[10px]" style={{ color: 'var(--text3)' }}>{(a.sections || []).reduce((t, s) => t + (s._checkpoints || []).length, 0)} questions · {(a.sections || []).length} sections</div>
              </div>
              <button className="btn btn-brand btn-sm" onClick={e => { e.stopPropagation(); startPlanned(a); }}><Icon name="play" /> Start</button>
            </div>
          </div>
        ))}

        {completed.length > 0 && (
          <>
            <div className="card-heading"><span className="dot w-[7px] h-[7px] rounded-full bg-[var(--green)] flex-shrink-0" />Completed Audits ({completed.length})</div>
            {completed.slice().reverse().map(a => (
              <div key={a.id || a.ref} className="card" style={{ borderLeft: '3px solid var(--green)' }}>
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-xs font-bold">{a.deptName} — {a.ref}</div>
                    <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{fmtDate(a.submittedAt || a.date)} · {a.auditor} · {(a.standards || []).map(s => STD_META[s]?.short || s).join(', ')}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text3)' }}>{(a.findingRefs || []).length} finding(s)</div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <button className="btn btn-primary btn-sm" onClick={() => navigate('reports')}><Icon name="file-text" /> View Report</button>
                    <Badge type="b-green">Completed</Badge>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  // ── ACTIVE AUDIT ──
  const secs = audit.sections || [];
  const sec = secs[curSec] || secs[0];
  const allQ = secs.flatMap(s => s._checkpoints || []);
  const answered = allQ.filter(q => session.answers[q.id] && session.answers[q.id] !== 'skip').length;
  const skipped = allQ.filter(q => session.answers[q.id] === 'skip').length;
  const findsCount = Object.keys(session.findings).length;
  const pct = allQ.length ? Math.round(answered / allQ.length * 100) : 0;

  const doAns = (qId, ans) => {
    setSession(s => ({ ...s, answers: { ...s.answers, [qId]: ans } }));
    if (ans === 'no' && !session.findings[qId]) {
      const cp = allQ.find(c => c.id === qId);
      openFinding(qId, cp?.text, cp?.aiSuggestion);
    }
    if (ans === 'skip') showToast('Flagged for later review');
  };
  const setNote = (qId, v) => setSession(s => ({ ...s, notes: { ...s.notes, [qId]: v } }));

  const openFinding = (qId, text, ai, editing) => {
    const f = editing ? session.findings[qId] : null;
    setFf({ sev: f?.severity || 'major', desc: f?.desc || '', cont: f?.cont || '', rc: f?.rc || '', files: f?.evidenceFiles || [] });
    setFindingModal({ qId, text: text || qId, ai: ai || 'No similar past findings for this checkpoint.' });
  };
  const saveFinding = () => {
    if (!ff.desc.trim()) { showToast('Describe the finding'); return; }
    const qId = findingModal.qId;
    setSession(s => ({ ...s, findings: { ...s.findings, [qId]: { severity: ff.sev, desc: ff.desc.trim(), cont: ff.cont.trim(), rc: ff.rc, evidenceFiles: ff.files || [], ts: new Date().toLocaleTimeString() } } }));
    setFindingModal(null);
    showToast('Finding logged. CAPA initiated.');
  };
  const removeFinding = (qId) => setSession(s => { const nf = { ...s.findings }; delete nf[qId]; return { ...s, findings: nf }; });

  const markNA = () => setSession(s => { const a = { ...s.answers }; (sec._checkpoints || []).forEach(q => { if (!a[q.id]) a[q.id] = 'na'; }); return { ...s, answers: a }; });
  const clearSec = () => setSession(s => { const a = { ...s.answers }; (sec._checkpoints || []).forEach(q => { delete a[q.id]; }); return { ...s, answers: a }; });
  const jumpUnanswered = () => {
    for (let i = 0; i < secs.length; i++) {
      if ((secs[i]._checkpoints || []).some(q => !session.answers[q.id])) { setCurSec(i); showToast(`Jumped to ${STD_META[secs[i].stdId]?.short || secs[i].title}`); return; }
    }
    showToast('All questions answered!');
  };

  const submit = () => {
    const unanswered = allQ.filter(q => !session.answers[q.id]).length;
    if (unanswered > 0) { showToast(`${unanswered} unanswered. Mark N/A or answer all before submitting.`, 4000); return; }
    const submittedAt = new Date().toISOString();
    const findValues = Object.values(session.findings);
    const auditScoreFrozen = auditScore(findValues);
    const auditFindingCountsFrozen = auditFindingCounts(findValues);
    const capaDue = getCapaDue() || CAPA_DUE_DEFAULTS;
    const existing = getFindings();
    const refPrefix = audit.dept + '-' + new Date().getFullYear() + '-';
    // Derive the next number from the highest existing suffix for this dept/year rather
    // than existing.length — findings can be soft-deleted (filtered out of getFindings()),
    // which would otherwise undercount and regenerate a ref that's already in use.
    let nextSeq = existing.reduce((max, f) => {
      if (!String(f.ref || '').startsWith(refPrefix)) return max;
      const n = parseInt(String(f.ref).slice(refPrefix.length), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0) + 1;
    const newFindings = [];
    Object.entries(session.findings).forEach(([qId, f]) => {
      const cp = allQ.find(q => q.id === qId);
      const ref = refPrefix + String(nextSeq++).padStart(3, '0');
      newFindings.push({
        id: 'f_' + Date.now() + '_' + qId.slice(-6), ref, dept: audit.dept, deptName: audit.deptName,
        desc: f.desc || '', sev: f.severity || 'major', rc: f.rc || '', clause: String(cp?.clause || '—'),
        evidenceFiles: f.evidenceFiles || [],
        createdAt: submittedAt, submittedAt, auditSubmittedAt: submittedAt,
        due: new Date(Date.now() + (capaDue[f.severity] || 30) * 86400000).toISOString().split('T')[0],
        status: 'open', type: 'audit', auditId: audit.id, auditRef: audit.ref,
        capaStatus: 'open', closureEvidence: '', closureFiles: [],
        activityLog: [{ user: currentUser?.name || 'Auditor', action: 'Finding logged during ' + audit.deptName + ' audit (' + audit.ref + ')', ts: new Date().toLocaleString() }],
      });
    });
    const sessionCopy = { answers: { ...session.answers }, findings: { ...session.findings }, notes: { ...session.notes }, genNotes: session.genNotes };
    const completedAudit = { ...audit, status: 'submitted', submittedAt, session: sessionCopy, findingRefs: newFindings.map(f => f.ref), auditScoreFrozen, auditFindingCountsFrozen };
    if (newFindings.length) writeSyncKey('ap_finds', [...existing, ...newFindings], currentUser?.loginId);
    writeSyncKey('ap_completed_audits', [...getCompletedAudits(), completedAudit], currentUser?.loginId);
    setActive(null); setSession(EMPTY_SESSION); setCurSec(0);
    showToast(`Audit submitted! ${newFindings.length} finding(s) saved to Findings Register.`);
    navigate('reports');
  };

  const saveAddQ = () => {
    if (!addQ.text.trim()) { showToast('Question text required'); return; }
    const newCp = { id: 'custom_' + Date.now(), text: addQ.text.trim(), clause: addQ.clause.trim() || 'Custom', weight: Number(addQ.weight) || 3, type: 'Yes/No', tip: addQ.tip.trim(), aiSuggestion: '', dept: audit.dept, standard: 'custom' };
    const next = { ...audit, sections: secs.map((s, i) => i === curSec ? { ...s, _checkpoints: [...(s._checkpoints || []), newCp], cpIds: [...(s.cpIds || []), newCp.id] } : s) };
    setActive(next); setAddQ(null); showToast('Custom question added');
  };

  const sm = STD_META[sec.stdId] || {};
  const stdBadge = (s) => { const m = STD_META[s] || {}; return <span key={s} className="badge" style={{ background: m.bg || 'var(--bg3)', color: m.color || 'var(--text2)', border: `1px solid ${m.border || 'var(--border)'}` }}>{m.short || s}</span>; };
  const rootCauses = getRootCauses();

  return (
    <div className="space-y-3">
      {/* Header */}
      <Card>
        <div className="flex justify-between items-start flex-wrap gap-3">
          <div>
            <div className="text-sm font-extrabold">{audit.deptName} — {audit.type}</div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{audit.date} · {audit.auditor} · {audit.ref}</div>
            <div className="flex gap-2 mt-1 flex-wrap">{(audit.standards || []).map(stdBadge)}</div>
          </div>
          <div className="flex gap-2 flex-wrap items-start">
            <Badge type="b-amber">In Progress</Badge>
            <button className="btn btn-ghost btn-sm" onClick={() => { persistDraft(audit, session); showToast('Draft saved'); }}><Icon name="save" /> Save</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAddQ({ text: '', clause: '', weight: 3, tip: '' })}><Icon name="plus" /> Add Question</button>
            <button className="btn btn-brand btn-sm" onClick={submit}>Submit Audit</button>
          </div>
        </div>
        <div className="mt-2">
          <div className="flex justify-between text-[11px] mb-1"><span style={{ color: 'var(--text3)' }}>Progress</span><span className="font-bold">{answered}/{allQ.length}</span></div>
          <div className="progress-bar" style={{ height: 7 }}><div className="progress-fill" style={{ width: `${pct}%`, background: 'var(--brand)' }} /></div>
          <div className="flex gap-4 mt-2 text-[11px]" style={{ color: 'var(--text3)' }}>
            <span className="flex items-center gap-1"><Icon name="circle-check" className="w-3.5 h-3.5" /> <span className="font-bold" style={{ color: 'var(--green)' }}>{answered}</span></span>
            <span className="flex items-center gap-1"><Icon name="triangle-alert" className="w-3.5 h-3.5" /> <span className="font-bold" style={{ color: 'var(--amber)' }}>{findsCount}</span></span>
            <span className="flex items-center gap-1"><Icon name="skip-forward" className="w-3.5 h-3.5" /> <span className="font-bold">{skipped}</span></span>
            <span>· {allQ.length} total Qs</span>
          </div>
        </div>
      </Card>

      <div className="info-box flex items-center gap-2"><Icon name="lightbulb" className="w-4 h-4" /> <span><strong>Free Navigation</strong> — Jump to any section/question freely. Sections are grouped by audit standard.</span></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Left: sections nav + notes */}
        <div className="space-y-3">
          <Card title="Sections by Standard">
            <div>
              {secs.map((s, i) => {
                const cps = s._checkpoints || [];
                const ans = cps.filter(q => session.answers[q.id]).length;
                const hasF = cps.some(q => session.findings[q.id]);
                const m = STD_META[s.stdId] || {};
                const p = cps.length ? Math.round(ans / cps.length * 100) : 0;
                const icon = ans === cps.length && cps.length > 0 ? 'circle-check' : ans > 0 ? 'circle-dot' : 'circle';
                return (
                  <div key={s.id} className={`secni ${i === curSec ? 'act' : ''}`} onClick={() => setCurSec(i)}>
                    <Icon name={icon} className="w-4 h-4" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="text-xs font-bold truncate">{m.short || s.clause} Checkpoints</div>
                      <div className="text-[10px]" style={{ color: 'var(--text3)' }}>{ans}/{cps.length}{hasF ? ' · finding' : ''}</div>
                    </div>
                    <div className="flex flex-col items-end gap-[2px]">
                      <span className="badge" style={{ background: m.bg || 'var(--bg3)', color: m.color || 'var(--text2)', border: `1px solid ${m.border || 'var(--border)'}`, fontSize: 8 }}>{m.short || '—'}</span>
                      <span className="text-[10px] font-bold" style={{ color: `var(--${p === 100 ? 'green' : ans > 0 ? 'brand' : 'text3'})` }}>{p}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="btn btn-ghost btn-sm w-full mt-2" onClick={jumpUnanswered}><Icon name="target" /> First Unanswered</button>
            <button className="btn btn-ghost btn-sm w-full mt-1" onClick={() => navigate('planning')}><Icon name="refresh-cw" /> Change Audit</button>
          </Card>
          <Card title="Auditor Notes">
            <textarea style={{ height: 70, resize: 'none', fontSize: 12 }} placeholder="On-site observations..." value={session.genNotes} onChange={e => setSession(s => ({ ...s, genNotes: e.target.value }))} />
            <div className="flex justify-between mt-1 text-[10px]" style={{ color: 'var(--text3)' }}><span>Auto-saved</span></div>
          </Card>
        </div>

        {/* Right: current section */}
        <div className="lg:col-span-2">
          <Card>
            <div className="flex justify-between items-start flex-wrap gap-2">
              <div>
                <div className="flex gap-2 mb-1 flex-wrap">
                  <span className="badge" style={{ background: sm.bg || 'var(--bg3)', color: sm.color || 'var(--text2)', border: `1px solid ${sm.border || 'var(--border)'}` }}>{sm.label || sec.clause}</span>
                  <Badge type={sec.risk === 'High' ? 'b-red' : sec.risk === 'Medium' ? 'b-amber' : 'b-green'}>{sec.risk} Risk</Badge>
                </div>
                <div className="text-xs font-bold">{sec.title}</div>
                <div className="text-[10px]" style={{ color: 'var(--text3)' }}>{(sec._checkpoints || []).length} questions · Section {curSec + 1} of {secs.length}</div>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-ghost btn-sm" onClick={markNA}>All N/A</button>
                <button className="btn btn-ghost btn-sm" onClick={clearSec}>Clear</button>
              </div>
            </div>
          </Card>

          <div className="mt-3 space-y-2">
            {(sec._checkpoints || []).length === 0 ? (
              <div className="warn-box">No checkpoints.</div>
            ) : (sec._checkpoints || []).map(q => {
              const ans = session.answers[q.id], finding = session.findings[q.id], note = session.notes[q.id] || '';
              let cls = 'cq';
              if (ans === 'yes') cls += ' ay'; else if (ans === 'no') cls += ' an'; else if (ans === 'na') cls += ' ana';
              if (finding) cls += ' hf';
              return (
                <div key={q.id} className={cls}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="badge" style={{ background: sm.bg || 'var(--bg3)', color: sm.color || 'var(--text3)', border: `1px solid ${sm.border || 'var(--border)'}`, fontSize: 9 }}>{q.clause}</span>
                    <div className="flex items-center gap-2"><Stars n={q.weight} />{q.aiSuggestion ? <Badge type="b-purple">AI</Badge> : null}</div>
                  </div>
                  <div className="text-xs font-bold" style={{ lineHeight: 1.5, marginBottom: 5 }}>{q.text}</div>
                  {q.tip ? <div className="text-[11px] mb-2 flex items-start gap-1" style={{ color: 'var(--text3)' }}><Icon name="lightbulb" className="w-3 h-3 mt-0.5" /> {q.tip}</div> : null}
                  <div className="ansbts">
                    <button className={`abtn ${ans === 'yes' ? 'sy' : ''}`} onClick={() => doAns(q.id, 'yes')}><Icon name="circle-check" /> Yes / Compliant</button>
                    <button className={`abtn ${ans === 'no' ? 'sn' : ''}`} onClick={() => doAns(q.id, 'no')}><Icon name="circle-x" /> No / Non-Compliant</button>
                    <button className={`abtn ${ans === 'na' ? 'sna' : ''}`} onClick={() => doAns(q.id, 'na')}>N/A</button>
                    <button className="abtn" style={{ borderStyle: 'dashed' }} onClick={() => doAns(q.id, 'skip')}><Icon name="skip-forward" /> Skip</button>
                  </div>
                  <input placeholder="Observation/evidence note (optional)..." style={{ marginTop: 6, fontSize: 11 }} value={note} onChange={e => setNote(q.id, e.target.value)} />
                  {finding && (
                    <div style={{ background: 'var(--amber-bg)', border: '1px solid #fde68a', borderRadius: 6, padding: 8, marginTop: 6 }}>
                      <div className="flex justify-between items-center"><span className="text-[11px] font-bold flex items-center gap-1"><Icon name="triangle-alert" className="w-3 h-3" /> Finding Logged</span><Badge type={SEV_BADGE[finding.severity] || 'b-amber'}>{SEV_LABEL[finding.severity] || finding.severity}</Badge></div>
                      <div className="text-[11px] mt-1" style={{ color: 'var(--text3)' }}>{finding.desc}</div>
                      {(finding.evidenceFiles || []).length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {finding.evidenceFiles.map((ef, i) => (
                            <a key={i} href={mediaUrl(ef)} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1" style={{ width: 80 }}>
                              {isImageMedia(ef) ? (
                                <img src={mediaUrl(ef)} alt={ef.file_name || ef.name} style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                              ) : (
                                <div className="flex items-center justify-center" style={{ width: 80, height: 60, borderRadius: 6, background: 'var(--bg3)', border: '1px solid var(--border)' }}><Icon name="file-text" className="w-4 h-4 opacity-50" /></div>
                              )}
                              <span className="text-[9px] truncate w-full text-center" style={{ color: 'var(--text3)' }}>{ef.file_name || ef.name}</span>
                            </a>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2 mt-2">
                        <button className="btn btn-ghost btn-sm" onClick={() => openFinding(q.id, q.text, q.aiSuggestion, true)}><Icon name="pencil" /> Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => removeFinding(q.id)}><Icon name="trash-2" /> Remove</button>
                      </div>
                    </div>
                  )}
                  {ans === 'no' && !finding && (
                    <button className="btn btn-danger btn-sm mt-1" onClick={() => openFinding(q.id, q.text, q.aiSuggestion)}><Icon name="plus" /> Log Finding</button>
                  )}
                </div>
              );
            })}
            <div className="card" style={{ border: '1px dashed var(--border2)' }}>
              <button className="btn btn-ghost btn-sm w-full" onClick={() => setAddQ({ text: '', clause: '', weight: 3, tip: '' })}><Icon name="plus" /> Add Custom Question to This Section</button>
            </div>
          </div>

          <div className="flex justify-between mt-2">
            <button className="btn btn-ghost btn-sm" onClick={() => setCurSec(c => Math.max(0, c - 1))} disabled={curSec === 0}>‹ Previous</button>
            <button className="btn btn-brand btn-sm" onClick={() => curSec < secs.length - 1 ? setCurSec(c => c + 1) : submit()}>{curSec === secs.length - 1 ? 'Review & Submit' : 'Next Section ›'}</button>
          </div>
        </div>
      </div>

      {/* Finding modal */}
      {findingModal && (
        <div className="modal-bg" onClick={() => setFindingModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span>Log Finding</span><button className="btn btn-ghost btn-icon btn-sm" onClick={() => setFindingModal(null)}><Icon name="x" /></button></div>
            <div className="mb-2 p-2 rounded text-xs italic" style={{ background: 'var(--bg3)' }}>{findingModal.text}</div>
            <div className="info-box mb-2 text-[11px]">{findingModal.ai}</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div><label className="form-label">Severity *</label>
                <select value={ff.sev} onChange={e => setFf(p => ({ ...p, sev: e.target.value }))}>
                  <option value="critical">Critical</option><option value="major">Major</option><option value="minor">Minor</option><option value="obs">Observation</option>
                </select>
              </div>
              <div><label className="form-label">Root Cause</label>
                <select value={ff.rc} onChange={e => setFf(p => ({ ...p, rc: e.target.value }))}>
                  <option value="">Select...</option>
                  {rootCauses.map((r, i) => { const name = typeof r === 'string' ? r : (r.name || r.label || ''); return <option key={i} value={name}>{name}</option>; })}
                </select>
              </div>
            </div>
            <div className="mb-2"><label className="form-label">Finding Description *</label>
              <textarea value={ff.desc} onChange={e => setFf(p => ({ ...p, desc: e.target.value }))} style={{ height: 60, resize: 'none' }} placeholder="Describe what was observed..." />
            </div>
            <div className="mb-3"><label className="form-label">Immediate Correction</label>
              <textarea value={ff.cont} onChange={e => setFf(p => ({ ...p, cont: e.target.value }))} style={{ height: 40, resize: 'none' }} placeholder="What was done on the spot?" />
            </div>
            <div className="mb-3"><EvidenceUploader files={ff.files} onChange={files => setFf(p => ({ ...p, files }))} /></div>
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setFindingModal(null)}>Cancel</button>
              <button className="btn btn-danger flex-1" onClick={saveFinding}>Save Finding</button>
            </div>
          </div>
        </div>
      )}

      {/* Add custom question modal */}
      {addQ && (
        <div className="modal-bg" onClick={() => setAddQ(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span>Add Custom Question</span><button className="btn btn-ghost btn-icon btn-sm" onClick={() => setAddQ(null)}><Icon name="x" /></button></div>
            <div className="mb-2"><label className="form-label">Question Text *</label><textarea value={addQ.text} onChange={e => setAddQ(p => ({ ...p, text: e.target.value }))} style={{ height: 60, resize: 'none' }} /></div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div><label className="form-label">Clause</label><input value={addQ.clause} onChange={e => setAddQ(p => ({ ...p, clause: e.target.value }))} /></div>
              <div><label className="form-label">Weight (1-5)</label><input type="number" min={1} max={5} value={addQ.weight} onChange={e => setAddQ(p => ({ ...p, weight: e.target.value }))} /></div>
            </div>
            <div className="mb-3"><label className="form-label">Audit Tip</label><input value={addQ.tip} onChange={e => setAddQ(p => ({ ...p, tip: e.target.value }))} /></div>
            <div className="flex gap-2"><button className="btn btn-ghost flex-1" onClick={() => setAddQ(null)}>Cancel</button><button className="btn btn-primary flex-1" onClick={saveAddQ}>Add Question</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
