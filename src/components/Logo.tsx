import Link from "next/link";

export function Logo({ href = "/", compact }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="group flex items-center gap-2.5" aria-label="TRACE home">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
        <circle cx="16" cy="16" r="9" fill="none" stroke="#59d4e8" strokeWidth="1.6" />
        <circle cx="16" cy="16" r="2.6" fill="#ff7a45" />
        <path d="M16 2v7M16 23v7M2 16h7M23 16h7" stroke="#59d4e8" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-[0.32em]">TRACE</span>
          <span className="label-mono mt-1 !text-[8.5px] text-mute">Turn images into evidence</span>
        </span>
      )}
    </Link>
  );
}
