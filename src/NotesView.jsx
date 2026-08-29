import React, { useMemo, useRef, useState } from "react";
// Passkey recovery uses the browser WebAuthn API directly so the PRF
// extension values can be supplied as ArrayBuffer instances.
import {
  Plus,
  Search,
  FileText,
  Pin,
  PinOff,
  Trash2,
  Pencil,
  X,
  Lock,
  ShieldCheck,
  Eye,
  EyeOff,
  Fingerprint,
  ChevronRight,
} from "lucide-react";

const PBKDF2_ITERATIONS = 600000;
const VAULT_VERSION = 2;

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== "string") {
    throw new Error("Invalid base64 value.");
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
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
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid base64url value.");
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

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function makeId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

async function encryptBytes(key, valueBytes, iv = randomBytes(12)) {
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    valueBytes,
  );

  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptBytes(key, envelope) {
  if (!envelope?.iv || !envelope?.ciphertext) {
    throw new Error("Invalid encrypted data.");
  }

  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(envelope.iv),
      },
      key,
      base64ToBytes(envelope.ciphertext),
    ),
  );
}

async function generateDataKey() {
  const key = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  );

  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

async function importDataKey(rawBytes) {
  return crypto.subtle.importKey(
    "raw",
    rawBytes,
    {
      name: "AES-GCM",
    },
    false,
    ["encrypt", "decrypt"],
  );
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

async function encryptNotesWithDataKey(notes, dataKey) {
  const key = await importDataKey(dataKey);

  const plaintext = new TextEncoder().encode(JSON.stringify(notes));

  return encryptBytes(key, plaintext);
}

async function decryptNotesWithDataKey(dataEnvelope, dataKey) {
  const key = await importDataKey(dataKey);

  const plaintext = await decryptBytes(key, dataEnvelope);

  const parsed = JSON.parse(new TextDecoder().decode(plaintext));

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid notes vault contents.");
  }

  return parsed;
}

async function encryptLegacyNotes(notes, password, existingSalt) {
  const salt = existingSalt ? base64ToBytes(existingSalt) : randomBytes(16);

  const key = await deriveVaultKey(password, salt);

  const plaintext = new TextEncoder().encode(JSON.stringify(notes));

  const wrapped = await encryptBytes(key, plaintext);

  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: wrapped.iv,
    ciphertext: wrapped.ciphertext,
  };
}

async function decryptLegacyNotes(vault, password) {
  if (!vault?.salt || !vault?.iv || !vault?.ciphertext) {
    throw new Error("Invalid notes vault.");
  }

  const key = await deriveVaultKey(password, base64ToBytes(vault.salt));

  const plaintext = await decryptBytes(key, vault);

  const parsed = JSON.parse(new TextDecoder().decode(plaintext));

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid notes vault contents.");
  }

  return parsed;
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
      info: new TextEncoder().encode("Pocket Notes Vault Recovery v1"),
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

