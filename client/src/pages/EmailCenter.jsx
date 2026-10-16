import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Tabs, Badge, Icon, ConfirmModal, EmptyState, Spinner } from '../components/UI';
import { showToast } from '../utils/helpers';
import { EMAIL_TYPES, deptRuleOf, isDeptTypeEnabled, isValidEmail } from '../utils/emailRules';
import { apiFetch } from '../utils/api';

const BUCKET_LABEL = {
  upcoming_reminder: 'Upcoming Reminder',
  delayed: 'Delayed NC',
  escalation_2: 'Escalation → HOD',
  escalation_3: 'Escalation → Management',
};
const BUCKET_BADGE = {
  upcoming_reminder: 'b-blue',
  delayed: 'b-amber',
  escalation_2: 'b-red',
  escalation_3: 'b-purple',
};
const STATUS_BADGE = { sent: 'b-green', 'dry-run': 'b-blue', throttled: 'b-gray', skipped: 'b-amber', failed: 'b-red' };

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="toggle-switch"
      style={{
        width: 36, height: 20, borderRadius: 999, padding: 2, flexShrink: 0,
        background: checked ? 'var(--green)' : 'var(--border2)',
        opacity: disabled ? 0.45 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background .15s', border: 'none',
      }}
    >
      <span style={{
        display: 'block', width: 16, height: 16, borderRadius: '50%', background: '#fff',
        transform: `translateX(${checked ? 16 : 0}px)`, transition: 'transform .15s',
      }} />
    </button>
  );
}

