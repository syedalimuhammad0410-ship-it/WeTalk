export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="url(#ws-g)" />
      <path d="M8.5 11.5 11.6 21l3.1-7.2 3.1 7.2 3.1-9.5" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="23.5" cy="9.5" r="2.2" fill="white" />
      <defs>
        <linearGradient id="ws-g" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#6366F1" />
          <stop offset="1" stopColor="#4338CA" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <Logo />
      <span className="text-[15px] font-semibold tracking-tight">
        WebScout <span className="text-accent">AI</span>
      </span>
    </span>
  );
}
