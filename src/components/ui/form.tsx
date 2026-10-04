"use client";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

export function Field({ label, hint, error, children, className, htmlFor, required }: { label?: React.ReactNode; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string; htmlFor?: string; required?: boolean }) {
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
          {required && <span className="sr-only"> (required)</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1 text-xs text-danger" role="alert" id={htmlFor ? `${htmlFor}-error` : undefined}>
          {error}
        </p>
      ) : hint ? (
        <p className="hint" id={htmlFor ? `${htmlFor}-hint` : undefined}>{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cn("input", invalid && "border-danger focus:border-danger focus:ring-danger/20", className)} aria-invalid={invalid || undefined} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} className={cn("input min-h-[90px] resize-y leading-relaxed", invalid && "border-danger", className)} aria-invalid={invalid || undefined} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn("input appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
});

export function Switch({ checked, onChange, label, description, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; description?: React.ReactNode; disabled?: boolean; id?: string }) {
  const auto = useId();
  const sid = id ?? auto;
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={sid} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      <button
        id={sid}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", checked ? "bg-accent" : "bg-border")}
      >
        <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

export function Checkbox({ checked, onChange, label, className, indeterminate, ...rest }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; className?: string; indeterminate?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "checked">) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm", className)}>
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer rounded border-border accent-[rgb(var(--accent))]"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = Boolean(indeterminate);
        }}
        onChange={(e) => onChange(e.target.checked)}
        {...rest}
      />
      {label}
    </label>
  );
}
