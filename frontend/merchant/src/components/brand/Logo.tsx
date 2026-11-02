interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'inverse' | 'mono';
  className?: string;
}

const SIZES = { sm: 16, md: 20, lg: 24, xl: 32 };

/**
 * The CPSE mark — the customer app's leaf and wordmark
 * (frontend/customer/src/components/AppShell.jsx) — with "for shops", so the
 * two apps read as one product and a shopkeeper can still tell which side they
 * are on.
 */
export default function Logo({ size = 'md', variant = 'default', className = '' }: LogoProps) {
  const px = SIZES[size];
  const ink = variant === 'inverse' ? '#ffffff' : variant === 'mono' ? 'currentColor' : 'var(--green-700)';
  const mark = variant === 'inverse' ? '#ffffff' : variant === 'mono' ? 'currentColor' : 'var(--green-600)';
  const sub = variant === 'inverse' ? 'rgba(255, 255, 255, 0.8)' : variant === 'mono' ? 'currentColor' : 'var(--ink-500)';

  return (
    <span
      className={`brand ${className}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: px * 0.35, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.01em' }}
      aria-label="CPSE for shops"
    >
      <svg width={px * 1.2} height={px * 1.2} viewBox="0 0 24 24" fill="none" stroke={mark} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 4c0 8-5.5 13-13 13" />
        <path d="M7 17c0-6 5-10 13-13" />
        <path d="M4 20c1-2 2-3 3-3" />
      </svg>
      <span style={{ color: ink, fontSize: px }}>CPSE</span>
      <span style={{ color: sub, fontSize: px * 0.6, fontWeight: 500, alignSelf: 'flex-end', paddingBottom: px * 0.08 }}>for shops</span>
    </span>
  );
}
