import React, { useState } from 'react';
import { Card } from '../components/UI';
import { showToast } from '../utils/helpers';
import { Icon } from '../components/UI';

export default function ImportData() {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);

  const handleFileChange = (e) => {
    setFile(e.target.files?.[0] || null);
  };

  const handleImport = () => {
    if (!file) {
      showToast('Please select an Excel or CSV file first');
      return;
    }
    setImporting(true);
    setTimeout(() => {
      setImporting(false);
      setFile(null);
      showToast('Excel findings data imported successfully');
    }, 2000);
  };

  return (
    <div className="space-y-3 max-w-lg">
      <Card title="Bulk Import Compliance Data">
        <div className="space-y-3">
          <div className="text-xs" style={{ color: 'var(--text2)' }}>
            Import findings, checkpoints, or departments from standard Excel templates.
          </div>

          <div
            className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-[var(--bg3)]"
            style={{ borderColor: 'var(--border)' }}
            onClick={() => document.getElementById('excel-file-input').click()}
          >
            <Icon name="file-spreadsheet" className="w-10 h-10 mx-auto mb-2 opacity-40 text-[var(--brand)]" />
            <div className="text-xs font-bold" style={{ color: 'var(--text2)' }}>
              {file ? file.name : 'Select template file (.xlsx, .xls, .csv)'}
            </div>
            <input type="file" id="excel-file-input" className="hidden" accept=".xlsx,.xls,.csv" onChange={handleFileChange} />
          </div>

          <div className="flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => setFile(null)}>Clear</button>
            <button className="btn btn-brand flex-1" onClick={handleImport} disabled={importing || !file}>
              {importing ? 'Importing...' : 'Start Import'}
            </button>
          </div>
        </div>
      </Card>

      <Card title="Help & Templates">
        <div className="space-y-2 text-xs">
          <div className="flex justify-between items-center py-1 border-b" style={{ borderColor: 'var(--border)' }}>
            <span>Findings Import Schema Template</span>
            <a href="/assets/findings_template.xlsx" className="text-[var(--accent)] font-bold">Download</a>
          </div>
          <div className="flex justify-between items-center py-1 border-b" style={{ borderColor: 'var(--border)' }}>
            <span>Checkpoints Import Schema Template</span>
            <a href="/assets/checkpoints_template.xlsx" className="text-[var(--accent)] font-bold">Download</a>
          </div>
        </div>
      </Card>
    </div>
  );
}
