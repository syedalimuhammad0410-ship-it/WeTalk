// Interactive SVG visual models for questions and lessons.
import { useState } from 'react';
import type { VisualSpec } from '../../shared/types.ts';

const A = 'var(--accent)'; const A2 = 'var(--accent-2)'; const M = 'var(--muted)'; const B = 'var(--border)';

export function MathVisual({ spec, className }: { spec: VisualSpec; className?: string }) {
  return <div className={`flex justify-center ${className ?? ''}`}>{render(spec)}</div>;
}

function render(v: VisualSpec) {
  switch (v.type) {
    case 'objects': return <Objects {...v} />;
    case 'fraction-bar': {
      const w = 320, h = 54, seg = w / v.parts;
      return <svg viewBox={`0 0 ${w + 4} ${h + 4}`} className="w-full max-w-sm" role="img" aria-label={`A bar divided into ${v.parts} equal parts with ${v.shaded} shaded`}>{Array.from({ length: v.parts }, (_, i) => <rect key={i} x={2 + i * seg} y={2} width={seg} height={h} fill={i < v.shaded ? A : 'var(--surface-2)'} fillOpacity={i < v.shaded ? 0.85 : 1} stroke={B} strokeWidth={2} rx={i === 0 || i === v.parts - 1 ? 6 : 0} />)}</svg>;
    }
    case 'fraction-circle': {
      const r = 80, cx = 90, cy = 90;
      return <svg viewBox="0 0 180 180" className="w-44" role="img" aria-label={`A circle divided into ${v.parts} equal slices with ${v.shaded} shaded`}>{Array.from({ length: v.parts }, (_, i) => { const a0 = (i / v.parts) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / v.parts) * 2 * Math.PI - Math.PI / 2; const large = a1 - a0 > Math.PI ? 1 : 0; return <path key={i} d={`M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`} fill={i < v.shaded ? A : 'var(--surface-2)'} fillOpacity={i < v.shaded ? 0.85 : 1} stroke="var(--surface)" strokeWidth={3} />; })}</svg>;
    }
    case 'rect': {
      const s = Math.min(240 / v.w, 140 / v.h, 26); const w = v.w * s, h = v.h * s;
      return <svg viewBox={`0 0 ${w + 80} ${h + 60}`} className="w-full max-w-xs" role="img" aria-label={`Rectangle ${v.w} by ${v.h} ${v.unit ?? ''}`}>
        <rect x={40} y={20} width={w} height={h} fill="var(--accent-soft)" stroke={A} strokeWidth={3} rx={4} />
        {s >= 10 && v.w * v.h <= 160 && Array.from({ length: v.w - 1 }, (_, i) => <line key={`v${i}`} x1={40 + (i + 1) * s} y1={20} x2={40 + (i + 1) * s} y2={20 + h} stroke={A} strokeOpacity={0.2} />)}
        {s >= 10 && v.w * v.h <= 160 && Array.from({ length: v.h - 1 }, (_, i) => <line key={`h${i}`} x1={40} y1={20 + (i + 1) * s} x2={40 + w} y2={20 + (i + 1) * s} stroke={A} strokeOpacity={0.2} />)}
        {v.labels !== false && <><text x={40 + w / 2} y={h + 46} textAnchor="middle" fill="var(--text)" fontWeight={700} fontSize={15}>{v.w} {v.unit}</text><text x={30} y={20 + h / 2} textAnchor="end" dominantBaseline="middle" fill="var(--text)" fontWeight={700} fontSize={15}>{v.h} {v.unit}</text></>}
      </svg>;
    }
    case 'right-triangle': {
      return <svg viewBox="0 0 260 190" className="w-full max-w-xs" role="img" aria-label="Right triangle">
        <path d="M40 160 L220 160 L40 30 Z" fill="var(--accent-soft)" stroke={A} strokeWidth={3} strokeLinejoin="round" />
        <path d="M40 142 L58 142 L58 160" fill="none" stroke={A} strokeWidth={2} />
        <text x={24} y={98} textAnchor="end" fill="var(--text)" fontWeight={700} fontSize={16}>{String(v.a)}{v.unit && v.a !== '?' && v.a !== '' ? ` ${v.unit}` : ''}</text>
        <text x={130} y={182} textAnchor="middle" fill="var(--text)" fontWeight={700} fontSize={16}>{String(v.b)}{v.unit && v.b !== '?' && v.b !== '' ? ` ${v.unit}` : ''}</text>
        {v.c !== '' && <text x={142} y={86} fill={A2} fontWeight={800} fontSize={16}>{String(v.c)}</text>}
      </svg>;
    }
    case 'circle': return <svg viewBox="0 0 200 200" className="w-44" role="img" aria-label={`Circle with radius ${v.r}`}><circle cx={100} cy={100} r={80} fill="var(--accent-soft)" stroke={A} strokeWidth={3} /><line x1={100} y1={100} x2={180} y2={100} stroke={A2} strokeWidth={3} /><circle cx={100} cy={100} r={4} fill={A2} /><text x={140} y={90} textAnchor="middle" fill="var(--text)" fontWeight={700}>r = {v.r} {v.unit}</text></svg>;
    case 'clock': {
      const mAng = (v.m / 60) * 2 * Math.PI - Math.PI / 2, hAng = (((v.h % 12) + v.m / 60) / 12) * 2 * Math.PI - Math.PI / 2;
      return <svg viewBox="0 0 200 200" className="w-48" role="img" aria-label="Analogue clock"><circle cx={100} cy={100} r={90} fill="var(--surface)" stroke={A} strokeWidth={4} />{Array.from({ length: 12 }, (_, i) => { const a = ((i + 1) / 12) * 2 * Math.PI - Math.PI / 2; return <text key={i} x={100 + 72 * Math.cos(a)} y={100 + 72 * Math.sin(a)} textAnchor="middle" dominantBaseline="central" fill="var(--text)" fontWeight={700} fontSize={16}>{i + 1}</text>; })}<line x1={100} y1={100} x2={100 + 45 * Math.cos(hAng)} y2={100 + 45 * Math.sin(hAng)} stroke="var(--text)" strokeWidth={7} strokeLinecap="round" /><line x1={100} y1={100} x2={100 + 66 * Math.cos(mAng)} y2={100 + 66 * Math.sin(mAng)} stroke={A} strokeWidth={4} strokeLinecap="round" /><circle cx={100} cy={100} r={6} fill="var(--text)" /></svg>;
    }
    case 'number-line': {
      const w = 340; const span = v.max - v.min; const x = (n: number) => 20 + ((n - v.min) / span) * (w - 40);
      const step = span <= 20 ? 1 : span <= 50 ? 5 : 10;
      const ticks = []; for (let t = Math.ceil(v.min / step) * step; t <= v.max; t += step) ticks.push(t);
      return <svg viewBox={`0 0 ${w} 70`} className="w-full max-w-md" role="img" aria-label="Number line"><line x1={10} y1={35} x2={w - 10} y2={35} stroke={M} strokeWidth={2} />{ticks.map((t) => <g key={t}><line x1={x(t)} y1={29} x2={x(t)} y2={41} stroke={M} strokeWidth={t === 0 ? 3 : 1.5} />{(span <= 20 || t % (step * 2) === 0) && <text x={x(t)} y={60} textAnchor="middle" fontSize={11} fill="var(--muted)">{t}</text>}</g>)}{(v.marks ?? []).map((m, i) => <circle key={i} cx={x(m)} cy={35} r={7} fill={i ? A2 : A} />)}{v.highlight !== undefined && <circle cx={x(v.highlight)} cy={35} r={7} fill="none" stroke={A} strokeWidth={3} />}</svg>;
    }
    case 'line-graph': return <Graph fn={(t) => v.m * t + v.b} points={v.points} showLine={v.m !== 0 || v.b !== 0} />;
    case 'parabola': return <Graph fn={(t) => v.a * (t - v.h) ** 2 + v.k} points={[[v.h, v.k]]} />;
    case 'bar-chart': {
      const max = Math.max(...v.values) * 1.15; const bw = 300 / v.values.length;
      return <svg viewBox="0 0 340 220" className="w-full max-w-md" role="img" aria-label="Bar chart">{[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={30} x2={330} y1={180 - f * 160} y2={180 - f * 160} stroke={B} /><text x={24} y={184 - f * 160} textAnchor="end" fontSize={10} fill="var(--muted)">{Math.round(max * f)}</text></g>)}{v.values.map((val, i) => <g key={i}><rect x={36 + i * bw + bw * 0.15} y={180 - (val / max) * 160} width={bw * 0.7} height={(val / max) * 160} rx={6} fill={i % 2 ? A2 : A} /><text x={36 + i * bw + bw / 2} y={174 - (val / max) * 160} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--text)">{val}</text><text x={36 + i * bw + bw / 2} y={200} textAnchor="middle" fontSize={12} fill="var(--muted)">{v.labels[i]}</text></g>)}</svg>;
    }
    case 'shape': {
      const paths: Record<string, string> = { square: 'M40 40h120v120H40z', rectangle: 'M20 55h160v90H20z', triangle: 'M100 25L178 165H22z', pentagon: 'M100 22L178 80L148 168H52L22 80z', hexagon: 'M60 30h80l40 70-40 70H60L20 100z', star: 'M100 20l22 52 56 4-43 36 14 55-49-30-49 30 14-55-43-36 56-4z' };
      return <svg viewBox="0 0 200 190" className="w-40" role="img" aria-label="A shape">{v.shape === 'circle' ? <circle cx={100} cy={95} r={75} fill="var(--accent-soft)" stroke={A} strokeWidth={4} /> : <path d={paths[v.shape]} fill="var(--accent-soft)" stroke={A} strokeWidth={4} strokeLinejoin="round" />}</svg>;
    }
    case 'coins': return <div className="flex flex-wrap justify-center gap-2" role="img" aria-label="Coins">{v.coins.map((c, i) => <div key={i} className="grid place-items-center rounded-full border-4 font-bold shadow-sm" style={{ width: c === 25 ? 64 : c === 5 ? 56 : c === 10 ? 46 : 50, height: c === 25 ? 64 : c === 5 ? 56 : c === 10 ? 46 : 50, background: c === 1 ? '#d97706' : '#cbd5e1', borderColor: c === 1 ? '#b45309' : '#94a3b8', color: '#1e293b' }}>{c}¢</div>)}</div>;
    case 'pattern': return <div className="flex flex-wrap items-center justify-center gap-2 text-4xl" role="img" aria-label="Pattern">{v.items.map((it, i) => <span key={i}>{it}</span>)}<span className="grid h-12 w-12 place-items-center rounded-2xl border-2 border-dashed border-accent text-2xl text-accent">?</span></div>;
    case 'matrix': return <div className="flex items-stretch gap-1 font-mono text-lg font-semibold" role="img" aria-label="Matrix"><div className="w-2 rounded-l-md border-y-2 border-l-2 border-text" /><table><tbody>{v.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className="px-3 py-1 text-center">{c}</td>)}</tr>)}</tbody></table><div className="w-2 rounded-r-md border-y-2 border-r-2 border-text" /></div>;
    case 'dice': return <div className="flex flex-wrap justify-center gap-2 text-5xl" role="img" aria-label="Dice faces 1 to 6">{v.values.map((d) => <span key={d}>{['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][d - 1]}</span>)}</div>;
    case 'unit-circle': {
      const a = (v.angle * Math.PI) / 180; const cx = 110, cy = 110, r = 80;
      return <svg viewBox="0 0 220 220" className="w-52" role="img" aria-label={`Unit circle at ${v.angle} degrees`}><line x1={10} y1={cy} x2={210} y2={cy} stroke={B} /><line x1={cx} y1={10} x2={cx} y2={210} stroke={B} /><circle cx={cx} cy={cy} r={r} fill="none" stroke={A} strokeWidth={2.5} /><line x1={cx} y1={cy} x2={cx + r * Math.cos(a)} y2={cy - r * Math.sin(a)} stroke={A2} strokeWidth={3} /><line x1={cx + r * Math.cos(a)} y1={cy - r * Math.sin(a)} x2={cx + r * Math.cos(a)} y2={cy} stroke={A2} strokeDasharray="4 3" /><circle cx={cx + r * Math.cos(a)} cy={cy - r * Math.sin(a)} r={5} fill={A2} /><text x={cx + 18} y={cy - 6} fontSize={12} fill="var(--muted)">θ</text></svg>;
    }
  }
}

function Objects({ emoji, count, groups }: { emoji: string; count: number; groups?: number }) {
  const [tapped, setTapped] = useState<Set<number>>(new Set());
  // Tap-to-count: each object can be tapped once, showing its count number.
  const order = [...tapped];
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex max-w-md flex-wrap justify-center gap-2" role="group" aria-label={`${count} objects. Tap each one to count.`}>
        {Array.from({ length: count }, (_, i) => (
          <button key={i} type="button" onClick={() => setTapped((s) => new Set(s).add(i))} className={`relative grid h-12 w-12 place-items-center rounded-2xl text-3xl transition ${tapped.has(i) ? 'scale-95 bg-accent-soft' : 'hover:bg-surface-2'} ${groups && i === groups ? 'ml-4' : ''}`} aria-label={tapped.has(i) ? `Counted ${order.indexOf(i) + 1}` : 'Tap to count'}>
            {emoji}{tapped.has(i) && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-white">{order.indexOf(i) + 1}</span>}
          </button>
        ))}
      </div>
      {tapped.size > 0 && <button type="button" className="text-xs text-muted underline" onClick={() => setTapped(new Set())}>Reset counting</button>}
    </div>
  );
}

function Graph({ fn, points, showLine = true }: { fn: (x: number) => number; points?: [number, number][]; showLine?: boolean }) {
  const S = 10, size = 240, c = size / 2, unit = size / (2 * S);
  const X = (x: number) => c + x * unit, Y = (y: number) => c - y * unit;
  const segs: string[] = []; let cur: string[] = [];
  for (let x = -S; x <= S + 1e-9; x += 0.1) {
    const y = fn(x);
    if (!Number.isFinite(y) || Math.abs(y) > S * 1.5) { if (cur.length > 1) segs.push(`M${cur.join(' L')}`); cur = []; continue; }
    cur.push(`${X(x).toFixed(1)},${Y(y).toFixed(1)}`);
  }
  if (cur.length > 1) segs.push(`M${cur.join(' L')}`);
  const d = segs.join(' ');
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-60" role="img" aria-label="Coordinate graph">
      {Array.from({ length: 2 * S + 1 }, (_, i) => i - S).map((i) => <g key={i}><line x1={X(i)} y1={0} x2={X(i)} y2={size} stroke={B} strokeWidth={i === 0 ? 2 : 0.6} /><line x1={0} y1={Y(i)} x2={size} y2={Y(i)} stroke={B} strokeWidth={i === 0 ? 2 : 0.6} /></g>)}
      {showLine && d && <path d={d} fill="none" stroke={A} strokeWidth={3} strokeLinecap="round" />}
      {(points ?? []).map(([px, py], i) => <g key={i}><circle cx={X(px)} cy={Y(py)} r={5.5} fill={A2} /><text x={X(px) + 8} y={Y(py) - 8} fontSize={11} fontWeight={700} fill="var(--text)">({px}, {py})</text></g>)}
    </svg>
  );
}
