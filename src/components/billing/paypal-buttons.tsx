"use client";
import { useEffect, useRef, useState } from "react";

type ButtonsInstance = { render: (el: HTMLElement) => Promise<void>; close?: () => Promise<void> };
declare global {
  interface Window {
    paypal?: { Buttons: (options: Record<string, unknown>) => ButtonsInstance };
  }
}

export type PayPalHandlers = {
  /** Return false to stop before PayPal opens (e.g. a required field is empty). */
  onClick: () => boolean;
  /** Our side of the subscription: which PayPal plan, and our workspace id. */
  createSubscription: () => Promise<{ plan_id: string; custom_id: string }>;
  onApprove: (subscriptionId: string) => Promise<void>;
  onCancel: () => void;
  onError: (message: string) => void;
};

const SCRIPT_ID = "paypal-sdk";

/** PayPal's own buttons: pay with a PayPal account or any debit/credit card. All money goes to the PayPal account that owns the client id. */
export function PayPalButtons({ clientId, currency, handlers }: { clientId: string; currency: string; handlers: PayPalHandlers }) {
  const box = useRef<HTMLDivElement>(null);
  const h = useRef(handlers);
  const reported = useRef(false);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    h.current = handlers;
  });

  useEffect(() => {
    let cancelled = false;
    let instance: ButtonsInstance | null = null;
    const fail = () => !cancelled && setState("failed");
    const render = () => {
      if (cancelled || !box.current || !window.paypal) return;
      instance = window.paypal.Buttons({
        style: { layout: "vertical", shape: "rect", label: "subscribe", height: 44 },
        onClick: (_d: unknown, actions: { resolve: () => unknown; reject: () => unknown }) => (h.current.onClick() ? actions.resolve() : actions.reject()),
        createSubscription: async (_d: unknown, actions: { subscription: { create: (o: Record<string, unknown>) => Promise<string> } }) => {
          reported.current = false;
          try {
            const sub = await h.current.createSubscription();
            return await actions.subscription.create({ ...sub, application_context: { brand_name: "WebScout AI", shipping_preference: "NO_SHIPPING", user_action: "SUBSCRIBE_NOW" } });
          } catch (e) {
            reported.current = true; // our own message is clearer than PayPal's generic one
            h.current.onError((e as Error).message);
            throw e;
          }
        },
        onApprove: async (data: { subscriptionID?: string | null }) => {
          if (data.subscriptionID) await h.current.onApprove(data.subscriptionID);
        },
        onCancel: () => h.current.onCancel(),
        onError: (err: unknown) => {
          if (reported.current) return;
          h.current.onError(err instanceof Error && err.message ? err.message : "PayPal couldn't complete the payment. Please try again.");
        },
      });
      instance.render(box.current).then(() => !cancelled && setState("ready"), fail);
    };
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    let script: HTMLScriptElement | null = null;
    if (window.paypal) render();
    else {
      script = existing ?? document.createElement("script");
      script.addEventListener("load", render);
      script.addEventListener("error", fail);
      if (!existing) {
        script.id = SCRIPT_ID;
        script.async = true;
        script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&vault=true&intent=subscription&currency=${encodeURIComponent(currency)}&components=buttons`;
        document.body.appendChild(script);
      }
    }
    return () => {
      cancelled = true;
      script?.removeEventListener("load", render);
      script?.removeEventListener("error", fail);
      instance?.close?.().catch(() => {});
    };
  }, [clientId, currency]);

  return (
    <div>
      {state === "loading" && <div className="flex h-11 items-center justify-center rounded-md bg-subtle text-sm text-muted">Loading secure PayPal checkout…</div>}
      {state === "failed" && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">PayPal couldn&apos;t load. Turn off ad or tracker blockers for this page (or try another browser), then refresh.</div>}
      <div ref={box} className="min-h-0" />
    </div>
  );
}
