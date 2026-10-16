import { genId } from './helpers';
import { deptRecordForValue, deptValuesMatch } from './dashboardHelpers';
import { externalAuditDate } from './externalAudit';

export const ADHOC_TEMPLATE_COLUMNS = [
  'Sr. No.',
  'Category / Clause',
  'Observation / Checkpoint',
  'Assessment',
  'Responsible Department',
  'Responsible Person',
  'Severity',
  'Target Date',
  'Remarks',
];

export const ASSESSMENTS = ['Adequate', 'Not Adequate', 'N/A'];
export const SEVERITIES = ['Critical', 'Major', 'Minor', 'Observation'];

const HEADER_ALIASES = {
  serial: ['Sr. No.', 'Sr No', 'Sr. No', 'Serial No', 'S.No', 'S No', 'SNo', 'Sr'],
  category: ['Category / Clause', 'Category', 'Clause', '6S Category', 'Standard', 'Section'],
  observation: ['Observation / Checkpoint', 'Observation', 'Checkpoint', 'Finding', 'Description', 'Observation/Checkpoint'],
  assessment: ['Assessment', 'Status', 'Response', 'Result', 'Compliance'],
  dept: ['Responsible Department', 'Department', 'Dept', 'Audited Department'],
  owner: ['Responsible Person', 'Responsible Owner', 'Owner', 'Person'],
  severity: ['Severity', 'NC Type', 'Type of NC', 'Severity Level'],
  targetDate: ['Target Date', 'Target Closure Date', 'Due Date', 'Due'],
  remarks: ['Remarks', 'Comments', 'Note', 'Notes'],
};

