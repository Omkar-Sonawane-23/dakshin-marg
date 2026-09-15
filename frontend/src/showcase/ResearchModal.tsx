import { useEffect, type MouseEvent } from 'react';
import Icon from './Icon';

/**
 * The research report PDF shipped with the site.
 * File lives at `frontend/public/research/SIH_26059_Antarctic_Navigation_DSS_Research_Report.pdf`
 * and is served from `/research/…`. Every "View our research" button on the
 * showcase opens this modal (deep-linkable via the `#research` hash).
 */
export const RESEARCH_PDF_URL = '/research/SIH_26059_Antarctic_Navigation_DSS_Research_Report.pdf';
export const RESEARCH_HASH = '#research';

export default function ResearchModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div
      className="research-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Research report viewer"
      onClick={closeOnBackdrop}
    >
      <div className="research-modal-card">
        <div className="research-modal-head">
          <div>
            <span>SIH 26059 / RESEARCH REPORT</span>
            <h3>Antarctic Navigation DSS — Research Report</h3>
          </div>
          <div className="research-modal-actions">
            <a
              className="button button-secondary button-sm"
              href={RESEARCH_PDF_URL}
              download="SIH_26059_Antarctic_Navigation_DSS_Research_Report.pdf"
            >
              <span>Download</span>
            </a>
            <a
              className="button button-secondary button-sm"
              href={RESEARCH_PDF_URL}
              target="_blank"
              rel="noreferrer"
            >
              <span>Open in new tab</span>
            </a>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close research report">
              <Icon name="close" size={19} />
            </button>
          </div>
        </div>
        <div className="research-viewer">
          <iframe src={RESEARCH_PDF_URL} title="SIH 26059 Antarctic Navigation DSS research report" loading="lazy" />
        </div>
        <p className="research-fallback">
          If the report does not display above,{' '}
          <a href={RESEARCH_PDF_URL} target="_blank" rel="noreferrer">open the PDF directly</a>{' '}
          or use the download button.
        </p>
      </div>
    </div>
  );
}
