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
  Star,
  Repeat,
  RefreshCw,
  Pause,
  Play,
  Upload,
  Download,
  Share2,
  Ban,
  Copy,
  CopyPlus,
  Paperclip,
  Keyboard,
  Files,
  Check,
  Link2,
  Bookmark,
  History,
  Clock3,
  Printer,
  SearchCheck,
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
  const [showFavorites, setShowFavorites] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState([]);
  const [hoveredNoteId, setHoveredNoteId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showBulkMoveMenu, setShowBulkMoveMenu] = useState(false);
  const [showBulkExportMenu, setShowBulkExportMenu] = useState(false);

  const [selectedTag, setSelectedTag] = useState("all");
  const [searchPinnedOnly, setSearchPinnedOnly] = useState(false);
  const [searchHasReminder, setSearchHasReminder] = useState(false);
  const [showSearchFilters, setShowSearchFilters] = useState(false);
  const [savedSearchViews, setSavedSearchViews] = useState([]);
  const [showSavedViewsMenu, setShowSavedViewsMenu] = useState(false);
  const [showSaveViewDialog, setShowSaveViewDialog] = useState(false);
  const [savedViewName, setSavedViewName] = useState("");
  const [savedViewActionId, setSavedViewActionId] = useState(null);
  const [savedViewEditingId, setSavedViewEditingId] = useState(null);
  const [showArchivedNotes, setShowArchivedNotes] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showRecentlyOpened, setShowRecentlyOpened] = useState(false);
  const [recentNoteIds, setRecentNoteIds] = useState([]);
  const [focusMode, setFocusMode] = useState(false);
  const [showNoteFind, setShowNoteFind] = useState(false);
  const [noteFindQuery, setNoteFindQuery] = useState("");
  const [showNoteToolsMenu, setShowNoteToolsMenu] = useState(false);
  const [showNoteInfo, setShowNoteInfo] = useState(false);

  const [sortMode, setSortMode] = useState("updated");

  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showNotesSettings, setShowNotesSettings] = useState(false);
  const [showAutoLockMenu, setShowAutoLockMenu] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(0);
  const [trashRetentionDays, setTrashRetentionDays] = useState(0);
  const [showTrashRetentionMenu, setShowTrashRetentionMenu] = useState(false);
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
  const [showNotesToolsMenu, setShowNotesToolsMenu] = useState(false);
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
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);

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

  const sessionDataKeyRef = useRef(null);
  const newNoteDraftTimerRef = useRef(null);

  const recoveredDataKeyRef = useRef(null);

  const contentInputRef = useRef(null);
  const editorLoadKeyRef = useRef("");
  const attachmentInputRef = useRef(null);

  const autosaveTimerRef = useRef(null);

  const [editorStatus, setEditorStatus] = useState("Saved");
  const [newNoteDraftAvailable, setNewNoteDraftAvailable] = useState(false);
  const [showNewNoteDraftPrompt, setShowNewNoteDraftPrompt] = useState(false);
  const [newNoteDraftSavedAt, setNewNoteDraftSavedAt] = useState("");

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
    if (phase !== "unlocked" || !showForm || editing) {
      return undefined;
    }

    window.clearTimeout(newNoteDraftTimerRef.current);

    newNoteDraftTimerRef.current = window.setTimeout(() => {
      autosaveNewNoteDraft();
    }, 900);

    return () => window.clearTimeout(newNoteDraftTimerRef.current);
  }, [
    phase,
    showForm,
    editing,
    form.title,
    form.content,
    formTags,
    formAttachments,
    formReminder,
    formRecurrence,
    formRecurrenceDay,
    formRecurrenceDays,
    formRecurrenceInterval,
    formRecurrenceUnit,
    formNotifyTelegram,
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

  // Close any transient menu/popover when the user starts interacting elsewhere.
  // Clicking a menu trigger is intentionally allowed: this runs on pointerdown,
  // then that trigger's click handler opens the newly requested menu.
  useEffect(() => {
    const closeTransientMenus = () => {
      setShowSavedViewsMenu(false);
      setShowSearchFilters(false);
      setShowSortMenu(false);
      setShowBulkMoveMenu(false);
      setShowBulkExportMenu(false);
      setShowNoteToolsMenu(false);
      setShowNotesToolsMenu(false);
      setShowExportMenu(false);
      setShowAutoLockMenu(false);
      setShowTrashRetentionMenu(false);
      setShowTemplateMenu(false);
      setShowNoteInfo(false);
      setShowNoteFind(false);
      setNoteFindQuery("");
    };

    const onPointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      // Keep the currently open surface interactive. Any click outside it
      // (including another toolbar button) closes the old surface first.
      if (target.closest('[data-floating-menu="true"]')) return;
      closeTransientMenus();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

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
        setShowTrashRetentionMenu(false);
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

      if (showForm && (key === "s" || key === "enter")) {
        event.preventDefault();
        saveNote();
        return;
      }

      if (typing) {
        return;
      }

      if (key === "n") {
        event.preventDefault();
        openNewWithDraftCheck();
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
  }, [phase, showForm, editing?.id]);

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

  function toggleNoteSelection(noteId) {
    setSelectedNoteIds((current) =>
      current.includes(noteId)
        ? current.filter((id) => id !== noteId)
        : [...current, noteId],
    );
  }

  function toggleSelectAllVisible() {
    const visibleIds = filteredNotes.map((note) => note.id);

    const allSelected =
      visibleIds.length > 0 &&
      visibleIds.every((id) => selectedNoteIds.includes(id));

    setSelectedNoteIds(allSelected ? [] : visibleIds);
  }

  async function applyBulkTrashAction(action) {
    const ids = selectedNoteIds.filter((id) =>
      notes.some((note) => note.id === id && note.trashed),
    );

    if (!ids.length) {
      return;
    }

    if (
      action === "permanentDelete" &&
      !window.confirm(
        `Permanently delete ${ids.length} ${
          ids.length === 1 ? "note" : "notes"
        }? This cannot be undone.`,
      )
    ) {
      return;
    }

    setBulkBusy(true);
    setError("");

    try {
      if (action === "restore") {
        const now = new Date().toISOString();

        const next = notes.map((note) =>
          ids.includes(note.id)
            ? {
                ...note,
                trashed: false,
                trashedAt: null,
                archived: false,
                updatedAt: now,
              }
            : note,
        );

        await persistNotes(next);

        setShowTrash(false);
        setShowArchivedNotes(false);
        setSelectedFolder("all");
        setSelectedTag("all");
        setQuery("");
        setSelectedId(
          next.find((note) => ids.includes(note.id))?.id ||
            next.find((note) => !note.trashed && !note.archived)?.id ||
            null,
        );
      }

      if (action === "permanentDelete") {
        const next = notes.filter((note) => !ids.includes(note.id));

        await persistNotes(next);

        setSelectedId(
          next.find((note) => !note.trashed && !note.archived)?.id || null,
        );
      }

      setSelectedNoteIds([]);
    } catch (error) {
      setError(error.message || "Could not update trash.");
    } finally {
      setBulkBusy(false);
    }
  }

  function exportSelectedNotes(format) {
    const selected = notes.filter((note) => selectedNoteIds.includes(note.id));

    if (!selected.length) {
      return;
    }

    const now = new Date().toISOString();

    const safeName = `pocket-notes-${new Date().toISOString().slice(0, 10)}`;

    if (format === "json") {
      downloadExportFile(
        `${safeName}.json`,
        JSON.stringify(
          {
            exportedAt: now,
            version: 1,
            notes: selected,
          },
          null,
          2,
        ),
        "application/json;charset=utf-8",
      );
    }

    if (format === "txt") {
      const text = selected
        .map((note) => `${note.title || "Untitled"}\n\n${note.content || ""}\n`)
        .join("\n------------------------------\n\n");

      downloadExportFile(`${safeName}.txt`, text, "text/plain;charset=utf-8");
    }

    if (format === "markdown") {
      const markdown = selected
        .map((note) => {
          const tags =
            Array.isArray(note.tags) && note.tags.length
              ? `\n\n**Tags:** ${note.tags.map((tag) => `#${tag}`).join(", ")}`
              : "";

          return `# ${note.title || "Untitled note"}\n\n${
            note.content || ""
          }${tags}\n`;
        })
        .join("\n---\n\n");

      downloadExportFile(
        `${safeName}.md`,
        markdown,
        "text/markdown;charset=utf-8",
      );
    }

    setShowBulkExportMenu(false);
    setSelectedNoteIds([]);
    setError("");
  }

  async function applyBulkAction(action) {
    const ids = selectedNoteIds;

    if (!ids.length) {
      return;
    }

    setBulkBusy(true);
    setError("");

    try {
      if (action === "delete") {
        for (const id of ids) {
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
            // Trash move continues even if Telegram cancellation fails.
          }
        }
      }

      const now = new Date().toISOString();

      const next = notes.map((note) => {
        if (!ids.includes(note.id)) {
          return note;
        }

        if (action === "favorite") {
          return {
            ...note,
            favorite: true,
            updatedAt: now,
          };
        }

        if (action === "unfavorite") {
          return {
            ...note,
            favorite: false,
            updatedAt: now,
          };
        }

        if (action === "pin") {
          return {
            ...note,
            pinned: true,
            updatedAt: now,
          };
        }

        if (action === "archive") {
          return {
            ...note,
            archived: true,
            updatedAt: now,
          };
        }

        if (action === "delete") {
          return {
            ...note,
            trashed: true,
            trashedAt: now,
            reminderAt: null,
            reminderPaused: false,
            notifyTelegram: false,
            updatedAt: now,
          };
        }

        if (action === "unpin") {
          return {
            ...note,
            pinned: false,
            updatedAt: now,
          };
        }

        if (action && action.startsWith("move:")) {
          const folderId = action.slice(5);

          return {
            ...note,
            folderId: folderId === "none" ? null : folderId,
            updatedAt: now,
          };
        }

        return note;
      });

      await persistNotes(next);

      setSelectedNoteIds([]);

      if (selectedId && ids.includes(selectedId)) {
        const replacement = next.find(
          (note) => !note.trashed && !note.archived && !ids.includes(note.id),
        );

        setSelectedId(replacement?.id || null);
      }
    } catch (error) {
      setError(error.message || "Could not apply bulk action.");
    } finally {
      setBulkBusy(false);
    }
  }

  function persistSavedSearchViews(next) {
    setSavedSearchViews(next);

    if (vault?.version === 2) {
      onVaultChange({
        ...vault,
        savedSearchViews: next,
      });
    }
  }

  function openRenameSavedSearchView(view) {
    setSavedViewEditingId(view?.id || null);
    setSavedViewName(view?.name || "");
    setShowSaveViewDialog(true);
    setShowSavedViewsMenu(false);
    setSavedViewActionId(null);
    setError("");
  }

  function updateSavedSearchView(viewId) {
    const current = savedSearchViews.find((view) => view.id === viewId);

    if (!current) {
      return;
    }

    const next = savedSearchViews.map((view) =>
      view.id === viewId
        ? {
            ...view,
            state: getCurrentSavedViewState(),
            updatedAt: new Date().toISOString(),
          }
        : view,
    );

    persistSavedSearchViews(next);
    setShowSavedViewsMenu(false);
    setSavedViewActionId(null);
    setError("");
  }

  function getCurrentSavedViewState() {
    return {
      query,
      selectedFolder,
      showFavorites,
      selectedTag,
      searchPinnedOnly,
      searchHasReminder,
      showArchivedNotes,
      showTrash,
      sortMode,
    };
  }

  function applySavedSearchView(view) {
    if (!view) {
      return;
    }

    const state = view.state || {};

    setQuery(String(state.query || ""));
    setSelectedFolder(state.selectedFolder || "all");
    setShowFavorites(Boolean(state.showFavorites));
    setSelectedTag(state.selectedTag || "all");
    setSearchPinnedOnly(Boolean(state.searchPinnedOnly));
    setSearchHasReminder(Boolean(state.searchHasReminder));
    setShowArchivedNotes(Boolean(state.showArchivedNotes));
    setShowTrash(Boolean(state.showTrash));
    setSortMode(state.sortMode || "updated");

    setSelectedNoteIds([]);
    setShowSearchFilters(false);
    setShowSortMenu(false);
    setShowSavedViewsMenu(false);
    setSearchActiveIndex(state.query ? 0 : -1);
    setError("");
  }

  function saveCurrentSearchView() {
    const name = savedViewName.trim();

    if (!name) {
      setError("Enter a name for this saved view.");
      return;
    }

    const state = getCurrentSavedViewState();

    const now = new Date().toISOString();

    const next = savedViewEditingId
      ? savedSearchViews.map((view) =>
          view.id === savedViewEditingId
            ? {
                ...view,
                name,
                state: view.state,
                updatedAt: now,
              }
            : view,
        )
      : [
          {
            id: makeId(),
            name,
            state,
            createdAt: now,
            updatedAt: now,
          },
          ...savedSearchViews,
        ].slice(0, 20);

    if (savedViewEditingId) {
      const edited = next.map((view) =>
        view.id === savedViewEditingId
          ? {
              ...view,
              name,
              updatedAt: now,
            }
          : view,
      );

      persistSavedSearchViews(edited);
    } else {
      persistSavedSearchViews(next);
    }

    setSavedViewName("");
    setSavedViewEditingId(null);
    setShowSaveViewDialog(false);
    setShowSavedViewsMenu(false);
    setError("");
  }

  function deleteSavedSearchView(viewId) {
    const next = savedSearchViews.filter((view) => view.id !== viewId);

    persistSavedSearchViews(next);

    setSavedViewActionId(null);
    setError("");
  }

  function getNoteShareStatus(noteId) {
    const links = Array.isArray(sharedLinks)
      ? sharedLinks.filter((link) => link.noteId === noteId)
      : [];

    if (!links.length) {
      return {
        key: "private",
        label: "Private",
      };
    }

    const active = links.some((link) => {
      if (link.revoked) {
        return false;
      }

      if (!link.expiresAt) {
        return true;
      }

      const expires = new Date(link.expiresAt).getTime();

      return !Number.isNaN(expires) && expires > Date.now();
    });

    return active
      ? {
          key: "shared",
          label: "Shared",
        }
      : {
          key: "revoked",
          label: "Revoked",
        };
  }

  function buildNoteActivityTimeline(note) {
    const events = [];

    if (note?.createdAt) {
      events.push({
        id: "created",
        label: "Created",
        detail: "Note created",
        at: note.createdAt,
      });
    }

    if (note?.updatedAt && note.updatedAt !== note.createdAt) {
      events.push({
        id: "updated",
        label: "Updated",
        detail: "Note last edited",
        at: note.updatedAt,
      });
    }

    if (Array.isArray(note?.history) && note.history.length > 0) {
      events.push({
        id: "history",
        label: "Version history",
        detail: `${note.history.length} saved ${
          note.history.length === 1 ? "version" : "versions"
        } available`,
        at: note.updatedAt || note.createdAt,
      });
    }

    if (Array.isArray(note?.attachments) && note.attachments.length > 0) {
      const latestAttachment = note.attachments[note.attachments.length - 1];

      events.push({
        id: "attachments",
        label: "Attachments",
        detail: `${note.attachments.length} ${
          note.attachments.length === 1 ? "attachment" : "attachments"
        } attached`,
        at: latestAttachment?.addedAt || note.updatedAt || note.createdAt,
      });
    }

    if (note?.reminderAt) {
      events.push({
        id: "reminder",
        label: "Reminder",
        detail: "Reminder scheduled",
        at: note.updatedAt || note.createdAt,
      });
    }

    if (note?.favorite) {
      events.push({
        id: "favorite",
        label: "Favorite",
        detail: "Currently in Favorites",
        at: note.updatedAt || note.createdAt,
      });
    }

    if (note?.pinned) {
      events.push({
        id: "pinned",
        label: "Pinned",
        detail: "Currently pinned",
        at: note.updatedAt || note.createdAt,
      });
    }

    if (note?.archived) {
      events.push({
        id: "archived",
        label: "Archived",
        detail: "Currently archived",
        at: note.updatedAt || note.createdAt,
      });
    }

    if (note?.trashed) {
      events.push({
        id: "trashed",
        label: "Trash",
        detail: "Currently in Trash",
        at: note.trashedAt || note.updatedAt || note.createdAt,
      });
    }

    return events
      .filter((event) => event.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }

  function getNoteStatistics(note) {
    const content = String(note?.content || "");

    const trimmed = content.trim();

    const words = trimmed ? trimmed.split(/\s+/).length : 0;

    const characters = content.length;

    const lines = content ? content.split("\n").length : 0;

    const readingSeconds =
      words > 0 ? Math.max(1, Math.ceil((words / 200) * 60)) : 0;

    return {
      words,
      characters,
      lines,
      readingSeconds,
    };
  }

  function formatNoteDateTime(value) {
    if (!value) {
      return "Unknown";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Unknown";
    }

    return date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
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

      if (showFavorites && !Boolean(note.favorite)) {
        return false;
      }

      if (showRecentlyOpened && !recentNoteIds.includes(note.id)) {
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

      if (sortMode === "titleAsc") {
        return String(a.title || "").localeCompare(
          String(b.title || ""),
          undefined,
          {
            sensitivity: "base",
            numeric: true,
          },
        );
      }

      if (sortMode === "titleDesc") {
        return String(b.title || "").localeCompare(
          String(a.title || ""),
          undefined,
          {
            sensitivity: "base",
            numeric: true,
          },
        );
      }

      if (sortMode === "created") {
        return (
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime()
        );
      }

      if (sortMode === "oldestUpdated") {
        return (
          new Date(a.updatedAt || a.createdAt || 0).getTime() -
          new Date(b.updatedAt || b.createdAt || 0).getTime()
        );
      }

      if (sortMode === "reminder") {
        const aTime = a.reminderAt
          ? new Date(a.reminderAt).getTime()
          : Infinity;
        const bTime = b.reminderAt
          ? new Date(b.reminderAt).getTime()
          : Infinity;

        if (aTime !== bTime) {
          return aTime - bTime;
        }

        return (
          new Date(b.updatedAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.createdAt || 0).getTime()
        );
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
    showFavorites,
    selectedTag,
    searchPinnedOnly,
    searchHasReminder,
    sortMode,
    showArchivedNotes,
    showTrash,
  ]);

  useEffect(() => {
    if (searchActiveIndex >= filteredNotes.length) {
      setSearchActiveIndex(filteredNotes.length ? 0 : -1);
    }
  }, [filteredNotes.length, searchActiveIndex]);

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

  async function autosaveNewNoteDraft() {
    if (
      phase !== "unlocked" ||
      editing ||
      !showForm ||
      !sessionPasswordRef.current
    ) {
      return;
    }

    const hasSomething = Boolean(
      form.title.trim() ||
      form.content.trim() ||
      formTags.length ||
      formAttachments.length ||
      formReminder ||
      formNotifyTelegram,
    );

    if (!hasSomething) {
      return;
    }

    try {
      const draft = {
        version: 1,
        title: form.title,
        content: form.content,
        tags: [...formTags],
        attachments: [...formAttachments],
        reminder: formReminder,
        recurrence: formRecurrence,
        recurrenceDay: formRecurrenceDay,
        recurrenceDays: [...formRecurrenceDays],
        recurrenceInterval: formRecurrenceInterval,
        recurrenceUnit: formRecurrenceUnit,
        notifyTelegram: Boolean(formNotifyTelegram),
        savedAt: new Date().toISOString(),
      };

      const storedEnvelope = await encryptLegacyNotes(
        [draft],
        sessionPasswordRef.current,
        vault?.salt,
      );

      localStorage.setItem(
        "pocket-new-note-draft-v1",
        JSON.stringify(storedEnvelope),
      );

      setNewNoteDraftSavedAt(draft.savedAt);
      setEditorStatus("Draft saved");
    } catch {
      setEditorStatus("Draft save failed");
    }
  }

  async function readNewNoteDraft() {
    if (!sessionPasswordRef.current) {
      return null;
    }

    try {
      const raw = localStorage.getItem("pocket-new-note-draft-v1");

      if (!raw) {
        return null;
      }

      const stored = JSON.parse(raw);

      const list = await decryptLegacyNotes(stored, sessionPasswordRef.current);

      return Array.isArray(list) ? list[0] || null : null;
    } catch {
      try {
        localStorage.removeItem("pocket-new-note-draft-v1");
      } catch {
        // ignore
      }

      return null;
    }
  }

  async function restoreNewNoteDraft() {
    const draft = await readNewNoteDraft();

    if (!draft) {
      return;
    }

    setEditing(null);
    setForm({
      title: draft.title || "",
      content: draft.content || "",
    });
    setFormTags(Array.isArray(draft.tags) ? draft.tags : []);
    setFormAttachments(
      Array.isArray(draft.attachments) ? draft.attachments : [],
    );
    setFormReminder(draft.reminder || "");
    setFormRecurrence(draft.recurrence || "none");
    setFormRecurrenceDay(draft.recurrenceDay || "");
    setFormRecurrenceDays(normalizeRecurrenceDays(draft.recurrenceDays));
    setFormRecurrenceInterval(draft.recurrenceInterval || 1);
    setFormRecurrenceUnit(draft.recurrenceUnit || "days");
    setFormNotifyTelegram(Boolean(draft.notifyTelegram));

    editorLoadKeyRef.current = "";
    setEditorHtml(markdownToEditorHtml(draft.content || ""));
    setEditorStatus("Draft restored");
    setShowNewNoteDraftPrompt(false);
    setNewNoteDraftAvailable(false);
    setError("");
  }

  function clearNewNoteDraft() {
    try {
      localStorage.removeItem("pocket-new-note-draft-v1");
    } catch {
      // ignore
    }

    setNewNoteDraftAvailable(false);
    setShowNewNoteDraftPrompt(false);
    setNewNoteDraftSavedAt("");
  }

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
      sessionDataKeyRef.current = dataKey;

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

      const savedRetention = Number(vault?.trashRetentionDays);

      const retentionDays =
        Number.isFinite(savedRetention) && savedRetention >= 0
          ? Math.floor(savedRetention)
          : 0;

      setTrashRetentionDays(retentionDays);

      let cleanedNotes = decrypted;

      if (retentionDays > 0) {
        const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

        cleanedNotes = decrypted.filter((note) => {
          if (!note.trashed) {
            return true;
          }

          const trashedAt = new Date(
            note.trashedAt || note.updatedAt || note.createdAt || 0,
          ).getTime();

          return !Number.isFinite(trashedAt) || trashedAt > cutoff;
        });

        if (cleanedNotes.length !== decrypted.length) {
          try {
            if (vault?.version === 2) {
              const dataKey = await unwrapDataKeyWithPassword(
                vault.passwordWrap,
                password,
              );

              const data = await encryptNotesWithDataKey(cleanedNotes, dataKey);

              onVaultChange({
                ...vault,
                data,
                trashRetentionDays: retentionDays,
              });
            } else {
              const envelope = await encryptLegacyNotes(
                cleanedNotes,
                password,
                vault?.salt,
              );

              onVaultChange(envelope);
            }
          } catch {
            // Keep the session usable even if cleanup persistence fails.
          }
        }
      }

      sessionPasswordRef.current = password;

      const draft = await readNewNoteDraft();

      setNewNoteDraftAvailable(Boolean(draft));
      setNewNoteDraftSavedAt(draft?.savedAt || "");

      setNotes(cleanedNotes);
      setCustomTemplates(
        Array.isArray(vault?.customTemplates) ? vault.customTemplates : [],
      );

      setSavedSearchViews(
        Array.isArray(vault?.savedSearchViews) ? vault.savedSearchViews : [],
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

  async function setTrashRetention(days) {
    const value = Math.max(0, Number(days) || 0);

    setTrashRetentionDays(value);
    setShowTrashRetentionMenu(false);
    setError("");

    if (vault?.version === 2) {
      onVaultChange({
        ...vault,
        trashRetentionDays: value,
      });
    }

    // Apply the new policy immediately to notes already in Trash.
    if (value > 0) {
      const cutoff = Date.now() - value * 24 * 60 * 60 * 1000;

      const expiredIds = notes
        .filter((note) => {
          if (!note.trashed) {
            return false;
          }

          const time = new Date(
            note.trashedAt || note.updatedAt || note.createdAt || 0,
          ).getTime();

          return Number.isFinite(time) && time <= cutoff;
        })
        .map((note) => note.id);

      if (expiredIds.length) {
        const next = notes.filter((note) => !expiredIds.includes(note.id));

        try {
          await persistNotes(next);

          setSelectedNoteIds((current) =>
            current.filter((id) => !expiredIds.includes(id)),
          );
        } catch {
          // Error state is handled by persistNotes.
        }
      }
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
  }, [showShareModal, showShareManager, , showRecentlyOpened, recentNoteIds]);

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

    if (!editing) {
      clearNewNoteDraft();
    }

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

  function getDuplicateNoteTitle(title) {
    const base =
      String(title || "Untitled note")
        .replace(/\s+copy(?:\s+\d+)?$/i, "")
        .trim() || "Untitled note";

    const existingTitles = new Set(
      notes.map((note) =>
        String(note.title || "")
          .trim()
          .toLowerCase(),
      ),
    );

    const first = `${base} copy`;

    if (!existingTitles.has(first.toLowerCase())) {
      return first;
    }

    let index = 2;

    while (existingTitles.has(`${base} copy ${index}`.toLowerCase())) {
      index += 1;
    }

    return `${base} copy ${index}`;
  }

  async function duplicateNoteById(note) {
    if (!note || note.trashed) {
      return;
    }

    const now = new Date().toISOString();

    const duplicate = {
      ...note,
      id: makeId(),
      title: getDuplicateNoteTitle(note.title),
      reminderAt: null,
      reminderPaused: false,
      notifyTelegram: false,
      recurrence: "none",
      recurrenceDay: null,
      recurrenceDays: [],
      recurrenceInterval: null,
      recurrenceUnit: null,
      history: [],
      activity: [],
      createdAt: now,
      updatedAt: now,
      color: note.color || "",
    };

    try {
      await persistNotes([duplicate, ...notes]);

      setSelectedId(duplicate.id);
      setError("");
    } catch (error) {
      setError(error.message || "Could not duplicate note.");
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
      title: getDuplicateNoteTitle(selected.title),
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
      color: selected.color || "",
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

  async function openNewWithDraftCheck() {
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
    setFormRecurrenceDays([]);
    setFormRecurrenceInterval(1);
    setFormRecurrenceUnit("days");
    setFormNotifyTelegram(false);
    setTagInput("");
    editorLoadKeyRef.current = "";
    setEditorHtml("");

    const draft = await readNewNoteDraft();

    const hasRecoverableDraft = Boolean(draft);

    setNewNoteDraftSavedAt(draft?.savedAt || "");
    setNewNoteDraftAvailable(hasRecoverableDraft);
    setShowNewNoteDraftPrompt(hasRecoverableDraft);

    setEditorStatus(hasRecoverableDraft ? "Draft available" : "New note");
    setShowForm(true);
  }

  function openNew() {
    openNewWithDraftCheck();
  }

  const NOTE_COLOR_OPTIONS = [
    { value: "", label: "Default" },
    { value: "#4FE36B", label: "Green" },
    { value: "#6BA8FF", label: "Blue" },
    { value: "#B38CFF", label: "Purple" },
    { value: "#E3A84F", label: "Orange" },
    { value: "#E3766B", label: "Red" },
  ];

  function renderNoteFindHighlight(value, query) {
    const source = String(value || "");
    const term = String(query || "").trim();

    if (!term) {
      return source;
    }

    const lower = source.toLowerCase();
    const needle = term.toLowerCase();
    const pieces = [];
    let cursor = 0;

    while (cursor < source.length) {
      const index = lower.indexOf(needle, cursor);

      if (index === -1) {
        pieces.push(source.slice(cursor));
        break;
      }

      if (index > cursor) {
        pieces.push(source.slice(cursor, index));
      }

      pieces.push(
        <mark key={`${index}-${term}`} style={styles.noteFindHighlight}>
          {source.slice(index, index + term.length)}
        </mark>,
      );

      cursor = index + term.length;
    }

    return pieces;
  }

  function getNoteFindCount(content, query) {
    const source = String(content || "");
    const term = String(query || "").trim();

    if (!term) {
      return 0;
    }

    let count = 0;
    let cursor = 0;
    const lower = source.toLowerCase();
    const needle = term.toLowerCase();

    while (cursor < source.length) {
      const index = lower.indexOf(needle, cursor);
      if (index === -1) break;
      count += 1;
      cursor = index + needle.length;
    }

    return count;
  }

  async function setSelectedNoteColor(color) {
    if (!selected) return;

    const now = new Date().toISOString();
    const nextNotes = notes.map((note) =>
      note.id === selected.id
        ? {
            ...note,
            color: color || "",
            updatedAt: now,
          }
        : note,
    );

    try {
      await persistNotes(nextNotes);
      setError("");
    } catch (error) {
      setError(error.message || "Could not update note color.");
    }
  }

  function printSelectedNote() {
    if (!selected) return;

    const printWindow = window.open("", "_blank", "noopener,noreferrer");

    if (!printWindow) {
      setError("Allow pop-ups to print this note.");
      return;
    }

    const title = selected.title || "Untitled note";
    const body = String(selected.content || "");

    printWindow.document.title = title;
    printWindow.document.body.innerHTML = "";

    const shell = printWindow.document.createElement("div");
    shell.style.fontFamily = "Arial, sans-serif";
    shell.style.maxWidth = "820px";
    shell.style.margin = "40px auto";
    shell.style.padding = "0 28px";

    const heading = printWindow.document.createElement("h1");
    heading.textContent = title;
    heading.style.fontSize = "28px";
    heading.style.marginBottom = "8px";

    const meta = printWindow.document.createElement("div");
    meta.textContent = selected.updatedAt
      ? `Updated ${formatNoteDateTime(selected.updatedAt)}`
      : "";
    meta.style.color = "#666";
    meta.style.fontSize = "12px";
    meta.style.marginBottom = "22px";

    const content = printWindow.document.createElement("pre");
    content.textContent = body;
    content.style.whiteSpace = "pre-wrap";
    content.style.wordBreak = "break-word";
    content.style.fontFamily = "Arial, sans-serif";
    content.style.fontSize = "14px";
    content.style.lineHeight = "1.7";

    shell.appendChild(heading);
    shell.appendChild(meta);
    shell.appendChild(content);
    printWindow.document.body.appendChild(shell);

    printWindow.focus();
    printWindow.print();
  }

  function rememberRecentlyOpened(noteId) {
    if (!noteId) {
      return;
    }

    setRecentNoteIds((current) =>
      [noteId, ...current.filter((id) => id !== noteId)].slice(0, 8),
    );
  }

  function openEdit(note) {
    rememberRecentlyOpened(note?.id);
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

  async function toggleFavorite(id) {
    const next = notes.map((note) =>
      note.id === id
        ? {
            ...note,
            favorite: !Boolean(note.favorite),
            updatedAt: new Date().toISOString(),
          }
        : note,
    );

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

  useEffect(() => {
    const openSettings = () => {
      setShowNotesSettings(true);
      setShowNoteToolsMenu(false);
      setShowNotesToolsMenu(false);
      setShowExportMenu(false);
      setShowAutoLockMenu(false);
      setShowTrashRetentionMenu(false);
      setShowTemplateMenu(false);
    };

    window.addEventListener("pocket:open-notes-settings", openSettings);
    return () =>
      window.removeEventListener("pocket:open-notes-settings", openSettings);
  }, []);
  if (phase === "setup") {
    return (
      <div className="notesResponsivePage" style={styles.page}>
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

          <div
            className="notesResponsiveViewSwitcher"
            style={styles.noteViewSwitcher}
          >
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
                setSelectedNoteIds([]);
                setShowBulkMoveMenu(false);
                setShowBulkExportMenu(false);
                setHoveredNoteId(null);
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
                setSelectedNoteIds([]);
                setShowBulkMoveMenu(false);
                setShowBulkExportMenu(false);
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

          <div className="notesResponsiveFolderBar" style={styles.folderBar}>
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
        <div className="notesResponsivePage" style={styles.page}>
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
    <>
      <style>{`
        .settingsItem span, .settingsItemControl span { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
        .settingsItem strong, .settingsItemControl strong { font-size: 12px; color: #ECEAE3; }
        .settingsItem small, .settingsItemControl small { font-size: 10px; color: #727883; line-height: 1.35; }
        @media (max-width: 640px) {
          .settingsGrid { grid-template-columns: 1fr !important; }
        }

        .notesResponsivePage {
          width: 100%;
          max-width: 100%;
          overflow-x: hidden;
        }

        .notesResponsiveHeader {
          align-items: flex-start !important;
          gap: 18px !important;
        }

        .notesResponsiveHeader > :first-child {
          min-width: 150px;
          flex: 1 1 220px;
        }

        .notesResponsiveHeaderActions {
          flex: 0 1 auto;
          min-width: 0;
          display: flex !important;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px !important;
        }

        .notesHeaderPrimaryGroup,
        .notesHeaderUtilityGroup {
          display: flex;
          align-items: center;
          gap: 7px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .notesHeaderUtilityGroup {
          align-items: stretch;
        }

        .notesHeaderActionButton {
          white-space: nowrap;
        }

        .notesHeaderActionButton > span:first-of-type {
          min-width: 0;
        }

        .notesHeaderNewButton {
          white-space: nowrap;
        }

        .notesToolsButtonActive {
          border-color: #3a5e43 !important;
          background: #1a241d !important;
          color: #9bd3a2 !important;
        }

        .notesToolsChevron {
          font-size: 11px;
          line-height: 1;
          color: #707985;
          transform: translateY(-1px);
        }

        .notesToolsMenuModern {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          z-index: 90;
          width: min(520px, calc(100vw - 28px));
          max-height: none;
          overflow: visible;
          padding: 12px;
          border: 1px solid #30363e;
          border-radius: 14px;
          background: #15191e;
          box-shadow: 0 24px 60px rgba(0,0,0,.52);
          box-sizing: border-box;
        }

        .notesToolsMenuHeading,
        .notesToolsSectionLabel {
          padding: 2px 4px 8px;
          color: #727b86;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 1px;
        }

        .notesToolsSectionLabel {
          padding-top: 14px;
          margin-top: 12px;
          border-top: 1px solid #292f37;
        }

        .notesToolsMenuGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
          align-items: start;
        }

        .notesToolsMenuButton {
          min-width: 0;
          min-height: 38px;
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 8px 10px;
          border: 1px solid #2b323b;
          border-radius: 9px;
          background: #1a1f25;
          color: #c3c8cf;
          font: inherit;
          font-size: 10px;
          text-align: left;
          cursor: pointer;
          box-sizing: border-box;
        }

        .notesToolsMenuButton:hover {
          border-color: #3a424c;
          background: #1f252c;
        }

        .notesToolsMenuButton span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .notesToolsMenuChevron {
          margin-left: auto;
          color: #7a838d;
          font-size: 14px;
        }

        .notesToolsValue {
          margin-left: auto;
          color: #7a838d;
          font-size: 9px;
          white-space: nowrap;
        }

        .notesToolsNestedFull,
        .notesToolsMenuNested {
          position: relative;
          min-width: 0;
          align-self: start;
          z-index: 1;
        }

        .notesToolsInlinePanel {
          position: absolute;
          top: calc(100% + 5px);
          left: 0;
          right: auto;
          width: min(300px, calc(100vw - 48px));
          z-index: 96;
          max-height: none;
          overflow: visible;
          padding: 5px;
          border: 1px solid #343b45;
          border-radius: 9px;
          background: #14181d;
          box-shadow: 0 18px 38px rgba(0,0,0,.46);
        }

        .notesToolsSubmenu {
          position: absolute;
          top: 0;
          right: calc(100% + 7px);
          width: 250px;
          padding: 6px;
          border: 1px solid #343b45;
          border-radius: 10px;
          background: #161a1f;
          box-shadow: 0 18px 38px rgba(0,0,0,.46);
          z-index: 94;
        }

        .notesToolsSubmenuTitle {
          padding: 6px 8px;
          color: #737c86;
          font-size: 8px;
          font-weight: 800;
          letter-spacing: .9px;
        }

        .notesToolsSubmenuItem,
        .notesToolsChoice {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 9px;
          padding: 9px;
          border: none;
          border-radius: 7px;
          background: transparent;
          color: #bcc3ca;
          font: inherit;
          font-size: 10px;
          text-align: left;
          cursor: pointer;
        }

        .notesToolsSubmenuItem:hover,
        .notesToolsChoice:hover {
          background: #20252b;
        }

        .notesToolsSubmenuItem span {
          color: #737c86;
          font-size: 8px;
          margin-left: auto;
          text-align: right;
        }

        .notesToolsChoice {
          min-height: 34px;
        }

        .notesToolsTemplateChoice {
          align-items: flex-start;
          flex-direction: column;
          gap: 2px;
        }

        .notesToolsTemplateChoice span {
          color: #69717b;
          font-size: 8px;
        }

        .notesResponsiveSearchRow {
          flex-wrap: wrap !important;
          min-height: 44px;
        }

        .notesResponsiveSearchRow > input {
          min-width: 120px;
        }

        .notesResponsiveSearchRow > .savedViewsWrap,
        .notesResponsiveSearchRow > .searchFilterWrap {
          flex: 0 0 auto;
        }

        .notesResponsiveViewSwitcher {
          align-items: center !important;
        }

        .notesResponsiveFolderBar,
        .notesResponsiveTagToolbar {
          min-width: 0;
        }

        .notesResponsiveFolderBar {
          overflow: hidden;
        }

        .notesResponsiveFolderBar > div {
          max-width: 100%;
        }

        .notesResponsiveBulkToolbar {
          flex-wrap: wrap !important;
        }

        .notesResponsiveContentGrid {
          min-width: 0;
        }

        .notesResponsiveListPanel,
        .notesResponsiveDetailPanel {
          min-width: 0;
          overflow: hidden;
        }

        .notesResponsiveDetailPanel {
          position: relative;
        }

        .notesResponsiveDetailHeader {
          min-width: 0;
        }

        @media (max-width: 1180px) {
          .notesResponsivePage {
            padding-left: 24px !important;
            padding-right: 24px !important;
          }

          .notesResponsiveHeader {
            flex-direction: column !important;
          }

          .notesResponsiveHeader > :first-child {
            width: 100%;
          }

          .notesResponsiveHeaderActions {
            width: 100%;
            align-items: stretch;
          }

          .notesHeaderPrimaryGroup,
          .notesHeaderUtilityGroup {
            justify-content: flex-start;
          }

          .notesResponsiveContentGrid {
            grid-template-columns: minmax(260px, .9fr) minmax(0, 1.3fr) !important;
          }
        }

        @media (max-width: 920px) {
          .notesResponsivePage {
            padding: 0 16px 24px !important;
          }

          .notesResponsiveContentGrid {
            grid-template-columns: 1fr !important;
          }

          .notesResponsiveDetailPanel {
            min-height: 420px !important;
          }

          .notesHeaderPrimaryGroup,
          .notesHeaderUtilityGroup {
            width: 100%;
            justify-content: flex-start;
          }

          .notesResponsiveSearchRow {
            gap: 6px !important;
          }

          .notesResponsiveSearchRow > input {
            flex: 1 1 220px !important;
          }

          .notesResponsiveSearchRow > button,
          .notesResponsiveSearchRow > div {
            flex: 0 0 auto;
          }

          .notesResponsiveViewSwitcher {
            overflow-x: auto;
            flex-wrap: nowrap !important;
            scrollbar-width: thin;
          }

          .notesResponsiveViewSwitcher .noteViewStatus {
            display: none;
          }

          .notesResponsiveTagToolbar {
            overflow-x: auto;
            scrollbar-width: thin;
          }

          .notesResponsiveTagToolbar > div {
            min-width: max-content;
          }

          .notesToolsMenuModern {
            left: 0;
            right: auto;
          }

          .notesToolsSubmenu {
            position: static;
            width: auto;
            margin-top: 4px;
          }
        }

        /* Unified floating-menu behavior */
        [data-floating-menu="true"] {
          isolation: isolate;
        }

        @media (max-width: 920px) {
          .notesResponsivePage {
            overflow-x: clip;
          }

          .notesResponsiveHeaderActions {
            gap: 8px !important;
          }
        }

        @media (max-width: 640px) {
          .notesResponsivePage {
            padding: 0 10px 18px !important;
          }

          .notesResponsiveHeader {
            margin-bottom: 12px !important;
          }

          .titleSmall {
            font-size: 24px !important;
          }

          .currentNotesView {
            max-width: 100%;
          }

          .currentNotesViewDetail {
            display: none;
          }

          .notesHeaderPrimaryGroup,
          .notesHeaderUtilityGroup {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            width: 100%;
          }

          .notesHeaderActionButton,
          .notesHeaderNewButton {
            width: 100%;
            justify-content: center;
          }

          .notesHeaderNewButton {
            min-height: 34px;
          }

          .notesToolsWrap {
            width: 100%;
          }

          .notesToolsWrap > .notesHeaderActionButton {
            width: 100%;
            justify-content: center;
          }

          .notesToolsMenuModern {
            position: fixed;
            top: 14px;
            bottom: auto;
            left: 10px;
            right: 10px;
            width: auto;
            max-width: none;
            max-height: none;
            overflow: visible;
            padding: 10px;
            border-radius: 14px;
            z-index: 300;
            box-shadow: 0 24px 70px rgba(0,0,0,.62);
          }

          .notesToolsMenuGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 6px;
          }

          .notesToolsMenuHeading,
          .notesToolsSectionLabel {
            padding-left: 2px;
            padding-right: 2px;
          }

          .notesToolsSectionLabel {
            padding-top: 9px;
            margin-top: 9px;
          }

          .notesToolsMenuButton {
            min-height: 42px;
            padding: 8px 9px;
            font-size: 10px;
          }

          .notesToolsMenuButton span {
            white-space: normal;
            line-height: 1.15;
          }

          .notesToolsInlinePanel,
          .notesToolsSubmenu {
            position: fixed;
            left: 12px;
            right: 12px;
            top: 50%;
            bottom: auto;
            width: auto;
            max-width: none;
            max-height: none;
            margin: 0;
            transform: translateY(-50%);
            z-index: 360;
            padding: 8px;
            border-radius: 12px;
            box-shadow: 0 28px 80px rgba(0,0,0,.66);
          }

          .notesToolsSubmenu {
            left: 12px;
            right: 12px;
            top: 50%;
          }

          .notesToolsChoice,
          .notesToolsSubmenuItem {
            min-height: 42px;
            padding: 9px 10px;
            font-size: 10px;
          }

          .notesToolsTemplateChoice {
            gap: 3px;
          }

          .notesResponsiveContentGrid {
            gap: 10px !important;
          }

          .notesResponsiveListPanel,
          .notesResponsiveDetailPanel {
            width: 100%;
          }

          .notesResponsiveDetailPanel {
            overflow: visible !important;
          }

          .detailToolbarArea,
          .detailPrimaryActions {
            min-width: 0;
          }

          .notesResponsiveSearchRow {
            padding: 8px !important;
          }

          .notesResponsiveSearchRow > input {
            flex-basis: 100% !important;
            order: 1;
          }

          .notesResponsiveSearchRow > svg {
            position: absolute;
            margin-left: 2px;
          }

          .notesResponsiveSearchRow > input {
            padding-left: 24px !important;
          }
          .detailPrimaryActions {
            overflow-x: auto;
            flex-wrap: nowrap !important;
            scrollbar-width: none;
            padding-bottom: 2px;
          }

          .detailPrimaryActions::-webkit-scrollbar {
            display: none;
          }

          .moreToolbarButton,
          .primaryToolbarButton,
          .iconButtonCompact {
            flex: 0 0 auto;
          }

          .noteToolsMenu {
            position: fixed !important;
            top: auto !important;
            left: 10px !important;
            right: 10px !important;
            bottom: calc(env(safe-area-inset-bottom) + 10px) !important;
            width: auto !important;
            max-width: none !important;
            max-height: none !important;
            overflow: visible !important;
            z-index: 340 !important;
            border-radius: 14px !important;
          }

          .noteFindBar {
            flex-wrap: wrap;
          }

          .noteFindInput {
            min-width: 0 !important;
            flex: 1 1 140px !important;
          }

          .savedViewsMenu,
          .searchFilterMenu,
          .notesSortMenu,
          .bulkMoveMenu,
          .bulkExportMenu {
            position: fixed !important;
            left: 12px !important;
            right: 12px !important;
            top: 50% !important;
            bottom: auto !important;
            width: auto !important;
            max-width: none !important;
            transform: translateY(-50%);
            z-index: 320 !important;
          }

          .notesResponsiveSearchRow > button,
          .notesResponsiveSearchRow > div {
            flex: 1 1 calc(33.333% - 6px);
            justify-content: center;
          }

          .notesResponsiveViewSwitcher {
            padding: 4px !important;
          }

          .notesResponsiveViewSwitcher .noteViewTab {
            flex: 1 0 auto;
            justify-content: center;
          }

          .notesResponsiveFolderBar .folderScroll {
            padding-bottom: 5px !important;
          }

          .notesResponsiveTagToolbar {
            padding-bottom: 3px;
          }

          .notesResponsiveBulkToolbar {
            align-items: stretch !important;
          }

          .notesResponsiveBulkToolbar > div {
            width: 100%;
          }

          .notesResponsiveBulkToolbar button {
            min-height: 32px;
          }

          .notesResponsiveDetailPanel {
            padding: 14px !important;
            border-radius: 10px !important;
          }

          .notesResponsiveDetailHeader {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
          }

          .notesResponsiveDetailHeader .detailToolbarArea {
            width: 100%;
          }

          .notesResponsiveDetailHeader .detailPrimaryActions {
            width: 100%;
            justify-content: flex-start;
            overflow-x: auto;
          }

          .notesResponsiveDetailHeader .detailPrimaryActions button {
            flex: 0 0 auto;
          }

          .noteInfoBar {
            flex-direction: column !important;
            align-items: stretch !important;
          }

          .noteInfoRight {
            width: 100% !important;
            justify-content: flex-start !important;
            flex-wrap: wrap;
          }

          .noteActivityListWide {
            grid-template-columns: 1fr !important;
          }

          .noteFindBar {
            flex-wrap: wrap;
          }

          .detailAttachmentRow {
            min-width: 0;
          }
        }
      `}</style>
      <div className="notesResponsivePage" style={styles.page}>
        <div className="notesResponsiveHeader" style={styles.headerRow}>
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

          <div
            className="notesResponsiveHeaderActions"
            style={styles.headerActions}
          >
            <div className="notesHeaderPrimaryGroup">
              <button
                type="button"
                className="notesHeaderActionButton"
                style={styles.secondaryButton}
                onClick={() => setShowReminderCenter(true)}
              >
                <CalendarDays size={14} />
                <span>Reminders</span>
                {activeReminderCount > 0 && (
                  <span style={styles.reminderCountPill}>
                    {activeReminderCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                className="notesHeaderActionButton"
                style={{
                  ...styles.secondaryButton,
                  ...(showArchivedNotes ? styles.archiveButtonActive : {}),
                }}
                onClick={() => {
                  setShowArchivedNotes((value) => !value);
                  setSelectedFolder("all");
                  setSelectedTag("all");
                  setSelectedId(null);
                  setSelectedNoteIds([]);
                }}
                title="Show archived notes"
              >
                <Archive size={14} />
                <span>{showArchivedNotes ? "Archived" : "Archive"}</span>
              </button>

              <button
                type="button"
                className="notesHeaderActionButton"
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
                  setSelectedNoteIds([]);
                }}
                title="Show trashed notes"
              >
                <Trash2 size={14} />
                <span>Trash</span>
              </button>

              <button
                type="button"
                className="notesHeaderActionButton"
                style={styles.secondaryButton}
                onClick={() => {
                  setShowNotesToolsMenu(false);
                  setShowReminderHistory(true);
                  loadReminderHistory();
                }}
                title="Reminder history"
              >
                <History size={14} />
                <span>History</span>
              </button>
            </div>

            <div className="notesHeaderUtilityGroup">
              <div className="notesToolsWrap" style={{ position: "relative" }}>
                <button
                  type="button"
                  className="notesHeaderActionButton"
                  style={{
                    ...styles.secondaryButton,
                    ...(showNotesToolsMenu
                      ? styles.notesToolsButtonActive
                      : {}),
                  }}
                  onClick={() => {
                    setShowNotesToolsMenu((value) => {
                      const next = !value;
                      if (next) {
                        setShowExportMenu(false);
                        setShowAutoLockMenu(false);
                        setShowTrashRetentionMenu(false);
                        setShowTemplateMenu(false);
                      }
                      return next;
                    });
                  }}
                  aria-haspopup="menu"
                  aria-expanded={showNotesToolsMenu}
                  title="Notes tools and settings"
                >
                  <SlidersHorizontal size={14} />
                  <span>Tools</span>
                  <span className="notesToolsChevron" aria-hidden="true">
                    ⌄
                  </span>
                </button>

                {showNotesToolsMenu && (
                  <div
                    className="notesToolsMenuModern"
                    role="menu"
                    data-floating-menu="true"
                  >
                    <div className="notesToolsMenuHeading">NOTES TOOLS</div>

                    <div className="notesToolsMenuGrid">
                      {!recoveryEnabled && (
                        <button
                          type="button"
                          className="notesToolsMenuButton"
                          onClick={() => {
                            setShowNotesToolsMenu(false);
                            setShowRecoverySetup(true);
                          }}
                        >
                          <Fingerprint size={14} />
                          <span>Passkey recovery</span>
                        </button>
                      )}

                      <label
                        className="notesToolsMenuButton"
                        title="Import notes"
                      >
                        <Download size={14} />
                        <span>Import</span>
                        <input
                          type="file"
                          accept=".json,.md,.markdown,.csv"
                          style={{ display: "none" }}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (!file) return;
                            setShowNotesToolsMenu(false);
                            try {
                              await parseImportedFile(file);
                            } catch (error) {
                              setError(
                                error.message || "Could not read import file.",
                              );
                            }
                          }}
                        />
                      </label>

                      <div className="notesToolsMenuNested">
                        <button
                          type="button"
                          className="notesToolsMenuButton"
                          onClick={() => {
                            setShowAutoLockMenu(false);
                            setShowTrashRetentionMenu(false);
                            setShowTemplateMenu(false);
                            setShowExportMenu((value) => !value);
                          }}
                        >
                          <Upload size={14} />
                          <span>Export</span>
                          <span className="notesToolsMenuChevron">›</span>
                        </button>

                        {showExportMenu && (
                          <div
                            className="notesToolsSubmenu"
                            data-floating-menu="true"
                          >
                            <div className="notesToolsSubmenuTitle">
                              EXPORT NOTES
                            </div>
                            <button
                              type="button"
                              className="notesToolsSubmenuItem"
                              onClick={() => {
                                setShowExportMenu(false);
                                setShowNotesToolsMenu(false);
                                exportNotes("json");
                              }}
                            >
                              <strong>JSON</strong>
                              <span>Backup with all note data</span>
                            </button>
                            <button
                              type="button"
                              className="notesToolsSubmenuItem"
                              onClick={() => {
                                setShowExportMenu(false);
                                setShowNotesToolsMenu(false);
                                exportNotes("markdown");
                              }}
                            >
                              <strong>Markdown</strong>
                              <span>Readable notes document</span>
                            </button>
                            <button
                              type="button"
                              className="notesToolsSubmenuItem"
                              onClick={() => {
                                setShowExportMenu(false);
                                setShowNotesToolsMenu(false);
                                exportNotes("csv");
                              }}
                            >
                              <strong>CSV</strong>
                              <span>Spreadsheet-friendly</span>
                            </button>
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        className="notesToolsMenuButton"
                        onClick={() => {
                          setShowNotesToolsMenu(false);
                          telegramConnected
                            ? setShowTelegramConnect(true)
                            : connectTelegram();
                        }}
                      >
                        <Bell size={14} />
                        <span>
                          {telegramConnected ? "Telegram" : "Connect Telegram"}
                        </span>
                      </button>

                      <button
                        type="button"
                        className="notesToolsMenuButton"
                        onClick={() => {
                          setShowNotesToolsMenu(false);
                          enableNotifications();
                        }}
                      >
                        <Bell size={14} />
                        <span>
                          {notificationsEnabled
                            ? "Notifications on"
                            : "Enable notifications"}
                        </span>
                      </button>

                      <button
                        type="button"
                        className="notesToolsMenuButton"
                        onClick={() => {
                          setShowNotesToolsMenu(false);
                          openChangePassword();
                        }}
                      >
                        <ShieldCheck size={14} />
                        <span>Change password</span>
                      </button>

                      <button
                        type="button"
                        className="notesToolsMenuButton"
                        onClick={() => {
                          setShowNotesToolsMenu(false);
                          setShowShortcuts(true);
                        }}
                      >
                        <Keyboard size={14} />
                        <span>Shortcuts</span>
                      </button>
                    </div>

                    <div className="notesToolsSectionLabel">
                      SECURITY & RETENTION
                    </div>

                    <div className="notesToolsMenuGrid">
                      <div className="notesToolsNestedFull">
                        <button
                          type="button"
                          className="notesToolsMenuButton"
                          onClick={() => {
                            setShowTrashRetentionMenu(false);
                            setShowTemplateMenu(false);
                            setShowAutoLockMenu((value) => !value);
                          }}
                        >
                          <Lock size={14} />
                          <span>Auto-lock</span>
                          <span className="notesToolsValue">
                            {autoLockMinutes === 0
                              ? "Off"
                              : `${autoLockMinutes}m`}
                          </span>
                        </button>
                        {showAutoLockMenu && (
                          <div
                            className="notesToolsInlinePanel"
                            data-floating-menu="true"
                          >
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
                                className="notesToolsChoice"
                                onClick={() => {
                                  setAutoLockDuration(value);
                                  setShowAutoLockMenu(false);
                                }}
                              >
                                {label}
                                {autoLockMinutes === value && (
                                  <Check size={13} />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="notesToolsNestedFull">
                        <button
                          type="button"
                          className="notesToolsMenuButton"
                          onClick={() => {
                            setShowAutoLockMenu(false);
                            setShowTemplateMenu(false);
                            setShowTrashRetentionMenu((value) => !value);
                          }}
                        >
                          <Trash2 size={14} />
                          <span>Trash retention</span>
                          <span className="notesToolsValue">
                            {trashRetentionDays === 0
                              ? "Never"
                              : `${trashRetentionDays}d`}
                          </span>
                        </button>
                        {showTrashRetentionMenu && (
                          <div className="notesToolsInlinePanel">
                            {[
                              [0, "Never"],
                              [7, "7 days"],
                              [30, "30 days"],
                              [90, "90 days"],
                            ].map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                className="notesToolsChoice"
                                onClick={() => {
                                  setTrashRetention(value);
                                  setShowTrashRetentionMenu(false);
                                }}
                              >
                                {label}
                                {trashRetentionDays === value && (
                                  <Check size={13} />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        className="notesToolsMenuButton"
                        onClick={() => {
                          setShowNotesToolsMenu(false);
                          lockVault();
                        }}
                      >
                        <Lock size={14} />
                        <span>Lock vault</span>
                      </button>

                      <div className="notesToolsNestedFull">
                        <button
                          type="button"
                          className="notesToolsMenuButton"
                          onClick={() => {
                            setShowAutoLockMenu(false);
                            setShowTrashRetentionMenu(false);
                            setShowTemplateMenu((value) => !value);
                          }}
                        >
                          <Repeat size={14} />
                          <span>Templates</span>
                          <span className="notesToolsMenuChevron">›</span>
                        </button>
                        {showTemplateMenu && (
                          <div className="notesToolsInlinePanel">
                            {NOTE_TEMPLATES.map((template) => (
                              <button
                                key={template.id}
                                type="button"
                                className="notesToolsChoice notesToolsTemplateChoice"
                                onClick={() => {
                                  setShowTemplateMenu(false);
                                  setShowNotesToolsMenu(false);
                                  applyNoteTemplate(template.id);
                                }}
                              >
                                <strong>{template.name}</strong>
                                <span>{template.description}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="notesHeaderNewButton"
                style={styles.primaryCompactButton}
                onClick={openNewWithDraftCheck}
              >
                <Plus size={15} />
                <span>New note</span>
              </button>
            </div>
          </div>
        </div>

        <div className="notesResponsiveSearchRow" style={styles.searchRow}>
          <Search size={15} color="#626873" />

          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchActiveIndex(e.target.value.trim() ? 0 : -1);
            }}
            onKeyDown={(event) => {
              if (!query.trim()) {
                return;
              }

              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();

                if (!filteredNotes.length) {
                  setSearchActiveIndex(-1);
                  return;
                }

                setSearchActiveIndex((current) => {
                  const start = current < 0 ? 0 : current;

                  return event.key === "ArrowDown"
                    ? (start + 1) % filteredNotes.length
                    : (start - 1 + filteredNotes.length) % filteredNotes.length;
                });

                return;
              }

              if (event.key === "Enter" && filteredNotes.length) {
                event.preventDefault();

                const index = searchActiveIndex >= 0 ? searchActiveIndex : 0;

                const note = filteredNotes[index];

                if (note) {
                  setSelectedId(note.id);
                  setShowNoteExportMenu(false);
                  setShowSearchFilters(false);
                  setShowSortMenu(false);
                  setSearchActiveIndex(index);
                }
              }

              if (event.key === "Escape") {
                setQuery("");
                setSearchActiveIndex(-1);
              }
            }}
            placeholder="Search notes…"
            style={styles.searchInput}
          />

          {query.trim() && (
            <span style={styles.searchResultCount}>
              {filteredNotes.length}{" "}
              {filteredNotes.length === 1 ? "result" : "results"}
            </span>
          )}

          <button
            type="button"
            style={{
              ...styles.searchFilterButton,
              ...(showRecentlyOpened ? styles.searchFilterButtonActive : {}),
            }}
            onClick={() => {
              setShowRecentlyOpened((value) => !value);
              setShowTrash(false);
              setShowArchivedNotes(false);
              setShowFavorites(false);
            }}
            title="Recently opened notes"
          >
            <Clock3 size={13} />
            Recent
            {recentNoteIds.length > 0 && (
              <span style={styles.searchFilterBadge}>
                {Math.min(recentNoteIds.length, 8)}
              </span>
            )}
          </button>

          <div style={styles.savedViewsWrap}>
            <button
              type="button"
              style={{
                ...styles.searchFilterButton,
                ...(showSavedViewsMenu ? styles.searchFilterButtonActive : {}),
              }}
              onClick={() => setShowSavedViewsMenu((value) => !value)}
              title="Saved search views"
              aria-haspopup="menu"
              aria-expanded={showSavedViewsMenu}
            >
              <Bookmark size={13} />
              Saved
              {savedSearchViews.length > 0 && (
                <span style={styles.searchFilterBadge}>
                  {savedSearchViews.length}
                </span>
              )}
            </button>

            {showSavedViewsMenu && (
              <div style={styles.savedViewsMenu} data-floating-menu="true">
                <div style={styles.savedViewsTitle}>SAVED VIEWS</div>

                <div style={styles.savedViewsHint}>
                  Click a view to apply it. Use the icons to update, rename, or
                  delete.
                </div>

                {savedSearchViews.length === 0 ? (
                  <div style={styles.savedViewsEmpty}>No saved views yet.</div>
                ) : (
                  savedSearchViews.map((view) => (
                    <div key={view.id} style={styles.savedViewRow}>
                      <button
                        type="button"
                        style={styles.savedViewButton}
                        onClick={() => applySavedSearchView(view)}
                        title={`Apply ${view.name}`}
                      >
                        <Bookmark size={12} />
                        <span style={styles.savedViewButtonLabel}>
                          {view.name}
                        </span>
                      </button>

                      <div style={styles.savedViewActionsInline}>
                        <button
                          type="button"
                          style={styles.savedViewIconAction}
                          onClick={() => updateSavedSearchView(view.id)}
                          title="Update to current view"
                          aria-label={`Update ${view.name}`}
                        >
                          <RefreshCw size={11} />
                        </button>

                        <button
                          type="button"
                          style={styles.savedViewIconAction}
                          onClick={() => openRenameSavedSearchView(view)}
                          title="Rename saved view"
                          aria-label={`Rename ${view.name}`}
                        >
                          <Pencil size={11} />
                        </button>

                        <button
                          type="button"
                          style={styles.savedViewIconActionDanger}
                          onClick={() => {
                            deleteSavedSearchView(view.id);
                            setSavedViewActionId(null);
                          }}
                          title="Delete saved view"
                          aria-label={`Delete ${view.name}`}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  ))
                )}

                <button
                  type="button"
                  style={styles.savedViewSaveButton}
                  onClick={() => {
                    setSavedViewName("");
                    setShowSaveViewDialog(true);
                    setShowSavedViewsMenu(false);
                  }}
                >
                  <Plus size={12} />
                  {savedViewEditingId
                    ? "Rename saved view"
                    : "Save current view"}
                </button>
              </div>
            )}
          </div>

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
              <div style={styles.searchFilterMenu} data-floating-menu="true">
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

        <div
          className="notesResponsiveTagToolbar"
          style={styles.tagFilterToolbar}
        >
          <div style={styles.tagFilterScroll}>
            <span style={styles.filterLabel}>Tags</span>

            <button
              type="button"
              style={{
                ...styles.folderChip,
                ...(showFavorites ? styles.folderChipActive : {}),
              }}
              onClick={() => {
                setShowFavorites((value) => !value);
                setShowTrash(false);
                setShowArchivedNotes(false);
                setSelectedFolder("all");
              }}
              title="Show favorite notes"
            >
              <Star size={11} fill={showFavorites ? "currentColor" : "none"} />
              Favorites
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

            <button
              type="button"
              style={styles.tagManageButton}
              onClick={() => setShowTagManager(true)}
              title="Manage tags"
            >
              Manage tags
            </button>

            <div style={styles.notesSortWrap}>
              <button
                type="button"
                style={styles.notesSortButton}
                onClick={() => setShowSortMenu((value) => !value)}
                title="Sort notes"
                aria-haspopup="menu"
                aria-expanded={showSortMenu}
              >
                <SlidersHorizontal size={13} />
                Sort
                <span style={styles.notesSortCurrent}>
                  {
                    {
                      updated: "Recent",
                      created: "Created",
                      oldestUpdated: "Oldest",
                      titleAsc: "A–Z",
                      titleDesc: "Z–A",
                      reminder: "Reminders",
                    }[sortMode]
                  }
                </span>
              </button>

              {showSortMenu && (
                <div style={styles.notesSortMenu} data-floating-menu="true">
                  {[
                    ["updated", "Recently updated"],
                    ["created", "Recently created"],
                    ["oldestUpdated", "Oldest updated"],
                    ["titleAsc", "Title A → Z"],
                    ["titleDesc", "Title Z → A"],
                    ["reminder", "Reminders soonest"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      style={{
                        ...styles.notesSortItem,
                        ...(sortMode === value
                          ? styles.notesSortItemActive
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
        </div>

        {error && <div style={styles.errorBanner}>{error}</div>}

        {noteCopied && (
          <div style={styles.copiedToast} role="status">
            <Check size={14} />
            Copied to clipboard
          </div>
        )}

        {query.trim() && filteredNotes.length > 0 && (
          <div style={styles.searchKeyboardHint}>
            ↑ ↓ to navigate · Enter to open
          </div>
        )}

        {selectedNoteIds.length > 0 && (
          <div
            className="notesResponsiveBulkToolbar"
            style={styles.bulkToolbar}
          >
            <div style={styles.bulkToolbarLeft}>
              <button
                type="button"
                style={styles.bulkSelectButton}
                onClick={toggleSelectAllVisible}
              >
                {filteredNotes.length > 0 &&
                filteredNotes.every((note) => selectedNoteIds.includes(note.id))
                  ? "Clear visible"
                  : "Select visible"}
              </button>

              <strong>{selectedNoteIds.length} selected</strong>
            </div>

            <div style={styles.bulkToolbarActions}>
              {showTrash ? (
                <>
                  <button
                    type="button"
                    style={styles.bulkActionButton}
                    disabled={bulkBusy}
                    onClick={() => applyBulkTrashAction("restore")}
                  >
                    <Archive size={12} />
                    Restore
                  </button>

                  <button
                    type="button"
                    style={{
                      ...styles.bulkActionButton,
                      ...styles.bulkPermanentDeleteButton,
                    }}
                    disabled={bulkBusy}
                    onClick={() => applyBulkTrashAction("permanentDelete")}
                  >
                    <Trash2 size={12} />
                    Delete permanently
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    style={styles.bulkActionButton}
                    disabled={bulkBusy}
                    onClick={() => {
                      const allFavorite =
                        selectedNoteIds.length > 0 &&
                        selectedNoteIds.every(
                          (id) =>
                            notes.find((note) => note.id === id)?.favorite,
                        );

                      applyBulkAction(allFavorite ? "unfavorite" : "favorite");
                    }}
                    title="Favorite selected notes"
                  >
                    <Star
                      size={12}
                      fill={
                        selectedNoteIds.length > 0 &&
                        selectedNoteIds.every(
                          (id) =>
                            notes.find((note) => note.id === id)?.favorite,
                        )
                          ? "currentColor"
                          : "none"
                      }
                    />
                    {selectedNoteIds.length > 0 &&
                    selectedNoteIds.every(
                      (id) => notes.find((note) => note.id === id)?.favorite,
                    )
                      ? "Unfavorite"
                      : "Favorite"}
                  </button>

                  <button
                    type="button"
                    style={styles.bulkActionButton}
                    disabled={bulkBusy}
                    onClick={() => {
                      const allPinned =
                        selectedNoteIds.length > 0 &&
                        selectedNoteIds.every(
                          (id) => notes.find((note) => note.id === id)?.pinned,
                        );

                      applyBulkAction(allPinned ? "unpin" : "pin");
                    }}
                    title="Pin or unpin selected notes"
                  >
                    <Pin size={12} />
                    {selectedNoteIds.length > 0 &&
                    selectedNoteIds.every(
                      (id) => notes.find((note) => note.id === id)?.pinned,
                    )
                      ? "Unpin"
                      : "Pin"}
                  </button>

                  <button
                    type="button"
                    style={styles.bulkActionButton}
                    disabled={bulkBusy}
                    onClick={() => applyBulkAction("archive")}
                  >
                    <Archive size={12} />
                    Archive
                  </button>

                  <div style={styles.bulkMoveWrap}>
                    <button
                      type="button"
                      style={styles.bulkActionButton}
                      disabled={bulkBusy}
                      onClick={() => setShowBulkMoveMenu((value) => !value)}
                      title="Move selected notes"
                    >
                      <Folder size={12} />
                      Move to
                    </button>

                    {showBulkMoveMenu && (
                      <div
                        style={styles.bulkMoveMenu}
                        data-floating-menu="true"
                      >
                        <div style={styles.bulkMoveMenuTitle}>
                          MOVE TO FOLDER
                        </div>

                        {folders.map((folder) => (
                          <button
                            key={folder.id}
                            type="button"
                            style={styles.bulkMoveItem}
                            disabled={bulkBusy}
                            onClick={async () => {
                              setShowBulkMoveMenu(false);
                              await applyBulkAction(`move:${folder.id}`);
                            }}
                          >
                            <Folder size={12} />
                            {folder.name}
                          </button>
                        ))}

                        <button
                          type="button"
                          style={styles.bulkMoveItem}
                          disabled={bulkBusy}
                          onClick={async () => {
                            setShowBulkMoveMenu(false);
                            await applyBulkAction("move:none");
                          }}
                        >
                          <Folder size={12} />
                          No folder
                        </button>
                      </div>
                    )}
                  </div>

                  <div style={styles.bulkExportWrap}>
                    <button
                      type="button"
                      style={styles.bulkActionButton}
                      disabled={bulkBusy}
                      onClick={() => setShowBulkExportMenu((value) => !value)}
                      title="Export selected notes"
                      aria-haspopup="menu"
                      aria-expanded={showBulkExportMenu}
                    >
                      <Upload size={12} />
                      Export
                    </button>

                    {showBulkExportMenu && (
                      <div
                        style={styles.bulkExportMenu}
                        data-floating-menu="true"
                      >
                        <div style={styles.bulkExportMenuTitle}>
                          EXPORT SELECTED
                        </div>

                        <button
                          type="button"
                          style={styles.bulkExportItem}
                          disabled={bulkBusy}
                          onClick={() => exportSelectedNotes("markdown")}
                        >
                          Markdown (.md)
                        </button>

                        <button
                          type="button"
                          style={styles.bulkExportItem}
                          disabled={bulkBusy}
                          onClick={() => exportSelectedNotes("txt")}
                        >
                          Plain text (.txt)
                        </button>

                        <button
                          type="button"
                          style={styles.bulkExportItem}
                          disabled={bulkBusy}
                          onClick={() => exportSelectedNotes("json")}
                        >
                          JSON (.json)
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    style={styles.bulkActionButton}
                    disabled={bulkBusy}
                    onClick={() => applyBulkAction("delete")}
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                </>
              )}

              <button
                type="button"
                style={styles.bulkClearButton}
                disabled={bulkBusy}
                onClick={() => {
                  setSelectedNoteIds([]);
                  setShowBulkMoveMenu(false);
                  setShowBulkExportMenu(false);
                }}
              >
                Clear
              </button>
            </div>
          </div>
        )}

        <div
          className="notesResponsiveContentGrid"
          style={{
            ...styles.contentGrid,
            ...(focusMode ? styles.contentGridFocus : {}),
          }}
        >
          {!focusMode && (
            <div className="notesResponsiveListPanel" style={styles.listPanel}>
              {filteredNotes.length === 0 ? (
                <div style={styles.emptyState}>
                  <FileText size={24} color="#4FE36B" />

                  <div style={styles.emptyTitle}>
                    {notes.length === 0
                      ? "Your notes are empty"
                      : "Nothing found"}
                  </div>

                  <div style={styles.emptyCopy}>
                    {notes.length === 0
                      ? "Create your first private note."
                      : "Try another search term."}
                  </div>

                  {notes.length === 0 ? (
                    <button
                      type="button"
                      style={styles.secondaryButton}
                      onClick={openNewWithDraftCheck}
                    >
                      <Plus size={14} />
                      New note
                    </button>
                  ) : (
                    <div style={styles.emptyStateActions}>
                      <button
                        type="button"
                        style={styles.secondaryButton}
                        onClick={() => {
                          setQuery("");
                          setSelectedFolder("all");
                          setSelectedTag("all");
                          setShowFavorites(false);
                          setShowRecentlyOpened(false);
                          setSearchPinnedOnly(false);
                          setSearchHasReminder(false);
                          setShowArchivedNotes(false);
                          setShowTrash(false);
                        }}
                      >
                        Clear filters
                      </button>

                      <button
                        type="button"
                        style={styles.primaryButton}
                        onClick={openNewWithDraftCheck}
                      >
                        <Plus size={13} />
                        New note
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                filteredNotes.map((note, noteIndex) => (
                  <div
                    key={note.id}
                    style={{
                      ...styles.noteRowWrap,
                      ...(searchActiveIndex === noteIndex && query.trim()
                        ? styles.noteRowWrapSearchActive
                        : {}),
                      ...(selectedNoteIds.includes(note.id)
                        ? styles.noteRowWrapSelected
                        : {}),
                    }}
                    onMouseEnter={() => setHoveredNoteId(note.id)}
                    onMouseLeave={() => setHoveredNoteId(null)}
                  >
                    <button
                      type="button"
                      style={styles.noteSelectCheckbox}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleNoteSelection(note.id);
                      }}
                      title={
                        selectedNoteIds.includes(note.id)
                          ? "Deselect note"
                          : "Select note"
                      }
                      aria-label={
                        selectedNoteIds.includes(note.id)
                          ? "Deselect note"
                          : "Select note"
                      }
                    >
                      {selectedNoteIds.includes(note.id) ? "✓" : ""}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(note.id);
                        rememberRecentlyOpened(note.id);
                        setShowNoteExportMenu(false);
                        setShowSearchFilters(false);
                        setShowSortMenu(false);
                      }}
                      style={{
                        ...styles.noteRow,
                        flex: 1,
                        minWidth: 0,
                        paddingRight: 175,
                        borderLeft: note.color
                          ? `3px solid ${note.color}`
                          : "3px solid transparent",
                        background:
                          selectedId === note.id ? "#20242B" : "transparent",
                      }}
                    >
                      <div style={styles.noteIcon}>
                        {note.favorite ? (
                          <Star size={14} fill="currentColor" />
                        ) : note.pinned ? (
                          <Pin size={14} />
                        ) : (
                          <FileText size={14} />
                        )}
                      </div>

                      <div style={styles.rowText}>
                        <div style={styles.rowTitle}>
                          <span>
                            {renderSearchHighlight(note.title, query)}
                          </span>

                          {Array.isArray(note.attachments) &&
                            note.attachments.length > 0 && (
                              <span
                                style={styles.rowAttachmentBadge}
                                title={`${note.attachments.length} attachment${
                                  note.attachments.length === 1 ? "" : "s"
                                }`}
                              >
                                <Paperclip size={9} />
                                {note.attachments.length}
                              </span>
                            )}
                        </div>

                        <div style={styles.rowMeta}>
                          {renderSearchHighlight(
                            String(note.content || "")
                              .replace(/\s+/g, " ")
                              .slice(0, 70),
                            query,
                          )}
                        </div>

                        <div style={styles.rowCompactMeta}>
                          <span>
                            Updated{" "}
                            {formatNoteDateTime(
                              note.updatedAt || note.createdAt,
                            )}
                          </span>

                          <span>·</span>

                          <span>{getNoteShareStatus(note.id).label}</span>

                          {Array.isArray(note.attachments) &&
                            note.attachments.length > 0 && (
                              <>
                                <span>·</span>
                                <span>
                                  {note.attachments.length}{" "}
                                  {note.attachments.length === 1
                                    ? "attachment"
                                    : "attachments"}
                                </span>
                              </>
                            )}
                        </div>
                      </div>
                    </button>

                    {!note.trashed && hoveredNoteId === note.id && (
                      <div style={styles.noteQuickActions}>
                        <button
                          type="button"
                          style={styles.noteQuickActionButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleFavorite(note.id);
                          }}
                          title={
                            note.favorite
                              ? "Remove from favorites"
                              : "Add to favorites"
                          }
                          aria-label={
                            note.favorite
                              ? "Remove from favorites"
                              : "Add to favorites"
                          }
                        >
                          <Star
                            size={12}
                            fill={note.favorite ? "currentColor" : "none"}
                          />
                        </button>

                        <button
                          type="button"
                          style={styles.noteQuickActionButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePin(note.id);
                          }}
                          title={note.pinned ? "Unpin note" : "Pin note"}
                          aria-label={note.pinned ? "Unpin note" : "Pin note"}
                        >
                          <Pin
                            size={12}
                            fill={note.pinned ? "currentColor" : "none"}
                          />
                        </button>

                        <button
                          type="button"
                          style={styles.noteQuickActionButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleArchive(note.id);
                          }}
                          title="Archive note"
                          aria-label="Archive note"
                        >
                          <Archive size={12} />
                        </button>

                        <button
                          type="button"
                          style={styles.noteQuickActionButton}
                          onClick={async (event) => {
                            event.stopPropagation();

                            try {
                              await navigator.clipboard.writeText(
                                [
                                  note.title || "Untitled note",
                                  "",
                                  note.content || "",
                                ].join("\n"),
                              );
                              setError("");
                              setNoteCopied(true);

                              window.setTimeout(
                                () => setNoteCopied(false),
                                1200,
                              );
                            } catch {
                              setError("Could not copy the note.");
                            }
                          }}
                          title="Copy note"
                          aria-label="Copy note"
                        >
                          {noteCopied && selectedId === note.id ? (
                            <Check size={12} />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>

                        <button
                          type="button"
                          style={styles.noteQuickActionDanger}
                          onClick={async (event) => {
                            event.stopPropagation();

                            if (
                              window.confirm(
                                `Move "${note.title || "Untitled note"}" to Trash?`,
                              )
                            ) {
                              await deleteNote(note.id);
                            }
                          }}
                          title="Move to Trash"
                          aria-label="Move to Trash"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          <div
            style={{
              ...styles.detailPanel,
              ...(focusMode ? styles.detailPanelFocus : {}),
              ...(selected.color
                ? { boxShadow: `inset 0 3px 0 ${selected.color}` }
                : {}),
            }}
          >
            {selected ? (
              <>
                <div
                  className="notesResponsiveDetailHeader"
                  style={styles.detailHeader}
                >
                  <div style={styles.detailHeaderMain}>
                    <div style={styles.detailEyebrow}>PRIVATE NOTE</div>
                    <h2 style={styles.detailTitle}>{selected.title}</h2>

                    <div style={styles.detailSubline}>
                      <span style={styles.detailFolderPill}>
                        <Folder size={10} />
                        {selected.folderId
                          ? folders.find(
                              (folder) => folder.id === selected.folderId,
                            )?.name || "Folder"
                          : "No folder"}
                      </span>

                      {(() => {
                        const shareStatus = getNoteShareStatus(selected.id);
                        return (
                          <span
                            style={{
                              ...styles.detailStatusPill,
                              ...(shareStatus.key === "shared"
                                ? styles.noteShareStatusShared
                                : shareStatus.key === "revoked"
                                  ? styles.noteShareStatusRevoked
                                  : styles.noteShareStatusPrivate),
                            }}
                          >
                            <Link2 size={10} />
                            {shareStatus.label}
                          </span>
                        );
                      })()}

                      {selected.pinned && (
                        <span style={styles.detailMiniPill}>
                          <Pin size={9} /> Pinned
                        </span>
                      )}
                      {selected.favorite && (
                        <span style={styles.detailMiniPill}>
                          <Star size={9} fill="currentColor" /> Favorite
                        </span>
                      )}
                    </div>

                    <div style={styles.detailMetaLine}>
                      <span>
                        Updated {formatNoteDateTime(selected.updatedAt)}
                      </span>
                      {(() => {
                        const stats = getNoteStatistics(selected);
                        return (
                          <>
                            <span>·</span>
                            <span>{stats.words} words</span>
                            <span>·</span>
                            <span>
                              {stats.readingSeconds < 60
                                ? `${stats.readingSeconds} sec read`
                                : `${Math.ceil(stats.readingSeconds / 60)} min read`}
                            </span>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div style={styles.detailToolbarArea}>
                    <div style={styles.detailPrimaryActions}>
                      <button
                        type="button"
                        style={{
                          ...styles.primaryToolbarButton,
                          ...(focusMode ? styles.focusModeActiveButton : {}),
                        }}
                        onClick={() => {
                          setFocusMode((value) => !value);
                          setShowNoteFind(false);
                          setNoteFindQuery("");
                        }}
                        title={focusMode ? "Exit focus mode" : "Focus mode"}
                      >
                        <Eye size={14} />
                        <span>{focusMode ? "Exit focus" : "Focus"}</span>
                      </button>

                      <button
                        type="button"
                        style={styles.primaryToolbarButton}
                        onClick={() => openEdit(selected)}
                        title="Edit note"
                      >
                        <Pencil size={14} />
                        <span>Edit</span>
                      </button>

                      <button
                        type="button"
                        style={{
                          ...styles.iconButtonCompact,
                          ...(showNoteFind ? styles.focusModeActiveButton : {}),
                        }}
                        onClick={() => setShowNoteFind((value) => !value)}
                        title="Find in this note"
                        aria-label="Find in this note"
                      >
                        <SearchCheck size={14} />
                      </button>

                      <button
                        type="button"
                        style={{
                          ...styles.iconButtonCompact,
                          ...(selected.favorite
                            ? styles.favoriteActiveButton
                            : {}),
                        }}
                        onClick={() => toggleFavorite(selected.id)}
                        title={
                          selected.favorite
                            ? "Remove from favorites"
                            : "Add to favorites"
                        }
                      >
                        <Star
                          size={14}
                          fill={selected.favorite ? "currentColor" : "none"}
                        />
                      </button>

                      <button
                        type="button"
                        style={styles.moreToolbarButton}
                        onClick={() => setShowNoteToolsMenu((value) => !value)}
                        aria-haspopup="menu"
                        aria-expanded={showNoteToolsMenu}
                        title="More note actions"
                      >
                        <SlidersHorizontal size={14} />
                        <span>More</span>
                      </button>
                    </div>

                    {showNoteToolsMenu && (
                      <div
                        style={styles.noteToolsMenu}
                        data-floating-menu="true"
                      >
                        <div style={styles.noteToolsMenuHeader}>
                          NOTE ACTIONS
                        </div>

                        <div style={styles.noteToolsMenuSection}>
                          <button
                            type="button"
                            style={styles.noteToolsMenuItem}
                            onClick={() => {
                              togglePin(selected.id);
                              setShowNoteToolsMenu(false);
                            }}
                          >
                            {selected.pinned ? (
                              <PinOff size={13} />
                            ) : (
                              <Pin size={13} />
                            )}
                            {selected.pinned ? "Unpin note" : "Pin note"}
                          </button>

                          <button
                            type="button"
                            style={styles.noteToolsMenuItem}
                            onClick={() => {
                              copySelectedNote();
                              setShowNoteToolsMenu(false);
                            }}
                          >
                            <Copy size={13} /> Copy note
                          </button>

                          <button
                            type="button"
                            style={styles.noteToolsMenuItem}
                            onClick={() => {
                              duplicateSelectedNote();
                              setShowNoteToolsMenu(false);
                            }}
                          >
                            <Files size={13} /> Duplicate
                          </button>

                          <button
                            type="button"
                            style={styles.noteToolsMenuItem}
                            onClick={() => {
                              setShowVersionHistory(true);
                              setShowNoteToolsMenu(false);
                            }}
                          >
                            <History size={13} /> Version history
                          </button>

                          <button
                            type="button"
                            style={styles.noteToolsMenuItem}
                            onClick={() => {
                              printSelectedNote();
                              setShowNoteToolsMenu(false);
                            }}
                          >
                            <Printer size={13} /> Print note
                          </button>
                        </div>

                        <div style={styles.noteToolsMenuDivider} />

                        <div style={styles.noteToolsMenuSection}>
                          <div style={styles.noteToolsMenuLabel}>ORGANIZE</div>
                          <select
                            value={selected.folderId || ""}
                            onChange={(e) => {
                              moveSelectedNote(e.target.value || "all");
                              setShowNoteToolsMenu(false);
                            }}
                            style={styles.folderSelectCompact}
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
                              style={styles.noteToolsMenuItem}
                              onClick={() => {
                                toggleArchive(selected.id);
                                setShowNoteToolsMenu(false);
                              }}
                            >
                              <Archive size={13} />
                              {selected.archived ? "Unarchive" : "Archive"}
                            </button>
                          )}

                          {!showTrash && !selected.archived && (
                            <button
                              type="button"
                              style={styles.noteToolsMenuItem}
                              onClick={() => {
                                openShareModal();
                                setShowNoteToolsMenu(false);
                              }}
                            >
                              <Share2 size={13} /> Share note
                            </button>
                          )}

                          <button
                            type="button"
                            style={styles.noteToolsMenuItem}
                            onClick={() => {
                              openShareManager();
                              setShowNoteToolsMenu(false);
                            }}
                          >
                            <Link2 size={13} /> Manage shared links
                          </button>
                        </div>

                        <div style={styles.noteToolsMenuDivider} />

                        <div style={styles.noteToolsMenuSection}>
                          <div style={styles.noteToolsMenuLabel}>EXPORT</div>
                          <div style={styles.noteExportMiniGrid}>
                            <button
                              type="button"
                              style={styles.noteExportMiniButton}
                              onClick={() => {
                                exportSelectedNote("markdown");
                                setShowNoteToolsMenu(false);
                              }}
                            >
                              Markdown
                            </button>
                            <button
                              type="button"
                              style={styles.noteExportMiniButton}
                              onClick={() => {
                                exportSelectedNote("txt");
                                setShowNoteToolsMenu(false);
                              }}
                            >
                              TXT
                            </button>
                            <button
                              type="button"
                              style={styles.noteExportMiniButton}
                              onClick={() => {
                                exportSelectedNote("json");
                                setShowNoteToolsMenu(false);
                              }}
                            >
                              JSON
                            </button>
                          </div>
                        </div>

                        <div style={styles.noteToolsMenuDivider} />

                        <div style={styles.noteToolsMenuSection}>
                          {showTrash ? (
                            <>
                              <button
                                type="button"
                                style={styles.noteToolsMenuItem}
                                onClick={() => {
                                  restoreNote(selected.id);
                                  setShowNoteToolsMenu(false);
                                }}
                              >
                                ↶ Restore note
                              </button>
                              <button
                                type="button"
                                style={{
                                  ...styles.noteToolsMenuItem,
                                  ...styles.noteToolsMenuDanger,
                                }}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      "Permanently delete this note? This cannot be undone.",
                                    )
                                  ) {
                                    permanentlyDeleteNote(selected.id);
                                    setShowNoteToolsMenu(false);
                                  }
                                }}
                              >
                                <Trash2 size={13} /> Delete permanently
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              style={{
                                ...styles.noteToolsMenuItem,
                                ...styles.noteToolsMenuDanger,
                              }}
                              onClick={() => {
                                deleteNote(selected.id);
                                setShowNoteToolsMenu(false);
                              }}
                            >
                              <Trash2 size={13} /> Move to trash
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div style={styles.noteInfoBar} data-floating-menu="true">
                  <div style={styles.noteInfoLeft}>
                    <div style={styles.noteInfoTitle}>NOTE INFO</div>
                    <div style={styles.noteInfoStats}>
                      <span>
                        Created {formatNoteDateTime(selected.createdAt)}
                      </span>
                      <span>
                        Updated {formatNoteDateTime(selected.updatedAt)}
                      </span>
                      {Array.isArray(selected.tags) &&
                        selected.tags.length > 0 && (
                          <span>{selected.tags.length} tags</span>
                        )}
                      {selected.reminderAt && (
                        <span>
                          <CalendarDays size={10} /> Reminder set
                        </span>
                      )}
                      {selected.archived && <span>Archived</span>}
                      {selected.trashed && <span>Trash</span>}
                    </div>
                  </div>

                  <div style={styles.noteInfoRight}>
                    <div
                      style={styles.noteColorControlCompact}
                      title="Note color"
                    >
                      <span style={styles.noteColorLabel}>Color</span>
                      <div style={styles.noteColorSwatches}>
                        {NOTE_COLOR_OPTIONS.map((option) => (
                          <button
                            key={option.value || "default"}
                            type="button"
                            style={{
                              ...styles.noteColorSwatch,
                              ...(selected.color === option.value
                                ? styles.noteColorSwatchActive
                                : {}),
                              ...(option.value
                                ? { background: option.value }
                                : {}),
                            }}
                            onClick={() => setSelectedNoteColor(option.value)}
                            title={option.label}
                            aria-label={`Set note color: ${option.label}`}
                          >
                            {!option.value && (
                              <span style={styles.noteColorDefaultDot} />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      style={styles.noteInfoToggle}
                      onClick={() => setShowNoteInfo((value) => !value)}
                    >
                      {showNoteInfo
                        ? "Hide activity"
                        : `Activity ${buildNoteActivityTimeline(selected).length > 0 ? `· ${buildNoteActivityTimeline(selected).length}` : ""}`}
                      <ChevronRight
                        size={12}
                        style={{
                          transform: showNoteInfo ? "rotate(90deg)" : "none",
                        }}
                      />
                    </button>
                  </div>
                </div>

                {showNoteInfo && (
                  <div style={styles.noteActivityPanel}>
                    <div style={styles.noteActivityListWide}>
                      {buildNoteActivityTimeline(selected).length > 0 ? (
                        buildNoteActivityTimeline(selected).map((event) => (
                          <div key={event.id} style={styles.noteActivityItem}>
                            <span style={styles.noteActivityDot} />
                            <div style={styles.noteActivityBody}>
                              <div style={styles.noteActivityText}>
                                {event.label} · {event.detail}
                              </div>
                              <div style={styles.noteActivityTime}>
                                {formatNoteDateTime(event.at)}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <span style={styles.subtle}>No activity yet.</span>
                      )}
                    </div>
                  </div>
                )}

                {showNoteFind && (
                  <div style={styles.noteFindBar} data-floating-menu="true">
                    <Search size={13} />
                    <input
                      value={noteFindQuery}
                      onChange={(event) => setNoteFindQuery(event.target.value)}
                      placeholder="Find in this note…"
                      style={styles.noteFindInput}
                      autoFocus
                    />
                    {noteFindQuery.trim() && (
                      <span style={styles.noteFindCount}>
                        {getNoteFindCount(selected.content, noteFindQuery)}{" "}
                        {getNoteFindCount(selected.content, noteFindQuery) === 1
                          ? "match"
                          : "matches"}
                      </span>
                    )}
                    <button
                      type="button"
                      style={styles.noteFindClose}
                      onClick={() => {
                        setShowNoteFind(false);
                        setNoteFindQuery("");
                      }}
                      title="Close note search"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}

                <div style={styles.noteContent}>
                  {renderNoteFindHighlight(selected.content, noteFindQuery)}
                </div>

                {Array.isArray(selected.attachments) &&
                  selected.attachments.length > 0 && (
                    <div style={styles.detailAttachmentSection}>
                      <div style={styles.detailAttachmentTitle}>
                        Attachments
                      </div>
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

                            const next = window.prompt(
                              `Rename #${tag} to:`,
                              tag,
                            );

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
                Version history starts recording when you save an edit after
                this feature is installed.
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
                          {String(version.content || "").length > 140
                            ? "…"
                            : ""}
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
                    shareBusy ||
                    Boolean(selected?.trashed || selected?.archived)
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

        {showSaveViewDialog && (
          <div style={styles.overlay}>
            <div
              style={{
                ...styles.formModal,
                maxWidth: 420,
              }}
            >
              <button
                type="button"
                style={styles.modalClose}
                onClick={() => {
                  setShowSaveViewDialog(false);
                  setSavedViewEditingId(null);
                  setSavedViewName("");
                }}
                title="Close"
              >
                <X size={17} />
              </button>

              <div style={styles.detailEyebrow}>SAVED VIEW</div>

              <h2 style={styles.formTitle}>Save current view</h2>

              <div style={styles.savedViewDialogHint}>
                Saves the current search, filters, folder, Favorites,
                archive/trash view, and sort order.
              </div>

              <label style={styles.label}>View name</label>

              <input
                autoFocus
                value={savedViewName}
                onChange={(event) => setSavedViewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveCurrentSearchView();
                  }
                }}
                placeholder="e.g. Important work"
                style={styles.input}
              />

              <div style={styles.importFooter}>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => setShowSaveViewDialog(false)}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  style={styles.primaryButton}
                  onClick={saveCurrentSearchView}
                >
                  <Bookmark size={13} />
                  {savedViewEditingId ? "Save name" : "Save view"}
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
                {importFileName || "Selected file"} ·{" "}
                {importFormat.toUpperCase()} · {importPreview.length} note
                {importPreview.length === 1 ? "" : "s"}
              </p>

              <div style={styles.importStats}>
                <span style={styles.importStatNew}>✓ {importNewCount} new</span>
                <span
                  style={{
                    ...styles.importStatDuplicate,
                    ...(importDuplicateCount === 0
                      ? styles.importStatZero
                      : {}),
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
                                        String(
                                          existing.content || "",
                                        ).trim() ===
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

                                  await snoozeReminder(
                                    note,
                                    Math.round(minutes),
                                  );
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
                              paused
                                ? resumeReminder(note)
                                : pauseReminder(note)
                            }
                            title={
                              paused ? "Resume reminder" : "Pause reminder"
                            }
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

        {showNotesSettings && (
          <div style={styles.overlay}>
            <div
              style={{
                ...styles.formModal,
                width: "min(620px, calc(100vw - 28px))",
                maxHeight: "calc(100vh - 28px)",
                overflowY: "auto",
              }}
            >
              <button
                type="button"
                style={styles.modalClose}
                onClick={() => setShowNotesSettings(false)}
                title="Close settings"
              >
                <X size={17} />
              </button>

              <div style={styles.detailEyebrow}>SETTINGS</div>
              <h2 style={styles.formTitle}>Notes settings</h2>
              <p style={styles.copy}>
                Security, retention, notifications, and preferences live here so
                the main Notes workspace stays focused.
              </p>

              <div style={styles.settingsSection}>
                <div style={styles.settingsSectionLabel}>SECURITY</div>
                <div style={styles.settingsGrid}>
                  <button
                    type="button"
                    style={styles.settingsItem}
                    onClick={() => {
                      setShowNotesSettings(false);
                      openChangePassword();
                    }}
                  >
                    <ShieldCheck size={16} />
                    <span>
                      <strong>Change vault password</strong>
                      <small>Protect your encrypted notes</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>

                  <button
                    type="button"
                    style={styles.settingsItem}
                    onClick={() => {
                      setShowNotesSettings(false);
                      setShowRecoverySetup(true);
                    }}
                  >
                    <Fingerprint size={16} />
                    <span>
                      <strong>Passkey recovery</strong>
                      <small>
                        {recoveryEnabled ? "Enabled" : "Set up recovery"}
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </button>

                  <div style={styles.settingsItemControl}>
                    <Lock size={16} />
                    <span>
                      <strong>Auto-lock</strong>
                      <small>Lock automatically after inactivity</small>
                    </span>
                    <select
                      value={autoLockMinutes}
                      onChange={(event) =>
                        setAutoLockDuration(Number(event.target.value))
                      }
                      style={styles.settingsSelect}
                    >
                      <option value={0}>Off</option>
                      <option value={5}>5 min</option>
                      <option value={15}>15 min</option>
                      <option value={30}>30 min</option>
                      <option value={60}>1 hour</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    style={styles.settingsItem}
                    onClick={() => {
                      setShowNotesSettings(false);
                      lockVault();
                    }}
                  >
                    <Lock size={16} />
                    <span>
                      <strong>Lock vault now</strong>
                      <small>End the current unlocked session</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

              <div style={styles.settingsSection}>
                <div style={styles.settingsSectionLabel}>WORKSPACE</div>
                <div style={styles.settingsGrid}>
                  <button
                    type="button"
                    style={styles.settingsItem}
                    onClick={() => {
                      setShowNotesSettings(false);
                      setShowShortcuts(true);
                    }}
                  >
                    <Keyboard size={16} />
                    <span>
                      <strong>Keyboard shortcuts</strong>
                      <small>View available editor shortcuts</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>

                  <div style={styles.settingsItemControl}>
                    <Trash2 size={16} />
                    <span>
                      <strong>Trash retention</strong>
                      <small>How long deleted notes are kept</small>
                    </span>
                    <select
                      value={trashRetentionDays}
                      onChange={(event) =>
                        setTrashRetention(Number(event.target.value))
                      }
                      style={styles.settingsSelect}
                    >
                      <option value={0}>Never</option>
                      <option value={7}>7 days</option>
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                    </select>
                  </div>
                </div>
              </div>

              <div style={styles.settingsSection}>
                <div style={styles.settingsSectionLabel}>INTEGRATIONS</div>
                <div style={styles.settingsGrid}>
                  <button
                    type="button"
                    style={styles.settingsItem}
                    onClick={() => {
                      setShowNotesSettings(false);
                      telegramConnected
                        ? setShowTelegramConnect(true)
                        : connectTelegram();
                    }}
                  >
                    <Bell size={16} />
                    <span>
                      <strong>Telegram reminders</strong>
                      <small>
                        {telegramConnected
                          ? `Connected${telegramUsername ? ` · ${telegramUsername}` : ""}`
                          : "Connect Telegram"}
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </button>

                  <button
                    type="button"
                    style={styles.settingsItem}
                    onClick={() => enableNotifications()}
                  >
                    <Bell size={16} />
                    <span>
                      <strong>Browser notifications</strong>
                      <small>
                        {notificationsEnabled
                          ? "Enabled"
                          : "Enable notifications"}
                      </small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

              <div style={styles.importFooter}>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => setShowNotesSettings(false)}
                >
                  Done
                </button>
              </div>
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
                {recoveryBusy
                  ? "Waiting for passkey…"
                  : "Continue with passkey"}
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
                {recoveryBusy
                  ? "Resetting password…"
                  : "Set new vault password"}
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

              {!editing && showNewNoteDraftPrompt && (
                <div style={styles.newNoteDraftBanner}>
                  <div>
                    <strong>Unsaved draft available</strong>
                    <span style={styles.newNoteDraftSubtext}>
                      {newNoteDraftSavedAt
                        ? `Last saved ${formatNoteDateTime(
                            newNoteDraftSavedAt,
                          )}`
                        : "Saved automatically · available after reopening"}
                    </span>
                  </div>

                  <div style={styles.newNoteDraftActions}>
                    <button
                      type="button"
                      style={styles.newNoteDraftRestore}
                      onClick={restoreNewNoteDraft}
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      style={styles.newNoteDraftDismiss}
                      onClick={clearNewNoteDraft}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}

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

                  <div style={styles.quickTemplateSection}>
                    <div style={styles.quickTemplateLabel}>QUICK START</div>

                    <div style={styles.quickTemplateRow}>
                      <button
                        type="button"
                        style={styles.quickTemplateChip}
                        onClick={() => {
                          setNewNoteTemplateId("blank");
                          setForm({
                            title: "",
                            content: "",
                          });
                          setFormTags([]);
                          setFormAttachments([]);
                          setEditorHtml("");
                          editorLoadKeyRef.current = "";
                          setEditorStatus("New note");
                        }}
                      >
                        Blank
                      </button>

                      {NOTE_TEMPLATES.slice(0, 3).map((template) => (
                        <button
                          key={`quick-${template.id}`}
                          type="button"
                          style={styles.quickTemplateChip}
                          onClick={() => {
                            setNewNoteTemplateId(template.id);
                            applyNoteTemplate(template.id);
                            setEditorStatus("Template applied");
                          }}
                          title={template.description}
                        >
                          {template.name}
                        </button>
                      ))}
                    </div>
                  </div>
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
                        : [
                            Number(
                              defaultRecurrenceDay(formReminder, "weekly"),
                            ),
                          ],
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
                        Math.max(
                          1,
                          Math.min(3650, Number(e.target.value) || 1),
                        ),
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

              {!editing && (
                <div style={styles.noteDraftStatus}>
                  {editorStatus === "Draft saved"
                    ? "Draft saved automatically"
                    : newNoteDraftAvailable
                      ? "Draft recovery available"
                      : ""}
                </div>
              )}

              {error && <div style={styles.error}>{error}</div>}

              {(() => {
                const liveStats = getNoteStatistics({
                  content: form.content,
                });

                return (
                  <div style={styles.noteLiveStats}>
                    <span>{liveStats.words} words</span>
                    <span>·</span>
                    <span>{liveStats.characters} chars</span>
                    <span>·</span>
                    <span>
                      {liveStats.readingSeconds < 60
                        ? `${liveStats.readingSeconds} sec read`
                        : `${Math.ceil(
                            liveStats.readingSeconds / 60,
                          )} min read`}
                    </span>
                  </div>
                );
              })()}

              <div style={styles.noteFormFooter}>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => {
                    const hasDraftContent = Boolean(
                      form.title.trim() ||
                      form.content.trim() ||
                      formTags.length ||
                      formAttachments.length ||
                      formReminder ||
                      formNotifyTelegram,
                    );

                    setShowForm(false);
                    setEditing(null);
                    setShowNewNoteDraftPrompt(false);
                    setError("");

                    if (!editing && hasDraftContent) {
                      setNewNoteDraftAvailable(true);
                    }
                  }}
                >
                  Close
                </button>

                <div style={styles.noteFooterCenter}>
                  <span
                    style={{
                      ...styles.noteSaveStatus,
                      ...(editorStatus === "Saving…"
                        ? styles.noteSaveStatusSaving
                        : editorStatus === "Unsaved changes"
                          ? styles.noteSaveStatusUnsaved
                          : {}),
                    }}
                  >
                    {editorStatus}
                  </span>

                  <span style={styles.noteKeyboardHint}>
                    ⌘/Ctrl+S · ⌘/Ctrl+Enter
                  </span>
                </div>

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
          </div>
        )}
      </div>
    </>
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

  notesSortWrap: {
    position: "relative",
    marginLeft: "auto",
    flexShrink: 0,
  },

  notesSortButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    height: 28,
    padding: "0 8px",
    border: "1px solid #2B3038",
    borderRadius: 6,
    background: "#171A1F",
    color: "#858D97",
    fontSize: 9,
    cursor: "pointer",
  },

  notesSortCurrent: {
    color: "#68717B",
    fontSize: 8,
  },

  notesSortMenu: {
    position: "absolute",
    top: "calc(100% + 5px)",
    right: 0,
    zIndex: 60,
    width: 185,
    padding: 5,
    border: "1px solid #2C323A",
    borderRadius: 8,
    background: "#171A1F",
    boxShadow: "0 16px 34px rgba(0,0,0,0.34)",
  },

  notesSortItem: {
    width: "100%",
    display: "block",
    padding: "8px 9px",
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "#8E969F",
    fontSize: 9,
    textAlign: "left",
    cursor: "pointer",
  },

  notesSortItemActive: {
    background: "#20251F",
    color: "#B5C9BA",
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

  notesToolsButtonActive: {
    border: "1px solid #3A5E43",
    background: "#1A241D",
    color: "#9BD3A2",
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

  trashRetentionWrap: {
    position: "relative",
    display: "inline-flex",
  },

  trashRetentionValue: {
    color: "#737C87",
    fontSize: 8,
    marginLeft: 1,
  },

  trashRetentionMenu: {
    position: "absolute",
    top: "calc(100% + 7px)",
    right: 0,
    zIndex: 65,
    width: 220,
    padding: 7,
    border: "1px solid #2C323A",
    borderRadius: 9,
    background: "#171A1F",
    boxShadow: "0 16px 34px rgba(0,0,0,0.35)",
  },

  trashRetentionTitle: {
    padding: "5px 7px 2px",
    color: "#68717B",
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: 0.9,
  },

  trashRetentionCopy: {
    padding: "2px 7px 7px",
    color: "#717A85",
    fontSize: 9,
    lineHeight: 1.4,
  },

  trashRetentionItem: {
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

  trashRetentionItemActive: {
    background: "#22272E",
    color: "#E2E0D9",
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

  savedViewsWrap: {
    position: "relative",
    flexShrink: 0,
  },

  savedViewsMenu: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    zIndex: 75,
    width: 335,
    maxWidth: "min(335px, calc(100vw - 28px))",
    padding: 8,
    border: "1px solid #2C323A",
    borderRadius: 9,
    background: "#171A1F",
    boxShadow: "0 16px 34px rgba(0,0,0,0.34)",
  },

  savedViewsTitle: {
    padding: "6px 8px 5px",
    color: "#68717B",
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: 0.9,
  },

  savedViewsHint: {
    padding: "0 8px 7px",
    color: "#666F79",
    fontSize: 8,
    lineHeight: 1.4,
  },

  savedViewsEmpty: {
    padding: "10px 8px",
    color: "#6C747E",
    fontSize: 9,
  },

  savedViewRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 2,
  },

  savedViewButton: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "8px 8px",
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "#B5BBC3",
    fontSize: 9,
    textAlign: "left",
    cursor: "pointer",
  },

  savedViewButtonLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  savedViewActionsInline: {
    display: "flex",
    alignItems: "center",
    gap: 3,
    flexShrink: 0,
    paddingLeft: 2,
  },

  savedViewIconAction: {
    width: 25,
    height: 25,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #2A3037",
    borderRadius: 5,
    background: "#1B1F24",
    color: "#7E8791",
    cursor: "pointer",
  },

  savedViewIconActionDanger: {
    width: 25,
    height: 25,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #4A302E",
    borderRadius: 5,
    background: "#241A19",
    color: "#C28D87",
    cursor: "pointer",
  },

  savedViewDelete: {
    width: 23,
    height: 23,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    borderRadius: 5,
    background: "transparent",
    color: "#69727C",
    cursor: "pointer",
  },

  savedViewSaveButton: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 5,
    padding: "8px 7px",
    border: "1px solid #2E3932",
    borderRadius: 6,
    background: "#18221B",
    color: "#9CCFA3",
    fontSize: 9,
    cursor: "pointer",
  },

  savedViewDialogHint: {
    marginBottom: 12,
    color: "#727B85",
    fontSize: 9,
    lineHeight: 1.5,
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

  bulkToolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 8,
    padding: "8px 10px",
    border: "1px solid #30363F",
    borderRadius: 8,
    background: "#171B20",
  },

  bulkToolbarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    color: "#B5BBC3",
    fontSize: 9,
  },

  bulkToolbarActions: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },

  bulkExportWrap: {
    position: "relative",
  },

  bulkExportMenu: {
    position: "absolute",
    top: "calc(100% + 5px)",
    right: 0,
    zIndex: 80,
    width: 180,
    padding: 5,
    border: "1px solid #30363F",
    borderRadius: 8,
    background: "#171B20",
    boxShadow: "0 16px 34px rgba(0,0,0,0.34)",
  },

  bulkExportMenuTitle: {
    padding: "6px 8px 5px",
    color: "#69727C",
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: 0.9,
  },

  bulkExportItem: {
    width: "100%",
    padding: "8px 9px",
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "#B1B7BE",
    fontSize: 9,
    textAlign: "left",
    cursor: "pointer",
  },

  bulkMoveWrap: {
    position: "relative",
  },

  bulkMoveMenu: {
    position: "absolute",
    top: "calc(100% + 5px)",
    right: 0,
    zIndex: 80,
    width: 180,
    padding: 5,
    border: "1px solid #30363F",
    borderRadius: 8,
    background: "#171B20",
    boxShadow: "0 16px 34px rgba(0,0,0,0.34)",
  },

  bulkMoveMenuTitle: {
    padding: "6px 8px 5px",
    color: "#69727C",
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: 0.9,
  },

  bulkMoveItem: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "8px 9px",
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "#B1B7BE",
    fontSize: 9,
    textAlign: "left",
    cursor: "pointer",
  },

  bulkSelectButton: {
    border: "none",
    background: "transparent",
    color: "#7FA18A",
    fontSize: 8,
    cursor: "pointer",
  },

  bulkActionButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "5px 7px",
    border: "1px solid #30363E",
    borderRadius: 5,
    background: "#1B1F25",
    color: "#A9AFB7",
    fontSize: 8,
    cursor: "pointer",
  },

  bulkPermanentDeleteButton: {
    color: "#C28B84",
    borderColor: "#4A302E",
    background: "#241A19",
  },

  bulkClearButton: {
    border: "none",
    background: "transparent",
    color: "#707983",
    fontSize: 8,
    cursor: "pointer",
  },

  noteRowWrap: {
    position: "relative",
    display: "flex",
    alignItems: "stretch",
    minWidth: 0,
    borderBottom: "1px solid #242932",
  },

  noteRowWrapSelected: {
    background: "#1B211D",
  },

  noteSelectCheckbox: {
    width: 28,
    flexShrink: 0,
    border: "none",
    borderRight: "1px solid #252B32",
    background: "transparent",
    color: "#8FD39A",
    cursor: "pointer",
    fontSize: 11,
  },

  searchKeyboardHint: {
    marginTop: 4,
    marginLeft: 3,
    color: "#59616B",
    fontSize: 7,
  },

  noteQuickActions: {
    position: "absolute",
    top: "50%",
    right: 7,
    transform: "translateY(-50%)",
    display: "flex",
    alignItems: "center",
    gap: 3,
    padding: 3,
    border: "1px solid #30363A",
    borderRadius: 7,
    background: "#171B20",
    boxShadow: "0 8px 20px rgba(0,0,0,0.28)",
  },

  noteQuickActionButton: {
    width: 24,
    height: 24,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #30363B",
    borderRadius: 5,
    background: "#1C2026",
    color: "#949CA5",
    cursor: "pointer",
  },

  noteQuickActionDanger: {
    width: 24,
    height: 24,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #4A302E",
    borderRadius: 5,
    background: "#241A19",
    color: "#C28C85",
    cursor: "pointer",
  },

  noteRowWrapSearchActive: {
    background: "#20271F",
    boxShadow: "inset 2px 0 0 #4FE36B",
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

  contentGridFocus: {
    display: "block",
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

  detailPanelFocus: {
    minHeight: "calc(100vh - 180px)",
    maxWidth: 1040,
    margin: "0 auto",
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

  noteActivity: {
    marginTop: 10,
    paddingTop: 9,
    borderTop: "1px solid #252A31",
  },

  noteActivityTitle: {
    marginBottom: 7,
    color: "#68717B",
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: 0.9,
  },

  noteActivityList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    maxHeight: 150,
    overflowY: "auto",
  },

  noteActivityItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
  },

  noteActivityDot: {
    width: 6,
    height: 6,
    marginTop: 4,
    flexShrink: 0,
    borderRadius: "50%",
    background: "#4F6E58",
  },

  noteActivityBody: {
    minWidth: 0,
  },

  noteActivityText: {
    color: "#9CA4AD",
    fontSize: 8,
    lineHeight: 1.35,
  },

  noteActivityTime: {
    marginTop: 2,
    color: "#5F6872",
    fontSize: 7,
  },

  noteFolderBreadcrumb: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    color: "#6E7780",
    fontSize: 8,
  },

  noteShareStatus: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    width: "fit-content",
    marginTop: 6,
    padding: "4px 7px",
    borderRadius: 6,
    fontSize: 8,
    fontWeight: 700,
  },

  noteShareStatusShared: {
    color: "#9CCFA3",
    background: "#17231A",
    border: "1px solid #29412E",
  },

  noteShareStatusPrivate: {
    color: "#8D96A0",
    background: "#181C21",
    border: "1px solid #2A3037",
  },

  noteShareStatusRevoked: {
    color: "#C8958E",
    background: "#241A19",
    border: "1px solid #4A302E",
  },

  noteCreatedMeta: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 7,
    color: "#68717B",
    fontSize: 8,
  },

  noteStatsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 5,
    marginTop: 7,
    color: "#7A838D",
    fontSize: 8,
  },

  rowAttachmentBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    marginLeft: 5,
    padding: "2px 4px",
    border: "1px solid #30373E",
    borderRadius: 4,
    background: "#1A1E23",
    color: "#7F8A94",
    fontSize: 7,
    verticalAlign: "middle",
  },

  rowCompactMeta: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    color: "#5F6872",
    fontSize: 7,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  rowDate: {
    marginTop: 4,
    color: "#5E6670",
    fontSize: 7,
  },

  detailHeaderMain: {
    minWidth: 0,
    flex: 1,
  },

  detailSubline: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
    marginTop: 8,
  },

  detailFolderPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 7px",
    borderRadius: 6,
    background: "#15191E",
    border: "1px solid #292F37",
    color: "#858D97",
    fontSize: 8,
  },

  detailStatusPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 7px",
    borderRadius: 6,
    fontSize: 8,
    fontWeight: 700,
  },

  detailMiniPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 7px",
    borderRadius: 6,
    border: "1px solid #2C3139",
    background: "#171A1F",
    color: "#8E949C",
    fontSize: 8,
  },

  detailMetaLine: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 7,
    color: "#616A74",
    fontSize: 8,
  },

  detailToolbarArea: {
    position: "relative",
    flexShrink: 0,
  },

  detailPrimaryActions: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: 4,
    border: "1px solid #2A3038",
    borderRadius: 9,
    background: "#14181D",
  },

  primaryToolbarButton: {
    height: 30,
    padding: "0 9px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    border: "1px solid #2C323A",
    borderRadius: 6,
    background: "#1B1F25",
    color: "#B0B6BE",
    cursor: "pointer",
    fontSize: 8,
    fontWeight: 700,
  },

  iconButtonCompact: {
    width: 30,
    height: 30,
    borderRadius: 6,
    border: "1px solid #2C323A",
    background: "#1B1F25",
    color: "#858D97",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },

  moreToolbarButton: {
    height: 30,
    padding: "0 8px",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    border: "1px solid #2C323A",
    borderRadius: 6,
    background: "#1B1F25",
    color: "#858D97",
    cursor: "pointer",
    fontSize: 8,
    fontWeight: 700,
  },

  noteToolsMenu: {
    position: "absolute",
    top: "calc(100% + 7px)",
    right: 0,
    width: 260,
    maxWidth: "min(260px, calc(100vw - 34px))",
    maxHeight: "min(540px, calc(100vh - 190px))",
    overflowY: "auto",
    padding: 8,
    zIndex: 25,
    border: "1px solid #30363E",
    borderRadius: 10,
    background: "#161A1F",
    boxShadow: "0 18px 45px rgba(0,0,0,.45)",
  },

  noteToolsMenuHeader: {
    padding: "4px 6px 7px",
    color: "#616A74",
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: 1,
  },

  noteToolsMenuSection: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },

  noteToolsMenuItem: {
    width: "100%",
    minHeight: 30,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 8px",
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "#B2B7BE",
    cursor: "pointer",
    fontSize: 9,
    textAlign: "left",
  },

  noteToolsMenuDanger: {
    color: "#C58C85",
  },

  noteToolsMenuLabel: {
    marginBottom: 4,
    padding: "2px 6px",
    color: "#59626C",
    fontSize: 7,
    fontWeight: 800,
    letterSpacing: 0.8,
  },

  noteToolsMenuDivider: {
    height: 1,
    margin: "7px 0",
    background: "#292F37",
  },

  folderSelectCompact: {
    width: "100%",
    minHeight: 30,
    padding: "0 8px",
    border: "1px solid #2D333C",
    borderRadius: 6,
    background: "#1A1E24",
    color: "#B2B7BE",
    outline: "none",
    fontSize: 9,
  },

  noteExportMiniGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 4,
  },

  noteExportMiniButton: {
    minHeight: 28,
    border: "1px solid #2D333B",
    borderRadius: 6,
    background: "#191D22",
    color: "#9CA3AC",
    cursor: "pointer",
    fontSize: 8,
    fontWeight: 700,
  },

  noteInfoBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 14,
    padding: "8px 10px",
    border: "1px solid #282E36",
    borderRadius: 8,
    background: "#14181D",
  },

  noteInfoLeft: {
    minWidth: 0,
    flex: 1,
  },

  noteInfoTitle: {
    marginBottom: 4,
    color: "#606973",
    fontSize: 7,
    fontWeight: 800,
    letterSpacing: 0.9,
  },

  noteInfoStats: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 7,
    color: "#7C858F",
    fontSize: 8,
  },

  noteInfoStatsSpan: {},

  noteInfoRight: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },

  noteColorControlCompact: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    height: 28,
    padding: "0 6px",
    border: "1px solid #2B3139",
    borderRadius: 6,
    background: "#171B20",
  },

  noteInfoToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 28,
    padding: "0 7px",
    border: "1px solid #2B3139",
    borderRadius: 6,
    background: "#171B20",
    color: "#858E98",
    cursor: "pointer",
    fontSize: 8,
    fontWeight: 700,
  },

  noteActivityPanel: {
    marginBottom: 14,
    padding: "9px 10px",
    border: "1px solid #282E36",
    borderRadius: 8,
    background: "#14181D",
  },

  noteActivityListWide: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
  },

  detailHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    borderBottom: "1px solid #292D35",
    paddingBottom: 12,
    marginBottom: 10,
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

  favoriteActiveButton: {
    color: "#D7B95A",
    borderColor: "#4B422B",
    background: "#211F18",
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

  focusModeActiveButton: {
    color: "#4FE36B",
    borderColor: "#315A38",
    background: "#162019",
  },

  noteColorControl: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "0 5px",
    height: 32,
    border: "1px solid #2C313A",
    borderRadius: 7,
    background: "#181B20",
  },

  noteColorLabel: {
    color: "#626A73",
    fontSize: 7,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  noteColorSwatches: {
    display: "flex",
    alignItems: "center",
    gap: 3,
  },

  noteColorSwatch: {
    width: 13,
    height: 13,
    padding: 0,
    border: "2px solid transparent",
    borderRadius: "50%",
    background: "#252A31",
    cursor: "pointer",
  },

  noteColorSwatchActive: {
    borderColor: "#ECEAE3",
    boxShadow: "0 0 0 1px #555D66",
  },

  noteColorDefaultDot: {
    display: "block",
    width: 5,
    height: 5,
    margin: "2px auto 0",
    borderRadius: "50%",
    background: "#68717B",
  },

  noteFindBar: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    marginBottom: 12,
    padding: "7px 9px",
    border: "1px solid #2C333B",
    borderRadius: 7,
    background: "#14181C",
    color: "#68717B",
  },

  noteFindInput: {
    flex: 1,
    minWidth: 0,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#ECEAE3",
    fontSize: 10,
  },

  noteFindCount: {
    color: "#6F7D75",
    fontSize: 8,
    whiteSpace: "nowrap",
  },

  noteFindClose: {
    width: 22,
    height: 22,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #2C313A",
    borderRadius: 5,
    background: "#1A1E23",
    color: "#8D929B",
    cursor: "pointer",
  },

  noteFindHighlight: {
    padding: "1px 2px",
    borderRadius: 3,
    background: "#5D5021",
    color: "#FFF3B8",
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

  emptyStateActions: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
    justifyContent: "center",
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

  quickTemplateSection: {
    marginTop: 8,
    marginBottom: 4,
    paddingTop: 8,
    borderTop: "1px solid #252A31",
  },

  quickTemplateLabel: {
    marginBottom: 6,
    color: "#626B74",
    fontSize: 7,
    fontWeight: 800,
    letterSpacing: 0.8,
  },

  quickTemplateRow: {
    display: "flex",
    gap: 5,
    flexWrap: "wrap",
  },

  quickTemplateChip: {
    padding: "5px 8px",
    border: "1px solid #2C333A",
    borderRadius: 6,
    background: "#191D22",
    color: "#8E979F",
    fontSize: 8,
    cursor: "pointer",
  },

  noteFooterCenter: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    minWidth: 0,
  },

  noteSaveStatus: {
    color: "#7F9B84",
    fontSize: 7,
    whiteSpace: "nowrap",
  },

  noteSaveStatusSaving: {
    color: "#B19C6E",
  },

  noteSaveStatusUnsaved: {
    color: "#C38F87",
  },

  noteKeyboardHint: {
    color: "#59616B",
    fontSize: 7,
    marginRight: "auto",
  },

  noteLiveStats: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 5,
    marginTop: 6,
    color: "#68717B",
    fontSize: 7,
  },

  newNoteDraftBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
    padding: "9px 10px",
    border: "1px solid #334238",
    borderRadius: 7,
    background: "#172019",
    color: "#A9BEAE",
    fontSize: 9,
  },

  newNoteDraftSubtext: {
    display: "block",
    marginTop: 2,
    color: "#68756D",
    fontSize: 7,
  },

  newNoteDraftActions: {
    display: "flex",
    gap: 5,
    flexShrink: 0,
  },

  newNoteDraftRestore: {
    padding: "5px 8px",
    border: "1px solid #36513C",
    borderRadius: 5,
    background: "#1C2A20",
    color: "#9CCFA3",
    fontSize: 8,
    cursor: "pointer",
  },

  newNoteDraftDismiss: {
    padding: "5px 8px",
    border: "1px solid #4A302E",
    borderRadius: 5,
    background: "#241A19",
    color: "#C28D85",
    fontSize: 8,
    cursor: "pointer",
  },

  noteDraftStatus: {
    marginTop: 5,
    marginBottom: -7,
    color: "#68756D",
    fontSize: 7,
    textAlign: "right",
  },

  noteFormFooter: {
    position: "sticky",
    bottom: -24,
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    margin: "18px -24px -24px",
    padding: "12px 24px 24px",
    borderTop: "1px solid #2A2F37",
    background: "linear-gradient(to bottom, rgba(26,29,36,0.95), #1A1D24 28px)",
  },

  settingsSection: {
    marginTop: 18,
  },
  settingsSectionLabel: {
    fontSize: 10,
    letterSpacing: "0.14em",
    color: "#727883",
    fontWeight: 700,
    marginBottom: 9,
  },
  settingsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
  },
  settingsItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    padding: "11px 12px",
    background: "#181B21",
    border: "1px solid #2C3038",
    borderRadius: 10,
    color: "#D6D8DD",
    textAlign: "left",
    cursor: "pointer",
  },
  settingsItemControl: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    padding: "10px 12px",
    background: "#181B21",
    border: "1px solid #2C3038",
    borderRadius: 10,
    color: "#D6D8DD",
  },
  settingsSelect: {
    marginLeft: "auto",
    background: "#14161B",
    color: "#D6D8DD",
    border: "1px solid #30343D",
    borderRadius: 7,
    padding: "6px 7px",
    maxWidth: 92,
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
