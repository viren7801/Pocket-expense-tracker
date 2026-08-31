import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Archive,
  Folder,
  FolderPlus,
  CalendarDays,
  SlidersHorizontal,
  Repeat,
  Pause,
  Play,
  Upload,
  Download,
  Share2,
  Ban,
  Copy,
  Paperclip,
  Keyboard,
  Files,
  Check,
  Link2,
  History,
  Clock3,
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

const RECURRENCE_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function localReminderToISO(value) {
  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoToLocalDateTime(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (number) => String(number).padStart(2, "0");

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function defaultRecurrenceDay(value, recurrence) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  if (recurrence === "weekly") {
    return String(date.getDay());
  }

  if (recurrence === "monthly") {
    return String(date.getDate());
  }

  return "";
}

function recurrenceLabel(recurrence, recurrenceDay) {
  if (recurrence === "daily") {
    return "Every day";
  }

  if (recurrence === "weekly") {
    const day = Number(recurrenceDay);

    return Number.isInteger(day) && RECURRENCE_WEEKDAYS[day]
      ? `Every ${RECURRENCE_WEEKDAYS[day]}`
      : "Every week";
  }

  if (recurrence === "monthly") {
    const day = Number(recurrenceDay);

    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return "Every month";
    }

    const suffix =
      day % 100 >= 11 && day % 100 <= 13
        ? "th"
        : day % 10 === 1
          ? "st"
          : day % 10 === 2
            ? "nd"
            : day % 10 === 3
              ? "rd"
              : "th";

    return `Every ${day}${suffix}`;
  }

  return "Does not repeat";
}

function normalizeRecurrenceDays(days) {
  if (!Array.isArray(days)) {
    return [];
  }

  return Array.from(
    new Set(
      days
        .map(Number)
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    ),
  ).sort((a, b) => a - b);
}

function weekdayList(days) {
  const normalized = normalizeRecurrenceDays(days);

  return normalized.length
    ? normalized.map((day) => RECURRENCE_WEEKDAYS[day]).join(", ")
    : "";
}

function recurrenceIntervalLabel(recurrence, interval, unit) {
  if (recurrence !== "custom") {
    return "";
  }

  const amount = Math.max(1, Number(interval) || 1);

  const label =
    unit === "weeks"
      ? amount === 1
        ? "week"
        : "weeks"
      : unit === "months"
        ? amount === 1
          ? "month"
          : "months"
        : amount === 1
          ? "day"
          : "days";

  return `Every ${amount} ${label}`;
}

const NOTE_TEMPLATES = [
  {
    id: "blank",
    name: "Blank note",
    description: "Start from scratch",
    title: "",
    content: "",
    tags: [],
  },
  {
    id: "meeting",
    name: "Meeting notes",
    description: "Agenda, notes, decisions, actions",
    title: "Meeting notes",
    content:
      "## Agenda\n\n- \n\n## Notes\n\n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] ",
    tags: ["meeting"],
  },
  {
    id: "daily-log",
    name: "Daily log",
    description: "Quick daily reflection",
    title: "Daily log",
    content:
      "## Today\n\n\n## Wins\n\n- \n\n## Blockers\n\n- \n\n## Tomorrow\n\n- ",
    tags: ["daily"],
  },
  {
    id: "checklist",
    name: "Checklist",
    description: "Simple reusable checklist",
    title: "Checklist",
    content: "## Checklist\n\n- [ ] \n- [ ] \n- [ ] ",
    tags: ["checklist"],
  },
  {
    id: "idea",
    name: "Idea",
    description: "Capture and develop an idea",
    title: "Idea",
    content: "## Idea\n\n\n## Why it matters\n\n\n## Next step\n\n- [ ] ",
    tags: ["idea"],
  },
  {
    id: "project",
    name: "Project plan",
    description: "Goal, tasks, risks, next steps",
    title: "Project plan",
    content:
      "## Goal\n\n\n## Tasks\n\n- [ ] \n\n## Risks\n\n- \n\n## Next steps\n\n- [ ] ",
    tags: ["project"],
  },
];

