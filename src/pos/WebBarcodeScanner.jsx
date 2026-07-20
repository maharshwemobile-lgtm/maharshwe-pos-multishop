import React, { useEffect, useRef, useState } from 'react';
import { Camera, ScanLine, X } from 'lucide-react';
import './web-barcode-scanner.css';

const FORMATS = [
  'aztec', 'code_128', 'code_39', 'code_93', 'codabar',
  'data_matrix', 'ean_13', 'ean_8', 'itf', 'pdf417',
  'qr_code', 'upc_a', 'upc_e',
];

export default function WebBarcodeScanner({ onClose, onDetected }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(0);
  const detectorRef = useRef(null);
  const busyRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  const lastScanRef = useRef({ code: '', time: 0 });
  const [status, setStatus] = useState('Camera စတင်နေသည်…');
  const [manualCode, setManualCode] = useState('');
  const [cameraReady, setCameraReady] = useState(false);

  const stopCamera = () => {
    window.cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const submitCode = async (rawCode) => {
    const code = String(rawCode || '').trim();
    if (!code || busyRef.current) return;
    const now = Date.now();
    if (lastScanRef.current.code === code && now - lastScanRef.current.time < 1400) return;
    lastScanRef.current = { code, time: now };
    busyRef.current = true;
    setStatus(`${code} ရှာနေသည်…`);
    try {
      const result = await onDetectedRef.current(code);
      setStatus(result?.message || (result?.ok ? 'Cart ထဲထည့်ပြီးပါပြီ' : 'Product မတွေ့ပါ'));
      if (result?.ok) setManualCode('');
    } catch (error) {
      setStatus(error?.message || 'Barcode ရှာမရပါ');
    } finally {
      busyRef.current = false;
    }
  };

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let cancelled = false;

    const scanFrame = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (video?.readyState >= 2 && detectorRef.current && !busyRef.current) {
        try {
          const codes = await detectorRef.current.detect(video);
          if (codes?.[0]?.rawValue) await submitCode(codes[0].rawValue);
        } catch {
          // A frame can fail while the camera is focusing; keep scanning.
        }
      }
      frameRef.current = window.requestAnimationFrame(scanFrame);
    };

    const startCamera = async () => {
      if (!('BarcodeDetector' in window)) {
        setStatus('ဒီ Browser မှာ Camera Scan မရပါ။ Barcode ကိုအောက်မှာရိုက်ထည့်နိုင်ပါတယ်။');
        return;
      }
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats?.();
        const formats = supported?.length ? FORMATS.filter((format) => supported.includes(format)) : FORMATS;
        detectorRef.current = new window.BarcodeDetector({ formats });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
        setStatus('Barcode ကို အစိမ်းရောင်ဘောင်အတွင်းထားပါ');
        frameRef.current = window.requestAnimationFrame(scanFrame);
      } catch (error) {
        setStatus(error?.name === 'NotAllowedError'
          ? 'Camera ခွင့်ပြုမှ Scan ဖတ်နိုင်ပါမယ်'
          : 'Camera ဖွင့်မရပါ။ Barcode ကိုအောက်မှာရိုက်ထည့်နိုင်ပါတယ်။');
      }
    };

    startCamera();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, []);

  return (
    <div className="web-scan-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="web-scan-dialog" role="dialog" aria-modal="true" aria-label="Scan product barcode">
        <header>
          <span><Camera size={21} /></span>
          <div><b>Scan to Cart</b><small>ဖတ်ပြီးတာနဲ့ Product ကို Cart ထဲထည့်မယ်</small></div>
          <button type="button" onClick={onClose} aria-label="Close scanner"><X size={20} /></button>
        </header>
        <div className={`web-scan-camera ${cameraReady ? 'ready' : ''}`}>
          <video ref={videoRef} muted playsInline />
          <div className="web-scan-target"><ScanLine size={30} /></div>
        </div>
        <p className="web-scan-status">{status}</p>
        <form onSubmit={(event) => { event.preventDefault(); submitCode(manualCode); }}>
          <input value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="Barcode / SKU ရိုက်ထည့်ရန်" inputMode="numeric" />
          <button type="submit" disabled={!manualCode.trim()}>Add</button>
        </form>
      </section>
    </div>
  );
}
