import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft' | 'success';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white shadow-[0_8px_20px_-8px_var(--accent)] hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface border border-border text-text hover:bg-surface-2',
  ghost: 'text-text hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-110',
  soft: 'bg-accent-soft text-accent hover:brightness-105',
  success: 'bg-success text-white hover:brightness-110',
};
const SIZES = { sm: 'h-9 px-3 text-sm rounded-xl gap-1.5', md: 'h-11 px-4 text-[0.95rem] rounded-2xl gap-2', lg: 'h-13 px-6 text-base rounded-2xl gap-2.5 min-h-[3.25rem]', icon: 'h-10 w-10 rounded-xl justify-center' };

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZES; loading?: boolean; icon?: ReactNode }>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) => (
    <button ref={ref} disabled={disabled || loading} className={cx('inline-flex items-center justify-center font-semibold transition-all duration-150 select-none disabled:opacity-50 active:scale-[0.98]', VARIANTS[variant], SIZES[size], className)} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export function Card({ className, children, as: As = 'div', ...rest }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' } & Record<string, unknown>) {
  return <As className={cx('card', className)} {...rest}>{children}</As>;
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger'; className?: string }) {
  const t = { neutral: 'bg-surface-2 text-muted', accent: 'bg-accent-soft text-accent', success: 'bg-success-soft text-success', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-danger' }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', t, className)}>{children}</span>;
}

export function Progress({ value, className, tone = 'accent', label }: { value: number; className?: string; tone?: 'accent' | 'success' | 'warn'; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cx('h-2.5 w-full overflow-hidden rounded-full bg-surface-2', className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <motion.div className={cx('h-full rounded-full', tone === 'accent' ? 'bg-brand' : tone === 'success' ? 'bg-success' : 'bg-warn')} initial={{ width: 0 }} animate={{ width: `${v}%` }} transition={{ type: 'spring', stiffness: 80, damping: 18 }} />
    </div>
  );
}

export function Ring({ value, size = 64, stroke = 7, children, color = 'var(--accent)', label }: { value: number; size?: number; stroke?: number; children?: ReactNode; color?: string; label?: string }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r; const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={label ?? `${Math.round(v)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c - (v / 100) * c }} transition={{ duration: 0.9, ease: 'easeOut' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <div role="status" className={cx('flex items-center justify-center p-8 text-muted', className)}><Loader2 className="h-6 w-6 animate-spin" aria-hidden /><span className="sr-only">{label}</span></div>;
}
export function Skeleton({ className }: { className?: string }) { return <div className={cx('skeleton', className)} aria-hidden />; }
export function PageSkeleton() {
  return <div className="space-y-4 p-1" aria-busy><Skeleton className="h-10 w-1/3" /><Skeleton className="h-36 w-full" /><div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center" role="alert">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-warn-soft text-warn"><AlertTriangle className="h-6 w-6" /></div>
      <p className="max-w-md text-muted">{message}</p>
      {onRetry && <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={onRetry}>Try again</Button>}
    </Card>
  );
}
export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-border p-10 text-center">
      <div className="text-4xl" aria-hidden>{icon}</div>
      <h3 className="text-lg font-bold">{title}</h3>
      {body && <p className="max-w-md text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="flex items-center gap-3 text-2xl font-extrabold sm:text-3xl">{icon}{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }>(({ label, hint, error, className, id, ...rest }, ref) => {
  const gen = useId(); const iid = id ?? gen;
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={iid} className="block text-sm font-semibold">{label}</label>}
      <input ref={ref} id={iid} aria-invalid={!!error} aria-describedby={hint || error ? `${iid}-d` : undefined} className={cx('h-12 w-full rounded-2xl border bg-surface px-4 text-[1rem] outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-4 focus:ring-accent/15', error ? 'border-danger' : 'border-border', className)} {...rest} />
      {(hint || error) && <p id={`${iid}-d`} className={cx('text-xs', error ? 'text-danger' : 'text-muted')}>{error ?? hint}</p>}
    </div>
  );
});
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string }>(({ label, hint, className, id, ...rest }, ref) => {
  const gen = useId(); const iid = id ?? gen;
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={iid} className="block text-sm font-semibold">{label}</label>}
      <textarea ref={ref} id={iid} className={cx('min-h-28 w-full rounded-2xl border border-border bg-surface px-4 py-3 outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-4 focus:ring-accent/15', className)} {...rest} />
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
});
Textarea.displayName = 'Textarea';

export function Select({ label, value, onChange, options, id }: { label?: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; id?: string }) {
  const gen = useId(); const iid = id ?? gen;
  return (
    <div className="space-y-1.5">
      {label && <label htmlFor={iid} className="block text-sm font-semibold">{label}</label>}
      <select id={iid} value={value} onChange={(e) => onChange(e.target.value)} className="h-12 w-full appearance-none rounded-2xl border border-border bg-surface px-4 outline-none focus:border-accent focus:ring-4 focus:ring-accent/15">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function Chip({ selected, onClick, children, className }: { selected?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={cx('rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-all active:scale-[0.97]', selected ? 'border-accent bg-accent-soft text-accent shadow-[0_0_0_3px_var(--accent-soft)]' : 'border-border bg-surface hover:border-accent/50', className)}>{children}</button>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div><label htmlFor={id} className="font-semibold">{label}</label>{description && <p className="text-sm text-muted">{description}</p>}</div>
      <button id={id} role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-border')}>
        <span className={cx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-6' : 'left-1')} />
      </button>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="scrollbar-thin flex gap-1 overflow-x-auto rounded-2xl bg-surface-2 p-1">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={cx('relative whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold transition', value === t.id ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text')}>{t.label}</button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,button,textarea,select,[tabindex]')?.focus(), 30);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={cx('card max-h-[92vh] w-full overflow-y-auto rounded-b-none p-6 sm:rounded-[var(--radius)]', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
            <div className="mb-4 flex items-start justify-between gap-4">
              {title && <h2 className="text-xl font-bold">{title}</h2>}
              <button onClick={onClose} className="-m-1 rounded-xl p-2 text-muted hover:bg-surface-2" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Stat({ label, value, icon, sub }: { label: string; value: ReactNode; icon?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      {icon && <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-xl text-accent">{icon}</div>}
      <div className="min-w-0"><div className="truncate text-xs font-semibold uppercase tracking-wide text-muted">{label}</div><div className="truncate text-xl font-extrabold">{value}</div>{sub && <div className="text-xs text-muted">{sub}</div>}</div>
    </div>
  );
}

/** Lightweight safe markdown: **bold**, line breaks, bullets. No HTML injection. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n');
  return (
    <div className={cx('space-y-1.5 leading-relaxed', className)}>
      {lines.map((ln, i) => {
        if (!ln.trim()) return <div key={i} className="h-1.5" />;
        const bullet = /^\s*[•\-*]\s+/.test(ln);
        const content = ln.replace(/^\s*[•\-*]\s+/, '');
        const parts = content.split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>));
        return bullet ? <div key={i} className="flex gap-2"><span className="text-accent">•</span><span className="math">{parts}</span></div> : <p key={i} className="math">{parts}</p>;
      })}
    </div>
  );
}
