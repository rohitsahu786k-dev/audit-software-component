import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, Tabs, EmptyState, ConfirmModal } from '../components/UI';
import { fmtDate, SEV_BADGE, SEV_LABEL, STAT_BADGE, STAT_LABEL, showToast, today } from '../utils/helpers';
import { Icon } from '../components/UI';

export default function CAPA() {
  const { getFindings, writeSyncKey, currentUser } = useApp();
  const [tab, setTab] = useState('all');
  const [selected, setSelected] = useState(null);
  const [closureEv, setClosureEv] = useState('');
  const [closing, setClosing] = useState(false);

  const findings = getFindings();

  const capaList = useMemo(() => {
    return findings.filter(f => {
      const isCapa = ['critical', 'major', 'minor'].includes(String(f.sev||f.severity||'').toLowerCase());
      if (!isCapa) return false;
      const status = String(f.status || '').toLowerCase();
      if (tab === 'open') return ['open', 'in-progress', 'delayed'].includes(status);
      if (tab === 'pending') return status === 'pending-closure';
      if (tab === 'closed') return status === 'closed';
      return true;
    });
  }, [findings, tab]);

  const submitClosure = () => {
    if (!selected || !closureEv.trim()) { showToast('Please enter evidence of closure'); return; }
    const updated = findings.map(f => {
      if (f.id !== selected.id) return f;
      const log = Array.isArray(f.activityLog) ? [...f.activityLog] : [];
      log.push({
        ts: new Date().toISOString(),
        by: currentUser?.loginId || 'spoc',
        msg: `Submitted closure evidence: ${closureEv.trim()}`
      });
      return {
        ...f,
        status: 'pending-closure',
        capaStatus: 'submitted',
        closureEvidence: closureEv.trim(),
        activityLog: log,
        updatedAt: new Date().toISOString(),
      };
    });
    writeSyncKey('ap_finds', updated, currentUser?.loginId);
    showToast('Closure request submitted');
    setClosureEv('');
    setSelected(null);
    setClosing(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* CAPA List */}
      <div className="lg:col-span-1 space-y-3">
        <Tabs
          tabs={[
            { id: 'all', label: 'All CAPA' },
            { id: 'open', label: 'Open' },
            { id: 'pending', label: 'Pending Review' },
            { id: 'closed', label: 'Closed' }
          ]}
          active={tab}
          onChange={setTab}
        />
        <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
          {capaList.length === 0 ? (
            <EmptyState icon="check-circle" title="No CAPA items" />
          ) : capaList.map(f => (
            <div
              key={f.id}
              className={`capa-item ${selected?.id === f.id ? 'active' : ''}`}
              onClick={() => { setSelected(f); setClosureEv(f.closureEvidence || ''); }}
            >
              <div className="flex justify-between items-start gap-1">
                <span className="font-bold text-xs">{f.ref || f.id}</span>
                <Badge type={STAT_BADGE[f.status]}>{STAT_LABEL[f.status]}</Badge>
              </div>
              <div className="text-xs line-clamp-2 my-1" style={{ color: 'var(--text2)' }}>{f.desc || f.description}</div>
              <div className="flex justify-between items-center text-[10px] mt-2" style={{ color: 'var(--text3)' }}>
                <span>Dept: {f.dept}</span>
                <span>Due: {fmtDate(f.dueDate)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Details View */}
      <div className="lg:col-span-2">
        {selected ? (
          <Card title={`CAPA Details: ${selected.ref || selected.id}`}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <div className="text-[10px] uppercase font-bold" style={{ color: 'var(--text3)' }}>Department</div>
                  <div className="text-xs font-bold">{selected.dept}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold" style={{ color: 'var(--text3)' }}>Severity</div>
                  <Badge type={SEV_BADGE[selected.sev||selected.severity]}>{SEV_LABEL[selected.sev||selected.severity]}</Badge>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold" style={{ color: 'var(--text3)' }}>Due Date</div>
                  <div className="text-xs font-bold" style={{ color: selected.dueDate && selected.dueDate < today() ? 'var(--red)' : 'inherit' }}>
                    {fmtDate(selected.dueDate)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold" style={{ color: 'var(--text3)' }}>Status</div>
                  <Badge type={STAT_BADGE[selected.status]}>{STAT_LABEL[selected.status]}</Badge>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase font-bold mb-1" style={{ color: 'var(--text3)' }}>Description</div>
                <div className="text-xs p-3 rounded-lg" style={{ background: 'var(--bg3)', color: 'var(--text2)' }}>
                  {selected.desc || selected.description}
                </div>
              </div>

              {selected.closureEvidence && (
                <div>
                  <div className="text-[10px] uppercase font-bold mb-1" style={{ color: 'var(--text3)' }}>Closure Evidence</div>
                  <div className="text-xs p-3 rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg2)', color: 'var(--text2)' }}>
                    {selected.closureEvidence}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              {['open', 'in-progress', 'delayed'].includes(selected.status) && (
                <div className="pt-2">
                  {!closing ? (
                    <button className="btn btn-brand" onClick={() => setClosing(true)}>
                      <Icon name="check-circle" /> Submit Closure Evidence
                    </button>
                  ) : (
                    <div className="space-y-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                      <div>
                        <label className="form-label">Closure Explanation *</label>
                        <textarea
                          value={closureEv}
                          onChange={e => setClosureEv(e.target.value)}
                          placeholder="Describe the corrective actions taken..."
                          style={{ height: 80, resize: 'none' }}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button className="btn btn-ghost" onClick={() => setClosing(false)}>Cancel</button>
                        <button className="btn btn-success" onClick={submitClosure}>Submit Review Request</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Activity Log */}
              <div>
                <div className="text-[10px] uppercase font-bold mb-2" style={{ color: 'var(--text3)' }}>Action History</div>
                <div className="space-y-2">
                  {(selected.activityLog || []).map((l, i) => (
                    <div key={i} className="text-xs flex gap-2 border-b pb-2 last:border-0" style={{ borderColor: 'var(--bg3)' }}>
                      <span className="font-bold text-[10px] whitespace-nowrap" style={{ color: 'var(--text3)' }}>{fmtDate(l.ts || l.at)}</span>
                      <span className="font-bold text-[10px] whitespace-nowrap" style={{ color: 'var(--accent)' }}>[{l.by}]</span>
                      <span style={{ color: 'var(--text2)' }}>{l.msg || l.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <Card>
            <EmptyState icon="arrow-left" title="Select a CAPA item from the list to view details" />
          </Card>
        )}
      </div>
    </div>
  );
}