export default function NotesView({ vault, onVaultChange }) {
  const isDevelopment = import.meta.env.DEV;

  const [phase, setPhase] = useState(vault ? "locked" : "setup");

  const [password, setPassword] = useState("");

  const [confirmPassword, setConfirmPassword] = useState("");

  const [notes, setNotes] = useState([]);

  const [selectedFolder, setSelectedFolder] = useState("all");

  const [selectedTag, setSelectedTag] = useState("all");
  const [searchPinnedOnly, setSearchPinnedOnly] = useState(false);
  const [searchHasReminder, setSearchHasReminder] = useState(false);
  const [showSearchFilters, setShowSearchFilters] = useState(false);
  const [showArchivedNotes, setShowArchivedNotes] = useState(false);
  const [showTrash, setShowTrash] = useState(false);

  const [sortMode, setSortMode] = useState("updated");

  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAutoLockMenu, setShowAutoLockMenu] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(0);
  const autoLockTimerRef = useRef(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showNoteExportMenu, setShowNoteExportMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareAccess, setShareAccess] = useState("link");
  const [sharePermission, setSharePermission] = useState("read-only");
  const [shareExpiration, setShareExpiration] = useState("never");
  const [shareCreated, setShareCreated] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [sharedLinks, setSharedLinks] = useState([]);
  const [showShareManager, setShowShareManager] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [noteCopied, setNoteCopied] = useState(false);
  const [shareManagerBusy, setShareManagerBusy] = useState(false);
  const [shareNow, setShareNow] = useState(Date.now());
  const [shareCopied, setShareCopied] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [newNoteTemplateId, setNewNoteTemplateId] = useState("blank");
  const [customTemplates, setCustomTemplates] = useState([]);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [templateEditingId, setTemplateEditingId] = useState(null);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateTags, setTemplateTags] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState([]);
  const [importFileName, setImportFileName] = useState("");
  const [importFormat, setImportFormat] = useState("");
  const [importDuplicateMode, setImportDuplicateMode] = useState("skip");
  const [importSelectedIds, setImportSelectedIds] = useState([]);
  const [importBusy, setImportBusy] = useState(false);

  const [showReminderCenter, setShowReminderCenter] = useState(false);
  const [showReminderHistory, setShowReminderHistory] = useState(false);
  const [reminderHistory, setReminderHistory] = useState([]);
  const [reminderHistoryLoading, setReminderHistoryLoading] = useState(false);
  const [reminderHistoryError, setReminderHistoryError] = useState("");
  const [reminderHistoryQuery, setReminderHistoryQuery] = useState("");
  const [reminderHistoryFilter, setReminderHistoryFilter] = useState("all");
  const [reminderQuery, setReminderQuery] = useState("");
  const [reminderFilter, setReminderFilter] = useState("all");
  const [reminderSort, setReminderSort] = useState("soonest");

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
  const [showTagManager, setShowTagManager] = useState(false);
  const [tagManagerName, setTagManagerName] = useState("");
  const [tagManagerBusy, setTagManagerBusy] = useState(false);

  const [newFolderName, setNewFolderName] = useState("");

  const [tagInput, setTagInput] = useState("");

  const [formTags, setFormTags] = useState([]);

  const [formReminder, setFormReminder] = useState("");

  const [formRecurrence, setFormRecurrence] = useState("none");
  const [formRecurrenceDay, setFormRecurrenceDay] = useState("");
  const [formRecurrenceDays, setFormRecurrenceDays] = useState([]);

  const [formRecurrenceInterval, setFormRecurrenceInterval] = useState(1);

  const [formRecurrenceUnit, setFormRecurrenceUnit] = useState("days");

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
  const editorLoadKeyRef = useRef("");
  const attachmentInputRef = useRef(null);

  const autosaveTimerRef = useRef(null);

  const [editorStatus, setEditorStatus] = useState("Saved");

  const [form, setForm] = useState({
    title: "",
    content: "",
  });
  const [editorHtml, setEditorHtml] = useState("");
  const [formAttachments, setFormAttachments] = useState([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [isAttachmentDragging, setIsAttachmentDragging] = useState(false);

  const recoveryEnabled = Boolean(
    vault?.version === 2 && vault?.passkeyWraps?.length,
  );

  React.useEffect(() => {
    if (!showForm || !editing?.id || editorStatus !== "Unsaved changes") {
      return undefined;
    }

    window.clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveExistingNote(form.content, formAttachments);
    }, 1200);

    return () => window.clearTimeout(autosaveTimerRef.current);
  }, [
    form.content,
    form.title,
    formAttachments,
    editing?.id,
    showForm,
    editorStatus,
  ]);

  useEffect(() => {
    if (phase !== "unlocked" || !autoLockMinutes) {
      clearAutoLockTimer();
      return undefined;
    }

    const events = ["mousedown", "keydown", "touchstart", "scroll"];

    const activityHandler = () => {
      handleActivityForAutoLock();
    };

    events.forEach((eventName) =>
      window.addEventListener(eventName, activityHandler, {
        passive: true,
      }),
    );

    resetAutoLockTimer();

    return () => {
      events.forEach((eventName) =>
        window.removeEventListener(eventName, activityHandler),
      );
      clearAutoLockTimer();
    };
  }, [phase, autoLockMinutes]);

  // NotesView keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (event) => {
      if (phase !== "unlocked") {
        return;
      }

      const target = event.target;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      if (event.key === "Escape") {
        setShowShortcuts(false);
        setShowSortMenu(false);
        setShowExportMenu(false);
        setShowNoteExportMenu(false);
        setShowAutoLockMenu(false);
        setShowTemplateMenu(false);
        setShowShareManager(false);
        setShowVersionHistory(false);
        setShowTagManager(false);
        setShowFolderForm(false);
        return;
      }

      if (event.key === "?" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setShowShortcuts(true);
        return;
      }

      if (!event.metaKey && !event.ctrlKey) {
        return;
      }

      const key = String(event.key || "").toLowerCase();

      if (typing) {
        return;
      }

      if (key === "n") {
        event.preventDefault();
        setError("");
        setEditing(null);
        setForm({
          title: "",
          content: "",
        });
        setFormTags([]);
        setFormAttachments([]);
        setFormReminder("");
        setFormRecurrence("none");
        setFormRecurrenceDay("");
        setFormRecurrenceDays([]);
        setFormRecurrenceInterval(1);
        setFormRecurrenceUnit("days");
        setFormNotifyTelegram(false);
        setTagInput("");
        setEditorStatus("New note");
        setShowForm(true);
        return;
      }

      if (key === "f") {
        event.preventDefault();

        window.setTimeout(() => {
          const input = document.querySelector(
            'input[placeholder="Search notes…"]',
          );

          if (input) {
            input.focus();
            input.select?.();
          }
        }, 0);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [phase]);

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

  const reminderCenterFilteredItems = useMemo(() => {
    const now = Date.now();
    const todayEnd = (() => {
      const date = new Date();
      date.setHours(23, 59, 59, 999);
      return date.getTime();
    })();

    const query = reminderQuery.trim().toLowerCase();

    let items = reminderCenterItems.filter((note) => {
      const reminderTime = new Date(note.reminderAt).getTime();

      const channel = note.notifyTelegram ? "telegram" : "browser";

      const paused = Boolean(note.reminderPaused);

      if (
        query &&
        ![note.title, note.content]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query)
      ) {
        return false;
      }

      if (reminderFilter === "today") {
        if (Number.isNaN(reminderTime) || reminderTime > todayEnd) {
          return false;
        }

        const day = new Date(reminderTime);

        const nowDate = new Date();

        return (
          day.getFullYear() === nowDate.getFullYear() &&
          day.getMonth() === nowDate.getMonth() &&
          day.getDate() === nowDate.getDate()
        );
      }

      if (reminderFilter === "upcoming") {
        return !Number.isNaN(reminderTime) && reminderTime >= now;
      }

      if (reminderFilter === "paused") {
        return paused;
      }

      if (reminderFilter === "telegram") {
        return channel === "telegram";
      }

      if (reminderFilter === "browser") {
        return channel === "browser";
      }

      return true;
    });

    return items.sort((a, b) => {
      if (reminderSort === "latest") {
        return (
          new Date(b.reminderAt).getTime() - new Date(a.reminderAt).getTime()
        );
      }

      if (reminderSort === "recurring") {
        const aRecurring = a.recurrence && a.recurrence !== "none" ? 0 : 1;
        const bRecurring = b.recurrence && b.recurrence !== "none" ? 0 : 1;

        if (aRecurring !== bRecurring) {
          return aRecurring - bRecurring;
        }
      }

      return (
        new Date(a.reminderAt).getTime() - new Date(b.reminderAt).getTime()
      );
    });
  }, [reminderCenterItems, reminderQuery, reminderFilter, reminderSort]);

  const upcomingReminderCount = useMemo(() => {
    const now = Date.now();
    const sevenDays = now + 7 * 24 * 60 * 60 * 1000;

    return notes.filter((note) => {
      if (!note.reminderAt) return false;
      const time = new Date(note.reminderAt).getTime();

      return !Number.isNaN(time) && time >= now && time <= sevenDays;
    }).length;
  }, [notes]);

  const importDuplicateCount = useMemo(() => {
    if (!Array.isArray(importPreview) || !importPreview.length) {
      return 0;
    }

    return importPreview.filter((note) =>
      notes.some(
        (existing) =>
          String(existing.title || "")
            .trim()
            .toLowerCase() ===
            String(note.title || "")
              .trim()
              .toLowerCase() &&
          String(existing.content || "").trim() ===
            String(note.content || "").trim(),
      ),
    ).length;
  }, [importPreview, notes]);

  const importNewCount = Math.max(
    0,
    importPreview.length - importDuplicateCount,
  );

  const importSelectedCount = importSelectedIds.length;

  const filteredReminderHistory = useMemo(() => {
    const query = reminderHistoryQuery.trim().toLowerCase();

    return reminderHistory.filter((item) => {
      const actionMatch =
        reminderHistoryFilter === "all" ||
        item.action === reminderHistoryFilter;

      const text =
        `${item.title || ""} ${item.detail || ""} ${item.note_id || ""}`.toLowerCase();

      return actionMatch && (!query || text.includes(query));
    });
  }, [reminderHistory, reminderHistoryQuery, reminderHistoryFilter]);

  function renderSearchHighlight(value, searchValue) {
    const text = String(value || "");

    const search = String(searchValue || "").trim();

    if (!search) {
      return text || "Empty note";
    }

    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const parts = text.split(new RegExp(`(${escaped})`, "ig"));

    return parts.map((part, index) =>
      part.toLowerCase() === search.toLowerCase() ? (
        <mark key={`${part}-${index}`} style={styles.searchHighlight}>
          {part}
        </mark>
      ) : (
        <span key={`${part}-${index}`}>{part}</span>
      ),
    );
  }

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();

    const result = notes.filter((note) => {
      if (showTrash) {
        if (!note.trashed) {
          return false;
        }
      } else if (note.trashed) {
        return false;
      }

      // All Notes = every non-trashed note, including archived notes.
      // Archived = only archived, non-trashed notes.
      if (showArchivedNotes && !note.archived) {
        return false;
      }

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

      if (searchPinnedOnly && !Boolean(note.pinned)) {
        return false;
      }

      if (searchHasReminder && !Boolean(note.reminderAt)) {
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
  }, [
    notes,
    query,
    selectedFolder,
    selectedTag,
    searchPinnedOnly,
    searchHasReminder,
    sortMode,
    showArchivedNotes,
    showTrash,
  ]);

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
      setCustomTemplates(
        Array.isArray(vault?.customTemplates) ? vault.customTemplates : [],
      );

      const savedSharedLinks = Array.isArray(vault?.sharedLinks)
        ? vault.sharedLinks
        : [];

      // Legacy shares created before management tokens existed cannot be
      // copied/revoked from the Share Manager. They were removed from the
      // database separately, so keep them out of the UI as well.
      const managedSharedLinks = savedSharedLinks.filter((link) =>
        Boolean(link?.managementToken),
      );

      setSharedLinks(managedSharedLinks);

      if (managedSharedLinks.length !== savedSharedLinks.length) {
        setTimeout(() => {
          onVaultChange({
            ...vault,
            sharedLinks: managedSharedLinks,
          });
        }, 0);
      }

      setAutoLockMinutes(
        Number.isInteger(Number(vault?.autoLockMinutes))
          ? Math.max(0, Number(vault?.autoLockMinutes))
          : 0,
      );

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

  function clearAutoLockTimer() {
    if (autoLockTimerRef.current) {
      window.clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = null;
    }
  }

  function resetAutoLockTimer() {
    clearAutoLockTimer();

    if (phase !== "unlocked" || !autoLockMinutes) {
      return;
    }

    autoLockTimerRef.current = window.setTimeout(
      () => {
        clearAutoLockTimer();
        lockVault();
      },
      autoLockMinutes * 60 * 1000,
    );
  }

  function handleActivityForAutoLock() {
    if (phase === "unlocked" && autoLockMinutes) {
      resetAutoLockTimer();
    }
  }

  function setAutoLockDuration(minutes) {
    const value = Math.max(0, Number(minutes) || 0);

    setAutoLockMinutes(value);
    setShowAutoLockMenu(false);

    if (vault?.version === 2) {
      onVaultChange({
        ...vault,
        autoLockMinutes: value,
      });
    }

    resetAutoLockTimer();
    setError("");
  }

  function lockVault() {
    clearAutoLockTimer();
    setShowAutoLockMenu(false);
    sessionPasswordRef.current = "";

    recoveredDataKeyRef.current = null;

    setNotes([]);
    setCustomTemplates([]);
    setSharedLinks([]);
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

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function markdownToEditorHtml(value) {
    const source = String(value || "");

    if (!source) {
      return "";
    }

    return source
      .split("\n")
      .map((line) => {
        if (line.startsWith("## ")) {
          return `<h2>${escapeHtml(line.slice(3))}</h2>`;
        }

        if (line.startsWith("> ")) {
          return `<blockquote>${escapeHtml(line.slice(2))}</blockquote>`;
        }

        if (line.startsWith("• ")) {
          return `<div>• ${escapeHtml(line.slice(2))}</div>`;
        }

        if (line.startsWith("☐ ")) {
          return `<div>☐ ${escapeHtml(line.slice(2))}</div>`;
        }

        let html = escapeHtml(line);

        html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

        html = html.replace(/_(.+?)_/g, "<em>$1</em>");

        html = html.replace(/`(.+?)`/g, "<code>$1</code>");

        return `<div>${html || "<br />"}</div>`;
      })
      .join("");
  }

  function editorHtmlToMarkdown(root) {
    if (!root) {
      return "";
    }

    const convertInline = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue || "";
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
      }

      const tag = node.tagName.toLowerCase();

      const inner = Array.from(node.childNodes).map(convertInline).join("");

      if (tag === "strong" || tag === "b") {
        return `**${inner}**`;
      }

      if (tag === "em" || tag === "i") {
        return `_${inner}_`;
      }

      if (tag === "code") {
        return `\`${inner}\``;
      }

      return inner;
    };

    const blocks = Array.from(root.children || []);

    if (!blocks.length) {
      return convertInline(root);
    }

    return blocks
      .map((block) => {
        const tag = block.tagName.toLowerCase();

        const text = convertInline(block).replace(/\u00a0/g, " ");

        if (tag === "h2") {
          return `## ${text}`;
        }

        if (tag === "blockquote") {
          return `> ${text}`;
        }

        return text;
      })
      .join("\n");
  }

  function syncEditorFromHtml(element) {
    const html = element?.innerHTML || "";

    setEditorHtml(html);

    updateNoteContent(editorHtmlToMarkdown(element));
  }

  function focusEditor() {
    requestAnimationFrame(() => {
      contentInputRef.current?.focus();
    });
  }

  function toggleInlineFormat(command) {
    contentInputRef.current?.focus();

    document.execCommand(command, false);

    if (contentInputRef.current) {
      syncEditorFromHtml(contentInputRef.current);
    }
  }

  useEffect(() => {
    if (!showForm || !contentInputRef.current) {
      return;
    }

    const loadKey = `${editing?.id || "new"}:${showForm}`;

    if (editorLoadKeyRef.current === loadKey) {
      return;
    }

    editorLoadKeyRef.current = loadKey;

    contentInputRef.current.innerHTML = editorHtml || "";

    requestAnimationFrame(() => {
      contentInputRef.current?.focus();

      if (!editing?.id && contentInputRef.current) {
        const selection = window.getSelection();

        const range = document.createRange();

        range.selectNodeContents(contentInputRef.current);
        range.collapse(false);

        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    });
  }, [showForm, editing?.id, editorHtml]);

  function updateNoteContent(value) {
    setForm((current) => ({
      ...current,
      content: value,
    }));
    setEditorStatus("Unsaved changes");
  }

  function insertAtCursor(before, after = "", placeholder = "text") {
    const editor = contentInputRef.current;

    if (!editor) {
      return;
    }

    editor.focus();

    const selection = window.getSelection();

    if (!selection || !selection.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (!editor.contains(range.commonAncestorContainer)) {
      return;
    }

    const selectedText = selection.toString() || placeholder;

    const replacement = `${before}${selectedText}${after}`;

    range.deleteContents();
    range.insertNode(document.createTextNode(replacement));

    range.collapse(false);

    selection.removeAllRanges();
    selection.addRange(range);

    syncEditorFromHtml(editor);
  }

  function insertLinePrefix(prefix) {
    const editor = contentInputRef.current;

    if (!editor) {
      return;
    }

    editor.focus();

    if (prefix === "## ") {
      document.execCommand("formatBlock", false, "h2");
    } else if (prefix === "> ") {
      document.execCommand("formatBlock", false, "blockquote");
    } else if (prefix === "• ") {
      document.execCommand("insertUnorderedList", false);
    } else if (prefix === "  ") {
      document.execCommand("insertText", false, "  ");
    } else {
      document.execCommand("insertText", false, prefix);
    }

    syncEditorFromHtml(editor);
  }

  function handleEditorKeyDown(e) {
    const command = e.metaKey || e.ctrlKey;

    const key = String(e.key || "").toLowerCase();

    if (command && key === "b") {
      e.preventDefault();
      e.stopPropagation();
      toggleInlineFormat("bold");
      return;
    }

    if (command && key === "i") {
      e.preventDefault();
      e.stopPropagation();
      toggleInlineFormat("italic");
      return;
    }

    if (command && key === "z") {
      e.preventDefault();
      e.stopPropagation();

      // On macOS, Cmd+Shift+Z is redo.
      // Ctrl+Shift+Z is supported as well.
      if (e.shiftKey) {
        document.execCommand("redo", false);
      } else {
        document.execCommand("undo", false);
      }

      syncEditorFromHtml(contentInputRef.current);
      return;
    }

    if (command && key === "y") {
      e.preventDefault();
      e.stopPropagation();

      document.execCommand("redo", false);

      syncEditorFromHtml(contentInputRef.current);
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();

      document.execCommand("insertText", false, "  ");

      syncEditorFromHtml(contentInputRef.current);
    }
  }

  const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

  const MAX_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024;

  function formatAttachmentSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result || ""));

      reader.onerror = () => reject(new Error("Could not read attachment."));

      reader.readAsDataURL(file);
    });
  }

  function handleAttachmentDragOver(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!attachmentBusy) {
      setIsAttachmentDragging(true);
    }
  }

  function handleAttachmentDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!event.currentTarget.contains(event.relatedTarget)) {
      setIsAttachmentDragging(false);
    }
  }

  async function handleAttachmentDrop(event) {
    event.preventDefault();
    event.stopPropagation();

    setIsAttachmentDragging(false);

    if (attachmentBusy) {
      return;
    }

    await addAttachments(event.dataTransfer ? event.dataTransfer.files : null);
  }

  async function addAttachments(fileList) {
    const files = Array.from(fileList || []);

    if (!files.length) {
      return;
    }

    const existingTotal = formAttachments.reduce(
      (sum, item) => sum + Number(item.size || 0),
      0,
    );

    let total = existingTotal;

    setAttachmentBusy(true);
    setError("");

    try {
      const additions = [];

      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          throw new Error(`"${file.name}" is larger than 5 MB.`);
        }

        if (total + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
          throw new Error("Attachments for one note cannot exceed 10 MB.");
        }

        const dataUrl = await fileToDataUrl(file);

        additions.push({
          id: makeId(),
          name: file.name || "Attachment",
          type: file.type || "application/octet-stream",
          size: file.size,
          dataUrl,
          addedAt: new Date().toISOString(),
        });

        total += file.size;
      }

      setFormAttachments((current) => [...current, ...additions]);

      setEditorStatus("Unsaved changes");
    } catch (error) {
      setError(error.message || "Could not add attachment.");
    } finally {
      setAttachmentBusy(false);
    }
  }

  function removeAttachment(id) {
    setFormAttachments((current) => current.filter((item) => item.id !== id));
    setEditorStatus("Unsaved changes");
  }

  function previewAttachmentInNewTab(attachment) {
    if (!attachment?.dataUrl) {
      return;
    }

    try {
      const response = fetch(attachment.dataUrl);

      response
        .then((res) => res.blob())
        .then((blob) => {
          const blobUrl = URL.createObjectURL(blob);

          const link = document.createElement("a");

          link.href = blobUrl;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.style.display = "none";

          document.body.appendChild(link);

          link.click();

          link.remove();

          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        })
        .catch(() => {
          setError(
            "Could not preview this attachment. Try downloading it instead.",
          );
        });
    } catch {
      setError(
        "Could not preview this attachment. Try downloading it instead.",
      );
    }
  }

  function downloadAttachment(attachment) {
    if (!attachment?.dataUrl) {
      return;
    }

    const link = document.createElement("a");
    link.href = attachment.dataUrl;
    link.download = attachment.name || "attachment";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function autosaveExistingNote(
    nextContent,
    nextAttachments = formAttachments,
  ) {
    if (!editing?.id || !sessionPasswordRef.current) {
      return;
    }

    const updatedAt = new Date().toISOString();

    const nextNotes = notes.map((note) => {
      if (note.id !== editing.id) {
        return note;
      }

      const nextTitle = form.title.trim() || note.title || "";

      const nextTags = [...formTags];

      const changed =
        String(note.title || "") !== String(nextTitle) ||
        String(note.content || "") !== String(nextContent || "") ||
        JSON.stringify(Array.isArray(note.tags) ? note.tags : []) !==
          JSON.stringify(nextTags) ||
        JSON.stringify(
          Array.isArray(note.attachments) ? note.attachments : [],
        ) !==
          JSON.stringify(Array.isArray(nextAttachments) ? nextAttachments : []);

      const previousHistory = getNoteHistory(note);

      const nextHistory = changed
        ? [...previousHistory, buildNoteHistoryEntry(note)].slice(-20)
        : previousHistory;

      return {
        ...note,
        title: nextTitle,
        content: nextContent,
        tags: nextTags,
        attachments: Array.isArray(nextAttachments) ? nextAttachments : [],
        history: nextHistory,
        reminderAt: localReminderToISO(formReminder),
        recurrence: formReminder ? formRecurrence : "none",
        recurrenceDay:
          formReminder && formRecurrence === "monthly"
            ? Number(
                formRecurrenceDay ||
                  defaultRecurrenceDay(formReminder, "monthly"),
              )
            : null,
        recurrenceDays:
          formReminder && formRecurrence === "weekly"
            ? normalizeRecurrenceDays(
                formRecurrenceDays.length
                  ? formRecurrenceDays
                  : [Number(defaultRecurrenceDay(formReminder, "weekly"))],
              )
            : [],
        recurrenceInterval:
          formReminder && formRecurrence === "custom"
            ? Math.max(1, Number(formRecurrenceInterval) || 1)
            : null,
        recurrenceUnit:
          formReminder && formRecurrence === "custom"
            ? formRecurrenceUnit
            : null,

        notifyTelegram: Boolean(formReminder && formNotifyTelegram),
        updatedAt,
      };
    });

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

  async function snoozeReminder(note, minutes) {
    if (!note?.id) return;

    try {
      const response = await fetch("/api/telegram?action=snooze-reminder", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          noteId: note.id,
          minutes,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not snooze reminder.");
      }

      const nextNotes = notes.map((current) =>
        current.id === note.id
          ? {
              ...current,
              reminderAt: data.reminderAt,
              updatedAt: new Date().toISOString(),
            }
          : current,
      );

      await persistNotes(nextNotes);
      setError("");
    } catch (e) {
      setError(e.message || "Could not snooze reminder.");
    }
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

  async function loadReminderHistory() {
    setReminderHistoryLoading(true);
    setReminderHistoryError("");

    try {
      const response = await fetch("/api/telegram?action=history", {
        method: "GET",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load reminder history.");
      }

      setReminderHistory(Array.isArray(data.history) ? data.history : []);
    } catch (error) {
      setReminderHistoryError(
        error.message || "Could not load reminder history.",
      );
    } finally {
      setReminderHistoryLoading(false);
    }
  }

  function normalizeImportedNote(raw) {
    const now = new Date().toISOString();

    const sourceId = raw?.id != null ? String(raw.id) : null;

    const title =
      String(raw?.title ?? "Imported note").trim() || "Imported note";

    const content = raw?.content == null ? "" : String(raw.content);

    const tags = Array.isArray(raw?.tags)
      ? Array.from(
          new Set(raw.tags.map((tag) => String(tag).trim()).filter(Boolean)),
        )
      : [];

    return {
      id: makeId(),

      sourceId,

      title,

      content,

      tags,

      pinned: Boolean(raw?.pinned),

      folderId: folders.some((folder) => folder.id === raw?.folderId)
        ? raw.folderId
        : "personal",

      reminderAt: raw?.reminderAt || null,

      recurrence: raw?.recurrence || "none",

      recurrenceDay: raw?.recurrenceDay ?? null,

      recurrenceDays: Array.isArray(raw?.recurrenceDays)
        ? raw.recurrenceDays
        : [],

      recurrenceInterval: raw?.recurrenceInterval ?? null,

      recurrenceUnit: raw?.recurrenceUnit ?? null,

      notifyTelegram: Boolean(raw?.notifyTelegram),

      reminderPaused: Boolean(raw?.reminderPaused),

      createdAt: raw?.createdAt || now,

      updatedAt: raw?.updatedAt || now,
    };
  }

  function parseMarkdownImport(text) {
    const sections = text
      .split(/\n(?=# )/g)
      .map((section) => section.trim())
      .filter(Boolean);

    return sections.map((section) => {
      const lines = section.split("\n");

      const title = lines[0]?.replace(/^#\s*/, "").trim() || "Imported note";

      const body = lines
        .slice(1)
        .join("\n")
        .replace(/\n---\s*$/, "")
        .replace(/\n*\*\*Tags:\*\*.*$/s, "")
        .replace(/\n*\*\*Reminder:\*\*.*$/s, "")
        .trim();

      const tagsMatch = section.match(/\*\*Tags:\*\*\s*(.+)/i);

      const tags = tagsMatch
        ? tagsMatch[1]
            .split(",")
            .map((tag) => tag.trim().replace(/^#/, ""))
            .filter(Boolean)
        : [];

      return {
        title,
        content: body,
        tags,
      };
    });
  }

  function parseCsvImport(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];

      if (char === '"') {
        if (quoted && text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
        continue;
      }

      if (char === "," && !quoted) {
        row.push(cell);
        cell = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && text[i + 1] === "\n") {
          i += 1;
        }

        row.push(cell);
        cell = "";

        if (row.some((value) => value !== "")) {
          rows.push(row);
        }

        row = [];
        continue;
      }

      cell += char;
    }

    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }

    if (rows.length < 2) {
      return [];
    }

    const headers = rows[0].map((header) => header.trim().toLowerCase());

    return rows.slice(1).map((values) => {
      const item = {};

      headers.forEach((header, index) => {
        item[header] = values[index] ?? "";
      });

      return {
        title: item.title || "Imported note",

        content: item.content || "",

        tags: item.tags
          ? item.tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
          : [],

        reminderAt: item.reminder || null,

        recurrence: item.recurrence || "none",

        notifyTelegram: String(item.telegram).toLowerCase() === "yes",

        pinned: String(item.pinned).toLowerCase() === "yes",

        createdAt: item.created || undefined,

        updatedAt: item.updated || undefined,
      };
    });
  }

  async function parseImportedFile(file) {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";

    const text = await file.text();

    let rawNotes = [];

    if (extension === "json") {
      const parsed = JSON.parse(text);

      rawNotes = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.notes)
          ? parsed.notes
          : [];
    } else if (extension === "md" || extension === "markdown") {
      rawNotes = parseMarkdownImport(text);
    } else if (extension === "csv") {
      rawNotes = parseCsvImport(text);
    } else {
      throw new Error("Unsupported file. Use JSON, Markdown, or CSV.");
    }

    const normalized = rawNotes.map(normalizeImportedNote);

    if (!normalized.length) {
      throw new Error("No notes could be found in this file.");
    }

    setImportFileName(file.name);

    setImportFormat(extension);

    setImportPreview(normalized);

    setImportSelectedIds(normalized.map((note) => note.id));

    setImportDuplicateMode("skip");

    setShowImportModal(true);
    setError("");
  }

  function findDuplicate(imported, existingNotes) {
    const importedTitle = imported.title.trim().toLowerCase();

    const importedContent = imported.content.trim();

    return existingNotes.find(
      (note) =>
        note.title?.trim().toLowerCase() === importedTitle &&
        String(note.content || "").trim() === importedContent,
    );
  }

  async function handleImportNotes() {
    const selected = importPreview.filter((note) =>
      importSelectedIds.includes(note.id),
    );

    if (!selected.length) {
      setError("Select at least one note to import.");
      return;
    }

    setImportBusy(true);
    setError("");

    try {
      const additions = [];
      let skipped = 0;

      for (const note of selected) {
        const duplicate = findDuplicate(note, notes);

        if (duplicate && importDuplicateMode === "skip") {
          skipped += 1;
          continue;
        }

        if (duplicate && importDuplicateMode === "replace") {
          // Replace in a second pass below.
          continue;
        }

        additions.push(note);
      }

      let nextNotes = notes.map((existing) => {
        if (importDuplicateMode !== "replace") {
          return existing;
        }

        const replacement = selected.find((note) => {
          const duplicate = findDuplicate(note, [existing]);

          return Boolean(duplicate);
        });

        return replacement
          ? {
              ...replacement,
              id: existing.id,
              updatedAt: new Date().toISOString(),
            }
          : existing;
      });

      if (importDuplicateMode !== "replace") {
        nextNotes = [...nextNotes, ...additions];
      } else {
        const replacedIds = new Set();

        selected.forEach((note) => {
          const duplicate = findDuplicate(note, notes);

          if (duplicate) {
            replacedIds.add(duplicate.id);
          } else {
            nextNotes.push(note);
          }
        });

        // Keep exactly one record for replaced notes.
        const replacementById = new Map();

        selected.forEach((note) => {
          const duplicate = findDuplicate(note, notes);

          if (duplicate) {
            replacementById.set(duplicate.id, {
              ...note,
              id: duplicate.id,
              updatedAt: new Date().toISOString(),
            });
          }
        });

        nextNotes = nextNotes.map(
          (note) => replacementById.get(note.id) || note,
        );
      }

      await persistNotes(nextNotes);

      for (const imported of selected) {
        const duplicate = findDuplicate(imported, notes);

        if (duplicate && importDuplicateMode === "skip") {
          continue;
        }

        if (imported.reminderAt && imported.notifyTelegram) {
          try {
            await syncTelegramReminder(imported);
          } catch {
            // Import should succeed even if Telegram sync fails.
          }
        }
      }

      setShowImportModal(false);
      setImportPreview([]);
      setImportSelectedIds([]);
      setImportFileName("");
      setImportFormat("");

      setError(
        skipped > 0
          ? `Imported ${selected.length - skipped} note(s). Skipped ${skipped} duplicate(s).`
          : `Imported ${selected.length} note(s).`,
      );
    } catch (error) {
      setError(error.message || "Import failed.");
    } finally {
      setImportBusy(false);
    }
  }

  function openTemplateManager() {
    setShowTemplateMenu(false);
    setTemplateEditingId(null);
    setTemplateName("");
    setTemplateDescription("");
    setTemplateTitle("");
    setTemplateTags("");
    setShowTemplateManager(true);
    setError("");
  }

  function startEditCustomTemplate(template) {
    setTemplateEditingId(template.id);
    setTemplateName(template.name || "");
    setTemplateDescription(template.description || "");
    setTemplateTitle(template.title || "");
    setTemplateTags(
      Array.isArray(template.tags) ? template.tags.join(", ") : "",
    );
    setShowTemplateManager(true);
    setShowTemplateMenu(false);
    setError("");
  }

  async function saveCustomTemplate() {
    const name = templateName.trim();

    if (!name) {
      setError("Enter a template name.");
      return;
    }

    const title = templateTitle.trim();

    const description = templateDescription.trim();

    const tags = templateTags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    let next;

    if (templateEditingId) {
      next = customTemplates.map((template) =>
        template.id === templateEditingId
          ? {
              ...template,
              name,
              description,
              title,
              content: form.content || "",
              tags,
            }
          : template,
      );
    } else {
      next = [
        ...customTemplates,
        {
          id: makeId(),
          name,
          description,
          title,
          content: form.content || "",
          tags,
        },
      ];
    }

    setCustomTemplates(next);

    if (vault?.version === 2) {
      onVaultChange({
        ...vault,
        customTemplates: next,
      });
    }

    setTemplateEditingId(null);
    setTemplateName("");
    setTemplateDescription("");
    setTemplateTitle("");
    setTemplateTags("");
    setShowTemplateManager(false);
    setError("");
  }

  async function deleteCustomTemplate(templateId) {
    const next = customTemplates.filter(
      (template) => template.id !== templateId,
    );

    setCustomTemplates(next);

    if (vault?.version === 2) {
      onVaultChange({
        ...vault,
        customTemplates: next,
      });
    }

    setError("");
  }

  function createFromCustomTemplate(template) {
    if (!template) {
      return;
    }

    setForm({
      title: template.title || "",
      content: template.content || "",
    });

    setFormTags(Array.isArray(template.tags) ? template.tags : []);

    setFormReminder("");
    setFormRecurrence("none");
    setFormRecurrenceDay("");
    setFormRecurrenceDays([]);
    setFormRecurrenceInterval(1);
    setFormRecurrenceUnit("days");
    setFormNotifyTelegram(false);
    setShowTemplateMenu(false);
    setShowForm(true);
    setError("");
  }

  function applyNoteTemplate(templateId) {
    const template =
      NOTE_TEMPLATES.find((item) => item.id === templateId) ||
      customTemplates.find((item) => item.id === templateId);

    if (!template) {
      return;
    }

    setForm({
      title: template.title || "",
      content: template.content || "",
    });

    editorLoadKeyRef.current = "";
    setEditorHtml(markdownToEditorHtml(template.content || ""));

    setFormTags(Array.isArray(template.tags) ? template.tags : []);
    setFormAttachments([]);

    setFormReminder("");
    setFormRecurrence("none");
    setFormRecurrenceDay("");
    setFormRecurrenceDays([]);
    setFormRecurrenceInterval(1);
    setFormRecurrenceUnit("days");
    setFormNotifyTelegram(false);
    setError("");
    setShowTemplateMenu(false);
    setShowForm(true);
  }

  function bytesToBase64UrlLocal(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  function formatShareCountdown(expiresAt) {
    if (!expiresAt) {
      return "Never expires";
    }

    const remainingMs = new Date(expiresAt).getTime() - shareNow;

    if (remainingMs <= 0) {
      return "Expired";
    }

    const totalSeconds = Math.floor(remainingMs / 1000);

    const days = Math.floor(totalSeconds / 86400);

    const hours = Math.floor((totalSeconds % 86400) / 3600);

    const minutes = Math.floor((totalSeconds % 3600) / 60);

    const seconds = totalSeconds % 60;

    if (days > 0) {
      return `${days}d ${hours}h remaining`;
    }

    if (hours > 0) {
      return `${hours}h ${minutes}m remaining`;
    }

    return `${minutes}m ${seconds}s remaining`;
  }

  async function createEncryptedShare() {
    if (!selected || selected.trashed) {
      setError("This note cannot be shared.");
      return;
    }

    setShareBusy(true);
    setError("");
    setShareCreated(false);
    setShareUrl("");

    try {
      if (selected.archived) {
        throw new Error("Unarchive the note before creating a share link.");
      }

      const shareKey = crypto.getRandomValues(new Uint8Array(32));

      const key = await crypto.subtle.importKey(
        "raw",
        shareKey,
        {
          name: "AES-GCM",
        },
        false,
        ["encrypt"],
      );

      const iv = crypto.getRandomValues(new Uint8Array(12));

      const payload = {
        title: selected.title || "",
        content: selected.content || "",
        tags: Array.isArray(selected.tags) ? selected.tags : [],
        permission: "read-only",
      };

      const plaintext = new TextEncoder().encode(JSON.stringify(payload));

      const ciphertext = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
        },
        key,
        plaintext,
      );

      const response = await fetch("/api/share-note", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ciphertext: bytesToBase64UrlLocal(new Uint8Array(ciphertext)),
          iv: bytesToBase64UrlLocal(iv),
          expiresIn: shareExpiration,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not create share link.");
      }

      const url = `${window.location.origin}/share/${encodeURIComponent(
        data.shareId,
      )}#${bytesToBase64UrlLocal(shareKey)}`;

      rememberSharedLink({
        shareId: data.shareId,
        managementToken: data.managementToken,
        url,
        expiresAt: data.expiresAt || null,
        revoked: false,
        createdAt: new Date().toISOString(),
        noteId: selected.id,
        title: selected.title || "Untitled note",
      });

      setShareUrl(url);
      setShareCreated(true);
      setError("");
    } catch (error) {
      setError(error.message || "Could not create share link.");
    } finally {
      setShareBusy(false);
    }
  }

  async function copyShareUrl() {
    if (!shareUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setError("");

      window.setTimeout(() => setShareCopied(false), 1800);
    } catch {
      setError("Could not copy the share link.");
    }
  }

  function removeShareFromManagerOnly(link) {
    if (!link?.shareId) {
      return;
    }

    const next = sharedLinks.filter((item) => item.shareId !== link.shareId);

    setSharedLinks(next);

    if (vault?.version === 2) {
      onVaultChange({
        ...vault,
        sharedLinks: next,
      });
    }

    setError("");
  }

  useEffect(() => {
    if (!showShareModal && !showShareManager) {
      return undefined;
    }

    const timer = window.setInterval(() => setShareNow(Date.now()), 1000);

    return () => window.clearInterval(timer);
  }, [showShareModal, showShareManager]);

  function openShareManager() {
    setShowShareManager(true);
    setError("");
  }

  function closeShareManager() {
    setShowShareManager(false);
    setShareManagerBusy(false);
    setError("");
  }

  function rememberSharedLink(link) {
    const next = [
      link,
      ...sharedLinks.filter((item) => item.shareId !== link.shareId),
    ];

    setSharedLinks(next);

    if (vault?.version === 2) {
      onVaultChange({
        ...vault,
        sharedLinks: next,
      });
    }
  }

  async function removeSharedLinkFromManager(link) {
    if (!link?.shareId) {
      return;
    }

    setShareManagerBusy(true);
    setError("");

    try {
      // Legacy links may no longer exist on the server. In that case, remove
      // the manager entry locally anyway. Managed revoked links are deleted
      // from the server first.
      if (link.managementToken && link.revoked) {
        const response = await fetch("/api/share-note", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "delete",
            shareId: link.shareId,
            managementToken: link.managementToken,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));

          // A deleted/missing legacy record is safe to remove locally.
          if (response.status !== 404 && response.status !== 409) {
            throw new Error(data.error || "Could not remove share link.");
          }
        }
      }

      const next = sharedLinks.filter((item) => item.shareId !== link.shareId);

      setSharedLinks(next);

      if (vault?.version === 2) {
        onVaultChange({
          ...vault,
          sharedLinks: next,
        });
      }

      setError("");
    } catch (error) {
      setError(error.message || "Could not remove share link.");
    } finally {
      setShareManagerBusy(false);
    }
  }

  async function permanentlyRemoveSharedLink(link) {
    if (!link?.shareId) {
      return;
    }

    // Remove it from the local encrypted vault immediately after a
    // successful server deletion.
    setShareManagerBusy(true);
    setError("");

    try {
      if (link.managementToken) {
        const response = await fetch("/api/share-note", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "delete",
            shareId: link.shareId,
            managementToken: link.managementToken,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not remove share link.");
        }
      }

      const next = sharedLinks.filter((item) => item.shareId !== link.shareId);

      setSharedLinks(next);

      if (vault?.version === 2) {
        onVaultChange({
          ...vault,
          sharedLinks: next,
        });
      }

      setError("");
    } catch (error) {
      setError(error.message || "Could not remove share link.");
    } finally {
      setShareManagerBusy(false);
    }
  }

  async function revokeSharedLink(link) {
    if (!link?.shareId || !link?.managementToken) {
      setError("This share cannot be revoked from this device.");
      return;
    }

    setShareManagerBusy(true);
    setError("");

    try {
      const response = await fetch("/api/share-note?action=revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shareId: link.shareId,
          managementToken: link.managementToken,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not revoke share.");
      }

      const next = sharedLinks.map((item) =>
        item.shareId === link.shareId
          ? {
              ...item,
              revoked: true,
              revokedAt: new Date().toISOString(),
            }
          : item,
      );

      setSharedLinks(next);

      if (vault?.version === 2) {
        onVaultChange({
          ...vault,
          sharedLinks: next,
        });
      }
    } catch (error) {
      setError(error.message || "Could not revoke share.");
    } finally {
      setShareManagerBusy(false);
    }
  }

  function copyShareManagerLink(value) {
    navigator.clipboard
      .writeText(value || "")
      .then(() => setError(""))
      .catch(() => setError("Could not copy share link."));
  }

  function openShareModal() {
    if (!selected || selected.trashed) {
      setError("Select a normal note before sharing.");
      return;
    }

    setShareAccess("link");
    setSharePermission("read-only");
    setShareExpiration("never");
    setShareCreated(false);
    setShareCopied(false);
    setShowShareModal(true);
    setError("");
  }

  function closeShareModal() {
    setShowNoteExportMenu(false);
    setShowShareModal(false);
    setShareCreated(false);
    setShareCopied(false);
  }

  async function prepareShareLink() {
    await createEncryptedShare();
  }

  function downloadExportFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);

    link.click();

    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function escapeCsvCell(value) {
    const text = value === null || value === undefined ? "" : String(value);

    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportSelectedNote(format) {
    if (!selected) {
      setError("Select a note to export.");
      return;
    }

    const safeTitle =
      String(selected.title || "untitled-note")
        .trim()
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/\s+/g, "-")
        .slice(0, 80) || "untitled-note";

    if (format === "markdown") {
      const tags =
        Array.isArray(selected.tags) && selected.tags.length
          ? `\n\n**Tags:** ${selected.tags.map((tag) => `#${tag}`).join(", ")}`
          : "";

      const reminder = selected.reminderAt
        ? `\n\n**Reminder:** ${new Date(selected.reminderAt).toLocaleString()}`
        : "";

      const content = `# ${selected.title || "Untitled note"}\n\n${
        selected.content || ""
      }${tags}${reminder}\n`;

      downloadExportFile(
        `${safeTitle}.md`,
        content,
        "text/markdown;charset=utf-8",
      );
    }

    if (format === "txt") {
      const content = `${selected.title || "Untitled note"}\n\n${
        selected.content || ""
      }\n`;

      downloadExportFile(
        `${safeTitle}.txt`,
        content,
        "text/plain;charset=utf-8",
      );
    }

    if (format === "json") {
      const payload = {
        exportedAt: new Date().toISOString(),
        version: 1,
        note: selected,
      };

      downloadExportFile(
        `${safeTitle}.json`,
        JSON.stringify(payload, null, 2),
        "application/json;charset=utf-8",
      );
    }

    setShowNoteExportMenu(false);
    setError("");
  }

  function exportNotes(format) {
    if (!Array.isArray(notes) || notes.length === 0) {
      setError("There are no notes to export.");
      setShowExportMenu(false);
      return;
    }

    const dateStamp = new Date().toISOString().slice(0, 10);

    if (format === "json") {
      const payload = {
        exportedAt: new Date().toISOString(),
        version: 1,
        folders,
        notes,
      };

      downloadExportFile(
        `pocket-notes-${dateStamp}.json`,
        JSON.stringify(payload, null, 2),
        "application/json;charset=utf-8",
      );
    }

    if (format === "markdown") {
      const content = notes
        .slice()
        .sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt || 0).getTime() -
            new Date(a.updatedAt || a.createdAt || 0).getTime(),
        )
        .map((note) => {
          const tags =
            Array.isArray(note.tags) && note.tags.length
              ? `\n\n**Tags:** ${note.tags.map((tag) => `#${tag}`).join(", ")}`
              : "";

          const reminder = note.reminderAt
            ? `\n\n**Reminder:** ${new Date(note.reminderAt).toLocaleString()}`
            : "";

          return `# ${note.title || "Untitled note"}\n\n${
            note.content || ""
          }${tags}${reminder}\n\n---`;
        })
        .join("\n\n");

      downloadExportFile(
        `pocket-notes-${dateStamp}.md`,
        `# Pocket Notes Export\n\nExported: ${new Date().toLocaleString()}\n\n${content}\n`,
        "text/markdown;charset=utf-8",
      );
    }

    if (format === "csv") {
      const rows = [
        [
          "Title",
          "Content",
          "Tags",
          "Reminder",
          "Recurrence",
          "Telegram",
          "Pinned",
          "Folder",
          "Created",
          "Updated",
        ],
        ...notes.map((note) => {
          const folderName =
            folders.find((folder) => folder.id === note.folderId)?.name || "";

          return [
            note.title || "",
            note.content || "",
            Array.isArray(note.tags) ? note.tags.join(", ") : "",
            note.reminderAt || "",
            note.recurrence || "none",
            note.notifyTelegram ? "Yes" : "No",
            note.pinned ? "Yes" : "No",
            folderName,
            note.createdAt || "",
            note.updatedAt || "",
          ];
        }),
      ];

      const csv = rows
        .map((row) => row.map(escapeCsvCell).join(","))
        .join("\n");

      downloadExportFile(
        `pocket-notes-${dateStamp}.csv`,
        csv,
        "text/csv;charset=utf-8",
      );
    }

    setShowExportMenu(false);
    setError("");
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
            reminderAt: localReminderToISO(note.reminderAt) || note.reminderAt,
            recurrence: note.recurrence || "none",
            recurrenceDay: note.recurrenceDay ?? null,
            recurrenceDays: normalizeRecurrenceDays(note.recurrenceDays),
            recurrenceInterval: note.recurrenceInterval ?? null,
            recurrenceUnit: note.recurrenceUnit ?? null,
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

  function buildNoteHistoryEntry(note) {
    return {
      id: makeId(),
      title: note.title || "",
      content: note.content || "",
      tags: Array.isArray(note.tags) ? [...note.tags] : [],
      savedAt: new Date().toISOString(),
    };
  }

  function getNoteHistory(note) {
    return Array.isArray(note?.history) ? note.history : [];
  }

  function restoreNoteVersion(version) {
    if (!selected || !version) {
      return;
    }

    setForm({
      title: version.title || "",
      content: version.content || "",
    });

    setFormTags(Array.isArray(version.tags) ? version.tags : []);

    setEditorStatus("Version restored in editor — save to apply");
    setShowVersionHistory(false);
    setShowForm(true);
    setEditing(selected);
    setError("");
  }

  async function saveNote() {
    setError("");

    if (!form.title.trim()) {
      setError("A note title is required.");
      return;
    }

    if (!form.content.trim()) {
      setError("Write something in the note.");
      return;
    }

    let telegramIsReady = telegramConnected;

    if (formNotifyTelegram) {
      telegramIsReady = await checkTelegramConnection();

      if (!telegramIsReady) {
        setError(
          "Telegram is not connected. Open Connect Telegram and complete the connection first.",
        );
        return;
      }
    }

    const normalizedReminderAt = localReminderToISO(formReminder);

    if (formReminder && !normalizedReminderAt) {
      setError("The reminder date/time is invalid.");
      return;
    }

    if (formNotifyTelegram && !normalizedReminderAt) {
      setError("Choose a reminder date and time for the Telegram reminder.");
      return;
    }

    if (
      normalizedReminderAt &&
      new Date(normalizedReminderAt).getTime() <= Date.now()
    ) {
      setError("Choose a future reminder time.");
      return;
    }

    let recurrenceDay = formRecurrenceDay;

    if (formRecurrence === "weekly" && !recurrenceDay) {
      recurrenceDay = defaultRecurrenceDay(formReminder, "weekly");
    }

    if (formRecurrence === "monthly" && !recurrenceDay) {
      recurrenceDay = defaultRecurrenceDay(formReminder, "monthly");
    }

    if (
      formRecurrence === "weekly" &&
      normalizeRecurrenceDays(
        formRecurrenceDays.length
          ? formRecurrenceDays
          : [Number(recurrenceDay)],
      ).length === 0
    ) {
      setError("Choose at least one weekday for the weekly reminder.");
      return;
    }

    if (
      formRecurrence === "monthly" &&
      (!Number.isInteger(Number(recurrenceDay)) ||
        Number(recurrenceDay) < 1 ||
        Number(recurrenceDay) > 31)
    ) {
      setError("Choose a day from 1 to 31 for the monthly reminder.");
      return;
    }

    if (
      formRecurrence === "custom" &&
      (!Number.isInteger(Number(formRecurrenceInterval)) ||
        Number(formRecurrenceInterval) < 1 ||
        Number(formRecurrenceInterval) > 3650)
    ) {
      setError("Choose a custom interval from 1 to 3650.");
      return;
    }

    const finalRecurrenceDay =
      formRecurrence === "monthly" ? Number(recurrenceDay) : null;

    const finalRecurrenceDays =
      formRecurrence === "weekly"
        ? normalizeRecurrenceDays(
            formRecurrenceDays.length
              ? formRecurrenceDays
              : [Number(recurrenceDay)],
          )
        : [];

    const finalRecurrenceInterval =
      formRecurrence === "custom"
        ? Math.max(1, Number(formRecurrenceInterval) || 1)
        : null;

    const finalRecurrenceUnit =
      formRecurrence === "custom" ? formRecurrenceUnit : null;

    const now = new Date().toISOString();

    const telegramReminderEnabled = Boolean(
      normalizedReminderAt && formNotifyTelegram && telegramIsReady,
    );

    const applyForm = (note) => {
      const contentChanged =
        String(note.content || "") !== String(form.content || "") ||
        String(note.title || "") !== String(form.title.trim()) ||
        JSON.stringify(Array.isArray(note.tags) ? note.tags : []) !==
          JSON.stringify([...formTags]);

      const previousHistory = getNoteHistory(note);

      const isExistingNote = notes.some((current) => current.id === note.id);

      const shouldSnapshot = Boolean(
        isExistingNote && contentChanged && note && note.id,
      );

      const nextHistory = shouldSnapshot
        ? [...previousHistory, buildNoteHistoryEntry(note)].slice(-20)
        : previousHistory;

      return {
        ...note,
        title: form.title.trim(),
        content: form.content,
        tags: [...formTags],
        attachments: [...formAttachments],
        attachments: [...formAttachments],
        history: nextHistory,
        reminderAt: normalizedReminderAt,
        recurrence: normalizedReminderAt ? formRecurrence : "none",
        recurrenceDay: normalizedReminderAt ? finalRecurrenceDay : null,
        recurrenceInterval: normalizedReminderAt
          ? finalRecurrenceInterval
          : null,
        recurrenceUnit: normalizedReminderAt ? finalRecurrenceUnit : null,
        notifyTelegram: telegramReminderEnabled,
        reminderPaused: false,
        updatedAt: now,
      };
    };

    const next = editing
      ? notes.map((note) => (note.id === editing.id ? applyForm(note) : note))
      : [
          applyForm({
            id: makeId(),
            title: "",
            content: "",
            tags: [],
            reminderAt: null,
            recurrence: "none",
            recurrenceDay: null,
            notifyTelegram: false,
            reminderPaused: false,
            pinned: false,
            archived: false,
            trashed: false,
            trashedAt: null,
            history: [],
            attachments: [],
            folderId:
              selectedFolder === "all" || selectedFolder === "pinned"
                ? null
                : selectedFolder,
            createdAt: now,
          }),
          ...notes,
        ];

    const savedNoteId = editing?.id || next[0]?.id || null;

    await persistNotes(next);

    const savedNote = next.find((note) => note.id === savedNoteId);

    await syncTelegramReminder(savedNote);

    setSelectedId(savedNoteId);

    setShowForm(false);
    setEditing(null);
    setNewNoteTemplateId("blank");

    setForm({
      title: "",
      content: "",
    });
    editorLoadKeyRef.current = "";
    setEditorHtml("");

    setFormTags([]);
    setFormAttachments([]);
    setFormReminder("");
    setFormRecurrence("none");
    setFormRecurrenceDay("");
    setFormRecurrenceDays([]);
    setFormRecurrenceInterval(1);
    setFormRecurrenceUnit("days");
    setFormNotifyTelegram(false);
    setTagInput("");
    setEditorStatus("Saved");
  }

  function getTagUsage(tag) {
    return notes.filter(
      (note) => Array.isArray(note.tags) && note.tags.includes(tag),
    ).length;
  }

  async function renameTagEverywhere(oldTag, nextTag) {
    const cleanOld = String(oldTag || "").trim();

    const cleanNew = String(nextTag || "")
      .trim()
      .replace(/^#/, "")
      .replace(/\s+/g, " ");

    if (!cleanOld || !cleanNew) {
      setError("Enter a tag name.");
      return;
    }

    if (cleanOld.toLowerCase() === cleanNew.toLowerCase()) {
      setError("");
      return;
    }

    const conflict = availableTags.some(
      (tag) => tag !== cleanOld && tag.toLowerCase() === cleanNew.toLowerCase(),
    );

    if (conflict) {
      setError(`The tag #${cleanNew} already exists.`);
      return;
    }

    setTagManagerBusy(true);
    setError("");

    const nextNotes = notes.map((note) => ({
      ...note,
      tags: Array.isArray(note.tags)
        ? note.tags.map((tag) => (tag === cleanOld ? cleanNew : tag))
        : [],
    }));

    try {
      await persistNotes(nextNotes);
    } finally {
      setTagManagerBusy(false);
    }
  }

  async function deleteTagEverywhere(tag) {
    const cleanTag = String(tag || "").trim();

    if (!cleanTag) {
      return;
    }

    const nextNotes = notes.map((note) => ({
      ...note,
      tags: Array.isArray(note.tags)
        ? note.tags.filter((item) => item !== cleanTag)
        : [],
    }));

    setTagManagerBusy(true);
    setError("");

    try {
      await persistNotes(nextNotes);

      if (selectedTag === cleanTag) {
        setSelectedTag("all");
      }
    } finally {
      setTagManagerBusy(false);
    }
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

  async function copySelectedNote() {
    if (!selected) {
      return;
    }

    const text = [
      selected.title || "Untitled note",
      "",
      selected.content || "",
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);

      setNoteCopied(true);

      window.setTimeout(() => setNoteCopied(false), 1600);

      setError("");
    } catch {
      setError("Could not copy the note.");
    }
  }

  async function duplicateSelectedNote() {
    if (!selected || selected.trashed) {
      return;
    }

    const now = new Date().toISOString();

    const duplicate = {
      ...selected,
      id: makeId(),
      title: selected.title ? `${selected.title} copy` : "Untitled note copy",
      reminderAt: null,
      reminderPaused: false,
      notifyTelegram: false,
      recurrence: "none",
      recurrenceDay: null,
      recurrenceDays: [],
      recurrenceInterval: null,
      recurrenceUnit: null,
      history: [],
      createdAt: now,
      updatedAt: now,
    };

    const nextNotes = [duplicate, ...notes];

    try {
      await persistNotes(nextNotes);
      setSelectedId(duplicate.id);
      setShowForm(false);
      setEditing(null);
      setError("");
    } catch (error) {
      setError(error.message || "Could not duplicate note.");
    }
  }

  function openNew() {
    setShowNoteExportMenu(false);
    setError("");
    setEditing(null);

    setForm({
      title: "",
      content: "",
    });

    setFormTags([]);
    setFormAttachments([]);
    setFormReminder("");
    setFormRecurrence("none");
    setFormRecurrenceDay("");
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

    editorLoadKeyRef.current = "";
    setEditorHtml(markdownToEditorHtml(note.content || ""));

    setFormTags(Array.isArray(note.tags) ? [...note.tags] : []);
    setFormAttachments(
      Array.isArray(note.attachments) ? [...note.attachments] : [],
    );

    setFormReminder(isoToLocalDateTime(note.reminderAt));

    setFormRecurrence(note.recurrence || "none");

    setFormRecurrenceDay(
      note.recurrenceDay ??
        defaultRecurrenceDay(note.reminderAt, note.recurrence || "none"),
    );

    setFormRecurrenceDays(normalizeRecurrenceDays(note.recurrenceDays));

    setFormRecurrenceInterval(note.recurrenceInterval || 1);

    setFormRecurrenceUnit(note.recurrenceUnit || "days");

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
      // Move to Trash even if Telegram cancellation fails.
    }

    const now = new Date().toISOString();

    const next = notes.map((note) =>
      note.id === id
        ? {
            ...note,
            trashed: true,
            trashedAt: now,
            reminderAt: null,
            reminderPaused: false,
            notifyTelegram: false,
            updatedAt: now,
          }
        : note,
    );

    await persistNotes(next);

    setSelectedId(
      next.find((note) => !note.trashed && !note.archived)?.id || null,
    );

    setError("");
  }

  async function restoreNote(id) {
    const next = notes.map((note) =>
      note.id === id
        ? {
            ...note,
            trashed: false,
            trashedAt: null,
            archived: false,
            updatedAt: new Date().toISOString(),
          }
        : note,
    );

    await persistNotes(next);

    setShowTrash(false);
    setShowArchivedNotes(false);
    setSelectedFolder("all");
    setSelectedTag("all");
    setSelectedId(id);
    setQuery("");
    setError("");
  }

  async function permanentlyDeleteNote(id) {
    const next = notes.filter((note) => note.id !== id);

    await persistNotes(next);

    setSelectedId(
      next.find((note) => !note.trashed && !note.archived)?.id || null,
    );

    setError("");
  }

  async function toggleArchive(id) {
    const note = notes.find((item) => item.id === id);

    if (!note) {
      return;
    }

    const next = notes.map((item) =>
      item.id === id
        ? {
            ...item,
            archived: !item.archived,
            updatedAt: new Date().toISOString(),
          }
        : item,
    );

    setSelectedId(!note.archived && selectedId === id ? null : selectedId);

    await persistNotes(next);

    setError("");
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
                    style={styles.tagManageButton}
                    onClick={() => setShowTagManager(true)}
                    title="Manage tags"
                  >
                    Manage
                  </button>

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

          <div style={styles.noteViewSwitcher}>
            <div style={styles.noteViewLabel}>VIEW</div>

            <button
              type="button"
              style={{
                ...styles.noteViewTab,
                ...(!showArchivedNotes && !showTrash
                  ? styles.noteViewTabActive
                  : {}),
              }}
              onClick={() => {
                setShowArchivedNotes(false);
                setShowTrash(false);
                setSelectedFolder("all");
                setSelectedTag("all");
                setSelectedId(null);
              }}
            >
              <FileText size={13} />
              All Notes
              <span style={styles.noteViewCount}>
                {notes.filter((note) => !note.archived && !note.trashed).length}
              </span>
            </button>

            <button
              type="button"
              style={{
                ...styles.noteViewTab,
                ...(showArchivedNotes ? styles.noteViewTabActive : {}),
              }}
              onClick={() => {
                setShowArchivedNotes(true);
                setShowTrash(false);
                setSelectedFolder("all");
                setSelectedTag("all");
                setSelectedId(null);
              }}
            >
              <Archive size={13} />
              Archived
              <span style={styles.noteViewCount}>
                {
                  notes.filter(
                    (note) => Boolean(note.archived) && !note.trashed,
                  ).length
                }
              </span>
            </button>

            <button
              type="button"
              style={{
                ...styles.noteViewTab,
                ...(showTrash ? styles.noteViewTabTrashActive : {}),
              }}
              onClick={() => {
                setShowTrash(true);
                setShowArchivedNotes(false);
                setSelectedFolder("all");
                setSelectedTag("all");
                setSelectedId(null);
              }}
            >
              <Trash2 size={13} />
              Trash
              <span style={styles.noteViewCount}>
                {notes.filter((note) => Boolean(note.trashed)).length}
              </span>
            </button>

            <div style={styles.noteViewStatus}>
              {showTrash
                ? "Showing deleted notes"
                : showArchivedNotes
                  ? "Showing archived notes"
                  : "Showing active notes"}
            </div>
          </div>

          <div style={styles.folderBar}>
            <div style={styles.folderScroll}>
              <button
                type="button"
                style={{
                  ...styles.folderChip,
                  ...(selectedFolder === "all" ? styles.folderChipActive : {}),
                }}
                onClick={() => {
                  setSelectedFolder("all");
                  setShowArchivedNotes(false);
                  setShowTrash(false);
                }}
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
                  onClick={() => {
                    setSelectedFolder(folder.id);
                    setShowArchivedNotes(false);
                    setShowTrash(false);
                  }}
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
                <Download size={14} />
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

          <div style={styles.currentNotesView}>
            <span style={styles.currentNotesViewBadge}>
              {showTrash
                ? "Trash"
                : showArchivedNotes
                  ? "Archived"
                  : "All Notes"}
            </span>

            <span style={styles.currentNotesViewDetail}>
              {showTrash
                ? "Deleted notes"
                : showArchivedNotes
                  ? "Archived notes"
                  : "Active notes"}
            </span>
          </div>

          <div style={styles.subtle}>
            {showTrash
              ? notes.filter((note) => Boolean(note.trashed)).length
              : showArchivedNotes
                ? notes.filter(
                    (note) => Boolean(note.archived) && !note.trashed,
                  ).length
                : notes.filter((note) => !note.trashed).length}{" "}
            {showTrash
              ? "notes in Trash"
              : showArchivedNotes
                ? "archived notes"
                : "notes"}
          </div>
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
            style={{
              ...styles.secondaryButton,
              ...(showArchivedNotes ? styles.archiveButtonActive : {}),
            }}
            onClick={() => {
              setShowArchivedNotes((value) => !value);
              setSelectedFolder("all");
              setSelectedTag("all");
              setSelectedId(null);
            }}
            title="Show archived notes"
          >
            <Archive size={14} />
            {showArchivedNotes ? "Archived" : "Archive"}
          </button>
          <button
            type="button"
            style={{
              ...styles.secondaryButton,
              ...(showTrash ? styles.trashButtonActive : {}),
            }}
            onClick={() => {
              setShowTrash((value) => !value);
              setShowArchivedNotes(false);
              setSelectedFolder("all");
              setSelectedTag("all");
              setSelectedId(null);
            }}
            title="Show trashed notes"
          >
            <Trash2 size={14} />
            Trash
          </button>

          <button
            type="button"
            style={styles.secondaryButton}
            onClick={async () => {
              setShowReminderHistory(true);
              await loadReminderHistory();
            }}
          >
            <CalendarDays size={14} />
            History
          </button>

          <label style={styles.secondaryButton} title="Import notes">
            <Download size={14} />
            Import
            <input
              type="file"
              accept=".json,.md,.markdown,.csv"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];

                e.target.value = "";

                if (!file) {
                  return;
                }

                try {
                  await parseImportedFile(file);
                } catch (error) {
                  setError(error.message || "Could not read import file.");
                }
              }}
            />
          </label>

          <div style={styles.exportWrap}>
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => setShowExportMenu((value) => !value)}
              title="Export notes"
            >
              <Upload size={14} />
              Export
            </button>

            {showExportMenu && (
              <div style={styles.exportMenu}>
                <div style={styles.exportMenuTitle}>Export notes</div>

                <button
                  type="button"
                  style={styles.exportMenuItem}
                  onClick={() => exportNotes("json")}
                >
                  <strong>JSON</strong>
                  <span>Backup with all note data</span>
                </button>

                <button
                  type="button"
                  style={styles.exportMenuItem}
                  onClick={() => exportNotes("markdown")}
                >
                  <strong>Markdown</strong>
                  <span>Readable notes document</span>
                </button>

                <button
                  type="button"
                  style={styles.exportMenuItem}
                  onClick={() => exportNotes("csv")}
                >
                  <strong>CSV</strong>
                  <span>Spreadsheet-friendly</span>
                </button>
              </div>
            )}
          </div>

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
            onClick={() => setShowShortcuts(true)}
            title="Keyboard shortcuts"
          >
            <Keyboard size={14} />
            Shortcuts
          </button>

          <div style={styles.autoLockWrap}>
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => setShowAutoLockMenu((value) => !value)}
              title="Auto-lock settings"
              aria-haspopup="menu"
              aria-expanded={showAutoLockMenu}
            >
              <Lock size={14} />
              Auto-lock
              <span style={styles.autoLockValue}>
                {autoLockMinutes === 0 ? "Off" : `${autoLockMinutes}m`}
              </span>
            </button>

            {showAutoLockMenu && (
              <div style={styles.autoLockMenu}>
                <div style={styles.autoLockMenuTitle}>AUTO-LOCK NOTES</div>

                <div style={styles.autoLockMenuCopy}>
                  Lock the Notes vault after inactivity.
                </div>

                {[
                  [0, "Off"],
                  [5, "5 minutes"],
                  [15, "15 minutes"],
                  [30, "30 minutes"],
                  [60, "1 hour"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    style={{
                      ...styles.autoLockMenuItem,
                      ...(autoLockMinutes === value
                        ? styles.autoLockMenuItemActive
                        : {}),
                    }}
                    onClick={() => setAutoLockDuration(value)}
                  >
                    {label}
                    {autoLockMinutes === value && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            style={styles.secondaryButton}
            onClick={lockVault}
          >
            <Lock size={14} />
            Lock
          </button>

          <div style={styles.templateWrap}>
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => setShowTemplateMenu((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={showTemplateMenu}
            >
              <Repeat size={14} />
              Templates
            </button>

            {showTemplateMenu && (
              <div style={styles.templateMenu}>
                <div style={styles.templateMenuTitle}>New from template</div>

                {NOTE_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    style={styles.templateMenuItem}
                    onClick={() => applyNoteTemplate(template.id)}
                  >
                    <strong>{template.name}</strong>
                    <span>{template.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

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

        {query.trim() && (
          <span style={styles.searchResultCount}>
            {filteredNotes.length}{" "}
            {filteredNotes.length === 1 ? "result" : "results"}
          </span>
        )}

        <div style={styles.searchFilterWrap}>
          <button
            type="button"
            style={{
              ...styles.searchFilterButton,
              ...(searchPinnedOnly || searchHasReminder
                ? styles.searchFilterButtonActive
                : {}),
            }}
            onClick={() => setShowSearchFilters((value) => !value)}
            title="Filter search results"
            aria-haspopup="menu"
            aria-expanded={showSearchFilters}
          >
            <SlidersHorizontal size={13} />
            Filters
            {(searchPinnedOnly || searchHasReminder) && (
              <span style={styles.searchFilterBadge}>
                {[searchPinnedOnly, searchHasReminder].filter(Boolean).length}
              </span>
            )}
          </button>

          {showSearchFilters && (
            <div style={styles.searchFilterMenu}>
              <div style={styles.searchFilterTitle}>SEARCH FILTERS</div>

              <button
                type="button"
                style={styles.searchFilterItem}
                onClick={() => setSearchPinnedOnly((value) => !value)}
              >
                <span>Pinned notes only</span>
                <span
                  style={
                    searchPinnedOnly
                      ? styles.searchFilterCheckActive
                      : styles.searchFilterCheck
                  }
                >
                  {searchPinnedOnly ? "✓" : ""}
                </span>
              </button>

              <button
                type="button"
                style={styles.searchFilterItem}
                onClick={() => setSearchHasReminder((value) => !value)}
              >
                <span>Notes with reminders</span>
                <span
                  style={
                    searchHasReminder
                      ? styles.searchFilterCheckActive
                      : styles.searchFilterCheck
                  }
                >
                  {searchHasReminder ? "✓" : ""}
                </span>
              </button>

              {(searchPinnedOnly || searchHasReminder) && (
                <button
                  type="button"
                  style={styles.searchFilterClear}
                  onClick={() => {
                    setSearchPinnedOnly(false);
                    setSearchHasReminder(false);
                    setShowSearchFilters(false);
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={styles.tagFilterToolbar}>
        <div style={styles.tagFilterScroll}>
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

          <button
            type="button"
            style={styles.tagManageButton}
            onClick={() => setShowTagManager(true)}
            title="Manage tags"
          >
            Manage tags
          </button>
        </div>
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}

      {noteCopied && (
        <div style={styles.copiedToast} role="status">
          <Check size={14} />
          Copied to clipboard
        </div>
      )}

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
                onClick={() => {
                  setSelectedId(note.id);
                  setShowNoteExportMenu(false);
                  setShowSearchFilters(false);
                }}
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
                  <div style={styles.rowTitle}>
                    {renderSearchHighlight(note.title, query)}
                  </div>

                  <div style={styles.rowMeta}>
                    {renderSearchHighlight(
                      String(note.content || "")
                        .replace(/\s+/g, " ")
                        .slice(0, 70),
                      query,
                    )}
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

                    {customTemplates.length > 0 && (
                      <>
                        <div style={styles.templateMenuSection}>
                          YOUR TEMPLATES
                        </div>

                        {customTemplates.map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            style={styles.templateMenuItem}
                            onClick={() => createFromCustomTemplate(template)}
                          >
                            <strong>{template.name}</strong>
                            <span>
                              {template.description || "Custom template"}
                            </span>
                          </button>
                        ))}
                      </>
                    )}

                    <button
                      type="button"
                      style={{
                        ...styles.templateMenuManage,
                      }}
                      onClick={openTemplateManager}
                    >
                      <FolderPlus size={14} />
                      Manage templates
                    </button>

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

                    {selected.archived && (
                      <span style={styles.archivedBadge}>Archived</span>
                    )}
                    {selected.trashed && (
                      <span style={styles.trashBadge}>Trash</span>
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

                  <button
                    type="button"
                    style={styles.iconButton}
                    onClick={copySelectedNote}
                    title="Copy note"
                  >
                    {noteCopied ? <Check size={15} /> : <Copy size={15} />}
                  </button>

                  <button
                    type="button"
                    style={styles.iconButton}
                    onClick={duplicateSelectedNote}
                    title="Duplicate note"
                  >
                    <Files size={15} />
                  </button>

                  <button
                    type="button"
                    style={{
                      ...styles.iconButton,
                      opacity: 1,
                    }}
                    onClick={() => setShowVersionHistory(true)}
                    title={
                      getNoteHistory(selected).length
                        ? `Version history · ${getNoteHistory(selected).length} saved version${
                            getNoteHistory(selected).length === 1 ? "" : "s"
                          }`
                        : "Version history · no saved versions yet"
                    }
                  >
                    <History size={15} />
                  </button>

                  <div style={styles.noteExportWrap}>
                    <button
                      type="button"
                      style={styles.iconButton}
                      onClick={() => setShowNoteExportMenu((value) => !value)}
                      title="Export selected note"
                      aria-haspopup="menu"
                      aria-expanded={showNoteExportMenu}
                    >
                      <Download size={15} />
                    </button>

                    {showNoteExportMenu && (
                      <div style={styles.noteExportMenu}>
                        <div style={styles.noteExportMenuTitle}>
                          Export note
                        </div>

                        <button
                          type="button"
                          style={styles.exportMenuItem}
                          onClick={() => exportSelectedNote("markdown")}
                        >
                          <strong>Markdown</strong>
                          <span>Best for notes and backups</span>
                        </button>

                        <button
                          type="button"
                          style={styles.exportMenuItem}
                          onClick={() => exportSelectedNote("txt")}
                        >
                          <strong>Plain text</strong>
                          <span>Simple .txt file</span>
                        </button>

                        <button
                          type="button"
                          style={styles.exportMenuItem}
                          onClick={() => exportSelectedNote("json")}
                        >
                          <strong>JSON</strong>
                          <span>Full note data</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {!showTrash && !selected.archived && (
                    <button
                      type="button"
                      style={styles.iconButton}
                      onClick={openShareModal}
                      title="Share note"
                    >
                      <Share2 size={15} />
                    </button>
                  )}

                  <button
                    type="button"
                    style={styles.iconButton}
                    onClick={openShareManager}
                    title="Manage shared links"
                  >
                    <Link2 size={15} />
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

                  {!showTrash && (
                    <button
                      type="button"
                      style={styles.iconButton}
                      onClick={() => toggleArchive(selected.id)}
                      title={selected.archived ? "Unarchive" : "Archive"}
                    >
                      {selected.archived ? "↗" : "→"}
                    </button>
                  )}

                  {showTrash ? (
                    <>
                      <button
                        type="button"
                        style={styles.iconButton}
                        onClick={() => restoreNote(selected.id)}
                        title="Restore"
                      >
                        ↶
                      </button>

                      <button
                        type="button"
                        style={{
                          ...styles.iconButton,
                          ...styles.reminderDeleteButton,
                        }}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Permanently delete this note? This cannot be undone.",
                            )
                          ) {
                            permanentlyDeleteNote(selected.id);
                          }
                        }}
                        title="Delete permanently"
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      style={styles.iconButton}
                      onClick={() => deleteNote(selected.id)}
                      title="Move to Trash"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>

              <div style={styles.noteContent}>{selected.content}</div>

              {Array.isArray(selected.attachments) &&
                selected.attachments.length > 0 && (
                  <div style={styles.detailAttachmentSection}>
                    <div style={styles.detailAttachmentTitle}>Attachments</div>
                    <div style={styles.detailAttachmentList}>
                      {selected.attachments.map((attachment) => (
                        <div
                          key={attachment.id}
                          style={styles.detailAttachmentRow}
                        >
                          <button
                            type="button"
                            style={styles.detailAttachmentInfoButton}
                            onClick={() => {
                              if (attachment?.dataUrl) {
                                previewAttachmentInNewTab(attachment);
                              }
                            }}
                            title="Preview attachment"
                          >
                            <div style={styles.detailAttachmentInfo}>
                              {attachment?.type?.startsWith("image/") ? (
                                <img
                                  src={attachment.dataUrl}
                                  alt=""
                                  style={styles.detailAttachmentThumb}
                                />
                              ) : (
                                <Paperclip size={13} />
                              )}
                              <div
                                style={styles.detailAttachmentName}
                                title={attachment.name}
                              >
                                {attachment.name}
                              </div>
                              <span>
                                {formatAttachmentSize(attachment.size)}
                              </span>
                            </div>
                          </button>

                          <button
                            type="button"
                            style={styles.attachmentAction}
                            onClick={() => downloadAttachment(attachment)}
                            title="Download attachment"
                          >
                            <Download size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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

      {showTemplateManager && (
        <div style={styles.overlay}>
          <div
            style={{
              ...styles.formModal,
              maxWidth: 760,
            }}
          >
            <button
              type="button"
              style={styles.modalClose}
              onClick={() => {
                setShowTemplateManager(false);
                setTemplateEditingId(null);
                setError("");
              }}
            >
              <X size={17} />
            </button>

            <div style={styles.detailEyebrow}>CUSTOM TEMPLATES</div>

            <h2 style={styles.formTitle}>
              {templateEditingId ? "Edit template" : "Create template"}
            </h2>

            <label style={styles.label}>Template name</label>
            <input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. Weekly review"
              style={styles.input}
              autoFocus
            />

            <label style={styles.label}>Description</label>
            <input
              value={templateDescription}
              onChange={(e) => setTemplateDescription(e.target.value)}
              placeholder="What is this template for?"
              style={styles.input}
            />

            <label style={styles.label}>Note title</label>
            <input
              value={templateTitle}
              onChange={(e) => setTemplateTitle(e.target.value)}
              placeholder="Default note title"
              style={styles.input}
            />

            <label style={styles.label}>Tags</label>
            <input
              value={templateTags}
              onChange={(e) => setTemplateTags(e.target.value)}
              placeholder="work, weekly, review"
              style={styles.input}
            />

            <label style={styles.label}>Template content</label>
            <textarea
              value={form.content || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  content: e.target.value,
                })
              }
              placeholder="Write the reusable note structure here…"
              style={{
                ...styles.textarea,
                minHeight: 180,
              }}
            />

            {customTemplates.length > 0 && (
              <div style={styles.customTemplateList}>
                <div style={styles.templateListTitle}>Your templates</div>

                {customTemplates.map((template) => (
                  <div key={template.id} style={styles.customTemplateRow}>
                    <div style={styles.customTemplateInfo}>
                      <strong>{template.name}</strong>
                      <span>{template.description || "No description"}</span>
                    </div>

                    <div style={styles.customTemplateActions}>
                      <button
                        type="button"
                        style={styles.reminderActionButton}
                        onClick={() => startEditCustomTemplate(template)}
                      >
                        <Pencil size={13} />
                      </button>

                      <button
                        type="button"
                        style={{
                          ...styles.reminderActionButton,
                          ...styles.reminderDeleteButton,
                        }}
                        onClick={() => deleteCustomTemplate(template.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.importFooter}>
              <button
                type="button"
                style={styles.linkButton}
                onClick={() => {
                  setShowTemplateManager(false);
                  setTemplateEditingId(null);
                  setError("");
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                style={styles.primaryButton}
                onClick={saveCustomTemplate}
              >
                {templateEditingId ? "Save changes" : "Create template"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showShortcuts && (
        <div style={styles.overlay}>
          <div
            style={{
              ...styles.formModal,
              maxWidth: 520,
            }}
          >
            <button
              type="button"
              style={styles.modalClose}
              onClick={() => setShowShortcuts(false)}
              title="Close"
            >
              <X size={17} />
            </button>

            <div style={styles.detailEyebrow}>KEYBOARD</div>

            <h2 style={styles.formTitle}>Keyboard shortcuts</h2>

            <div style={styles.shortcutList}>
              {[
                ["⌘/Ctrl + N", "New note"],
                ["⌘/Ctrl + F", "Focus note search"],
                ["⌘/Ctrl + B", "Bold in editor"],
                ["⌘/Ctrl + I", "Italic in editor"],
                ["?", "Open this shortcut panel"],
                ["Esc", "Close menus and dialogs"],
              ].map(([keys, label]) => (
                <div key={keys} style={styles.shortcutRow}>
                  <kbd style={styles.shortcutKeys}>{keys}</kbd>
                  <span>{label}</span>
                </div>
              ))}
            </div>

            <div style={styles.shortcutHint}>
              Navigation shortcuts stay inactive while you are typing.
            </div>

            <div style={styles.importFooter}>
              <button
                type="button"
                style={styles.primaryButton}
                onClick={() => setShowShortcuts(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showTagManager && (
        <div style={styles.overlay}>
          <div
            style={{
              ...styles.formModal,
              maxWidth: 620,
            }}
          >
            <button
              type="button"
              style={styles.modalClose}
              onClick={() => setShowTagManager(false)}
            >
              <X size={17} />
            </button>

            <div style={styles.detailEyebrow}>TAGS</div>

            <h2 style={styles.formTitle}>Manage tags</h2>

            <p style={styles.copy}>
              Rename a tag everywhere or remove it from every note.
            </p>

            <div style={styles.tagManagerList}>
              {availableTags.length === 0 ? (
                <div style={styles.shareManagerEmpty}>No tags yet</div>
              ) : (
                availableTags.map((tag) => (
                  <div key={tag} style={styles.tagManagerRow}>
                    <div style={styles.tagManagerInfo}>
                      <strong style={styles.tagManagerStrong}>#{tag}</strong>
                      <span style={styles.tagManagerCount}>
                        {getTagUsage(tag)}{" "}
                        {getTagUsage(tag) === 1 ? "note" : "notes"}
                      </span>
                    </div>

                    <div style={styles.tagManagerActions}>
                      <button
                        type="button"
                        style={styles.reminderActionButton}
                        disabled={tagManagerBusy}
                        onClick={() => {
                          setTagManagerName(tag);

                          const next = window.prompt(`Rename #${tag} to:`, tag);

                          if (next !== null) {
                            renameTagEverywhere(tag, next);
                          }
                        }}
                        title="Rename tag"
                      >
                        <Pencil size={13} />
                      </button>

                      <button
                        type="button"
                        style={{
                          ...styles.reminderActionButton,
                          ...styles.reminderDeleteButton,
                        }}
                        disabled={tagManagerBusy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove #${tag} from all notes? This cannot be undone.`,
                            )
                          ) {
                            deleteTagEverywhere(tag);
                          }
                        }}
                        title="Delete tag from all notes"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.importFooter}>
              <button
                type="button"
                style={styles.primaryButton}
                onClick={() => setShowTagManager(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showVersionHistory && selected && (
        <div style={styles.overlay}>
          <div
            style={{
              ...styles.formModal,
              maxWidth: 700,
            }}
          >
            <button
              type="button"
              style={styles.modalClose}
              onClick={() => setShowVersionHistory(false)}
            >
              <X size={17} />
            </button>

            <div style={styles.detailEyebrow}>VERSION HISTORY</div>

            <h2 style={styles.formTitle}>
              {selected.title || "Untitled note"}
            </h2>

            <p style={styles.copy}>
              The last 20 saved versions are kept with the encrypted note.
              Version history starts recording when you save an edit after this
              feature is installed.
            </p>

            {getNoteHistory(selected).length === 0 ? (
              <div style={styles.shareManagerEmpty}>
                <History size={24} />
                <strong>No previous versions</strong>
                <span>
                  Edit and save this note to create its first version.
                </span>
              </div>
            ) : (
              <div style={styles.versionHistoryList}>
                {[...getNoteHistory(selected)].reverse().map((version) => (
                  <div key={version.id} style={styles.versionHistoryRow}>
                    <div style={styles.versionHistoryInfo}>
                      <strong style={styles.versionHistoryStrong}>
                        {version.title || "Untitled note"}
                      </strong>
                      <span style={styles.versionHistoryDate}>
                        {new Date(version.savedAt).toLocaleString()}
                      </span>
                      <p style={styles.versionHistoryPreview}>
                        {String(version.content || "").slice(0, 140) ||
                          "Empty note"}
                        {String(version.content || "").length > 140 ? "…" : ""}
                      </p>
                    </div>

                    <button
                      type="button"
                      style={styles.secondaryButton}
                      onClick={() => restoreNoteVersion(version)}
                    >
                      Restore to editor
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={styles.importFooter}>
              <button
                type="button"
                style={styles.primaryButton}
                onClick={() => setShowVersionHistory(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showShareManager && (
        <div style={styles.overlay}>
          <div
            style={{
              ...styles.formModal,
              maxWidth: 720,
            }}
          >
            <button
              type="button"
              style={styles.modalClose}
              onClick={closeShareManager}
            >
              <X size={17} />
            </button>

            <div style={styles.detailEyebrow}>SHARED LINKS</div>

            <h2 style={styles.formTitle}>Manage shared links</h2>

            <p style={styles.copy}>
              These links are created for individual notes. Revoke a link to
              immediately disable it.
            </p>

            {sharedLinks.length === 0 ? (
              <div style={styles.shareManagerEmpty}>
                <Link2 size={24} />
                <strong>No shared links yet</strong>
                <span>Create a Share link from any active note.</span>
              </div>
            ) : (
              <div style={styles.shareManagerList}>
                {sharedLinks.map((link) => {
                  const expired =
                    Boolean(link.expiresAt) &&
                    new Date(link.expiresAt).getTime() <= Date.now();

                  const status = link.revoked
                    ? "Revoked"
                    : expired
                      ? "Expired"
                      : "Active";

                  return (
                    <div key={link.shareId} style={styles.shareManagerRow}>
                      <div style={styles.shareManagerInfo}>
                        <div style={styles.shareManagerTitle}>
                          {link.title || "Untitled note"}
                        </div>
                        <div style={styles.shareManagerMeta}>
                          {status}
                          {" · "}
                          {link.expiresAt
                            ? `${formatShareCountdown(
                                link.expiresAt,
                              )} · expires ${new Date(
                                link.expiresAt,
                              ).toLocaleString()}`
                            : "never expires"}
                        </div>
                      </div>

                      <div style={styles.shareManagerActions}>
                        <button
                          type="button"
                          style={styles.reminderActionButton}
                          disabled={Boolean(link.revoked)}
                          onClick={() => copyShareManagerLink(link.url)}
                          title="Copy link"
                        >
                          <Copy size={13} />
                        </button>

                        {link.revoked ? (
                          <button
                            type="button"
                            style={{
                              ...styles.reminderActionButton,
                              ...styles.reminderDeleteButton,
                            }}
                            disabled={shareManagerBusy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Remove this revoked share from Share Management? This cannot be undone.",
                                )
                              ) {
                                removeShareFromManagerOnly(link);
                              }
                            }}
                            title="Remove revoked link"
                          >
                            <Trash2 size={13} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            style={{
                              ...styles.reminderActionButton,
                              ...styles.reminderDeleteButton,
                            }}
                            disabled={shareManagerBusy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Revoke this share link? Anyone using it will lose access.",
                                )
                              ) {
                                revokeSharedLink(link);
                              }
                            }}
                            title="Revoke link"
                          >
                            <Ban size={13} />
                          </button>
                        )}

                        <button
                          type="button"
                          style={styles.reminderActionButton}
                          disabled={shareManagerBusy}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Remove this link from Share Management? This only removes it from your manager; it does not revoke the server link.",
                              )
                            ) {
                              removeShareFromManagerOnly(link);
                            }
                          }}
                          title="Remove from manager"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.importFooter}>
              <button
                type="button"
                style={styles.primaryButton}
                onClick={closeShareManager}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showShareModal && selected && (
        <div style={styles.overlay}>
          <div
            style={{
              ...styles.formModal,
              maxWidth: 560,
            }}
          >
            <button
              type="button"
              style={styles.modalClose}
              onClick={closeShareModal}
            >
              <X size={17} />
            </button>

            <div style={styles.detailEyebrow}>SHARE NOTE</div>

            <h2 style={styles.formTitle}>
              Share “{selected.title || "Untitled note"}”
            </h2>

            <p style={styles.copy}>
              Share only this note. Your main Notes vault remains private.
            </p>

            <div style={styles.shareOptionGroup}>
              <div style={styles.importSectionTitle}>Access</div>

              <label style={styles.shareOption}>
                <input
                  type="radio"
                  name="share-access"
                  value="link"
                  checked={shareAccess === "link"}
                  onChange={() => setShareAccess("link")}
                />
                <span>
                  <strong>Anyone with the link</strong>
                  <span style={styles.shareOptionDetail}>
                    The recipient can open this note only.
                  </span>
                </span>
              </label>
            </div>

            <div style={styles.shareOptionGroup}>
              <div style={styles.importSectionTitle}>Permission</div>

              <label style={styles.shareOption}>
                <input
                  type="radio"
                  name="share-permission"
                  value="read-only"
                  checked={sharePermission === "read-only"}
                  onChange={() => setSharePermission("read-only")}
                />
                <span>
                  <strong>Read only</strong>
                  <span style={styles.shareOptionDetail}>
                    Recipients cannot edit the note.
                  </span>
                </span>
              </label>
            </div>

            <div style={styles.shareOptionGroup}>
              <div style={styles.importSectionTitle}>Expires</div>

              <select
                value={shareExpiration}
                onChange={(e) => setShareExpiration(e.target.value)}
                style={styles.input}
              >
                <option value="never">Never</option>
                <option value="1h">In 1 hour</option>
                <option value="1d">In 1 day</option>
                <option value="7d">In 7 days</option>
                <option value="30d">In 30 days</option>
              </select>
            </div>

            <div style={styles.shareSecurityNotice}>
              <ShieldCheck size={15} />
              <span>
                Sharing will use a separate encrypted share record, not your
                vault password.
              </span>
            </div>

            <div style={styles.shareExpiryPreview}>
              <Clock3 size={13} />
              <span>
                {shareCreated
                  ? formatShareCountdown(
                      sharedLinks.find(
                        (link) =>
                          link.shareId ===
                          shareUrl.split("/share/")[1]?.split("#")[0],
                      )?.expiresAt || null,
                    )
                  : shareExpiration === "never"
                    ? "Never expires"
                    : `Link will expire ${
                        shareExpiration === "1h"
                          ? "in 1 hour"
                          : shareExpiration === "1d"
                            ? "in 1 day"
                            : shareExpiration === "7d"
                              ? "in 7 days"
                              : "in 30 days"
                      }`}
              </span>
            </div>

            {shareCreated && shareUrl && (
              <div style={styles.shareCreatedBox}>
                <div style={styles.shareCreatedLabel}>
                  Secure read-only link
                </div>
                <input
                  readOnly
                  value={shareUrl}
                  style={styles.shareLinkInput}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  style={styles.secondaryFullButton}
                  onClick={copyShareUrl}
                >
                  {shareCopied ? "Copied" : "Copy share link"}
                </button>
                <div style={styles.shareCreatedHint}>
                  The encryption key is kept in the URL fragment and is never
                  sent to the server.
                </div>
              </div>
            )}

            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.importFooter}>
              <button
                type="button"
                style={styles.linkButton}
                onClick={closeShareModal}
              >
                Cancel
              </button>

              <button
                type="button"
                style={styles.primaryButton}
                onClick={prepareShareLink}
                disabled={
                  shareBusy || Boolean(selected?.trashed || selected?.archived)
                }
              >
                <Share2 size={14} />
                {shareBusy
                  ? "Creating…"
                  : shareCreated
                    ? "Create another link"
                    : "Create secure link"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div style={styles.overlay}>
          <div
            style={{
              ...styles.formModal,
              maxWidth: 820,
            }}
          >
            <button
              type="button"
              style={styles.modalClose}
              onClick={() => {
                setShowImportModal(false);
                setImportPreview([]);
                setImportSelectedIds([]);
              }}
              disabled={importBusy}
            >
              <X size={17} />
            </button>

            <div style={styles.detailEyebrow}>IMPORT NOTES</div>

            <h2 style={styles.formTitle}>Import notes</h2>

            <p style={styles.copy}>
              {importFileName || "Selected file"} · {importFormat.toUpperCase()}{" "}
              · {importPreview.length} note
              {importPreview.length === 1 ? "" : "s"}
            </p>

            <div style={styles.importStats}>
              <span style={styles.importStatNew}>✓ {importNewCount} new</span>
              <span
                style={{
                  ...styles.importStatDuplicate,
                  ...(importDuplicateCount === 0 ? styles.importStatZero : {}),
                }}
              >
                {importDuplicateCount > 0 ? "⚠" : "✓"} {importDuplicateCount}{" "}
                duplicate
                {importDuplicateCount === 1 ? "" : "s"}
              </span>
              <span style={styles.importStatSelected}>
                {importSelectedCount} selected
              </span>
            </div>

            <div style={styles.importDuplicateBox}>
              <div style={styles.importSectionTitle}>Duplicate handling</div>

              <label style={styles.importRadio}>
                <input
                  type="radio"
                  name="import-duplicate-mode"
                  checked={importDuplicateMode === "skip"}
                  onChange={() => setImportDuplicateMode("skip")}
                />
                <span>
                  <strong>Skip duplicates</strong>
                  <span style={styles.importRadioText}>
                    <span style={styles.importRadioDetail}>
                      Recommended · keeps existing notes
                    </span>
                  </span>
                </span>
              </label>

              <label style={styles.importRadio}>
                <input
                  type="radio"
                  name="import-duplicate-mode"
                  checked={importDuplicateMode === "keep"}
                  onChange={() => setImportDuplicateMode("keep")}
                />
                <span>
                  <strong>Keep both</strong>
                  <span style={styles.importRadioText}>
                    <span style={styles.importRadioDetail}>
                      Imports everything as a new note
                    </span>
                  </span>
                </span>
              </label>

              <label style={styles.importRadio}>
                <input
                  type="radio"
                  name="import-duplicate-mode"
                  checked={importDuplicateMode === "replace"}
                  onChange={() => setImportDuplicateMode("replace")}
                />
                <span>
                  <strong>Replace existing</strong>
                  <span style={styles.importRadioText}>
                    <span style={styles.importRadioDetail}>
                      Match by title + content
                    </span>
                  </span>
                </span>
              </label>
            </div>

            <div style={styles.importPreviewHeader}>
              <span>Preview</span>

              <button
                type="button"
                style={styles.linkButton}
                onClick={() => {
                  const all = importPreview.map((note) => note.id);

                  setImportSelectedIds(
                    importSelectedIds.length === all.length ? [] : all,
                  );
                }}
              >
                {importSelectedIds.length === importPreview.length
                  ? "Clear all"
                  : "Select all"}
              </button>
            </div>

            <div style={styles.importPreviewList}>
              {importPreview.map((note) => {
                const checked = importSelectedIds.includes(note.id);

                return (
                  <label key={note.id} style={styles.importPreviewRow}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setImportSelectedIds((current) =>
                          current.includes(note.id)
                            ? current.filter((id) => id !== note.id)
                            : [...current, note.id],
                        );
                      }}
                    />

                    <div style={styles.importPreviewText}>
                      <strong>{note.title}</strong>

                      <span>
                        {String(note.content || "")
                          .replace(/\s+/g, " ")
                          .slice(0, 100) || "Empty note"}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.importFooter}>
              <button
                type="button"
                style={styles.linkButton}
                onClick={() => {
                  setShowImportModal(false);
                  setImportPreview([]);
                  setImportSelectedIds([]);
                  setError("");
                }}
                disabled={importBusy}
              >
                Cancel
              </button>

              <button
                type="button"
                style={styles.primaryButton}
                onClick={handleImportNotes}
                disabled={importBusy || importSelectedIds.length === 0}
              >
                {importBusy
                  ? "Importing…"
                  : `Import ${Math.max(
                      0,
                      importSelectedCount -
                        (importDuplicateMode === "skip"
                          ? importPreview.filter(
                              (note) =>
                                importSelectedIds.includes(note.id) &&
                                notes.some(
                                  (existing) =>
                                    String(existing.title || "")
                                      .trim()
                                      .toLowerCase() ===
                                      String(note.title || "")
                                        .trim()
                                        .toLowerCase() &&
                                    String(existing.content || "").trim() ===
                                      String(note.content || "").trim(),
                                ),
                            ).length
                          : 0),
                    )} note${
                      Math.max(
                        0,
                        importSelectedCount -
                          (importDuplicateMode === "skip"
                            ? importPreview.filter(
                                (note) =>
                                  importSelectedIds.includes(note.id) &&
                                  notes.some(
                                    (existing) =>
                                      String(existing.title || "")
                                        .trim()
                                        .toLowerCase() ===
                                        String(note.title || "")
                                          .trim()
                                          .toLowerCase() &&
                                      String(existing.content || "").trim() ===
                                        String(note.content || "").trim(),
                                  ),
                              ).length
                            : 0),
                      ) === 1
                        ? ""
                        : "s"
                    }`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReminderHistory && (
        <div style={styles.overlay}>
          <div
            style={{
              ...styles.formModal,
              maxWidth: 760,
            }}
          >
            <button
              type="button"
              style={styles.modalClose}
              onClick={() => setShowReminderHistory(false)}
              aria-label="Close reminder history"
            >
              <X size={17} />
            </button>

            <div style={styles.detailEyebrow}>REMINDER HISTORY</div>

            <h2 style={styles.formTitle}>Reminder History</h2>

            <p style={styles.copy}>Recent Telegram reminder activity.</p>

            <p style={styles.copy}>Recent Telegram reminder activity.</p>

            <div style={styles.historyControls}>
              <div style={styles.historySearch}>
                <Search size={14} color="#626873" />
                <input
                  value={reminderHistoryQuery}
                  onChange={(e) => setReminderHistoryQuery(e.target.value)}
                  placeholder="Search history…"
                  style={styles.historySearchInput}
                />
              </div>

              <div style={styles.historyFilters}>
                {[
                  ["all", "All"],
                  ["sent", "Sent"],
                  ["snoozed", "Snoozed"],
                  ["failed", "Failed"],
                  ["cancelled", "Cancelled"],
                  ["scheduled", "Scheduled"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    style={{
                      ...styles.historyFilterButton,
                      ...(reminderHistoryFilter === value
                        ? styles.historyFilterButtonActive
                        : {}),
                    }}
                    onClick={() => setReminderHistoryFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {reminderHistoryLoading ? (
              <div style={styles.historyState}>Loading history…</div>
            ) : reminderHistoryError ? (
              <div style={styles.error}>{reminderHistoryError}</div>
            ) : reminderHistory.length === 0 ? (
              <div style={styles.reminderCenterEmpty}>
                <Bell size={26} />
                <strong>No reminder history yet</strong>
                <span>
                  Sent, snoozed and failed reminder activity will appear here.
                </span>
              </div>
            ) : filteredReminderHistory.length === 0 ? (
              <div style={styles.reminderCenterEmpty}>
                <Bell size={26} />
                <strong>No matching history</strong>
                <span>Try another search or filter.</span>
              </div>
            ) : (
              <div style={styles.historyList}>
                {filteredReminderHistory.map((item) => {
                  const date = new Date(item.created_at);

                  const symbol =
                    item.action === "sent"
                      ? "✓"
                      : item.action === "snoozed"
                        ? "◷"
                        : item.action === "failed"
                          ? "!"
                          : item.action === "cancelled"
                            ? "×"
                            : item.action === "paused"
                              ? "Ⅱ"
                              : item.action === "resumed"
                                ? "▶"
                                : "•";

                  return (
                    <div key={item.id} style={styles.historyRow}>
                      <div
                        style={{
                          ...styles.historyIcon,
                          ...(item.action === "failed"
                            ? styles.historyIconFailed
                            : item.action === "cancelled"
                              ? styles.historyIconCancelled
                              : {}),
                        }}
                      >
                        {symbol}
                      </div>

                      <div style={styles.historyBody}>
                        <div style={styles.historyTitle}>
                          <strong>{item.title || "Untitled reminder"}</strong>

                          <span style={styles.historyAction}>
                            {String(item.action || "updated")
                              .charAt(0)
                              .toUpperCase() +
                              String(item.action || "updated").slice(1)}
                          </span>
                        </div>

                        <div style={styles.historyMeta}>
                          {Number.isNaN(date.getTime())
                            ? "Unknown time"
                            : date.toLocaleString(undefined, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}

                          {item.detail ? ` · ${item.detail}` : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              style={styles.secondaryFullButton}
              onClick={loadReminderHistory}
              disabled={reminderHistoryLoading}
            >
              Refresh history
            </button>
          </div>
        </div>
      )}

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
              onClick={() => {
                setShowReminderCenter(false);
                setReminderQuery("");
                setReminderFilter("all");
                setReminderSort("soonest");
              }}
            >
              <X size={17} />
            </button>

            <div style={styles.detailEyebrow}>REMINDER CENTER</div>

            <h2 style={styles.formTitle}>Reminders</h2>

            <p style={styles.copy}>
              View and manage all your upcoming note reminders.
            </p>

            {error && <div style={styles.error}>{error}</div>}

            {reminderCenterItems.length > 0 && (
              <>
                <div style={styles.reminderCenterSearch}>
                  <Search size={14} color="#69717B" />
                  <input
                    value={reminderQuery}
                    onChange={(e) => setReminderQuery(e.target.value)}
                    placeholder="Search reminders…"
                    style={styles.reminderCenterSearchInput}
                  />
                  {reminderQuery && (
                    <button
                      type="button"
                      style={styles.reminderCenterClearSearch}
                      onClick={() => setReminderQuery("")}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                <div style={styles.reminderCenterToolbar}>
                  <div style={styles.reminderFilterScroll}>
                    {[
                      ["all", "All"],
                      ["today", "Today"],
                      ["upcoming", "Upcoming"],
                      ["paused", "Paused"],
                      ["telegram", "Telegram"],
                      ["browser", "Browser"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        style={{
                          ...styles.reminderFilterChip,
                          ...(reminderFilter === value
                            ? styles.reminderFilterChipActive
                            : {}),
                        }}
                        onClick={() => setReminderFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div style={styles.reminderSortWrap}>
                    <SlidersHorizontal size={13} color="#69717B" />
                    <select
                      value={reminderSort}
                      onChange={(e) => setReminderSort(e.target.value)}
                      style={styles.reminderSortSelect}
                    >
                      <option value="soonest">Soonest</option>
                      <option value="latest">Latest</option>
                      <option value="recurring">Recurring</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            {reminderCenterItems.length > 0 &&
            reminderCenterFilteredItems.length === 0 ? (
              <div style={styles.reminderCenterEmpty}>
                <Search size={24} />
                <strong>No matching reminders</strong>
                <span>Try another search or filter.</span>
              </div>
            ) : null}

            {reminderCenterItems.length === 0 ? (
              <div style={styles.reminderCenterEmpty}>
                <CalendarDays size={28} />
                <strong>No reminders yet</strong>
                <span>Add a reminder from a note to see it here.</span>
              </div>
            ) : (
              <div style={styles.reminderCenterList}>
                {reminderCenterFilteredItems.map((note) => {
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

                        {!paused && note.notifyTelegram && (
                          <select
                            defaultValue=""
                            style={styles.snoozeSelect}
                            onChange={async (e) => {
                              const value = e.target.value;

                              if (!value) {
                                return;
                              }

                              if (value === "custom") {
                                const input = window.prompt(
                                  "Snooze for how many minutes?",
                                  "30",
                                );

                                if (input === null) {
                                  e.target.value = "";
                                  return;
                                }

                                const minutes = Number(input);

                                if (
                                  !Number.isFinite(minutes) ||
                                  minutes < 1 ||
                                  minutes > 10080
                                ) {
                                  setError(
                                    "Enter a snooze time between 1 and 10080 minutes.",
                                  );
                                  e.target.value = "";
                                  return;
                                }

                                await snoozeReminder(note, Math.round(minutes));
                              } else {
                                await snoozeReminder(note, Number(value));
                              }

                              e.target.value = "";
                            }}
                            title="Snooze reminder"
                            aria-label="Snooze reminder"
                          >
                            <option value="">Snooze</option>
                            <option value="5">5 min</option>
                            <option value="15">15 min</option>
                            <option value="30">30 min</option>
                            <option value="60">1 hour</option>
                            <option value="1440">Tomorrow</option>
                            <option value="custom">Custom…</option>
                          </select>
                        )}

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

            {!editing && (
              <>
                <label style={styles.label}>Template</label>

                <div style={styles.newNoteTemplateControl}>
                  <Repeat size={14} color="#68707A" />

                  <select
                    value={newNoteTemplateId}
                    onChange={(e) => {
                      const value = e.target.value;

                      setNewNoteTemplateId(value);

                      if (value === "blank") {
                        setForm({
                          title: "",
                          content: "",
                        });
                        editorLoadKeyRef.current = "";
                        setEditorHtml("");
                        setFormTags([]);
                        setFormAttachments([]);
                        setEditorStatus("New note");
                        return;
                      }

                      applyNoteTemplate(value);
                      setEditorStatus("Template applied");
                    }}
                    style={styles.newNoteTemplateSelect}
                  >
                    <option value="blank">Blank note</option>

                    {NOTE_TEMPLATES.length > 0 && (
                      <optgroup label="Built-in templates">
                        {NOTE_TEMPLATES.map((template) => (
                          <option
                            key={`builtin-${template.id}`}
                            value={template.id}
                          >
                            {template.name}
                          </option>
                        ))}
                      </optgroup>
                    )}

                    {customTemplates.length > 0 && (
                      <optgroup label="Your templates">
                        {customTemplates.map((template) => (
                          <option
                            key={`custom-${template.id}`}
                            value={template.id}
                          >
                            {template.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                {newNoteTemplateId !== "blank" && (
                  <div style={styles.newNoteTemplateHint}>
                    {(
                      NOTE_TEMPLATES.find(
                        (item) => item.id === newNoteTemplateId,
                      ) ||
                      customTemplates.find(
                        (item) => item.id === newNoteTemplateId,
                      )
                    )?.description ||
                      "Template applied. Everything remains editable."}
                  </div>
                )}
              </>
            )}

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
                  onClick={() => {
                    setFormReminder("");
                    setFormRecurrence("none");
                    setFormRecurrenceDay("");
                    setFormRecurrenceDays([]);
                    setFormRecurrenceInterval(1);
                    setFormRecurrenceUnit("days");
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            <label style={styles.label}>Repeat</label>

            <div style={styles.recurrenceControl}>
              <Repeat size={14} color="#68707A" />

              <select
                value={formRecurrence}
                disabled={!formReminder}
                onChange={(e) => {
                  const value = e.target.value;

                  setFormRecurrence(value);

                  if (value === "weekly" || value === "monthly") {
                    setFormRecurrenceDay(
                      defaultRecurrenceDay(formReminder, value),
                    );
                  } else {
                    setFormRecurrenceDay("");
                  }
                }}
                style={styles.recurrenceSelect}
              >
                <option value="none">Does not repeat</option>
                <option value="daily">Every day</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Every month</option>
                <option value="custom">Custom interval</option>
              </select>
            </div>

            {!formReminder && (
              <div style={styles.recurrenceHint}>
                Set a reminder time first.
              </div>
            )}

            {formReminder && formRecurrence === "weekly" && (
              <div style={styles.recurrenceExtraBlock}>
                <div style={styles.recurrenceExtraLabel}>Remind me on</div>

                <div style={styles.weekdayPicker}>
                  {RECURRENCE_WEEKDAYS.map((day, index) => {
                    const selectedDays = normalizeRecurrenceDays(
                      formRecurrenceDays.length
                        ? formRecurrenceDays
                        : [
                            Number(
                              defaultRecurrenceDay(formReminder, "weekly"),
                            ),
                          ],
                    );

                    const selected = selectedDays.includes(index);

                    return (
                      <button
                        key={day}
                        type="button"
                        title={day}
                        style={{
                          ...styles.weekdayChip,
                          ...(selected ? styles.weekdayChipActive : {}),
                        }}
                        onClick={() =>
                          setFormRecurrenceDays((current) => {
                            const base = normalizeRecurrenceDays(
                              current.length
                                ? current
                                : [
                                    Number(
                                      defaultRecurrenceDay(
                                        formReminder,
                                        "weekly",
                                      ),
                                    ),
                                  ],
                            );

                            const next = new Set(base);

                            if (next.has(index)) {
                              next.delete(index);
                            } else {
                              next.add(index);
                            }

                            return Array.from(next).sort((a, b) => a - b);
                          })
                        }
                      >
                        {day.slice(0, 3)}
                      </button>
                    );
                  })}
                </div>

                <div style={styles.recurrenceHint}>
                  {weekdayList(
                    formRecurrenceDays.length
                      ? formRecurrenceDays
                      : [Number(defaultRecurrenceDay(formReminder, "weekly"))],
                  ) || "Choose at least one day"}
                </div>
              </div>
            )}

            {formReminder && formRecurrence === "monthly" && (
              <div style={styles.recurrenceExtra}>
                <span style={styles.recurrenceExtraLabel}>Repeat on day</span>

                <select
                  value={
                    formRecurrenceDay ||
                    defaultRecurrenceDay(formReminder, "monthly")
                  }
                  onChange={(e) => setFormRecurrenceDay(e.target.value)}
                  style={styles.recurrenceSmallSelect}
                >
                  {Array.from({ length: 31 }, (_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {index + 1}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {formReminder && formRecurrence === "custom" && (
              <div style={styles.customRecurrenceRow}>
                <span style={styles.recurrenceExtraLabel}>Every</span>

                <input
                  type="number"
                  min="1"
                  max="3650"
                  step="1"
                  value={formRecurrenceInterval}
                  onChange={(e) =>
                    setFormRecurrenceInterval(
                      Math.max(1, Math.min(3650, Number(e.target.value) || 1)),
                    )
                  }
                  style={styles.customIntervalInput}
                />

                <select
                  value={formRecurrenceUnit}
                  onChange={(e) => setFormRecurrenceUnit(e.target.value)}
                  style={styles.recurrenceSmallSelect}
                >
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                  <option value="months">months</option>
                </select>
              </div>
            )}

            {formReminder && (
              <div style={styles.recurrenceHint}>
                {formRecurrence === "custom"
                  ? recurrenceIntervalLabel(
                      formRecurrence,
                      formRecurrenceInterval,
                      formRecurrenceUnit,
                    )
                  : recurrenceLabel(
                      formRecurrence,
                      formRecurrenceDay ||
                        defaultRecurrenceDay(formReminder, formRecurrence),
                    )}
              </div>
            )}

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
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggleInlineFormat("bold")}
                >
                  <Bold size={14} />
                </button>

                <button
                  type="button"
                  title="Italic"
                  style={styles.editorTool}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggleInlineFormat("italic")}
                >
                  <Italic size={14} />
                </button>

                <button
                  type="button"
                  title="Heading"
                  style={styles.editorTool}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertLinePrefix("## ")}
                >
                  <Heading2 size={14} />
                </button>

                <span style={styles.editorToolbarDivider} />

                <button
                  type="button"
                  title="Bullet list"
                  style={styles.editorTool}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertLinePrefix("• ")}
                >
                  <List size={14} />
                </button>

                <button
                  type="button"
                  title="Checklist"
                  style={styles.editorTool}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertLinePrefix("☐ ")}
                >
                  <ListChecks size={14} />
                </button>

                <button
                  type="button"
                  title="Quote"
                  style={styles.editorTool}
                  onMouseDown={(e) => e.preventDefault()}
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

              <div
                ref={contentInputRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                data-placeholder="Write your note…"
                onInput={(e) => syncEditorFromHtml(e.currentTarget)}
                onKeyDown={handleEditorKeyDown}
                style={{
                  ...styles.editorTextarea,
                  minHeight: 330,
                  overflowY: "auto",
                  whiteSpace: "pre-wrap",
                  outline: "none",
                }}
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

            <div
              style={{
                ...styles.attachmentSection,
                ...(isAttachmentDragging
                  ? styles.attachmentSectionDragging
                  : {}),
              }}
              onDragEnter={handleAttachmentDragOver}
              onDragOver={handleAttachmentDragOver}
              onDragLeave={handleAttachmentDragLeave}
              onDrop={handleAttachmentDrop}
            >
              <div style={styles.attachmentHeader}>
                <div>
                  <div style={styles.attachmentTitle}>Attachments</div>
                  <div style={styles.attachmentHint}>
                    Encrypted with this note · 5 MB each · 10 MB total
                  </div>
                </div>

                <button
                  type="button"
                  style={styles.attachmentAddButton}
                  title="Add attachments"
                  disabled={attachmentBusy}
                  onClick={() => {
                    attachmentInputRef.current?.click();
                  }}
                >
                  <Paperclip size={13} />
                  {attachmentBusy ? "Reading…" : "Add files"}
                </button>

                <input
                  ref={attachmentInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.txt,.md,.doc,.docx,.xls,.xlsx,.csv,.zip"
                  style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    opacity: 0,
                    pointerEvents: "none",
                  }}
                  tabIndex={-1}
                  onChange={async (event) => {
                    const files = event.target.files;

                    await addAttachments(files);

                    event.target.value = "";
                  }}
                />
              </div>

              {isAttachmentDragging && (
                <div style={styles.attachmentDropHint}>
                  <Paperclip size={16} />
                  <strong>Drop files here</strong>
                  <span style={styles.attachmentDropHintSubtext}>
                    Release to attach · 5 MB each · 10 MB total
                  </span>
                </div>
              )}

              {formAttachments.length > 0 && (
                <div style={styles.attachmentList}>
                  {formAttachments.map((attachment) => (
                    <div key={attachment.id} style={styles.attachmentRow}>
                      <div style={styles.attachmentInfo}>
                        <strong
                          style={styles.attachmentInfoStrong}
                          title={attachment.name}
                        >
                          {attachment.name}
                        </strong>
                        <span>{formatAttachmentSize(attachment.size)}</span>
                      </div>

                      <button
                        type="button"
                        style={styles.attachmentAction}
                        onClick={() => downloadAttachment(attachment)}
                        title="Download attachment"
                      >
                        <Download size={13} />
                      </button>

                      <button
                        type="button"
                        style={{
                          ...styles.attachmentAction,
                          ...styles.attachmentRemove,
                        }}
                        onClick={() => removeAttachment(attachment.id)}
                        title="Remove attachment"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
  copiedToast: {
    position: "fixed",
    left: "50%",
    bottom: 26,
    transform: "translateX(-50%)",
    zIndex: 120,
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "9px 13px",
    border: "1px solid #304638",
    borderRadius: 8,
    background: "#151A18",
    color: "#9FE9A8",
    fontSize: 10,
    fontWeight: 600,
    boxShadow: "0 10px 28px rgba(0,0,0,0.32)",
    pointerEvents: "none",
  },

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

  currentNotesView: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    marginTop: 7,
    padding: "5px 8px",
    border: "1px solid #2D323B",
    borderRadius: 7,
    background: "#181B20",
  },

  currentNotesViewBadge: {
    color: "#D9D7D0",
    fontSize: 9,
    fontWeight: 700,
  },

  currentNotesViewDetail: {
    color: "#69717B",
    fontSize: 9,
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

  newNoteTemplateControl: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 38,
    padding: "0 10px",
    border: "1px solid #292E36",
    borderRadius: 7,
    background: "#14171C",
  },

  newNoteTemplateSelect: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#B8BDC4",
    fontSize: 10,
    cursor: "pointer",
  },

  newNoteTemplateHint: {
    marginTop: 5,
    color: "#68717B",
    fontSize: 8,
    lineHeight: 1.45,
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

  attachmentSection: {
    marginTop: 12,
    padding: "11px 12px",
    border: "1px solid #292E36",
    borderRadius: 9,
    background: "#14171C",
  },

  attachmentSectionDragging: {
    borderColor: "#4FE36B",
    background: "#142018",
    boxShadow: "0 0 0 1px rgba(79,227,107,0.12) inset",
  },

  attachmentDropHint: {
    marginTop: 9,
    minHeight: 72,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    border: "1px dashed #3B8B4A",
    borderRadius: 8,
    background: "#111914",
    color: "#7FE88C",
    fontSize: 9,
  },

  attachmentDropHintSubtext: {
    color: "#718078",
    fontSize: 8,
  },

  attachmentHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  attachmentTitle: {
    color: "#C8C6BF",
    fontSize: 10,
    fontWeight: 700,
  },

  attachmentHint: {
    marginTop: 3,
    color: "#68717B",
    fontSize: 8,
  },

  attachmentAddButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 8px",
    border: "1px solid #30353D",
    borderRadius: 6,
    background: "#1A1E24",
    color: "#A8ADB4",
    fontSize: 9,
    cursor: "pointer",
  },

  attachmentList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 9,
  },

  attachmentRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 8px",
    border: "1px solid #292E36",
    borderRadius: 7,
    background: "#171A1F",
  },

  attachmentInfo: {
    minWidth: 0,
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    color: "#B8BDC4",
    fontSize: 9,
  },

  attachmentInfoStrong: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  attachmentAction: {
    width: 28,
    height: 28,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #2C323A",
    borderRadius: 6,
    background: "#191D22",
    color: "#818A95",
    cursor: "pointer",
  },

  attachmentRemove: {
    color: "#AF776E",
  },

  editorTextareaPlaceholder: {
    color: "#666D76",
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

  noteViewSwitcher: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    marginTop: 12,
    marginBottom: 8,
    padding: 5,
    border: "1px solid #2D323B",
    borderRadius: 9,
    background: "#15181D",
  },

  noteViewLabel: {
    padding: "0 5px",
    color: "#5F6772",
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: 0.8,
  },

  noteViewTab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 9px",
    border: "1px solid transparent",
    borderRadius: 7,
    background: "transparent",
    color: "#858D98",
    cursor: "pointer",
    fontSize: 10,
    fontWeight: 600,
  },

  noteViewTabActive: {
    border: "1px solid #3E6D48",
    background: "#203225",
    color: "#78C887",
  },

  noteViewTabTrashActive: {
    border: "1px solid #714046",
    background: "#302126",
    color: "#D9919A",
  },

  noteViewCount: {
    minWidth: 18,
    padding: "2px 5px",
    borderRadius: 8,
    background: "#20242B",
    color: "#7D8590",
    fontSize: 8,
    textAlign: "center",
  },

  noteViewStatus: {
    marginLeft: "auto",
    padding: "0 6px",
    color: "#606873",
    fontSize: 9,
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

  tagFilterToolbar: {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    marginTop: 7,
    marginBottom: 8,
  },

  tagManageButton: {
    border: "none",
    borderRadius: 5,
    padding: "4px 6px",
    background: "#1C2026",
    color: "#818A95",
    fontSize: 8,
    cursor: "pointer",
  },

  shortcutList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 14,
  },

  shortcutRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "9px 10px",
    border: "1px solid #292E36",
    borderRadius: 7,
    background: "#15181D",
    color: "#AEB4BC",
    fontSize: 10,
  },

  shortcutKeys: {
    minWidth: 125,
    padding: "4px 6px",
    border: "1px solid #343A43",
    borderBottomWidth: 2,
    borderRadius: 5,
    background: "#101318",
    color: "#D5D2CB",
    fontSize: 9,
    textAlign: "center",
  },

  shortcutHint: {
    marginTop: 10,
    color: "#69727C",
    fontSize: 8,
    lineHeight: 1.5,
  },

  tagManagerList: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    marginTop: 14,
    maxHeight: 320,
    overflowY: "auto",
  },

  tagManagerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 11px",
    border: "1px solid #2D323B",
    borderRadius: 8,
    background: "#15181D",
  },

  tagManagerInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },

  tagManagerStrong: {
    color: "#D9D7D0",
    fontSize: 10,
  },

  tagManagerCount: {
    color: "#69717B",
    fontSize: 8,
  },

  tagManagerActions: {
    display: "flex",
    gap: 5,
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

  reminderCenterSearch: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    border: "1px solid #2C3038",
    borderRadius: 8,
    background: "#15181D",
    padding: "8px 9px",
    marginTop: 12,
  },

  reminderCenterSearchInput: {
    flex: 1,
    minWidth: 0,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#DAD7D0",
    fontSize: 11,
  },

  reminderCenterClearSearch: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    background: "transparent",
    color: "#717984",
    cursor: "pointer",
    padding: 2,
  },

  reminderCenterToolbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    flexWrap: "wrap",
  },

  reminderFilterScroll: {
    display: "flex",
    gap: 5,
    flex: 1,
    overflowX: "auto",
    paddingBottom: 2,
  },

  reminderFilterChip: {
    flexShrink: 0,
    border: "1px solid #2C3038",
    borderRadius: 999,
    background: "#181B20",
    color: "#7F8791",
    fontSize: 9,
    padding: "6px 9px",
    cursor: "pointer",
  },

  reminderFilterChipActive: {
    background: "#202A22",
    border: "1px solid #38563F",
    color: "#83B48D",
  },

  reminderSortWrap: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    border: "1px solid #2C3038",
    borderRadius: 7,
    padding: "4px 7px",
    background: "#181B20",
  },

  reminderSortSelect: {
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#A3A9B1",
    fontSize: 9,
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

  snoozeSelect: {
    minWidth: 72,
    height: 30,
    border: "1px solid #2D323B",
    borderRadius: 7,
    background: "#181B20",
    color: "#8D949E",
    padding: "0 8px",
    fontSize: 10,
    cursor: "pointer",
    outline: "none",
  },

  reminderActionButton: {
    minWidth: 30,
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

  importStats: {
    display: "flex",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 8,
  },

  importStatNew: {
    padding: "4px 7px",
    borderRadius: 6,
    background: "#203225",
    color: "#78C887",
    fontSize: 9,
  },

  importStatDuplicate: {
    padding: "4px 7px",
    borderRadius: 6,
    background: "#39291F",
    color: "#D4A06D",
    fontSize: 9,
  },

  importStatZero: {
    background: "#20242B",
    color: "#8A929C",
  },

  importStatSelected: {
    padding: "4px 7px",
    borderRadius: 6,
    background: "#20242B",
    color: "#8A929C",
    fontSize: 9,
  },

  shareExpiryPreview: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 9,
    color: "#818A95",
    fontSize: 9,
  },

  versionHistoryList: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    marginTop: 14,
    maxHeight: 360,
    overflowY: "auto",
  },

  versionHistoryRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 11px",
    border: "1px solid #2D323B",
    borderRadius: 8,
    background: "#15181D",
  },

  versionHistoryInfo: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },

  versionHistoryStrong: {
    color: "#D9D7D0",
    fontSize: 10,
  },

  versionHistoryDate: {
    color: "#69717B",
    fontSize: 8,
  },

  versionHistoryPreview: {
    margin: 0,
    maxWidth: 470,
    color: "#747D88",
    fontSize: 9,
    lineHeight: 1.4,
  },

  shareManagerList: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    marginTop: 14,
    maxHeight: 340,
    overflowY: "auto",
  },

  shareManagerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 11px",
    border: "1px solid #2D323B",
    borderRadius: 8,
    background: "#15181D",
  },

  shareManagerInfo: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },

  shareManagerTitle: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#D9D7D0",
    fontSize: 11,
    fontWeight: 600,
  },

  shareManagerMeta: {
    color: "#69717B",
    fontSize: 9,
  },

  shareManagerActions: {
    display: "flex",
    gap: 5,
    flexShrink: 0,
  },

  shareManagerEmpty: {
    minHeight: 180,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    border: "1px dashed #30353E",
    borderRadius: 9,
    color: "#6E7680",
    textAlign: "center",
    fontSize: 10,
  },

  shareOptionGroup: {
    marginTop: 12,
    padding: "10px 0 0",
  },

  shareOption: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "8px 0",
    color: "#D9D7D0",
    fontSize: 10,
    cursor: "pointer",
  },

  shareOptionDetail: {
    display: "block",
    marginTop: 3,
    color: "#69717B",
    fontSize: 9,
  },

  shareSecurityNotice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    marginTop: 14,
    padding: "9px 10px",
    border: "1px solid #27352D",
    borderRadius: 8,
    background: "#151A17",
    color: "#78907D",
    fontSize: 9,
    lineHeight: 1.4,
  },

  sharePending: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    marginTop: 10,
    padding: "9px 10px",
    border: "1px solid #3A3F28",
    borderRadius: 8,
    background: "#211F16",
    color: "#B5A66E",
    fontSize: 9,
  },

  importDuplicateBox: {
    marginTop: 12,
    padding: 10,
    border: "1px solid #2D323B",
    borderRadius: 9,
    background: "#181B20",
  },

  importSectionTitle: {
    color: "#A4ABB5",
    fontSize: 10,
    fontWeight: 700,
    marginBottom: 8,
  },

  importRadio: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "7px 0",
    color: "#D9D7D0",
    fontSize: 10,
    cursor: "pointer",
  },

  importRadioText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },

  importRadioDetail: {
    color: "#69717B",
    fontSize: 9,
  },

  importPreviewHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
    marginBottom: 6,
    color: "#9EA5AF",
    fontSize: 10,
    fontWeight: 700,
  },

  importPreviewList: {
    maxHeight: 360,
    overflowY: "auto",
    border: "1px solid #2D323B",
    borderRadius: 8,
  },

  importPreviewRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    padding: "9px 10px",
    borderBottom: "1px solid #242830",
    cursor: "pointer",
  },

  importPreviewText: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
  },

  importFooter: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
  },

  historyControls: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 12,
    marginBottom: 10,
  },

  historySearch: {
    height: 32,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 10px",
    border: "1px solid #2D323B",
    borderRadius: 7,
    background: "#181B20",
  },

  historySearchInput: {
    flex: 1,
    minWidth: 0,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#D9D7D0",
    fontSize: 11,
  },

  historyFilters: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },

  historyFilterButton: {
    border: "1px solid #2D323B",
    borderRadius: 6,
    background: "#181B20",
    color: "#7F8792",
    padding: "5px 8px",
    fontSize: 9,
    cursor: "pointer",
  },

  historyFilterButtonActive: {
    border: "1px solid #3E6D48",
    background: "#203225",
    color: "#72C681",
  },

  historyState: {
    minHeight: 180,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#69717B",
    fontSize: 12,
  },

  historyList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    marginTop: 12,
    maxHeight: 500,
    overflowY: "auto",
    borderTop: "1px solid #242830",
    borderBottom: "1px solid #242830",
  },

  historyRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "11px 10px",
    borderBottom: "1px solid #242830",
  },

  historyIcon: {
    width: 28,
    height: 28,
    flexShrink: 0,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#203225",
    color: "#76C888",
    fontSize: 13,
    fontWeight: 700,
  },

  historyIconFailed: {
    background: "#39231F",
    color: "#D67D6D",
  },

  historyIconCancelled: {
    background: "#33262A",
    color: "#C98B99",
  },

  historyBody: {
    flex: 1,
    minWidth: 0,
  },

  historyTitle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  historyAction: {
    flexShrink: 0,
    padding: "3px 6px",
    borderRadius: 5,
    background: "#20242B",
    color: "#89919C",
    fontSize: 9,
  },

  historyMeta: {
    marginTop: 4,
    color: "#6E7682",
    fontSize: 10,
  },

  archivedBadge: {
    padding: "4px 6px",
    borderRadius: 5,
    background: "#2A2E33",
    color: "#A7AFB9",
    fontSize: 9,
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

  customRecurrenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 7,
  },

  customIntervalInput: {
    width: 70,
    boxSizing: "border-box",
    border: "1px solid #2C3038",
    borderRadius: 6,
    background: "#181B20",
    color: "#D9D7D0",
    padding: "6px 8px",
    fontSize: 10,
  },

  recurrenceControl: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid #2C3038",
    borderRadius: 8,
    background: "#181B20",
    padding: "9px 10px",
  },

  recurrenceSelect: {
    flex: 1,
    minWidth: 0,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#D9D7D0",
    fontSize: 11,
    cursor: "pointer",
  },

  recurrenceExtraBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    marginTop: 7,
  },

  weekdayPicker: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },

  weekdayChip: {
    minWidth: 38,
    padding: "7px 8px",
    border: "1px solid #2C3038",
    borderRadius: 7,
    background: "#181B20",
    color: "#858C96",
    fontSize: 10,
    fontWeight: 600,
    cursor: "pointer",
  },

  weekdayChipActive: {
    border: "1px solid #3AA850",
    background: "#1C3421",
    color: "#63E278",
  },

  recurrenceExtra: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    marginTop: 7,
  },

  recurrenceExtraLabel: {
    color: "#727985",
    fontSize: 10,
  },

  recurrenceSmallSelect: {
    border: "1px solid #2C3038",
    borderRadius: 6,
    background: "#181B20",
    color: "#D9D7D0",
    padding: "6px 8px",
    fontSize: 10,
    cursor: "pointer",
  },

  recurrenceHint: {
    marginTop: 6,
    color: "#788C7D",
    fontSize: 10,
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

  templateWrap: {
    position: "relative",
  },

  templateMenu: {
    position: "absolute",
    top: "calc(100% + 7px)",
    right: 0,
    width: 245,
    zIndex: 50,
    padding: 6,
    border: "1px solid #2D323B",
    borderRadius: 9,
    background: "#15181D",
    boxShadow: "0 16px 35px rgba(0,0,0,0.35)",
  },

  templateMenuTitle: {
    padding: "6px 7px 8px",
    color: "#E1DED6",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  templateMenuSection: {
    padding: "8px 7px 5px",
    color: "#59616D",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 0.7,
  },

  templateMenuManage: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 7,
    marginTop: 5,
    padding: "8px 7px",
    borderTop: "1px solid #2D323B",
    borderRight: "none",
    borderBottom: "none",
    borderLeft: "none",
    background: "#15181D",
    color: "#8C949F",
    cursor: "pointer",
    fontSize: 9,
    textAlign: "left",
  },

  customTemplateList: {
    marginTop: 14,
    border: "1px solid #2D323B",
    borderRadius: 8,
    overflow: "hidden",
  },

  templateListTitle: {
    padding: "8px 10px",
    color: "#8C949F",
    background: "#181B20",
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
  },

  customTemplateRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "9px 10px",
    borderTop: "1px solid #242830",
  },

  customTemplateInfo: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    color: "#D9D7D0",
    fontSize: 10,
  },

  customTemplateActions: {
    display: "flex",
    gap: 5,
    flexShrink: 0,
  },

  templateMenuItem: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 3,
    padding: "9px 8px",
    border: "none",
    borderRadius: 7,
    background: "#15181D",
    color: "#D9D7D0",
    cursor: "pointer",
    textAlign: "left",
  },

  templateMenuItemDetail: {
    color: "#6F7782",
    fontSize: 9,
  },

  trashButtonActive: {
    border: "1px solid #714046",
    background: "#302126",
    color: "#D9919A",
  },

  trashBadge: {
    padding: "4px 6px",
    borderRadius: 5,
    background: "#302126",
    color: "#D9919A",
    fontSize: 9,
  },

  archiveButtonActive: {
    border: "1px solid #3E6D48",
    background: "#203225",
    color: "#72C681",
  },

  autoLockWrap: {
    position: "relative",
    display: "inline-flex",
  },

  autoLockValue: {
    color: "#737C87",
    fontSize: 8,
    marginLeft: 1,
  },

  autoLockMenu: {
    position: "absolute",
    top: "calc(100% + 7px)",
    right: 0,
    zIndex: 60,
    width: 210,
    padding: 7,
    border: "1px solid #2C323A",
    borderRadius: 9,
    background: "#171A1F",
    boxShadow: "0 16px 34px rgba(0,0,0,0.35)",
  },

  autoLockMenuTitle: {
    padding: "5px 7px 2px",
    color: "#68717C",
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: 0.9,
  },

  autoLockMenuCopy: {
    padding: "2px 7px 7px",
    color: "#717A85",
    fontSize: 9,
    lineHeight: 1.4,
  },

  autoLockMenuItem: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 8px",
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "#B8BEC6",
    fontSize: 9,
    textAlign: "left",
    cursor: "pointer",
  },

  autoLockMenuItemActive: {
    background: "#22272E",
    color: "#E2E0D9",
  },

  noteExportWrap: {
    position: "relative",
    display: "inline-flex",
  },

  noteExportMenu: {
    position: "absolute",
    top: "calc(100% + 7px)",
    right: 0,
    zIndex: 40,
    width: 220,
    padding: 6,
    border: "1px solid #2C323A",
    borderRadius: 9,
    background: "#171A1F",
    boxShadow: "0 16px 34px rgba(0,0,0,0.34)",
  },

  noteExportMenuTitle: {
    padding: "6px 8px 7px",
    color: "#676F79",
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },

  exportWrap: {
    position: "relative",
  },

  exportMenu: {
    position: "absolute",
    top: "calc(100% + 7px)",
    right: 0,
    width: 210,
    zIndex: 50,
    padding: 6,
    border: "1px solid #2D323B",
    borderRadius: 9,
    background: "#15181D",
    boxShadow: "0 16px 35px rgba(0,0,0,0.35)",
  },

  exportMenuTitle: {
    padding: "6px 7px 8px",
    color: "#E1DED6",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  exportMenuItem: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    padding: "8px 7px",
    border: "none",
    borderRadius: 7,
    background: "#15181D",
    color: "#D9D7D0",
    cursor: "pointer",
    textAlign: "left",
    fontSize: 10,
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

  searchFilterWrap: {
    position: "relative",
    flexShrink: 0,
  },

  searchFilterButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    height: 30,
    padding: "0 9px",
    border: "1px solid #2B3038",
    borderRadius: 6,
    background: "#171A1F",
    color: "#858D97",
    fontSize: 9,
    cursor: "pointer",
  },

  searchFilterButtonActive: {
    borderColor: "#3B4D3F",
    color: "#B7C7BA",
    background: "#18201B",
  },

  searchFilterBadge: {
    minWidth: 15,
    height: 15,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 99,
    background: "#2B3F30",
    color: "#A8D5AE",
    fontSize: 8,
    fontWeight: 700,
  },

  searchFilterMenu: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    zIndex: 70,
    width: 225,
    padding: 6,
    border: "1px solid #2C323A",
    borderRadius: 8,
    background: "#171A1F",
    boxShadow: "0 16px 34px rgba(0,0,0,0.34)",
  },

  searchFilterTitle: {
    padding: "6px 8px",
    color: "#68717B",
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: 0.9,
  },

  searchFilterItem: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 8px",
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "#B6BCC4",
    fontSize: 9,
    textAlign: "left",
    cursor: "pointer",
  },

  searchFilterCheck: {
    width: 17,
    height: 17,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #39404A",
    borderRadius: 4,
    color: "#68717B",
    fontSize: 10,
  },

  searchFilterCheckActive: {
    width: 17,
    height: 17,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #4E7B58",
    borderRadius: 4,
    background: "#1D3021",
    color: "#9ED5A4",
    fontSize: 10,
  },

  searchFilterClear: {
    width: "100%",
    marginTop: 3,
    padding: "7px 8px",
    border: "none",
    borderTop: "1px solid #292E36",
    background: "transparent",
    color: "#868F98",
    fontSize: 8,
    textAlign: "left",
    cursor: "pointer",
  },

  searchResultCount: {
    flexShrink: 0,
    color: "#68717B",
    fontSize: 8,
    whiteSpace: "nowrap",
  },

  searchHighlight: {
    padding: "1px 2px",
    borderRadius: 3,
    background: "#304A33",
    color: "#D8F2D7",
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

  detailAttachmentInfoButton: {
    flex: 1,
    minWidth: 0,
    border: "none",
    background: "transparent",
    padding: 0,
    textAlign: "left",
    cursor: "pointer",
  },

  detailAttachmentThumb: {
    width: 28,
    height: 28,
    borderRadius: 5,
    objectFit: "cover",
    flexShrink: 0,
  },

  detailAttachmentSection: {
    marginTop: 18,
    paddingTop: 12,
    borderTop: "1px solid #292E36",
  },

  detailAttachmentTitle: {
    marginBottom: 8,
    color: "#8D969F",
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  detailAttachmentList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },

  detailAttachmentRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 8px",
    border: "1px solid #292E36",
    borderRadius: 7,
    background: "#15181D",
  },

  detailAttachmentInfo: {
    minWidth: 0,
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 7,
    color: "#8B939C",
    fontSize: 9,
  },

  detailAttachmentName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#B9BEC5",
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
