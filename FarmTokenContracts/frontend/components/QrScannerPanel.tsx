"use client";

import jsQR from "jsqr";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

type Props = {
  onWalletDetected?: (wallet: string) => void;
};

export default function QrScannerPanel({ onWalletDetected }: Props) {
  const [status, setStatus] = useState("Scanner idle");
  const [expanded, setExpanded] = useState(false);
  const [manualPayload, setManualPayload] = useState("");
  const [scanning, setScanning] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  function parseWalletFromQr(raw: string): string | null {
    const match = raw.trim().match(/0x[a-fA-F0-9]{40}/);
    return match?.[0] || null;
  }

  function applyPayload(raw: string, source: string) {
    const wallet = parseWalletFromQr(raw);
    if (!wallet) {
      setStatus(`${source}: no wallet found`);
      return;
    }

    if (onWalletDetected) onWalletDetected(wallet);
    setStatus(`${source}: wallet parsed`);
  }

  function stopCamera() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    setScanning(false);
  }

  async function startCameraScan() {
    try {
      stopCamera();
      setStatus("Requesting camera permission...");

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("Camera API unavailable. Use image upload or paste payload.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });

      streamRef.current = stream;
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas) {
        stopCamera();
        setStatus("Scanner UI failed to initialize");
        return;
      }

      video.srcObject = stream;
      await video.play();
      setScanning(true);
      setStatus("Scanning from camera...");

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        stopCamera();
        setStatus("Canvas context unavailable");
        return;
      }

      const tick = () => {
        if (!video.videoWidth || !video.videoHeight) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(frame.data, frame.width, frame.height, {
          inversionAttempts: "dontInvert",
        });

        if (found?.data) {
          applyPayload(found.data, "Camera QR");
          stopCamera();
          return;
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch (error) {
      stopCamera();
      setStatus(`Camera scan failed: ${(error as Error).message}`);
    }
  }

  async function onUploadImage(event: ChangeEvent<HTMLInputElement>) {
    try {
      const file = event.target.files?.[0];
      if (!file) {
        setStatus("No image selected");
        return;
      }

      setStatus("Decoding uploaded image...");

      const imageBitmap = await createImageBitmap(file);
      const canvas = canvasRef.current;
      if (!canvas) {
        setStatus("Canvas unavailable");
        return;
      }

      canvas.width = imageBitmap.width;
      canvas.height = imageBitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        setStatus("Canvas context unavailable");
        return;
      }

      ctx.drawImage(imageBitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      });

      if (!found?.data) {
        setStatus("No QR code detected in image");
        return;
      }

      applyPayload(found.data, "Image QR");
    } catch (error) {
      setStatus(`Image decode failed: ${(error as Error).message}`);
    } finally {
      event.target.value = "";
    }
  }

  function onParseManual() {
    if (!manualPayload.trim()) {
      setStatus("Paste payload first");
      return;
    }
    applyPayload(manualPayload, "Manual payload");
  }

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  return (
    <div className="w-full mirror-panel" style={{ padding: "0.75rem" }}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            setExpanded((v) => !v);
            setStatus("Scanner panel opened");
          }}
          className="mirror-btn"
          type="button"
        >
          QR Scan
        </button>
        <span className="text-xs mirror-muted">{status}</span>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={startCameraScan}
              className="mirror-btn"
            >
              Start Camera
            </button>
            <button
              type="button"
              onClick={stopCamera}
              className="mirror-btn"
            >
              Stop Camera
            </button>
            <label className="cursor-pointer mirror-btn">
              Upload QR Image
              <input type="file" accept="image/*" className="hidden" onChange={onUploadImage} />
            </label>
            <span className="text-xs mirror-muted">{scanning ? "Camera active" : "Camera idle"}</span>
          </div>

          <video ref={videoRef} className="w-full max-w-sm rounded border border-slate-800 bg-black" muted playsInline />
          <canvas ref={canvasRef} className="hidden" />

          <div className="space-y-2">
            <label className="block text-xs mirror-muted">Manual Wallet QR Payload</label>
            <textarea
              value={manualPayload}
              onChange={(e) => setManualPayload(e.target.value)}
              placeholder="Paste raw QR payload here"
              className="min-h-20 w-full mirror-input text-xs"
            />
            <button
              type="button"
              onClick={onParseManual}
              className="mirror-btn"
            >
              Parse Wallet
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
