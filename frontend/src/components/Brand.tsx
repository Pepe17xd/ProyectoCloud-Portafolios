type BrandProps = { light?: boolean; compact?: boolean };

export function BrandIcon({ large = false }: { large?: boolean }) {
  return <svg className={`brand-mark${large ? ' brand-mark-large' : ''}`} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <path d="M4.5 11.5a2 2 0 0 1 2-2h10l3 3h13a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2h-26a2 2 0 0 1-2-2z" fill="currentColor" opacity=".16"/>
    <path d="M4.5 14.5a2 2 0 0 1 2-2h9.2l3 3h13.8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-26a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
    <path d="M11 21h9m-9 4h15m-15 4h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".82"/>
    <path d="m27 20 2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
}

export function Brand({ light = false, compact = false }: BrandProps) {
  return <a className={`brand${light ? ' brand-light' : ''}`} href="/" aria-label="ProFiles, inicio">
    <BrandIcon />
    {!compact && <span className="brand-name">ProFiles</span>}
  </a>;
}
