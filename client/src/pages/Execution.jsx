import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge } from '../components/UI';
import { fmtDate, today, showToast, genId } from '../utils/helpers';
import { Icon } from '../components/UI';

export default function Execution() {
  const { getCheckpoints, getDepts, getAuditors, writeSyncKey, currentUser } = useApp();
  const [activeSession, setActiveSession] = useState(null);
  const [answers, setAnswers] = useState({});
  const [sessionFindings, setSessionFindings] = useState([]);
  const [currentFinding, setCurrentFinding] = useState(null);
  const [checklist, setChecklist] = useState([]);

  const depts = getDepts();
  const auditors = getAuditors();
  const checkpoints = getCheckpoints();

  const startNewAudit = (dept, auditor) => {
    if (!dept || !auditor) { showToast('Please select department and auditor'); return; }
    const filtered = checkpoints.filter(c => !c.dept || c.dept.toLowerCase() === dept.toLowerCase());
    setChecklist(filtered);
    setActiveSession({
      id: genId('audit_session'),
      dept,
      auditor,
      startedAt: new Date().toISOString(),
    });
    setAnswers({});
    setSessionFindings([]);
  };

  const handleAnswer = (cpId, val) => {
    setAnswers(prev => ({ ...prev, [cpId]: val }));
    if (val === 'No') {
      const cp = checklist.find(c => c.id === cpId);
      setCurrentFinding({
        cpId,
        question: cp?.text || '',
        sev: 'major',
        desc: '',
        cont: '',
      });
    }
  };

  const saveFinding = () => {
    if (!currentFinding.desc.trim()) { showToast('Please describe the finding'); return; }
    setSessionFindings(prev => [...prev, {
      ...currentFinding,
      id: genId('find'),
      dept: activeSession.dept,
      ref: `NC-${activeSession.dept}-${Date.now().toString().slice(-4)}`,
      status: 'open',
      loggedAt: new Date().toISOString(),
    }]);
    setCurrentFinding(null);
    showToast('Finding added to session');
  };

  const submitAudit = () => {
    // Save completed audit details
    const completedList = JSON.parse(localStorage.getItem('ap_completed_audits') || '[]');
    const finalScore = Math.max(0, 100 - (sessionFindings.length * 10));
    const record = {
      id: activeSession.id,
      dept: activeSession.dept,
      auditor: activeSession.auditor,
      score: finalScore,
      findingsCount: sessionFindings.length,
      date: today(),
    };
    localStorage.setItem('ap_completed_audits', JSON.stringify([...completedList, record]));
    writeSyncKey('ap_completed_audits', [...completedList, record], currentUser?.loginId);

    // Save findings to central database
    const centralFindings = JSON.parse(localStorage.getItem('ap_finds') || '[]');
    localStorage.setItem('ap_finds', JSON.stringify([...centralFindings, ...sessionFindings]));
    writeSyncKey('ap_finds', [...centralFindings, ...sessionFindings], currentUser?.loginId);

    showToast('Audit report submitted successfully');
    setActiveSession(null);
  };

  return (
    <div className="space-y-3">
      {!activeSession ? (
        <Card title="Start Execution">
          <div className="space-y-3 max-w-md">
            <div>
              <label className="form-label">Department</label>
              <select id="exec-dept">
                <option value="">Select Dept</option>
                {depts.map(d => <option key={d.id || d.code} value={d.code}>{d.name || d.code}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Auditor</label>
              <select id="exec-auditor">
                <option value="">Select Auditor</option>
                {auditors.map(a => <option key={a.id || a.name} value={a.name}>{a.name}</option>)}
              </select>
            </div>
            <button
              className="btn btn-brand"
              onClick={() => startNewAudit(
                document.getElementById('exec-dept').value,
                document.getElementById('exec-auditor').value
              )}
            >
              Start QMS Audit Session
            </button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Checklist */}
          <div className="lg:col-span-2 space-y-2">
            <Card title={`Active QMS Checklist — Dept: ${activeSession.dept}`}>
              <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                {checklist.length === 0 ? (
                  <div className="text-center py-8 text-xs" style={{ color: 'var(--text3)' }}>No checkpoints defined for this department.</div>
                ) : checklist.map((cp, idx) => (
                  <div key={cp.id} className={`checkpoint ${answers[cp.id] === 'Yes' ? 'ans-yes' : answers[cp.id] === 'No' ? 'ans-no' : ''}`}>
                    <div className="text-xs font-bold">{idx + 1}. {cp.text}</div>
                    {cp.tip && <div className="text-[10px] mt-1 italic" style={{ color: 'var(--text3)' }}>Tip: {cp.tip}</div>}
                    <div className="ansbts mt-2">
                      <button className={`abtn ${answers[cp.id] === 'Yes' ? 'sy' : ''}`} onClick={() => handleAnswer(cp.id, 'Yes')}>Yes / Conform</button>
                      <button className={`abtn ${answers[cp.id] === 'No' ? 'sn' : ''}`} onClick={() => handleAnswer(cp.id, 'No')}>No / Non-Conforming</button>
                      <button className={`abtn ${answers[cp.id] === 'NA' ? 'sna' : ''}`} onClick={() => handleAnswer(cp.id, 'NA')}>N/A</button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Session Overview */}
          <div className="lg:col-span-1 space-y-3">
            <Card title="Audit Control Panel">
              <div className="space-y-3">
                <div className="flex justify-between text-xs">
                  <span style={{ color: 'var(--text3)' }}>Start Time</span>
                  <span>{fmtDate(activeSession.startedAt)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span style={{ color: 'var(--text3)' }}>Findings Logged</span>
                  <span className="font-bold text-[var(--red)]">{sessionFindings.length} NC</span>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-ghost flex-1" onClick={() => setActiveSession(null)}>Discard</button>
                  <button className="btn btn-brand flex-1" onClick={submitAudit}>Submit Report</button>
                </div>
              </div>
            </Card>

            {sessionFindings.length > 0 && (
              <Card title="Session Findings">
                <div className="space-y-2">
                  {sessionFindings.map(f => (
                    <div key={f.id} className="text-xs border-b pb-2 last:border-b-0" style={{ borderColor: 'var(--bg3)' }}>
                      <div className="flex justify-between font-bold">
                        <span>{f.ref}</span>
                        <span style={{ color: 'var(--red)' }}>{f.sev.toUpperCase()}</span>
                      </div>
                      <div className="line-clamp-2 mt-1" style={{ color: 'var(--text2)' }}>{f.desc}</div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Log Finding Modal */}
      {currentFinding && (
        <div className="modal-bg">
          <div className="modal-box">
            <div className="modal-header">
              <span>⚠️ Log Finding</span>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setCurrentFinding(null)}>✕</button>
            </div>
            <div className="mb-2 p-2 rounded text-xs italic" style={{ background: 'var(--bg3)' }}>{currentFinding.question}</div>
            <div className="mb-2">
              <label className="form-label">Severity *</label>
              <select value={currentFinding.sev} onChange={e => setCurrentFinding(p => ({ ...p, sev: e.target.value }))}>
                <option value="critical">Critical</option>
                <option value="major">Major</option>
                <option value="minor">Minor</option>
                <option value="obs">Observation</option>
              </select>
            </div>
            <div className="mb-2">
              <label className="form-label">Finding Description *</label>
              <textarea
                value={currentFinding.desc}
                onChange={e => setCurrentFinding(p => ({ ...p, desc: e.target.value }))}
                style={{ height: 60, resize: 'none' }}
                placeholder="Describe what was observed..."
              />
            </div>
            <div className="mb-3">
              <label className="form-label">Immediate Correction</label>
              <textarea
                value={currentFinding.cont}
                onChange={e => setCurrentFinding(p => ({ ...p, cont: e.target.value }))}
                style={{ height: 40, resize: 'none' }}
                placeholder="What was done on the spot?"
              />
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setCurrentFinding(null)}>Cancel</button>
              <button className="btn btn-danger flex-1" onClick={saveFinding}>Save Finding</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
