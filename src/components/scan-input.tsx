"use client";

import { useRef, useState } from "react";
import { btnCls, inputCls } from "./ui";

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/**
 * Text input with a camera "Scan" button (uses the browser BarcodeDetector,
 * available in Chrome on Android). Hardware scanners just type into the field.
 */
export function ScanInput({ name, defaultValue, placeholder }: { name: string; defaultValue?: string; placeholder?: string }) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;

  async function scan() {
    setError("");
    try {
      const Ctor = (window as unknown as { BarcodeDetector: new () => Detector }).BarcodeDetector;
      const detector = new Ctor();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setScanning(true);
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      const stop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setScanning(false);
      };
      const started = Date.now();
      const tick = async () => {
        const codes = await detector.detect(video).catch(() => []);
        if (codes[0]) {
          setValue(codes[0].rawValue);
          stop();
        } else if (Date.now() - started > 20_000) {
          setError("No barcode found");
          stop();
        } else requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setError("Camera not available");
      setScanning(false);
    }
  }

  return (
    <div className="w-full">
      <div className="flex gap-2">
        <input name={name} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoFocus className={inputCls} />
        {supported && (
          <button type="button" onClick={scan} className={btnCls}>
            📷 Scan
          </button>
        )}
      </div>
      <video ref={videoRef} className={scanning ? "mt-2 w-full max-w-sm rounded" : "hidden"} muted playsInline />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
