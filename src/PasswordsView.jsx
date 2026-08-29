import React, { useMemo, useRef, useState } from "react";
import {
  Plus,
  Search,
  KeyRound,
  Eye,
  EyeOff,
  Copy,
  Check,
  Trash2,
  Pencil,
  Lock,
  ShieldCheck,
  RefreshCw,
  X,
  Fingerprint,
} from "lucide-react";

const PBKDF2_ITERATIONS = 600000;
const VAULT_VERSION = 1;

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveVaultKey(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptEntries(entries, password, existingSalt) {
  const salt = existingSalt
    ? base64ToBytes(existingSalt)
    : crypto.getRandomValues(new Uint8Array(16));

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveVaultKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(entries));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    plaintext,
  );

  return {
    version: VAULT_VERSION,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptEntries(envelope, password) {
  if (!envelope?.salt || !envelope?.iv || !envelope?.ciphertext) {
    throw new Error("Invalid vault");
  }

  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);

  const key = await deriveVaultKey(password, salt);

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    ciphertext,
  );

  const parsed = JSON.parse(new TextDecoder().decode(plaintext));

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid vault contents");
  }

  return parsed;
}

function generatePassword(length = 20) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);

  return Array.from(values, (value) => alphabet[value % alphabet.length]).join(
    "",
  );
}

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  let normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function encryptBytes(key, valueBytes, iv = randomBytes(12)) {
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    valueBytes,
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptBytes(key, envelope) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv) },
    key,
    base64ToBytes(envelope.ciphertext),
  );
  return new Uint8Array(plaintext);
}

