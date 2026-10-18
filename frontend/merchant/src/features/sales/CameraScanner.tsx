import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/common/ui';

/**
 * Reads a barcode with the device camera (roadmap Phase D "Product
 * recognition from scans"), through the browser's own BarcodeDetector — on
 * Chrome for Android and other browsers that have it. Where it is missing the
 * button does not appear and a USB/Bluetooth scanner or typing still works.
 * Recognising a product from a photo needs an AI provider and is not here.
 */
type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
const DetectorCtor = (): (new (options: { formats: string[] }) => Detector) | null =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window ? (window as any).BarcodeDetector : null;

export const canScanWithCamera = () => Boolean(DetectorCtor() && navigator.mediaDevices?.getUserMedia);

export function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The latest handler, without restarting the camera when the parent re-renders.
  const handler = useRef(onCode);
  handler.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const Ctor = DetectorCtor()!;
    const detector = new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const [found] = await detector.detect(video.current);
            if (found?.rawValue) {
              handler.current(found.rawValue);
              return;
            }
          } catch {
            // A frame that cannot be read is not an error; try the next one.
          }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch {
        setProblem('The camera could not be opened. Allow camera access, or type the code.');
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <Modal title="Scan a barcode" onClose={onClose}>
      {problem ? <div className="alert-strip alert-strip-warning">{problem}</div> : (
        <>
          <video ref={video} muted playsInline style={{ width: '100%', borderRadius: 'var(--radius-md)' }} aria-label="Camera" />
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>Hold the barcode inside the frame.</p>
        </>
      )}
    </Modal>
  );
}
