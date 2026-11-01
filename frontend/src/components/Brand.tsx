type BrandProps = { light?: boolean; compact?: boolean };

export function BrandIcon({ large = false }: { large?: boolean }) {
  return <svg className={`brand-mark${large ? ' brand-mark-large' : ''}`} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <path fill="#8ac9f5" d="M4 10a4 4 0 0 1 4-4h9l4 4h11a4 4 0 0 1 4 4v15a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/>
    <path fill="#386cb2" d="M5 16a4 4 0 0 1 4-4h22a4 4 0 0 1 4 4l-2 14a5 5 0 0 1-5 4H10a5 5 0 0 1-5-4z"/>
    <path fill="#ffad9d" d="M17 18h6a3 3 0 0 1 0 6h-6a3 3 0 0 1 0-6z"/>
  </svg>;
}

export function Brand({ light = false, compact = false }: BrandProps) {
  return <a className={`brand${light ? ' brand-light' : ''}`} href="/" aria-label="ProFiles, inicio">
    <BrandIcon />
    {!compact && <span className="brand-name">ProFiles</span>}
  </a>;
}
