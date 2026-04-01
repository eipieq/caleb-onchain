import React, { useState, useEffect } from "react";
import SessionList from "./components/SessionList.jsx";
import SessionTimeline from "./components/SessionTimeline.jsx";
import PolicyConfig from "./components/PolicyConfig.jsx";

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [view, setView] = useState("sessions"); // "sessions" | "policy"

  // In a real deployment, this fetches from a local API server that reads
  // the sessions/ directory and calls the chain client for verify status.
  // For the demo, sessions are loaded from the bundled fixture data.
  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  return (
    <div className="min-h-screen p-6" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text)" }}>
            caleb
          </h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            verifiable AI agent on Initia
          </p>
        </div>
        <nav className="flex gap-2">
          {["sessions", "policy"].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="px-3 py-1.5 text-sm rounded-md transition-colors"
              style={{
                background: view === v ? "var(--border)" : "transparent",
                color: view === v ? "var(--text)" : "var(--muted)",
                border: "1px solid var(--border)",
              }}
            >
              {v}
            </button>
          ))}
        </nav>
      </header>

      {/* Main */}
      {view === "sessions" && (
        <div className="flex gap-6">
          <div className="w-80 flex-shrink-0">
            <SessionList
              sessions={sessions}
              selected={selectedSession}
              onSelect={setSelectedSession}
            />
          </div>
          <div className="flex-1">
            {selectedSession ? (
              <SessionTimeline session={selectedSession} />
            ) : (
              <div
                className="flex items-center justify-center h-64 rounded-lg text-sm"
                style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
              >
                select a session to inspect
              </div>
            )}
          </div>
        </div>
      )}

      {view === "policy" && <PolicyConfig />}
    </div>
  );
}
