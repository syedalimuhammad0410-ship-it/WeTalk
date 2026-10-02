"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCcw } from "lucide-react";
import { Button, Dialog } from "./ui";

/** Camera capture (getUserMedia). Frames never leave the device until the user starts an investigation. */
export function CameraDialog({ open, onClose, onCapture }: { open: boolean; onClose: () => void; onCapture: (f: File) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    setError(null);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera is not supported in this browser.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Camera unavailable.");
      }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [open, facing]);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (b) onCapture(new File([b], `camera-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`, { type: "image/jpeg" }));
      onClose();
    }, "image/jpeg", 0.92);
  };

  return (
    <Dialog open={open} onClose={onClose} title="Scan with camera" wide>
      <div className="relative overflow-hidden rounded-card border border-line bg-black">
        <video ref={video} playsInline muted className="aspect-video w-full object-cover" />
        <div className="pointer-events-none absolute inset-6 border border-cyan/40">
          <span className="absolute -left-px -top-px size-5 border-l-2 border-t-2 border-cyan" />
          <span className="absolute -right-px -top-px size-5 border-r-2 border-t-2 border-cyan" />
          <span className="absolute -bottom-px -left-px size-5 border-b-2 border-l-2 border-cyan" />
          <span className="absolute -bottom-px -right-px size-5 border-b-2 border-r-2 border-cyan" />
        </div>
        {error && <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-alert">{error}</div>}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <Button variant="ghost" onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}>
          <RefreshCcw className="size-4" /> Switch camera
        </Button>
        <Button variant="primary" onClick={capture} disabled={Boolean(error)}>
          <Camera className="size-4" /> Capture
        </Button>
      </div>
    </Dialog>
  );
}