async function importDataKey(rawBytes) {
  return crypto.subtle.importKey("raw", rawBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function generateDataKey() {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

async function wrapDataKeyWithPassword(dataKey, password) {
  const salt = randomBytes(16);
  const key = await deriveVaultKey(password, salt);
  const wrapped = await encryptBytes(key, dataKey);
  return {
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: wrapped.iv,
    ciphertext: wrapped.ciphertext,
  };
}

async function unwrapDataKeyWithPassword(passwordWrap, password) {
  const key = await deriveVaultKey(password, base64ToBytes(passwordWrap.salt));
  return decryptBytes(key, passwordWrap);
}

async function deriveRecoveryKey(prfOutput, prfSalt) {
  const material = await crypto.subtle.importKey(
    "raw",
    prfOutput,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: prfSalt,
      info: new TextEncoder().encode("Pocket Password Vault Recovery v1"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function wrapDataKeyWithPrf(dataKey, prfOutput, prfSalt) {
  const key = await deriveRecoveryKey(prfOutput, prfSalt);
  const wrapped = await encryptBytes(key, dataKey);
  return {
    credentialId: null,
    prfSalt: bytesToBase64(prfSalt),
    iv: wrapped.iv,
    ciphertext: wrapped.ciphertext,
    version: 1,
  };
}

async function unwrapDataKeyWithPrf(passkeyWrap, prfOutput) {
  const key = await deriveRecoveryKey(
    prfOutput,
    base64ToBytes(passkeyWrap.prfSalt),
  );
  return decryptBytes(key, passkeyWrap);
}

async function encryptEntriesWithDataKey(entries, dataKey) {
  const key = await importDataKey(dataKey);
  const plaintext = new TextEncoder().encode(JSON.stringify(entries));
  return encryptBytes(key, plaintext);
}

async function decryptEntriesWithDataKey(dataEnvelope, dataKey) {
  const key = await importDataKey(dataKey);
  const plaintext = await decryptBytes(key, dataEnvelope);
  const parsed = JSON.parse(new TextDecoder().decode(plaintext));
  if (!Array.isArray(parsed)) throw new Error("Invalid vault contents");
  return parsed;
}

export default function PasswordsView({ vault, onVaultChange }) {
  const isDevelopment = import.meta.env.DEV;
  const [phase, setPhase] = useState(vault ? "locked" : "setup");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentVaultPassword, setCurrentVaultPassword] = useState("");
  const [newVaultPassword, setNewVaultPassword] = useState("");
  const [confirmNewVaultPassword, setConfirmNewVaultPassword] = useState("");
  const [changePasswordBusy, setChangePasswordBusy] = useState(false);
  const sessionPasswordRef = useRef("");
  const recoveredDataKeyRef = useRef(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(null);
  const [recoveryNewPassword, setRecoveryNewPassword] = useState("");
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");
  const [recoveryEnabled, setRecoveryEnabled] = useState(
    Boolean(vault?.version === 2 && vault?.passkeyWraps?.length),
  );

  const [form, setForm] = useState({
    title: "",
    username: "",
    password: "",
    url: "",
    notes: "",
  });

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) =>
      [entry.title, entry.username, entry.url]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [entries, query]);

  const selected = entries.find((entry) => entry.id === selectedId) || null;

  async function createVault() {
    setError("");

    if (password.length < 12) {
      setError("Use a vault password with at least 12 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("The vault passwords do not match.");
      return;
    }

    setBusy(true);

    try {
      const envelope = await encryptEntries([], password);
      onVaultChange(envelope);
      sessionPasswordRef.current = password;
      setEntries([]);
      setPhase("unlocked");
      setPassword("");
      setConfirmPassword("");
    } catch (e) {
      setError(e.message || "Could not create the vault.");
    } finally {
      setBusy(false);
    }
  }

  async function unlockVault() {
    setError("");
    if (!password) {
      setError("Enter your vault password.");
      return;
    }
    setBusy(true);
    try {
      let decrypted;
      if (vault?.version === 2) {
        const dataKey = await unwrapDataKeyWithPassword(
          vault.passwordWrap,
          password,
        );
        decrypted = await decryptEntriesWithDataKey(vault.data, dataKey);
      } else {
        decrypted = await decryptEntries(vault, password);
      }
      sessionPasswordRef.current = password;
      setEntries(decrypted);
      setPhase("unlocked");
      setPassword("");
    } catch {
      setError("Incorrect vault password or corrupted vault.");
    } finally {
      setBusy(false);
    }
  }

  function lockVault() {
    sessionPasswordRef.current = "";
    setEntries([]);
    setSelectedId(null);
    setShowForm(false);
    setEditing(null);
    setError("");
    setPhase("locked");
  }

  async function changeVaultPassword() {
    setError("");
    if (!currentVaultPassword) {
      setError("Enter your current vault password.");
      return;
    }
    if (newVaultPassword.length < 12) {
      setError("Use a new vault password with at least 12 characters.");
      return;
    }
    if (newVaultPassword !== confirmNewVaultPassword) {
      setError("The new vault passwords do not match.");
      return;
    }
    if (currentVaultPassword === newVaultPassword) {
      setError(
        "Your new password must be different from the current password.",
      );
      return;
    }
    setChangePasswordBusy(true);
    try {
      if (vault?.version === 2) {
        const dataKey = await unwrapDataKeyWithPassword(
          vault.passwordWrap,
          currentVaultPassword,
        );
        const passwordWrap = await wrapDataKeyWithPassword(
          dataKey,
          newVaultPassword,
        );
        onVaultChange({ ...vault, passwordWrap });
      } else {
        const decrypted = await decryptEntries(vault, currentVaultPassword);
        const newEnvelope = await encryptEntries(decrypted, newVaultPassword);
        onVaultChange(newEnvelope);
      }
      sessionPasswordRef.current = newVaultPassword;
      setCurrentVaultPassword("");
      setNewVaultPassword("");
      setConfirmNewVaultPassword("");
      setShowChangePassword(false);
      setError("");
    } catch {
      setError(
        "Current vault password is incorrect or the vault could not be decrypted.",
      );
    } finally {
      setChangePasswordBusy(false);
    }
  }

  async function persistEntries(nextEntries) {
    if (!vault) return;
    const activePassword = sessionPasswordRef.current;
    if (!activePassword) {
      setError("Unlock the vault before saving.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (vault.version === 2) {
        const dataKey = await unwrapDataKeyWithPassword(
          vault.passwordWrap,
          activePassword,
        );
        const data = await encryptEntriesWithDataKey(nextEntries, dataKey);
        onVaultChange({ ...vault, data });
      } else {
        const envelope = await encryptEntries(
          nextEntries,
          activePassword,
          vault.salt,
        );
        onVaultChange(envelope);
      }
      setEntries(nextEntries);
    } catch {
      setError("Could not save the vault.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEntry() {
    if (!form.title.trim()) {
      setError("Website or account name is required.");
      return;
    }

    if (!form.password) {
      setError("Password is required.");
      return;
    }

    const existing = editing;
    const next = existing
      ? entries.map((entry) =>
          entry.id === existing.id
            ? {
                ...entry,
                ...form,
                title: form.title.trim(),
              }
            : entry,
        )
      : [
          {
            id: makeId(),
            ...form,
            title: form.title.trim(),
            createdAt: new Date().toISOString(),
          },
          ...entries,
        ];

    setEntries(next);
    setSelectedId(existing?.id || next[0]?.id || null);
    setShowForm(false);
    setEditing(null);
    setForm({
      title: "",
      username: "",
      password: "",
      url: "",
      notes: "",
    });

    await persistEntries(next);
  }

  function openNew() {
    setError("");
    setEditing(null);
    setForm({
      title: "",
      username: "",
      password: generatePassword(),
      url: "",
      notes: "",
    });
    setShowForm(true);
  }

  function openEdit(entry) {
    setError("");
    setEditing(entry);
    setForm({
      title: entry.title || "",
      username: entry.username || "",
      password: entry.password || "",
      url: entry.url || "",
      notes: entry.notes || "",
    });
    setShowForm(true);
  }

  async function deleteEntry(id) {
    const next = entries.filter((entry) => entry.id !== id);
    setSelectedId(null);
    await persistEntries(next);
  }

  async function copyPassword(entry) {
    try {
      await navigator.clipboard.writeText(entry.password);
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      setError("Clipboard access was blocked by the browser.");
    }
  }

  async function passkeyRecoveryAuthentication({ setupSalt, wrappers = [] }) {
    const payload = setupSalt
      ? { mode: "setup", prfSalt: setupSalt }
      : {
          mode: "reset",
          wrappers: wrappers.map((item) => ({
            credentialId: item.credentialId,
            prfSalt: item.prfSalt,
          })),
        };

    const optionsRes = await fetch(
      "/api/auth/pair?action=vault-recovery-options",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    const options = await optionsRes.json();
    if (!optionsRes.ok) {
      throw new Error(options.error || "Could not start passkey recovery");
    }

    const authResp = await startAuthentication(options);

    const verifyRes = await fetch(
      "/api/auth/pair?action=vault-recovery-verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: authResp }),
      },
    );

    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || !verifyData.verified) {
      throw new Error(verifyData.error || "Passkey verification failed");
    }

    const prfOutputB64 = authResp?.clientExtensionResults?.prf?.results?.first;
    if (!prfOutputB64) {
      throw new Error(
        "This passkey or browser does not support WebAuthn PRF. Use another supported passkey.",
      );
    }

    return {
      credentialId: verifyData.credentialId,
      prfOutput: base64UrlToBytes(prfOutputB64),
    };
  }

  async function enablePasskeyRecovery() {
    if (isDevelopment) {
      setError("Passkey recovery must be enabled on pocket.patelviren.com.");
      return;
    }

    const activePassword = sessionPasswordRef.current;
    if (!activePassword || phase !== "unlocked") {
      setError("Unlock the vault first.");
      return;
    }

    setRecoveryBusy(true);
    setError("");

    try {
      const prfSalt = bytesToBase64Url(randomBytes(32));
      const result = await passkeyRecoveryAuthentication({
        setupSalt: prfSalt,
      });

      const dataKey =
        vault?.version === 2
          ? await unwrapDataKeyWithPassword(vault.passwordWrap, activePassword)
          : await generateDataKey();

      const passkeyWrap = await wrapDataKeyWithPrf(
        dataKey,
        result.prfOutput,
        base64UrlToBytes(prfSalt),
      );
      passkeyWrap.credentialId = result.credentialId;

      if (vault?.version === 2) {
        const filtered = (vault.passkeyWraps || []).filter(
          (item) => item.credentialId !== result.credentialId,
        );
        onVaultChange({
          ...vault,
          passkeyWraps: [...filtered, passkeyWrap],
        });
      } else {
        const passwordWrap = await wrapDataKeyWithPassword(
          dataKey,
          activePassword,
        );
        const data = await encryptEntriesWithDataKey(entries, dataKey);
        onVaultChange({
          version: 2,
          data,
          passwordWrap,
          passkeyWraps: [passkeyWrap],
        });
      }

      setRecoveryEnabled(true);
      setError("");
    } catch (e) {
      setError(e.message || "Could not enable passkey recovery.");
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function beginForgotPasswordRecovery() {
    if (isDevelopment) {
      setError("Passkey recovery must be tested on pocket.patelviren.com.");
      return;
    }

    if (vault?.version !== 2 || !vault?.passkeyWraps?.length) {
      setError("Passkey recovery is not enabled for this vault.");
      return;
    }

    setRecoveryBusy(true);
    setError("");

    try {
      const result = await passkeyRecoveryAuthentication({
        wrappers: vault.passkeyWraps,
      });

      const wrapper = vault.passkeyWraps.find(
        (item) => item.credentialId === result.credentialId,
      );

      if (!wrapper) {
        throw new Error("This passkey is not configured for vault recovery.");
      }

      const dataKey = await unwrapDataKeyWithPrf(wrapper, result.prfOutput);

      recoveredDataKeyRef.current = dataKey;
      setRecoveryNewPassword("");
      setRecoveryConfirmPassword("");
      setRecoveryMode("reset");
    } catch (e) {
      setError(e.message || "Passkey recovery failed.");
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function finishForgotPasswordRecovery() {
    setError("");

    if (!recoveredDataKeyRef.current) {
      setError("Recovery session expired. Start again.");
      return;
    }

    if (recoveryNewPassword.length < 12) {
      setError("Use a new vault password with at least 12 characters.");
      return;
    }

    if (recoveryNewPassword !== recoveryConfirmPassword) {
      setError("The new vault passwords do not match.");
      return;
    }

    setRecoveryBusy(true);

    try {
      const dataKey = recoveredDataKeyRef.current;
      const passwordWrap = await wrapDataKeyWithPassword(
        dataKey,
        recoveryNewPassword,
      );

      const decrypted = await decryptEntriesWithDataKey(vault.data, dataKey);

      onVaultChange({
        ...vault,
        passwordWrap,
      });

      sessionPasswordRef.current = recoveryNewPassword;
      setEntries(decrypted);
      setPhase("unlocked");
      setRecoveryMode(null);
      setRecoveryNewPassword("");
      setRecoveryConfirmPassword("");
      setPassword("");
      recoveredDataKeyRef.current = null;
    } catch {
      setError("Could not reset the vault password.");
    } finally {
      setRecoveryBusy(false);
    }
  }

  if (phase === "setup") {
    return (
      <div style={styles.page}>
        <div style={styles.centerPanel}>
          <div style={styles.iconLarge}>
            <KeyRound size={27} />
          </div>

          <div style={styles.eyebrow}>SECURE VAULT</div>
          <h1 style={styles.title}>Create your vault</h1>
          <p style={styles.copy}>
            Your passwords will be encrypted in the browser before the encrypted
            vault is saved to Pocket storage.
          </p>

          <div style={styles.notice}>
            <ShieldCheck size={16} />
            <span>
              Pocket never needs to store your vault password. Keep it safe — it
              cannot be recovered from the vault.
            </span>
          </div>

          <label style={styles.label}>Vault password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            placeholder="Use a strong memorable password"
            autoFocus
          />

          <label style={styles.label}>Confirm password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={styles.input}
            placeholder="Enter it again"
          />

          {error && <div style={styles.error}>{error}</div>}

          <button
            type="button"
            style={styles.primaryButton}
            disabled={busy}
            onClick={createVault}
          >
            {busy ? "Creating vault…" : "Create secure vault"}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "locked") {
    return (
      <div style={styles.page}>
        <div style={styles.centerPanel}>
          <div style={styles.iconLarge}>
            <Lock size={25} />
          </div>

          <div style={styles.eyebrow}>SECURE VAULT</div>
          <h1 style={styles.title}>Vault locked</h1>
          <p style={styles.copy}>
            Enter your vault password to decrypt your saved passwords on this
            device.
          </p>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleUnlock();
            }}
            style={styles.input}
            placeholder="Vault password"
            autoFocus
          />

          {vault?.version === 2 && vault?.passkeyWraps?.length > 0 && (
            <button
              type="button"
              style={styles.linkButton}
              onClick={beginForgotPasswordRecovery}
              disabled={recoveryBusy}
            >
              <Fingerprint size={14} />
              {recoveryBusy
                ? "Verifying passkey…"
                : "Forgot vault password? Use passkey"}
            </button>
          )}

          {error && <div style={styles.error}>{error}</div>}

          <button
            type="button"
            style={styles.primaryButton}
            disabled={busy}
            onClick={unlockVault}
          >
            {busy ? "Unlocking…" : "Unlock vault"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <div>
          <div style={styles.eyebrow}>SECURE VAULT</div>
          <h1 style={styles.titleSmall}>Passwords</h1>
          <div style={styles.subtle}>{entries.length} saved passwords</div>
        </div>

        <div style={styles.headerActions}>
          {!recoveryEnabled && (
            <button
              style={styles.secondaryButton}
              onClick={enablePasskeyRecovery}
              disabled={recoveryBusy}
            >
              <Fingerprint size={14} />
              {recoveryBusy ? "Enabling…" : "Enable passkey recovery"}
            </button>
          )}
          <button
            style={styles.secondaryButton}
            onClick={() => {
              setShowChangePassword(true);
              setError("");
            }}
          >
            <KeyRound size={14} /> Change password
          </button>
          <button style={styles.secondaryButton} onClick={lockVault}>
            <Lock size={14} /> Lock
          </button>
          <button style={styles.primaryCompactButton} onClick={openNew}>
            <Plus size={15} /> Add password
          </button>
        </div>
      </div>

      <div style={styles.searchRow}>
        <Search size={15} color="#626873" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search passwords…"
          style={styles.searchInput}
        />
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}

      <div style={styles.contentGrid}>
        <div style={styles.listPanel}>
          {filteredEntries.length === 0 ? (
            <div style={styles.emptyState}>
              <KeyRound size={24} color="#4FE36B" />
              <div style={styles.emptyTitle}>
                {entries.length === 0 ? "Your vault is empty" : "Nothing found"}
              </div>
              <div style={styles.emptyCopy}>
                {entries.length === 0
                  ? "Add your first password to start building the vault."
                  : "Try another search term."}
              </div>
              {entries.length === 0 && (
                <button style={styles.secondaryButton} onClick={openNew}>
                  <Plus size={14} /> Add password
                </button>
              )}
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedId(entry.id)}
                style={{
                  ...styles.passwordRow,
                  background:
                    selectedId === entry.id ? "#20242B" : "transparent",
                }}
              >
                <div style={styles.siteIcon}>
                  {entry.title.slice(0, 1).toUpperCase()}
                </div>
                <div style={styles.rowText}>
                  <div style={styles.rowTitle}>{entry.title}</div>
                  <div style={styles.rowMeta}>
                    {entry.username || "No username"}
                  </div>
                </div>
                <KeyRound size={14} color="#555B64" />
              </button>
            ))
          )}
        </div>

        <div style={styles.detailPanel}>
          {selected ? (
            <>
              <div style={styles.detailHeader}>
                <div>
                  <div style={styles.detailEyebrow}>PASSWORD ENTRY</div>
                  <h2 style={styles.detailTitle}>{selected.title}</h2>
                </div>
                <div style={styles.detailActions}>
                  <button
                    style={styles.iconButton}
                    onClick={() => openEdit(selected)}
                    title="Edit"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    style={styles.iconButton}
                    onClick={() => deleteEntry(selected.id)}
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div style={styles.fieldBlock}>
                <div style={styles.detailLabel}>USERNAME</div>
                <div style={styles.valueRow}>
                  <span style={styles.value}>{selected.username || "—"}</span>
                  {selected.username && (
                    <button
                      style={styles.copyIcon}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(
                            selected.username,
                          );
                        } catch {}
                      }}
                    >
                      <Copy size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div style={styles.fieldBlock}>
                <div style={styles.detailLabel}>PASSWORD</div>
                <div style={styles.valueRow}>
                  <span style={styles.value}>
                    {"•".repeat(Math.min(18, selected.password.length || 8))}
                  </span>
                  <button
                    style={styles.copyIcon}
                    onClick={() => copyPassword(selected)}
                    title="Copy password"
                  >
                    {copiedId === selected.id ? (
                      <Check size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>

              {selected.url && (
                <div style={styles.fieldBlock}>
                  <div style={styles.detailLabel}>WEBSITE</div>
                  <div style={styles.value}>{selected.url}</div>
                </div>
              )}

              {selected.notes && (
                <div style={styles.fieldBlock}>
                  <div style={styles.detailLabel}>NOTES</div>
                  <div style={styles.notesValue}>{selected.notes}</div>
                </div>
              )}

              <div style={styles.detailFooter}>
                <ShieldCheck size={14} />
                Encrypted vault • decrypted only while unlocked
              </div>
            </>
          ) : (
            <div style={styles.noSelection}>
              <KeyRound size={28} color="#4FE36B" />
              <div style={styles.emptyTitle}>Select a password</div>
              <div style={styles.emptyCopy}>
                Your decrypted entries stay in memory only while this vault is
                unlocked.
              </div>
            </div>
          )}
        </div>
      </div>

      {recoveryMode === "reset" && (
        <div style={styles.overlay}>
          <div style={styles.formModal}>
            <button
              style={styles.modalClose}
              onClick={() => {
                setRecoveryMode(null);
                setRecoveryNewPassword("");
                setRecoveryConfirmPassword("");
                recoveredDataKeyRef.current = null;
                setError("");
              }}
            >
              <X size={17} />
            </button>

            <div style={styles.iconLargeSmall}>
              <Fingerprint size={22} />
            </div>

            <div style={styles.detailEyebrow}>PASSKEY RECOVERY</div>
            <h2 style={styles.formTitle}>Create a new vault password</h2>
            <p style={styles.copy}>
              Your passkey verified your identity. Choose a new password for
              your existing vault.
            </p>

            <label style={styles.label}>New vault password</label>
            <input
              type="password"
              value={recoveryNewPassword}
              onChange={(e) => setRecoveryNewPassword(e.target.value)}
              placeholder="At least 12 characters"
              style={styles.input}
              autoFocus
            />

            <label style={styles.label}>Confirm new password</label>
            <input
              type="password"
              value={recoveryConfirmPassword}
              onChange={(e) => setRecoveryConfirmPassword(e.target.value)}
              placeholder="Enter the new password again"
              style={styles.input}
            />

            <div style={styles.notice}>
              <ShieldCheck size={16} />
              <span>
                Your saved passwords remain encrypted. Only the key protecting
                them is re-wrapped with the new password.
              </span>
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <button
              type="button"
              style={styles.primaryButton}
              disabled={recoveryBusy}
              onClick={finishForgotPasswordRecovery}
            >
              {recoveryBusy ? "Resetting password…" : "Set new vault password"}
            </button>
          </div>
        </div>
      )}

      {showChangePassword && (
        <div style={styles.overlay}>
          <div style={styles.formModal}>
            <button
              style={styles.modalClose}
              onClick={() => {
                setShowChangePassword(false);
                setCurrentVaultPassword("");
                setNewVaultPassword("");
                setConfirmNewVaultPassword("");
                setError("");
              }}
            >
              <X size={17} />
            </button>

            <div style={styles.iconLargeSmall}>
              <ShieldCheck size={22} />
            </div>

            <div style={styles.detailEyebrow}>SECURE VAULT</div>

            <h2 style={styles.formTitle}>Change vault password</h2>

            <p style={styles.copy}>
              Your saved passwords will be re-encrypted with the new password.
            </p>

            <label style={styles.label}>Current vault password</label>
            <input
              type="password"
              value={currentVaultPassword}
              onChange={(e) => setCurrentVaultPassword(e.target.value)}
              placeholder="Current password"
              style={styles.input}
              autoFocus
            />

            <label style={styles.label}>New vault password</label>
            <input
              type="password"
              value={newVaultPassword}
              onChange={(e) => setNewVaultPassword(e.target.value)}
              placeholder="At least 12 characters"
              style={styles.input}
            />

            <label style={styles.label}>Confirm new password</label>
            <input
              type="password"
              value={confirmNewVaultPassword}
              onChange={(e) => setConfirmNewVaultPassword(e.target.value)}
              placeholder="Enter the new password again"
              style={styles.input}
            />

            <div style={styles.notice}>
              <ShieldCheck size={16} />
              <span>
                Your passwords are decrypted only in memory and encrypted again
                using the new vault password.
              </span>
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <button
              type="button"
              style={styles.primaryButton}
              disabled={changePasswordBusy}
              onClick={changeVaultPassword}
            >
              {changePasswordBusy
                ? "Changing password…"
                : "Change vault password"}
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <div style={styles.overlay}>
          <div style={styles.formModal}>
            <button
              style={styles.modalClose}
              onClick={() => setShowForm(false)}
            >
              <X size={17} />
            </button>

            <div style={styles.iconLargeSmall}>
              <KeyRound size={22} />
            </div>

            <div style={styles.detailEyebrow}>SECURE VAULT</div>
            <h2 style={styles.formTitle}>
              {editing ? "Edit password" : "New password"}
            </h2>

            <label style={styles.label}>Website / account</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Google"
              style={styles.input}
              autoFocus
            />

            <label style={styles.label}>Username / email</label>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="viren@example.com"
              style={styles.input}
            />

            <label style={styles.label}>Password</label>
            <div style={styles.passwordInputRow}>
              <input
                type={form.showPassword ? "text" : "password"}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                style={{ ...styles.input, marginBottom: 0, paddingRight: 80 }}
                placeholder="Password"
              />
              <button
                style={styles.generateButton}
                type="button"
                onClick={() =>
                  setForm({ ...form, password: generatePassword() })
                }
              >
                <RefreshCw size={12} /> Generate
              </button>
              <button
                style={styles.revealButton}
                type="button"
                onClick={() =>
                  setForm({ ...form, showPassword: !form.showPassword })
                }
              >
                {form.showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            <label style={styles.label}>Website URL</label>
            <input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://example.com"
              style={styles.input}
            />

            <label style={styles.label}>Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Optional notes"
              style={styles.textarea}
              rows={3}
            />

            {error && <div style={styles.error}>{error}</div>}

            <button
              style={styles.primaryButton}
              disabled={busy}
              onClick={saveEntry}
            >
              {busy ? "Saving…" : editing ? "Save changes" : "Save password"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    padding: "0 32px 32px",
    fontFamily: "Inter, sans-serif",
    color: "#ECEAE3",
    boxSizing: "border-box",
  },
  centerPanel: {
    maxWidth: 520,
    margin: "60px auto",
    padding: 28,
    background: "#171A1F",
    border: "1px solid #292D35",
    borderRadius: 15,
  },
  iconLarge: {
    width: 54,
    height: 54,
    borderRadius: 14,
    background: "#18231B",
    color: "#4FE36B",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  iconLargeSmall: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: "#18231B",
    color: "#4FE36B",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  eyebrow: {
    fontSize: 9,
    letterSpacing: "0.16em",
    color: "#5F6570",
  },
  title: {
    margin: "8px 0 6px",
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 30,
  },
  titleSmall: {
    margin: "7px 0 3px",
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 30,
  },
  copy: {
    margin: 0,
    color: "#787E88",
    fontSize: 12,
    lineHeight: 1.6,
  },
  subtle: {
    color: "#666C76",
    fontSize: 11,
  },
  notice: {
    display: "flex",
    gap: 9,
    alignItems: "flex-start",
    margin: "18px 0",
    padding: 12,
    border: "1px solid #27352D",
    background: "#151A17",
    borderRadius: 9,
    color: "#7E9B88",
    fontSize: 11,
    lineHeight: 1.5,
  },
  label: {
    display: "block",
    margin: "0 0 7px",
    color: "#8C919A",
    fontSize: 10,
    letterSpacing: 0.2,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 11px",
    marginBottom: 14,
    background: "#14161B",
    border: "1px solid #2A2E37",
    borderRadius: 7,
    color: "#ECEAE3",
    outline: "none",
    fontSize: 12,
  },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    resize: "vertical",
    padding: "10px 11px",
    marginBottom: 14,
    background: "#14161B",
    border: "1px solid #2A2E37",
    borderRadius: 7,
    color: "#ECEAE3",
    outline: "none",
    fontSize: 12,
    fontFamily: "Inter, sans-serif",
  },
  primaryButton: {
    width: "100%",
    border: "none",
    borderRadius: 8,
    padding: "11px 14px",
    background: "#4FE36B",
    color: "#0E1013",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  primaryCompactButton: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: "none",
    borderRadius: 7,
    padding: "9px 12px",
    background: "#4FE36B",
    color: "#0E1013",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  },
  secondaryButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    border: "1px solid #2D323B",
    borderRadius: 7,
    padding: "9px 12px",
    background: "#181B20",
    color: "#C9CCD1",
    fontSize: 11,
    cursor: "pointer",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 16,
    marginBottom: 16,
  },
  headerActions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  searchRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 11px",
    borderRadius: 8,
    background: "#14161B",
    border: "1px solid #292D35",
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#ECEAE3",
    fontSize: 12,
  },
  error: {
    color: "#D9735C",
    background: "rgba(217,115,92,.08)",
    border: "1px solid rgba(217,115,92,.18)",
    borderRadius: 7,
    padding: "9px 10px",
    fontSize: 10,
    marginBottom: 12,
  },
  errorBanner: {
    color: "#D9735C",
    background: "rgba(217,115,92,.08)",
    border: "1px solid rgba(217,115,92,.18)",
    borderRadius: 8,
    padding: "9px 11px",
    marginBottom: 12,
    fontSize: 11,
  },
  contentGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(240px, .85fr) minmax(0, 1.5fr)",
    gap: 12,
  },
  listPanel: {
    border: "1px solid #292D35",
    borderRadius: 12,
    background: "#171A1F",
    overflow: "hidden",
    minHeight: 390,
  },
  detailPanel: {
    border: "1px solid #292D35",
    borderRadius: 12,
    background: "#171A1F",
    minHeight: 390,
    padding: 20,
    boxSizing: "border-box",
  },
  passwordRow: {
    width: "100%",
    border: "none",
    borderBottom: "1px solid #252930",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "11px 12px",
    color: "#ECEAE3",
    textAlign: "left",
    cursor: "pointer",
  },
  siteIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    background: "#20242B",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#4FE36B",
    fontWeight: 600,
    fontSize: 11,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rowMeta: {
    marginTop: 3,
    color: "#666C76",
    fontSize: 10,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    borderBottom: "1px solid #292D35",
    paddingBottom: 16,
    marginBottom: 17,
  },
  detailEyebrow: {
    color: "#5F6570",
    fontSize: 9,
    letterSpacing: "0.14em",
    marginBottom: 6,
  },
  detailTitle: {
    margin: 0,
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 21,
  },
  detailActions: {
    display: "flex",
    gap: 7,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 7,
    border: "1px solid #2C313A",
    background: "#181B20",
    color: "#8D929B",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  fieldBlock: {
    marginBottom: 18,
  },
  detailLabel: {
    fontSize: 9,
    letterSpacing: "0.12em",
    color: "#5F6570",
    marginBottom: 6,
  },
  valueRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "9px 10px",
    borderRadius: 7,
    background: "#14161B",
    border: "1px solid #242932",
  },
  value: {
    color: "#D9D7D0",
    fontSize: 12,
    wordBreak: "break-word",
  },
  notesValue: {
    color: "#A0A4AC",
    fontSize: 11,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  },
  copyIcon: {
    width: 28,
    height: 28,
    border: "1px solid #2C313A",
    borderRadius: 6,
    background: "#191C22",
    color: "#7C828C",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
  detailFooter: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 24,
    color: "#66806E",
    fontSize: 9,
  },
  noSelection: {
    minHeight: 350,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: 20,
  },
  emptyState: {
    minHeight: 390,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    textAlign: "center",
    padding: 24,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "#ECEAE3",
  },
  emptyCopy: {
    maxWidth: 270,
    color: "#686E78",
    fontSize: 10,
    lineHeight: 1.5,
    marginBottom: 6,
  },
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    background: "rgba(8,9,11,.74)",
    backdropFilter: "blur(10px)",
  },
  formModal: {
    width: "min(440px, calc(100vw - 40px))",
    maxHeight: "calc(100vh - 40px)",
    overflowY: "auto",
    background: "#1A1D24",
    border: "1px solid #30343D",
    borderRadius: 15,
    padding: 24,
    position: "relative",
    boxSizing: "border-box",
    boxShadow: "0 30px 90px rgba(0,0,0,.5)",
  },
  modalClose: {
    position: "absolute",
    right: 12,
    top: 12,
    width: 29,
    height: 29,
    borderRadius: 7,
    border: "1px solid #30343D",
    background: "#15181D",
    color: "#777D86",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  formTitle: {
    margin: "7px 0 18px",
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 22,
  },
  passwordInputRow: {
    position: "relative",
    marginBottom: 14,
  },
  generateButton: {
    position: "absolute",
    right: 37,
    top: 5,
    height: 27,
    border: "1px solid #30343D",
    background: "#1E2229",
    borderRadius: 5,
    color: "#9DA1A9",
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "0 7px",
    fontSize: 9,
    cursor: "pointer",
  },
  revealButton: {
    position: "absolute",
    right: 5,
    top: 5,
    width: 28,
    height: 27,
    border: "none",
    background: "transparent",
    color: "#777D86",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
};
