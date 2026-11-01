type BrandProps = { light?: boolean; compact?: boolean; mascotSrc?: string };
type BrandIconProps = { large?: boolean; mascotSrc?: string };
type FoliMascotProps = { variant?: 'avatar' | 'illustration'; className?: string; alt?: string };
const BRAND_MARK_SRC = '/brand/profiles-brand-mark.png';
const FOLI_AVATAR_SRC = '/brand/profiles-foli-avatar.png';
const FOLI_ILLUSTRATION_SRC = '/brand/profiles-foli.png';

/** Original folder mark with an optional, explicitly supplied mascot slot.
 * No mascot asset is bundled by default; only use a reviewed, redistributable image.
 */
export function BrandIcon({ large = false, mascotSrc }: BrandIconProps) {
  return <span className={`brand-symbol${large ? ' brand-symbol-large' : ''}`} data-mascot-slot={mascotSrc ? 'custom' : 'integrated'} aria-hidden="true">
    <svg className={`brand-mark brand-mark-fallback${large ? ' brand-mark-large' : ''}`} viewBox="0 0 40 40" focusable="false">
      <path className="brand-folder-back" d="M4 10a4 4 0 0 1 4-4h9l4 4h11a4 4 0 0 1 4 4v15a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/>
      <path className="brand-folder-front" d="M5 16a4 4 0 0 1 4-4h22a4 4 0 0 1 4 4l-2 14a5 5 0 0 1-5 4H10a5 5 0 0 1-5-4z"/>
      <path className="brand-folder-accent" d="M17 18h6a3 3 0 0 1 0 6h-6a3 3 0 0 1 0-6z"/>
    </svg>
    {!mascotSrc && <img className="brand-mark-image" src={BRAND_MARK_SRC} alt="" aria-hidden="true" onError={event => { event.currentTarget.hidden = true; }}/>}
    {mascotSrc && <img className="brand-mascot-image" src={mascotSrc} alt="" aria-hidden="true" onError={event => { event.currentTarget.hidden = true; }}/>}
  </span>;
}

export function Brand({ light = false, compact = false, mascotSrc }: BrandProps) {
  return <a className={`brand${light ? ' brand-light' : ''}`} href="/" aria-label="ProFiles, inicio">
    <BrandIcon mascotSrc={mascotSrc}/>
    {!compact && <span className="brand-name">ProFiles</span>}
  </a>;
}

export function FoliMascot({ variant = 'avatar', className = '', alt = 'Foli, mascota de ProFiles' }: FoliMascotProps) {
  const src = variant === 'illustration' ? FOLI_ILLUSTRATION_SRC : FOLI_AVATAR_SRC;
  return <img className={`profiles-foli ${className}`.trim()} src={src} alt={alt} loading="lazy" decoding="async" onError={event => { event.currentTarget.hidden = true; }}/>;
}
