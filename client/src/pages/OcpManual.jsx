import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Icon } from '../components/UI';
import { showToast } from '../utils/helpers';

const OCP_PDF_SRC = '/assets/OCP_Manual_v4.3_Complete.pdf';
const CHAPTERS = [
  '1. Quality Management System (QMS)',
  '2. Leadership & Commitment',
  '3. Planning for QMS',
  '4. Support & Resource Management',
  '5. Operation & Product Realization',
  '6. Performance Evaluation',
  '7. Non-conformance & Corrective Actions §10.2',
];

export default function OcpManual() {
  const { setPageAction } = useApp();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const pdfRef = useRef(null);
  const renderingRef = useRef(false);
  const pendingRef = useRef(false);

  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.1);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const renderPage = (p, s) => {
    if (!pdfRef.current) return;
    if (renderingRef.current) { pendingRef.current = true; return; }
    renderingRef.current = true;
    pdfRef.current.getPage(p).then(pageObj => {
      const canvas = canvasRef.current;
      if (!canvas) { renderingRef.current = false; return; }
      const ctx = canvas.getContext('2d');
      const viewport = pageObj.getViewport({ scale: s });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      return pageObj.render({ canvasContext: ctx, viewport }).promise;
    }).then(() => {
      renderingRef.current = false;
      if (pendingRef.current) { pendingRef.current = false; renderPage(page, scale); }
    }).catch(err => {
      renderingRef.current = false;
      showToast('OCP page render failed: ' + (err.message || err), 5000);
    });
  };

  useEffect(() => {
    if (!window.pdfjsLib) { setError('PDF viewer library is still loading. Refresh once if it does not appear.'); setLoading(false); return; }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    window.pdfjsLib.getDocument(OCP_PDF_SRC).promise.then(pdf => {
      pdfRef.current = pdf;
      setNumPages(pdf.numPages);
      setLoading(false);
      return pdf.getPage(1).then(pageObj => {
        const wrap = wrapRef.current;
        const base = pageObj.getViewport({ scale: 1 });
        const fit = Math.max(0.5, Math.min(2.4, ((wrap?.clientWidth || 900) - 36) / base.width));
        setScale(fit);
        renderPage(1, fit);
      });
    }).catch(err => {
      setError('Unable to load OCP PDF: ' + (err.message || err));
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pdfRef.current) renderPage(page, scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, scale]);

  const prevPage = () => setPage(p => Math.max(1, p - 1));
  const nextPage = () => setPage(p => Math.min(numPages || p, p + 1));
  const zoom = (delta) => setScale(s => Math.max(0.5, Math.min(2.4, s + delta)));
  const fitWidth = () => {
    if (!pdfRef.current) return;
    pdfRef.current.getPage(page).then(pageObj => {
      const wrap = wrapRef.current;
      const base = pageObj.getViewport({ scale: 1 });
      setScale(Math.max(0.5, Math.min(2.4, ((wrap?.clientWidth || 900) - 36) / base.width)));
    });
  };

  const fitWidthRef = useRef(fitWidth);
  fitWidthRef.current = fitWidth;
  useEffect(() => {
    setPageAction(() => () => fitWidthRef.current());
    return () => setPageAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jumpToChapter = (idx) => {
    if (!numPages) return;
    const target = Math.max(1, Math.min(numPages, Math.round(1 + idx * (numPages - 1) / CHAPTERS.length)));
    setPage(target);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="md:col-span-1 space-y-3">
        <Card title="OCP Manual Chapters">
          <div className="space-y-2">
            {CHAPTERS.map((ch, idx) => (
              <div
                key={idx}
                className="p-2 rounded-lg border text-xs cursor-pointer hover:bg-[var(--bg3)]"
                style={{ borderColor: 'var(--border)' }}
                onClick={() => jumpToChapter(idx)}
              >
                {ch}
              </div>
            ))}
          </div>
        </Card>
        <a href={OCP_PDF_SRC} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm w-full">
          <Icon name="external-link" /> Open PDF in New Tab
        </a>
      </div>

      <div className="md:col-span-2">
        {error ? (
          <Card title="Document Viewer">
            <div className="info-box" style={{ color: 'var(--red)' }}>{error}</div>
          </Card>
        ) : loading ? (
          <Card title="Document Viewer">
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <Icon name="book-open" className="w-12 h-12 mb-3 opacity-30" />
              <div className="text-xs" style={{ color: 'var(--text3)' }}>Loading OCP Manual…</div>
            </div>
          </Card>
        ) : (
          <div className="ocp-viewer">
            <div className="ocp-toolbar">
              <div className="flex gap-2 items-center">
                <button className="btn btn-ghost btn-sm" onClick={prevPage} disabled={page <= 1}>Previous</button>
                <button className="btn btn-ghost btn-sm" onClick={nextPage} disabled={page >= numPages}>Next</button>
                <span className="text-[11px]" style={{ color: 'var(--text3)' }}>Page {page} of {numPages} · {Math.round(scale * 100)}%</span>
              </div>
              <div className="flex gap-2 items-center">
                <button className="btn btn-ghost btn-sm" onClick={() => zoom(-0.15)}>-</button>
                <button className="btn btn-ghost btn-sm" onClick={() => zoom(0.15)}>+</button>
                <button className="btn btn-brand btn-sm" onClick={fitWidth}>Fit Width</button>
              </div>
            </div>
            <div className="ocp-canvas-wrap" ref={wrapRef}>
              <canvas ref={canvasRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
