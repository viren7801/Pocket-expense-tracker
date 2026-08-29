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
  Bold,
  Italic,
  Heading2,
  List,
  ListChecks,
  Quote,
  Code2,
  Undo2,
  Redo2,
  Bell,
  Folder,
  FolderPlus,
  CalendarDays,
  SlidersHorizontal,
  Repeat,
  Pause,
  Play,
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

function getNextReminderOccurrence(value, recurrence) {
  if (!value || !recurrence || recurrence === "none") {
    return value || null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  if (recurrence === "daily") {
    date.setUTCDate(date.getUTCDate() + 1);
  } else if (recurrence === "weekly") {
    date.setUTCDate(date.getUTCDate() + 7);
  } else if (recurrence === "monthly") {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);

    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();

    date.setUTCDate(Math.min(day, lastDay));
  }

  return date.toISOString();
}

function reminderRecurrenceLabel(note) {
  return note?.recurrence === "daily"
    ? "Daily"
    : note?.recurrence === "weekly"
      ? "Weekly"
      : note?.recurrence === "monthly"
        ? "Monthly"
        : "Once";
}

export default function NotesView({ vault, onVaultChange }) {
  const isDevelopment = import.meta.env.DEV;

  const [phase, setPhase] = useState(vault ? "locked" : "setup");

  const [password, setPassword] = useState("");

  const [confirmPassword, setConfirmPassword] = useState("");

  const [notes, setNotes] = useState([]);

  const [selectedFolder, setSelectedFolder] = useState("all");

  const [selectedTag, setSelectedTag] = useState("all");

  const [sortMode, setSortMode] = useState("updated");

  const [showSortMenu, setShowSortMenu] = useState(false);

  const [showReminderCenter, setShowReminderCenter] = useState(false);

  const [notificationsEnabled, setNotificationsEnabled] = useState(
    typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted",
  );

  const notificationTimerRef = useRef(null);

  const notifiedReminderIdsRef = useRef(new Set());

  const [folders, setFolders] = useState(() => [
    {
      id: "personal",
      name: "Personal",
    },
    {
      id: "work",
      name: "Work",
    },
    {
      id: "ideas",
      name: "Ideas",
    },
  ]);

  const [showFolderForm, setShowFolderForm] = useState(false);

  const [newFolderName, setNewFolderName] = useState("");

  const [tagInput, setTagInput] = useState("");

  const [formTags, setFormTags] = useState([]);

  const [formReminder, setFormReminder] = useState("");

  const [formNotifyTelegram, setFormNotifyTelegram] = useState(false);

  const [telegramConnected, setTelegramConnected] = useState(false);

  const [telegramUsername, setTelegramUsername] = useState("");

  const [showTelegramConnect, setShowTelegramConnect] = useState(false);

  const [telegramConnectUrl, setTelegramConnectUrl] = useState("");

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

  const contentInputRef = useRef(null);

  const autosaveTimerRef = useRef(null);

  const [editorStatus, setEditorStatus] = useState("Saved");

  const [form, setForm] = useState({
    title: "",
    content: "",
  });

  const recoveryEnabled = Boolean(
    vault?.version === 2 && vault?.passkeyWraps?.length,
  );

  React.useEffect(() => {
    if (!showForm || !editing?.id || editorStatus !== "Unsaved changes") {
      return undefined;
    }

    window.clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveExistingNote(form.content);
    }, 1200);

    return () => window.clearTimeout(autosaveTimerRef.current);
  }, [form.content, form.title, editing?.id, showForm, editorStatus]);

  const availableTags = useMemo(() => {
    const all = new Set();

    notes.forEach((note) => {
      (Array.isArray(note.tags) ? note.tags : []).forEach((tag) => {
        if (tag) all.add(tag);
      });
    });

    return Array.from(all).sort((a, b) => a.localeCompare(b));
  }, [notes]);

  const reminderCenterItems = useMemo(
    () =>
      notes
        .filter((note) => Boolean(note.reminderAt))
        .sort(
          (a, b) =>
            new Date(a.reminderAt).getTime() - new Date(b.reminderAt).getTime(),
        ),
    [notes],
  );

  const activeReminderCount = reminderCenterItems.filter(
    (note) => !note.reminderPaused,
  ).length;

  const upcomingReminderCount = useMemo(() => {
    const now = Date.now();
    const sevenDays = now + 7 * 24 * 60 * 60 * 1000;

    return notes.filter((note) => {
      if (!note.reminderAt) return false;
      const time = new Date(note.reminderAt).getTime();

      return !Number.isNaN(time) && time >= now && time <= sevenDays;
    }).length;
  }, [notes]);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();

    const result = notes.filter((note) => {
      const inFolder =
        selectedFolder === "all"
          ? true
          : selectedFolder === "pinned"
            ? Boolean(note.pinned)
            : note.folderId === selectedFolder;

      if (!inFolder) {
        return false;
      }

      const inTag =
        selectedTag === "all"
          ? true
          : Array.isArray(note.tags) && note.tags.includes(selectedTag);

      if (!inTag) {
        return false;
      }

      if (!q) {
        return true;
      }

      return [
        note.title,
        note.content,
        ...(Array.isArray(note.tags) ? note.tags : []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });

    return result.sort((a, b) => {
      if (Boolean(b.pinned) !== Boolean(a.pinned)) {
        return b.pinned ? 1 : -1;
      }

      if (sortMode === "title") {
        return String(a.title || "").localeCompare(String(b.title || ""));
      }

      if (sortMode === "created") {
        return (
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime()
        );
      }

      if (sortMode === "reminder") {
        const aTime = a.reminderAt
          ? new Date(a.reminderAt).getTime()
          : Infinity;
        const bTime = b.reminderAt
          ? new Date(b.reminderAt).getTime()
          : Infinity;

        return aTime - bTime;
      }

      return (
        new Date(b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.updatedAt || a.createdAt || 0).getTime()
      );
    });
  }, [notes, query, selectedFolder, selectedTag, sortMode]);

  const selected = notes.find((note) => note.id === selectedId) || null;

  async function checkTelegramConnection() {
    try {
      const response = await fetch("/api/telegram?action=status");

      const data = await response.json();

      if (!response.ok) {
        setTelegramConnected(false);
        setTelegramUsername("");
        return false;
      }

      setTelegramConnected(Boolean(data.connected));

      setTelegramUsername(data.username || data.firstName || "");

      return Boolean(data.connected);
    } catch {
      setTelegramConnected(false);
      setTelegramUsername("");
      return false;
    }
  }

  async function connectTelegram() {
    setError("");

    try {
      const response = await fetch("/api/telegram?action=connect", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not start Telegram connection.");
      }

      setTelegramConnectUrl(data.url || "");
      setShowTelegramConnect(true);

      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setError(e.message || "Could not connect Telegram.");
    }
  }

  async function disconnectTelegram() {
    try {
      const response = await fetch("/api/telegram?action=disconnect", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not disconnect Telegram.");
      }

      setTelegramConnected(false);
      setTelegramUsername("");
      setTelegramConnectUrl("");
      setShowTelegramConnect(false);
      setError("");
    } catch (e) {
      setError(e.message || "Could not disconnect Telegram.");
    }
  }

  async function enableNotifications() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setError("This browser does not support notifications.");
      return false;
    }

    try {
      const permission = await Notification.requestPermission();

      if (permission === "granted") {
        setNotificationsEnabled(true);
        setError("");
        return true;
      }

      setNotificationsEnabled(false);
      setError(
        "Notifications were not enabled. Allow them in your browser settings.",
      );
      return false;
    } catch {
      setError("Could not request notification permission.");
      return false;
    }
  }

  async function showReminderNotification(note) {
    if (typeof window === "undefined" || note.notifyTelegram) {
      return;
    }

    if (
      !("Notification" in window) ||
      Notification.permission !== "granted" ||
      notifiedReminderIdsRef.current.has(note.id)
    ) {
      return;
    }

    notifiedReminderIdsRef.current.add(note.id);

    try {
      const notification = new Notification("Pocket Notes", {
        body: `Reminder: ${note.title}`,
        tag: `pocket-note-${note.id}`,
      });

      notification.onclick = () => {
        window.focus();
        setSelectedId(note.id);
        setSelectedFolder("all");
        setSelectedTag("all");
        notification.close();
      };
    } catch {
      // Browser notifications may be unavailable.
    }
  }

  React.useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) {
      return undefined;
    }

    const checkReminders = () => {
      const now = Date.now();

      notes.forEach((note) => {
        if (!note.reminderAt || note.reminderPaused) {
          return;
        }

        const reminderTime = new Date(note.reminderAt).getTime();

        if (!Number.isNaN(reminderTime) && reminderTime <= now) {
          showReminderNotification(note);
        }
      });
    };

    checkReminders();

    window.clearInterval(notificationTimerRef.current);

    notificationTimerRef.current = window.setInterval(
      checkReminders,
      30 * 1000,
    );

    return () => window.clearInterval(notificationTimerRef.current);
  }, [notes]);

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
        folders,
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
      setFolders(
        Array.isArray(vault?.folders)
          ? vault.folders
          : [
              { id: "personal", name: "Personal" },
              { id: "work", name: "Work" },
              { id: "ideas", name: "Ideas" },
            ],
      );
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
          folders,
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

  function updateNoteContent(value) {
    setForm((current) => ({
      ...current,
      content: value,
    }));
    setEditorStatus("Unsaved changes");
  }

  function insertAtCursor(before, after = "", placeholder = "text") {
    const textarea = contentInputRef.current;
    if (!textarea) return;

    const current = form.content || "";
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const selected = current.slice(start, end) || placeholder;

    const next =
      current.slice(0, start) + before + selected + after + current.slice(end);

    updateNoteContent(next);

    requestAnimationFrame(() => {
      textarea.focus();
      const selectionStart = start + before.length;
      const selectionEnd = selectionStart + selected.length;
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function insertLinePrefix(prefix) {
    const textarea = contentInputRef.current;
    if (!textarea) return;

    const current = form.content || "";
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;

    const lineStart = current.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const foundLineEnd = current.indexOf("\n", end);
    const lineEnd = foundLineEnd === -1 ? current.length : foundLineEnd;

    const block = current.slice(lineStart, lineEnd);
    const nextBlock = block
      .split("\n")
      .map((line) => (line.startsWith(prefix) ? line : prefix + line))
      .join("\n");

    const next =
      current.slice(0, lineStart) + nextBlock + current.slice(lineEnd);

    updateNoteContent(next);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(
        lineStart + prefix.length,
        lineStart + nextBlock.length,
      );
    });
  }

  function handleEditorKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      insertAtCursor("**", "**", "bold text");
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
      e.preventDefault();
      insertAtCursor("_", "_", "italic text");
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      insertAtCursor("  ", "", "");
    }
  }

  async function autosaveExistingNote(nextContent) {
    if (!editing?.id || !sessionPasswordRef.current) {
      return;
    }

    const updatedAt = new Date().toISOString();

    const nextNotes = notes.map((note) =>
      note.id === editing.id
        ? {
            ...note,
            title: form.title.trim() || note.title,
            content: nextContent,
            tags: [...formTags],
            reminderAt: formReminder || null,
            notifyTelegram: Boolean(
              formReminder && formNotifyTelegram && telegramConnected,
            ),
            updatedAt,
          }
        : note,
    );

    try {
      setEditorStatus("Saving…");

      if (vault?.version === 2) {
        const dataKey = await unwrapDataKeyWithPassword(
          vault.passwordWrap,
          sessionPasswordRef.current,
        );

        const data = await encryptNotesWithDataKey(nextNotes, dataKey);

        onVaultChange({
          ...vault,
          data,
          folders,
        });
      } else {
        const envelope = await encryptLegacyNotes(
          nextNotes,
          sessionPasswordRef.current,
          vault?.salt,
        );

        onVaultChange(envelope);
      }

      setNotes(nextNotes);

      const savedNote = nextNotes.find((note) => note.id === editing.id);

      await syncTelegramReminder(savedNote);

      setEditorStatus("Saved");
    } catch {
      setEditorStatus("Save failed");
    }
  }

  async function persistFolderChange(nextFolders, nextNotes = notes) {
    const activePassword = sessionPasswordRef.current;

    if (!activePassword) {
      setError("Unlock the notes vault before changing folders.");
      return;
    }

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
          folders: nextFolders,
        });
      } else {
        const envelope = await encryptLegacyNotes(
          nextNotes.map((note) => ({
            ...note,
            folderId: note.folderId || null,
          })),
          activePassword,
          vault?.salt,
        );

        onVaultChange(envelope);
      }

      setFolders(nextFolders);
      setNotes(nextNotes);
      setError("");
    } catch {
      setError("Could not save folder changes.");
    }
  }

  async function createFolder() {
    const name = newFolderName.trim();

    if (!name) {
      setError("Enter a folder name.");
      return;
    }

    if (
      folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase())
    ) {
      setError("A folder with that name already exists.");
      return;
    }

    const folder = {
      id: makeId(),
      name,
    };

    await persistFolderChange([...folders, folder]);

    setSelectedFolder(folder.id);

    setNewFolderName("");
    setShowFolderForm(false);
  }

  async function moveSelectedNote(folderId) {
    if (!selected) return;

    const nextNotes = notes.map((note) =>
      note.id === selected.id
        ? {
            ...note,
            folderId: folderId === "all" ? null : folderId,
            updatedAt: new Date().toISOString(),
          }
        : note,
    );

    await persistFolderChange(folders, nextNotes);
  }

  async function pauseReminder(note) {
    const nextNotes = notes.map((current) =>
      current.id === note.id
        ? {
            ...current,
            reminderPaused: true,
            updatedAt: new Date().toISOString(),
          }
        : current,
    );

    await persistNotes(nextNotes);
    await fetch("/api/telegram?action=cancel-reminder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        noteId: note.id,
      }),
    });

    setError("");
  }

  async function resumeReminder(note) {
    let reminderAt = note.reminderAt;

    if (note.recurrence && note.recurrence !== "none") {
      let guard = 0;

      while (
        reminderAt &&
        new Date(reminderAt).getTime() <= Date.now() &&
        guard < 370
      ) {
        reminderAt = getNextReminderOccurrence(reminderAt, note.recurrence);
        guard += 1;
      }
    }

    const nextNote = {
      ...note,
      reminderAt,
      reminderPaused: false,
      updatedAt: new Date().toISOString(),
    };

    const nextNotes = notes.map((current) =>
      current.id === note.id ? nextNote : current,
    );

    await persistNotes(nextNotes);
    await syncTelegramReminder(nextNote);
    setError("");
  }

  async function cancelReminder(note) {
    const nextNotes = notes.map((current) =>
      current.id === note.id
        ? {
            ...current,
            reminderAt: null,
            reminderPaused: false,
            notifyTelegram: false,
            recurrence: "none",
            updatedAt: new Date().toISOString(),
          }
        : current,
    );

    await persistNotes(nextNotes);

    await fetch("/api/telegram?action=cancel-reminder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        noteId: note.id,
      }),
    });

    setError("");
  }

  function openReminderFromCenter(note) {
    setSelectedId(note.id);
    setSelectedFolder("all");
    setSelectedTag("all");
    setShowReminderCenter(false);
  }

  async function syncTelegramReminder(note) {
    if (!note?.id) {
      return;
    }

    try {
      if (note.notifyTelegram && note.reminderAt && !note.reminderPaused) {
        const response = await fetch("/api/telegram?action=schedule-reminder", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            noteId: note.id,
            title: note.title,
            reminderAt: note.reminderAt,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "Could not schedule Telegram reminder.",
          );
        }
      } else {
        await fetch("/api/telegram?action=cancel-reminder", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            noteId: note.id,
          }),
        });
      }
    } catch (e) {
      setError(e.message || "Could not sync Telegram reminder.");
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

    if (formNotifyTelegram && !telegramConnected) {
      setError(
        "Connect Telegram before saving a reminder with Telegram notifications.",
      );
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
                tags: [...formTags],
                reminderAt: formReminder || null,
                notifyTelegram: Boolean(
                  formReminder && formNotifyTelegram && telegramConnected,
                ),
                updatedAt: now,
              }
            : note,
        )
      : [
          {
            id: makeId(),
            title: form.title.trim(),
            content: form.content,
            tags: [...formTags],
            reminderAt: formReminder || null,
            notifyTelegram: Boolean(
              formReminder && formNotifyTelegram && telegramConnected,
            ),
            pinned: false,
            folderId:
              selectedFolder === "all" || selectedFolder === "pinned"
                ? null
                : selectedFolder,
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

    const savedNote = next.find(
      (note) => note.id === (editing?.id || next[0]?.id),
    );

    await syncTelegramReminder(savedNote);

    setEditorStatus("Saved");
  }

  function addTag() {
    const tag = tagInput.trim().replace(/^#/, "").replace(/\s+/g, " ");

    if (!tag) return;

    const exists = formTags.some(
      (item) => item.toLowerCase() === tag.toLowerCase(),
    );

    if (!exists) {
      setFormTags([...formTags, tag]);
    }

    setTagInput("");
  }

  function removeTag(tag) {
    setFormTags(formTags.filter((item) => item !== tag));
  }

  function openNew() {
    setError("");
    setEditing(null);

    setForm({
      title: "",
      content: "",
    });

    setFormTags([]);
    setFormReminder("");
    setTagInput("");
    setEditorStatus("New note");
    setShowForm(true);
  }

  function openEdit(note) {
    setError("");
    setEditing(note);

    setForm({
      title: note.title || "",
      content: note.content || "",
    });

    setFormTags(Array.isArray(note.tags) ? [...note.tags] : []);

    setFormReminder(
      note.reminderAt ? String(note.reminderAt).slice(0, 16) : "",
    );

    setFormNotifyTelegram(Boolean(note.notifyTelegram));

    setEditorStatus("Saved");
    setShowForm(true);
  }

  async function deleteNote(id) {
    try {
      await fetch("/api/telegram?action=cancel-reminder", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          noteId: id,
        }),
      });
    } catch {
      // Deleting the note can still proceed.
    }

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

          <div style={styles.filterToolbar}>
            <div style={styles.tagFilterScroll}>
              {availableTags.length > 0 && (
                <>
                  <span style={styles.filterLabel}>Tags</span>

                  <button
                    type="button"
                    style={{
                      ...styles.folderChip,
                      ...(selectedTag === "all" ? styles.folderChipActive : {}),
                    }}
                    onClick={() => setSelectedTag("all")}
                  >
                    All
                  </button>

                  {availableTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      style={{
                        ...styles.folderChip,
                        ...(selectedTag === tag ? styles.folderChipActive : {}),
                      }}
                      onClick={() => setSelectedTag(tag)}
                    >
                      #{tag}
                    </button>
                  ))}
                </>
              )}
            </div>

            <div style={styles.sortWrap}>
              <button
                type="button"
                style={styles.sortButton}
                onClick={() => setShowSortMenu((value) => !value)}
              >
                <SlidersHorizontal size={14} />
                Sort
              </button>

              {showSortMenu && (
                <div style={styles.sortMenu}>
                  {[
                    ["updated", "Recently updated"],
                    ["created", "Recently created"],
                    ["title", "Title"],
                    ["reminder", "Reminder"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      style={{
                        ...styles.sortMenuItem,
                        ...(sortMode === value
                          ? styles.sortMenuItemActive
                          : {}),
                      }}
                      onClick={() => {
                        setSortMode(value);
                        setShowSortMenu(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {upcomingReminderCount > 0 && (
            <div style={styles.reminderSummary}>
              <CalendarDays size={13} />
              {upcomingReminderCount} upcoming reminder
              {upcomingReminderCount === 1 ? "" : "s"}
            </div>
          )}

          <div style={styles.folderBar}>
            <div style={styles.folderScroll}>
              <button
                type="button"
                style={{
                  ...styles.folderChip,
                  ...(selectedFolder === "all" ? styles.folderChipActive : {}),
                }}
                onClick={() => setSelectedFolder("all")}
              >
                <FileText size={13} />
                All Notes
              </button>

              <button
                type="button"
                style={{
                  ...styles.folderChip,
                  ...(selectedFolder === "pinned"
                    ? styles.folderChipActive
                    : {}),
                }}
                onClick={() => setSelectedFolder("pinned")}
              >
                <Pin size={13} />
                Pinned
              </button>

              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  style={{
                    ...styles.folderChip,
                    ...(selectedFolder === folder.id
                      ? styles.folderChipActive
                      : {}),
                  }}
                  onClick={() => setSelectedFolder(folder.id)}
                >
                  <Folder size={13} />
                  {folder.name}
                </button>
              ))}

              <button
                type="button"
                style={styles.folderAddButton}
                onClick={() => {
                  setNewFolderName("");
                  setError("");
                  setShowFolderForm(true);
                }}
                title="New folder"
              >
                <FolderPlus size={14} />
              </button>
            </div>
          </div>

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
            onClick={() => setShowReminderCenter(true)}
          >
            <CalendarDays size={14} />
            Reminders
            {activeReminderCount > 0 && (
              <span style={styles.reminderCountPill}>
                {activeReminderCount}
              </span>
            )}
          </button>

          <button
            type="button"
            style={styles.secondaryButton}
            onClick={
              telegramConnected
                ? () => setShowTelegramConnect(true)
                : connectTelegram
            }
          >
            <Bell size={14} />
            {telegramConnected ? "Telegram connected" : "Connect Telegram"}
          </button>

          <button
            type="button"
            style={styles.secondaryButton}
            onClick={enableNotifications}
          >
            <Bell size={14} />
            {notificationsEnabled ? "Notifications on" : "Enable notifications"}
          </button>

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

                  <div style={styles.metadataRow}>
                    {(Array.isArray(selected.tags) ? selected.tags : []).map(
                      (tag) => (
                        <span key={tag} style={styles.tagBadge}>
                          #{tag}
                        </span>
                      ),
                    )}

                    {selected.reminderAt && (
                      <span style={styles.reminderBadge}>
                        <CalendarDays size={11} />
                        {new Date(selected.reminderAt).toLocaleString(
                          undefined,
                          {
                            dateStyle: "medium",
                            timeStyle: "short",
                          },
                        )}
                      </span>
                    )}

                    {selected.reminderAt && selected.notifyTelegram && (
                      <span style={styles.telegramBadge}>Telegram</span>
                    )}
                  </div>
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

                  <select
                    value={selected.folderId || ""}
                    onChange={(e) => moveSelectedNote(e.target.value || "all")}
                    style={styles.folderSelect}
                    title="Move to folder"
                  >
                    <option value="">No folder</option>

                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>

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

      {showReminderCenter && (
        <div style={styles.overlay}>
          <div
            style={{
              ...styles.formModal,
              maxWidth: 760,
              width: "min(760px, calc(100vw - 32px))",
            }}
          >
            <button
              type="button"
              style={styles.modalClose}
              onClick={() => setShowReminderCenter(false)}
            >
              <X size={17} />
            </button>

            <div style={styles.detailEyebrow}>REMINDER CENTER</div>

            <h2 style={styles.formTitle}>Reminders</h2>

            <p style={styles.copy}>
              View and manage all your upcoming note reminders.
            </p>

            {error && <div style={styles.error}>{error}</div>}

            {reminderCenterItems.length === 0 ? (
              <div style={styles.reminderCenterEmpty}>
                <CalendarDays size={28} />
                <strong>No reminders yet</strong>
                <span>Add a reminder from a note to see it here.</span>
              </div>
            ) : (
              <div style={styles.reminderCenterList}>
                {reminderCenterItems.map((note) => {
                  const date = new Date(note.reminderAt);
                  const paused = Boolean(note.reminderPaused);

                  return (
                    <div
                      key={note.id}
                      style={{
                        ...styles.reminderCenterRow,
                        ...(paused ? styles.reminderCenterRowPaused : {}),
                      }}
                    >
                      <button
                        type="button"
                        style={styles.reminderCenterMain}
                        onClick={() => openReminderFromCenter(note)}
                      >
                        <span style={styles.reminderCenterIcon}>
                          <CalendarDays size={15} />
                        </span>

                        <span style={styles.reminderCenterContent}>
                          <span style={styles.reminderCenterTitle}>
                            {note.title}
                          </span>

                          <span style={styles.reminderCenterDate}>
                            {Number.isNaN(date.getTime())
                              ? "Invalid reminder date"
                              : date.toLocaleString(undefined, {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })}
                          </span>

                          <span style={styles.reminderCenterMeta}>
                            <span style={styles.reminderCenterBadge}>
                              {note.notifyTelegram ? "Telegram" : "Browser"}
                            </span>

                            <span style={styles.reminderCenterBadge}>
                              {reminderRecurrenceLabel(note)}
                            </span>

                            {paused && (
                              <span style={styles.reminderPausedBadge}>
                                Paused
                              </span>
                            )}
                          </span>
                        </span>
                      </button>

                      <div style={styles.reminderCenterActions}>
                        <button
                          type="button"
                          style={styles.reminderActionButton}
                          onClick={() => openEdit(note)}
                          title="Edit reminder"
                        >
                          <Pencil size={14} />
                        </button>

                        <button
                          type="button"
                          style={styles.reminderActionButton}
                          onClick={() =>
                            paused ? resumeReminder(note) : pauseReminder(note)
                          }
                          title={paused ? "Resume reminder" : "Pause reminder"}
                        >
                          {paused ? <Play size={14} /> : <Pause size={14} />}
                        </button>

                        <button
                          type="button"
                          style={{
                            ...styles.reminderActionButton,
                            ...styles.reminderDeleteButton,
                          }}
                          onClick={() => cancelReminder(note)}
                          title="Cancel reminder"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              style={styles.secondaryFullButton}
              onClick={() => {
                setShowReminderCenter(false);
                setEditing(null);
                setForm({
                  title: "",
                  content: "",
                });
                setFormTags([]);
                setFormReminder("");
                setFormNotifyTelegram(false);
                setShowForm(true);
                setError("");
              }}
            >
              <Plus size={15} />
              New note
            </button>
          </div>
        </div>
      )}

      {showTelegramConnect && (
        <div style={styles.overlay}>
          <div style={styles.smallFormModal}>
            <button
              type="button"
              style={styles.modalClose}
              onClick={() => {
                setShowTelegramConnect(false);
                setTelegramConnectUrl("");
                setError("");
              }}
            >
              <X size={17} />
            </button>

            <div style={styles.iconLargeSmall}>
              <Bell size={22} />
            </div>

            <div style={styles.detailEyebrow}>TELEGRAM CONNECTION</div>

            <h2 style={styles.formTitle}>
              {telegramConnected ? "Telegram connected" : "Connect Telegram"}
            </h2>

            {telegramConnected ? (
              <>
                <p style={styles.copy}>
                  Pocket can send Notes reminders to your Telegram chat.
                </p>

                {telegramUsername && (
                  <div style={styles.telegramConnectedCard}>
                    <Bell size={15} />
                    <span>
                      Connected as <strong>{telegramUsername}</strong>
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  style={styles.primaryButton}
                  onClick={disconnectTelegram}
                >
                  Disconnect Telegram
                </button>
              </>
            ) : (
              <>
                <div style={styles.telegramSteps}>
                  <div style={styles.telegramStep}>
                    <span style={styles.telegramStepNumber}>1</span>
                    <span>Open the Pocket Telegram bot.</span>
                  </div>

                  <div style={styles.telegramStep}>
                    <span style={styles.telegramStepNumber}>2</span>
                    <span>
                      Press <strong>Start</strong> in Telegram.
                    </span>
                  </div>

                  <div style={styles.telegramStep}>
                    <span style={styles.telegramStepNumber}>3</span>
                    <span>Return to Pocket and press Check connection.</span>
                  </div>
                </div>

                {error && <div style={styles.error}>{error}</div>}

                <button
                  type="button"
                  style={styles.primaryButton}
                  disabled={!telegramConnectUrl}
                  onClick={() => {
                    if (telegramConnectUrl) {
                      window.open(
                        telegramConnectUrl,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }
                  }}
                >
                  Open Telegram
                </button>

                <button
                  type="button"
                  style={styles.secondaryFullButton}
                  onClick={async () => {
                    const connected = await checkTelegramConnection();

                    if (!connected) {
                      setError(
                        "Telegram is not connected yet. Press Start in the bot, then check again.",
                      );
                    } else {
                      setError("");
                    }
                  }}
                >
                  Check connection
                </button>
              </>
            )}
          </div>
        </div>
      )}

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

      {showFolderForm && (
        <div style={styles.overlay}>
          <div style={styles.smallFormModal}>
            <button
              type="button"
              style={styles.modalClose}
              onClick={() => {
                setShowFolderForm(false);
                setNewFolderName("");
                setError("");
              }}
            >
              <X size={17} />
            </button>

            <div style={styles.iconLargeSmall}>
              <FolderPlus size={22} />
            </div>

            <div style={styles.detailEyebrow}>NOTE ORGANIZATION</div>

            <h2 style={styles.formTitle}>New folder</h2>

            <p style={styles.copy}>
              Create a folder to keep related private notes together.
            </p>

            <label style={styles.label}>Folder name</label>

            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  createFolder();
                }
              }}
              placeholder="Travel"
              style={styles.input}
              autoFocus
            />

            {error && <div style={styles.error}>{error}</div>}

            <button
              type="button"
              style={styles.primaryButton}
              onClick={createFolder}
            >
              Create folder
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
                setFormTags([]);
                setFormReminder("");
                setFormNotifyTelegram(false);
                setTagInput("");
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

            <label style={styles.label}>Tags</label>

            <div style={styles.tagsEditor}>
              {formTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  style={styles.editTagChip}
                  onClick={() => removeTag(tag)}
                  title="Remove tag"
                >
                  #{tag}
                  <X size={11} />
                </button>
              ))}

              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                placeholder="Add tag…"
                style={styles.tagInput}
              />
            </div>

            <label style={styles.label}>Reminder</label>

            <div style={styles.reminderInputRow}>
              <CalendarDays size={14} color="#68707A" />

              <input
                type="datetime-local"
                value={formReminder}
                onChange={(e) => setFormReminder(e.target.value)}
                style={styles.reminderInput}
              />

              {formReminder && (
                <button
                  type="button"
                  style={styles.clearReminderButton}
                  onClick={() => setFormReminder("")}
                >
                  Clear
                </button>
              )}
            </div>

            <label style={styles.telegramOption}>
              <input
                type="checkbox"
                checked={formNotifyTelegram}
                onChange={(e) => setFormNotifyTelegram(e.target.checked)}
              />

              <span style={styles.telegramOptionText}>
                <span style={styles.telegramOptionTitle}>
                  Notify me on Telegram
                </span>

                <span style={styles.telegramOptionSub}>
                  {formNotifyTelegram
                    ? telegramConnected
                      ? "This reminder will be sent only to Telegram."
                      : "Telegram is not connected yet. Connect it before saving this reminder."
                    : "Leave unchecked to use browser notifications."}
                </span>
              </span>
            </label>

            <div style={styles.reminderHint}>
              {formNotifyTelegram
                ? "Telegram reminders are delivered by the server, even when Pocket is closed."
                : notificationsEnabled
                  ? "Browser notifications are enabled on this device."
                  : "Enable notifications to receive reminders while Pocket is open."}
            </div>

            <div style={styles.editorHeader}>
              <label
                style={{
                  ...styles.label,
                  marginBottom: 0,
                }}
              >
                Note
              </label>

              <span style={styles.editorStatus}>{editorStatus}</span>
            </div>

            <div style={styles.editorShell}>
              <div style={styles.editorToolbar}>
                <button
                  type="button"
                  title="Bold"
                  style={styles.editorTool}
                  onClick={() => insertAtCursor("**", "**", "bold text")}
                >
                  <Bold size={14} />
                </button>

                <button
                  type="button"
                  title="Italic"
                  style={styles.editorTool}
                  onClick={() => insertAtCursor("_", "_", "italic text")}
                >
                  <Italic size={14} />
                </button>

                <button
                  type="button"
                  title="Heading"
                  style={styles.editorTool}
                  onClick={() => insertLinePrefix("## ")}
                >
                  <Heading2 size={14} />
                </button>

                <span style={styles.editorToolbarDivider} />

                <button
                  type="button"
                  title="Bullet list"
                  style={styles.editorTool}
                  onClick={() => insertLinePrefix("• ")}
                >
                  <List size={14} />
                </button>

                <button
                  type="button"
                  title="Checklist"
                  style={styles.editorTool}
                  onClick={() => insertLinePrefix("☐ ")}
                >
                  <ListChecks size={14} />
                </button>

                <button
                  type="button"
                  title="Quote"
                  style={styles.editorTool}
                  onClick={() => insertLinePrefix("> ")}
                >
                  <Quote size={14} />
                </button>

                <button
                  type="button"
                  title="Code"
                  style={styles.editorTool}
                  onClick={() => insertAtCursor("`", "`", "code")}
                >
                  <Code2 size={14} />
                </button>

                <span style={styles.editorToolbarDivider} />

                <button
                  type="button"
                  title="Undo"
                  style={styles.editorTool}
                  onClick={() => document.execCommand("undo")}
                >
                  <Undo2 size={14} />
                </button>

                <button
                  type="button"
                  title="Redo"
                  style={styles.editorTool}
                  onClick={() => document.execCommand("redo")}
                >
                  <Redo2 size={14} />
                </button>
              </div>

              <textarea
                ref={contentInputRef}
                value={form.content}
                onChange={(e) => updateNoteContent(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                placeholder="Write your note…"
                style={styles.editorTextarea}
                rows={14}
                spellCheck
              />

              <div style={styles.editorFooter}>
                <span>{form.content.length} characters</span>

                <span>
                  {form.content
                    ? form.content.trim().split(/\s+/).filter(Boolean).length
                    : 0}{" "}
                  words
                </span>

                <span style={{ flex: 1 }} />

                <span>⌘/Ctrl+B bold · ⌘/Ctrl+I italic</span>
              </div>
            </div>

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

  editorHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 7,
  },

  editorStatus: {
    color: "#626A73",
    fontSize: 9,
  },

  editorShell: {
    border: "1px solid #2A2E37",
    borderRadius: 9,
    background: "#14161B",
    overflow: "hidden",
    marginBottom: 14,
  },

  editorToolbar: {
    display: "flex",
    alignItems: "center",
    gap: 3,
    padding: 7,
    borderBottom: "1px solid #292D35",
    background: "#171A1F",
    flexWrap: "wrap",
  },

  editorTool: {
    width: 29,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid transparent",
    borderRadius: 6,
    background: "transparent",
    color: "#858B95",
    cursor: "pointer",
  },

  editorToolbarDivider: {
    width: 1,
    height: 18,
    margin: "0 4px",
    background: "#2A2E37",
  },

  editorTextarea: {
    width: "100%",
    boxSizing: "border-box",
    resize: "vertical",
    minHeight: 320,
    border: "none",
    outline: "none",
    padding: "13px 14px 10px",
    background: "transparent",
    color: "#ECEAE3",
    fontSize: 12,
    lineHeight: 1.75,
    fontFamily: "Inter, sans-serif",
  },

  editorFooter: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "7px 10px",
    borderTop: "1px solid #242830",
    color: "#555C66",
    fontSize: 9,
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

  folderBar: {
    marginBottom: 12,
  },

  folderScroll: {
    display: "flex",
    gap: 7,
    overflowX: "auto",
    paddingBottom: 2,
  },

  folderChip: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 10px",
    border: "1px solid #2A2E37",
    borderRadius: 7,
    background: "#171A1F",
    color: "#8D929B",
    fontSize: 10,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  folderChipActive: {
    background: "#20251F",
    border: "1px solid #314537",
    color: "#82A48B",
  },

  folderAddButton: {
    width: 30,
    height: 30,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #2A2E37",
    borderRadius: 7,
    background: "#171A1F",
    color: "#838993",
    cursor: "pointer",
  },

  folderSelect: {
    height: 32,
    maxWidth: 140,
    padding: "0 8px",
    border: "1px solid #2C313A",
    borderRadius: 7,
    background: "#181B20",
    color: "#9AA0A9",
    fontSize: 10,
    outline: "none",
  },

  footerDot: {
    color: "#424850",
    marginLeft: 2,
  },

  smallFormModal: {
    width: "min(430px, calc(100vw - 40px))",
    background: "#1A1D24",
    border: "1px solid #30343D",
    borderRadius: 15,
    padding: 24,
    position: "relative",
    boxSizing: "border-box",
    boxShadow: "0 30px 90px rgba(0,0,0,.5)",
  },

  filterToolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 9,
  },

  tagFilterScroll: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    minWidth: 0,
  },

  filterLabel: {
    color: "#555C66",
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    marginRight: 2,
  },

  sortWrap: {
    position: "relative",
    flexShrink: 0,
  },

  sortButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid #2D323B",
    borderRadius: 7,
    padding: "7px 9px",
    background: "#181B20",
    color: "#9AA0A9",
    fontSize: 10,
    cursor: "pointer",
  },

  sortMenu: {
    position: "absolute",
    top: "calc(100% + 5px)",
    right: 0,
    zIndex: 40,
    width: 165,
    padding: 5,
    border: "1px solid #30343D",
    borderRadius: 8,
    background: "#1A1D24",
    boxShadow: "0 16px 40px rgba(0,0,0,.35)",
  },

  sortMenuItem: {
    display: "block",
    width: "100%",
    border: "none",
    borderRadius: 6,
    padding: "8px 9px",
    background: "transparent",
    color: "#8E949E",
    fontSize: 10,
    textAlign: "left",
    cursor: "pointer",
  },

  sortMenuItemActive: {
    background: "#20251F",
    color: "#B5C9BA",
  },

  reminderCountPill: {
    minWidth: 17,
    height: 17,
    padding: "0 5px",
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#20251F",
    color: "#8EB596",
    fontSize: 9,
    fontWeight: 700,
  },

  reminderCenterList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    maxHeight: "52vh",
    overflowY: "auto",
    margin: "12px 0 16px",
  },

  reminderCenterRow: {
    display: "flex",
    alignItems: "stretch",
    gap: 10,
    padding: 10,
    border: "1px solid #2A2E37",
    borderRadius: 9,
    background: "#14161B",
  },

  reminderCenterRowPaused: {
    opacity: 0.58,
  },

  reminderCenterMain: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    border: "none",
    background: "transparent",
    color: "#ECEAE3",
    textAlign: "left",
    cursor: "pointer",
    padding: 0,
  },

  reminderCenterIcon: {
    flexShrink: 0,
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    background: "#18231B",
    color: "#4FE36B",
  },

  reminderCenterContent: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },

  reminderCenterTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "#ECEAE3",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  reminderCenterDate: {
    fontSize: 10,
    color: "#7F858F",
  },

  reminderCenterMeta: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
  },

  reminderCenterBadge: {
    padding: "4px 6px",
    borderRadius: 5,
    background: "#20242B",
    color: "#8A919B",
    fontSize: 9,
  },

  reminderPausedBadge: {
    padding: "4px 6px",
    borderRadius: 5,
    background: "#2B2520",
    color: "#B99876",
    fontSize: 9,
  },

  reminderCenterActions: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
  },

  reminderActionButton: {
    width: 30,
    height: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #2D323B",
    borderRadius: 7,
    background: "#181B20",
    color: "#8D949E",
    cursor: "pointer",
  },

  reminderDeleteButton: {
    color: "#C37A6A",
  },

  reminderCenterEmpty: {
    minHeight: 210,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    gap: 9,
    margin: "14px 0 18px",
    border: "1px dashed #30343D",
    borderRadius: 10,
    color: "#69717B",
  },

  reminderSummary: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "#788C7D",
    background: "#151A17",
    border: "1px solid #27352D",
    borderRadius: 7,
    padding: "7px 9px",
    marginBottom: 9,
    fontSize: 10,
  },

  metadataRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
    marginTop: 8,
  },

  tagBadge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 6px",
    borderRadius: 5,
    background: "#20242B",
    color: "#7E8690",
    fontSize: 9,
  },

  reminderBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 7px",
    borderRadius: 5,
    background: "#19231C",
    color: "#7F9A86",
    fontSize: 9,
  },

  tagsEditor: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    flexWrap: "wrap",
    minHeight: 38,
    padding: "5px 7px",
    marginBottom: 14,
    border: "1px solid #2A2E37",
    borderRadius: 7,
    background: "#14161B",
  },

  editTagChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "5px 6px",
    border: "none",
    borderRadius: 5,
    background: "#20242B",
    color: "#A3A8B0",
    fontSize: 9,
    cursor: "pointer",
  },

  tagInput: {
    flex: 1,
    minWidth: 140,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#ECEAE3",
    fontSize: 10,
    padding: "5px 4px",
  },

  telegramOption: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "9px 10px",
    marginBottom: 14,
    border: "1px solid #2A2E37",
    borderRadius: 7,
    background: "#14161B",
    cursor: "pointer",
    userSelect: "none",
  },

  telegramOptionText: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },

  telegramOptionTitle: {
    color: "#C9CDD2",
    fontSize: 10,
    fontWeight: 600,
  },

  telegramOptionSub: {
    color: "#606772",
    fontSize: 9,
    lineHeight: 1.4,
  },

  telegramBadge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 7px",
    borderRadius: 5,
    background: "#20252F",
    color: "#8795AD",
    fontSize: 9,
  },

  reminderHint: {
    marginTop: -8,
    marginBottom: 14,
    color: "#5C6870",
    fontSize: 9,
    lineHeight: 1.4,
  },

  reminderInputRow: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "6px 8px",
    marginBottom: 14,
    border: "1px solid #2A2E37",
    borderRadius: 7,
    background: "#14161B",
  },

  reminderInput: {
    flex: 1,
    minWidth: 0,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#C8CBD0",
    fontSize: 10,
    colorScheme: "dark",
  },

  clearReminderButton: {
    border: "none",
    background: "transparent",
    color: "#737A84",
    fontSize: 9,
    cursor: "pointer",
    padding: "4px 5px",
  },

  telegramSteps: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    margin: "4px 0 16px",
  },

  telegramStep: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    padding: "9px 10px",
    border: "1px solid #292E36",
    borderRadius: 8,
    background: "#15181D",
    color: "#949AA4",
    fontSize: 10,
    lineHeight: 1.45,
  },

  telegramStepNumber: {
    width: 20,
    height: 20,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    background: "#20251F",
    color: "#4FE36B",
    fontSize: 9,
    fontWeight: 700,
  },

  telegramConnectedCard: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 11px",
    margin: "2px 0 16px",
    border: "1px solid #27352D",
    borderRadius: 8,
    background: "#151A17",
    color: "#7E9B88",
    fontSize: 10,
  },

  secondaryFullButton: {
    width: "100%",
    border: "1px solid #2D323B",
    borderRadius: 8,
    padding: "10px 14px",
    marginTop: 8,
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
