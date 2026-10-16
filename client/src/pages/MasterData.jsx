import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Tabs, Badge, ConfirmModal, Icon, Pagination } from '../components/UI';
import { showToast, genId } from '../utils/helpers';
import { clauseDescription } from '../utils/dashboardHelpers';
import { apiFetch } from '../utils/api';

const CP_PAGE_SIZE = 15;

function deptCodeFromName(name, depts) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  const existing = depts.find(d => d.name.toLowerCase() === clean.toLowerCase() || d.code.toLowerCase() === clean.toLowerCase());
  if (existing) return existing.code;
  let code = clean.toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 5);
  if (!code) code = 'DEPT';
  const used = new Set(depts.map(d => d.code));
  let base = code, n = 2;
  while (used.has(code)) { code = (base + n).slice(0, 6); n++; }
  return code;
}
function splitEmailList(value) {
  return String(value || '').split(/\|\||[;,]/).map(x => x.trim()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
}
function joinEmailList(value) { return splitEmailList(value).join(', '); }
function replaceTemplate(str, vars) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
}

export default function MasterData() {
  const {
    getDepts, getAuditors, getCheckpoints, getRootCauses, getEmailMaster,
    getEmailTemplates, getEmailLogs, getRequiredCcEmails, writeSyncKey, currentUser, setPageAction,
  } = useApp();
  const [tab, setTab] = useState('depts');
  const [editItem, setEditItem] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [cpPage, setCpPage] = useState(1);

  const [rcEdit, setRcEdit] = useState(null); // null = add mode
  const [emEdit, setEmEdit] = useState(null);
  const [emSearch, setEmSearch] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [tplId, setTplId] = useState(null);
  const [tplDraft, setTplDraft] = useState(null);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [checkingSmtp, setCheckingSmtp] = useState(false);

  const depts = getDepts();
  const auditors = getAuditors();
  const cps = getCheckpoints();
  const rootCauses = getRootCauses();
  const emailMaster = getEmailMaster();
  const templates = getEmailTemplates();
  const emailLogs = getEmailLogs();
  const ccList = getRequiredCcEmails();
  const canEdit = currentUser?.role === 'admin';

  useEffect(() => {
    setPageAction(() => () => {
      if (tab === 'depts') setEditItem({ name: '', code: '', spoc: '', risk: 'Medium', freq: 4 });
      else if (tab === 'auds') setEditItem({ name: '', empId: '', cert: '', spec: '', email: '', status: 'active' });
      else if (tab === 'cps') setEditItem({ text: '', clause: '', weight: 3, type: 'Yes/No', dept: '', tip: '', aiSuggestion: '' });
      else if (tab === 'rootcauses') setRcEdit(null);
      else if (tab === 'emailmaster') setEmEdit(null);
    });
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const activeTpl = templates.find(t => t.id === tplId) || templates[0] || null;
  useEffect(() => {
    if (activeTpl && (!tplDraft || tplDraft.id !== activeTpl.id)) {
      setTplDraft({ id: activeTpl.id, name: activeTpl.name || '', subject: activeTpl.subject || '', body: activeTpl.body || '', active: activeTpl.active !== false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTpl?.id]);

  // ── Depts / Auditors / Checkpoints (modal CRUD) ──
  const storageKeyFor = (t) => t === 'depts' ? 'ap_depts' : t === 'auds' ? 'ap_auds' : 'ap_cps';
  const listFor = (t) => t === 'depts' ? getDepts() : t === 'auds' ? getAuditors() : getCheckpoints();

  const handleSave = () => {
    if (!editItem) return;
    if (tab === 'depts' && (!editItem.name?.trim() || !editItem.code?.trim())) { showToast('Code and Name required'); return; }
    if (tab === 'cps' && !editItem.text?.trim()) { showToast('Question text required'); return; }
    if (tab === 'auds' && !editItem.name?.trim()) { showToast('Name required'); return; }
    const current = listFor(tab);
    const updated = editItem.id
      ? current.map(item => item.id === editItem.id ? { ...item, ...editItem } : item)
      : [...current, { ...editItem, id: genId(tab), ...(tab === 'auds' ? { auditsYTD: 0 } : {}), ...(tab === 'depts' ? { lastAudit: '—' } : {}) }];
    writeSyncKey(storageKeyFor(tab), updated, currentUser?.loginId);
    setEditItem(null);
    showToast('Record saved successfully');
  };

  const handleDelete = () => {
    const { type, id } = confirmDelete;
    const updated = listFor(type).filter(item => item.id !== id);
    writeSyncKey(storageKeyFor(type), updated, currentUser?.loginId);
    setConfirmDelete(null);
    showToast('Record deleted');
  };

  const cpTotalPages = Math.max(1, Math.ceil(cps.length / CP_PAGE_SIZE));
  const cpSafePage = Math.min(cpPage, cpTotalPages);
  const pagedCps = cps.slice((cpSafePage - 1) * CP_PAGE_SIZE, cpSafePage * CP_PAGE_SIZE);

  // ── Root Causes ──
  const saveRootCause = () => {
    const name = (rcEdit?.name || '').trim();
    if (!name) { showToast('Root cause name required'); return; }
    const rows = getRootCauses().slice();
    const id = rcEdit?.id || genId('rc');
    if (rows.some(r => r.id !== id && String(r.name || '').toLowerCase() === name.toLowerCase())) { showToast('Root cause already exists'); return; }
    const existing = rows.find(r => r.id === id) || {};
    const obj = { id, name, status: rcEdit?.status || 'active', createdAt: existing.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    const idx = rows.findIndex(r => r.id === id);
    if (idx >= 0) rows[idx] = obj; else rows.unshift(obj);
    writeSyncKey('ap_root_causes', rows, currentUser?.loginId);
    setRcEdit(null);
    showToast('Root cause saved');
  };
  const deleteRootCause = (id) => {
    writeSyncKey('ap_root_causes', getRootCauses().filter(r => r.id !== id), currentUser?.loginId);
    setRcEdit(null);
    showToast('Root cause deleted');
  };

  // ── Email Master ──
  const filteredEmailMaster = emailMaster.filter(r => {
    const q = emSearch.toLowerCase();
    if (!q) return true;
    return [r.spocName, r.email, r.department, r.deptCode, r.reportingName, r.reportingEmail, r.hodEmail, r.managementEmail].join(' ').toLowerCase().includes(q);
  });
  const saveEmailMaster = () => {
    const email = (emEdit?.email || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Valid SPOC email required'); return; }
    const dept = depts.find(d => d.code === emEdit.deptCode) || {};
    const rows = getEmailMaster().slice();
    const id = emEdit?.id || genId('em');
    const existing = rows.find(x => x.id === id) || {};
    const obj = {
      id, spocName: (emEdit.spocName || '').trim(), email, deptCode: emEdit.deptCode, department: dept.name || emEdit.deptCode,
      reportingName: (emEdit.reportingName || '').trim(), reportingEmail: (emEdit.reportingEmail || '').trim(),
      hodEmail: (emEdit.hodEmail || '').trim(), managementEmail: (emEdit.managementEmail || '').trim(),
      status: emEdit.status || 'active', createdAt: existing.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const idx = rows.findIndex(x => x.id === id);
    if (idx >= 0) rows[idx] = obj; else rows.unshift(obj);
    writeSyncKey('ap_email_master', rows, currentUser?.loginId);
    setEmEdit(null);
    showToast('Email master saved');
  };
  const deleteEmailMaster = (id) => {
    writeSyncKey('ap_email_master', getEmailMaster().filter(x => x.id !== id), currentUser?.loginId);
    showToast('Deleted');
  };
  const toggleEmailMasterStatus = (record) => {
    const active = String(record.status || 'active').toLowerCase() === 'active';
    const nextStatus = active ? 'inactive' : 'active';
    writeSyncKey('ap_email_master', getEmailMaster().map(row => row.id === record.id ? { ...row, status: nextStatus, updatedAt: new Date().toISOString() } : row), currentUser?.loginId);
    showToast(`${record.spocName || record.email} ${active ? 'deactivated' : 'activated'} for automatic emails`);
  };
  const downloadEmailSample = () => {
    if (!window.XLSX) { showToast('Excel loading...'); return; }
    const ws = window.XLSX.utils.json_to_sheet([{ SPOCName: 'A. Gupta', EmailID: 'spoc@example.com', DepartmentName: 'Stores', ReportingToName: 'Manager', ReportingToEmail: 'manager@example.com', HODBUHEmail: 'hod@example.com', ManagementEmail: 'management@example.com', Status: 'Active' }]);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Email Master');
    window.XLSX.writeFile(wb, 'Email_Master_Sample.xlsx');
  };
  const importEmailMaster = (evt) => {
    const file = evt.target.files?.[0];
    if (!file) return;
    if (!window.XLSX) { showToast('Excel loading...'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = window.XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets['Email ID Database'] || wb.Sheets[wb.SheetNames[0]];
        const data = window.XLSX.utils.sheet_to_json(sheet);
        let imported = 0, updated = 0;
        const rows = getEmailMaster().slice();
        let deptRows = getDepts().slice();
        data.forEach(row => {
          const deptName = String(row.DepartmentName || row.Department || row.dept || row['Department Name'] || '').trim();
          if (!deptName) return;
          let dept = deptRows.find(d => d.name.toLowerCase() === deptName.toLowerCase() || d.code.toLowerCase() === deptName.toLowerCase());
          if (!dept) {
            dept = { id: genId('dept'), code: deptCodeFromName(deptName, deptRows), name: deptName, spoc: 'TBD', risk: 'Medium', freq: 2, lastAudit: '—' };
            deptRows = [...deptRows, dept];
          }
          const email = joinEmailList(row.EmailID || row.Email || row.email || row['Email Id'] || row['Email ID'] || '');
          const obj = {
            id: 'em_' + dept.code, spocName: String(row.SPOCName || row['SPOC Name'] || '').trim(), email,
            deptCode: dept.code, department: dept.name,
            reportingName: String(row.ReportingToName || row['Reporting To Name'] || row['Reporting To (Name)'] || '').trim(),
            reportingEmail: joinEmailList(row.ReportingToEmail || row['Reporting To Email'] || row['Reporting To (Email)'] || ''),
            hodEmail: joinEmailList(row.HODBUHEmail || row['HOD/BUH Email'] || row['HOD/BUH Mail'] || ''),
            managementEmail: joinEmailList(row.ManagementEmail || row['Management Email'] || ''),
            status: String(row.Status || 'Active').toLowerCase() === 'inactive' ? 'inactive' : 'active',
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          };
          const idx = rows.findIndex(r => r.deptCode === dept.code);
          if (idx >= 0) { obj.id = rows[idx].id; obj.createdAt = rows[idx].createdAt || obj.createdAt; rows[idx] = { ...rows[idx], ...obj }; updated++; }
          else { rows.unshift(obj); imported++; }
        });
        writeSyncKey('ap_depts', deptRows, currentUser?.loginId);
        writeSyncKey('ap_email_master', rows, currentUser?.loginId);
        showToast(`Imported ${imported} email records, updated ${updated}`, 5000);
      } catch (err) {
        showToast('Import failed: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    evt.target.value = '';
  };

  // ── CC Manager ──
  const addCcEmail = () => {
    const email = ccInput.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Enter a valid email address'); return; }
    if (ccList.some(e => e.toLowerCase() === email)) { showToast('Email already in CC list'); return; }
    writeSyncKey('ap_required_cc_emails', [...ccList, email], currentUser?.loginId);
    setCcInput('');
    showToast(email + ' added to CC');
  };
  const removeCcEmail = (idx) => {
    const removed = ccList[idx];
    writeSyncKey('ap_required_cc_emails', ccList.filter((_, i) => i !== idx), currentUser?.loginId);
    showToast('Removed ' + (removed || 'email') + ' from CC');
  };
  const checkSmtp = async () => {
    setCheckingSmtp(true);
    try {
      const r = await apiFetch('/api/email/verify', {});
      showToast(r.smtp ? 'SMTP connection OK' : 'SMTP not verified');
    } catch (err) {
      showToast('SMTP check failed: ' + err.message);
    }
    setCheckingSmtp(false);
  };

  // ── Email Templates ──
  const saveEmailTemplate = () => {
    if (!tplDraft) return;
    const rows = templates.map(t => t.id === tplDraft.id ? { ...t, name: tplDraft.name, subject: tplDraft.subject, body: tplDraft.body, active: tplDraft.active, updatedAt: new Date().toISOString() } : t);
    writeSyncKey('ap_email_templates', rows, currentUser?.loginId);
    showToast('Template saved');
  };
  const sendTestTemplate = async () => {
    if (!testEmail.trim()) { showToast('Enter a recipient email'); return; }
    if (!tplDraft) return;
    setSendingTest(true);
    const sampleRows = [{ ref: 'NC-001', auditRef: 'AUD-001', clause: 'AS9100D §8.5.2', due: new Date().toISOString().slice(0, 10), status: 'open', sev: 'major' }];
    const vars = {
      department_name: 'Sample Department', spoc_name: 'Sample SPOC', audit_name: 'Sample Audit',
      nc_count: sampleRows.length, nc_number: sampleRows[0].ref, target_date: sampleRows[0].due, delay_days: 3,
      clause_name: sampleRows[0].clause, clause_description: clauseDescription(sampleRows[0].clause), window_days: 2, escalation_level: '1',
    };
    const subject = replaceTemplate(tplDraft.subject, vars);
    const html = replaceTemplate(tplDraft.body, vars);
    try {
      await apiFetch('/api/email', { method: 'POST', body: JSON.stringify({ to: [testEmail.trim()], subject, html, text: html.replace(/<[^>]+>/g, ' ') }) });
      await apiFetch('/api/email/log', { method: 'POST', body: JSON.stringify({ log: { type: 'test', to: testEmail.trim(), cc: '', subject, status: 'sent', sentAt: new Date().toISOString() } }) });
      showToast('Test email sent to ' + testEmail.trim());
    } catch (err) {
      showToast('Send failed: ' + err.message);
    }
    setSendingTest(false);
  };

  // ── Email Logs ──
  const clearEmailLogs = () => {
    writeSyncKey('ap_email_logs', [], currentUser?.loginId);
    showToast('Email logs cleared');
  };

  return (
    <div className="space-y-3">
      <Tabs
        tabs={[
          { id: 'depts', label: 'Departments' },
          { id: 'cps', label: 'Internal Checkpoints' },
          { id: 'rootcauses', label: 'Root Causes' },
          { id: 'auds', label: 'Auditors' },
          { id: 'emailmaster', label: 'Email Master' },
          { id: 'emailtemplates', label: 'Email Templates' },
          { id: 'emaillogs', label: 'Email Logs' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'depts' && (
        <Card>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold" style={{ color: 'var(--text3)' }}>Departments ({depts.length})</span>
            {canEdit && <button className="btn btn-brand btn-sm" onClick={() => setEditItem({ name: '', code: '', spoc: '', risk: 'Medium', freq: 4 })}><Icon name="plus" /> Add</button>}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>SPOC</th><th>Risk</th><th>Freq</th><th>Last Audit</th>{canEdit && <th>Actions</th>}</tr></thead>
              <tbody>
                {depts.map(d => (
                  <tr key={d.id}>
                    <td className="font-bold">{d.code}</td><td>{d.name}</td><td>{d.spoc || '—'}</td>
                    <td><Badge type={d.risk === 'High' ? 'b-red' : d.risk === 'Low' ? 'b-green' : 'b-amber'}>{d.risk || 'Medium'}</Badge></td>
                    <td>{d.freq || 4}/yr</td><td>{d.lastAudit || '—'}</td>
                    {canEdit && <td><div className="flex gap-1">
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(d)}><Icon name="pencil" /></button>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => setConfirmDelete({ type: 'depts', id: d.id })}><Icon name="trash-2" /></button>
                    </div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'cps' && (
        <Card>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold" style={{ color: 'var(--text3)' }}>Checkpoints ({cps.length})</span>
            {canEdit && <button className="btn btn-brand btn-sm" onClick={() => setEditItem({ text: '', clause: '', weight: 3, type: 'Yes/No', dept: '', tip: '', aiSuggestion: '' })}><Icon name="plus" /> Add</button>}
          </div>
          {!canEdit && <div className="info-box mb-2"><Icon name="lock" /> Only Master Admin can add/edit/delete checkpoints.</div>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Question</th><th>Clause</th><th>Dept</th><th>Risk</th>{canEdit && <th>Actions</th>}</tr></thead>
              <tbody>
                {pagedCps.map(cp => (
                  <tr key={cp.id}>
                    <td className="max-w-[260px]" style={{ fontSize: 12 }}>{cp.text}</td>
                    <td><Badge type="b-blue">{cp.clause || '—'}</Badge></td>
                    <td>{cp.dept || 'All'}</td>
                    <td style={{ color: cp.weight >= 5 ? 'var(--red)' : cp.weight >= 4 ? 'var(--amber)' : 'var(--teal)', fontWeight: 800 }}>{cp.weight || 3}/5</td>
                    {canEdit && <td><div className="flex gap-1">
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(cp)}><Icon name="pencil" /></button>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => setConfirmDelete({ type: 'cps', id: cp.id })}><Icon name="trash-2" /></button>
                    </div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={cps.length} page={cpSafePage} pageSize={CP_PAGE_SIZE} onChange={setCpPage} />
          <div className="text-[11px] mt-1" style={{ color: 'var(--text3)' }}>{cps.length} checkpoint(s)</div>
        </Card>
      )}

      {tab === 'rootcauses' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold" style={{ color: 'var(--text3)' }}>Root Cause Library ({rootCauses.length})</span>
              {canEdit && <button className="btn btn-brand btn-sm" onClick={() => setRcEdit(null)}><Icon name="plus" /> Add</button>}
            </div>
            {!canEdit && <div className="info-box mb-2">Only Master Admin can add/edit/delete root cause names.</div>}
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
                <tbody>
                  {rootCauses.length === 0 ? (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text3)', padding: 12 }}>No root causes configured</td></tr>
                  ) : rootCauses.map(r => (
                    <tr key={r.id}>
                      <td className="font-bold">{r.name}</td>
                      <td><Badge type={r.status === 'active' ? 'b-green' : 'b-gray'}>{r.status === 'active' ? 'Active' : 'Inactive'}</Badge></td>
                      {canEdit && <td><div className="flex gap-1">
                        <button className={`btn btn-sm ${rcEdit?.id === r.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setRcEdit(r)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteRootCause(r.id)}>Delete</button>
                      </div></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[11px] mt-2" style={{ color: 'var(--text3)' }}>Deleting does not rewrite old findings; historical root cause text remains preserved.</div>
          </Card>
          <Card title={rcEdit?.id ? 'Edit Root Cause' : 'Add Root Cause'}>
            {canEdit ? (
              <div className="space-y-2">
                <div><label className="form-label">Root Cause Name</label><input value={rcEdit?.name || ''} onChange={e => setRcEdit(p => ({ ...(p || {}), name: e.target.value }))} placeholder="Example: Method (SOP)" /></div>
                <div><label className="form-label">Status</label>
                  <select value={rcEdit?.status || 'active'} onChange={e => setRcEdit(p => ({ ...(p || {}), status: e.target.value }))}>
                    <option value="active">Active</option><option value="inactive">Inactive</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-brand flex-1" onClick={saveRootCause}>Save Root Cause</button>
                  <button className="btn btn-ghost" onClick={() => setRcEdit(null)}>Clear</button>
                </div>
              </div>
            ) : <div className="text-xs" style={{ color: 'var(--text3)' }}>Root causes are managed by Master Admin.</div>}
          </Card>
        </div>
      )}

      {tab === 'auds' && (
        <Card>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold" style={{ color: 'var(--text3)' }}>Auditors ({auditors.length})</span>
            {canEdit && <button className="btn btn-brand btn-sm" onClick={() => setEditItem({ name: '', empId: '', cert: '', spec: '', email: '', status: 'active' })}><Icon name="plus" /> Add</button>}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Emp ID</th><th>Cert</th><th>Spec</th><th>YTD</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
              <tbody>
                {auditors.map(a => (
                  <tr key={a.id}>
                    <td className="font-bold">{a.name}</td><td>{a.empId || '—'}</td><td>{a.cert}</td><td>{a.spec}</td><td>{a.auditsYTD || 0}</td>
                    <td><Badge type={a.status === 'active' ? 'b-green' : 'b-gray'}>{a.status === 'active' ? 'Active' : 'Inactive'}</Badge></td>
                    {canEdit && <td><div className="flex gap-1">
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(a)}><Icon name="pencil" /></button>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => setConfirmDelete({ type: 'auds', id: a.id })}><Icon name="trash-2" /></button>
                    </div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'emailmaster' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold" style={{ color: 'var(--text3)' }}>Email Master ({filteredEmailMaster.length})</span>
              {canEdit && <div className="flex gap-2">
                <button className="btn btn-ghost btn-sm" onClick={downloadEmailSample}>Template</button>
                <button className="btn btn-primary btn-sm" onClick={() => document.getElementById('em-import-file').click()}>Import</button>
                <input type="file" id="em-import-file" accept=".csv,.xlsx" className="hidden" onChange={importEmailMaster} />
              </div>}
            </div>
            <input className="mb-2" placeholder="Search SPOC, department or email..." value={emSearch} onChange={e => setEmSearch(e.target.value)} />
            <div className="table-wrap">
              <table>
                <thead><tr><th>SPOC</th><th>Dept</th><th>Manager</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
                <tbody>
                  {filteredEmailMaster.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text3)', padding: 12 }}>No email records</td></tr>
                  ) : filteredEmailMaster.map(r => (
                    <tr key={r.id}>
                      <td><div className="font-bold">{r.spocName}</div><div className="text-[10px]" style={{ color: 'var(--text3)' }}>{r.email}</div></td>
                      <td>{r.department || r.deptCode}</td>
                      <td><div>{r.reportingName}</div><div className="text-[10px]" style={{ color: 'var(--text3)' }}>{r.reportingEmail}</div></td>
                      <td><Badge type={String(r.status || 'active').toLowerCase() === 'active' ? 'b-green' : 'b-gray'}>{String(r.status || 'active').toLowerCase() === 'active' ? 'Active' : 'Inactive'}</Badge></td>
                      {canEdit && <td><div className="flex gap-1">
                        <button className={`btn btn-sm ${String(r.status || 'active').toLowerCase() === 'active' ? 'btn-amber' : 'btn-brand'}`} onClick={() => toggleEmailMasterStatus(r)}>{String(r.status || 'active').toLowerCase() === 'active' ? 'Deactivate' : 'Activate'}</button>
                        <button className={`btn btn-sm ${emEdit?.id === r.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setEmEdit(r)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteEmailMaster(r.id)}>Delete</button>
                      </div></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="space-y-3">
            <Card title={emEdit?.id ? 'Edit Email Record' : 'Add Email Record'}>
              {canEdit ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="form-label">SPOC Name</label><input value={emEdit?.spocName || ''} onChange={e => setEmEdit(p => ({ ...(p || {}), spocName: e.target.value }))} /></div>
                    <div><label className="form-label">Email ID</label><input value={emEdit?.email || ''} onChange={e => setEmEdit(p => ({ ...(p || {}), email: e.target.value }))} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="form-label">Department</label>
                      <select value={emEdit?.deptCode || ''} onChange={e => setEmEdit(p => ({ ...(p || {}), deptCode: e.target.value }))}>
                        <option value="">Select...</option>
                        {depts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}
                      </select>
                    </div>
                    <div><label className="form-label">Status</label>
                      <select value={emEdit?.status || 'active'} onChange={e => setEmEdit(p => ({ ...(p || {}), status: e.target.value }))}>
                        <option value="active">Active</option><option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="form-label">Reporting To Name</label><input value={emEdit?.reportingName || ''} onChange={e => setEmEdit(p => ({ ...(p || {}), reportingName: e.target.value }))} /></div>
                    <div><label className="form-label">Reporting To Email</label><input value={emEdit?.reportingEmail || ''} onChange={e => setEmEdit(p => ({ ...(p || {}), reportingEmail: e.target.value }))} /></div>
                  </div>
                  <div><label className="form-label">HOD/BUH Email</label><input value={emEdit?.hodEmail || ''} onChange={e => setEmEdit(p => ({ ...(p || {}), hodEmail: e.target.value }))} /></div>
                  <div><label className="form-label">Management Email</label><input value={emEdit?.managementEmail || ''} onChange={e => setEmEdit(p => ({ ...(p || {}), managementEmail: e.target.value }))} /></div>
                  <div className="flex gap-2">
                    <button className="btn btn-brand flex-1" onClick={saveEmailMaster}>Save Email Record</button>
                    <button className="btn btn-ghost" onClick={() => setEmEdit(null)}>Clear</button>
                  </div>
                </div>
              ) : <div className="text-xs" style={{ color: 'var(--text3)' }}>Managed by Master Admin.</div>}
            </Card>
            <Card title="Global CC Recipients (All Emails)">
              <div className="text-[11px] mb-2" style={{ color: 'var(--text3)' }}>These emails are automatically added to CC on every outgoing email.</div>
              <div className="flex flex-wrap gap-1 mb-2">
                {ccList.map((email, i) => (
                  <span key={i} className="badge b-blue flex items-center gap-1">
                    {email}
                    <button onClick={() => removeCcEmail(i)} title="Remove" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}><Icon name="x" className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input placeholder="Add new CC email..." value={ccInput} onChange={e => setCcInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCcEmail()} />
                <button className="btn btn-primary btn-sm" onClick={addCcEmail}>+ Add</button>
                <button className="btn btn-ghost btn-sm" onClick={checkSmtp} disabled={checkingSmtp}>{checkingSmtp ? 'Checking…' : 'Check SMTP'}</button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'emailtemplates' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card title="Email Templates">
            <div className="space-y-2">
              {templates.length === 0 ? <div className="text-xs" style={{ color: 'var(--text3)' }}>No templates configured.</div> : templates.map(t => (
                <div key={t.id} className={`finding-card ${activeTpl?.id === t.id ? 'minor' : ''}`} onClick={() => setTplId(t.id)}>
                  <div className="flex justify-between items-center"><span className="font-bold text-xs">{t.name}</span><Badge type={t.active !== false ? 'b-green' : 'b-gray'}>{t.active !== false ? 'Active' : 'Disabled'}</Badge></div>
                  <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>{t.type}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Edit Template">
            {tplDraft ? (
              <div className="space-y-2">
                <div><label className="form-label">Template Name</label><input value={tplDraft.name} onChange={e => setTplDraft(p => ({ ...p, name: e.target.value }))} /></div>
                <div><label className="form-label">Subject</label><input value={tplDraft.subject} onChange={e => setTplDraft(p => ({ ...p, subject: e.target.value }))} /></div>
                <div><label className="form-label">Body HTML</label><textarea style={{ height: 160, resize: 'vertical' }} value={tplDraft.body} onChange={e => setTplDraft(p => ({ ...p, body: e.target.value }))} /></div>
                <label className="flex items-center gap-2 text-xs" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={tplDraft.active} onChange={e => setTplDraft(p => ({ ...p, active: e.target.checked }))} /> Active
                </label>
                <div className="text-[10px]" style={{ color: 'var(--text3)' }}>Variables: {'{{department_name}}, {{audit_name}}, {{nc_number}}, {{target_date}}, {{delay_days}}, {{spoc_name}}, {{clause_name}}, {{clause_description}}, {{window_days}}, {{escalation_level}}'}</div>
                {canEdit && (
                  <>
                    <button className="btn btn-brand w-full" onClick={saveEmailTemplate}>Save Template</button>
                    <div className="flex gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                      <input placeholder="Send test to email..." value={testEmail} onChange={e => setTestEmail(e.target.value)} />
                      <button className="btn btn-ghost btn-sm" onClick={sendTestTemplate} disabled={sendingTest}>{sendingTest ? 'Sending…' : 'Send Test'}</button>
                    </div>
                  </>
                )}
              </div>
            ) : <div className="text-xs" style={{ color: 'var(--text3)' }}>No template selected.</div>}
          </Card>
        </div>
      )}

      {tab === 'emaillogs' && (
        <Card>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold" style={{ color: 'var(--text3)' }}>Email Logs ({emailLogs.length})</span>
            <button className="btn btn-ghost btn-sm" onClick={clearEmailLogs}>Clear Logs</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Type</th><th>To</th><th>Subject</th><th>Status</th><th>Sent</th></tr></thead>
              <tbody>
                {emailLogs.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text3)', padding: 12 }}>No email logs yet</td></tr>
                ) : emailLogs.map((l, i) => (
                  <tr key={i}>
                    <td>{l.type}</td><td>{l.to}</td><td className="max-w-[240px] truncate">{l.subject}</td>
                    <td><Badge type={l.status === 'sent' ? 'b-green' : 'b-red'}>{l.status}</Badge></td>
                    <td>{l.sentAt ? new Date(l.sentAt).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Add/Edit modal for depts/auds/cps */}
      {editItem && (
        <div className="modal-bg" onClick={() => setEditItem(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{editItem.id ? 'Edit Entry' : 'Add Entry'}</span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditItem(null)}><Icon name="x" /></button>
            </div>
            {tab === 'depts' && (
              <>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div><label className="form-label">Department Name</label><input value={editItem.name} onChange={e => setEditItem(p => ({ ...p, name: e.target.value }))} /></div>
                  <div><label className="form-label">Code</label><input value={editItem.code} onChange={e => setEditItem(p => ({ ...p, code: e.target.value }))} /></div>
                </div>
                <div className="mb-2"><label className="form-label">SPOC</label><input value={editItem.spoc || ''} onChange={e => setEditItem(p => ({ ...p, spoc: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div><label className="form-label">Risk Level</label>
                    <select value={editItem.risk || 'Medium'} onChange={e => setEditItem(p => ({ ...p, risk: e.target.value }))}>
                      <option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option>
                    </select>
                  </div>
                  <div><label className="form-label">Audit Frequency (per year)</label><input type="number" min={1} max={12} value={editItem.freq || 4} onChange={e => setEditItem(p => ({ ...p, freq: Number(e.target.value) || 1 }))} /></div>
                </div>
              </>
            )}
            {tab === 'auds' && (
              <>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div><label className="form-label">Auditor Name</label><input value={editItem.name} onChange={e => setEditItem(p => ({ ...p, name: e.target.value }))} /></div>
                  <div><label className="form-label">Emp ID</label><input value={editItem.empId || ''} onChange={e => setEditItem(p => ({ ...p, empId: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div><label className="form-label">Certification</label><input value={editItem.cert || ''} onChange={e => setEditItem(p => ({ ...p, cert: e.target.value }))} /></div>
                  <div><label className="form-label">Specialization</label><input value={editItem.spec || ''} onChange={e => setEditItem(p => ({ ...p, spec: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div><label className="form-label">Email</label><input value={editItem.email || ''} onChange={e => setEditItem(p => ({ ...p, email: e.target.value }))} /></div>
                  <div><label className="form-label">Status</label>
                    <select value={editItem.status || 'active'} onChange={e => setEditItem(p => ({ ...p, status: e.target.value }))}>
                      <option value="active">Active</option><option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>
              </>
            )}
            {tab === 'cps' && (
              <>
                <div className="mb-2"><label className="form-label">Checkpoint Text</label><textarea value={editItem.text} onChange={e => setEditItem(p => ({ ...p, text: e.target.value }))} style={{ height: 60, resize: 'none' }} /></div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div><label className="form-label">Clause</label><input value={editItem.clause || ''} onChange={e => setEditItem(p => ({ ...p, clause: e.target.value }))} /></div>
                  <div><label className="form-label">Risk Weight (1-5)</label><input type="number" min={1} max={5} value={editItem.weight || 3} onChange={e => setEditItem(p => ({ ...p, weight: Number(e.target.value) || 3 }))} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div><label className="form-label">Type</label>
                    <select value={editItem.type || 'Yes/No'} onChange={e => setEditItem(p => ({ ...p, type: e.target.value }))}>
                      <option value="Yes/No">Yes/No</option><option value="Text">Text</option>
                    </select>
                  </div>
                  <div><label className="form-label">Department Code (Leave empty for All)</label><input value={editItem.dept || ''} onChange={e => setEditItem(p => ({ ...p, dept: e.target.value }))} /></div>
                </div>
                <div className="mb-2"><label className="form-label">QMS Checklist Tip</label><input value={editItem.tip || ''} onChange={e => setEditItem(p => ({ ...p, tip: e.target.value }))} /></div>
                <div className="mb-3"><label className="form-label">AI Suggestion (optional)</label><input value={editItem.aiSuggestion || ''} onChange={e => setEditItem(p => ({ ...p, aiSuggestion: e.target.value }))} /></div>
              </>
            )}
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setEditItem(null)}>Cancel</button>
              <button className="btn btn-primary flex-1" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmDelete}
        message="Delete this record? This cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
