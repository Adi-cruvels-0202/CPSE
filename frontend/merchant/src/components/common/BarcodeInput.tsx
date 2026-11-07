import { useState } from 'react';
import { CameraScanner, canScanWithCamera } from '../../features/sales/CameraScanner';
import { IconScanBarcode } from '../icons/Icons';
import './BarcodeInput.css';

/**
 * A barcode box that takes a code three ways: typed, from a USB/Bluetooth
 * scanner (which types the digits and presses Enter), or from the camera
 * button where the browser can read barcodes. `onScan` runs for the last two
 * — a finished code — so a screen can act on it at once (find the product,
 * add it to the bill); typing alone only changes the value.
 */
export function BarcodeInput({ id, value, onChange, onScan, label, placeholder = 'Scan or type the barcode', autoFocus, compact = false }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onScan?: (code: string) => void;
  /** Accessible name when there is no visible <label for={id}>. */
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const [scanning, setScanning] = useState(false);
  const finish = (code: string) => {
    const clean = code.trim();
    if (!clean) return;
    onChange(clean);
    onScan?.(clean);
  };
  return (
    <div className={`barcode-input${compact ? ' barcode-input--compact' : ''}`}>
      <input
        id={id}
        className="input-field mono"
        aria-label={label}
        inputMode="numeric"
        autoComplete="off"
        maxLength={100}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // A scanner ends every code with Enter; keep it from submitting the form.
          if (e.key === 'Enter') { e.preventDefault(); finish(e.currentTarget.value); }
        }}
      />
      {canScanWithCamera() && (
        <button type="button" className="btn btn-ghost btn-sm barcode-input__camera" onClick={() => setScanning(true)} aria-label="Scan with camera" title="Scan with the camera">
          <IconScanBarcode size={18} />
        </button>
      )}
      {scanning && <CameraScanner onClose={() => setScanning(false)} onCode={(code) => { setScanning(false); finish(code); }} />}
    </div>
  );
}
