import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, Icon } from '../components/UI';
import { showToast, sanitize } from '../utils/helpers';
import { apiFetch } from '../utils/api';
import { managerDeptCodes } from '../utils/dashboardHelpers';

const CATS = ['all', 'Audit Reports', 'NC Evidence', 'Closure Evidence', 'Email Attachments', 'Images', 'Documents', 'Videos', 'Trash'];
const EDIT_CATS = ['Audit Reports', 'NC Evidence', 'Closure Evidence', 'Email Attachments', 'Images', 'Documents', 'Videos'];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function mediaSize(bytes) {
  bytes = Number(bytes) || 0;
  if (!bytes) return '-';
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes > 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}
const mediaUrl = (m) => m.secure_url || m.url || '#';
const isImage = (m) => m.file_type === 'image' || m.resource_type === 'image' || /\.(jpe?g|png|gif|webp|bmp)(\?|#|$)/i.test(mediaUrl(m));
const readFileAsDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Read failed')); r.readAsDataURL(file); });

export default function Media() {
  const { getMediaLibrary, getDepts, getEmailMaster, writeSyncKey, currentUser, refreshSync, setPageAction } = useApp();
  const role = currentUser?.role;
  const depts = getDepts();
  const codes = useMemo(() => managerDeptCodes(currentUser, depts, getEmailMaster()), [currentUser, depts, getEmailMaster]);

  useEffect(() => {
    setPageAction(() => () => { refreshSync(); showToast('Refreshing…'); });
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState('latest');
  const [view, setView] = useState('list');
  const [preview, setPreview] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [checkingCloudinary, setCheckingCloudinary] = useState(false);

  const checkCloudinary = async () => {
    setCheckingCloudinary(true);
    try {
      const r = await apiFetch('/api/media/status');
      showToast(r.configured ? 'Cloudinary connected (' + r.cloudName + ')' : 'Cloudinary is not configured on the server');
    } catch (err) {
      showToast('Cloudinary check failed: ' + err.message);
    }
    setCheckingCloudinary(false);
  };
  const [uploading, setUploading] = useState(false);

  const scoped = useMemo(() => (getMediaLibrary() || []).filter(m => {
    if (role === 'spoc') return (m.dept || '') === currentUser?.dept || !m.dept;
    if (role === 'manager') return !m.dept || codes.includes(m.dept);
    return true;
  }), [getMediaLibrary, role, currentUser, codes]);

  const total = scoped.filter(m => m.status !== 'trash').length;
  const trashCount = scoped.filter(m => m.status === 'trash').length;
  const bytes = scoped.reduce((s, m) => s + (Number(m.bytes) || 0), 0);
  const emailCount = scoped.filter(m => m.category === 'Email Attachments').length;

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = scoped.filter(m => {
      if (cat === 'Trash') return m.status === 'trash';
      if (m.status === 'trash') return false;
      if (cat !== 'all' && (m.category || m.file_type) !== cat) return false;
      if (q && ![m.file_name, m.related_id, m.dept, m.uploaded_by, (m.tags || []).join(' ')].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    list = list.slice().sort((a, b) => {
      if (sort === 'oldest') return new Date(a.uploaded_at || 0) - new Date(b.uploaded_at || 0);
      if (sort === 'size') return (Number(b.bytes) || 0) - (Number(a.bytes) || 0);
      if (sort === 'name') return String(a.file_name || '').localeCompare(String(b.file_name || ''));
      if (sort === 'dept') return String(a.dept || '').localeCompare(String(b.dept || ''));
      return new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0);
    });
    return list;
  }, [scoped, search, cat, sort]);

  const persist = (next) => writeSyncKey('ap_media_library', next, currentUser?.loginId);
  const updateItem = (id, patch) => persist((getMediaLibrary() || []).map(m => m.id === id ? { ...m, ...patch, updated_at: new Date().toISOString() } : m));

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      const added = [];
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) { showToast(`${file.name} too large (max 20 MB)`); continue; }
        const dataUrl = await readFileAsDataUrl(file);
        const res = await apiFetch('/api/media/upload-base64', { method: 'POST', body: JSON.stringify({ data: dataUrl, filename: file.name, folder: 'auditpro' }) });
        const it = res.item || {};
        added.push({
          id: it.id || `media_${Date.now()}_${added.length}`, file_name: file.name, secure_url: it.url, public_id: it.id,
          file_type: it.mediaType || it.resourceType || 'document', resource_type: it.resourceType || 'image', format: it.format || '',
          bytes: it.size || file.size, module: 'media', category: /image/i.test(it.resourceType || '') ? 'Images' : 'Documents',
          related_id: '', dept: currentUser?.dept || '', tags: [], status: 'active',
          uploaded_by: currentUser?.loginId || 'user', uploaded_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          activity_log: [{ action: 'uploaded', by: currentUser?.loginId || 'user', at: new Date().toISOString(), note: file.name }], versions: [],
        });
      }
      if (added.length) { persist([...added, ...(getMediaLibrary() || [])]); showToast(`${added.length} file(s) uploaded`); }
    } catch (err) { showToast(err.message || 'Upload failed'); }
    finally { setUploading(false); }
  };

  const trashItem = (m) => updateItem(m.id, { status: 'trash' });
  const restoreItem = (m) => updateItem(m.id, { status: 'active' });
  const deleteForever = async (m) => {
    try { if (m.public_id) await apiFetch(`/api/media/${encodeURIComponent(m.public_id)}?resource_type=${encodeURIComponent(m.resource_type || 'image')}`, { method: 'DELETE' }); } catch (err) { showToast(err.message || 'Cloud delete failed'); }
    persist((getMediaLibrary() || []).filter(x => x.id !== m.id)); showToast('Deleted permanently');
  };
  const saveEdit = () => {
    updateItem(editItem.id, { file_name: editItem.file_name, category: editItem.category, dept: editItem.dept, related_id: editItem.related_id, tags: String(editItem.tags || '').split(',').map(t => t.trim()).filter(Boolean) });
    setEditItem(null); showToast('Media updated');
  };

  const canEdit = role === 'admin' || role === 'auditor' || role === 'spoc';

  const Actions = ({ m }) => m.status === 'trash' ? (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => setPreview(m)}>Preview</button>
      {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => restoreItem(m)}>Restore</button>}
      {canEdit && <button className="btn btn-danger btn-sm" onClick={() => deleteForever(m)}>Delete Forever</button>}
    </>
  ) : (
    <>
      <button className="btn btn-ghost btn-sm" onClick={() => setPreview(m)}>Preview</button>
      <a className="btn btn-ghost btn-sm" href={mediaUrl(m)} target="_blank" rel="noopener noreferrer">Open</a>
      <a className="btn btn-ghost btn-sm" href={mediaUrl(m)} download={m.file_name || 'file'}>Download</a>
      {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setEditItem({ ...m, tags: (m.tags || []).join(', ') })}>Edit</button>}
      {canEdit && <button className="btn btn-danger btn-sm" onClick={() => trashItem(m)}>Trash</button>}
    </>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat-card"><div className="stat-label">Total Media Files</div><div className="stat-value">{total}</div></div>
        <div className="stat-card"><div className="stat-label">Storage Usage</div><div className="stat-value" style={{ fontSize: 18 }}>{mediaSize(bytes)}</div></div>
        <div className="stat-card"><div className="stat-label">Email Attachments</div><div className="stat-value">{emailCount}</div></div>
        <div className="stat-card"><div className="stat-label">Trash</div><div className="stat-value" style={{ color: 'var(--amber)' }}>{trashCount}</div></div>
      </div>

      <Card
        title="Cloudinary Media Library"
        action={<div className="flex gap-2 items-center"><button className="btn btn-ghost btn-sm" onClick={checkCloudinary} disabled={checkingCloudinary}>{checkingCloudinary ? 'Checking…' : 'Check Cloudinary'}</button><button className="btn btn-brand btn-sm" onClick={() => document.getElementById('media-upload').click()} disabled={uploading}>{uploading ? 'Uploading...' : 'Upload Files'}</button><Badge type="b-blue">{total} files</Badge></div>}
      >
        <div className="upload-area mb-2" style={{ padding: 14 }} onClick={() => !uploading && document.getElementById('media-upload').click()}>
          <div className="text-xs font-bold">Drop files here or click to upload</div>
          <div className="text-[10px] mt-1" style={{ color: 'var(--text3)' }}>Images, PDFs, videos, Excel and documents</div>
        </div>
        <input type="file" id="media-upload" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,video/*" style={{ display: 'none' }} onChange={handleUpload} disabled={uploading} />
        <div className="flex gap-2 flex-wrap items-center">
          <input placeholder="Search file, audit ID, NC, dept, uploader, tag..." value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 260, maxWidth: 320 }} />
          <select value={cat} onChange={e => setCat(e.target.value)}>{CATS.map(c => <option key={c} value={c}>{c === 'all' ? 'All Files' : c}</option>)}</select>
          <select value={sort} onChange={e => setSort(e.target.value)}><option value="latest">Latest Upload</option><option value="oldest">Oldest Upload</option><option value="size">File Size</option><option value="name">File Name</option><option value="dept">Department</option></select>
          <button className={`btn btn-sm ${view === 'grid' ? 'btn-brand' : 'btn-ghost'}`} onClick={() => setView('grid')}>Grid</button>
          <button className={`btn btn-sm ${view !== 'grid' ? 'btn-brand' : 'btn-ghost'}`} onClick={() => setView('list')}>List</button>
        </div>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <div className="text-[11px] py-4 text-center" style={{ color: 'var(--text3)' }}>No files uploaded yet</div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {rows.map(m => (
              <div key={m.id} className="finding-card" style={{ minHeight: 190 }}>
                <div className="flex justify-between items-center mb-2"><Badge type={m.status === 'trash' ? 'b-amber' : 'b-blue'}>{m.category || 'File'}</Badge></div>
                <div onClick={() => setPreview(m)} style={{ height: 92, borderRadius: 7, background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer' }}>
                  {isImage(m) ? <img src={mediaUrl(m)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="file" className="w-8 h-8 opacity-40" />}
                </div>
                <div className="text-[11px] font-bold mt-2 truncate" title={m.file_name}>{(m.file_name || 'File').substring(0, 42)}</div>
                <div className="text-[10px]" style={{ color: 'var(--text3)' }}>{m.dept || 'All Dept'} · {mediaSize(m.bytes)}</div>
                <div className="flex gap-1 flex-wrap mt-2"><Actions m={m} /></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Preview</th><th>File</th><th>Category</th><th>Tags</th><th>Dept</th><th>Related</th><th>Uploaded By</th><th>Size</th><th>Date</th><th>Action</th></tr></thead>
              <tbody>
                {rows.map(m => (
                  <tr key={m.id}>
                    <td>
                      <div onClick={() => setPreview(m)} style={{ width: 40, height: 34, borderRadius: 5, background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer' }}>
                        {isImage(m) ? <img src={mediaUrl(m)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="file" className="w-4 h-4 opacity-40" />}
                      </div>
                    </td>
                    <td className="font-bold" style={{ maxWidth: 220 }}>{m.file_name || 'File'}</td>
                    <td><Badge type={m.status === 'trash' ? 'b-amber' : 'b-blue'}>{m.status === 'trash' ? 'Trash' : (m.category || m.file_type || 'File')}</Badge></td>
                    <td>{(m.tags || []).slice(0, 3).map((t, i) => <Badge key={i} type="b-gray">{t}</Badge>) }{(m.tags || []).length === 0 ? '-' : null}</td>
                    <td>{m.dept || '-'}</td>
                    <td>{m.related_id || '-'}</td>
                    <td>{m.uploaded_by || '-'}</td>
                    <td>{mediaSize(m.bytes)}</td>
                    <td>{m.uploaded_at ? new Date(m.uploaded_at).toLocaleString() : '-'}</td>
                    <td><div className="flex gap-1 flex-wrap"><Actions m={m} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Preview modal */}
      {preview && (
        <div className="modal-bg" onClick={() => setPreview(null)}>
          <div className="modal-box wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span>{preview.file_name || 'Media Preview'}</span><button className="btn btn-ghost btn-icon btn-sm" onClick={() => setPreview(null)}><Icon name="x" /></button></div>
            {isImage(preview) ? (
              <div style={{ textAlign: 'center' }}><img src={mediaUrl(preview)} alt="" style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }} /></div>
            ) : preview.file_type === 'pdf' || /\.pdf(\?|#|$)/i.test(mediaUrl(preview)) ? (
              <iframe title="preview" src={mediaUrl(preview)} style={{ width: '100%', height: '60vh', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }} />
            ) : preview.file_type === 'video' || /\.(mp4|mov|webm)(\?|#|$)/i.test(mediaUrl(preview)) ? (
              <video controls style={{ width: '100%', maxHeight: '60vh', borderRadius: 8, background: '#000' }}><source src={mediaUrl(preview)} /></video>
            ) : (
              <div className="info-box">Document preview is not available in browser for this file type. Use Open or Download.</div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <div className="card-heading"><span className="dot w-[7px] h-[7px] rounded-full bg-[var(--brand)] flex-shrink-0" />Details</div>
                <div className="text-[11px]" style={{ lineHeight: 2 }}>
                  <div><b>Category:</b> {preview.category || '-'}</div><div><b>Department:</b> {preview.dept || '-'}</div>
                  <div><b>Related:</b> {preview.related_id || '-'}</div><div><b>Uploaded:</b> {preview.uploaded_at ? new Date(preview.uploaded_at).toLocaleString() : '-'}</div>
                  <div><b>Size:</b> {mediaSize(preview.bytes)}</div><div><b>Tags:</b> {(preview.tags || []).join(', ') || '-'}</div>
                </div>
              </div>
              <div>
                <div className="card-heading"><span className="dot w-[7px] h-[7px] rounded-full bg-[var(--teal)] flex-shrink-0" />Activity Log</div>
                <div style={{ maxHeight: 150, overflow: 'auto' }}>
                  {(preview.activity_log || []).slice(0, 8).map((l, i) => (
                    <div key={i} className="text-[11px]" style={{ borderBottom: '1px solid var(--bg3)', padding: '4px 0', color: 'var(--text3)' }}><b>{sanitize(l.action)}</b> by {sanitize(l.by || '-')}<br />{l.at ? new Date(l.at).toLocaleString() : ''}</div>
                  )) }{(preview.activity_log || []).length === 0 ? <div className="text-[11px]" style={{ color: 'var(--text3)' }}>No activity yet</div> : null}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-3"><a className="btn btn-brand btn-sm" href={mediaUrl(preview)} target="_blank" rel="noopener noreferrer">Open</a><a className="btn btn-ghost btn-sm" href={mediaUrl(preview)} download={preview.file_name || 'file'}>Download</a></div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editItem && (
        <div className="modal-bg" onClick={() => setEditItem(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span>Edit Media</span><button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditItem(null)}><Icon name="x" /></button></div>
            <div className="flex flex-col gap-2">
              <div><label className="form-label">File Name</label><input value={editItem.file_name || ''} onChange={e => setEditItem(p => ({ ...p, file_name: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="form-label">Category</label><select value={editItem.category || ''} onChange={e => setEditItem(p => ({ ...p, category: e.target.value }))}>{EDIT_CATS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                <div><label className="form-label">Department</label><select value={editItem.dept || ''} onChange={e => setEditItem(p => ({ ...p, dept: e.target.value }))}><option value="">All</option>{depts.map(d => <option key={d.code} value={d.code}>{d.name}</option>)}</select></div>
              </div>
              <div><label className="form-label">Linked Audit/NC</label><input value={editItem.related_id || ''} onChange={e => setEditItem(p => ({ ...p, related_id: e.target.value }))} /></div>
              <div><label className="form-label">Tags</label><input value={editItem.tags || ''} onChange={e => setEditItem(p => ({ ...p, tags: e.target.value }))} placeholder="Critical NC, CAPA, Approved" /></div>
              <div className="flex gap-2"><button className="btn btn-brand flex-1" onClick={saveEdit}>Save Changes</button><button className="btn btn-ghost flex-1" onClick={() => setEditItem(null)}>Cancel</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
