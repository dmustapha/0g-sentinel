"use client";
// File: frontend/components/AgentCard.tsx
import { useState } from "react";
import { AgentWithAttestation, THREAT_LABELS, CODE_RISK_LABELS, THREAT_COLORS, CODE_RISK_COLORS, THREAT_BG, CODE_RISK_BG } from "@/lib/types";
import Link from "next/link";

interface AgentCardProps {
  agent: AgentWithAttestation;
  onRescan?: (address: string) => void;
}

export function AgentCard({ agent, onRescan }: AgentCardProps) {
  const [scanning, setScanning] = useState(false);

  const handleRescan = async () => {
    if (!onRescan) return;
    setScanning(true);
    try {
      await onRescan(agent.address);
    } finally {
      setScanning(false);
    }
  };

  const threatLabel = THREAT_LABELS[agent.threat_level] || "UNKNOWN";
  const codeLabel = CODE_RISK_LABELS[agent.code_risk] || "UNKNOWN";
  const lastScanned = agent.attestation_timestamp
    ? new Date(agent.attestation_timestamp * 1000).toLocaleDateString()
    : "Never";

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gray-900 text-sm">{agent.name}</h3>
          <p className="text-xs text-gray-400 font-mono mt-0.5">
            {agent.address.slice(0, 6)}...{agent.address.slice(-4)}
          </p>
        </div>
        <div className="flex gap-2">
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${THREAT_BG[agent.threat_level]} ${THREAT_COLORS[agent.threat_level]}`}>
            {threatLabel}
          </span>
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${CODE_RISK_BG[agent.code_risk]} ${CODE_RISK_COLORS[agent.code_risk]}`}>
            {codeLabel}
          </span>
        </div>
      </div>

      {agent.has_attestation && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-gray-500">Behavioral Risk</span>
            <div className="flex-1 bg-gray-200 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${agent.behavioral_score >= 60 ? "bg-red-500" : agent.behavioral_score >= 30 ? "bg-yellow-500" : "bg-green-500"}`}
                style={{ width: `${agent.behavioral_score}%` }}
              />
            </div>
            <span className="text-xs font-mono text-gray-600">{agent.behavioral_score}</span>
          </div>
          {agent.code_findings && (
            <p className="text-xs text-red-600 mt-1 font-mono bg-red-50 rounded px-2 py-1">
              {agent.code_findings}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Scanned {lastScanned}</span>
        <div className="flex gap-2">
          <button
            onClick={handleRescan}
            disabled={scanning || !onRescan}
            className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {scanning ? "Scanning..." : "Rescan"}
          </button>
          <Link
            href={`/agents/${agent.address}`}
            className="text-xs border border-gray-300 text-gray-600 px-3 py-1 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Details
          </Link>
        </div>
      </div>
    </div>
  );
}
