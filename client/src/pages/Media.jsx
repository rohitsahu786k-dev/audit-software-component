import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Card, EmptyState, Badge } from '../components/UI';
import { fmtDate, showToast } from '../utils/helpers';
import { Icon } from '../components/UI';

export default function Media() {
  const { getMediaLibrary, writeSyncKey, currentUser } = useApp();
  const [uploading, setUploading] = useState(false);
  const items = getMediaLibrary();

  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    // Mock upload helper since Cloudinary is mocked/env dependent
    setTimeout(() => {
      const current = getMediaLibrary();
      const newItem = {
        id: `media_${Date.now()}`,
        name: file.name,
        size: `${Math.round(file.size / 1024)} KB`,
        url: '#',
        uploadedAt: new Date().toISOString(),
        uploadedBy: currentUser?.loginId || 'user',
      };
      writeSyncKey('ap_media_library', [newItem, ...current], currentUser?.loginId);
      setUploading(false);
      showToast('File uploaded successfully');
    }, 1500);
  };

  const deleteMedia = (id) => {
    const current = getMediaLibrary();
    const updated = current.filter(item => item.id !== id);
    writeSyncKey('ap_media_library', updated, currentUser?.loginId);
    showToast('File deleted');
  };

  return (
    <div className="space-y-3">
      <Card title="Upload QMS Document / Evidence">
        <div className="upload-area" onClick={() => document.getElementById('media-file-input').click()}>
          <Icon name="upload-cloud" className="w-10 h-10 mb-2 opacity-55" />
          <div className="text-xs font-bold" style={{ color: 'var(--text2)' }}>
            {uploading ? 'Uploading document...' : 'Click to select or drag files here'}
          </div>
          <input type="file" id="media-file-input" className="hidden" onChange={handleUpload} disabled={uploading} />
        </div>
      </Card>

      <Card title="Library Documents">
        {items.length === 0 ? (
          <EmptyState icon="folder-open" title="No files uploaded" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {items.map(item => (
              <div key={item.id} className="p-3 rounded-lg border flex flex-col justify-between" style={{ borderColor: 'var(--border)', background: 'var(--bg3)' }}>
                <div>
                  <div className="flex gap-2 items-start">
                    <Icon name="file" className="text-[var(--accent)] mt-0.5" />
                    <div className="text-xs font-bold truncate max-w-[150px]">{item.name}</div>
                  </div>
                  <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>Size: {item.size}</div>
                </div>
                <div className="flex justify-between items-center mt-3 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <span className="text-[9px]" style={{ color: 'var(--text3)' }}>{fmtDate(item.uploadedAt)}</span>
                  <div className="flex gap-1">
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => deleteMedia(item.id)}><Icon name="trash-2" /></button>
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
