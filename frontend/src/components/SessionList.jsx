import React from "react";

function shortHash(h) {
  if (!h) return "—";
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

function statusDot(session) {
  if (!session.verified) return { color: "var(--muted)", label: "unverified" };
  if (session.verified === "pass") return { color: "var(--green)", label: "verified" };
  return { color: "var(--red)", label: "tampered" };
}

export default function SessionList({ sessions, selected, onSelect }) {
  if (sessions.length === 0) {
    return (
      <div
        className="rounded-lg p-4 text-sm"
        style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
      >
        No sessions yet. Run the agent to create one.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>
        {sessions.length} session{sessions.length !== 1 ? "s" : ""}
      </p>
      {sessions.map((s) => {
        const dot = statusDot(s);
        const isSelected = selected?.sessionId === s.sessionId;
        const lastStep = s.steps?.[s.steps.length - 1];
        const executed = lastStep?.payload?.executed;

        return (
          <button
            key={s.sessionId}
            onClick={() => onSelect(s)}
            className="text-left rounded-lg p-3 transition-colors w-full"
            style={{
              background: isSelected ? "var(--border)" : "var(--surface)",
              border: `1px solid ${isSelected ? "#3b3b5a" : "var(--border)"}`,
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-mono" style={{ color: "var(--text)" }}>
                {shortHash(s.sessionId)}
              </span>
              <span className="text-xs" style={{ color: dot.color }}>
                ● {dot.label}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                {s.startedAt ? new Date(s.startedAt * 1000).toLocaleString() : "—"}
              </span>
              <span
                className="text-xs px-1.5 py-0.5 rounded"
                style={{
                  background: executed ? "#14532d" : "#1c1917",
                  color: executed ? "var(--green)" : "var(--muted)",
                }}
              >
                {executed ? "BOUGHT" : "SKIPPED"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
