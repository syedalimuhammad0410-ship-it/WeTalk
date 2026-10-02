"use client";
import { useState } from "react";
import { StickyNote, Trash2 } from "lucide-react";
import { useWorkspace, ws } from "@/lib/client/store";
import { Button, Empty, cn, inputCls } from "@/components/ui";

export function NotesView() {
  const inv = useWorkspace((s) => s.inv)!;
  const [text, setText] = useState("");
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <h2 className="text-[16px] font-semibold">Notes</h2>
      <p className="mb-4 text-[12px] text-mute">TRACE can use your notes, for example an approximate year to test candidates against their history. They are always labelled user-provided and kept separate from independently verified evidence.</p>
      <div className="mb-5 rounded-card border border-line bg-panel p-3">
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. I think this image was taken around 2010." className={cn(inputCls, "h-24 py-2")} aria-label="New note" />
        <div className="mt-2 flex justify-end">
          <Button
            variant="primary"
            disabled={!text.trim()}
            onClick={() => {
              ws.addNote(text.trim());
              setText("");
            }}
          >
            Add note
          </Button>
        </div>
      </div>
      {!inv.notes.length ? (
        <Empty icon={<StickyNote className="size-7" />} title="No notes yet" />
      ) : (
        <ul className="space-y-2">
          {inv.notes.map((n) => (
            <li key={n.id} className="flex items-start gap-3 rounded-card border border-warn/25 bg-warn/[0.04] p-3">
              <StickyNote className="mt-0.5 size-4 shrink-0 text-warn" />
              <div className="min-w-0 flex-1">
                <div className="whitespace-pre-wrap text-[13px]">{n.text}</div>
                <div className="mt-1 text-[11px] text-mute">
                  {n.createdAt.slice(0, 16).replace("T", " ")} · user-provided{n.yearHint ? ` · year hint ${n.yearHint} used for temporal checks` : ""}
                </div>
              </div>
              <button aria-label="Delete note" onClick={() => ws.removeNote(n.id)} className="rounded p-1 text-mute hover:text-alert">
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
