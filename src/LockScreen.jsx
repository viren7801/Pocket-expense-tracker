import React, { useState, useEffect, useCallback } from "react";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";

export default function LockScreen({ children }) {
  const [status, setStatus] = useState(null); // { authenticated, hasCredential }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [setupCode, setSetupCode] = useState("");

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status");
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      setStatus({ authenticated: false, hasCredential: false });
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleUnlock = async () => {
    setLoading(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/auth/login-options");
      const options = await optionsRes.json();
      if (!optionsRes.ok)
        throw new Error(options.error || "Could not start unlock");

      const authResp = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authResp),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.verified)
        throw new Error(verifyData.error || "Unlock failed");

      await checkStatus();
    } catch (e) {
      setError(
        e.message === "The operation either timed out or was not allowed."
          ? "Cancelled."
          : e.message || "Unlock failed",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async () => {
    setLoading(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/auth/register-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupCode }),
      });
      const options = await optionsRes.json();
      if (!optionsRes.ok)
        throw new Error(options.error || "Could not start setup");

      const regResp = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(regResp),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.verified)
        throw new Error(verifyData.error || "Setup failed");

      await checkStatus();
    } catch (e) {
      setError(e.message || "Setup failed");
    } finally {
      setLoading(false);
    }
  };

  if (status === null) {
    return (
      <div style={styles.wrap}>
        <div style={styles.text}>Loading…</div>
      </div>
    );
  }

  if (status.authenticated) {
    return children;
  }

  return (
    <div style={styles.wrap}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600&family=Inter:wght@400;500&display=swap');`}</style>
      <div style={styles.card}>
        <Fingerprint size={40} color="#C9A455" />
        <div style={styles.title}>Ledger</div>
        {status.hasCredential ? (
          <>
            <div style={styles.subtitle}>
              Unlock with your fingerprint or Face ID
            </div>
            <button
              style={styles.button}
              onClick={handleUnlock}
              disabled={loading}
            >
              {loading ? "Waiting…" : "Unlock"}
            </button>
          </>
        ) : (
          <>
            <div style={styles.subtitle}>
              Set up biometric unlock for this device
            </div>
            <input
              type="password"
              placeholder="Setup code"
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value)}
              style={styles.input}
            />
            <button
              style={styles.button}
              onClick={handleSetup}
              disabled={loading || !setupCode}
            >
              {loading ? "Waiting…" : "Set up Face ID / Touch ID"}
            </button>
          </>
        )}
        {error && <div style={styles.error}>{error}</div>}
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#14161B",
    fontFamily: "Inter, sans-serif",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 14,
    background: "#1A1D24",
    border: "1px solid #2A2E37",
    borderRadius: 14,
    padding: "36px 32px",
    width: 300,
  },
  title: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 20,
    color: "#ECEAE3",
    fontWeight: 600,
  },
  subtitle: { fontSize: 13, color: "#8B8F98", textAlign: "center" },
  text: { color: "#8B8F98", fontSize: 14 },
  button: {
    width: "100%",
    background: "#C9A455",
    color: "#14161B",
    border: "none",
    borderRadius: 8,
    padding: "12px 0",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 6,
  },
  input: {
    width: "100%",
    background: "#14161B",
    border: "1px solid #2A2E37",
    borderRadius: 8,
    padding: "10px 12px",
    color: "#ECEAE3",
    fontSize: 13,
    boxSizing: "border-box",
    outline: "none",
  },
  error: { color: "#D9735C", fontSize: 12, textAlign: "center" },
};