export default function NotesView({ vault, onVaultChange }) {
  const isDevelopment = import.meta.env.DEV;

  const [phase, setPhase] = useState(vault ? "locked" : "setup");

  const [password, setPassword] = useState("");

  const [confirmPassword, setConfirmPassword] = useState("");

  const [notes, setNotes] = useState([]);

  const [query, setQuery] = useState("");

  const [selectedId, setSelectedId] = useState(null);

  const [showForm, setShowForm] = useState(false);

  const [editing, setEditing] = useState(null);

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [showChangePassword, setShowChangePassword] = useState(false);

  const [currentVaultPassword, setCurrentVaultPassword] = useState("");

  const [newVaultPassword, setNewVaultPassword] = useState("");

  const [confirmNewVaultPassword, setConfirmNewVaultPassword] = useState("");

  const [changePasswordBusy, setChangePasswordBusy] = useState(false);

  const [recoveryBusy, setRecoveryBusy] = useState(false);

  const [recoveryMode, setRecoveryMode] = useState(null);

  const [recoveryNewPassword, setRecoveryNewPassword] = useState("");

  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");

  const [showRecoverySetup, setShowRecoverySetup] = useState(false);

  const sessionPasswordRef = useRef("");

  const recoveredDataKeyRef = useRef(null);

  const [form, setForm] = useState({
    title: "",
    content: "",
  });

  const recoveryEnabled = Boolean(
    vault?.version === 2 && vault?.passkeyWraps?.length,
  );

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();

    const result = notes.filter((note) => {
      if (!q) return true;

      return [note.title, note.content].join(" ").toLowerCase().includes(q);
    });

    return result.sort((a, b) => {
      if (Boolean(b.pinned) !== Boolean(a.pinned)) {
        return b.pinned ? 1 : -1;
      }

      return (
        new Date(b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.updatedAt || a.createdAt || 0).getTime()
      );
    });
  }, [notes, query]);

  const selected = notes.find((note) => note.id === selectedId) || null;

  async function createVault() {
    setError("");

    if (password.length < 12) {
      setError("Use a notes vault password with at least 12 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("The notes vault passwords do not match.");
      return;
    }

    setBusy(true);

    try {
      const dataKey = await generateDataKey();

      const passwordWrap = await wrapDataKeyWithPassword(dataKey, password);

      const data = await encryptNotesWithDataKey([], dataKey);

      onVaultChange({
        version: 2,
        data,
        passwordWrap,
        passkeyWraps: [],
      });

      sessionPasswordRef.current = password;

      setNotes([]);
      setPassword("");
      setConfirmPassword("");
      setPhase("unlocked");
    } catch (e) {
      setError(e.message || "Could not create notes vault.");
    } finally {
      setBusy(false);
    }
  }

  async function unlockVault() {
    setError("");

    if (!password) {
      setError("Enter your notes vault password.");
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

        decrypted = await decryptNotesWithDataKey(vault.data, dataKey);
      } else {
        decrypted = await decryptLegacyNotes(vault, password);
      }

      sessionPasswordRef.current = password;

      setNotes(decrypted);
      setPassword("");
      setPhase("unlocked");

      setSelectedId(decrypted[0]?.id || null);
    } catch {
      setError("Incorrect notes vault password or corrupted vault.");
    } finally {
      setBusy(false);
    }
  }

  function lockVault() {
    sessionPasswordRef.current = "";

    recoveredDataKeyRef.current = null;

    setNotes([]);
    setSelectedId(null);
    setShowForm(false);
    setEditing(null);
    setError("");
    setPhase("locked");
  }

  async function persistNotes(nextNotes) {
    const activePassword = sessionPasswordRef.current;

    if (!activePassword) {
      setError("Unlock the notes vault before saving.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      if (vault?.version === 2) {
        const dataKey = await unwrapDataKeyWithPassword(
          vault.passwordWrap,
          activePassword,
        );

        const data = await encryptNotesWithDataKey(nextNotes, dataKey);

        onVaultChange({
          ...vault,
          data,
        });
      } else {
        const envelope = await encryptLegacyNotes(
          nextNotes,
          activePassword,
          vault?.salt,
        );

        onVaultChange(envelope);
      }

      setNotes(nextNotes);
    } catch (e) {
      setError(e.message || "Could not save notes.");
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    if (!form.title.trim()) {
      setError("A note title is required.");
      return;
    }

    if (!form.content.trim()) {
      setError("Write something in the note.");
      return;
    }

    const now = new Date().toISOString();

    const next = editing
      ? notes.map((note) =>
          note.id === editing.id
            ? {
                ...note,
                title: form.title.trim(),
                content: form.content,
                updatedAt: now,
              }
            : note,
        )
      : [
          {
            id: makeId(),
            title: form.title.trim(),
            content: form.content,
            pinned: false,
            createdAt: now,
            updatedAt: now,
          },
          ...notes,
        ];

    setSelectedId(editing?.id || next[0]?.id || null);

    setShowForm(false);
    setEditing(null);

    setForm({
      title: "",
      content: "",
    });

    await persistNotes(next);
  }

  function openNew() {
    setError("");
    setEditing(null);

    setForm({
      title: "",
      content: "",
    });

    setShowForm(true);
  }

  function openEdit(note) {
    setError("");
    setEditing(note);

    setForm({
      title: note.title || "",
      content: note.content || "",
    });

    setShowForm(true);
  }

  async function deleteNote(id) {
    const next = notes.filter((note) => note.id !== id);

    setSelectedId(next[0]?.id || null);

    await persistNotes(next);
  }

  async function togglePin(id) {
    const next = notes.map((note) =>
      note.id === id
        ? {
            ...note,
            pinned: !note.pinned,
            updatedAt: new Date().toISOString(),
          }
        : note,
    );

    await persistNotes(next);
  }

  async function passkeyRecoveryAuthentication({ setupSalt, wrappers = [] }) {
    const payload = setupSalt
      ? {
          mode: "setup",
          prfSalt: setupSalt,
        }
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const options = await optionsRes.json();

    if (!optionsRes.ok) {
      throw new Error(options.error || "Could not start passkey recovery.");
    }

    if (!options || typeof options.challenge !== "string") {
      throw new Error("The server returned invalid WebAuthn options.");
    }

    const toArrayBuffer = (value) => {
      const bytes = base64UrlToBytes(value);

      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
    };

    const publicKey = {
      ...options,

      challenge: toArrayBuffer(options.challenge),

      allowCredentials: (options.allowCredentials || []).map((credential) => {
        if (!credential || typeof credential.id !== "string") {
          throw new Error("The server returned an invalid passkey credential.");
        }

        return {
          ...credential,
          id: toArrayBuffer(credential.id),
        };
      }),

      extensions: {
        ...(options.extensions || {}),
      },
    };

    const evalByCredential = options.extensions?.prf?.evalByCredential;

    if (evalByCredential && typeof evalByCredential === "object") {
      const converted = {};

      for (const [credentialId, values] of Object.entries(evalByCredential)) {
        if (
          typeof credentialId !== "string" ||
          !values ||
          typeof values !== "object"
        ) {
          continue;
        }

        const convertedValues = {};

        if (typeof values.first === "string" && values.first.length > 0) {
          convertedValues.first = toArrayBuffer(values.first);
        }

        if (typeof values.second === "string" && values.second.length > 0) {
          convertedValues.second = toArrayBuffer(values.second);
        }

        if (Object.keys(convertedValues).length > 0) {
          converted[credentialId] = convertedValues;
        }
      }

      if (Object.keys(converted).length > 0) {
        publicKey.extensions = {
          ...publicKey.extensions,

          prf: {
            ...(publicKey.extensions?.prf || {}),

            evalByCredential: converted,
          },
        };
      }
    }

    let credential;

    try {
      credential = await navigator.credentials.get({
        publicKey,
      });
    } catch (error) {
      console.error("Pocket Notes recovery WebAuthn error:", error);

      throw new Error(error?.message || "Passkey authentication failed.");
    }

    if (!credential) {
      throw new Error("Passkey authentication was not completed.");
    }

    const response = credential.response;

    const authResp = {
      id: credential.id,

      rawId: bytesToBase64Url(
        new Uint8Array(response.rawId || credential.rawId),
      ),

      response: {
        authenticatorData: bytesToBase64Url(
          new Uint8Array(response.authenticatorData),
        ),

        clientDataJSON: bytesToBase64Url(
          new Uint8Array(response.clientDataJSON),
        ),

        signature: bytesToBase64Url(new Uint8Array(response.signature)),

        userHandle: response.userHandle
          ? bytesToBase64Url(new Uint8Array(response.userHandle))
          : undefined,
      },

      type: credential.type,

      authenticatorAttachment: credential.authenticatorAttachment || undefined,

      clientExtensionResults: credential.getClientExtensionResults(),
    };

    const verifyRes = await fetch(
      "/api/auth/pair?action=vault-recovery-verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          response: authResp,
        }),
      },
    );

    const verifyData = await verifyRes.json();

    if (!verifyRes.ok || !verifyData.verified) {
      throw new Error(verifyData.error || "Passkey verification failed.");
    }

    const prfOutputRaw = authResp?.clientExtensionResults?.prf?.results?.first;

    if (prfOutputRaw === undefined || prfOutputRaw === null) {
      throw new Error(
        "This passkey or browser did not return a PRF result. The passkey may not support PRF.",
      );
    }

    let prfOutput;

    if (prfOutputRaw instanceof ArrayBuffer) {
      prfOutput = new Uint8Array(prfOutputRaw);
    } else if (ArrayBuffer.isView(prfOutputRaw)) {
      prfOutput = new Uint8Array(
        prfOutputRaw.buffer,
        prfOutputRaw.byteOffset,
        prfOutputRaw.byteLength,
      );
    } else if (typeof prfOutputRaw === "string") {
      prfOutput = base64UrlToBytes(prfOutputRaw);
    } else {
      throw new Error("The authenticator returned an unsupported PRF result.");
    }

    if (!prfOutput.length) {
      throw new Error("The authenticator returned an empty PRF result.");
    }

    return {
      credentialId: verifyData.credentialId,
      prfOutput,
    };
  }

  async function enablePasskeyRecovery() {
    if (isDevelopment) {
      setError("Passkey recovery must be enabled on pocket.patelviren.com.");
      return;
    }

    const activePassword = sessionPasswordRef.current;

    if (!activePassword) {
      setError("Unlock the notes vault first.");
      return;
    }

    setRecoveryBusy(true);
    setError("");

    try {
      const prfSalt = bytesToBase64Url(randomBytes(32));

      const result = await passkeyRecoveryAuthentication({
        setupSalt: prfSalt,
      });

      let dataKey;
      let nextVault;

      if (vault?.version === 2) {
        dataKey = await unwrapDataKeyWithPassword(
          vault.passwordWrap,
          activePassword,
        );

        const passkeyWrap = await wrapDataKeyWithPrf(
          dataKey,
          result.prfOutput,
          base64UrlToBytes(prfSalt),
        );

        passkeyWrap.credentialId = result.credentialId;

        const filtered = (vault.passkeyWraps || []).filter(
          (item) => item.credentialId !== result.credentialId,
        );

        nextVault = {
          ...vault,
          passkeyWraps: [...filtered, passkeyWrap],
        };
      } else {
        const decrypted = await decryptLegacyNotes(vault, activePassword);

        dataKey = await generateDataKey();

        const passwordWrap = await wrapDataKeyWithPassword(
          dataKey,
          activePassword,
        );

        const data = await encryptNotesWithDataKey(decrypted, dataKey);

        const passkeyWrap = await wrapDataKeyWithPrf(
          dataKey,
          result.prfOutput,
          base64UrlToBytes(prfSalt),
        );

        passkeyWrap.credentialId = result.credentialId;

        nextVault = {
          version: 2,
          data,
          passwordWrap,
          passkeyWraps: [passkeyWrap],
        };
      }

      onVaultChange(nextVault);

      setShowRecoverySetup(false);
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
      setError("Passkey recovery is not enabled for this notes vault.");
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
        throw new Error("This passkey is not configured for notes recovery.");
      }

      const dataKey = await unwrapDataKeyWithPrf(wrapper, result.prfOutput);

      recoveredDataKeyRef.current = dataKey;

      const decrypted = await decryptNotesWithDataKey(vault.data, dataKey);

      setNotes(decrypted);
      setSelectedId(decrypted[0]?.id || null);

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

    const dataKey = recoveredDataKeyRef.current;

    if (!dataKey) {
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
      const passwordWrap = await wrapDataKeyWithPassword(
        dataKey,
        recoveryNewPassword,
      );

      const data = await encryptNotesWithDataKey(notes, dataKey);

      onVaultChange({
        ...vault,
        version: 2,
        data,
        passwordWrap,
        passkeyWraps: vault.passkeyWraps || [],
      });

      sessionPasswordRef.current = recoveryNewPassword;

      setCurrentVaultPassword("");

      setRecoveryNewPassword("");

      setRecoveryConfirmPassword("");

      setRecoveryMode(null);
      setRecoveredDataKeySafely();

      setPassword("");
      setPhase("unlocked");
      setError("");
    } catch (e) {
      setError(e.message || "Could not reset the notes vault password.");
    } finally {
      setRecoveryBusy(false);
    }
  }

  function setRecoveredDataKeySafely() {
    recoveredDataKeyRef.current = null;
  }

  async function changeVaultPassword() {
    setError("");

    if (!currentVaultPassword) {
      setError("Enter your current notes vault password.");
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

        onVaultChange({
          ...vault,
          passwordWrap,
        });
      } else {
        const decrypted = await decryptLegacyNotes(vault, currentVaultPassword);

        const newVault = await encryptLegacyNotes(decrypted, newVaultPassword);

        onVaultChange(newVault);
      }

      sessionPasswordRef.current = newVaultPassword;

      setCurrentVaultPassword("");

      setNewVaultPassword("");

      setConfirmNewVaultPassword("");

      setShowChangePassword(false);

      setError("");
    } catch {
      setError(
        "Current notes vault password is incorrect or the vault could not be decrypted.",
      );
    } finally {
      setChangePasswordBusy(false);
    }
  }

  function openChangePassword() {
    setCurrentVaultPassword("");
    setNewVaultPassword("");
    setConfirmNewVaultPassword("");
    setError("");
    setShowChangePassword(true);
  }

  function openRecoveryFromLocked() {
    setError("");

    if (vault?.version !== 2 || !vault?.passkeyWraps?.length) {
      setError("Passkey recovery is not enabled for this notes vault.");
      return;
    }

    setRecoveryMode("authenticate");
    setRecoveryNewPassword("");
    setRecoveryConfirmPassword("");
    recoveredDataKeyRef.current = null;
  }

  async function submitRecoveryAuthentication() {
    await beginForgotPasswordRecovery();
  }

  if (phase === "setup") {
    return (
      <div style={styles.page}>
        <div style={styles.centerPanel}>
          <div style={styles.iconLarge}>
            <FileText size={27} />
          </div>

          <div style={styles.eyebrow}>PRIVATE NOTES</div>

          <h1 style={styles.title}>Create your notes vault</h1>

          <p style={styles.copy}>
            Your notes are encrypted in the browser before the encrypted vault
            is saved to Pocket.
          </p>

          <div style={styles.notice}>
            <ShieldCheck size={16} />
            <span>Your notes vault password is never sent to Pocket.</span>
          </div>

          <label style={styles.label}>Notes vault password</label>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 12 characters"
            style={styles.input}
            autoFocus
          />

          <label style={styles.label}>Confirm password</label>

          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Enter it again"
            style={styles.input}
          />

          {error && <div style={styles.error}>{error}</div>}

          <button
            type="button"
            style={styles.primaryButton}
            disabled={busy}
            onClick={createVault}
          >
            {busy ? "Creating vault…" : "Create notes vault"}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "locked") {
    const recoveryModal = recoveryMode && (
      <div style={styles.overlay}>
        <div style={styles.formModal}>
          <button
            type="button"
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

          {recoveryMode === "authenticate" ? (
            <>
              <h2 style={styles.formTitle}>Verify your passkey</h2>

              <p style={styles.copy}>
                Use Touch ID, Face ID, or your Pocket passkey to recover your
                notes vault.
              </p>

              <div style={styles.recoveryWaitingCard}>
                <div style={styles.recoveryWaitingIcon}>
                  <Fingerprint size={20} />
                </div>

                <div>
                  <div style={styles.recoveryWaitingTitle}>
                    Passkey required
                  </div>

                  <div style={styles.recoveryWaitingCopy}>
                    Continue to authenticate with your registered passkey.
                  </div>
                </div>
              </div>

              {error && <div style={styles.error}>{error}</div>}

              <button
                type="button"
                style={styles.primaryButton}
                disabled={recoveryBusy}
                onClick={submitRecoveryAuthentication}
              >
                {recoveryBusy ? "Waiting for passkey…" : "Use passkey"}
              </button>
            </>
          ) : (
            <>
              <h2 style={styles.formTitle}>Reset notes password</h2>

              <p style={styles.copy}>
                Your passkey verified your identity. Choose a new password for
                your existing notes.
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
                  Your old notes password is not required after passkey
                  verification.
                </span>
              </div>

              {error && <div style={styles.error}>{error}</div>}

              <button
                type="button"
                style={styles.primaryButton}
                disabled={recoveryBusy}
                onClick={finishForgotPasswordRecovery}
              >
                {recoveryBusy
                  ? "Resetting password…"
                  : "Set new vault password"}
              </button>
            </>
          )}

          <button
            type="button"
            style={styles.linkButton}
            onClick={() => {
              setRecoveryMode(null);
              setRecoveryNewPassword("");
              setRecoveryConfirmPassword("");
              recoveredDataKeyRef.current = null;
              setError("");
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );

    return (
      <>
        <div style={styles.page}>
          <div style={styles.centerPanel}>
            <div style={styles.iconLarge}>
              <Lock size={25} />
            </div>

            <div style={styles.eyebrow}>PRIVATE NOTES</div>

            <h1 style={styles.title}>Notes locked</h1>

            <p style={styles.copy}>
              Enter your notes vault password to decrypt your saved notes.
            </p>

            <label style={styles.label}>Vault password</label>

            <div style={styles.passwordInputWrap}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    unlockVault();
                  }
                }}
                placeholder="Enter vault password"
                style={{
                  ...styles.input,
                  marginBottom: 0,
                  paddingRight: 44,
                }}
                autoFocus
              />

              <button
                type="button"
                style={styles.passwordToggle}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <button
              type="button"
              style={{
                ...styles.primaryButton,
                opacity: busy || !password ? 0.5 : 1,
              }}
              disabled={busy || !password}
              onClick={unlockVault}
            >
              {busy ? "Unlocking…" : "Unlock notes"}
            </button>

            {recoveryEnabled && (
              <>
                <div style={styles.recoveryDivider}>
                  <span style={styles.recoveryDividerLine} />
                  <span>OR</span>
                  <span style={styles.recoveryDividerLine} />
                </div>

                <button
                  type="button"
                  style={styles.recoveryButton}
                  onClick={openRecoveryFromLocked}
                >
                  <div style={styles.recoveryButtonIcon}>
                    <Fingerprint size={17} />
                  </div>

                  <div style={styles.recoveryButtonText}>
                    <div style={styles.recoveryButtonTitle}>
                      Forgot vault password?
                    </div>

                    <div style={styles.recoveryButtonSubtitle}>
                      Use Touch ID, Face ID, or passkey
                    </div>
                  </div>

                  <ChevronRight size={16} color="#727883" />
                </button>
              </>
            )}
          </div>
        </div>

        {recoveryModal}
      </>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <div>
          <div style={styles.eyebrow}>PRIVATE NOTES</div>

          <h1 style={styles.titleSmall}>Notes</h1>

          <div style={styles.subtle}>{notes.length} saved notes</div>
        </div>

        <div style={styles.headerActions}>
          {!recoveryEnabled && (
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => setShowRecoverySetup(true)}
            >
              <Fingerprint size={14} />
              Enable passkey recovery
            </button>
          )}

          <button
            type="button"
            style={styles.secondaryButton}
            onClick={openChangePassword}
          >
            <ShieldCheck size={14} />
            Change password
          </button>

          <button
            type="button"
            style={styles.secondaryButton}
            onClick={lockVault}
          >
            <Lock size={14} />
            Lock
          </button>

          <button
            type="button"
            style={styles.primaryCompactButton}
            onClick={openNew}
          >
            <Plus size={15} />
            New note
          </button>
        </div>
      </div>

      <div style={styles.searchRow}>
        <Search size={15} color="#626873" />

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes…"
          style={styles.searchInput}
        />
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}

      <div style={styles.contentGrid}>
        <div style={styles.listPanel}>
          {filteredNotes.length === 0 ? (
            <div style={styles.emptyState}>
              <FileText size={24} color="#4FE36B" />

              <div style={styles.emptyTitle}>
                {notes.length === 0 ? "Your notes are empty" : "Nothing found"}
              </div>

              <div style={styles.emptyCopy}>
                {notes.length === 0
                  ? "Create your first private note."
                  : "Try another search term."}
              </div>

              {notes.length === 0 && (
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={openNew}
                >
                  <Plus size={14} />
                  New note
                </button>
              )}
            </div>
          ) : (
            filteredNotes.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => setSelectedId(note.id)}
                style={{
                  ...styles.noteRow,
                  background:
                    selectedId === note.id ? "#20242B" : "transparent",
                }}
              >
                <div style={styles.noteIcon}>
                  {note.pinned ? <Pin size={14} /> : <FileText size={14} />}
                </div>

                <div style={styles.rowText}>
                  <div style={styles.rowTitle}>{note.title}</div>

                  <div style={styles.rowMeta}>
                    {String(note.content || "")
                      .replace(/\s+/g, " ")
                      .slice(0, 70) || "Empty note"}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <div style={styles.detailPanel}>
          {selected ? (
            <>
              <div style={styles.detailHeader}>
                <div>
                  <div style={styles.detailEyebrow}>PRIVATE NOTE</div>

                  <h2 style={styles.detailTitle}>{selected.title}</h2>
                </div>

                <div style={styles.detailActions}>
                  <button
                    type="button"
                    style={styles.iconButton}
                    onClick={() => togglePin(selected.id)}
                    title={selected.pinned ? "Unpin" : "Pin"}
                  >
                    {selected.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                  </button>

                  <button
                    type="button"
                    style={styles.iconButton}
                    onClick={() => openEdit(selected)}
                    title="Edit"
                  >
                    <Pencil size={15} />
                  </button>

                  <button
                    type="button"
                    style={styles.iconButton}
                    onClick={() => deleteNote(selected.id)}
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div style={styles.noteContent}>{selected.content}</div>

              <div style={styles.detailFooter}>
                <ShieldCheck size={14} />
                Encrypted note • decrypted only while unlocked
              </div>
            </>
          ) : (
            <div style={styles.noSelection}>
              <FileText size={28} color="#4FE36B" />

              <div style={styles.emptyTitle}>Select a note</div>

              <div style={styles.emptyCopy}>
                Your decrypted notes stay in memory only while the vault is
                unlocked.
              </div>
            </div>
          )}
        </div>
      </div>

      {showRecoverySetup && (
        <div style={styles.overlay}>
          <div style={styles.formModal}>
            <button
              type="button"
              style={styles.modalClose}
              onClick={() => {
                setShowRecoverySetup(false);
                setError("");
              }}
            >
              <X size={17} />
            </button>

            <div style={styles.iconLargeSmall}>
              <Fingerprint size={22} />
            </div>

            <div style={styles.detailEyebrow}>PASSKEY RECOVERY</div>

            <h2 style={styles.formTitle}>Enable passkey recovery</h2>

            <p style={styles.copy}>
              Your existing Pocket passkey will protect a recovery copy of the
              notes vault encryption key.
            </p>

            <div style={styles.notice}>
              <ShieldCheck size={16} />
              <span>
                Your notes never leave the encrypted vault. Passkey recovery
                only protects the vault encryption key.
              </span>
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <button
              type="button"
              style={styles.primaryButton}
              disabled={recoveryBusy}
              onClick={enablePasskeyRecovery}
            >
              {recoveryBusy ? "Waiting for passkey…" : "Continue with passkey"}
            </button>
          </div>
        </div>
      )}

      {recoveryMode === "reset" && (
        <div style={styles.overlay}>
          <div style={styles.formModal}>
            <button
              type="button"
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

            <h2 style={styles.formTitle}>Reset notes password</h2>

            <p style={styles.copy}>
              Your passkey verified your identity. Choose a new password for
              your existing notes vault.
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
                Your old notes password is not required after passkey
                verification.
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
              type="button"
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

            <div style={styles.detailEyebrow}>PRIVATE NOTES</div>

            <h2 style={styles.formTitle}>Change vault password</h2>

            <p style={styles.copy}>
              Your notes will remain encrypted while the vault protection is
              changed.
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
                Your notes stay encrypted. Only the vault key protection is
                changed.
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
              type="button"
              style={styles.modalClose}
              onClick={() => {
                setShowForm(false);
                setEditing(null);
                setForm({
                  title: "",
                  content: "",
                });
                setError("");
              }}
            >
              <X size={17} />
            </button>

            <div style={styles.iconLargeSmall}>
              <FileText size={22} />
            </div>

            <div style={styles.detailEyebrow}>PRIVATE NOTE</div>

            <h2 style={styles.formTitle}>
              {editing ? "Edit note" : "New note"}
            </h2>

            <label style={styles.label}>Title</label>

            <input
              value={form.title}
              onChange={(e) =>
                setForm({
                  ...form,
                  title: e.target.value,
                })
              }
              placeholder="Shopping list"
              style={styles.input}
              autoFocus
            />

            <label style={styles.label}>Note</label>

            <textarea
              value={form.content}
              onChange={(e) =>
                setForm({
                  ...form,
                  content: e.target.value,
                })
              }
              placeholder="Write your note…"
              style={styles.textareaLarge}
              rows={12}
            />

            {error && <div style={styles.error}>{error}</div>}

            <button
              type="button"
              style={styles.primaryButton}
              disabled={busy}
              onClick={saveNote}
            >
              {busy ? "Saving…" : editing ? "Save changes" : "Save note"}
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

  textareaLarge: {
    width: "100%",
    boxSizing: "border-box",
    resize: "vertical",
    padding: 12,
    marginBottom: 14,
    background: "#14161B",
    border: "1px solid #2A2E37",
    borderRadius: 7,
    color: "#ECEAE3",
    outline: "none",
    fontSize: 12,
    lineHeight: 1.6,
    fontFamily: "Inter, sans-serif",
    minHeight: 250,
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

  recoveryDivider: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "12px 0",
    color: "#555B64",
    fontSize: 9,
    letterSpacing: "0.12em",
    fontWeight: 600,
  },

  recoveryDividerLine: {
    flex: 1,
    height: 1,
    background: "#292D35",
  },

  recoveryButton: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "11px 12px",
    background: "#181B20",
    border: "1px solid #303640",
    borderRadius: 9,
    color: "#D6D8D4",
    cursor: "pointer",
    textAlign: "left",
    boxSizing: "border-box",
  },

  recoveryButtonIcon: {
    width: 32,
    height: 32,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    background: "#20251F",
    color: "#4FE36B",
  },

  recoveryButtonText: {
    flex: 1,
    minWidth: 0,
  },

  recoveryButtonTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: "#E3E4DF",
  },

  recoveryButtonSubtitle: {
    marginTop: 3,
    fontSize: 10,
    color: "#727883",
  },

  recoveryWaitingCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: 12,
    marginBottom: 14,
    borderRadius: 9,
    background: "#15181D",
    border: "1px solid #2A2E37",
  },

  recoveryWaitingIcon: {
    width: 34,
    height: 34,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    background: "#20251F",
    color: "#4FE36B",
  },

  recoveryWaitingTitle: {
    color: "#E3E4DF",
    fontSize: 11,
    fontWeight: 600,
  },

  recoveryWaitingCopy: {
    marginTop: 3,
    color: "#727883",
    fontSize: 10,
    lineHeight: 1.4,
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

  contentGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(240px,.85fr) minmax(0,1.5fr)",
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

  noteRow: {
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

  noteIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    background: "#20242B",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#4FE36B",
    flexShrink: 0,
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

  noteContent: {
    color: "#D9D7D0",
    fontSize: 12,
    lineHeight: 1.7,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
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
    width: "min(560px, calc(100vw - 40px))",
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

  passwordInputWrap: {
    position: "relative",
    marginBottom: 14,
  },

  passwordToggle: {
    position: "absolute",
    right: 6,
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