function norm(val) {
  return String(val ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cell(row, aliases) {
  const entries = Object.entries(row || {});
  for (const name of aliases) {
    const wanted = norm(name);
    const hit = entries.find(([key]) => norm(key) === wanted);
    if (hit && String(hit[1] ?? '').trim()) return hit[1];
  }
  return '';
}

export function normalizeAssessment(val) {
  const s = norm(val).replace(/[ _-]+/g, '');
  if (['adequate', 'ok', 'yes', 'compliant', 'pass', 'satisfactory'].includes(s)) return 'Adequate';
  if (['notadequate', 'no', 'nc', 'noncompliant', 'fail', 'unsatisfactory'].includes(s)) return 'Not Adequate';
  if (['na', 'notapplicable'].includes(s)) return 'N/A';
  return '';
}

export function normalizeSeverity(val) {
  const s = norm(val);
  if (!s) return 'Minor';
  if (s.includes('critical') || s === 'cr') return 'Critical';
  if (s.includes('major') || s === 'ma') return 'Major';
  if (s.includes('minor') || s === 'mi') return 'Minor';
  if (s.includes('observation') || s === 'obs' || s === 'ofi') return 'Observation';
  return 'Minor';
}

export function downloadAdhocTemplate(depts = []) {
  if (!window.XLSX) return;
  const sampleRows = [
    [1, 'ISO 9001 §7.5', 'Controlled copies of work instructions available at the workstation.', 'Adequate', depts[0]?.name || 'Production', 'Production SPOC', '', '', 'Verified current revision'],
    [2, 'AS9100D §8.7', 'Obsolete material found unsegregated in bin B-4.', 'Not Adequate', depts[0]?.name || 'Stores', 'Stores SPOC', 'Major', '30/10/2026', 'Immediate quarantine and NC tag required'],
    [3, 'ISO 14001 §8.1', 'Spill kit inspected and fully stocked.', 'Adequate', depts[1]?.name || 'HSE', 'HSE SPOC', '', '', 'Monthly log signed'],
    [4, 'ISO 45001 §8.1', 'Machine M-02 was undergoing scheduled overhaul during audit.', 'N/A', depts[0]?.name || 'Maintenance', '', '', '', 'Not assessed due to maintenance'],
  ];

  const ws = window.XLSX.utils.aoa_to_sheet([ADHOC_TEMPLATE_COLUMNS, ...sampleRows]);
  ws['!cols'] = [
    { wch: 8 }, { wch: 20 }, { wch: 48 }, { wch: 16 }, { wch: 24 },
    { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 32 },
  ];

  const instructions = window.XLSX.utils.aoa_to_sheet([
    ['Adhoc Audit Import Instructions'],
    [],
    ['1', 'Fill the first sheet (Adhoc Audit Assessment) from row 2.'],
    ['2', 'Assessment must be one of: Adequate, Not Adequate, or N/A.'],
    ['3', 'Adequate = Compliant checkpoint (adds to audit compliance score).'],
    ['4', 'Not Adequate = Non-conformance (automatically creates a finding and enters CAPA).'],
    ['5', 'N/A = Excluded from compliance score.'],
    ['6', 'For Not Adequate rows: Severity and Target Date are required. If Responsible Person is blank, the department SPOC is assigned.'],
    ['7', 'Target Date format: DD/MM/YYYY or YYYY-MM-DD.'],
    [],
    ['Valid Departments (from Department Master)'],
    ...depts.map(d => [d.code, d.name]),
    [],
    ['Allowed Assessments'],
    ...ASSESSMENTS.map(a => [a]),
    [],
    ['Allowed Severities'],
    ...SEVERITIES.map(s => [s]),
  ]);
  instructions['!cols'] = [{ wch: 14 }, { wch: 80 }];

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Adhoc Audit Assessment');
  window.XLSX.utils.book_append_sheet(wb, instructions, 'Instructions');
  window.XLSX.writeFile(wb, 'OnePWS_Adhoc_Audit_Template.xlsx');
}

export function parseAdhocWorkbook(fileData, { depts = [], users = [], defaultDeptCode = '', defaultAuditor = '' }) {
  if (!window.XLSX) throw new Error('Excel parser is loading, please try again');
  const wb = window.XLSX.read(fileData, { type: 'array', cellDates: true, cellFormula: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Uploaded file contains no sheets');
  const sheet = wb.Sheets[sheetName];
  const rawRows = window.XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

  if (!rawRows.length) throw new Error('Uploaded sheet has no data rows');

  const parsedRows = [];
  rawRows.forEach((row, idx) => {
    // Skip empty rows or sample instructions
    if (!Object.values(row).some(v => String(v ?? '').trim())) return;
    const observation = String(cell(row, HEADER_ALIASES.observation)).trim();
    if (!observation) return;
    if (observation.toLowerCase().includes('sample row') || observation.toLowerCase().includes('sample instruction')) return;

    const rowNo = idx + 2;
    const serial = String(cell(row, HEADER_ALIASES.serial)).trim() || String(parsedRows.length + 1);
    const category = String(cell(row, HEADER_ALIASES.category)).trim() || 'General';
    const assessment = normalizeAssessment(cell(row, HEADER_ALIASES.assessment)) || 'Adequate';
    const rawDept = String(cell(row, HEADER_ALIASES.dept)).trim();
    const matchedDept = rawDept ? deptRecordForValue(depts, rawDept) : deptRecordForValue(depts, defaultDeptCode);
    const dept = matchedDept || { code: defaultDeptCode || 'GEN', name: rawDept || 'General' };
    const person = String(cell(row, HEADER_ALIASES.owner)).trim();
    const severity = normalizeSeverity(cell(row, HEADER_ALIASES.severity));
    const targetDate = externalAuditDate(cell(row, HEADER_ALIASES.targetDate));
    const remarks = String(cell(row, HEADER_ALIASES.remarks)).trim();

    const errors = [];
    const warnings = [];

    if (!assessment) errors.push('Invalid Assessment (must be Adequate, Not Adequate, or N/A)');
    if (assessment === 'Not Adequate') {
      if (!matchedDept && !defaultDeptCode) errors.push(`Unknown department "${rawDept}"`);
      if (!targetDate) warnings.push('No Target Date specified (will default to 30 days)');
      if (!person) warnings.push(`No Responsible Person (will assign to ${dept.name} SPOC)`);
    }

    parsedRows.push({
      rowNo,
      srNo: serial,
      category,
      observation,
      assessment,
      deptCode: dept.code,
      deptName: dept.name,
      responsiblePerson: person,
      severity,
      targetDate,
      remarks,
      errors,
      warnings,
      isValid: errors.length === 0,
    });
  });

  const adequateCount = parsedRows.filter(r => r.assessment === 'Adequate').length;
  const notAdequateCount = parsedRows.filter(r => r.assessment === 'Not Adequate').length;
  const naCount = parsedRows.filter(r => r.assessment === 'N/A').length;
  const invalidRows = parsedRows.filter(r => !r.isValid).length;

  return {
    rows: parsedRows,
    totalRows: parsedRows.length,
    adequateCount,
    notAdequateCount,
    naCount,
    invalidRows,
  };
}
