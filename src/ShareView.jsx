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
          throw new Error(data.error || "This share link is unavailable.");
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

        setState({
          status: "error",
          title: "",
          content: "",
          tags: [],
          expiresAt: null,
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
    return (
      <PageShell>
        <div style={styles.state}>
          <AlertTriangle size={28} />
          <strong>Share unavailable</strong>
          <span>{state.error}</span>
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
