import React, { useState } from "react";

const DEFAULTS = {
  maxSpendUsd:          50,
  confidenceThreshold:  0.7,
  cooldownSeconds:      3600,
  allowedTokens:        "INIT,ETH,USDC",
};

function Field({ label, description, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-bold" style={{ color: "var(--text)" }}>
        {label}
      </label>
      {description && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {description}
        </p>
      )}
      {children}
    </div>
  );
}

export default function PolicyConfig() {
  const [policy, setPolicy] = useState(DEFAULTS);
  const [saved, setSaved] = useState(false);

  function set(key, value) {
    setPolicy((p) => ({ ...p, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    try {
      await fetch("/api/policy", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(policy),
      });
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }

  const inputStyle = {
    background:  "var(--surface)",
    border:      "1px solid var(--border)",
    color:       "var(--text)",
    borderRadius: "6px",
    padding:     "6px 10px",
    fontSize:    "13px",
    fontFamily:  "inherit",
    width:       "100%",
  };

  return (
    <div
      className="max-w-lg rounded-lg p-6"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <h2 className="text-sm font-bold mb-5" style={{ color: "var(--text)" }}>
        Policy Configuration
      </h2>
      <p className="text-xs mb-6" style={{ color: "var(--muted)" }}>
        These rules are committed on-chain at the start of every session as the
        trust anchor. The policy check engine enforces them before any swap runs.
      </p>

      <div className="flex flex-col gap-5">
        <Field label="Max spend per cycle (USD)" description="Hard cap on how much the agent can spend in one cycle.">
          <input
            type="number"
            min={1}
            value={policy.maxSpendUsd}
            onChange={(e) => set("maxSpendUsd", parseFloat(e.target.value))}
            style={inputStyle}
          />
        </Field>

        <Field
          label="Confidence threshold"
          description="AI confidence must meet or exceed this value (0–1) for a BUY to proceed."
        >
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={policy.confidenceThreshold}
            onChange={(e) => set("confidenceThreshold", parseFloat(e.target.value))}
            style={inputStyle}
          />
        </Field>

        <Field
          label="Cooldown (seconds)"
          description="Minimum time between executed swaps. Prevents runaway spending."
        >
          <input
            type="number"
            min={0}
            value={policy.cooldownSeconds}
            onChange={(e) => set("cooldownSeconds", parseInt(e.target.value))}
            style={inputStyle}
          />
        </Field>

        <Field
          label="Allowed tokens"
          description="Comma-separated list. Only these tokens can be purchased."
        >
          <input
            type="text"
            value={policy.allowedTokens}
            onChange={(e) => set("allowedTokens", e.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>

      <button
        onClick={handleSave}
        className="mt-6 px-4 py-2 text-sm rounded-lg font-medium"
        style={{
          background: "#14532d",
          color:      "var(--green)",
          border:     "1px solid var(--green)",
          cursor:     "pointer",
        }}
      >
        {saved ? "✓ saved" : "save policy"}
      </button>
    </div>
  );
}
