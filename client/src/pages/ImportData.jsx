import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Icon, ConfirmModal } from '../components/UI';
import { genId, showToast, today, SEV_LABEL, STAT_LABEL } from '../utils/helpers';
import { normalizeAuditSeverity } from '../utils/dashboardHelpers';
import { buildExternalAuditImport, EXTERNAL_AUDIT_HEADERS, EXTERNAL_AUDIT_REQUIRED_HEADERS, EXTERNAL_AUDIT_SAMPLE } from '../utils/externalAudit';

const TYPE_HINTS = {
  external: { cols: EXTERNAL_AUDIT_REQUIRED_HEADERS.join(' > '), note: `Required template structure: ${EXTERNAL_AUDIT_REQUIRED_HEADERS.join(' > ')}. Optional columns: Responsible Owner, Responsible Owner Email, External Audit Name, External Audit Reference, Clause. Imports external audit findings into Findings, CAPA, automated email reminders, dashboards, analytics and reports.` },
  findings: { cols: 'ID, Department, Description, Severity, Clause, DueDate, Status', note: 'Imports old NCs into the Findings Register, CAPA Tracker & Master Tracker.' },
  learnings: { cols: 'Title, Department, Severity, Clause, Root Cause, Preventive Action', note: 'Imports lessons learned into the Learnings Repository for auditor reference.' },
  checkpoints: { cols: 'Question, Clause, Weight (1–5), Type, Department, Tip', note: 'Imported checkpoints automatically appear as an "OnePWS Internal Checkpoints" section in every new audit for the matching department.' },
};

const TEMPLATE_ROWS = {
  external: null, // exported as a blank sheet with headings only
  findings: [{ ID: 'STR-2025-001', Department: 'Stores', Description: 'Example finding', Severity: 'major', Clause: '§8.5.2', DueDate: '2025-07-15', Status: 'open' }],
  learnings: [{ Title: 'Example Learning', Department: 'Quality', Severity: 'major', Clause: '§10.2', 'Root Cause': 'Process gap', 'Preventive Action': 'Update SOP' }],
  checkpoints: [{ Question: 'Is process documented?', Clause: '§7.5', Weight: 3, Type: 'Yes/No', Department: 'Production', Tip: 'Check WIs' }],
};

function importDateInputValue(value) {
  if (value === null || value === undefined || value === '') return today();
  if (typeof value === 'number') {
    const excelDate = new Date((value - 25569) * 86400000);
    if (!isNaN(excelDate)) return excelDate.toISOString().slice(0, 10);
    return today();
  }
  const d = new Date(value);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return String(value).trim();
}

function matchDept(depts, dn) {
  const name = String(dn || '').trim();
  if (!name) return null;
  const nl = name.toLowerCase();
  return depts.find(d => (d.name || '').toLowerCase().includes(nl) || (d.name || '').toLowerCase() === nl || (d.code || '').toLowerCase() === nl) || null;
}

