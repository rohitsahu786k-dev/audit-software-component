import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Card, EmptyState } from '../components/UI';
import { fmtDate, genId } from '../utils/helpers';
import { Icon } from '../components/UI';

export default function Learnings() {
  const { getLearnings, writeSyncKey, currentUser } = useApp();
  const [newLearning, setNewLearning] = useState('');
  const [adding, setAdding] = useState(false);

  const learnings = getLearnings();

  const addLearning = () => {
    if (!newLearning.trim()) return;
    const current = getLearnings();
    const updated = [
      ...current,
      {
        id: genId('learn'),
        text: newLearning.trim(),
        date: new Date().toISOString(),
        by: currentUser?.loginId || 'auditor',
      }
    ];
    writeSyncKey('ap_learns', updated, currentUser?.loginId);
    setNewLearning('');
    setAdding(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-bold" style={{ color: 'var(--text2)' }}>AI Compliance Knowledge Base</h2>
        {!adding && (
          <button className="btn btn-brand btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Add Learning
          </button>
        )}
      </div>

      {adding && (
        <Card title="New Knowledge Entry">
          <div className="space-y-3">
            <textarea
              value={newLearning}
              onChange={e => setNewLearning(e.target.value)}
              placeholder="E.g. Calibration records for digital calipers must include temperature corrections..."
              style={{ height: 70, resize: 'none' }}
            />
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={addLearning}>Save entry</button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        {learnings.length === 0 ? (
          <EmptyState icon="lightbulb" title="No learnings recorded" subtitle="AI suggestions and lessons learned will appear here." />
        ) : (
          <div className="space-y-3">
            {learnings.map(item => (
              <div key={item.id} className="p-3 rounded-lg border flex gap-3 items-start" style={{ borderColor: 'var(--border)', background: 'var(--bg3)' }}>
                <Icon name="lightbulb" className="text-[var(--amber)] flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs" style={{ color: 'var(--text2)' }}>{item.text}</div>
                  <div className="text-[10px] mt-2 flex gap-3" style={{ color: 'var(--text3)' }}>
                    <span>By: {item.by}</span>
                    <span>Added: {fmtDate(item.date)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
