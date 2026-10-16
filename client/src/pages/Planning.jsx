import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, Icon, ConfirmModal } from '../components/UI';
import { fmtDate, showToast, today, genId, SEV_BADGE } from '../utils/helpers';
import { buildChecklist, EMPTY_SESSION, STD_META } from '../utils/auditEngine';
import { downloadAdhocTemplate, parseAdhocWorkbook, ASSESSMENTS, SEVERITIES } from '../utils/adhocAudit';
import { auditFindingCounts, scoreFromFindingCounts } from '../utils/dashboardHelpers';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function Planning() {
  const {
    getPlannedAudits,
    getDepts,
    getAuditors,
    getCheckpoints,
    getCompletedAudits,
    getFindings,
    writeSyncKey,
    writeSyncBulk,
    addNotification,
    currentUser,
    navigate,
    setActiveAudit,
    setAuditSession,
  } = useApp();

  const planned = getPlannedAudits();
  const depts = getDepts();
  const auditors = getAuditors();
  const checkpoints = getCheckpoints();
  const completed = getCompletedAudits();
  const findings = getFindings();

  // Mode: 'standard' | 'typeSelect' | 'adhocDetails' | 'adhocImport'
  const [auditMode, setAuditMode] = useState('standard');

  // Standard audit form state
  const [standards, setStandards] = useState(['as9100d']);
  const [form, setForm] = useState({ dept: '', auditor: '', date: today(), type: 'Full Internal Audit' });
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [viewDate, setViewDate] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });

  // Adhoc audit form state
  const [adhocTitle, setAdhocTitle] = useState('');
  const [adhocDept, setAdhocDept] = useState('');
  const [adhocAuditor, setAdhocAuditor] = useState('');
  const [adhocStartDate, setAdhocStartDate] = useState(today());
  const [adhocEndDate, setAdhocEndDate] = useState(today());
  const [adhocDescription, setAdhocDescription] = useState('');
  const [adhocSetupError, setAdhocSetupError] = useState('');

  // Adhoc import state
  const [adhocFile, setAdhocFile] = useState(null);
  const [adhocPreview, setAdhocPreview] = useState(null);
  const [adhocUploading, setAdhocUploading] = useState(false);
  const [adhocUploadError, setAdhocUploadError] = useState('');
  const [adhocFilterAssessment, setAdhocFilterAssessment] = useState('ALL');
  const [adhocFilterDept, setAdhocFilterDept] = useState('ALL');
  const [isSubmittingAdhoc, setIsSubmittingAdhoc] = useState(false);
  const fileInputRef = useRef(null);

  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'auditor';

  const todayD = useMemo(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }, []);
  const overdue = planned.filter(a => a.date && new Date(a.date) < todayD).length;
  const next30 = planned.filter(a => { const d = new Date(a.date); return !isNaN(d) && d >= todayD && d <= new Date(todayD.getTime() + 30 * 86400000); }).length;
  const annualTarget = useMemo(() => depts.reduce((sum, d) => sum + (Number(d.freq) || 4), 0), [depts]);

  const toggleStd = (id) => {
    setStandards(prev => { let s = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]; if (!s.length) s = ['as9100d']; return s; });
  };

  // Preview checklist builder
  const previewSections = useMemo(() => {
    if (!form.dept || !standards.length) return [];
    const d = depts.find(x => x.code === form.dept || x.name === form.dept);
    const code = d?.code || form.dept;
    return buildChecklist(code, standards, depts, checkpoints);
  }, [form.dept, standards, depts, checkpoints]);

  const totalPreviewQuestions = useMemo(() => {
    return previewSections.reduce((acc, s) => acc + (s._checkpoints?.length || 0), 0);
  }, [previewSections]);

  const selectedDeptObj = useMemo(() => {
    return depts.find(x => x.code === form.dept || x.name === form.dept) || null;
  }, [depts, form.dept]);

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

  // Adhoc Handlers
  const validateAdhocDetails = () => {
    if (!adhocTitle.trim()) {
      setAdhocSetupError('Audit Title is required for Adhoc Audit.');
      return false;
    }
    if (!adhocDept) {
      setAdhocSetupError('Please select Audited Area / Zone (Department).');
      return false;
    }
    if (!adhocAuditor) {
      setAdhocSetupError('Please select Auditor.');
      return false;
    }
    if (!adhocStartDate) {
      setAdhocSetupError('Starting Date is required.');
      return false;
    }
    setAdhocSetupError('');
    return true;
  };

  const handleNextToAdhocImport = () => {
    if (!validateAdhocDetails()) return;
    setAuditMode('adhocImport');
  };

  const handleAdhocFileSelect = async (file) => {
    if (!file) return;
    setAdhocUploading(true);
    setAdhocUploadError('');
    setAdhocFile(file);
    try {
      const buffer = await file.arrayBuffer();
      const res = parseAdhocWorkbook(buffer, {
        depts,
        defaultDeptCode: adhocDept,
        defaultAuditor: adhocAuditor,
      });
      setAdhocPreview(res);
      showToast(`Parsed ${res.totalRows} observations (${res.notAdequateCount} NCs)`);
    } catch (err) {
      setAdhocUploadError(err.message || 'Failed to read file');
      setAdhocPreview(null);
      showToast(err.message || 'File parsing error');
    }
    setAdhocUploading(false);
  };

  const deleteAdhocRow = (index) => {
    if (!adhocPreview) return;
    const nextRows = adhocPreview.rows.filter((_, i) => i !== index);
    const adequateCount = nextRows.filter(r => r.assessment === 'Adequate').length;
    const notAdequateCount = nextRows.filter(r => r.assessment === 'Not Adequate').length;
    const naCount = nextRows.filter(r => r.assessment === 'N/A').length;
    const invalidRows = nextRows.filter(r => !r.isValid).length;
    setAdhocPreview({
      rows: nextRows,
      totalRows: nextRows.length,
      adequateCount,
      notAdequateCount,
      naCount,
      invalidRows,
    });
  };

  const submitAdhocAudit = async () => {
    if (!adhocPreview || !adhocPreview.rows.length) {
      showToast('Please upload an assessment file with at least one row');
      return;
    }
    if (adhocPreview.invalidRows > 0) {
      showToast(`Please fix the ${adhocPreview.invalidRows} invalid row(s) before creating audit`);
      return;
    }

    setIsSubmittingAdhoc(true);
    try {
      const deptObj = depts.find(d => d.code === adhocDept || d.name === adhocDept);
      const code = deptObj?.code || adhocDept || 'GEN';
      const name = deptObj?.name || adhocDept;
      const auditYear = new Date(adhocStartDate).getFullYear() || new Date().getFullYear();
      const auditRef = `ADHOC-${code}-${auditYear}-${String(Date.now()).slice(-4)}`;

      const notAdequateRows = adhocPreview.rows.filter(r => r.assessment === 'Not Adequate');
      const nowIso = new Date().toISOString();
      const nowText = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

      // Findings for Not Adequate rows
      const newFindings = notAdequateRows.map((r, i) => {
        const rowDept = depts.find(d => d.code === r.deptCode || d.name === r.deptName) || deptObj;
        const findingRef = `${auditRef}-${rowDept?.code || code}-${i + 1}`;
        const targetDue = r.targetDate || adhocEndDate || adhocStartDate;
        const findingOwner = r.responsiblePerson || rowDept?.spoc || `${name} SPOC`;
        const findingSev = (r.severity || 'Minor').toLowerCase();

        return {
          id: genId('adhoc_nc'),
          ref: findingRef,
          dept: rowDept?.code || code,
          deptName: rowDept?.name || name,
          desc: r.observation,
          topic: r.category || 'Adhoc Checkpoint',
          clause: r.category || 'Adhoc',
          sev: findingSev === 'observation' ? 'obs' : findingSev,
          due: targetDue,
          status: 'open',
          capaStatus: 'open',
          type: 'adhoc',
          source: 'adhoc-audit',
          auditType: 'adhoc',
          adhocAudit: true,
          auditRef,
          auditTitle: adhocTitle,
          auditDate: adhocStartDate,
          responsibleOwner: findingOwner,
          ownerEmail: '',
          remarks: r.remarks || '',
          createdAt: `${adhocStartDate}T12:00:00.000Z`,
          updatedAt: nowIso,
          activityLog: [{
            user: currentUser?.name || currentUser?.loginId || 'Auditor',
            action: `Adhoc audit finding created from "${adhocTitle}"`,
            ts: nowText,
          }],
          closureEvidence: '',
          closureFiles: [],
        };
      });

      // Calculate score
      const totalAssessed = adhocPreview.adequateCount + adhocPreview.notAdequateCount;
      const counts = auditFindingCounts(newFindings);
      const auditScoreFrozen = totalAssessed > 0
        ? Math.round((adhocPreview.adequateCount / totalAssessed) * 100)
        : scoreFromFindingCounts(counts);

      const newAudit = {
        id: genId('adhoc_aud'),
        ref: auditRef,
        auditRef,
        title: adhocTitle,
        dept: code,
        deptName: name,
        auditor: adhocAuditor,
        date: adhocStartDate,
        startDate: adhocStartDate,
        endDate: adhocEndDate,
        type: 'Adhoc Audit',
        auditType: 'adhoc',
        auditSource: 'adhoc',
        adhocAudit: true,
        status: 'submitted',
        submittedAt: `${adhocEndDate || adhocStartDate}T12:00:00.000Z`,
        createdAt: nowIso,
        updatedAt: nowIso,
        description: adhocDescription,
        findingRefs: newFindings.map(f => f.ref),
        auditScoreFrozen,
        auditFindingCountsFrozen: counts,
        stats: {
          totalRows: adhocPreview.totalRows,
          adequate: adhocPreview.adequateCount,
          notAdequate: adhocPreview.notAdequateCount,
          na: adhocPreview.naCount,
        },
      };

      await writeSyncBulk({
        ap_finds: [...findings, ...newFindings],
        ap_completed_audits: [...completed, newAudit],
      }, currentUser?.loginId);

      addNotification(
        'audit',
        'Adhoc Audit Created',
        `"${adhocTitle}" completed with score ${auditScoreFrozen}%. ${newFindings.length} NC(s) entered CAPA.`,
        'capa',
        ['admin', 'auditor', 'spoc', 'manager']
      );

      showToast(`Adhoc audit created! Score: ${auditScoreFrozen}%, ${newFindings.length} NC(s) sent to CAPA.`);

      // Reset adhoc form & return to planning overview
      setAdhocTitle('');
      setAdhocDept('');
      setAdhocAuditor('');
      setAdhocDescription('');
      setAdhocPreview(null);
      setAdhocFile(null);
      setAuditMode('standard');
    } catch (err) {
      showToast(`Failed to create Adhoc Audit: ${err.message}`);
    }
    setIsSubmittingAdhoc(false);
  };

  const filteredAdhocRows = useMemo(() => {
    if (!adhocPreview) return [];
    return adhocPreview.rows.filter(r => {
      if (adhocFilterAssessment !== 'ALL' && r.assessment !== adhocFilterAssessment) return false;
      if (adhocFilterDept !== 'ALL' && r.deptName !== adhocFilterDept && r.deptCode !== adhocFilterDept) return false;
      return true;
    });
  }, [adhocPreview, adhocFilterAssessment, adhocFilterDept]);

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="stat-label">Annual Target</div>
          <div className="stat-value">{annualTarget}</div>
          <div className="stat-delta">{depts.length} departments tracked</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Completed</div>
          <div className="stat-value" style={{ color: 'var(--green)' }}>{completed.length}</div>
          <div className="stat-delta">Submitted audits</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Scheduled</div>
          <div className="stat-value" style={{ color: 'var(--accent)' }}>{planned.length}</div>
          <div className="stat-delta">{next30} next 30 days</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Overdue</div>
          <div className="stat-value" style={{ color: 'var(--red)' }}>{overdue}</div>
          <div className="stat-delta" style={{ color: 'var(--red)' }}>Action needed</div>
        </div>
      </div>

      {/* SCREENSHOT 1: TYPE SELECTION (Standard vs Adhoc) */}
      {auditMode === 'typeSelect' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Standard Audit card */}
            <button
              className="flex min-h-[190px] flex-col items-start justify-between rounded-xl border border-[var(--border)] bg-white p-5 text-left transition-all hover:border-[var(--brand)] hover:shadow-md cursor-pointer"
              onClick={() => setAuditMode('standard')}
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-[var(--brand)]">
                <Icon name="clipboard-list" className="w-5 h-5 text-[var(--brand)]" />
              </span>
              <div>
                <div className="mb-1 text-lg font-extrabold text-[var(--text)]">Standard Audit</div>
                <p className="text-sm text-[var(--text2)]">Audit using predefined ISO / AS9100 / Internal checklist.</p>
              </div>
              <span className="text-xs font-extrabold uppercase tracking-wide text-[var(--brand)]">USE FIXED CHECKLIST</span>
            </button>

            {/* Adhoc Audit card */}
            <button
              className="flex min-h-[190px] flex-col items-start justify-between rounded-xl border border-[var(--border)] bg-white p-5 text-left transition-all hover:border-blue-600 hover:shadow-md cursor-pointer"
              onClick={() => setAuditMode('adhocDetails')}
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#eef6ff] text-[#1d4ed8]">
                <Icon name="file-spreadsheet" className="w-5 h-5 text-[#1d4ed8]" />
              </span>
              <div>
                <div className="mb-1 text-lg font-extrabold text-[var(--text)]">Adhoc Audit</div>
                <p className="text-sm text-[var(--text2)]">Create a flexible audit by importing observations from CSV or Excel.</p>
              </div>
              <span className="text-xs font-extrabold uppercase tracking-wide text-[#1d4ed8]">IMPORT CSV / EXCEL ASSESSMENT</span>
            </button>
          </div>
          <div>
            <button className="btn btn-ghost inline-flex items-center gap-1.5" onClick={() => setAuditMode('standard')}>
              <Icon name="chevron-left" /> Back
            </button>
          </div>
        </div>
      )}

      {/* SCREENSHOT 2: ADHOC AUDIT DETAILS */}
      {auditMode === 'adhocDetails' && (
        <div className="mx-auto my-3 max-w-[760px] rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-[var(--brand)]">
              <Icon name="file-spreadsheet" className="w-5 h-5 text-[var(--brand)]" />
            </span>
            <h2 className="text-base font-extrabold text-[var(--text)]">Adhoc Audit Details</h2>
          </div>

          {adhocSetupError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-[var(--red)] font-semibold">
              {adhocSetupError}
            </div>
          )}

          <div className="space-y-3.5">
            <div>
              <label className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--text2)] block mb-1">
                Audit Title *
              </label>
              <input
                type="text"
                className="w-full"
                value={adhocTitle}
                onChange={e => setAdhocTitle(e.target.value)}
                placeholder="Example: Line 2 Special Quality Audit"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--text2)] block mb-1">
                  Audited Area / Zone *
                </label>
                <select value={adhocDept} onChange={e => setAdhocDept(e.target.value)}>
                  <option value="">Select Audit Area / Zone</option>
                  {depts.map(d => (
                    <option key={d.code} value={d.code}>{d.name} ({d.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--text2)] block mb-1">
                  Auditor *
                </label>
                <select value={adhocAuditor} onChange={e => setAdhocAuditor(e.target.value)}>
                  <option value="">Select Auditor</option>
                  {auditors.map(a => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                  {currentUser?.name && <option value={currentUser.name}>{currentUser.name}</option>}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--text2)] block mb-1">
                  Starting Date *
                </label>
                <input
                  type="date"
                  value={adhocStartDate}
                  onChange={e => setAdhocStartDate(e.target.value)}
                />
              </div>

              <div>
                <label className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--text2)] block mb-1">
                  Ending Date
                </label>
                <input
                  type="date"
                  value={adhocEndDate}
                  min={adhocStartDate || undefined}
                  onChange={e => setAdhocEndDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--text2)] block mb-1">
                Description / Remarks
              </label>
              <textarea
                rows={3}
                value={adhocDescription}
                onChange={e => setAdhocDescription(e.target.value)}
                placeholder="Scope, reason, area context, or special audit remarks..."
                style={{ resize: 'none' }}
              />
            </div>

            <div className="pt-2 flex justify-between items-center">
              <button
                type="button"
                className="btn btn-ghost inline-flex items-center gap-1.5"
                onClick={() => setAuditMode('typeSelect')}
              >
                <Icon name="chevron-left" /> Back
              </button>
              <button
                type="button"
                className="btn btn-brand inline-flex items-center gap-1.5"
                onClick={handleNextToAdhocImport}
              >
                Next: CSV / Excel Import <Icon name="chevron-right" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADHOC IMPORT VIEW */}
      {auditMode === 'adhocImport' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-extrabold text-blue-700">
                  <Icon name="file-spreadsheet" className="w-3.5 h-3.5 text-blue-700" /> ADHOC AUDIT
                </div>
                <h2 className="text-base font-extrabold text-[var(--text)]">CSV / Excel Template Upload</h2>
                <p className="mt-1 max-w-3xl text-xs text-[var(--text2)]">
                  Use one row per assessed checkpoint or observation. Select <strong>Adequate</strong>, <strong>Not Adequate</strong> or <strong>N/A</strong> for every row.
                  Not Adequate rows will automatically create Findings and enter the CAPA workflow.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost inline-flex items-center gap-1.5"
                onClick={() => downloadAdhocTemplate(depts)}
              >
                <Icon name="download" /> Download Template
              </button>
            </div>

            <div
              className="flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border2)] bg-[var(--bg3)] px-4 py-6 text-center hover:border-[var(--brand)] transition-colors"
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) handleAdhocFileSelect(f);
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="upload-cloud" className="w-8 h-8 text-[var(--text3)] mb-2" />
              <strong className="text-sm text-[var(--text)]">
                {adhocUploading ? 'Parsing file...' : (adhocFile ? adhocFile.name : 'Drag and drop CSV / Excel here')}
              </strong>
              <span className="mt-1 text-xs text-[var(--text3)]">or browse a .csv / .xlsx / .xls file up to 5 MB</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                disabled={adhocUploading}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleAdhocFileSelect(f);
                }}
              />
            </div>

            {adhocUploadError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-[var(--red)] font-semibold">
                {adhocUploadError}
              </div>
            )}
          </div>

          {adhocPreview && (
            <div className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-extrabold text-[var(--text)]">Assessment Preview</h2>
                  <p className="text-xs text-[var(--text3)]">{adhocFile?.name}</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-2">
                    <div className="text-[10px] font-bold text-[var(--text3)]">Rows</div>
                    <strong>{adhocPreview.totalRows}</strong>
                  </div>
                  <div className="rounded-lg border border-green-200 bg-green-50 p-2">
                    <div className="text-[10px] font-bold text-[var(--green)]">Adequate</div>
                    <strong style={{ color: 'var(--green)' }}>{adhocPreview.adequateCount}</strong>
                  </div>
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2">
                    <div className="text-[10px] font-bold text-[var(--red)]">Not Adequate</div>
                    <strong style={{ color: 'var(--red)' }}>{adhocPreview.notAdequateCount}</strong>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-2">
                    <div className="text-[10px] font-bold text-[var(--text3)]">N/A</div>
                    <strong>{adhocPreview.naCount}</strong>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
                    <div className="text-[10px] font-bold text-[var(--amber)]">Invalid</div>
                    <strong style={{ color: 'var(--amber)' }}>{adhocPreview.invalidRows}</strong>
                  </div>
                </div>
              </div>

              {/* Filters & Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2 flex-wrap">
                  <select
                    className="text-xs"
                    value={adhocFilterAssessment}
                    onChange={e => setAdhocFilterAssessment(e.target.value)}
                  >
                    <option value="ALL">All Assessments</option>
                    <option value="Adequate">Adequate</option>
                    <option value="Not Adequate">Not Adequate</option>
                    <option value="N/A">N/A</option>
                  </select>
                  <select
                    className="text-xs"
                    value={adhocFilterDept}
                    onChange={e => setAdhocFilterDept(e.target.value)}
                  >
                    <option value="ALL">All Responsible Depts</option>
                    {depts.map(d => (
                      <option key={d.code} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setAuditMode('adhocDetails')}
                  >
                    <Icon name="chevron-left" /> Back
                  </button>
                  <button
                    type="button"
                    className="btn btn-brand btn-sm inline-flex items-center gap-1.5"
                    onClick={submitAdhocAudit}
                    disabled={isSubmittingAdhoc || adhocPreview.invalidRows > 0}
                  >
                    <Icon name="check" /> {isSubmittingAdhoc ? 'Creating Audit...' : 'Create Adhoc Audit'}
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="table-wrap max-h-[400px] overflow-y-auto">
                <table style={{ fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>Sr.</th>
                      <th>Category</th>
                      <th>Observation / Checkpoint</th>
                      <th>Assessment</th>
                      <th>Responsible Dept</th>
                      <th>Responsible Person</th>
                      <th>Severity</th>
                      <th>Target Date</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAdhocRows.map((r, i) => (
                      <tr key={i}>
                        <td className="font-bold">{r.srNo || i + 1}</td>
                        <td><Badge type="b-blue">{r.category}</Badge></td>
                        <td style={{ maxWidth: 260 }}>{r.observation}</td>
                        <td>
                          <Badge type={r.assessment === 'Adequate' ? 'b-green' : r.assessment === 'Not Adequate' ? 'b-red' : 'b-gray'}>
                            {r.assessment}
                          </Badge>
                        </td>
                        <td>{r.deptName}</td>
                        <td>{r.responsiblePerson || '—'}</td>
                        <td>
                          {r.assessment === 'Not Adequate' ? (
                            <Badge type={SEV_BADGE[r.severity?.toLowerCase()] || 'b-amber'}>
                              {r.severity}
                            </Badge>
                          ) : '—'}
                        </td>
                        <td>{r.targetDate || '—'}</td>
                        <td>
                          {r.errors.length ? (
                            <span className="text-[10px] text-[var(--red)] font-bold" title={r.errors.join('; ')}>
                              Invalid
                            </span>
                          ) : r.warnings.length ? (
                            <span className="text-[10px] text-[var(--amber)] font-bold" title={r.warnings.join('; ')}>
                              Warning
                            </span>
                          ) : (
                            <span className="text-[10px] text-[var(--green)] font-bold">Valid</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-sm"
                            title="Remove observation"
                            onClick={() => deleteAdhocRow(i)}
                          >
                            <Icon name="trash-2" className="w-3.5 h-3.5 text-[var(--red)]" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STANDARD AUDIT VIEW (Calendar + Create Card) */}
      {auditMode === 'standard' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Calendar */}
          <div className="lg:col-span-2">
            <Card
              title={`Audit Calendar — ${cal.title}`}
              action={
                <div className="flex gap-1">
                  <button className="btn btn-ghost btn-sm" onClick={() => navCal(-1)}>‹</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => navCal(1)}>›</button>
                </div>
              }
            >
              <div className="cal-grid mb-1">
                {DOW.map((d, i) => (
                  <div key={i} className="text-[9px] font-bold text-center" style={{ color: 'var(--text3)', padding: 3 }}>
                    {d}
                  </div>
                ))}
              </div>
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

          {/* SCREENSHOT 3 & 4: CREATE NEW AUDIT CARD */}
          <div>
            <div className="card" style={{ border: '1.5px solid var(--brand)' }}>
              <div className="card-heading flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="dot w-[7px] h-[7px] rounded-full bg-[var(--brand)] flex-shrink-0" />
                  CREATE NEW AUDIT
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-[10px] font-bold"
                  style={{ color: 'var(--brand)' }}
                  onClick={() => setAuditMode('typeSelect')}
                  title="Switch between Standard Audit and Adhoc Audit"
                >
                  Type: Standard ▾
                </button>
              </div>

              {/* Department */}
              <div className="mb-2">
                <label className="form-label">DEPARTMENT *</label>
                <select value={form.dept} onChange={e => setForm(p => ({ ...p, dept: e.target.value }))}>
                  <option value="">Select department...</option>
                  {depts.map(d => <option key={d.id || d.code} value={d.code}>{d.name}</option>)}
                </select>
              </div>

              {/* Standards */}
              <div className="mb-2">
                <label className="form-label">SELECT AUDIT STANDARD(S) * — TICK ALL THAT APPLY</label>
                <div className="stdc">
                  {Object.values(STD_META).filter(s => s.id !== 'internal').map(s => (
                    <div
                      key={s.id}
                      className={`stdchip ${standards.includes(s.id) ? 'sel' : ''}`}
                      onClick={() => toggleStd(s.id)}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                      {s.label}
                    </div>
                  ))}
                  <div
                    className={`stdchip ${standards.includes('internal') ? 'sel' : ''}`}
                    onClick={() => toggleStd('internal')}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7c3aed', display: 'inline-block' }} />
                    OnePWS Internal ({checkpoints.length} checkpoints)
                  </div>
                </div>
              </div>

              {/* Questions count badge */}
              {!form.dept ? (
                <div className="text-xs mb-2" style={{ color: 'var(--text3)' }}>
                  Select department and standards to preview checklist
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap text-xs font-semibold mb-2" style={{ color: 'var(--green)' }}>
                  <span className="flex items-center gap-1">
                    <Icon name="check-circle-2" className="w-3.5 h-3.5" />
                    <strong>{totalPreviewQuestions} questions</strong>
                  </span>
                  <span style={{ color: 'var(--text3)' }}>·</span>
                  <span style={{ color: 'var(--text2)' }}>{previewSections.length} section(s)</span>
                  <span style={{ color: 'var(--text3)' }}>·</span>
                  {standards.map(sid => {
                    const sm = STD_META[sid];
                    if (!sm) return null;
                    return (
                      <span
                        key={sid}
                        style={{
                          background: sm.bg || 'var(--bg3)',
                          color: sm.color,
                          border: `1px solid ${sm.border || sm.color}`,
                          borderRadius: 12,
                          padding: '1px 7px',
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {sm.short || sm.label}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Auditor */}
              <div className="mb-2">
                <label className="form-label">AUDITOR *</label>
                <select value={form.auditor} onChange={e => setForm(p => ({ ...p, auditor: e.target.value }))}>
                  <option value="">Select auditor...</option>
                  {auditors.map(a => <option key={a.id || a.name} value={a.name}>{a.name}</option>)}
                </select>
              </div>

              {/* Date & Type */}
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="form-label">DATE</label>
                  <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">TYPE</label>
                  <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                    <option>Full Internal Audit</option>
                    <option>Follow-up Audit</option>
                    <option>Supplier Audit</option>
                    <option>Process Audit</option>
                  </select>
                </div>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-brand w-full" onClick={scheduleAudit} disabled={!canEdit}>
                  <Icon name="calendar-plus" /> Schedule Audit
                </button>
                <button className="btn btn-primary w-full" onClick={createAndStart} disabled={!canEdit}>
                  <Icon name="play" /> Create & Start
                </button>
              </div>

              {/* PREVIEW FULL CHECKLIST BUTTON */}
              <button
                type="button"
                className="btn btn-ghost w-full flex items-center justify-center gap-1.5 mt-2"
                style={{ background: 'var(--bg2)', border: '1px solid var(--border)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}
                onClick={() => {
                  if (!form.dept) { showToast('Select department first to preview checklist'); return; }
                  if (!previewSections.length) { showToast('No checkpoints found for selected department and standards'); return; }
                  setShowPreviewModal(true);
                }}
              >
                <Icon name="eye" /> Preview Full Checklist
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Planned audits list */}
      <Card title="Planned Audits" action={<Badge type="b-blue">{planned.length}</Badge>}>
        {planned.length === 0 ? (
          <div className="info-box">No planned audits yet. Select department, standards and date, then click Schedule Audit.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Department</th>
                  <th>Auditor</th>
                  <th>Standards</th>
                  <th>Type</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {planned.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).map(a => (
                  <tr key={a.id}>
                    <td className="font-bold">{fmtDate(a.date)}</td>
                    <td>{a.deptName || a.dept}</td>
                    <td>{a.auditor || '-'}</td>
                    <td>{(a.standards || []).map(s => STD_META[s]?.short || s).join(', ') || '-'}</td>
                    <td>
                      <Badge type={a.auditType === 'adhoc' ? 'b-blue' : 'b-gray'}>
                        {a.type || 'Full Internal Audit'}
                      </Badge>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-brand btn-sm" onClick={() => startPlanned(a)}>
                          <Icon name="play" /> Start
                        </button>
                        {currentUser?.role === 'admin' && (
                          <button className="btn btn-danger btn-icon btn-sm" onClick={() => setConfirmDelete(a.id)}>
                            <Icon name="trash-2" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* CHECKLIST PREVIEW MODAL */}
      {showPreviewModal && (
        <div className="modal-bg" onClick={() => setShowPreviewModal(false)}>
          <div className="modal-box" style={{ maxWidth: 840 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="font-extrabold text-sm">
                  Preview Full Checklist — {selectedDeptObj?.name || form.dept}
                </span>
                <div className="text-xs text-[var(--text3)] font-normal mt-0.5">
                  {totalPreviewQuestions} checkpoints across {previewSections.length} section(s)
                </div>
              </div>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowPreviewModal(false)}>
                <Icon name="x" />
              </button>
            </div>

            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1 my-2">
              {previewSections.map(sec => (
                <div key={sec.id} className="rounded-lg border border-[var(--border)] p-3 bg-white">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-xs text-[var(--text)]">{sec.title}</span>
                    <Badge type={sec.stdId === 'internal' ? 'b-purple' : 'b-blue'}>{sec.clause}</Badge>
                  </div>
                  <div className="table-wrap">
                    <table style={{ fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 35 }}>#</th>
                          <th>Checkpoint Question</th>
                          <th>Clause</th>
                          <th style={{ width: 55 }}>Weight</th>
                          <th>Guidance / Tip</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sec._checkpoints.map((cp, idx) => (
                          <tr key={cp.id || idx}>
                            <td className="font-bold">{idx + 1}</td>
                            <td>{cp.text}</td>
                            <td><Badge type="b-gray">{cp.clause || '—'}</Badge></td>
                            <td className="text-center font-bold">{cp.weight || 3}</td>
                            <td className="text-[10px]" style={{ color: 'var(--text3)' }}>{cp.tip || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-[var(--border)]">
              <button className="btn btn-ghost" onClick={() => setShowPreviewModal(false)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowPreviewModal(false);
                  createAndStart();
                }}
                disabled={!canEdit}
              >
                <Icon name="play" /> Create & Start Audit
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmDelete}
        message="Cancel this scheduled audit?"
        onConfirm={() => removePlan(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
