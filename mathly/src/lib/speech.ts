// Web Speech API helpers: speech-to-text (where supported) and text-to-speech.
import { useCallback, useEffect, useRef, useState } from 'react';

type SR = { start(): void; stop(): void; abort(): void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: SpeechEvent) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
type SpeechEvent = { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> };
const getSR = (): (new () => SR) | null => (typeof window === 'undefined' ? null : ((window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition ?? null));
export const speechSupported = () => !!getSR();
export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function speak(text: string) {
  if (!ttsSupported()) return;
  window.speechSynthesis.cancel();
  const clean = text.replace(/\*\*/g, '').replace(/[•#]/g, '').replace(/√/g, 'square root of ').replace(/²/g, ' squared').replace(/³/g, ' cubed').replace(/−/g, ' minus ').replace(/×/g, ' times ').replace(/÷/g, ' divided by ');
  const u = new SpeechSynthesisUtterance(clean.slice(0, 1200));
  u.rate = 1; u.pitch = 1;
  window.speechSynthesis.speak(u);
}
export const stopSpeaking = () => { if (ttsSupported()) window.speechSynthesis.cancel(); };

/** Continuous dictation with pause tracking (gaps between recognized phrases). */
export function useDictation(opts: { continuous?: boolean; onFinal?: (text: string) => void } = {}) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<SR | null>(null);
  const lastResultAt = useRef<number>(0);
  const pauses = useRef<number[]>([]);
  const startedAt = useRef<number>(0);
  const wantOn = useRef(false);

  const stop = useCallback(() => { wantOn.current = false; rec.current?.stop(); setListening(false); }, []);
  const start = useCallback(() => {
    const C = getSR();
    if (!C) { setError('Voice input isn’t supported in this browser. Try Chrome, Edge or Safari — or type instead.'); return; }
    setError(null);
    const r = new C(); r.continuous = opts.continuous ?? true; r.interimResults = true; r.lang = navigator.language || 'en-US';
    r.onresult = (e) => {
      let fin = ''; let tmp = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const res = e.results[i]; if (res.isFinal) fin += res[0].transcript; else tmp += res[0].transcript; }
      const now = performance.now();
      if (lastResultAt.current && fin) { const gap = (now - lastResultAt.current) / 1000; if (gap > 0.8) pauses.current.push(Math.round(gap * 10) / 10); }
      if (fin) { lastResultAt.current = now; setTranscript((t) => `${t}${t ? ' ' : ''}${fin.trim()}`); opts.onFinal?.(fin.trim()); }
      setInterim(tmp);
    };
    r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') setError(e.error === 'not-allowed' ? 'Microphone permission was denied.' : 'Voice input stopped unexpectedly.'); };
    r.onend = () => { if (wantOn.current && (opts.continuous ?? true)) { try { r.start(); } catch { setListening(false); } } else setListening(false); };
    rec.current = r; wantOn.current = true; startedAt.current = performance.now(); lastResultAt.current = performance.now();
    try { r.start(); setListening(true); } catch { setError('Could not start the microphone.'); }
  }, [opts.continuous, opts.onFinal]);
  useEffect(() => () => { wantOn.current = false; rec.current?.abort(); }, []);
  const reset = () => { setTranscript(''); setInterim(''); pauses.current = []; };
  return { listening, transcript, interim, error, start, stop, reset, setTranscript, pauses: pauses.current, elapsed: () => (performance.now() - startedAt.current) / 1000 };
}
