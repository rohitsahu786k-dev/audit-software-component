import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Icon, ConfirmModal } from '../components/UI';
import { genId, showToast, today, SEV_LABEL, STAT_LABEL } from '../utils/helpers';
import { normalizeAuditSeverity } from '../utils/dashboardHelpers';

const TYPE_HINTS = {
  findings: { cols: 'ID, Department, Description, Severity, Clause, DueDate, Status', note: 'Imports old NCs into the Findings Register, CAPA Tracker & Master Tracker.' },
  learnings: { cols: 'Title, Department, Severity, Clause, Root Cause, Preventive Action', note: 'Imports lessons learned into the Learnings Repository for auditor reference.' },
  checkpoints: { cols: 'Question, Clause, Weight (1–5), Type, Department, Tip', note: 'Imported checkpoints automatically appear as an "OnePWS Internal Checkpoints" section in every new audit for the matching department.' },
};

const TEMPLATE_ROWS = {
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
  const { getFindings, getLearnings, getCheckpoints, getDepts, getImportLogs, writeSyncKey, addNotification, currentUser, setPageAction } = useApp();
  const [importType, setImportType] = useState('findings');
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

  const processRows = (rows, fname) => {
    const depts = getDepts();
    const now = new Date();
    const nowIso = now.toISOString();
    const nowText = now.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    let imported = 0, errors = 0;
    const lines = [];
    const importedIds = [];

    if (importType === 'findings') {
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
    reader.onload = (e) => {
      try {
        const wb = window.XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(ws, { defval: '' });
        processRows(rows, file.name);
      } catch (err) {
        showToast(err.message, 5000);
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
    const ws = window.XLSX.utils.json_to_sheet(data);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Template');
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
    if (l.importedIds && l.importedIds.length) {
      if (l.type === 'checkpoints') {
        writeSyncKey('ap_cps', getCheckpoints().filter(cp => !l.importedIds.includes(cp.id)));
      } else if (l.type === 'findings') {
        writeSyncKey('ap_finds', getFindings().filter(f => !l.importedIds.includes(f.id)));
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
    const impFindings = getFindings().filter(f => f.type === 'imported');
    if (impFindings.length) {
      const ws = window.XLSX.utils.json_to_sheet(impFindings.map(f => ({ ID: f.ref, Dept: f.deptName, Description: f.desc, Severity: SEV_LABEL[f.sev], Clause: f.clause, Status: STAT_LABEL[f.status] })));
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
        message="Delete this import log and remove its records from the app? (Completed audit reports will not be affected)"
        onConfirm={() => deleteLog(confirmDeleteIdx)}
        onCancel={() => setConfirmDeleteIdx(null)}
      />
    </div>
  );
}
