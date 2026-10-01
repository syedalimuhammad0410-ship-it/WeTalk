import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Search } from 'lucide-react';
import { get } from '../lib/api.ts';
import { Badge, Modal } from './ui.tsx';

interface Result { type: string; id: string; title: string; subtitle: string; link: string }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQ(''); setResults([]); setTimeout(() => inputRef.current?.focus(), 50); } }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const ctrl = new AbortController(); setLoading(true);
    const t = setTimeout(() => get<{ results: Result[] }>(`/me/search?q=${encodeURIComponent(q)}`, ctrl.signal).then((r) => { setResults(r.results); setActive(0); }).catch(() => {}).finally(() => setLoading(false)), 160);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const go = (r: Result) => { onClose(); if (r.link.startsWith('http')) window.open(r.link, '_blank', 'noopener,noreferrer'); else nav(r.link); };
  return (
    <Modal open={open} onClose={onClose} title="Search" wide>
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 focus-within:border-accent">
        <Search className="h-5 w-5 text-muted" />
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try “quadratic”, “fractions”, “mortgage”…" aria-label="Search" className="h-12 flex-1 bg-transparent outline-none"
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); } if (e.key === 'Enter' && results[active]) go(results[active]); }} />
      </div>
      <ul className="mt-3 max-h-[55vh] space-y-1 overflow-y-auto" role="listbox" aria-label="Search results">
        {loading && !results.length && <li className="p-4 text-sm text-muted">Searching…</li>}
        {!loading && q.length >= 2 && !results.length && <li className="p-4 text-sm text-muted">No results. Try <button className="font-semibold text-accent" onClick={() => { onClose(); nav(`/learn-anything?topic=${encodeURIComponent(q)}`); }}>building a learning path for “{q}”</button>.</li>}
        {results.map((r, i) => (
          <li key={`${r.type}-${r.id}`} role="option" aria-selected={i === active}>
            <button onClick={() => go(r)} onMouseEnter={() => setActive(i)} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left ${i === active ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}>
              <Badge tone={r.type === 'Resource' ? 'warn' : r.type.includes('course') || r.type === 'Course' ? 'success' : 'accent'}>{r.type}</Badge>
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{r.title}</span><span className="block truncate text-xs text-muted">{r.subtitle}</span></span>
              {r.link.startsWith('http') && <ExternalLink className="h-4 w-4 text-muted" aria-label="External link" />}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
