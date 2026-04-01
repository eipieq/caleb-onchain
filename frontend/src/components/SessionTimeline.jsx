import React, { useState } from "react";

const STEP_META = [
  { label: "POLICY",    color: "var(--cyan)",   icon: "⚙" },
  { label: "MARKET",    color: "var(--blue)",   icon: "📈" },
  { label: "DECISION",  color: "var(--purple)", icon: "🤖" },
  { label: "CHECK",     color: "var(--yellow)", icon: "🔒" },
  { label: "EXECUTION", color: "var(--green)",  icon: "⚡" },
];

function shortHash(h) {
  if (!h) return "—";
  return `${h.slice(0, 10)}…${h.slice(-8)}`;
}

function explorerUrl(txHash) {
  return `https://explorer.testnet.initia.xyz/tx/${txHash}`;
}

function StepCard({ step, meta, index }) {
  const [expanded, setExpanded] = useState(false);
  const verified = step.verified; // "pass" | "fail" | undefined

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: `1px solid var(--border)` }}
    >
      {/* Step header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 p-3 text-left transition-colors"
        style={{ background: "var(--surface)" }}
      >
        {/* Timeline dot */}
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: meta.color }}
        />

        <span className="text-xs font-bold w-20" style={{ color: meta.color }}>
          {meta.label}
        </span>

        <span className="flex-1 text-xs font-mono" style={{ color: "var(--muted)" }}>
          {shortHash(step.dataHash)}
        </span>

        {/* Verify badge */}
        {verified === "pass" && (
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: "#14532d", color: "var(--green)" }}>
            ✓ verified
          </span>
        )}
        {verified === "fail" && (
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: "#450a0a", color: "var(--red)" }}>
            ✗ tampered
          </span>
        )}

        <span className="text-xs ml-2" style={{ color: "var(--muted)" }}>
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div
          className="p-3 text-xs font-mono"
          style={{ background: "#0d0d14", borderTop: "1px solid var(--border)" }}
        >
          <div className="flex flex-col gap-1 mb-3">
            <Row label="hash"     value={step.dataHash} />
            <Row label="tx"       value={step.txHash}
              link={step.txHash ? explorerUrl(step.txHash) : null} />
            <Row label="block"    value={step.blockNumber} />
          </div>
          <div
            className="rounded p-2 overflow-auto max-h-48"
            style={{ background: "var(--bg)", color: "var(--muted)" }}
          >
            <pre className="text-xs whitespace-pre-wrap">
              {JSON.stringify(step.payload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, link }) {
  return (
    <div className="flex gap-2">
      <span className="w-12 flex-shrink-0" style={{ color: "var(--muted)" }}>{label}</span>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all hover:underline"
          style={{ color: "var(--blue)" }}
        >
          {String(value)}
        </a>
      ) : (
        <span className="break-all" style={{ color: "var(--text)" }}>{String(value ?? "—")}</span>
      )}
    </div>
  );
}

export default function SessionTimeline({ session }) {
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  async function handleVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch(`/api/verify/${session.sessionId}`);
      const data = await res.json();
      setVerifyResult(data);
    } catch {
      setVerifyResult({ error: "Verify request failed" });
    } finally {
      setVerifying(false);
    }
  }

  const lastStep    = session.steps?.[session.steps.length - 1];
  const executed    = lastStep?.payload?.executed;
  const aiDecision  = session.steps?.[2]?.payload;

  return (
    <div className="flex flex-col gap-4">
      {/* Session header */}
      <div
        className="rounded-lg p-4"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>session</p>
            <p className="text-sm font-mono break-all" style={{ color: "var(--text)" }}>
              {session.sessionId}
            </p>
          </div>
          <span
            className="text-sm px-2 py-1 rounded flex-shrink-0 ml-4"
            style={{
              background: executed ? "#14532d" : "#1c1917",
              color: executed ? "var(--green)" : "var(--muted)",
            }}
          >
            {executed ? "BOUGHT" : "SKIPPED"}
          </span>
        </div>

        {aiDecision && (
          <div className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
            <span style={{ color: "var(--purple)" }}>AI: </span>
            {aiDecision.reasoning}
          </div>
        )}
      </div>

      {/* Steps timeline */}
      <div className="relative flex flex-col gap-2">
        {/* Vertical line */}
        <div
          className="absolute left-4 top-4 bottom-4 w-px"
          style={{ background: "var(--border)" }}
        />
        <div className="flex flex-col gap-2 pl-2">
          {(session.steps ?? []).map((step, i) => (
            <StepCard
              key={i}
              index={i}
              step={{ ...step, verified: verifyResult?.steps?.[i]?.match ? "pass" : verifyResult ? "fail" : undefined }}
              meta={STEP_META[i] ?? { label: `STEP ${i}`, color: "var(--muted)", icon: "?" }}
            />
          ))}
        </div>
      </div>

      {/* Verify button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleVerify}
          disabled={verifying}
          className="px-4 py-2 text-sm rounded-lg font-medium transition-colors"
          style={{
            background: verifying ? "var(--border)" : "#1e3a5f",
            color: verifying ? "var(--muted)" : "var(--blue)",
            border: "1px solid #3b82f6",
            cursor: verifying ? "not-allowed" : "pointer",
          }}
        >
          {verifying ? "verifying…" : "verify on-chain"}
        </button>

        {verifyResult && !verifyResult.error && (
          <span
            className="text-sm"
            style={{ color: verifyResult.allPassed ? "var(--green)" : "var(--red)" }}
          >
            {verifyResult.allPassed ? "✓ all hashes match" : "✗ tampered — hash mismatch detected"}
          </span>
        )}
        {verifyResult?.error && (
          <span className="text-sm" style={{ color: "var(--red)" }}>
            {verifyResult.error}
          </span>
        )}
      </div>
    </div>
  );
}
