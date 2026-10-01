import { useId } from 'react';
import { APP_NAME } from '../../shared/curriculum.ts';

/** Mathly mark: a stylised "M" that doubles as a rising graph, with a spark of insight. */
export function LogoMark({ size = 36 }: { size?: number }) {
  // Unique gradient id: a shared id breaks when the first copy lives in a display:none subtree.
  const gid = `lm-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent-2)" /></linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${gid})`} />
      <path d="M15 45V21l10.5 13.5L36 21v24" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M41 45l8-11" stroke="#fff" strokeOpacity=".9" strokeWidth="5" strokeLinecap="round" />
      <circle cx="49" cy="20" r="4.5" fill="#fde68a" />
    </svg>
  );
}

export function Logo({ size = 36, showText = true }: { size?: number; showText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      {showText && <span className="font-display text-xl font-extrabold tracking-tight">{APP_NAME}</span>}
    </span>
  );
}
