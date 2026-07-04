import React from 'react';
import { Card } from '../components/UI';
import { Icon } from '../components/UI';

export default function OcpManual() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="md:col-span-1 space-y-3">
        <Card title="OCP Manual Chapters">
          <div className="space-y-2">
            {[
              '1. Quality Management System (QMS)',
              '2. Leadership & Commitment',
              '3. Planning for QMS',
              '4. Support & Resource Management',
              '5. Operation & Product Realization',
              '6. Performance Evaluation',
              '7. Non-conformance & Corrective Actions §10.2',
            ].map((ch, idx) => (
              <div
                key={idx}
                className="p-2 rounded-lg border text-xs cursor-pointer hover:bg-[var(--bg3)]"
                style={{ borderColor: 'var(--border)' }}
              >
                {ch}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="md:col-span-2">
        <Card title="Document Viewer">
          <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed rounded-lg" style={{ borderColor: 'var(--border)' }}>
            <Icon name="book-open" className="w-12 h-12 mb-3 opacity-30" />
            <div className="text-sm font-bold" style={{ color: 'var(--text2)' }}>Operation Control Procedure Manual</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text3)' }}>Select a chapter from the list to view compliance guidelines.</div>
            <a href="/assets/dummy_manual.pdf" target="_blank" className="btn btn-brand btn-sm mt-4">
              <Icon name="file-text" /> Open Full Manual PDF
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}
