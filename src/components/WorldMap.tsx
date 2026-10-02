"use client";
import { useEffect, useRef } from "react";

export interface MapPin {
  lat: number;
  lng: number;
  label?: string;
  color?: string;
  strong?: boolean;
}

let dotsCache: Promise<[number, number][]> | null = null;
export function worldDots() {
  if (!dotsCache) dotsCache = fetch("/world-dots.json").then((r) => r.json());
  return dotsCache;
}

/**
 * Animated dotted world map (canvas). Equirectangular projection; supports a moving
 * "camera" (center/zoom), drifting arcs, and pulsing pins. Used across the landing page,
 * sign-in and the cinematic investigation sequence.
 */
export function WorldMap({
  pins = [],
  center = { lat: 20, lng: 0 },
  zoom = 1,
  drift = true,
  arcs = 6,
  className,
  intensity = 1,
  radar = false,
}: {
  pins?: MapPin[];
  center?: { lat: number; lng: number };
  zoom?: number;
  drift?: boolean;
  arcs?: number;
  className?: string;
  intensity?: number;
  radar?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ center, zoom, pins, radar, cur: { ...center, zoom } });
  state.current.center = center;
  state.current.zoom = zoom;
  state.current.pins = pins;
  state.current.radar = radar;

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let dots: [number, number][] = [];
    let alive = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    worldDots().then((d) => (dots = d));
    const arcList = Array.from({ length: arcs }, () => newArc());
    function newArc() {
      const a = { lat: -40 + Math.random() * 100, lng: -170 + Math.random() * 340 };
      const b = { lat: -40 + Math.random() * 100, lng: -170 + Math.random() * 340 };
      return { a, b, t: Math.random(), speed: 0.002 + Math.random() * 0.004 };
    }
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    let t0 = performance.now();
    const draw = (now: number) => {
      if (!alive) return;
      const dt = Math.min(64, now - t0);
      t0 = now;
      const s = state.current;
      const k = reduce ? 1 : 1 - Math.pow(0.002, dt / 1000);
      s.cur.lat += (s.center.lat - s.cur.lat) * k;
      s.cur.lng += (s.center.lng - s.cur.lng) * k;
      s.cur.zoom += (s.zoom - s.cur.zoom) * k;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const scale = (W / 360) * s.cur.zoom * 1.05;
      const driftX = drift && !reduce ? (now / 1000) * 1.2 : 0;
      const proj = (lat: number, lng: number) => {
        let dx = lng - s.cur.lng - (s.cur.zoom < 1.6 ? driftX % 360 : 0);
        dx = ((((dx + 180) % 360) + 360) % 360) - 180;
        return [W / 2 + dx * scale, H / 2 - (lat - s.cur.lat) * scale * 1.12] as const;
      };
      const r = Math.max(0.7, Math.min(3.2, scale * 0.55));
      ctx.fillStyle = `rgba(160,190,205,${0.22 * intensity})`;
      for (const [lng, lat] of dots) {
        const [x, y] = proj(lat, lng);
        if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
        ctx.fillRect(x - r / 2, y - r / 2, r, r);
      }
      // arcs (search paths)
      for (const arc of arcList) {
        arc.t += arc.speed * (dt / 16) * (reduce ? 0 : 1);
        if (arc.t > 1.4) Object.assign(arc, newArc(), { t: 0 });
        const [ax, ay] = proj(arc.a.lat, arc.a.lng);
        const [bx, by] = proj(arc.b.lat, arc.b.lng);
        if (Math.abs(ax - bx) > W * 0.7) continue;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2 - Math.hypot(bx - ax, by - ay) * 0.3;
        const tt = Math.min(1, arc.t);
        ctx.strokeStyle = `rgba(89,212,232,${0.35 * intensity * (1 - Math.max(0, arc.t - 1) / 0.4)})`;
        ctx.lineWidth = Math.max(1, W / 1600);
        ctx.beginPath();
        const steps = 30;
        for (let i = 0; i <= steps * tt; i++) {
          const u = i / steps;
          const x = (1 - u) * (1 - u) * ax + 2 * (1 - u) * u * mx + u * u * bx;
          const y = (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * my + u * u * by;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // radar range rings around the leading pin (documentary-style targeting)
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const lead = s.pins.find((p) => p.strong);
      if (s.radar && lead) {
        const [lx, ly] = proj(lead.lat, lead.lng);
        const base = Math.min(W, H);
        const rings = [0.09, 0.2, 0.33, 0.5];
        rings.forEach((f, i) => {
          ctx.setLineDash(i % 2 ? [8 * dpr, 7 * dpr] : []);
          ctx.strokeStyle = `rgba(120,230,210,${0.42 - i * 0.07})`;
          ctx.lineWidth = 1.2 * dpr;
          ctx.beginPath();
          ctx.arc(lx, ly, base * f, 0, Math.PI * 2);
          ctx.stroke();
        });
        ctx.setLineDash([]);
        // sweeping beam
        const ang = ((now / 1000) * 0.9) % (Math.PI * 2);
        const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, base * 0.5);
        grad.addColorStop(0, "rgba(120,230,210,0.16)");
        grad.addColorStop(1, "rgba(120,230,210,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.arc(lx, ly, base * 0.5, ang, ang + 0.45);
        ctx.closePath();
        ctx.fill();
        // crosshair
        ctx.strokeStyle = "rgba(120,230,210,0.25)";
        ctx.lineWidth = dpr;
        ctx.beginPath();
        ctx.moveTo(lx - base * 0.55, ly);
        ctx.lineTo(lx + base * 0.55, ly);
        ctx.moveTo(lx, ly - base * 0.55);
        ctx.lineTo(lx, ly + base * 0.55);
        ctx.stroke();
      }
      // pins
      const pulse = (now / 1000) % 2;
      for (const p of s.pins) {
        const [x, y] = proj(p.lat, p.lng);
        const col = p.color || "#ff7a45";
        ctx.strokeStyle = col;
        ctx.globalAlpha = Math.max(0, 1 - pulse / 2);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 4 + pulse * 14 * (p.strong ? 1.5 : 1), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = col;
        if (p.strong && s.radar) {
          // glowing capsule marker
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(-0.55);
          ctx.shadowColor = "rgba(255,70,70,0.95)";
          ctx.shadowBlur = 18 * dpr;
          ctx.fillStyle = "#ff5a5a";
          const L = 16 * dpr, R = 3.5 * dpr;
          ctx.beginPath();
          ctx.moveTo(-L / 2, -R);
          ctx.lineTo(L / 2, -R);
          ctx.arc(L / 2, 0, R, -Math.PI / 2, Math.PI / 2);
          ctx.lineTo(-L / 2, R);
          ctx.arc(-L / 2, 0, R, Math.PI / 2, (3 * Math.PI) / 2);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, p.strong ? 5 : 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (p.label) {
          ctx.font = `${Math.round(11 * Math.min(2, window.devicePixelRatio || 1))}px ui-monospace, monospace`;
          ctx.fillStyle = "rgba(238,241,244,0.9)";
          ctx.fillText(p.label.toUpperCase(), x + 10, y - 8);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [arcs, drift, intensity]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