export default function ImportData() {
  const { getFindings, getLearnings, getCheckpoints, getDepts, getUsers, getEmailMaster, getCompletedAudits, getImportLogs, writeSyncKey, writeSyncBulk, addNotification, currentUser, setPageAction } = useApp();
  const [importType, setImportType] = useState('external');
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [log, setLog] = useState(null); // { imported, errors, lines: [] }
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setPageAction(() => () => fileInputRef.current?.click());
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logs = getImportLogs();
  const totalImported = logs.reduce((s, l) => s + (l.count || 0), 0);
  const totalErrors = logs.reduce((s, l) => s + (l.errors || 0), 0);
  const lastImport = logs.length ? logs[logs.length - 1].ts : 'Never';

  const processRows = async (rows, fname) => {
    const depts = getDepts();
    const now = new Date();
    const nowIso = now.toISOString();
    const nowText = now.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    let imported = 0, errors = 0;
    const lines = [];
    const importedIds = [];

    let importedAuditIds = [];
    if (importType === 'external') {
      const result = buildExternalAuditImport(rows, {
        depts, users: getUsers(), emailMaster: getEmailMaster(), findings: getFindings(), completed: getCompletedAudits(),
        fileName: fname, currentUser,
      });
      lines.push(...result.errors, ...result.warnings);
      errors = result.errors.length;
      if (!result.ok) {
        setLog({ imported: 0, errors, lines });
        showToast(`Import cancelled: fix ${errors} invalid row(s) and upload again`, 6000);
        setProcessing(false);
        return;
      }
      if (!result.findings.length) {
        setLog({ imported: 0, errors: 0, lines });
        showToast('Nothing imported - every row is already in the portal', 5000);
        setProcessing(false);
        return;
      }
      imported = result.findings.length;
      importedIds.push(...result.findings.map(f => f.id));
      importedAuditIds = result.audits.map(a => a.id);
      const okLines = result.findings.map(f => ({ rn: f.importRow, kind: 'ok', msg: `${f.ref} imported for ${f.deptName}` }));
      const allLines = [...okLines, ...lines];
      const logEntry = { ts: nowText, createdAt: nowIso, fname, type: importType, count: imported, errors, details: allLines, importedIds, importedAuditIds };
      try {
        await writeSyncBulk({
          ap_finds: [...getFindings(), ...result.findings],
          ap_completed_audits: [...getCompletedAudits(), ...result.audits],
          ap_import_logs: [...getImportLogs(), logEntry],
        }, currentUser?.loginId);
      } catch (err) {
        setLog({ imported: 0, errors: 1, lines: [{ rn: 0, kind: 'error', msg: `Save failed, nothing was imported: ${err.message}` }] });
        showToast(`Import failed: ${err.message}`, 6000);
        setProcessing(false);
        return;
      }
      setLog({ imported, errors, lines: allLines });
      addNotification('audit', 'External Audit Imported', `${imported} finding(s) from ${fname} are now active in CAPA and reporting.`, 'capa', ['admin', 'auditor', 'spoc', 'manager']);
      showToast(`${imported} external finding(s) imported; ${result.warnings.filter(w => /Duplicate/.test(w.msg)).length} duplicate(s) skipped`, 5000);
      setProcessing(false);
      return;
    } else if (importType === 'findings') {
      const findings = getFindings().slice();
      rows.forEach((row, i) => {
        const rn = i + 2;
        const desc = row.Description || row.description || row.Finding || '';
        if (!desc) { errors++; lines.push({ rn, kind: 'error', msg: 'No description — skipped' }); return; }
        const ref = row.ID || row.id || `IMP-${Date.now()}-${i}`;
        if (findings.find(f => f.ref === ref)) { lines.push({ rn, kind: 'warn', msg: `${ref} exists — skipped` }); return; }
        const dept = matchDept(depts, row.Department || row.dept) || { name: row.Department || row.dept || 'Unknown', code: 'UNK' };
        const sev = normalizeAuditSeverity(row.Severity || row.severity || 'minor');
        const nf = {
          id: genId('imp'), ref, dept: dept.code, deptName: dept.name, desc,
          sev, clause: String(row.Clause || row.clause || '§—'),
          due: importDateInputValue(row.DueDate || row.due_date || row.Due),
          status: 'open', capaStatus: 'open', type: 'imported',
          createdAt: nowIso, updatedAt: nowIso,
          activityLog: [{ user: currentUser?.name, action: `Imported from ${fname}`, ts: nowText }],
          closureEvidence: '', closureFiles: [], closureSubmittedBy: null, closureDate: null,
          decision: null, decisionComments: '', decisionDate: null,
        };
        findings.push(nf);
        importedIds.push(nf.id);
        imported++;
        lines.push({ rn, kind: 'ok', msg: 'Imported' });
      });
      writeSyncKey('ap_finds', findings);
    } else if (importType === 'learnings') {
      const learnings = getLearnings().slice();
      rows.forEach((row, i) => {
        const rn = i + 2;
        const title = row.Title || row.title || '';
        if (!title) { errors++; lines.push({ rn, kind: 'error', msg: 'No title — skipped' }); return; }
        const dn = row.Department || row.dept || '';
        const dept = matchDept(depts, dn);
        const nl = {
          id: genId('limp'), title,
          dept: dept ? dept.code : dn,
          sev: normalizeAuditSeverity(row.Severity || row.severity || 'minor'),
          clause: row.Clause || row.clause || '',
          rc: row['Root Cause'] || row.root_cause || '',
          pa: row['Preventive Action'] || row.preventive_action || '',
          repeat: false, crossDept: false,
        };
        learnings.unshift(nl);
        importedIds.push(nl.id);
        imported++;
        lines.push({ rn, kind: 'ok', msg: 'Imported' });
      });
      writeSyncKey('ap_learns', learnings);
    } else {
      const checkpoints = getCheckpoints().slice();
      rows.forEach((row, i) => {
        const rn = i + 2;
        const text = row.Question || row.text || row.Checkpoint || '';
        if (!text) { errors++; lines.push({ rn, kind: 'error', msg: 'No question — skipped' }); return; }
        const dn = row.Department || row.dept || '';
        const dept = matchDept(depts, dn);
        if (dn && !dept) lines.push({ rn, kind: 'warn', msg: `Dept "${dn}" not found — stored as-is. Check spelling.` });
        const nc = {
          id: genId('cpimp'), text,
          clause: row.Clause || row.clause || '',
          weight: parseInt(row.Weight || row.weight || 3, 10) || 3,
          type: row.Type || row.type || 'Yes/No',
          dept: dept ? dept.code : (dn ? dn.trim() : 'All'),
          tip: row.Tip || row.tip || '',
          aiSuggestion: '',
        };
        checkpoints.push(nc);
        importedIds.push(nc.id);
        imported++;
        lines.push({ rn, kind: 'ok', msg: 'Imported' });
      });
      writeSyncKey('ap_cps', checkpoints);
    }

    const logEntry = { ts: nowText, fname, type: importType, count: imported, errors, details: lines, importedIds };
    const allLogs = [...getImportLogs(), logEntry];
    writeSyncKey('ap_import_logs', allLogs);
    setLog({ imported, errors, lines });

    const cpNote = importType === 'checkpoints' ? ' These will appear as "OnePWS Internal Checkpoints" in new audits.' : '';
    addNotification('audit', 'Import Complete', `${imported} ${importType} record(s) imported from ${fname}${cpNote}`, 'mastertracker', ['admin', 'auditor']);
    showToast(`${imported} ${importType} imported, ${errors} error(s)`);
    setProcessing(false);
  };

  const processFile = (file) => {
    if (!window.XLSX) { showToast('Excel library loading, retry in 2s.'); return; }
    setProcessing(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const wb = window.XLSX.read(e.target.result, { type: 'array', cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(ws, { defval: '' });
        await processRows(rows, file.name);
      } catch (err) {
        showToast(err.message || 'Import failed', 5000);
        setProcessing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  };

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
    e.target.value = '';
  };

  const downloadTemplate = () => {
    if (!window.XLSX) { showToast('Excel loading...'); return; }
    const data = TEMPLATE_ROWS[importType];
    const fname = `OnePWS_${importType[0].toUpperCase()}${importType.slice(1)}_Template.xlsx`;
    const ws = importType === 'external'
      ? window.XLSX.utils.aoa_to_sheet([EXTERNAL_AUDIT_HEADERS])
      : window.XLSX.utils.json_to_sheet(data);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, importType === 'external' ? 'External Audit Findings' : 'Template');
    if (importType === 'external') {
      ws['!cols'] = EXTERNAL_AUDIT_HEADERS.map(header => ({ wch: Math.max(16, Math.min(40, header.length + 6)) }));
      const sample = EXTERNAL_AUDIT_SAMPLE[0];
      const guide = window.XLSX.utils.aoa_to_sheet([
        ['External Audit Import Instructions'],
        [],
        ['1', 'Fill the first sheet (External Audit Findings) from row 2. Do not rename, reorder or delete the column headings.'],
        ['2', `Required columns: ${EXTERNAL_AUDIT_REQUIRED_HEADERS.join(', ')}.`],
        ['3', 'Optional columns: Responsible Owner, Responsible Owner Email, External Audit Name, External Audit Reference, Clause. If the owner is blank the department SPOC is assigned.'],
        ['4', 'Department must match a Department Master name or code (see the list below).'],
        ['5', 'Dates: DD/MM/YYYY or YYYY-MM-DD (or real Excel dates). Target Closure Date cannot be before Date of Audit.'],
        ['6', 'NC Type: Critical, Major, Minor or Observation. Status: Open, In Progress, Delayed, Pending Closure or Closed (blank = Open).'],
        ['7', 'Use the same External Audit Reference for all rows of one audit report. If blank, one is generated from the audit date.'],
        ['8', 'If any row is invalid the whole file is rejected with row-wise errors; re-importing the same finding is skipped as a duplicate.'],
        [],
        ['Example row (do not copy into the data sheet unchanged)'],
        EXTERNAL_AUDIT_HEADERS,
        EXTERNAL_AUDIT_HEADERS.map(h => sample[h] ?? ''),
        [],
        ['Valid departments (Department Master)'],
        ...getDepts().map(d => [d.code, d.name]),
      ]);
      guide['!cols'] = [{ wch: 16 }, { wch: 110 }];
      window.XLSX.utils.book_append_sheet(wb, guide, 'Instructions');
    }
    window.XLSX.writeFile(wb, fname);
    showToast('Template downloaded!');
  };

  const downloadLog = (idx) => {
    const l = logs[idx];
    if (!l) return;
    const blob = new Blob([JSON.stringify(l, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `import_log_${l.type}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Log downloaded');
  };

  const deleteLog = (idx) => {
    const l = logs[idx];
    if (!l) return;
    // Findings and completed audits are merged server-side (records absent from a write are
    // kept), so a rollback must soft-delete (tombstone) them rather than filter them out.
    const nowIso = new Date().toISOString();
    const tombstone = (item) => ({ ...item, deletedAt: nowIso, updatedAt: nowIso });
    if (l.importedIds && l.importedIds.length) {
      if (l.type === 'checkpoints') {
        writeSyncKey('ap_cps', getCheckpoints().filter(cp => !l.importedIds.includes(cp.id)));
      } else if (l.type === 'findings') {
        writeSyncKey('ap_finds', getFindings().map(f => l.importedIds.includes(f.id) ? tombstone(f) : f));
      } else if (l.type === 'external') {
        const removedIds = new Set(l.importedIds);
        const nextFindings = getFindings().map(f => removedIds.has(f.id) ? tombstone(f) : f);
        const auditIds = new Set(l.importedAuditIds || []);
        const nextAudits = getCompletedAudits().map(a => {
          if (!auditIds.has(a.id)) return a;
          const stillLinked = nextFindings.some(f => !f.deletedAt && f.externalAudit && f.auditRef === a.auditRef && f.dept === a.dept);
          return stillLinked ? a : tombstone(a);
        });
        writeSyncBulk({
          ap_finds: nextFindings,
          ap_completed_audits: nextAudits,
          ap_import_logs: logs.filter((_, i) => i !== idx),
        }, currentUser?.loginId)
          .then(() => showToast('Import rolled back', 4000))
          .catch(err => showToast(err.message, 5000));
        setConfirmDeleteIdx(null);
        return;
      } else if (l.type === 'learnings') {
        writeSyncKey('ap_learns', getLearnings().filter(x => !l.importedIds.includes(x.id)));
      }
    }
    const newLogs = logs.filter((_, i) => i !== idx);
    writeSyncKey('ap_import_logs', newLogs);
    setConfirmDeleteIdx(null);
    showToast('Import log deleted');
  };

  const exportImported = () => {
    if (!window.XLSX) { showToast('Excel loading...'); return; }
    const wb = window.XLSX.utils.book_new();
    const impFindings = getFindings().filter(f => f.type === 'imported' || f.type === 'external-audit');
    if (impFindings.length) {
      const ws = window.XLSX.utils.json_to_sheet(impFindings.map(f => ({ ID: f.ref, Source: f.externalAudit ? 'External Audit' : 'Historical Import', 'Audit Reference': f.auditRef || '', 'Audit Date': f.auditDate || '', Dept: f.deptName, Topic: f.topic || '', Description: f.desc, Severity: SEV_LABEL[f.sev], Owner: f.responsibleOwner || '', 'Owner Email': f.ownerEmail || '', Due: f.due, Clause: f.clause, Status: STAT_LABEL[f.status] })));
      window.XLSX.utils.book_append_sheet(wb, ws, 'Imported Findings');
    }
    const impCps = getCheckpoints().filter(c => String(c.id || '').startsWith('cpimp'));
    const ws2 = window.XLSX.utils.json_to_sheet(impCps.map(c => ({ Question: c.text, Clause: c.clause, Dept: c.dept, Weight: c.weight })));
    window.XLSX.utils.book_append_sheet(wb, ws2, 'Imported Checkpoints');
    window.XLSX.writeFile(wb, 'OnePWS_Imported_Data_' + Date.now() + '.xlsx');
    showToast('Imported data exported!');
  };

  const hint = TYPE_HINTS[importType];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Card><div className="text-[11px] font-bold" style={{ color: 'var(--text3)' }}>Records Imported</div><div className="text-xl font-bold" style={{ color: 'var(--brand)' }}>{totalImported}</div></Card>
        <Card><div className="text-[11px] font-bold" style={{ color: 'var(--text3)' }}>Last Import</div><div className="text-xs font-bold mt-1">{lastImport}</div></Card>
        <Card><div className="text-[11px] font-bold" style={{ color: 'var(--text3)' }}>Errors</div><div className="text-xl font-bold" style={{ color: 'var(--red)' }}>{totalErrors}</div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card title={<span className="flex items-center gap-2"><Icon name="upload" className="w-4 h-4" /> Import Data from Excel</span>}>
          <div className="space-y-3">
            <div className="info-box text-xs" dangerouslySetInnerHTML={{ __html: `Upload Excel with columns: <strong>${hint.cols}</strong><br><span style="font-size:11px;color:var(--text3)">${hint.note}</span>` }} />
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer"
              style={{ borderColor: dragOver ? 'var(--brand)' : 'var(--border)', background: dragOver ? 'var(--bg3)' : 'transparent' }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <Icon name="file-spreadsheet" className="w-8 h-8 mx-auto mb-2 opacity-40 text-[var(--brand)]" />
              <div className="text-xs font-bold" style={{ color: 'var(--text2)' }}>{processing ? 'Processing…' : 'Click to upload or drag Excel / CSV file'}</div>
              <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>.xlsx or .csv supported</div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
            </div>
            <div>
              <label className="lbl text-[11px] font-bold block mb-1">Import Type</label>
              <select className="w-full" value={importType} onChange={(e) => setImportType(e.target.value)}>
                <option value="external">External Audit Findings (full portal integration)</option>
                <option value="findings">Findings / Historical Non-conformances</option>
                <option value="learnings">Audit Learnings</option>
                <option value="checkpoints">Custom Checkpoints (appear in new audits)</option>
              </select>
            </div>
            <button className="btn btn-ghost btn-sm w-full" onClick={downloadTemplate}><Icon name="download" /> Download Template</button>
          </div>
        </Card>

        <Card title="Current Import Log">
          <div className="text-[11px] space-y-1 max-h-[180px] overflow-y-auto">
            {!log ? (
              <span style={{ color: 'var(--text3)' }}>No imports yet.</span>
            ) : (
              log.lines.map((l, i) => (
                <div key={i} className="flex items-center gap-1" style={{ color: l.kind === 'error' ? 'var(--red)' : l.kind === 'warn' ? 'var(--amber)' : 'var(--green)' }}>
                  <Icon name={l.kind === 'ok' ? 'circle-check' : l.kind === 'warn' ? 'triangle-alert' : 'circle-x'} className="w-3 h-3 flex-shrink-0" />
                  Row {l.rn}: {l.msg}
                </div>
              ))
            )}
          </div>
          {log && (
            <div className="text-xs mt-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <strong style={{ color: 'var(--green)' }}>{log.imported} imported</strong><br />
              {log.errors} error(s).
            </div>
          )}
        </Card>

        <Card title="Import History">
          <div className="flex justify-end mb-2">
            <button className="btn btn-ghost btn-sm" onClick={exportImported}><Icon name="download" /> Export All</button>
          </div>
          <div className="space-y-1 max-h-[220px] overflow-y-auto">
            {!logs.length ? (
              <div className="text-xs" style={{ color: 'var(--text3)' }}>No import history yet.</div>
            ) : logs.slice().reverse().map((l, i) => {
              const ri = logs.length - 1 - i;
              return (
                <div key={ri} className="flex items-center justify-between py-1 border-b text-[11px]" style={{ borderColor: 'var(--bg3)' }}>
                  <div>
                    <span className="font-bold">{l.fname}</span>
                    <span style={{ color: 'var(--text3)' }}> · {l.type} · {l.count} records · {l.ts}</span>
                  </div>
                  <div className="flex gap-1">
                    <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => downloadLog(ri)}><Icon name="download" /></button>
                    {currentUser?.role === 'admin' && (
                      <button className="btn btn-danger btn-sm" style={{ padding: '2px 6px' }} onClick={() => setConfirmDeleteIdx(ri)}><Icon name="trash-2" /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <ConfirmModal
        open={confirmDeleteIdx !== null}
        message="Delete this import and its linked records? External audit reports and score contribution from this import will also be removed."
        onConfirm={() => deleteLog(confirmDeleteIdx)}
        onCancel={() => setConfirmDeleteIdx(null)}
      />
    </div>
  );
}
