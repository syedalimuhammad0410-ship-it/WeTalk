"use client";
import { useEffect, useState } from "react";
import { greeting } from "@/lib/utils";

/** Greets using the viewer's local time (server time zone may differ). */
export function Greeting({ name, fallback }: { name: string; fallback: string }) {
  const [g, setG] = useState(fallback);
  useEffect(() => setG(greeting()), []);
  return <h1 className="text-2xl font-semibold tracking-tight sm:text-[26px]">{g}, {name}</h1>;
}