export default function EmailCenter() {
  const { getEmailRules, getDepts, getEmailMaster, getRequiredCcEmails, getEmailLogs, writeSyncKey, currentUser } = useApp();
  const rules = getEmailRules();
  const depts = getDepts();
  const emailMaster = getEmailMaster();
  const globalCc = getRequiredCcEmails();
  const logs = getEmailLogs();

  const [tab, setTab] = useState('routing');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirmSend, setConfirmSend] = useState(false);
  const [suppressInput, setSuppressInput] = useState('');
  const [deptSearch, setDeptSearch] = useState('');
  const [expanded, setExpanded] = useState('');

  const save = (next, msg) => {
    writeSyncKey('ap_email_rules', next, currentUser?.loginId);
    if (msg) showToast(msg);
  };
  const patch = (fields, msg) => save({ ...rules, ...fields }, msg);
  const patchDept = (code, fields, msg) => {
    const dr = deptRuleOf(rules, code);
    save({ ...rules, depts: { ...rules.depts, [code]: { ...dr, ...fields } } }, msg);
  };

  // Departments that actually appear in the Email Master — those are the ones the engine can mail.
  const rows = useMemo(() => {
    const q = deptSearch.trim().toLowerCase();
    return emailMaster
      .filter(m => !q || [m.deptCode, m.department, m.email, m.reportingEmail, m.hodEmail].join(' ').toLowerCase().includes(q))
      .map(m => ({
        code: m.deptCode,
        name: m.department || (depts.find(d => d.code === m.deptCode)?.name) || m.deptCode,
        spoc: m.email || '',
        manager: m.reportingEmail || '',
        hod: m.hodEmail || '',
        masterActive: String(m.status || 'active').toLowerCase() !== 'inactive',
        rule: deptRuleOf(rules, m.deptCode),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [emailMaster, depts, rules, deptSearch]);

  const mutedCount = rows.filter(r => !r.masterActive || r.rule.enabled === false).length;

  const runEngine = async (dryRun) => {
    setBusy(dryRun ? 'preview' : 'send');
    try {
      const res = await apiFetch('/api/email/run', {
        method: 'POST',
        body: JSON.stringify({ dryRun, by: currentUser?.loginId || 'email-center' }),
      });
      setPreview(res);
      setTab('preview');
      if (res.skipped) showToast(res.skipped);
      else if (dryRun) showToast(`Preview ready — ${res.groups} email(s) would go out`);
      else showToast(`${res.sent} sent · ${res.failed} failed · ${res.skipped} skipped`, 5000);
    } catch (err) {
      showToast('Failed: ' + err.message);
    }
    setBusy('');
  };

  const addSuppressed = () => {
    const email = suppressInput.trim().toLowerCase();
    if (!isValidEmail(email)) { showToast('Enter a valid email address'); return; }
    if (rules.suppressed.some(e => e.toLowerCase() === email)) { showToast('Already on the list'); return; }
    patch({ suppressed: [...rules.suppressed, email] }, email + ' will never receive automatic emails');
    setSuppressInput('');
  };

  const autoLogs = useMemo(
    () => logs.filter(l => ['upcoming_reminder', 'delayed', 'escalation_2', 'escalation_3'].includes(l.type)).slice(0, 40),
    [logs]
  );

  return (
    <div className="space-y-4">
      {/* Master switch */}
      <Card>
        <div className="flex items-center gap-3 flex-wrap">
          <Toggle checked={rules.enabled !== false} onChange={v => patch({ enabled: v }, v ? 'Automatic emails resumed' : 'Automatic emails paused')} />
          <div className="flex-1 min-w-[220px]">
            <div className="text-sm font-bold">
              Automatic emails are {rules.enabled === false
                ? <span style={{ color: 'var(--red)' }}>PAUSED</span>
                : <span style={{ color: 'var(--green)' }}>ON</span>}
            </div>
            <div className="text-[11px]" style={{ color: 'var(--text3)' }}>
              The server sends reminders every morning at 9:00 IST, whether or not anyone has the portal open.
              {mutedCount > 0 && <> · <strong>{mutedCount}</strong> department(s) individually switched off.</>}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => runEngine(true)}>
            {busy === 'preview' ? <Spinner /> : <Icon name="eye" />} Preview
          </button>
          <button className="btn btn-primary btn-sm" disabled={!!busy || rules.enabled === false} onClick={() => setConfirmSend(true)}>
            {busy === 'send' ? <Spinner /> : <Icon name="send" />} Send Now
          </button>
        </div>
      </Card>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'routing', label: 'Who Gets Emailed', count: rows.length },
          { id: 'rules', label: 'Rules & Timing' },
          { id: 'suppress', label: 'Never Email', count: rules.suppressed.length },
          { id: 'preview', label: 'Preview', count: preview ? preview.groups : null },
          { id: 'logs', label: 'Sent Log', count: autoLogs.length },
        ]}
      />

      {/* ── WHO GETS EMAILED ── */}
      {tab === 'routing' && (
        <Card title="Department Routing">
          <div className="text-[11px] mb-2" style={{ color: 'var(--text3)' }}>
            Switch a whole department off, or silence just one kind of email for it. Everything left on
            goes to the SPOC with the Manager and HOD in CC.
          </div>
          <input
            placeholder="Search department, SPOC, manager, HOD..."
            value={deptSearch}
            onChange={e => setDeptSearch(e.target.value)}
            className="mb-2"
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 44 }}>On</th>
                  <th>Department</th>
                  <th>Recipients</th>
                  {EMAIL_TYPES.map(t => <th key={t.key} style={{ width: 90, textAlign: 'center' }}>{t.label}</th>)}
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 18, color: 'var(--text3)' }}>No departments in the Email Master</td></tr>
                )}
                {rows.map(r => {
                  const deptOn = r.rule.enabled !== false;
                  const isOpen = expanded === r.code;
                  return (
                    <React.Fragment key={r.code}>
                      <tr style={{ opacity: deptOn && r.masterActive ? 1 : 0.5 }}>
                        <td><Toggle checked={deptOn && r.masterActive} disabled={!r.masterActive} onChange={v => patchDept(r.code, { enabled: v }, `${r.name}: automatic emails ${v ? 'on' : 'off'}`)} /></td>
                        <td>
                          <div className="font-bold text-[11px]">{r.name}</div>
                          <div className="text-[9px]" style={{ color: 'var(--text3)' }}>{r.code}</div>
                          {!r.masterActive && <Badge type="b-gray">Email record inactive</Badge>}
                        </td>
                        <td>
                          {r.spoc
                            ? <div className="text-[10px]">{r.spoc}</div>
                            : <div className="text-[10px]" style={{ color: 'var(--red)' }}>No SPOC email — will fall back to Manager/HOD</div>}
                          <div className="text-[9px]" style={{ color: 'var(--text3)' }}>
                            CC: {[rules.ccManager !== false && r.manager, rules.ccHod !== false && r.hod].filter(Boolean).join(', ') || '—'}
                          </div>
                        </td>
                        {EMAIL_TYPES.map(t => {
                          const on = isDeptTypeEnabled(rules, r.code, t.key);
                          const blockedGlobally = rules.types[t.key] === false;
                          return (
                            <td key={t.key} style={{ textAlign: 'center' }}>
                              <div className="inline-flex">
                                <Toggle
                                  checked={on}
                                  disabled={!deptOn || !r.masterActive || blockedGlobally}
                                  onChange={v => patchDept(r.code, { types: { ...(r.rule.types || {}), [t.key]: v } }, `${r.name} · ${t.label}: ${v ? 'on' : 'off'}`)}
                                />
                              </div>
                            </td>
                          );
                        })}
                        <td>
                          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setExpanded(isOpen ? '' : r.code)}>
                            <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} />
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} style={{ background: 'var(--bg3)' }}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-2">
                              <div>
                                <label className="form-label">Extra CC for {r.code} (comma separated)</label>
                                <input
                                  defaultValue={(r.rule.extraCc || []).join(', ')}
                                  placeholder="someone@onepws.com, another@onepws.com"
                                  onBlur={e => {
                                    const list = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                    const bad = list.filter(x => !isValidEmail(x));
                                    if (bad.length) { showToast('Invalid: ' + bad.join(', ')); return; }
                                    patchDept(r.code, { extraCc: list }, 'Extra CC saved for ' + r.code);
                                  }}
                                />
                                <div className="text-[9px] mt-1" style={{ color: 'var(--text3)' }}>Added to CC on every automatic email for this department.</div>
                              </div>
                              <div>
                                <label className="form-label">Override To (leave blank to use the SPOC)</label>
                                <input
                                  defaultValue={(r.rule.overrideTo || []).join(', ')}
                                  placeholder="Defaults to SPOC / HOD by email type"
                                  onBlur={e => {
                                    const list = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                    const bad = list.filter(x => !isValidEmail(x));
                                    if (bad.length) { showToast('Invalid: ' + bad.join(', ')); return; }
                                    patchDept(r.code, { overrideTo: list }, list.length ? 'To override saved for ' + r.code : 'To override cleared');
                                  }}
                                />
                                <div className="text-[9px] mt-1" style={{ color: 'var(--text3)' }}>Replaces the normal To line for this department, for every email type.</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── RULES & TIMING ── */}
      {tab === 'rules' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card title="Email Types">
            <div className="text-[11px] mb-2" style={{ color: 'var(--text3)' }}>
              Turning a type off here silences it for every department at once.
            </div>
            {EMAIL_TYPES.map(t => (
              <div key={t.key} className="flex items-center gap-3 py-2" style={{ borderBottom: '1px solid var(--border2)' }}>
                <Toggle checked={rules.types[t.key] !== false} onChange={v => patch({ types: { ...rules.types, [t.key]: v } }, `${t.label} ${v ? 'enabled' : 'disabled'}`)} />
                <div className="flex-1">
                  <div className="text-[11px] font-bold">{t.label}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text3)' }}>{t.desc}</div>
                </div>
                <Badge type="b-gray">To: {t.to}</Badge>
              </div>
            ))}
          </Card>

          <Card title="CC Policy">
            <div className="text-[11px] mb-2" style={{ color: 'var(--text3)' }}>
              Applied to every automatic email, on top of each department's own entry in the Email Master.
            </div>
            {[
              ['ccManager', 'CC the department Manager', 'Reporting-To email from the Email Master'],
              ['ccHod', 'CC the HOD / BUH', 'HOD/BUH email from the Email Master'],
              ['ccGlobal', 'CC the global list', globalCc.length ? globalCc.join(', ') : 'No global CC addresses configured'],
            ].map(([key, label, desc]) => (
              <div key={key} className="flex items-center gap-3 py-2" style={{ borderBottom: '1px solid var(--border2)' }}>
                <Toggle checked={rules[key] !== false} onChange={v => patch({ [key]: v }, `${label}: ${v ? 'on' : 'off'}`)} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold">{label}</div>
                  <div className="text-[10px] truncate" style={{ color: 'var(--text3)' }}>{desc}</div>
                </div>
              </div>
            ))}
          </Card>

          <Card title="Timing">
            <div className="mb-3">
              <label className="form-label">Remind this many days before the target date</label>
              <input
                type="number" min={0} max={2}
                value={rules.windowDays}
                onChange={e => patch({ windowDays: Math.max(0, Math.min(2, Number(e.target.value) || 0)) })}
              />
              <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>
                Upcoming reminders start {rules.windowDays} day(s) before an NC is due.
              </div>
            </div>
            <div className="card-heading mt-2"><span className="dot w-[7px] h-[7px] rounded-full bg-[var(--teal)] flex-shrink-0" />How often to repeat</div>
            {[
              ['upcoming_reminder', 'Upcoming Reminder'],
              ['delayed', 'Delayed NC'],
              ['escalation_2', 'Escalation → HOD (overdue 7-14d)'],
              ['escalation_3', 'Escalation → Management (overdue 15d+)'],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center gap-2 py-1">
                <div className="flex-1 text-[11px]">{label}</div>
                <input
                  type="number" min={1} max={365} style={{ width: 70 }}
                  value={rules.frequencies[key]}
                  onChange={e => patch({ frequencies: { ...rules.frequencies, [key]: Math.max(1, Math.min(365, Number(e.target.value) || 1)) } })}
                />
                <div className="text-[10px]" style={{ color: 'var(--text3)', width: 60 }}>day(s)</div>
              </div>
            ))}
            <div className="text-[10px] mt-2" style={{ color: 'var(--text3)' }}>
              A department will not receive the same kind of email again until its interval has elapsed.
            </div>
          </Card>

          <Card title="Schedule">
            <div className="text-[11px]" style={{ color: 'var(--text2)' }}>
              <p className="mb-2">The reminder engine runs on the server, not in the browser — reminders go out even when nobody is logged in.</p>
              <div className="flex justify-between py-1" style={{ borderBottom: '1px solid var(--border2)' }}>
                <span style={{ color: 'var(--text3)' }}>Runs at</span><strong>09:00 daily (Asia/Kolkata)</strong>
              </div>
              <div className="flex justify-between py-1" style={{ borderBottom: '1px solid var(--border2)' }}>
                <span style={{ color: 'var(--text3)' }}>Grouping</span><strong>One email per department, per type</strong>
              </div>
              <div className="flex justify-between py-1">
                <span style={{ color: 'var(--text3)' }}>Escalation path</span><strong>SPOC → HOD (7d) → Management (15d)</strong>
              </div>
              <p className="mt-3 text-[10px]" style={{ color: 'var(--text3)' }}>
                The schedule itself is set by <code>EMAIL_CRON</code> on the server. Use <strong>Preview</strong> above to see
                exactly who would be emailed right now without sending anything.
              </p>
            </div>
          </Card>
        </div>
      )}

      {/* ── NEVER EMAIL ── */}
      {tab === 'suppress' && (
        <Card title="Never Email These Addresses">
          <div className="text-[11px] mb-3" style={{ color: 'var(--text3)' }}>
            A hard block. These addresses are stripped from the To and CC of every automatic email, no
            matter what the Email Master says. Useful for people who have left, shared inboxes, or anyone
            who has asked to be taken off. Manual and test emails are unaffected.
          </div>
          <div className="flex gap-2 mb-3">
            <input
              placeholder="someone@onepws.com"
              value={suppressInput}
              onChange={e => setSuppressInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addSuppressed(); }}
            />
            <button className="btn btn-primary btn-sm" onClick={addSuppressed}><Icon name="ban" /> Block</button>
          </div>
          {rules.suppressed.length === 0 ? (
            <EmptyState icon="mail-check" title="Nobody is blocked" subtitle="Every address in the Email Master can receive automatic emails." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {rules.suppressed.map(email => (
                <span key={email} className="badge b-red flex items-center gap-1">
                  {email}
                  <button
                    className="ml-1"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                    onClick={() => patch({ suppressed: rules.suppressed.filter(e => e !== email) }, email + ' unblocked')}
                  >
                    <Icon name="x" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── PREVIEW ── */}
      {tab === 'preview' && (
        <Card
          title="Preview"
          action={<button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => runEngine(true)}>{busy === 'preview' ? <Spinner /> : <Icon name="refresh-cw" />} Refresh</button>}
        >
          {!preview ? (
            <EmptyState icon="eye" title="Nothing previewed yet" subtitle="Hit Preview to see exactly who would be emailed right now — nothing is sent." />
          ) : preview.skipped ? (
            <div className="p-3 rounded text-xs" style={{ background: 'var(--amber-bg)', border: '1px solid #fde68a' }}>{preview.skipped}</div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                <div className="stat-card"><div className="stat-label">Emails</div><div className="stat-value">{preview.groups}</div></div>
                <div className="stat-card"><div className="stat-label">{preview.dryRun ? 'Would send' : 'Sent'}</div><div className="stat-value" style={{ color: 'var(--green)' }}>{preview.dryRun ? preview.results.filter(r => r.status === 'dry-run').length : preview.sent}</div></div>
                <div className="stat-card"><div className="stat-label">Skipped</div><div className="stat-value" style={{ color: 'var(--amber)' }}>{preview.skipped ?? preview.results.filter(r => r.status === 'skipped' || r.status === 'throttled').length}</div></div>
                <div className="stat-card"><div className="stat-label">Muted by you</div><div className="stat-value" style={{ color: 'var(--text3)' }}>{(preview.muted || []).length}</div></div>
              </div>
              <div className="text-[10px] mb-2" style={{ color: 'var(--text3)' }}>
                As of {preview.today} ({preview.tz}){preview.dryRun ? ' · dry run, nothing was sent' : ' · these were actually sent'}
              </div>
              <div className="space-y-2">
                {preview.results.map((r, i) => (
                  <div key={i} className="p-2 rounded" style={{ border: '1px solid var(--border2)' }}>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge type={BUCKET_BADGE[r.bucket] || 'b-gray'}>{BUCKET_LABEL[r.bucket] || r.bucket}</Badge>
                      <strong className="text-[11px]">{r.deptName || r.dept}</strong>
                      <Badge type={STATUS_BADGE[r.status] || 'b-gray'}>{r.status}</Badge>
                      <span className="text-[10px]" style={{ color: 'var(--text3)' }}>{r.ncCount} NC</span>
                    </div>
                    {r.reason || r.error ? (
                      <div className="text-[10px]" style={{ color: r.status === 'failed' ? 'var(--red)' : 'var(--text3)' }}>{r.reason || r.error}</div>
                    ) : (
                      <div className="text-[10px]" style={{ color: 'var(--text3)' }}>
                        <div><strong>To:</strong> {(r.to || []).join(', ')}</div>
                        <div><strong>CC:</strong> {(r.cc || []).join(', ') || '—'}</div>
                        <div className="mt-1">{r.subject}</div>
                      </div>
                    )}
                  </div>
                ))}
                {(preview.muted || []).map((m, i) => (
                  <div key={'m' + i} className="p-2 rounded flex items-center gap-2 flex-wrap" style={{ border: '1px dashed var(--border2)', opacity: 0.7 }}>
                    <Badge type="b-gray">muted</Badge>
                    <strong className="text-[11px]">{m.deptCode}</strong>
                    <span className="text-[10px]" style={{ color: 'var(--text3)' }}>{m.reason}</span>
                  </div>
                ))}
                {preview.results.length === 0 && (preview.muted || []).length === 0 && (
                  <EmptyState icon="mail-check" title="Nothing to send" subtitle="No NC is due or overdue right now." />
                )}
              </div>
            </>
          )}
        </Card>
      )}

      {/* ── SENT LOG ── */}
      {tab === 'logs' && (
        <Card title="Automatic Emails Sent">
          {autoLogs.length === 0 ? (
            <EmptyState icon="inbox" title="No automatic emails yet" subtitle="Reminders sent by the server will appear here." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>When</th><th>Type</th><th>To</th><th>CC</th><th>Subject</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {autoLogs.map((l, i) => (
                    <tr key={l.id || i}>
                      <td className="text-[10px]">{l.sentAt ? new Date(l.sentAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                      <td><Badge type={BUCKET_BADGE[l.type] || 'b-gray'}>{BUCKET_LABEL[l.type] || l.type}</Badge></td>
                      <td className="text-[10px]">{l.to || '—'}</td>
                      <td className="text-[10px]" style={{ color: 'var(--text3)' }}>{l.cc || '—'}</td>
                      <td className="text-[10px]">{l.subject}</td>
                      <td><Badge type={STATUS_BADGE[l.status] || 'b-gray'}>{l.status}</Badge>{l.error && <div className="text-[9px]" style={{ color: 'var(--red)' }}>{l.error}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <ConfirmModal
        open={confirmSend}
        message="This sends real reminder emails to SPOCs, Managers and HODs right now, using the current rules. Preview first if you are not sure. Continue?"
        onCancel={() => setConfirmSend(false)}
        onConfirm={() => { setConfirmSend(false); runEngine(false); }}
      />
    </div>
  );
}
