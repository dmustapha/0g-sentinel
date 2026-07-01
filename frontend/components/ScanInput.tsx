"use client";
// File: frontend/components/ScanInput.tsx
// Allows any user to scan an arbitrary agent address — not just pre-registered ones.
// Triggers a full scan and navigates to the agent report on completion.
// Presentation is the prototype `.scan-input-row`; StreamingScanPanel drives the scan.
import { useState, useRef, useCallback } from "react";
import { StreamingScanPanel } from "./StreamingScanPanel";

export function ScanInput({ defaultAddress }: { defaultAddress?: string } = {}) {
  const [address, setAddress] = useState(defaultAddress ?? "");
  const [scanning, setScanning] = useState(false);
  const [scanAddress, setScanAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isValid = /^0x[0-9a-fA-F]{40}$/.test(address.trim());

  const handleStreamError = useCallback((msg: string) => {
    setError(msg);
    setScanning(false);
    setScanAddress(null);
  }, []);

  function handleScan(e: React.FormEvent) {
    e.preventDefault();
    const addr = address.trim();
    if (!isValid || scanning) return;
    setError(null);
    setScanAddress(addr);
    setScanning(true);
    // StreamingScanPanel drives the scan (SSE) and navigates to the report on completion.
  }

  const inputClass =
    "scan-input" + (error ? " errored" : address && !isValid ? " invalid" : "");

  return (
    <form onSubmit={handleScan} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div className="scan-input-row">
        <input
          ref={inputRef}
          className={inputClass}
          type="text"
          value={address}
          onChange={(e) => { setAddress(e.target.value); setError(null); }}
          placeholder="0x… paste any agent address"
          aria-label="Agent address to scan"
          disabled={scanning}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="btn btn-primary" disabled={scanning || !isValid}>
          {scanning ? "Scanning…" : "Scan →"}
        </button>
      </div>

      {scanning && scanAddress && (
        <StreamingScanPanel address={scanAddress} onError={handleStreamError} />
      )}
      {error && <div className="err-msg">{error}</div>}
      {address && !isValid && !scanning && (
        <div className="warn-msg">Must be a valid 0x address (42 chars)</div>
      )}
    </form>
  );
}
