"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, FileSearch, Map, Network, ScanText, ShieldCheck, Sparkles } from "lucide-react";
import { WorldMap } from "@/components/WorldMap";
import { Logo } from "@/components/Logo";

const PINS = [
  { lat: 33.757, lng: -84.396, label: "candidate", strong: true },
  { lat: 40.75, lng: -73.99 },
  { lat: 51.5, lng: -0.12 },
  { lat: 35.68, lng: 139.69 },
  { lat: -33.86, lng: 151.2 },
  { lat: 25.79, lng: -80.13 },
];

const FEATURES = [
  { icon: ScanText, title: "Clue extraction", body: "OCR, scene understanding, object detection, EXIF metadata, logos and architecture, each kept as a separate, traceable clue." },
  { icon: FileSearch, title: "Parallel research", body: "Knowledge graph, web, news, maps, images and historical records searched in parallel branches. Every query is shown." },
  { icon: Map, title: "Candidates on a map", body: "Candidate places with coordinates, timelines and name history, plus the evidence for and against each one." },
  { icon: Network, title: "Evidence board", body: "An investigation graph that grows as research happens: image → text → entity → venue → location." },
  { icon: Sparkles, title: "Tries to disprove itself", body: "For every leading candidate, TRACE asks what would prove it wrong and goes looking for that evidence." },
  { icon: ShieldCheck, title: "No hallucinated sources", body: "Claims trace back to retrieved records. Unverified links are labelled, and confidence is stated in plain words, not false precision." },
];

export default function Landing() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-ink">
      <div className="absolute inset-0">
        <WorldMap className="absolute inset-0 h-full w-full" pins={PINS} arcs={9} />
        <div className="vignette absolute inset-0" />
        <div className="scanlines absolute inset-0 opacity-50" />
      </div>
      <div className="grain pointer-events-none absolute inset-0 overflow-hidden" />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/privacy" className="hidden rounded px-3 py-2 text-[13px] text-dim hover:text-fg sm:block">
            Privacy & Responsible Research
          </Link>
          <Link href="/login" className="rounded-[5px] border border-line-strong px-3.5 py-2 text-[13px] hover:bg-white/5">
            Sign in
          </Link>
        </nav>
      </header>

      <section className="relative z-10 mx-auto flex min-h-[78dvh] max-w-6xl flex-col justify-center px-6 md:px-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} className="label-mono mb-6 flex items-center gap-3 text-cyan">
          <span className="relative flex size-2">
            <span className="pulse-ring absolute inset-0 rounded-full bg-cyan" />
            <span className="relative size-2 rounded-full bg-cyan" />
          </span>
          Visual investigation system
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.1, ease: [0.2, 0.7, 0.2, 1] }}
          className="text-[clamp(48px,9vw,120px)] font-semibold leading-[0.9] tracking-[-0.045em]"
        >
          FROM IMAGE
          <br />
          <span className="text-transparent [-webkit-text-stroke:1.5px_rgba(238,241,244,0.85)]">TO EVIDENCE.</span>
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.8 }} className="mt-7 max-w-xl text-[17px] leading-relaxed text-dim">
          AI-powered visual research that turns photographs into searchable clues, candidates, locations, and evidence.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75 }} className="mt-10 flex flex-wrap items-center gap-3">
          <Link href="/app" className="group inline-flex h-12 items-center gap-2 rounded-[5px] bg-fg px-6 text-[14px] font-semibold tracking-wide text-ink hover:bg-white">
            START INVESTIGATION <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link href="/app?demo=basketball" className="inline-flex h-12 items-center gap-2 rounded-[5px] border border-line-strong px-6 text-[14px] tracking-wide hover:bg-white/5">
            VIEW DEMO
          </Link>
        </motion.div>
        <div className="label-mono mt-10 text-mute">Powered by multimodal AI + visual search + maps + web research</div>
      </section>

      <section className="relative z-10 border-t border-line bg-ink/80 backdrop-blur">
        <div className="mx-auto grid max-w-6xl gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div key={f.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }} className="bg-ink p-7">
              <f.icon className="mb-4 size-5 text-cyan" />
              <h3 className="mb-2 text-[15px] font-semibold">{f.title}</h3>
              <p className="text-[13.5px] leading-relaxed text-dim">{f.body}</p>
            </motion.div>
          ))}
        </div>
        <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-[12px] text-mute md:px-10">
          <span>TRACE researches public places, organizations and documents. It does not identify private individuals.</span>
          <Link href="/privacy" className="hover:text-fg">
            Privacy & Responsible Research →
          </Link>
        </footer>
      </section>
    </main>
  );
}
