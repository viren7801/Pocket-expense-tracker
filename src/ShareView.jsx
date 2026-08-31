import React, { useEffect, useState } from "react";
import { AlertTriangle, Clock3, FileText, ShieldCheck } from "lucide-react";

function base64UrlToBytes(value) {
  if (typeof value !== "string" || !value) {
    throw new Error("Missing share key.");
  }

  let normalized = value.replace(/-/g, "+").replace(/_/g, "/");

  while (normalized.length % 4) {
    normalized += "=";
  }

  const binary = atob(normalized);

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function useShareId() {
  return window.location.pathname.split("/").filter(Boolean).pop() || "";
}

export default function ShareView() {
  const [state, setState] = useState({
    status: "loading",
    title: "",
    content: "",
    tags: [],
    expiresAt: null,
    errorCode: "",
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const shareId = useShareId();

        const keyText = window.location.hash.replace(/^#/, "");

        if (!shareId || !keyText) {
          throw new Error("This share link is incomplete.");
        }

        const response = await fetch(
          `/api/share-note?id=${encodeURIComponent(shareId)}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const data = await response.json();

        if (!response.ok) {
          const error = new Error(
            data.error || "This share link is unavailable.",
          );
          error.status = response.status;
          throw error;
        }

        const key = await crypto.subtle.importKey(
          "raw",
          base64UrlToBytes(keyText),
          {
            name: "AES-GCM",
          },
          false,
          ["decrypt"],
        );

        const plaintext = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: base64UrlToBytes(data.iv),
          },
          key,
          base64UrlToBytes(data.ciphertext),
        );

        const payload = JSON.parse(new TextDecoder().decode(plaintext));

        if (!active) {
          return;
        }

        setState({
          status: "ready",
          title: payload.title || "Shared note",
          content: payload.content || "",
          tags: Array.isArray(payload.tags) ? payload.tags : [],
          expiresAt: data.expiresAt || null,
        });
      } catch (error) {
        if (!active) {
          return;
        }

        const errorCode =
          error?.status === 410
            ? "expired"
            : error?.status === 404
              ? "revoked-or-missing"
              : !keyText
                ? "incomplete"
                : "unavailable";

        setState({
          status: "error",
          title: "",
          content: "",
          tags: [],
          expiresAt: null,
          errorCode,
          error: error.message || "Could not open this share.",
        });
      }
    }

    load();

    return () => {
      active = false;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <PageShell>
        <div style={styles.state}>
          <ShieldCheck size={28} />
          <strong>Opening secure note…</strong>
          <span>Decrypting locally.</span>
        </div>
      </PageShell>
    );
  }

  if (state.status === "error") {
    const expired = state.errorCode === "expired";

    const incomplete = state.errorCode === "incomplete";

    const revokedOrMissing = state.errorCode === "revoked-or-missing";

    return (
      <PageShell>
        <div style={styles.stateCard}>
          <div
            style={{
              ...styles.stateIcon,
              ...(expired ? styles.stateIconExpired : {}),
            }}
          >
            {expired ? <Clock3 size={24} /> : <AlertTriangle size={24} />}
          </div>

          <div style={styles.stateEyebrow}>SHARED NOTE</div>

          <h1 style={styles.stateTitle}>
            {expired
              ? "This link has expired"
              : revokedOrMissing
                ? "This share link is no longer available"
                : incomplete
                  ? "This share link is incomplete"
                  : "Unable to open this note"}
          </h1>

          <p style={styles.stateMessage}>
            {expired
              ? "The owner set an expiry time for this shared note. Ask them to create a new link."
              : revokedOrMissing
                ? "The owner may have revoked the link, or the link may have been removed."
                : incomplete
                  ? "Open the complete link exactly as it was shared, including the secure part after the #."
                  : state.error || "The shared note could not be opened."}
          </p>

          <div style={styles.stateHint}>No note content was displayed.</div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <article style={styles.note}>
        <div style={styles.badge}>
          <ShieldCheck size={13} />
          Read-only shared note
        </div>

        <h1 style={styles.title}>{state.title}</h1>

        {state.tags.length > 0 && (
          <div style={styles.tags}>
            {state.tags.map((tag) => (
              <span key={tag} style={styles.tag}>
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div style={styles.content}>{state.content}</div>

        {state.expiresAt && (
          <div style={styles.expiry}>
            <Clock3 size={13} />
            Expires {new Date(state.expiresAt).toLocaleString()}
          </div>
        )}

        <div style={styles.footer}>
          <FileText size={13} />
          Shared from Pocket
        </div>
      </article>
    </PageShell>
  );
}

function PageShell({ children }) {
  return (
    <main style={styles.page}>
      <div style={styles.brand}>POCKET</div>
      {children}
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    boxSizing: "border-box",
    padding: "48px 20px",
    background: "#101216",
    color: "#D9D7D0",
    fontFamily:
      "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  },

  brand: {
    maxWidth: 760,
    margin: "0 auto 18px",
    color: "#616A75",
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 1.2,
  },

  note: {
    maxWidth: 760,
    margin: "0 auto",
    padding: 28,
    border: "1px solid #2D323B",
    borderRadius: 14,
    background: "#15181D",
    boxShadow: "0 24px 50px rgba(0,0,0,0.22)",
  },

  stateCard: {
    width: "100%",
    maxWidth: 560,
    boxSizing: "border-box",
    padding: "34px 28px 30px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    border: "1px solid #2D323B",
    borderRadius: 14,
    background: "#15181D",
    boxShadow: "0 24px 50px rgba(0,0,0,0.22)",
  },

  stateIcon: {
    width: 48,
    height: 48,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    background: "#302126",
    color: "#D9919A",
  },

  stateIconExpired: {
    background: "#2B2517",
    color: "#C9A455",
  },

  stateEyebrow: {
    marginTop: 18,
    color: "#636C77",
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: 1,
  },

  stateTitle: {
    margin: "8px 0 8px",
    color: "#E1DED6",
    fontSize: 22,
    lineHeight: 1.25,
  },

  stateMessage: {
    maxWidth: 430,
    margin: 0,
    color: "#8A929C",
    fontSize: 11,
    lineHeight: 1.6,
  },

  stateHint: {
    marginTop: 18,
    padding: "7px 9px",
    border: "1px solid #292E36",
    borderRadius: 6,
    background: "#12151A",
    color: "#59616B",
    fontSize: 9,
  },

  state: {
    maxWidth: 520,
    minHeight: 260,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    textAlign: "center",
    color: "#76808B",
  },

  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 7px",
    borderRadius: 6,
    background: "#203225",
    color: "#78C887",
    fontSize: 9,
  },

  title: {
    margin: "16px 0 8px",
    color: "#E1DED6",
    fontSize: 29,
    lineHeight: 1.2,
  },

  tags: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    marginBottom: 22,
  },

  tag: {
    padding: "4px 7px",
    borderRadius: 5,
    background: "#20242B",
    color: "#8C949F",
    fontSize: 9,
  },

  content: {
    whiteSpace: "pre-wrap",
    lineHeight: 1.75,
    color: "#C6C3BB",
    fontSize: 14,
  },

  expiry: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 24,
    color: "#868E98",
    fontSize: 9,
  },

  footer: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 28,
    paddingTop: 14,
    borderTop: "1px solid #242830",
    color: "#59616B",
    fontSize: 9,
  },
};
