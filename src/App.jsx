import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import Papa from "papaparse";
import { loadData, saveData } from "./db";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import {
  Plus,
  Wallet,
  LayoutDashboard,
  Receipt,
  Landmark,
  Target,
  X,
  Trash2,
  Search,
  Download,
  Upload,
  Repeat,
  PiggyBank,
  Pencil,
  ArrowUpRight,
  ArrowDownRight,
  Camera,
  Loader2,
  KeyRound,
  NotebookPen,
  Settings,
  Bell,
  Sun,
  Command,
  CalendarDays,
  BarChart3,
  ChevronRight,
  ShieldCheck,
  SearchCheck,
  Link2,
  MonitorSmartphone,
  LogOut,
  Palette,
  Tags,
  Database,
  SlidersHorizontal,
} from "lucide-react";
import { scanReceipt } from "./receiptScan";
import PasswordsView from "./PasswordsView";
import NotesView from "./NotesView";
import ShareView from "./ShareView";
import RemindersView from "./RemindersView";

const SEED_CATEGORIES = {
  income: ["Salary", "Business", "Freelance", "Investment", "Other Income"],
  expense: [
    "Food",
    "Transport",
    "Shopping",
    "Bills",
    "Health",
    "Entertainment",
    "Other",
  ],
};

const PALETTE = [
  "#C9A455",
  "#4FA98C",
  "#7C93C9",
  "#D9735C",
  "#9B7FC7",
  "#5FB0C9",
];

function getPocketPreference(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function setPocketPreference(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
  window.dispatchEvent(
    new CustomEvent("pocket:preferences-changed", { detail: { key, value } }),
  );
}

function getPocketBool(key, fallback = false) {
  return getPocketPreference(key, fallback ? "1" : "0") === "1";
}

function fmtINR(n) {
  const currency = getPocketPreference("pocket_currency", "INR");
  const locales = { INR: "en-IN", USD: "en-US", EUR: "de-DE", GBP: "en-GB" };
  try {
    return new Intl.NumberFormat(locales[currency] || "en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(Number(n) || 0);
  } catch {
    return `${currency} ${Math.round(Number(n) || 0).toLocaleString()}`;
  }
}

function formatPocketDate(d) {
  const value = new Date(d);
  const format = getPocketPreference("pocket_date_format", "DD MMM YYYY");
  if (format === "DD/MM/YYYY")
    return `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}/${value.getFullYear()}`;
  if (format === "MMM DD, YYYY")
    return value.toLocaleDateString("en-IN", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  if (format === "YYYY-MM-DD") return value.toISOString().slice(0, 10);
  return value.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function fmtDate(d) {
  return formatPocketDate(d);
}
function monthKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
  });
}
function addInterval(dateStr, freq) {
  const d = new Date(dateStr);
  if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}
const uid = () => Math.random().toString(36).slice(2, 10);

function reminderLocalDateTimeToISO(date, time) {
  if (!date || !time) return null;
  const [year, month, day] = String(date).split("-").map(Number);
  const [hour, minute] = String(time).split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  const value = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function LedgerApp() {
  const [loaded, setLoaded] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [goals, setGoals] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [categories, setCategories] = useState(SEED_CATEGORIES);
  const [passwordVault, setPasswordVault] = useState(null);
  const [notesVault, setNotesVault] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileAnchor, setProfileAnchor] = useState(null);
  const [notesSettingsRequest, setNotesSettingsRequest] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState("general");
  const [preferenceTick, setPreferenceTick] = useState(0);
  const [commandOpen, setCommandOpen] = useState(false);
  const [showTxnForm, setShowTxnForm] = useState(false);
  const [editingTxn, setEditingTxn] = useState(null);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);
  const [txnPrefill, setTxnPrefill] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const fileInputRef = useRef(null);

  // Load
  useEffect(() => {
    (async () => {
      try {
        const data = await loadData();
        if (data) {
          setAccounts(data.accounts || []);
          setTransactions(data.transactions || []);
          setBudgets(data.budgets || []);
          setGoals(data.goals || []);
          setRecurring(data.recurring || []);
          setReminders(data.reminders || []);
          setCategories(data.categories || SEED_CATEGORIES);
          setPasswordVault(data.passwordVault || null);
          setNotesVault(data.notesVault || null);
        } else {
          setAccounts([
            {
              id: uid(),
              name: "Cash",
              type: "cash",
              opening: 0,
              color: PALETTE[0],
            },
            {
              id: uid(),
              name: "Bank Account",
              type: "bank",
              opening: 0,
              color: PALETTE[1],
            },
          ]);
        }
      } catch (e) {
        // fresh start
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    const apply = () => {
      const theme = getPocketPreference("pocket_theme", "dark");
      const resolved =
        theme === "system" &&
        window.matchMedia?.("(prefers-color-scheme: light)").matches
          ? "light"
          : theme;
      document.documentElement.dataset.pocketTheme = resolved;
      document.documentElement.dataset.pocketMotion = getPocketBool(
        "pocket_motion",
        true,
      )
        ? "on"
        : "off";
      setPreferenceTick((v) => v + 1);
    };
    apply();
    window.addEventListener("pocket:preferences-changed", apply);
    window.addEventListener("storage", apply);
    const open = (event) => {
      setSettingsSection(event.detail?.section || "general");
      setSettingsOpen(true);
      setProfileMenuOpen(false);
    };
    window.addEventListener("pocket:open-global-settings", open);
    return () => {
      window.removeEventListener("pocket:preferences-changed", apply);
      window.removeEventListener("storage", apply);
      window.removeEventListener("pocket:open-global-settings", open);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const preferred = getPocketPreference("pocket_start_page", "dashboard");
    if (preferred && preferred !== "dashboard") setTab(preferred);
  }, [loaded]);

  void preferenceTick;

  const openSettings = useCallback((section = "general") => {
    setSettingsSection(section);
    setSettingsOpen(true);
    setProfileMenuOpen(false);
  }, []);

  const toggleProfileMenu = useCallback(
    (event) => {
      if (profileMenuOpen) {
        setProfileMenuOpen(false);
        return;
      }

      const rect = event?.currentTarget?.getBoundingClientRect?.();
      if (rect) {
        setProfileAnchor({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
      } else {
        setProfileAnchor(null);
      }
      setProfileMenuOpen(true);
    },
    [profileMenuOpen],
  );

  // Process due recurring entries once loaded
  useEffect(() => {
    if (!loaded || recurring.length === 0) return;
    const today = todayStr();
    let newTxns = [];
    const updatedRecurring = recurring.map((r) => {
      let next = r.nextDate;
      let guard = 0;
      while (next <= today && guard < 24) {
        newTxns.push({
          id: uid(),
          type: r.type,
          amount: r.amount,
          category: r.category,
          accountId: r.accountId,
          date: next,
          note: r.label + " (auto)",
          recurringId: r.id,
        });
        next = addInterval(next, r.frequency);
        guard++;
      }
      return { ...r, nextDate: next };
    });
    if (newTxns.length > 0) {
      setTransactions((prev) => [...newTxns, ...prev]);
      setRecurring(updatedRecurring);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Persist
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        await saveData({
          accounts,
          transactions,
          budgets,
          goals,
          recurring,
          reminders,
          categories,
          passwordVault,
          notesVault,
        });
        setSaveError(false);
      } catch (e) {
        setSaveError(true);
      }
    })();
  }, [
    accounts,
    transactions,
    budgets,
    goals,
    recurring,
    reminders,
    categories,
    passwordVault,
    notesVault,
    loaded,
  ]);

  const ensureCategory = useCallback((type, cat) => {
    setCategories((prev) => {
      if (prev[type].includes(cat)) return prev;
      return { ...prev, [type]: [...prev[type], cat] };
    });
  }, []);

  const addTransaction = useCallback(
    (txn) => {
      ensureCategory(txn.type, txn.category);
      setTransactions((prev) => [{ ...txn, id: uid() }, ...prev]);
    },
    [ensureCategory],
  );

  const updateTransaction = useCallback(
    (id, txn) => {
      ensureCategory(txn.type, txn.category);
      setTransactions((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...txn } : t)),
      );
    },
    [ensureCategory],
  );

  const deleteTransaction = useCallback((id) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addAccount = useCallback((acc) => {
    setAccounts((prev) => [
      ...prev,
      { ...acc, id: uid(), color: PALETTE[prev.length % PALETTE.length] },
    ]);
  }, []);

  const addBudget = useCallback((b) => {
    setBudgets((prev) => [
      ...prev.filter((x) => x.category !== b.category),
      { ...b, id: uid() },
    ]);
  }, []);
  const deleteBudget = useCallback(
    (id) => setBudgets((prev) => prev.filter((b) => b.id !== id)),
    [],
  );

  const addGoal = useCallback(
    (g) => setGoals((prev) => [...prev, { ...g, id: uid() }]),
    [],
  );
  const contributeGoal = useCallback((id, amt) => {
    setGoals((prev) =>
      prev.map((g) =>
        g.id === id ? { ...g, saved: Math.max(0, g.saved + amt) } : g,
      ),
    );
  }, []);
  const deleteGoal = useCallback(
    (id) => setGoals((prev) => prev.filter((g) => g.id !== id)),
    [],
  );

  const addRecurring = useCallback(
    (r) => {
      ensureCategory(r.type, r.category);
      setRecurring((prev) => [...prev, { ...r, id: uid() }]);
    },
    [ensureCategory],
  );
  const deleteRecurring = useCallback(
    (id) => setRecurring((prev) => prev.filter((r) => r.id !== id)),
    [],
  );
  const syncPocketTelegramReminder = useCallback(async (reminder) => {
    if (!reminder?.id) return;

    const shouldNotifyTelegram =
      reminder.notification &&
      reminder.notification !== "none" &&
      reminder.date &&
      reminder.time;

    try {
      if (!shouldNotifyTelegram) {
        await fetch("/api/telegram?action=cancel-pocket-reminder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reminderId: reminder.id }),
        });
        return;
      }

      const response = await fetch(
        "/api/telegram?action=schedule-pocket-reminder",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reminderId: reminder.id,
            title: reminder.title,
            reminderAt: reminderLocalDateTimeToISO(
              reminder.date,
              reminder.time,
            ),
            notificationMinutes: Number(reminder.notification) || 0,
            repeat: reminder.repeat || "none",
            recurrenceDay: null,
            recurrenceDays: [],
          }),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not schedule Telegram reminder.");
      }
    } catch (error) {
      console.error("Pocket Telegram reminder sync failed:", error);
      setMessage(error.message || "Could not sync Telegram reminder.");
    }
  }, []);

  const addReminder = useCallback(
    (reminder) => {
      const normalized = {
        ...reminder,
        id: uid(),
        completed: Boolean(reminder.completed),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setReminders((prev) => [...prev, normalized]);
      void syncPocketTelegramReminder(normalized);
      return normalized;
    },
    [syncPocketTelegramReminder],
  );

  const updateReminder = useCallback(
    (id, reminder) => {
      const updated = {
        ...reminder,
        id,
        updatedAt: new Date().toISOString(),
      };
      setReminders((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...updated } : item)),
      );
      void syncPocketTelegramReminder(updated);
      return updated;
    },
    [syncPocketTelegramReminder],
  );

  const deleteReminder = useCallback((id) => {
    setReminders((prev) => prev.filter((item) => item.id !== id));
    void fetch("/api/telegram?action=cancel-pocket-reminder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reminderId: id }),
    }).catch((error) => {
      console.error("Pocket Telegram reminder cancellation failed:", error);
    });
    return id;
  }, []);

  const toggleReminderComplete = useCallback((id) => {
    let updated = null;
    setReminders((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        updated = {
          ...item,
          completed: !item.completed,
          updatedAt: new Date().toISOString(),
        };
        return updated;
      }),
    );
    return updated;
  }, []);

  const exportBackup = useCallback(() => {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      data: {
        accounts,
        transactions,
        budgets,
        goals,
        recurring,
        reminders,
        categories,
        passwordVault,
        notesVault,
      },
      preferences: Object.keys(localStorage)
        .filter((key) => key.startsWith("pocket_"))
        .reduce((out, key) => {
          out[key] = localStorage.getItem(key);
          return out;
        }, {}),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pocket-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [
    accounts,
    transactions,
    budgets,
    goals,
    recurring,
    reminders,
    categories,
    passwordVault,
    notesVault,
  ]);

  const restoreBackup = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(String(e.target.result || ""));
        const data = parsed.data || parsed;
        if (
          !data ||
          !Array.isArray(data.accounts) ||
          !Array.isArray(data.transactions)
        )
          throw new Error("invalid");
        setAccounts(data.accounts || []);
        setTransactions(data.transactions || []);
        setBudgets(data.budgets || []);
        setGoals(data.goals || []);
        setRecurring(data.recurring || []);
        setReminders(data.reminders || []);
        setCategories(data.categories || SEED_CATEGORIES);
        setPasswordVault(data.passwordVault || null);
        setNotesVault(data.notesVault || null);
        Object.entries(parsed.preferences || {}).forEach(([key, value]) => {
          if (key.startsWith("pocket_")) setPocketPreference(key, value);
        });
        alert("Pocket backup restored successfully.");
      } catch {
        alert("That file is not a valid Pocket backup.");
      }
    };
    reader.readAsText(file);
  }, []);

  const clearAllData = useCallback(async () => {
    try {
      await saveData({
        accounts: [],
        transactions: [],
        budgets: [],
        goals: [],
        recurring: [],
        reminders: [],
        categories: SEED_CATEGORIES,
        passwordVault: null,
        notesVault: null,
      });
      setAccounts([]);
      setTransactions([]);
      setBudgets([]);
      setGoals([]);
      setRecurring([]);
      setReminders([]);
      setCategories(SEED_CATEGORIES);
      setPasswordVault(null);
      setNotesVault(null);
      alert("All Pocket data was cleared from this browser.");
    } catch {
      alert("Pocket could not clear local data.");
    }
  }, []);

  const exportCSV = useCallback(() => {
    const rows = transactions.map((t) => ({
      date: t.date,
      type: t.type,
      category: t.category,
      account: accounts.find((a) => a.id === t.accountId)?.name || "",
      amount: t.amount,
      note: t.note || "",
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ledger-export-${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [transactions, accounts]);

  const importCSV = useCallback(
    (file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const parsed = Papa.parse(e.target.result, {
          header: true,
          skipEmptyLines: true,
        });
        const rows = parsed.data;
        let accList = [...accounts];
        const findOrCreateAccount = (name) => {
          if (!name) return accList[0]?.id;
          let acc = accList.find(
            (a) => a.name.toLowerCase() === String(name).toLowerCase(),
          );
          if (!acc) {
            acc = {
              id: uid(),
              name: String(name),
              type: "bank",
              opening: 0,
              color: PALETTE[accList.length % PALETTE.length],
            };
            accList = [...accList, acc];
          }
          return acc.id;
        };
        const imported = [];
        rows.forEach((r) => {
          const amount = Number(r.amount);
          const type =
            (r.type || "").toLowerCase() === "income" ? "income" : "expense";
          if (!r.date || !amount || amount <= 0) return;
          imported.push({
            id: uid(),
            type,
            amount,
            category: r.category || "Other",
            accountId: findOrCreateAccount(r.account),
            date: r.date,
            note: r.note || "",
          });
          ensureCategory(type, r.category || "Other");
        });
        if (accList.length !== accounts.length) setAccounts(accList);
        if (imported.length > 0)
          setTransactions((prev) => [...imported, ...prev]);
      };
      reader.readAsText(file);
    },
    [accounts, ensureCategory],
  );

  // Derived
  const accountBalances = useMemo(() => {
    const map = {};
    accounts.forEach((a) => (map[a.id] = a.opening || 0));
    transactions.forEach((t) => {
      if (!(t.accountId in map)) return;
      map[t.accountId] += t.type === "income" ? t.amount : -t.amount;
    });
    return map;
  }, [accounts, transactions]);

  const netWorth = useMemo(
    () => Object.values(accountBalances).reduce((a, b) => a + b, 0),
    [accountBalances],
  );

  const now = new Date();
  const currentMonthKey = monthKey(now);
  const prevMonthKey = monthKey(
    new Date(now.getFullYear(), now.getMonth() - 1, 1),
  );

  const thisMonthTxns = useMemo(
    () => transactions.filter((t) => monthKey(t.date) === currentMonthKey),
    [transactions, currentMonthKey],
  );
  const prevMonthTxns = useMemo(
    () => transactions.filter((t) => monthKey(t.date) === prevMonthKey),
    [transactions, prevMonthKey],
  );

  const monthIncome = useMemo(
    () =>
      thisMonthTxns
        .filter((t) => t.type === "income")
        .reduce((s, t) => s + t.amount, 0),
    [thisMonthTxns],
  );
  const monthExpense = useMemo(
    () =>
      thisMonthTxns
        .filter((t) => t.type === "expense")
        .reduce((s, t) => s + t.amount, 0),
    [thisMonthTxns],
  );
  const prevMonthExpense = useMemo(
    () =>
      prevMonthTxns
        .filter((t) => t.type === "expense")
        .reduce((s, t) => s + t.amount, 0),
    [prevMonthTxns],
  );

  const savingsRate =
    monthIncome > 0
      ? Math.round(((monthIncome - monthExpense) / monthIncome) * 100)
      : null;
  const expenseChangePct =
    prevMonthExpense > 0
      ? Math.round(((monthExpense - prevMonthExpense) / prevMonthExpense) * 100)
      : null;
  const topCategory = useMemo(() => {
    const map = {};
    thisMonthTxns
      .filter((t) => t.type === "expense")
      .forEach((t) => (map[t.category] = (map[t.category] || 0) + t.amount));
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    return entries[0] || null;
  }, [thisMonthTxns]);

  const trendData = useMemo(() => {
    const buckets = {};
    transactions.forEach((t) => {
      const k = monthKey(t.date);
      if (!buckets[k]) buckets[k] = { key: k, income: 0, expense: 0 };
      buckets[k][t.type] += t.amount;
    });
    return Object.values(buckets)
      .sort((a, b) => (a.key > b.key ? 1 : -1))
      .slice(-6)
      .map((b) => ({ ...b, label: monthLabel(b.key) }));
  }, [transactions]);

  const netWorthTrend = useMemo(() => {
    if (trendData.length === 0) return [];
    const openingSum = accounts.reduce((s, a) => s + (a.opening || 0), 0);
    // net worth at the START of the earliest shown month = current net worth minus all net changes in shown months
    const totalNetInShown = trendData.reduce(
      (s, b) => s + (b.income - b.expense),
      0,
    );
    let running = netWorth - totalNetInShown;
    return trendData.map((b) => {
      running += b.income - b.expense;
      return { label: b.label, value: running };
    });
  }, [trendData, netWorth]);

  const categoryBreakdown = useMemo(() => {
    const map = {};
    thisMonthTxns
      .filter((t) => t.type === "expense")
      .forEach((t) => (map[t.category] = (map[t.category] || 0) + t.amount));
    return Object.entries(map)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [thisMonthTxns]);

  const budgetStatus = useMemo(
    () =>
      budgets.map((b) => {
        const spent = thisMonthTxns
          .filter((t) => t.type === "expense" && t.category === b.category)
          .reduce((s, t) => s + t.amount, 0);
        return { ...b, spent, pct: Math.min(100, (spent / b.limit) * 100) };
      }),
    [budgets, thisMonthTxns],
  );

  const accountName = (id) => accounts.find((a) => a.id === id)?.name || "—";

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
      }
      if (e.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isShareRoute =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/share/");

  if (isShareRoute) {
    return <ShareView />;
  }

  if (!loaded) {
    return (
      <div
        style={{
          background: "#14161B",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            color: "#8B8F98",
            fontFamily: "Inter, sans-serif",
            fontSize: 14,
          }}
        >
          Loading ledger…
        </div>
      </div>
    );
  }

  return (
    <div style={styles.app} className="ledger-app">
      <style>{fontImports + settingsCss}</style>
      <Sidebar tab={tab} setTab={setTab} onProfileClick={toggleProfileMenu} />
      <main style={styles.main}>
        <TopBar
          netWorth={netWorth}
          monthIncome={monthIncome}
          monthExpense={monthExpense}
          onSearch={() => setCommandOpen(true)}
          onAddTxn={() => {
            setEditingTxn(null);
            setTxnPrefill(null);
            setShowTxnForm(true);
          }}
          onExport={exportCSV}
          onImportClick={() => fileInputRef.current?.click()}
          onScanClick={() => setShowScanModal(true)}
          onProfileClick={toggleProfileMenu}
          onOpenSettings={openSettings}
          saveError={saveError}
        />
        <ProfileMenu
          open={profileMenuOpen}
          anchor={profileAnchor}
          onClose={() => setProfileMenuOpen(false)}
          onNavigate={(nextTab) => {
            setTab(nextTab);
            setProfileMenuOpen(false);
          }}
          onOpenSettings={() => openSettings("general")}
        />
        {settingsOpen && (
          <GlobalSettingsModal
            initialSection={settingsSection}
            onClose={() => setSettingsOpen(false)}
            categories={categories}
            onCategoriesChange={setCategories}
            onOpenNotesSettings={() => {
              setSettingsOpen(false);
              setTab("notes");
              setNotesSettingsRequest((v) => v + 1);
            }}
            onExportCSV={exportCSV}
            onExportBackup={exportBackup}
            onImportCSV={() => fileInputRef.current?.click()}
            onRestoreBackup={restoreBackup}
            onClearAllData={clearAllData}
          />
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files[0]) importCSV(e.target.files[0]);
            e.target.value = "";
          }}
        />

        {tab === "dashboard" && (
          <Dashboard
            trendData={trendData}
            netWorthTrend={netWorthTrend}
            categoryBreakdown={categoryBreakdown}
            transactions={transactions.slice(0, 6)}
            accountName={accountName}
            savingsRate={savingsRate}
            expenseChangePct={expenseChangePct}
            topCategory={topCategory}
            accounts={accounts}
            balances={accountBalances}
            budgets={budgetStatus}
            goals={goals}
            recurring={recurring}
            reminders={reminders}
            monthIncome={monthIncome}
            monthExpense={monthExpense}
            onAddTxn={() => {
              setEditingTxn(null);
              setTxnPrefill(null);
              setShowTxnForm(true);
            }}
            onViewTransactions={() => setTab("transactions")}
            onOpenAccounts={() => setTab("accounts")}
            onOpenBudgets={() => setTab("budgets")}
            onOpenRecurring={() => setTab("recurring")}
            onOpenGoals={() => setTab("goals")}
            onOpenReminders={() => setTab("reminders")}
            onScanClick={() => setShowScanModal(true)}
            onEdit={(t) => {
              setEditingTxn(t);
              setShowTxnForm(true);
            }}
          />
        )}
        {tab === "transactions" && (
          <TransactionsView
            transactions={transactions}
            accounts={accounts}
            categories={categories}
            onDelete={deleteTransaction}
            onEdit={(t) => {
              setEditingTxn(t);
              setShowTxnForm(true);
            }}
          />
        )}
        {tab === "accounts" && (
          <AccountsView
            accounts={accounts}
            balances={accountBalances}
            onAdd={() => setShowAccountForm(true)}
          />
        )}
        {tab === "budgets" && (
          <BudgetsView
            budgetStatus={budgetStatus}
            onAdd={() => setShowBudgetForm(true)}
            onDelete={deleteBudget}
          />
        )}
        {tab === "goals" && (
          <GoalsView
            goals={goals}
            onAdd={() => setShowGoalForm(true)}
            onContribute={contributeGoal}
            onDelete={deleteGoal}
          />
        )}
        {tab === "reminders" && (
          <RemindersView
            reminders={reminders}
            onCreate={addReminder}
            onUpdate={updateReminder}
            onDelete={deleteReminder}
            onToggleComplete={toggleReminderComplete}
          />
        )}
        {tab === "passwords" && (
          <PasswordsView
            vault={passwordVault}
            onVaultChange={setPasswordVault}
          />
        )}
        {tab === "notes" && (
          <NotesView
            vault={notesVault}
            onVaultChange={setNotesVault}
            openSettingsRequest={notesSettingsRequest}
          />
        )}
        {tab === "recurring" && (
          <RecurringView
            recurring={recurring}
            accountName={accountName}
            onAdd={() => setShowRecurringForm(true)}
            onDelete={deleteRecurring}
          />
        )}
      </main>

      <MobileBottomNav
        tab={tab}
        setTab={setTab}
        onAddTxn={() => {
          setEditingTxn(null);
          setTxnPrefill(null);
          setShowTxnForm(true);
        }}
      />

      {commandOpen && (
        <CommandPalette
          onClose={() => setCommandOpen(false)}
          onNavigate={(next) => {
            setTab(next);
            setCommandOpen(false);
          }}
        />
      )}

      {showTxnForm && (
        <TxnModal
          accounts={accounts}
          categories={categories}
          editingTxn={editingTxn}
          prefill={txnPrefill}
          onClose={() => {
            setShowTxnForm(false);
            setEditingTxn(null);
            setTxnPrefill(null);
          }}
          onSave={(t) => {
            if (editingTxn) updateTransaction(editingTxn.id, t);
            else addTransaction(t);
            setShowTxnForm(false);
            setEditingTxn(null);
            setTxnPrefill(null);
          }}
          onDelete={
            editingTxn
              ? () => {
                  deleteTransaction(editingTxn.id);
                  setShowTxnForm(false);
                  setEditingTxn(null);
                }
              : null
          }
        />
      )}
      {showScanModal && (
        <ScanReceiptModal
          onClose={() => setShowScanModal(false)}
          onExtracted={(result) => {
            setShowScanModal(false);
            setEditingTxn(null);
            setTxnPrefill({
              type: "expense",
              amount: result.amount,
              category: result.category,
              date: result.date,
              note: result.note,
            });
            setShowTxnForm(true);
          }}
        />
      )}

      {showAccountForm && (
        <AccountModal
          onClose={() => setShowAccountForm(false)}
          onSave={(a) => {
            addAccount(a);
            setShowAccountForm(false);
          }}
        />
      )}
      {showBudgetForm && (
        <BudgetModal
          categories={categories.expense}
          onClose={() => setShowBudgetForm(false)}
          onSave={(b) => {
            addBudget(b);
            setShowBudgetForm(false);
          }}
        />
      )}
      {showGoalForm && (
        <GoalModal
          onClose={() => setShowGoalForm(false)}
          onSave={(g) => {
            addGoal(g);
            setShowGoalForm(false);
          }}
        />
      )}
      {showRecurringForm && (
        <RecurringModal
          accounts={accounts}
          categories={categories}
          onClose={() => setShowRecurringForm(false)}
          onSave={(r) => {
            addRecurring(r);
            setShowRecurringForm(false);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Layout ---------- */

function Sidebar({ tab, setTab, onProfileClick }) {
  const primary = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, key: "D" },
    { id: "transactions", label: "Pocket", icon: Wallet, key: "P" },
    { id: "reminders", label: "Reminders", icon: Bell, key: "M" },
    { id: "passwords", label: "Passwords", icon: KeyRound, key: "W" },
    { id: "notes", label: "Notes", icon: NotebookPen, key: "N" },
  ];

  const secondary = [
    { id: "accounts", label: "Accounts", icon: Landmark, key: "A" },
    { id: "budgets", label: "Budgets", icon: Target, key: "B" },
    { id: "goals", label: "Goals", icon: PiggyBank, key: "G" },
    { id: "recurring", label: "Recurring", icon: Repeat, key: "R" },
  ];

  const renderItem = ({ id, label, icon: Icon, key }) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      style={{
        ...styles.navItem,
        background: tab === id ? "#20242B" : "transparent",
        color: tab === id ? "#F4F2EC" : "#8E929B",
        borderLeft: tab === id ? "2px solid #4FE36B" : "2px solid transparent",
      }}
    >
      <Icon size={17} strokeWidth={1.8} />
      <span style={{ flex: 1 }}>{label}</span>
      <kbd style={styles.navKey}>⌘{key}</kbd>
    </button>
  );

  return (
    <aside style={styles.sidebar} className="ledger-sidebar">
      <div style={styles.brand} className="brand">
        <div style={styles.brandMark}>
          <Wallet size={17} strokeWidth={2.2} />
        </div>
        <span style={styles.brandText}>Pocket</span>
      </div>

      <div style={styles.welcomeBlock} className="welcome-block">
        <div style={styles.welcomeSmall}>Welcome back,</div>
        <div style={styles.welcomeName}>Viren</div>
        <div style={styles.welcomeCopy}>
          Stay focused.{" "}
          <span style={{ color: "#4FE36B" }}>Get things done.</span>
        </div>
      </div>

      <div style={styles.navLabel}>MENU</div>
      <nav style={styles.nav} className="ledger-nav">
        {primary.map(renderItem)}
      </nav>

      <div style={styles.navDivider} />
      <div style={styles.navLabel}>MANAGE</div>
      <nav style={styles.nav} className="ledger-nav">
        {secondary.map(renderItem)}
      </nav>

      <div style={styles.sidebarSpacer} />
      <button
        style={styles.profileCard}
        className="desktop-profile-card"
        onClick={onProfileClick}
      >
        <div style={styles.avatar}>V</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={styles.profileName}>
            {getPocketPreference("pocket_profile_name", "Viren Patel")}
          </div>
          <div style={styles.profilePlan}>
            {getPocketPreference("pocket_space_name", "Personal space")}
          </div>
        </div>
        <ChevronRight size={16} color="#777C85" />
      </button>
    </aside>
  );
}

function MobileBottomNav({ tab, setTab, onAddTxn }) {
  const items = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "transactions", label: "Pocket", icon: Wallet },
    { id: "passwords", label: "Passwords", icon: KeyRound },
    { id: "notes", label: "Notes", icon: NotebookPen },
  ];
  return (
    <nav className="mobile-bottom-nav" aria-label="Primary navigation">
      {items.slice(0, 2).map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={tab === id ? "active" : ""}
          onClick={() => setTab(id)}
        >
          <Icon size={22} />
          <span>{label}</span>
        </button>
      ))}
      <button
        className="mobile-bottom-add"
        onClick={onAddTxn}
        aria-label="Add entry"
      >
        <Plus size={28} />
      </button>
      {items.slice(2).map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={tab === id ? "active" : ""}
          onClick={() => setTab(id)}
        >
          <Icon size={22} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function TopBar({
  onSearch,
  onAddTxn,
  onExport,
  onImportClick,
  onScanClick,
  onProfileClick,
  onOpenSettings,
  saveError,
}) {
  return (
    <header style={styles.topBar} className="ledger-topbar">
      <div className="mobile-dashboard-header">
        <div>
          <div className="mobile-greeting">
            Hello,{" "}
            {getPocketPreference("pocket_profile_name", "Viren").split(" ")[0]}{" "}
            <span>👋</span>
          </div>
          <div className="mobile-subtitle">Here's your overview</div>
        </div>
        <button
          className="mobile-avatar-button"
          onClick={onProfileClick}
          aria-label="Open profile"
        >
          V
        </button>
      </div>

      <button
        className="global-search"
        style={styles.globalSearch}
        onClick={onSearch}
        aria-label="Search everything"
      >
        <Search size={18} color="#737883" />
        <span style={{ flex: 1, textAlign: "left" }}>Search anything...</span>
        <kbd style={styles.searchKey}>⌘ K</kbd>
      </button>

      <div style={styles.topActions} className="desktop-top-actions">
        <button
          style={styles.iconTopBtn}
          title="Command center"
          onClick={onSearch}
        >
          <Command size={17} />
        </button>
        <button
          style={styles.iconTopBtn}
          title="Appearance"
          onClick={() => onOpenSettings("appearance")}
        >
          <Sun size={17} />
        </button>
        <button
          style={styles.iconTopBtn}
          title="Notifications"
          onClick={() => onOpenSettings("notifications")}
        >
          <Bell size={17} />
        </button>
        <div style={styles.datePill}>
          <div style={styles.datePillText}>
            {new Date().toLocaleDateString("en-IN", {
              weekday: "long",
              day: "2-digit",
              month: "short",
            })}
          </div>
          <div style={styles.datePillSub}>Personal finance</div>
        </div>
        <button style={styles.primaryBtn} onClick={onAddTxn}>
          <Plus size={15} /> Add entry
        </button>
      </div>

      <div className="mobile-quick-actions">
        <button className="mobile-quick-action">
          <CalendarDays size={23} />
          <span>Today</span>
        </button>
        <button className="mobile-quick-action">
          <LayoutDashboard size={23} />
          <span>Dashboard</span>
        </button>
        <button
          className="mobile-quick-action mobile-add-action"
          onClick={onAddTxn}
        >
          <Plus size={32} />
          <span>Add entry</span>
        </button>
        <button className="mobile-quick-action" onClick={onScanClick}>
          <Camera size={23} />
          <span>Scan</span>
        </button>
        <button className="mobile-quick-action">
          <span style={{ fontSize: 30, lineHeight: 1 }}>•••</span>
          <span>More</span>
        </button>
      </div>

      <div style={styles.utilityRow} className="ledger-utility-row">
        {saveError && (
          <span style={{ fontSize: 11, color: "#D9735C" }}>
            Not saved — storage unavailable
          </span>
        )}
        <button style={styles.secondaryBtn} onClick={onImportClick}>
          <Download size={14} /> Import
        </button>
        <button style={styles.secondaryBtn} onClick={onExport}>
          <Upload size={14} /> Export
        </button>
        <button style={styles.secondaryBtn} onClick={onScanClick}>
          <Camera size={14} /> Scan receipt
        </button>
      </div>
    </header>
  );
}

function ProfileMenu({ open, anchor, onClose, onNavigate, onOpenSettings }) {
  if (!open) return null;

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
  const menuWidth = isMobile
    ? Math.min(344, Math.max(0, window.innerWidth - 20))
    : 344;
  const menuPosition = isMobile
    ? {
        left: anchor
          ? Math.min(
              Math.max(anchor.right - menuWidth, 10),
              Math.max(10, window.innerWidth - menuWidth - 10),
            )
          : undefined,
        top: anchor ? anchor.bottom + 12 : 86,
      }
    : {
        left: anchor ? anchor.right + 12 : 272,
        bottom: anchor ? Math.max(12, window.innerHeight - anchor.bottom) : 22,
      };

  return (
    <>
      <div
        className="profile-menu-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="profile-menu-popover"
        style={menuPosition}
        role="dialog"
        aria-modal="true"
        aria-label="Profile and settings menu"
      >
        <div className="profile-menu-header">
          <div className="profile-menu-avatar">V</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="profile-menu-name">
              {getPocketPreference("pocket_profile_name", "Viren Patel")}
            </div>
            <div className="profile-menu-space">
              {getPocketPreference("pocket_space_name", "Personal space")}
            </div>
          </div>
          <button
            type="button"
            className="profile-menu-icon-close"
            onClick={onClose}
            aria-label="Close profile menu"
          >
            <X size={16} />
          </button>
        </div>

        <div className="profile-menu-divider" />

        <button
          type="button"
          className="profile-menu-item profile-menu-item-rich"
          onClick={onOpenSettings}
        >
          <span className="profile-menu-item-icon">
            <Settings size={18} />
          </span>
          <span className="profile-menu-item-copy">
            <strong>Settings</strong>
            <small>Vault, notifications, retention & preferences</small>
          </span>
          <ChevronRight size={16} />
        </button>

        <div className="profile-menu-divider" />

        <button
          type="button"
          className="profile-menu-item profile-menu-item-rich"
          onClick={() => {
            onClose();
            window.dispatchEvent(new CustomEvent("pocket:open-add-device"));
          }}
        >
          <span className="profile-menu-item-icon">
            <Plus size={18} />
          </span>
          <span className="profile-menu-item-copy">
            <strong>Add new device</strong>
            <small>Register on this device</small>
          </span>
          <ChevronRight size={16} />
        </button>

        <button
          type="button"
          className="profile-menu-item profile-menu-item-rich"
          onClick={() => {
            onClose();
            window.dispatchEvent(new CustomEvent("pocket:open-pair-device"));
          }}
        >
          <span className="profile-menu-item-icon">
            <Link2 size={18} />
          </span>
          <span className="profile-menu-item-copy">
            <strong>Pair a new device</strong>
            <small>Add another phone or computer</small>
          </span>
          <ChevronRight size={16} />
        </button>

        <button
          type="button"
          className="profile-menu-item profile-menu-item-rich"
          onClick={() => {
            onClose();
            window.dispatchEvent(new CustomEvent("pocket:open-devices"));
          }}
        >
          <span className="profile-menu-item-icon">
            <MonitorSmartphone size={18} />
          </span>
          <span className="profile-menu-item-copy">
            <strong>Manage devices</strong>
            <small>View and revoke passkeys</small>
          </span>
          <ChevronRight size={16} />
        </button>

        <div className="profile-menu-divider" />

        <button
          type="button"
          className="profile-menu-item profile-menu-item-rich profile-menu-logout"
          onClick={() => {
            onClose();
            window.dispatchEvent(new CustomEvent("pocket:logout"));
          }}
        >
          <span className="profile-menu-item-icon">
            <LogOut size={18} />
          </span>
          <span className="profile-menu-item-copy">
            <strong>Log out</strong>
            <small>End this session</small>
          </span>
        </button>
      </div>
    </>
  );
}

function CommandPalette({ onClose, onNavigate }) {
  const items = [
    ["dashboard", "Dashboard", LayoutDashboard],
    ["transactions", "Pocket", Wallet],
    ["reminders", "Reminders", Bell],
    ["passwords", "Passwords", KeyRound],
    ["notes", "Notes", NotebookPen],
    ["accounts", "Accounts", Landmark],
    ["budgets", "Budgets", Target],
  ];
  const [query, setQuery] = useState("");
  const filtered = items.filter(([, label]) =>
    label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div style={styles.commandOverlay} onMouseDown={onClose}>
      <div style={styles.commandPanel} onMouseDown={(e) => e.stopPropagation()}>
        <div style={styles.commandSearchRow}>
          <Search size={18} color="#777C85" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Pocket, Passwords & Notes..."
            style={styles.commandInput}
          />
          <kbd style={styles.commandEsc}>ESC</kbd>
        </div>
        <div style={styles.commandLabel}>GO TO</div>
        {filtered.map(([id, label, Icon]) => (
          <button
            key={id}
            style={styles.commandItem}
            onClick={() => onNavigate(id)}
          >
            <span style={styles.commandIcon}>
              <Icon size={17} />
            </span>
            <span style={{ flex: 1 }}>{label}</span>
            <ChevronRight size={15} color="#666B74" />
          </button>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: "24px 12px", color: "#666B74", fontSize: 13 }}>
            Nothing found.
          </div>
        )}
      </div>
    </div>
  );
}

function ModulePlaceholder({ type }) {
  const passwords = type === "passwords";
  return (
    <div style={styles.modulePage} className="modulePage">
      <div style={styles.moduleHero}>
        <div style={styles.moduleIcon}>
          <>{passwords ? <KeyRound size={25} /> : <NotebookPen size={25} />}</>
        </div>
        <div>
          <div style={styles.moduleEyebrow}>
            {passwords ? "SECURE VAULT" : "PERSONAL NOTES"}
          </div>
          <h1 style={styles.moduleTitle}>
            {passwords ? "Passwords" : "Notes"}
          </h1>
          <p style={styles.moduleCopy}>
            {passwords
              ? "Your secure identity space is ready for the next build."
              : "Capture ideas, lists and everything worth remembering."}
          </p>
        </div>
      </div>
      <div style={styles.placeholderGrid}>
        <div style={styles.placeholderCard}>
          <ShieldCheck size={18} />
          <strong>{passwords ? "Vault protected" : "Private by design"}</strong>
          <span>
            {passwords
              ? "Encryption and vault unlock will live here."
              : "Your notes will stay in your personal space."}
          </span>
        </div>
        <div style={styles.placeholderCard}>
          <SearchCheck size={18} />
          <strong>Fast search</strong>
          <span>⌘ K will search across your Pocket workspace.</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Dashboard ---------- */

function Dashboard({
  trendData,
  netWorthTrend,
  categoryBreakdown,
  transactions,
  accountName,
  savingsRate,
  expenseChangePct,
  topCategory,
  accounts,
  balances,
  budgets,
  goals,
  recurring,
  reminders,
  monthIncome,
  monthExpense,
  onAddTxn,
  onViewTransactions,
  onOpenAccounts,
  onOpenBudgets,
  onOpenRecurring,
  onOpenGoals,
  onOpenReminders,
  onScanClick,
  onEdit,
}) {
  const totalBudget = budgets.reduce((s, b) => s + Number(b.limit || 0), 0);
  const totalSpent = budgets.reduce((s, b) => s + Number(b.spent || 0), 0);
  const budgetPct =
    totalBudget > 0
      ? Math.min(100, Math.round((totalSpent / totalBudget) * 100))
      : 0;
  const maxCategory = categoryBreakdown[0]?.amount || 1;

  return (
    <div style={styles.dashboardPage} className="ledger-page">
      <section style={styles.heroGrid} className="hero-grid">
        <div style={styles.netWorthCard}>
          <div style={styles.cardEyebrow}>NET WORTH</div>
          <div style={styles.netWorthValue}>
            {fmtINR(Object.values(balances).reduce((a, b) => a + b, 0))}
          </div>
          <div style={styles.netWorthTrend}>
            <ArrowUpRight size={14} />{" "}
            {savingsRate !== null
              ? `${Math.max(0, savingsRate)}% saved this month`
              : "Start tracking to see your trend"}
          </div>
          <div style={styles.sparkline}>
            {netWorthTrend.length > 1 ? (
              netWorthTrend.map((p, i) => {
                const min = Math.min(...netWorthTrend.map((x) => x.value));
                const max = Math.max(...netWorthTrend.map((x) => x.value));
                const x = (i / (netWorthTrend.length - 1)) * 100;
                const y =
                  max === min ? 45 : 86 - ((p.value - min) / (max - min)) * 65;
                return (
                  <div
                    key={i}
                    style={{ ...styles.sparkDot, left: `${x}%`, top: `${y}%` }}
                  />
                );
              })
            ) : (
              <div style={styles.sparkEmpty}>
                Add more entries to build your trend.
              </div>
            )}
          </div>
        </div>

        <div style={styles.monthCard}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardEyebrow}>THIS MONTH</div>
              <div style={styles.monthTitle}>Cash flow</div>
            </div>
            <CalendarDays size={18} color="#777C85" />
          </div>
          <div style={styles.metricRows}>
            <div>
              <span>Income</span>
              <strong style={{ color: "#4FE36B" }}>
                {fmtINR(monthIncome)}
              </strong>
            </div>
            <div>
              <span>Expenses</span>
              <strong style={{ color: "#FF8067" }}>
                {fmtINR(monthExpense)}
              </strong>
            </div>
            <div>
              <span>Saved</span>
              <strong>{fmtINR(Math.max(0, monthIncome - monthExpense))}</strong>
            </div>
          </div>
        </div>
      </section>

      <section style={styles.widgetGrid} className="widget-grid">
        <div
          style={{ ...styles.widget, gridColumn: "span 2" }}
          className="widget-span-2"
        >
          <div style={styles.widgetHeader}>
            <div>
              <div style={styles.widgetTitle}>Cash flow</div>
              <div style={styles.widgetSub}>
                Income vs expenses · last 6 months
              </div>
            </div>
            <BarChart3 size={18} color="#707580" />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData}>
              <CartesianGrid stroke="#252932" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#777C85"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#777C85"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `₹${Math.round(v / 1000)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: "#171A1F",
                  border: "1px solid #30343D",
                  borderRadius: 10,
                  fontSize: 12,
                }}
                labelStyle={{ color: "#ECEAE3" }}
                formatter={(v, k) => [
                  fmtINR(v),
                  k === "income" ? "Income" : "Expenses",
                ]}
              />
              <Line
                type="monotone"
                dataKey="income"
                stroke="#4FE36B"
                strokeWidth={3}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="expense"
                stroke="#FF8067"
                strokeWidth={3}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <button
          type="button"
          style={{ ...styles.widget, ...styles.dashboardLinkWidget }}
          onClick={onViewTransactions}
          aria-label="Open spending and transactions"
        >
          <div style={styles.widgetHeader}>
            <div>
              <div style={styles.widgetTitle}>Spending</div>
              <div style={styles.widgetSub}>This month by category</div>
            </div>
            <span style={styles.widgetMore}>•••</span>
          </div>
          {categoryBreakdown.length === 0 ? (
            <EmptyRow text="No expenses this month." />
          ) : (
            categoryBreakdown.slice(0, 5).map((x, i) => (
              <div key={x.category} style={styles.categoryRow}>
                <div style={styles.categoryName}>
                  <span
                    style={{
                      ...styles.categoryDot,
                      background: PALETTE[i % PALETTE.length],
                    }}
                  />
                  {x.category}
                </div>
                <div style={styles.categoryBarTrack}>
                  <div
                    style={{
                      ...styles.categoryBar,
                      width: `${Math.max(8, (x.amount / maxCategory) * 100)}%`,
                      background: PALETTE[i % PALETTE.length],
                    }}
                  />
                </div>
                <div style={styles.categoryAmount}>{fmtINR(x.amount)}</div>
              </div>
            ))
          )}
        </button>

        <div
          style={{ ...styles.widget, cursor: "pointer" }}
          role="button"
          tabIndex={0}
          onClick={(e) => {
            if (e.target.closest("button")) return;
            onViewTransactions();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onViewTransactions();
            }
          }}
          aria-label="Open recent transactions"
        >
          <div style={styles.widgetHeader}>
            <div>
              <div style={styles.widgetTitle}>Recent transactions</div>
              <div style={styles.widgetSub}>Your latest activity</div>
            </div>
            <button style={styles.linkBtn} onClick={onViewTransactions}>
              View all
            </button>
          </div>
          {transactions.length === 0 ? (
            <EmptyRow text="No entries yet." />
          ) : (
            transactions.slice(0, 5).map((t) => (
              <LedgerRow
                key={t.id}
                t={t}
                accountLabel={accountName(t.accountId)}
                onEdit={(event) => {
                  event?.stopPropagation?.();
                  onEdit(t);
                }}
              />
            ))
          )}
        </div>

        <button
          type="button"
          style={{ ...styles.widget, ...styles.dashboardLinkWidget }}
          onClick={onOpenBudgets}
          aria-label="Open Budgets"
        >
          <div style={styles.widgetHeader}>
            <div>
              <div style={styles.widgetTitle}>Budget</div>
              <div style={styles.widgetSub}>
                {totalBudget
                  ? `${fmtINR(totalSpent)} of ${fmtINR(totalBudget)}`
                  : "Set a budget to start"}
              </div>
            </div>
            <Target size={18} color="#707580" />
          </div>
          <div style={styles.budgetRingWrap}>
            <div
              style={{
                ...styles.budgetRing,
                background: `conic-gradient(#4FE36B ${budgetPct * 3.6}deg, #292D35 0deg)`,
              }}
            >
              <div style={styles.budgetRingInner}>
                {budgetPct}
                <span style={{ fontSize: 10 }}>%</span>
              </div>
            </div>
            <div>
              <div style={styles.budgetBig}>
                {fmtINR(Math.max(0, totalBudget - totalSpent))}
              </div>
              <div style={styles.widgetSub}>remaining</div>
            </div>
          </div>
          {budgets.slice(0, 3).map((b) => (
            <div key={b.id} style={styles.miniBudget}>
              <span>{b.category}</span>
              <span>{Math.round(b.pct)}%</span>
            </div>
          ))}
        </button>

        <button
          type="button"
          style={{ ...styles.widget, ...styles.dashboardLinkWidget }}
          onClick={onOpenAccounts}
          aria-label="Open Accounts"
        >
          <div style={styles.widgetHeader}>
            <div>
              <div style={styles.widgetTitle}>Accounts</div>
              <div style={styles.widgetSub}>
                {accounts.length} active accounts
              </div>
            </div>
            <Landmark size={18} color="#707580" />
          </div>
          {accounts.slice(0, 4).map((a) => (
            <div key={a.id} style={styles.accountRow}>
              <span
                style={{
                  ...styles.accountDot,
                  background: a.color || PALETTE[0],
                }}
              />
              <span style={{ flex: 1 }}>{a.name}</span>
              <strong>{fmtINR(balances[a.id] || 0)}</strong>
            </div>
          ))}
          {accounts.length === 0 && (
            <EmptyRow text="Add an account to see it here." />
          )}
        </button>

        <button
          type="button"
          style={{ ...styles.widget, ...styles.dashboardLinkWidget }}
          onClick={onOpenGoals}
          aria-label="Open Goals"
        >
          <div style={styles.widgetHeader}>
            <div>
              <div style={styles.widgetTitle}>Goals</div>
              <div style={styles.widgetSub}>Savings progress</div>
            </div>
            <PiggyBank size={18} color="#707580" />
          </div>
          {goals.slice(0, 3).map((g) => {
            const pct =
              g.target > 0
                ? Math.min(100, Math.round((g.saved / g.target) * 100))
                : 0;
            return (
              <div key={g.id} style={styles.goalRow}>
                <div style={styles.goalLine}>
                  <span>{g.name}</span>
                  <span>{pct}%</span>
                </div>
                <div style={styles.progressTrack}>
                  <div
                    style={{
                      ...styles.progressFill,
                      width: `${pct}%`,
                      background: "#7C93C9",
                    }}
                  />
                </div>
                <div style={styles.widgetSub}>
                  {fmtINR(g.saved)} of {fmtINR(g.target)}
                </div>
              </div>
            );
          })}
          {goals.length === 0 && (
            <EmptyRow text="Create your first savings goal." />
          )}
        </button>

        <button
          type="button"
          style={{ ...styles.widget, ...styles.dashboardLinkWidget }}
          onClick={onOpenRecurring}
          aria-label="Open Recurring"
        >
          <div style={styles.widgetHeader}>
            <div>
              <div style={styles.widgetTitle}>Recurring</div>
              <div style={styles.widgetSub}>Upcoming scheduled payments</div>
            </div>
            <Repeat size={18} color="#707580" />
          </div>
          {recurring.slice(0, 4).map((r) => (
            <div key={r.id} style={styles.goalRow}>
              <div style={styles.goalLine}>
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.name}
                </span>
                <span>{fmtINR(Number(r.amount || 0))}</span>
              </div>
              <div style={styles.widgetSub}>
                Next: {r.nextDate || "Not scheduled"}
              </div>
            </div>
          ))}
          {recurring.length === 0 && (
            <EmptyRow text="Add a recurring payment to track it here." />
          )}
        </button>

        <button
          type="button"
          className="dashboard-reminders-card"
          style={{
            ...styles.widget,
            ...styles.dashboardLinkWidget,
            gridColumn: "1 / -1",
          }}
          onClick={onOpenReminders}
          aria-label="Open Reminders"
        >
          <div style={styles.widgetHeader}>
            <div>
              <div style={styles.widgetTitle}>Reminders</div>
              <div style={styles.widgetSub}>
                Upcoming things you do not want to miss
              </div>
            </div>
            <Bell size={18} color="#707580" />
          </div>
          {reminders
            .filter((r) => !r.completed)
            .sort((a, b) =>
              `${a.date}T${a.time || "23:59"}`.localeCompare(
                `${b.date}T${b.time || "23:59"}`,
              ),
            )
            .slice(0, 4)
            .map((r) => (
              <div key={r.id} style={styles.reminderDashboardRow}>
                <span style={styles.reminderDashboardDot} />
                <span style={styles.reminderDashboardTitle}>{r.title}</span>
                <span style={styles.reminderDashboardDate}>
                  {r.date}
                  {r.time ? ` · ${r.time}` : ""}
                </span>
                <ChevronRight size={15} color="#626A75" />
              </div>
            ))}
          {reminders.filter((r) => !r.completed).length === 0 && (
            <EmptyRow text="Create a reminder from the calendar." />
          )}
        </button>
      </section>
    </div>
  );
}

function InsightCard({ label, value, hint, tone }) {
  const color =
    tone === "good" ? "#4FE36B" : tone === "bad" ? "#FF8067" : "#ECEAE3";
  return (
    <div style={{ ...styles.panel, padding: 16 }}>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, fontSize: 22, color, marginTop: 4 }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "#585C66",
          fontFamily: "Inter, sans-serif",
          marginTop: 3,
        }}
      >
        {hint}
      </div>
    </div>
  );
}

/* ---------- Transactions / Ledger ---------- */

function TransactionsView({
  transactions,
  accounts,
  categories,
  onDelete,
  onEdit,
}) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterAccount, setFilterAccount] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");

  const accountName = (id) => accounts.find((a) => a.id === id)?.name || "—";
  const allCategories = [...categories.income, ...categories.expense];

  const filtered = useMemo(
    () =>
      transactions.filter((t) => {
        if (filterType !== "all" && t.type !== filterType) return false;
        if (filterAccount !== "all" && t.accountId !== filterAccount)
          return false;
        if (filterCategory !== "all" && t.category !== filterCategory)
          return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          if (
            !t.category.toLowerCase().includes(q) &&
            !(t.note || "").toLowerCase().includes(q)
          )
            return false;
        }
        return true;
      }),
    [transactions, filterType, filterAccount, filterCategory, search],
  );

  return (
    <div style={{ padding: "0 32px 32px" }} className="ledger-page">
      <div style={styles.panel}>
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          <div style={{ ...styles.searchBox, flex: "1 1 200px" }}>
            <Search size={14} color="#585C66" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search category or note…"
              style={styles.searchInput}
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">All types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
          <select
            value={filterAccount}
            onChange={(e) => setFilterAccount(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">All categories</option>
            {allCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.panelTitle}>
          {filtered.length} of {transactions.length} entries
        </div>
        {filtered.length === 0 && <EmptyRow text="No entries match." />}
        {filtered.map((t) => (
          <LedgerRow
            key={t.id}
            t={t}
            accountLabel={accountName(t.accountId)}
            onDelete={() => onDelete(t.id)}
            onEdit={() => onEdit(t)}
          />
        ))}
      </div>
    </div>
  );
}

function LedgerRow({ t, accountLabel, onDelete, onEdit }) {
  const positive = t.type === "income";
  return (
    <div style={styles.ledgerRow}>
      <div
        style={{ flex: 1, minWidth: 0, cursor: onEdit ? "pointer" : "default" }}
        onClick={(e) => onEdit?.(e)}
      >
        <div style={styles.ledgerCategory}>{t.category}</div>
        <div style={styles.ledgerMeta}>
          {fmtDate(t.date)} · {accountLabel}
          {t.note ? ` · ${t.note}` : ""}
        </div>
      </div>
      <div
        style={{
          ...styles.ledgerAmount,
          color: positive ? "#4FA98C" : "#D9735C",
        }}
      >
        {positive ? "+" : "−"}
        {fmtINR(t.amount)}
      </div>
      {onEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit?.(e);
          }}
          style={styles.iconBtn}
          title="Edit"
        >
          <Pencil size={13} />
        </button>
      )}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(e);
          }}
          style={styles.iconBtn}
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function EmptyRow({ text }) {
  return (
    <div
      style={{
        color: "#585C66",
        fontSize: 13,
        fontFamily: "Inter, sans-serif",
        padding: "16px 0",
      }}
    >
      {text}
    </div>
  );
}

/* ---------- Accounts ---------- */

function AccountsView({ accounts, balances, onAdd }) {
  return (
    <div style={{ padding: "0 32px 32px" }}>
      <div style={styles.panel}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ ...styles.panelTitle, marginTop: 0 }}>Accounts</div>
          <button style={styles.secondaryBtn} onClick={onAdd}>
            <Plus size={14} /> New account
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 14,
            marginTop: 12,
          }}
        >
          {accounts.map((a) => (
            <div key={a.id} style={styles.accountCard}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: a.color,
                  }}
                />
                <span
                  style={{
                    color: "#ECEAE3",
                    fontFamily: "Inter, sans-serif",
                    fontSize: 13,
                  }}
                >
                  {a.name}
                </span>
              </div>
              <div style={{ ...styles.statValue, fontSize: 22, marginTop: 10 }}>
                {fmtINR(balances[a.id] || 0)}
              </div>
              <div
                style={{
                  color: "#585C66",
                  fontSize: 11,
                  fontFamily: "Inter, sans-serif",
                  marginTop: 2,
                  textTransform: "capitalize",
                }}
              >
                {a.type}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Budgets ---------- */

function BudgetsView({ budgetStatus, onAdd, onDelete }) {
  return (
    <div style={{ padding: "0 32px 32px" }}>
      <div style={styles.panel}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ ...styles.panelTitle, marginTop: 0 }}>
            Monthly budgets
          </div>
          <button style={styles.secondaryBtn} onClick={onAdd}>
            <Plus size={14} /> New budget
          </button>
        </div>
        {budgetStatus.length === 0 && (
          <EmptyRow text="No budgets set. Add a category limit to track it." />
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            marginTop: 8,
          }}
        >
          {budgetStatus.map((b) => (
            <div key={b.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontFamily: "Inter, sans-serif",
                  fontSize: 13,
                  marginBottom: 6,
                  gap: 10,
                }}
              >
                <span style={{ color: "#ECEAE3" }}>{b.category}</span>
                <span
                  style={{
                    color: b.pct >= 100 ? "#D9735C" : "#8B8F98",
                    flex: 1,
                    textAlign: "right",
                  }}
                >
                  {fmtINR(b.spent)} / {fmtINR(b.limit)}
                </span>
                <button onClick={() => onDelete(b.id)} style={styles.iconBtn}>
                  <X size={13} />
                </button>
              </div>
              <div style={styles.progressTrack}>
                <div
                  style={{
                    ...styles.progressFill,
                    width: `${b.pct}%`,
                    background:
                      b.pct >= 100
                        ? "#D9735C"
                        : b.pct > 75
                          ? "#C9A455"
                          : "#4FA98C",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Goals ---------- */

function GoalsView({ goals, onAdd, onContribute, onDelete }) {
  return (
    <div style={{ padding: "0 32px 32px" }}>
      <div style={styles.panel}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ ...styles.panelTitle, marginTop: 0 }}>
            Savings goals
          </div>
          <button style={styles.secondaryBtn} onClick={onAdd}>
            <Plus size={14} /> New goal
          </button>
        </div>
        {goals.length === 0 && (
          <EmptyRow text="No goals yet. Set a target to save toward." />
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 14,
            marginTop: 12,
          }}
        >
          {goals.map((g) => {
            const pct = Math.min(100, (g.saved / g.target) * 100);
            return (
              <div key={g.id} style={styles.accountCard}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      color: "#ECEAE3",
                      fontFamily: "Inter, sans-serif",
                      fontSize: 13,
                    }}
                  >
                    {g.name}
                  </span>
                  <button onClick={() => onDelete(g.id)} style={styles.iconBtn}>
                    <X size={13} />
                  </button>
                </div>
                <div
                  style={{ ...styles.statValue, fontSize: 18, marginTop: 8 }}
                >
                  {fmtINR(g.saved)}{" "}
                  <span style={{ color: "#585C66", fontSize: 12 }}>
                    / {fmtINR(g.target)}
                  </span>
                </div>
                {g.targetDate && (
                  <div
                    style={{
                      color: "#585C66",
                      fontSize: 11,
                      fontFamily: "Inter, sans-serif",
                      marginTop: 2,
                    }}
                  >
                    by {fmtDate(g.targetDate)}
                  </div>
                )}
                <div style={{ ...styles.progressTrack, marginTop: 10 }}>
                  <div
                    style={{
                      ...styles.progressFill,
                      width: `${pct}%`,
                      background: "#4FA98C",
                    }}
                  />
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button
                    style={styles.chipBtn}
                    onClick={() => onContribute(g.id, 500)}
                  >
                    +₹500
                  </button>
                  <button
                    style={styles.chipBtn}
                    onClick={() => onContribute(g.id, 1000)}
                  >
                    +₹1,000
                  </button>
                  <button
                    style={styles.chipBtn}
                    onClick={() => onContribute(g.id, 5000)}
                  >
                    +₹5,000
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- Recurring ---------- */

function RecurringView({ recurring, accountName, onAdd, onDelete }) {
  return (
    <div style={{ padding: "0 32px 32px" }}>
      <div style={styles.panel}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ ...styles.panelTitle, marginTop: 0 }}>
            Recurring entries
          </div>
          <button style={styles.secondaryBtn} onClick={onAdd}>
            <Plus size={14} /> New recurring
          </button>
        </div>
        <div
          style={{
            fontSize: 11,
            color: "#585C66",
            fontFamily: "Inter, sans-serif",
            marginTop: -6,
            marginBottom: 12,
          }}
        >
          Logged automatically to the ledger on or after their due date, each
          time you open the app.
        </div>
        {recurring.length === 0 && (
          <EmptyRow text="No recurring bills or income set up." />
        )}
        {recurring.map((r) => (
          <div key={r.id} style={styles.ledgerRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.ledgerCategory}>
                {r.label} · {r.category}
              </div>
              <div style={styles.ledgerMeta}>
                {r.frequency} · next {fmtDate(r.nextDate)} ·{" "}
                {accountName(r.accountId)}
              </div>
            </div>
            <div
              style={{
                ...styles.ledgerAmount,
                color: r.type === "income" ? "#4FA98C" : "#D9735C",
              }}
            >
              {r.type === "income" ? "+" : "−"}
              {fmtINR(r.amount)}
            </div>
            <button onClick={() => onDelete(r.id)} style={styles.iconBtn}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Modals ---------- */

function ModalShell({ title, onClose, children }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 16,
              color: "#ECEAE3",
            }}
          >
            {title}
          </div>
          <button onClick={onClose} style={styles.iconBtn}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TxnModal({
  accounts,
  categories,
  editingTxn,
  prefill,
  onClose,
  onSave,
  onDelete,
}) {
  const seed = editingTxn || prefill;
  const [type, setType] = useState(seed?.type || "expense");
  const [amount, setAmount] = useState(seed ? String(seed.amount) : "");
  const [category, setCategory] = useState(
    seed?.category || categories.expense[0],
  );
  const [isAddingCategory, setIsAddingCategory] = useState(
    !!(
      seed?.category &&
      !categories[seed?.type || "expense"].includes(seed.category)
    ),
  );
  const [accountId, setAccountId] = useState(
    seed?.accountId || accounts[0]?.id || "",
  );
  const availableAccounts = accounts.filter((a) =>
    type === "income" ? a.type !== "card" : true,
  );
  const [date, setDate] = useState(seed?.date || todayStr());
  const [note, setNote] = useState(seed?.note || "");

  const cats = categories[type];

  return (
    <ModalShell
      title={
        editingTxn
          ? "Edit entry"
          : prefill
            ? "Confirm scanned entry"
            : "New ledger entry"
      }
      onClose={onClose}
    >
      {prefill && !editingTxn && (
        <div style={styles.scanBanner}>
          Extracted from your receipt photo — check the details before saving.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {["expense", "income"].map((tp) => (
          <button
            key={tp}
            onClick={() => {
              setType(tp);
              if (!categories[tp].includes(category)) {
                setCategory(categories[tp][0]);
                setIsAddingCategory(false);
              }
              const stillValid = accounts.filter((a) =>
                tp === "income" ? a.type !== "card" : true,
              );
              if (!stillValid.some((a) => a.id === accountId))
                setAccountId(stillValid[0]?.id || "");
            }}
            style={{
              ...styles.toggleBtn,
              background:
                type === tp
                  ? tp === "income"
                    ? "#1E2E28"
                    : "#2E211E"
                  : "#1C1F26",
              color:
                type === tp
                  ? tp === "income"
                    ? "#4FA98C"
                    : "#D9735C"
                  : "#8B8F98",
              borderColor:
                type === tp
                  ? tp === "income"
                    ? "#4FA98C"
                    : "#D9735C"
                  : "#2A2E37",
            }}
          >
            {tp === "income" ? "Income" : "Expense"}
          </button>
        ))}
      </div>

      <Field label="Amount (₹)">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={styles.input}
          placeholder="0"
          autoFocus
        />
      </Field>
      <Field label="Category">
        {isAddingCategory ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={styles.input}
              placeholder="New category name"
              autoFocus
            />
            <button
              type="button"
              onClick={() => {
                setIsAddingCategory(false);
                setCategory(cats[0]);
              }}
              style={styles.iconOnlyBtn}
              title="Cancel"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <select
            value={category}
            onChange={(e) => {
              if (e.target.value === "__new__") {
                setIsAddingCategory(true);
                setCategory("");
              } else setCategory(e.target.value);
            }}
            style={styles.input}
          >
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="__new__">+ Add new category…</option>
          </select>
        )}
      </Field>
      <Field label="Account">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          style={styles.input}
        >
          {availableAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Date">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={styles.input}
        />
      </Field>
      <Field label="Note (optional)">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={styles.input}
          placeholder="e.g. groceries at DMart"
        />
      </Field>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {onDelete && (
          <button
            style={{
              ...styles.secondaryBtn,
              borderColor: "#3A2321",
              color: "#D9735C",
            }}
            onClick={onDelete}
          >
            <Trash2 size={14} /> Delete
          </button>
        )}
        <button
          style={{ ...styles.primaryBtn, flex: 1, justifyContent: "center" }}
          disabled={
            !amount || Number(amount) <= 0 || !accountId || !category.trim()
          }
          onClick={() =>
            onSave({
              type,
              amount: Number(amount),
              category: category.trim(),
              accountId,
              date,
              note: note.trim(),
            })
          }
        >
          {editingTxn ? "Save changes" : "Save entry"}
        </button>
      </div>
    </ModalShell>
  );
}

function AccountModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [accType, setAccType] = useState("bank");
  const [opening, setOpening] = useState("");
  return (
    <ModalShell title="New account" onClose={onClose}>
      <Field label="Account name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={styles.input}
          placeholder="e.g. HDFC Savings"
          autoFocus
        />
      </Field>
      <Field label="Type">
        <select
          value={accType}
          onChange={(e) => setAccType(e.target.value)}
          style={styles.input}
        >
          <option value="cash">Cash</option>
          <option value="bank">Bank</option>
          <option value="card">Card</option>
          <option value="wallet">Wallet</option>
        </select>
      </Field>
      <Field label="Opening balance (₹)">
        <input
          type="number"
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          style={styles.input}
          placeholder="0"
        />
      </Field>
      <button
        style={{
          ...styles.primaryBtn,
          width: "100%",
          justifyContent: "center",
          marginTop: 10,
        }}
        disabled={!name.trim()}
        onClick={() =>
          onSave({
            name: name.trim(),
            type: accType,
            opening: Number(opening) || 0,
          })
        }
      >
        Add account
      </button>
    </ModalShell>
  );
}

function BudgetModal({ categories, onClose, onSave }) {
  const [category, setCategory] = useState(categories[0]);
  const [limit, setLimit] = useState("");
  return (
    <ModalShell title="New budget" onClose={onClose}>
      <Field label="Category">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={styles.input}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Monthly limit (₹)">
        <input
          type="number"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          style={styles.input}
          placeholder="0"
          autoFocus
        />
      </Field>
      <button
        style={{
          ...styles.primaryBtn,
          width: "100%",
          justifyContent: "center",
          marginTop: 10,
        }}
        disabled={!limit || Number(limit) <= 0}
        onClick={() => onSave({ category, limit: Number(limit) })}
      >
        Set budget
      </button>
    </ModalShell>
  );
}

function GoalModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  return (
    <ModalShell title="New savings goal" onClose={onClose}>
      <Field label="Goal name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={styles.input}
          placeholder="e.g. Emergency fund"
          autoFocus
        />
      </Field>
      <Field label="Target amount (₹)">
        <input
          type="number"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          style={styles.input}
          placeholder="0"
        />
      </Field>
      <Field label="Target date (optional)">
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          style={styles.input}
        />
      </Field>
      <button
        style={{
          ...styles.primaryBtn,
          width: "100%",
          justifyContent: "center",
          marginTop: 10,
        }}
        disabled={!name.trim() || !target || Number(target) <= 0}
        onClick={() =>
          onSave({
            name: name.trim(),
            target: Number(target),
            saved: 0,
            targetDate,
          })
        }
      >
        Create goal
      </button>
    </ModalShell>
  );
}

function RecurringModal({ accounts, categories, onClose, onSave }) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(categories.expense[0]);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const availableAccounts = accounts.filter((a) =>
    type === "income" ? a.type !== "card" : true,
  );
  const [frequency, setFrequency] = useState("monthly");
  const [nextDate, setNextDate] = useState(todayStr());
  const cats = categories[type];

  return (
    <ModalShell title="New recurring entry" onClose={onClose}>
      <Field label="Label">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={styles.input}
          placeholder="e.g. Netflix, Rent, Salary"
          autoFocus
        />
      </Field>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {["expense", "income"].map((tp) => (
          <button
            key={tp}
            onClick={() => {
              setType(tp);
              if (!categories[tp].includes(category)) {
                setCategory(categories[tp][0]);
                setIsAddingCategory(false);
              }
              const stillValid = accounts.filter((a) =>
                tp === "income" ? a.type !== "card" : true,
              );
              if (!stillValid.some((a) => a.id === accountId))
                setAccountId(stillValid[0]?.id || "");
            }}
            style={{
              ...styles.toggleBtn,
              background:
                type === tp
                  ? tp === "income"
                    ? "#1E2E28"
                    : "#2E211E"
                  : "#1C1F26",
              color:
                type === tp
                  ? tp === "income"
                    ? "#4FA98C"
                    : "#D9735C"
                  : "#8B8F98",
              borderColor:
                type === tp
                  ? tp === "income"
                    ? "#4FA98C"
                    : "#D9735C"
                  : "#2A2E37",
            }}
          >
            {tp === "income" ? "Income" : "Expense"}
          </button>
        ))}
      </div>
      <Field label="Amount (₹)">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={styles.input}
          placeholder="0"
        />
      </Field>
      <Field label="Category">
        {isAddingCategory ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={styles.input}
              placeholder="New category name"
              autoFocus
            />
            <button
              type="button"
              onClick={() => {
                setIsAddingCategory(false);
                setCategory(cats[0]);
              }}
              style={styles.iconOnlyBtn}
              title="Cancel"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <select
            value={category}
            onChange={(e) => {
              if (e.target.value === "__new__") {
                setIsAddingCategory(true);
                setCategory("");
              } else setCategory(e.target.value);
            }}
            style={styles.input}
          >
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="__new__">+ Add new category…</option>
          </select>
        )}
      </Field>
      <Field label="Account">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          style={styles.input}
        >
          {availableAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Frequency">
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          style={styles.input}
        >
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </Field>
      <Field label="Next due date">
        <input
          type="date"
          value={nextDate}
          onChange={(e) => setNextDate(e.target.value)}
          style={styles.input}
        />
      </Field>
      <button
        style={{
          ...styles.primaryBtn,
          width: "100%",
          justifyContent: "center",
          marginTop: 10,
        }}
        disabled={!label.trim() || !amount || Number(amount) <= 0 || !accountId}
        onClick={() =>
          onSave({
            label: label.trim(),
            type,
            amount: Number(amount),
            category: category.trim(),
            accountId,
            frequency,
            nextDate,
          })
        }
      >
        Save recurring entry
      </button>
    </ModalShell>
  );
}

function ScanReceiptModal({ onClose, onExtracted, onOpenSettings }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    setError(null);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const handleExtract = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const result = await scanReceipt(file);
      onExtracted(result);
    } catch (e) {
      const msg = e.message || "";
      if (msg === "SERVER_NOT_CONFIGURED") {
        setError(
          "The server isn't set up with an API key yet — add ANTHROPIC_API_KEY in your Vercel project's environment variables.",
        );
      } else if (msg === "NO_AMOUNT_FOUND") {
        setError(
          "Couldn't find a clear total on that receipt. Try a clearer photo, or enter it manually.",
        );
      } else {
        setError("Something went wrong reading that receipt. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell title="Scan a receipt" onClose={onClose}>
      {!previewUrl ? (
        <label style={styles.dropZone}>
          <Camera size={22} color="#585C66" />
          <span
            style={{
              fontSize: 12,
              color: "#8B8F98",
              marginTop: 8,
              fontFamily: "Inter, sans-serif",
            }}
          >
            Tap to take a photo or choose an image
          </span>
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </label>
      ) : (
        <div>
          <img
            src={previewUrl}
            alt="Receipt preview"
            style={styles.previewImg}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              style={styles.secondaryBtn}
              onClick={() => {
                setFile(null);
                setPreviewUrl(null);
                setError(null);
              }}
            >
              Choose different photo
            </button>
            <button
              style={{
                ...styles.primaryBtn,
                flex: 1,
                justifyContent: "center",
              }}
              disabled={loading}
              onClick={handleExtract}
            >
              {loading ? <Loader2 size={15} className="spin" /> : null}
              {loading ? "Reading receipt…" : "Extract expense"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            color: "#D9735C",
            fontSize: 12,
            fontFamily: "Inter, sans-serif",
            marginTop: 12,
          }}
        >
          {error}
        </div>
      )}
    </ModalShell>
  );
}

function GlobalSettingsModal({
  initialSection = "general",
  onClose,
  categories,
  onCategoriesChange,
  onOpenNotesSettings,
  onExportCSV,
  onExportBackup,
  onImportCSV,
  onRestoreBackup,
  onClearAllData,
}) {
  const [section, setSection] = useState(
    initialSection === "appearance" ? "appearance" : initialSection,
  );
  const [name, setName] = useState(() =>
    getPocketPreference("pocket_profile_name", "Viren Patel"),
  );
  const [space, setSpace] = useState(() =>
    getPocketPreference("pocket_space_name", "Personal space"),
  );
  const [theme, setTheme] = useState(() =>
    getPocketPreference("pocket_theme", "dark"),
  );
  const [motion, setMotion] = useState(() =>
    getPocketBool("pocket_motion", true),
  );
  const [currency, setCurrency] = useState(() =>
    getPocketPreference("pocket_currency", "INR"),
  );
  const [dateFormat, setDateFormat] = useState(() =>
    getPocketPreference("pocket_date_format", "DD MMM YYYY"),
  );
  const [startPage, setStartPage] = useState(() =>
    getPocketPreference("pocket_start_page", "dashboard"),
  );
  const [weekStart, setWeekStart] = useState(() =>
    getPocketPreference("pocket_week_start", "monday"),
  );
  const [scanKey, setScanKey] = useState(() =>
    getPocketPreference("pocket_scan_api_key", ""),
  );
  const [saved, setSaved] = useState(false);
  const [browserNotifications, setBrowserNotifications] = useState(() =>
    getPocketBool("pocket_notify_browser", false),
  );
  const [transactionReminders, setTransactionReminders] = useState(() =>
    getPocketBool("pocket_notify_recurring", true),
  );
  const [budgetAlerts, setBudgetAlerts] = useState(() =>
    getPocketBool("pocket_notify_budget", true),
  );
  const [weeklySummary, setWeeklySummary] = useState(() =>
    getPocketBool("pocket_notify_weekly", false),
  );
  const [expenseInput, setExpenseInput] = useState("");
  const [incomeInput, setIncomeInput] = useState("");
  const [danger, setDanger] = useState(false);
  const [message, setMessage] = useState("");
  const [mobileSectionOpen, setMobileSectionOpen] = useState(false);
  useEffect(() => {
    setSection(initialSection === "appearance" ? "appearance" : initialSection);
    setMobileSectionOpen(false);
  }, [initialSection]);
  const sections = [
    ["general", "General", Settings],
    ["appearance", "Appearance", Palette],
    ["finance", "Finance", Wallet],
    ["categories", "Categories", Tags],
    ["security", "Security", ShieldCheck],
    ["notifications", "Notifications", Bell],
    ["devices", "Devices", MonitorSmartphone],
    ["data", "Data & Privacy", Database],
    ["advanced", "Advanced", SlidersHorizontal],
  ];
  const save = (key, value) => {
    setPocketPreference(key, value);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 900);
  };
  const toggle = (key, next, setter) => {
    setter(next);
    save(key, next ? "1" : "0");
  };
  const askNotifications = async (next) => {
    if (!next)
      return toggle("pocket_notify_browser", false, setBrowserNotifications);
    if (!("Notification" in window))
      return setMessage("Browser notifications are not supported here.");
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      toggle("pocket_notify_browser", true, setBrowserNotifications);
      setMessage("Browser notifications enabled.");
    } else setMessage("Notification permission was not granted.");
  };
  const addCat = (type) => {
    const text = (type === "expense" ? expenseInput : incomeInput).trim();
    if (!text) return;
    if (categories[type].some((c) => c.toLowerCase() === text.toLowerCase()))
      return setMessage("That category already exists.");
    onCategoriesChange({ ...categories, [type]: [...categories[type], text] });
    type === "expense" ? setExpenseInput("") : setIncomeInput("");
  };
  const removeCat = (type, item) => {
    const next = categories[type].filter((c) => c !== item);
    if (!next.length)
      return setMessage("Keep at least one category in each group.");
    onCategoriesChange({ ...categories, [type]: next });
  };
  const title = sections.find(([id]) => id === section)?.[1] || "Settings";
  const titleIcon = sections.find(([id]) => id === section)?.[2] || Settings;
  const MobileSectionIcon = titleIcon;
  return (
    <div
      className="global-settings-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Pocket settings"
    >
      <div className="global-settings-shell">
        <aside className="global-settings-sidebar">
          <div className="global-settings-brand">Pocket settings</div>
          {sections.map(([id, label, Icon]) => (
            <button
              key={id}
              className={`global-settings-nav ${section === id ? "active" : ""}`}
              onClick={() => setSection(id)}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
          <div className="mobile-settings-picker">
            <button
              type="button"
              className={`mobile-settings-picker-button ${mobileSectionOpen ? "open" : ""}`}
              onClick={() => setMobileSectionOpen((v) => !v)}
              aria-expanded={mobileSectionOpen}
              aria-haspopup="listbox"
            >
              <span className="mobile-settings-picker-icon">
                <MobileSectionIcon size={18} />
              </span>
              <span className="mobile-settings-picker-copy">
                <strong>{title}</strong>
                <small>Settings section</small>
              </span>
              <ChevronRight
                size={17}
                className="mobile-settings-picker-chevron"
              />
            </button>
            {mobileSectionOpen && (
              <div
                className="mobile-settings-picker-menu"
                role="listbox"
                aria-label="Settings sections"
              >
                {sections.map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    role="option"
                    aria-selected={section === id}
                    className={`mobile-settings-picker-option ${section === id ? "active" : ""}`}
                    onClick={() => {
                      setSection(id);
                      setMobileSectionOpen(false);
                    }}
                  >
                    <span className="mobile-settings-picker-option-icon">
                      <Icon size={17} />
                    </span>
                    <span>{label}</span>
                    {section === id && (
                      <span className="mobile-settings-picker-check">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
        <section className="global-settings-content">
          <div className="global-settings-header">
            <div>
              <div className="global-settings-eyebrow">PERSONAL SPACE</div>
              <h2>{title}</h2>
            </div>
            <button className="global-settings-close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <div key={section} className="global-settings-section">
            {saved && <div className="settings-saved-pill">Saved</div>}
            {message && (
              <div className="settings-status-banner">
                {message}
                <button onClick={() => setMessage("")}>×</button>
              </div>
            )}
            {section === "general" && (
              <>
                <SettingsRow
                  title="Profile name"
                  description="Change the name shown across Pocket."
                >
                  <input
                    className="settings-control settings-text-control"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() =>
                      save("pocket_profile_name", name.trim() || "Viren Patel")
                    }
                  />
                </SettingsRow>
                <SettingsRow
                  title="Space name"
                  description="Rename this personal Pocket space."
                >
                  <input
                    className="settings-control settings-text-control"
                    value={space}
                    onChange={(e) => setSpace(e.target.value)}
                    onBlur={() =>
                      save(
                        "pocket_space_name",
                        space.trim() || "Personal space",
                      )
                    }
                  />
                </SettingsRow>
                <SettingsRow
                  title="First screen"
                  description="Choose what Pocket opens to after a refresh."
                >
                  <select
                    className="settings-control"
                    value={startPage}
                    onChange={(e) => {
                      setStartPage(e.target.value);
                      save("pocket_start_page", e.target.value);
                    }}
                  >
                    <option value="dashboard">Dashboard</option>
                    <option value="transactions">Pocket</option>
                    <option value="accounts">Accounts</option>
                    <option value="budgets">Budgets</option>
                    <option value="goals">Goals</option>
                    <option value="recurring">Recurring</option>
                    <option value="reminders">Reminders</option>
                    <option value="passwords">Passwords</option>
                    <option value="notes">Notes</option>
                  </select>
                </SettingsRow>
                <SettingsRow
                  title="Week starts on"
                  description="Controls calendar-oriented planning preferences."
                >
                  <select
                    className="settings-control"
                    value={weekStart}
                    onChange={(e) => {
                      setWeekStart(e.target.value);
                      save("pocket_week_start", e.target.value);
                    }}
                  >
                    <option value="monday">Monday</option>
                    <option value="sunday">Sunday</option>
                  </select>
                </SettingsRow>
              </>
            )}
            {section === "appearance" && (
              <>
                <SettingsRow
                  title="Theme"
                  description="Choose how Pocket should look."
                >
                  <ThemePicker
                    value={theme}
                    onChange={(next) => {
                      setTheme(next);
                      save("pocket_theme", next);
                    }}
                  />
                </SettingsRow>
                <SettingsRow
                  title="Motion"
                  description="Enable or disable Pocket animations."
                >
                  <SettingsToggle
                    checked={motion}
                    onChange={(next) =>
                      toggle("pocket_motion", next, setMotion)
                    }
                  />
                </SettingsRow>
              </>
            )}
            {section === "finance" && (
              <>
                <SettingsRow
                  title="Currency"
                  description="Used for balances, budgets, goals and transaction amounts."
                >
                  <select
                    className="settings-control"
                    value={currency}
                    onChange={(e) => {
                      setCurrency(e.target.value);
                      save("pocket_currency", e.target.value);
                    }}
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </SettingsRow>
                <SettingsRow
                  title="Date format"
                  description="How Pocket displays dates."
                >
                  <select
                    className="settings-control"
                    value={dateFormat}
                    onChange={(e) => {
                      setDateFormat(e.target.value);
                      save("pocket_date_format", e.target.value);
                    }}
                  >
                    <option>DD MMM YYYY</option>
                    <option>DD/MM/YYYY</option>
                    <option>MMM DD, YYYY</option>
                    <option>YYYY-MM-DD</option>
                  </select>
                </SettingsRow>
                <SettingsRow
                  title="CSV data"
                  description="Import or export transactions for spreadsheets."
                >
                  <div className="settings-button-row">
                    <button
                      className="settings-action-button"
                      onClick={onImportCSV}
                    >
                      Import CSV
                    </button>
                    <button
                      className="settings-action-button"
                      onClick={onExportCSV}
                    >
                      Export CSV
                    </button>
                  </div>
                </SettingsRow>
              </>
            )}
            {section === "categories" && (
              <>
                <CategorySettingsGroup
                  title="Expense categories"
                  items={categories.expense}
                  value={expenseInput}
                  onChange={setExpenseInput}
                  onAdd={() => addCat("expense")}
                  onRemove={(item) => removeCat("expense", item)}
                />
                <CategorySettingsGroup
                  title="Income categories"
                  items={categories.income}
                  value={incomeInput}
                  onChange={setIncomeInput}
                  onAdd={() => addCat("income")}
                  onRemove={(item) => removeCat("income", item)}
                />
              </>
            )}
            {section === "security" && (
              <>
                <SettingsRow
                  title="Vault protection"
                  description="Private notes and passwords continue to use their own vault protection."
                  value="Enabled"
                />
                <SettingsRow
                  title="Notes security"
                  description="Open Notes security for password, passkey recovery, retention and auto-lock controls."
                >
                  <button
                    className="settings-action-button"
                    onClick={onOpenNotesSettings}
                  >
                    Open Notes security
                  </button>
                </SettingsRow>
                <SettingsRow
                  title="Receipt scanning API key"
                  description="Stored locally on this device for receipt scanning."
                >
                  <div className="settings-key-row">
                    <input
                      type="password"
                      value={scanKey}
                      onChange={(e) => setScanKey(e.target.value)}
                      placeholder="Optional API key"
                    />
                    <button
                      onClick={() => save("pocket_scan_api_key", scanKey)}
                    >
                      Save
                    </button>
                  </div>
                </SettingsRow>
              </>
            )}
            {section === "notifications" && (
              <>
                <SettingsRow
                  title="Browser notifications"
                  description="Request permission from this browser."
                >
                  <SettingsToggle
                    checked={browserNotifications}
                    onChange={askNotifications}
                  />
                </SettingsRow>
                <SettingsRow
                  title="Transaction reminders"
                  description="Preference for recurring or scheduled entry reminders."
                >
                  <SettingsToggle
                    checked={transactionReminders}
                    onChange={(next) =>
                      toggle(
                        "pocket_notify_recurring",
                        next,
                        setTransactionReminders,
                      )
                    }
                  />
                </SettingsRow>
                <SettingsRow
                  title="Budget alerts"
                  description="Preference for budget threshold alerts."
                >
                  <SettingsToggle
                    checked={budgetAlerts}
                    onChange={(next) =>
                      toggle("pocket_notify_budget", next, setBudgetAlerts)
                    }
                  />
                </SettingsRow>
                <SettingsRow
                  title="Weekly summary"
                  description="Preference for a weekly spending summary."
                >
                  <SettingsToggle
                    checked={weeklySummary}
                    onChange={(next) =>
                      toggle("pocket_notify_weekly", next, setWeeklySummary)
                    }
                  />
                </SettingsRow>
              </>
            )}
            {section === "devices" && (
              <>
                <SettingsRow
                  title="This device"
                  description="Current Pocket session in this browser."
                  value="Active"
                />
                <SettingsRow
                  title="Add new device"
                  description="Register another device."
                >
                  <button
                    className="settings-action-button"
                    onClick={() => {
                      onClose();
                      window.dispatchEvent(
                        new CustomEvent("pocket:open-add-device"),
                      );
                    }}
                  >
                    Add device
                  </button>
                </SettingsRow>
                <SettingsRow
                  title="Pair a new device"
                  description="Pair another phone or computer."
                >
                  <button
                    className="settings-action-button"
                    onClick={() => {
                      onClose();
                      window.dispatchEvent(
                        new CustomEvent("pocket:open-pair-device"),
                      );
                    }}
                  >
                    Pair device
                  </button>
                </SettingsRow>
                <SettingsRow
                  title="Manage devices"
                  description="View and revoke devices and passkeys."
                >
                  <button
                    className="settings-action-button"
                    onClick={() => {
                      onClose();
                      window.dispatchEvent(
                        new CustomEvent("pocket:open-devices"),
                      );
                    }}
                  >
                    Manage devices
                  </button>
                </SettingsRow>
              </>
            )}
            {section === "data" && (
              <>
                <SettingsRow
                  title="Pocket backup"
                  description="Download a JSON backup of local ledger data and Pocket preferences."
                >
                  <button
                    className="settings-action-button"
                    onClick={onExportBackup}
                  >
                    Download backup
                  </button>
                </SettingsRow>
                <SettingsRow
                  title="Restore backup"
                  description="Replace current local data with a Pocket JSON backup."
                >
                  <input
                    className="settings-file-input"
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => {
                      if (e.target.files[0]) onRestoreBackup(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                </SettingsRow>
                <SettingsRow
                  title="Clear all data"
                  description="Delete the local Pocket dataset. Keep a backup first."
                >
                  {!danger ? (
                    <button
                      className="settings-danger-button"
                      onClick={() => setDanger(true)}
                    >
                      Clear local data
                    </button>
                  ) : (
                    <div className="settings-button-row">
                      <button
                        className="settings-danger-button"
                        onClick={async () => {
                          await onClearAllData();
                          setDanger(false);
                        }}
                      >
                        Confirm clear
                      </button>
                      <button
                        className="settings-action-button"
                        onClick={() => setDanger(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </SettingsRow>
              </>
            )}
            {section === "advanced" && (
              <>
                <SettingsRow
                  title="Storage"
                  description="Pocket keeps this dataset in the browser's local app storage."
                  value="Local-first"
                />
                <SettingsRow
                  title="Reset preferences"
                  description="Reset settings without deleting your ledger data."
                >
                  <button
                    className="settings-action-button"
                    onClick={() => {
                      Object.keys(localStorage)
                        .filter((k) => k.startsWith("pocket_"))
                        .forEach((k) => localStorage.removeItem(k));
                      setMessage(
                        "Preferences reset. Your ledger data was kept.",
                      );
                      window.dispatchEvent(
                        new CustomEvent("pocket:preferences-changed"),
                      );
                    }}
                  >
                    Reset preferences
                  </button>
                </SettingsRow>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function CategorySettingsGroup({
  title,
  items,
  value,
  onChange,
  onAdd,
  onRemove,
}) {
  return (
    <div className="category-settings-group">
      <div className="category-settings-header">
        <strong>{title}</strong>
        <p>Customize the categories available in transaction forms.</p>
      </div>
      <div className="category-chip-list">
        {items.map((item) => (
          <span className="category-chip" key={item}>
            {item}
            <button onClick={() => onRemove(item)}>×</button>
          </span>
        ))}
      </div>
      <div className="category-add-row">
        <input
          className="settings-control settings-text-control"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd();
          }}
          placeholder="New category"
        />
        <button className="settings-action-button" onClick={onAdd}>
          Add
        </button>
      </div>
    </div>
  );
}
function SettingsRow({ title, description, value, children }) {
  return (
    <div className="settings-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {children || <span className="settings-row-value">{value}</span>}
    </div>
  );
}
function SettingsToggle({ checked, onChange }) {
  return (
    <button
      type="button"
      className={`settings-toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      aria-label={checked ? "Enabled" : "Disabled"}
    >
      <span className="settings-toggle-knob" />
    </button>
  );
}

function ThemePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const options = [
    {
      value: "dark",
      label: "Dark",
      description: "Use Pocket's dark interface.",
    },
    {
      value: "light",
      label: "Light",
      description: "Use Pocket's light interface.",
    },
    {
      value: "system",
      label: "System",
      description: "Follow your device appearance.",
    },
  ];
  const current =
    options.find((option) => option.value === value) || options[0];
  const currentIcon =
    current.value === "dark"
      ? Sun
      : current.value === "light"
        ? Sun
        : MonitorSmartphone;
  const CurrentIcon = currentIcon;
  useEffect(() => {
    const close = (event) => {
      if (!event.target.closest(".theme-picker")) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <div className={`theme-picker ${open ? "open" : ""}`}>
      <button
        type="button"
        className="theme-picker-button"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="theme-picker-leading-icon">
          <CurrentIcon size={17} />
        </span>
        <span className="theme-picker-copy">
          <strong>{current.label}</strong>
          <small>{current.description}</small>
        </span>
        <ChevronRight size={17} className="theme-picker-chevron" />
      </button>
      {open && (
        <div className="theme-picker-menu" role="listbox" aria-label="Theme">
          {options.map((option) => {
            const Icon =
              option.value === "dark"
                ? MoonIconForPocket
                : option.value === "light"
                  ? Sun
                  : MonitorSmartphone;
            return (
              <button
                key={option.value}
                type="button"
                className={`theme-picker-option ${value === option.value ? "active" : ""}`}
                role="option"
                aria-selected={value === option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="theme-picker-option-icon">
                  <Icon size={17} />
                </span>
                <span className="theme-picker-option-copy">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                {value === option.value && (
                  <span className="theme-picker-check">✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MoonIconForPocket(props) {
  return (
    <span
      {...props}
      style={{
        width: 17,
        height: 17,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 15,
        lineHeight: 1,
      }}
    >
      ◐
    </span>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          color: "#8B8F98",
          fontFamily: "Inter, sans-serif",
          marginBottom: 5,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

/* ---------- Styles ---------- */

const settingsCss = `
.global-settings-overlay{position:fixed;inset:0;z-index:2000;background:rgba(4,6,8,.72);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:18px}
.global-settings-shell{width:min(960px,100%);min-height:600px;max-height:calc(100dvh - 36px);overflow:hidden;display:grid;grid-template-columns:220px minmax(0,1fr);background:#15191F;border:1px solid #303742;border-radius:22px;box-shadow:0 30px 90px rgba(0,0,0,.58)}
.global-settings-sidebar{padding:22px 12px;background:#12161B;border-right:1px solid #292F38;overflow:auto}
.global-settings-brand{padding:4px 12px 22px;color:#F1F0EB;font:600 18px 'Space Grotesk',sans-serif}
.global-settings-nav{width:100%;display:flex;align-items:center;gap:10px;border:0;border-radius:10px;padding:11px 12px;background:transparent;color:#89909B;text-align:left;font:500 13px Inter,sans-serif;cursor:pointer}
.global-settings-nav.active{background:#20262E;color:#74DF88}
.global-settings-content{min-width:0;overflow:auto;padding:28px 32px 38px}
.global-settings-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding-bottom:24px;border-bottom:1px solid #2A3039}
.global-settings-eyebrow{color:#6D7480;font:700 9px Inter,sans-serif;letter-spacing:.16em}
.global-settings-header h2{margin:7px 0 0;color:#F3F1EC;font:600 28px 'Space Grotesk',sans-serif;letter-spacing:-.7px}
.global-settings-close{width:38px;height:38px;border-radius:11px;border:1px solid #303742;background:#1A2028;color:#AAB1BB;display:flex;align-items:center;justify-content:center;cursor:pointer}
.settings-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:22px 0;border-bottom:1px solid #252B33}
.settings-row strong{display:block;color:#E9E8E3;font:600 14px Inter,sans-serif}
.settings-row p{margin:6px 0 0;color:#818895;font:12px/1.45 Inter,sans-serif;max-width:560px}
.settings-row-value{color:#70D984;font:12px Inter,sans-serif;white-space:nowrap}
.settings-control,.settings-action-button{min-height:42px;border:1px solid #303742;border-radius:10px;background:#1A2028;color:#E9E8E3;padding:0 12px;font:12px Inter,sans-serif;cursor:pointer}
.settings-control{min-width:170px}.settings-text-control{width:min(270px,100%)!important}.settings-action-button{background:#20262E;border-color:#37404C;color:#75DD8A;font-weight:600}
.settings-toggle{width:51px;height:31px;padding:2px;border:0;border-radius:999px;background:rgba(120,120,128,.28);cursor:pointer;flex:0 0 auto;display:flex;align-items:center;justify-content:flex-start;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06),inset 0 1px 1px rgba(0,0,0,.18),0 1px 2px rgba(0,0,0,.16);transition:background-color 180ms cubic-bezier(.22,1,.36,1),box-shadow 180ms ease;appearance:none;-webkit-appearance:none}.settings-toggle span{display:block;width:27px;height:27px;border-radius:50%;background:#F2F2F7;box-shadow:0 2px 5px rgba(0,0,0,.34),0 .5px 1px rgba(0,0,0,.22);transform:translateX(0);transition:transform 190ms cubic-bezier(.2,.85,.25,1.2);flex:0 0 27px}.settings-toggle.on{background:#34C759;box-shadow:inset 0 0 0 1px rgba(0,0,0,.05),inset 0 1px 1px rgba(255,255,255,.08),0 1px 2px rgba(0,0,0,.12)}.settings-toggle.on span{transform:translateX(20px);background:#FFFFFF}.settings-toggle:focus-visible{outline:2px solid rgba(79,227,107,.45);outline-offset:2px}.settings-toggle:active span{transform:scale(.96)}.settings-toggle.on:active span{transform:translateX(20px) scale(.96)}
.settings-key-row{display:flex;gap:8px;align-items:center}.settings-key-row input{width:230px;max-width:36vw;background:#101419;border:1px solid #303742;border-radius:9px;padding:9px 10px;color:#E9E8E3;outline:none;font:12px Inter,sans-serif}.settings-key-row button{border:1px solid #3B854A;border-radius:9px;background:#51D96B;color:#102014;padding:9px 13px;font:600 12px Inter,sans-serif;cursor:pointer}
.settings-button-row{display:flex;gap:8px;flex-wrap:wrap}.settings-danger-button{min-height:42px;border:1px solid rgba(217,115,92,.42);border-radius:10px;background:rgba(217,115,92,.08);color:#F0A08F;padding:0 12px;font:600 12px Inter,sans-serif;cursor:pointer}.settings-file-input{color:#9AA2AE;font:11px Inter,sans-serif;max-width:290px}
.settings-saved-pill{position:absolute;right:0;top:-6px;color:#79DD8B;font:600 10px Inter,sans-serif;background:rgba(79,227,107,.08);border:1px solid rgba(79,227,107,.16);padding:5px 8px;border-radius:999px}.settings-status-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:14px 0 2px;padding:10px 12px;border:1px solid #3A4652;border-radius:10px;background:#1B222B;color:#BFC6D0;font:12px/1.4 Inter,sans-serif}.settings-status-banner button{border:0;background:transparent;color:#8D96A3;cursor:pointer;font-size:16px}
.category-settings-group{padding:22px 0;border-bottom:1px solid #252B33}.category-settings-header strong{color:#E9E8E3;font:600 14px Inter,sans-serif}.category-settings-header p{margin:6px 0 14px;color:#818895;font:12px/1.45 Inter,sans-serif}.category-chip-list{display:flex;flex-wrap:wrap;gap:7px}.category-chip{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid #303742;border-radius:999px;background:#1A2028;color:#DDE0E5;font:11px Inter,sans-serif}.category-chip button{border:0;background:transparent;color:#7F8794;cursor:pointer;padding:0;font-size:14px}.category-add-row{display:flex;gap:8px;margin-top:14px}
html[data-pocket-motion="off"] *,html[data-pocket-motion="off"] *::before,html[data-pocket-motion="off"] *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
html[data-pocket-theme="light"] body{background:#F3F5F7!important;color:#171A1F}html[data-pocket-theme="light"] .global-settings-shell{background:#fff;border-color:#D7DDE4;box-shadow:0 30px 90px rgba(22,30,40,.18)}html[data-pocket-theme="light"] .global-settings-sidebar{background:#F7F8FA;border-color:#E0E4EA}html[data-pocket-theme="light"] .global-settings-nav{color:#68717C}html[data-pocket-theme="light"] .global-settings-nav.active{background:#E9F6EC;color:#188A36}html[data-pocket-theme="light"] .global-settings-content{background:#fff}html[data-pocket-theme="light"] .global-settings-header h2,html[data-pocket-theme="light"] .settings-row strong,html[data-pocket-theme="light"] .category-settings-header strong{color:#1E2329}html[data-pocket-theme="light"] .settings-row,html[data-pocket-theme="light"] .category-settings-group{border-color:#E7EAEE}html[data-pocket-theme="light"] .settings-row p,html[data-pocket-theme="light"] .category-settings-header p{color:#6D7580}html[data-pocket-theme="light"] .settings-control,html[data-pocket-theme="light"] .category-chip{background:#F7F8FA;border-color:#D8DDE4;color:#242930}
@media(max-width:768px){.global-settings-overlay{padding:0;align-items:stretch}.global-settings-shell{width:100%;height:100dvh;max-height:100dvh;min-height:0;border-radius:0;border:0;display:flex;flex-direction:column}.global-settings-sidebar{display:flex;overflow-x:auto;overflow-y:hidden;border-right:0;border-bottom:1px solid #292F38;padding:10px 12px;gap:6px}.global-settings-brand{display:none}.global-settings-nav{width:auto;min-width:max-content}.global-settings-content{padding:20px 18px 36px}.settings-row{align-items:flex-start;flex-direction:column;gap:13px}.settings-row>:last-child{width:100%;align-self:stretch}.settings-row-value{display:flex;width:100%;min-height:42px;align-items:center;padding:0 12px;border:1px solid #303742;border-radius:10px;background:#1A2028}.settings-key-row{width:100%;flex-wrap:wrap}.settings-key-row input{width:100%;max-width:none}}

/* Mobile settings: replace the cramped tab strip with a polished picker. */
@media(max-width:768px){
  .global-settings-sidebar{
    display:block !important;
    position:relative !important;
    overflow:visible !important;
    flex:0 0 auto !important;
    padding:12px 16px !important;
    border-right:0 !important;
    border-bottom:1px solid #292F38 !important;
    background:#11151A !important;
  }
  .global-settings-sidebar > .global-settings-brand,
  .global-settings-sidebar > .global-settings-nav{display:none !important;}
  .mobile-settings-picker{position:relative;display:block;width:100%;}
  .mobile-settings-picker-button{
    width:100%;min-height:58px;display:flex;align-items:center;gap:12px;
    padding:9px 12px;border:1px solid #2C3440;border-radius:14px;
    background:#191E25;color:#E9E8E3;cursor:pointer;text-align:left;
  }
  .mobile-settings-picker-button.open{border-color:#3B8150;background:#1B222A;box-shadow:0 8px 24px rgba(0,0,0,.18);}
  .mobile-settings-picker-icon,.mobile-settings-picker-option-icon{
    width:38px;height:38px;flex:0 0 38px;border-radius:11px;display:flex;align-items:center;justify-content:center;
    background:#202731;color:#71D786;border:1px solid #303946;
  }
  .mobile-settings-picker-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px;}
  .mobile-settings-picker-copy strong{font:600 14px Inter,sans-serif;color:#F0EEE8;}
  .mobile-settings-picker-copy small{font:11px Inter,sans-serif;color:#7F8793;}
  .mobile-settings-picker-chevron{color:#8B94A1;transform:rotate(90deg);transition:transform .18s ease;}
  .mobile-settings-picker-button.open .mobile-settings-picker-chevron{transform:rotate(-90deg);}
  .mobile-settings-picker-menu{
    position:absolute;z-index:20;top:66px;left:0;right:0;max-height:350px;overflow:auto;
    padding:8px;background:#171C23;border:1px solid #303946;border-radius:14px;
    box-shadow:0 18px 42px rgba(0,0,0,.45);
  }
  .mobile-settings-picker-option{
    width:100%;min-height:50px;border:0;border-radius:10px;background:transparent;color:#CDD2D9;
    display:flex;align-items:center;gap:10px;padding:6px 8px;text-align:left;cursor:pointer;font:500 13px Inter,sans-serif;
  }
  .mobile-settings-picker-option:hover,.mobile-settings-picker-option.active{background:#202731;color:#F2F0EB;}
  .mobile-settings-picker-option-icon{width:32px;height:32px;flex-basis:32px;border-radius:9px;background:#1E252F;color:#8D96A3;border:0;}
  .mobile-settings-picker-option.active .mobile-settings-picker-option-icon{color:#71D786;background:#22352A;}
  .mobile-settings-picker-check{margin-left:auto;color:#71D786;font-weight:700;font-size:15px;padding-right:4px;}
  .global-settings-content{padding:20px 18px 36px !important;}
}
`;

const fontImports = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap');

* { box-sizing: border-box; }
html, body, #root { margin: 0; width: 100%; min-height: 100%; }
body { overflow-x: hidden; background: #0E1013; }

.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* =========================================================
   POCKET MOTION SYSTEM
   Calm, fast and purposeful: feedback 140–180ms,
   surfaces 220–300ms, page transitions ~360ms.
========================================================= */
:root {
  --pocket-ease: cubic-bezier(.22, 1, .36, 1);
  --pocket-ease-soft: cubic-bezier(.16, 1, .3, 1);
  --pocket-fast: 160ms;
  --pocket-surface: 240ms;
}

button,
a,
select,
input,
textarea {
  -webkit-tap-highlight-color: transparent;
}

button,
a,
select {
  transition:
    transform var(--pocket-fast) var(--pocket-ease),
    background-color var(--pocket-fast) ease,
    border-color var(--pocket-fast) ease,
    color var(--pocket-fast) ease,
    box-shadow var(--pocket-fast) ease,
    opacity var(--pocket-fast) ease;
}

button:not(:disabled):active {
  transform: translateY(1px) scale(.985);
}

button:focus-visible,
a:focus-visible,
select:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: 2px solid rgba(79,227,107,.35);
  outline-offset: 2px;
}

.pocket-page-transition {
  animation: pocketPageEnter 360ms var(--pocket-ease) both;
  transform-origin: 50% 18%;
}

@keyframes pocketPageEnter {
  from { opacity: 0; transform: translate3d(0, 12px, 0) scale(.992); }
  to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
}

.pocket-page-transition > * {
  animation: pocketContentEnter 420ms var(--pocket-ease-soft) both;
}

.pocket-page-transition > *:nth-child(2) { animation-delay: 25ms; }
.pocket-page-transition > *:nth-child(3) { animation-delay: 50ms; }
.pocket-page-transition > *:nth-child(4) { animation-delay: 75ms; }

.panel,
.widget,
.netWorthCard,
.monthCard,
.accountCard,
.quickCard,
.moduleHero,
.placeholderCard,
.global-settings-shell,
.universal-search-panel,
.profile-menu-popover,
.mobile-bottom-nav,
.pocket-modal-card {
  transition:
    transform var(--pocket-surface) var(--pocket-ease),
    border-color var(--pocket-surface) ease,
    box-shadow var(--pocket-surface) ease,
    background-color var(--pocket-surface) ease;
}

.panel:hover,
.widget:hover,
.accountCard:hover,
.quickCard:hover,
.placeholderCard:hover {
  transform: translateY(-2px);
  border-color: #343B46;
  box-shadow: 0 14px 34px rgba(0,0,0,.14);
}

.ledger-row,
.account-row,
.category-row,
.goal-row,
.mini-budget,
.settings-row {
  animation: pocketRowEnter 300ms var(--pocket-ease-soft) both;
}

.ledger-row:nth-child(2), .account-row:nth-child(2), .category-row:nth-child(2), .goal-row:nth-child(2), .settings-row:nth-child(2) { animation-delay: 20ms; }
.ledger-row:nth-child(3), .account-row:nth-child(3), .category-row:nth-child(3), .goal-row:nth-child(3), .settings-row:nth-child(3) { animation-delay: 40ms; }
.ledger-row:nth-child(4), .account-row:nth-child(4), .category-row:nth-child(4), .goal-row:nth-child(4), .settings-row:nth-child(4) { animation-delay: 60ms; }
.ledger-row:nth-child(5), .account-row:nth-child(5), .category-row:nth-child(5), .goal-row:nth-child(5), .settings-row:nth-child(5) { animation-delay: 80ms; }

@keyframes pocketContentEnter {
  from { opacity: 0; transform: translate3d(0, 10px, 0); }
  to   { opacity: 1; transform: translate3d(0, 0, 0); }
}

@keyframes pocketRowEnter {
  from { opacity: 0; transform: translate3d(0, 6px, 0); }
  to   { opacity: 1; transform: translate3d(0, 0, 0); }
}

.pocket-modal-backdrop,
.global-settings-overlay,
.universal-search-overlay {
  animation: pocketOverlayIn 220ms ease both;
}

.pocket-modal-card,
.global-settings-shell,
.universal-search-panel {
  animation: pocketSurfaceIn 280ms var(--pocket-ease) both;
}

@keyframes pocketOverlayIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes pocketSurfaceIn {
  from { opacity: 0; transform: translate3d(0, 12px, 0) scale(.985); }
  to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
}

.profile-menu-popover {
  animation: pocketProfileIn 220ms var(--pocket-ease) both !important;
}

@keyframes pocketProfileIn {
  from { opacity: 0; transform: translate3d(0, -7px, 0) scale(.985); }
  to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
}

.profile-menu-item:hover,
.global-settings-nav:hover,
.universal-search-result:hover {
  transform: translateX(2px);
}

.global-settings-section {
  animation: pocketSectionIn 260ms var(--pocket-ease) both;
}

@keyframes pocketSectionIn {
  from { opacity: 0; transform: translate3d(8px, 0, 0); }
  to   { opacity: 1; transform: translate3d(0, 0, 0); }
}

.settings-toggle span {
  transition: transform 220ms var(--pocket-ease), background-color 180ms ease;
}

.mobile-avatar-button {
  transition: transform 180ms var(--pocket-ease), box-shadow 220ms ease;
}

.mobile-avatar-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(201,164,85,.2);
}

.mobile-bottom-nav .mobile-bottom-add {
  transition: transform 180ms var(--pocket-ease), box-shadow 180ms ease;
}

.mobile-bottom-nav .mobile-bottom-add:hover {
  transform: translateY(-16px) scale(1.025);
  box-shadow: 0 14px 30px rgba(79,227,107,.28) !important;
}

@media (hover: none) {
  .panel:hover,
  .widget:hover,
  .accountCard:hover,
  .quickCard:hover,
  .placeholderCard:hover,
  .profile-menu-item:hover,
  .global-settings-nav:hover,
  .universal-search-result:hover {
    transform: none;
    box-shadow: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}

.mobile-dashboard-header,
.mobile-quick-actions,
.mobile-bottom-nav {
  display: none;
}
.mobile-settings-picker{display:none;}

.profile-menu-backdrop {
  display: block;
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0,0,0,.22);
}

.profile-menu-popover {
  display: block;
  position: fixed;
  left: 18px;
  bottom: 88px;
  width: 320px;
  z-index: 1101;
  background: #171C24;
  border: 1px solid #2B323D;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 24px 70px rgba(0,0,0,.55);
}

.profile-menu-header { display:flex; align-items:center; gap:13px; padding:18px; }
.profile-menu-avatar { width:48px; height:48px; border-radius:50%; flex:0 0 48px; display:flex; align-items:center; justify-content:center; background:linear-gradient(145deg,#E3BE63,#A97E30); color:#18140C; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:18px; }
.profile-menu-name { color:#F4F2EC; font-size:16px; font-weight:600; }
.profile-menu-space { margin-top:4px; color:#89909B; font-size:12px; }
.profile-menu-divider { height:1px; margin:0 12px; background:#2A313C; }
.profile-menu-icon-close { width:30px; height:30px; border-radius:9px; border:1px solid #303846; background:#1A2029; color:#8D96A3; display:flex; align-items:center; justify-content:center; padding:0; cursor:pointer; }
.profile-menu-item { width:100%; min-height:54px; padding:0 18px; border:0; background:transparent; color:#D9DDE5; display:flex; align-items:center; gap:12px; text-align:left; font-family:Inter,sans-serif; font-size:14px; cursor:pointer; }
.profile-menu-item-rich { min-height:72px; padding-top:10px; padding-bottom:10px; }
.profile-menu-item-icon { width:34px; height:34px; flex:0 0 34px; border-radius:10px; background:#202631; color:#C9A455; display:flex; align-items:center; justify-content:center; }
.profile-menu-item-copy { min-width:0; flex:1; display:flex; flex-direction:column; gap:4px; }
.profile-menu-item-copy strong { color:#E6E8EC; font-size:14px; font-weight:600; }
.profile-menu-item-copy small { color:#7F8794; font-size:11px; line-height:1.35; }
.profile-menu-item > svg:last-child { flex:0 0 auto; color:#7D8591; }
.profile-menu-item:hover { background:rgba(255,255,255,.025); }
.profile-menu-logout { color:#E78A78; }
.profile-menu-logout .profile-menu-item-icon { color:#D9735C; }

.global-settings-overlay { position:fixed; inset:0; z-index:2000; background:rgba(4,6,8,.72); backdrop-filter:blur(10px); display:flex; align-items:center; justify-content:center; padding:18px; }
.global-settings-shell { width:min(920px,100%); min-height:560px; max-height:calc(100dvh - 36px); overflow:hidden; display:grid; grid-template-columns:220px minmax(0,1fr); background:#15191F; border:1px solid #303742; border-radius:22px; box-shadow:0 30px 90px rgba(0,0,0,.58); }
.global-settings-sidebar { padding:22px 12px; background:#12161B; border-right:1px solid #292F38; }
.global-settings-brand { padding:4px 12px 22px; color:#F1F0EB; font-family:'Space Grotesk',sans-serif; font-size:18px; font-weight:600; }
.global-settings-nav { width:100%; display:flex; align-items:center; gap:10px; border:0; border-radius:10px; padding:11px 12px; background:transparent; color:#89909B; text-align:left; font:500 13px Inter,sans-serif; cursor:pointer; }
.global-settings-nav.active { background:#20262E; color:#74DF88; }
.global-settings-content { min-width:0; overflow:auto; padding:28px 32px 38px; }
.global-settings-header { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; padding-bottom:24px; border-bottom:1px solid #2A3039; }
.global-settings-eyebrow { color:#6D7480; font-size:9px; letter-spacing:.16em; font-weight:700; }
.global-settings-header h2 { margin:7px 0 0; color:#F3F1EC; font-family:'Space Grotesk',sans-serif; font-size:28px; letter-spacing:-.7px; }
.global-settings-close { width:38px; height:38px; border-radius:11px; border:1px solid #303742; background:#1A2028; color:#AAB1BB; display:flex; align-items:center; justify-content:center; cursor:pointer; }
.settings-row { display:flex; align-items:center; justify-content:space-between; gap:24px; padding:22px 0; border-bottom:1px solid #252B33; }
.settings-row strong { display:block; color:#E9E8E3; font-size:14px; font-weight:600; }
.settings-row p { margin:6px 0 0; color:#818895; font-size:12px; line-height:1.45; max-width:460px; }
.settings-row-value { color:#70D984; font-size:12px; white-space:nowrap; }
.settings-toggle { width:51px; height:31px; padding:2px; border:0; border-radius:999px; background:#3A3A3C; cursor:pointer; flex:0 0 auto; display:flex; align-items:center; justify-content:flex-start; box-shadow:inset 0 0 0 1px rgba(255,255,255,.04),0 1px 2px rgba(0,0,0,.18); transition:background-color 180ms ease,box-shadow 180ms ease; appearance:none; -webkit-appearance:none; }
.settings-toggle span { display:block; width:27px; height:27px; border-radius:50%; background:#F2F2F7; box-shadow:0 2px 4px rgba(0,0,0,.28),0 0 1px rgba(0,0,0,.18); transform:translateX(0); transition:transform 180ms cubic-bezier(.22,1,.36,1); flex:0 0 27px; }
.settings-toggle.on { background:#34C759; box-shadow:inset 0 0 0 1px rgba(0,0,0,.04),0 1px 2px rgba(0,0,0,.16); }
.settings-toggle.on span { transform:translateX(20px); background:#FFFFFF; }
.settings-toggle:focus-visible { outline:2px solid rgba(79,227,107,.45); outline-offset:2px; }
.settings-toggle:active span { transform:scale(.96); }
.settings-toggle.on:active span { transform:translateX(20px) scale(.96); }
.settings-key-row { display:flex; gap:8px; align-items:center; }
.settings-key-row input { width:220px; max-width:36vw; background:#101419; border:1px solid #303742; border-radius:9px; padding:9px 10px; color:#E9E8E3; outline:none; font:12px Inter,sans-serif; }
.settings-key-row button { border:1px solid #3B854A; border-radius:9px; background:#51D96B; color:#102014; padding:9px 13px; font:600 12px Inter,sans-serif; cursor:pointer; }


.settings-control,
.settings-action-button {
  min-height: 42px;
  border: 1px solid #303742;
  border-radius: 10px;
  background: #1A2028;
  color: #E9E8E3;
  padding: 0 12px;
  font: 12px Inter, sans-serif;
  cursor: pointer;
}

.settings-control { min-width: 160px; }

.settings-action-button {
  background: #20262E;
  border-color: #37404C;
  color: #75DD8A;
  font-weight: 600;
}

.settings-action-button:active,
.settings-control:focus {
  outline: 2px solid rgba(79,227,107,.18);
  outline-offset: 1px;
}


/* iOS-inspired theme picker */
.theme-picker{position:relative;width:min(270px,100%)}
.theme-picker-button{width:100%;min-height:50px;padding:8px 11px;display:flex;align-items:center;gap:11px;border:1px solid #303742;border-radius:13px;background:#1A2028;color:#E9E8E3;cursor:pointer;text-align:left;box-shadow:inset 0 1px 0 rgba(255,255,255,.025);transition:border-color 160ms ease,background 160ms ease,transform 140ms ease}
.theme-picker-button:hover{background:#1D242D;border-color:#3A424F}
.theme-picker-button:active{transform:scale(.995)}
.theme-picker-leading-icon,.theme-picker-option-icon{width:34px;height:34px;flex:0 0 34px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:#242B34;color:#8FD89C;border:1px solid #303844}
.theme-picker-copy,.theme-picker-option-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.theme-picker-copy strong,.theme-picker-option-copy strong{font:600 13px Inter,sans-serif;color:#F0EFEA}
.theme-picker-copy small,.theme-picker-option-copy small{font:11px/1.3 Inter,sans-serif;color:#7F8894;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.theme-picker-chevron{transition:transform 180ms ease;color:#7D8794}
.theme-picker.open .theme-picker-chevron{transform:rotate(90deg)}
.theme-picker-menu{position:absolute;left:0;right:0;top:calc(100% + 8px);z-index:40;padding:6px;background:#171C23;border:1px solid #303844;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.48),0 2px 10px rgba(0,0,0,.18);animation:pocketPickerIn 150ms cubic-bezier(.22,1,.36,1) both}
.theme-picker-option{width:100%;min-height:58px;padding:8px;border:0;border-radius:10px;background:transparent;display:flex;align-items:center;gap:10px;text-align:left;color:#DDE1E6;cursor:pointer}
.theme-picker-option:hover,.theme-picker-option.active{background:#202730}
.theme-picker-option:active{transform:scale(.995)}
.theme-picker-option.active .theme-picker-option-icon{color:#74E08A;border-color:#31583A;background:#1E2A22}
.theme-picker-check{width:22px;height:22px;display:flex;align-items:center;justify-content:center;color:#65DB7B;font-weight:700}
@keyframes pocketPickerIn{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}

/* ---------- Universal Search ---------- */

.universal-search-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(4, 6, 8, .68);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 9vh 18px 24px;
}

.universal-search-panel {
  width: min(720px, 100%);
  max-height: min(720px, 82dvh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #171B21;
  border: 1px solid #323A46;
  border-radius: 20px;
  box-shadow: 0 30px 100px rgba(0,0,0,.62);
}

.universal-search-input-row {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 66px;
  padding: 0 14px 0 18px;
  border-bottom: 1px solid #2A313B;
}

.universal-search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #F2F0EB;
  font: 500 16px Inter, sans-serif;
}

.universal-search-input::placeholder {
  color: #6E7682;
}

.universal-search-kbd {
  color: #858D98;
  background: #202630;
  border: 1px solid #303844;
  border-radius: 8px;
  padding: 6px 8px;
  font: 10px Inter, sans-serif;
  white-space: nowrap;
}

.universal-search-close {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  border: 1px solid #303844;
  background: #1C222A;
  color: #89929E;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.universal-search-hint {
  padding: 10px 18px;
  color: #68717D;
  font: 11px/1.45 Inter, sans-serif;
  border-bottom: 1px solid #242B34;
}

.universal-search-results {
  min-height: 0;
  overflow-y: auto;
  padding: 8px 8px 10px;
}

.universal-search-section-label {
  padding: 9px 10px 6px;
  color: #616A76;
  font: 700 9px Inter, sans-serif;
  letter-spacing: .14em;
  text-transform: uppercase;
}

.universal-search-result {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: #E7E8EA;
  text-align: left;
  cursor: pointer;
}

.universal-search-result.active,
.universal-search-result:hover {
  background: #20262F;
}

.universal-search-result-icon {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #232A34;
  color: #8ACF99;
}

.universal-search-result-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.universal-search-result-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #EDECE8;
  font: 600 13px Inter, sans-serif;
}

.universal-search-result-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #7D8692;
  font: 10px/1.35 Inter, sans-serif;
}

.universal-search-empty {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #6F7884;
  text-align: center;
}

.universal-search-empty strong {
  color: #C8CDD4;
  font: 600 13px Inter, sans-serif;
}

.universal-search-empty span {
  max-width: 300px;
  font: 11px/1.5 Inter, sans-serif;
}

.universal-search-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  border-top: 1px solid #292F38;
  color: #626B77;
  font: 10px Inter, sans-serif;
}

@media (max-width: 600px) {
  .universal-search-overlay {
    align-items: flex-start;
    padding: calc(12px + env(safe-area-inset-top)) 10px 12px;
  }

  .universal-search-panel {
    width: 100%;
    max-height: calc(100dvh - 24px - env(safe-area-inset-top));
    border-radius: 18px;
  }

  .universal-search-input-row {
    min-height: 60px;
    padding-left: 14px;
  }

  .universal-search-input {
    font-size: 15px;
  }

  .universal-search-hint {
    font-size: 10px;
    padding: 9px 14px;
  }

  .universal-search-footer {
    justify-content: space-between;
    gap: 8px;
    padding: 9px 12px;
  }
}

@media (max-width: 1023px) and (min-width: 769px) {
  .ledger-sidebar { width: 210px !important; }
  .hero-grid { grid-template-columns: 1fr !important; }
  .widget-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .widget-span-2 { grid-column: span 2 !important; }
}

@media (max-width: 768px) {
  html, body, #root {
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
    background: #0E1013;
  }

  .ledger-app {
    display: block !important;
    width: 100% !important;
    min-height: 100dvh !important;
    overflow-x: hidden !important;
  }

  /* The desktop sidebar, including Viren Patel / Personal card,
     is completely removed from mobile layout. */
  .ledger-sidebar {
    display: none !important;
  }

  .ledger-app > main {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    padding-bottom: calc(148px + env(safe-area-inset-bottom)) !important;
  }

  .ledger-topbar {
    display: block !important;
    position: relative !important;
    top: auto !important;
    width: 100% !important;
    padding: calc(18px + env(safe-area-inset-top)) 18px 4px !important;
    background: #0E1013 !important;
    backdrop-filter: none !important;
  }

  .mobile-dashboard-header {
    display: flex !important;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    margin-bottom: 16px;
  }

  .mobile-greeting {
    font-family: 'Space Grotesk', sans-serif;
    font-size: clamp(26px, 7vw, 32px);
    line-height: 1.1;
    font-weight: 600;
    letter-spacing: -1px;
    color: #F4F2EC;
  }

  .mobile-subtitle {
    margin-top: 7px;
    font-size: 15px;
    color: #8B919B;
  }

  /* Circular V replaces the large Viren Patel / Personal card. */
  .mobile-avatar-button {
    width: 54px !important;
    height: 54px !important;
    min-width: 54px !important;
    flex: 0 0 54px !important;
    border-radius: 50% !important;
    border: 1px solid rgba(201,164,85,.45) !important;
    background: linear-gradient(145deg, #E3BE63, #A97E30) !important;
    color: #18140C !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 0 !important;
    font-family: 'Space Grotesk', sans-serif !important;
    font-size: 20px !important;
    font-weight: 700 !important;
    cursor: pointer;
    box-shadow: 0 8px 24px rgba(201,164,85,.16);
    -webkit-tap-highlight-color: transparent;
  }

  .mobile-avatar-button:active {
    transform: scale(.96);
  }

  .ledger-topbar .globalSearch,
  .ledger-topbar .global-search {
    width: 100% !important;
    min-width: 0 !important;
    height: 56px !important;
    border-radius: 18px !important;
    font-size: 16px !important;
    padding: 0 15px !important;
    box-sizing: border-box !important;
  }

  .ledger-topbar .topActions,
  .ledger-topbar > .topActions,
  .ledger-topbar .utilityRow,
  .ledger-utility-row {
    display: none !important;
  }

  .mobile-quick-actions {
    display: grid !important;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
    width: 100%;
    margin: 14px 0 22px;
  }

  .mobile-quick-action {
    appearance: none;
    border: 0;
    background: transparent;
    color: #C8CBD2;
    min-width: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    font-size: 10px;
    font-family: Inter, sans-serif;
    cursor: pointer;
  }

  .mobile-quick-action svg,
  .mobile-quick-action > span:first-child {
    width: 50px;
    height: 50px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 16px;
    border: 1px solid #2B313B;
    background: #171B21;
    box-sizing: border-box;
  }

  .mobile-quick-action span:last-child {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
  }

  .mobile-add-action {
    color: #75DD8A;
    font-weight: 600;
  }

  .mobile-add-action svg {
    width: 58px !important;
    height: 58px !important;
    padding: 15px !important;
    border: 0 !important;
    border-radius: 18px !important;
    background: #51D96B !important;
    color: #0D1810 !important;
    box-shadow: 0 10px 24px rgba(79,227,107,.16);
  }

  .mobile-add-action span:last-child { color: #75DD8A; }

  .ledger-page,
  .modulePage {
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    box-sizing: border-box !important;
    padding-left: 18px !important;
    padding-right: 18px !important;
    padding-top: 4px !important;
    padding-bottom: 32px !important;
  }

  .hero-grid,
  .ledger-grid-3,
  .ledger-grid-main,
  .placeholderGrid {
    grid-template-columns: 1fr !important;
    width: 100% !important;
    min-width: 0 !important;
  }

  .widget-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 12px !important;
  }

  .widget-span-2 { grid-column: span 2 !important; }

  .hero-grid > *,
  .ledger-grid-3 > *,
  .ledger-grid-main > *,
  .widget-grid > * {
    min-width: 0 !important;
    max-width: 100% !important;
  }

  .dashboardLinkWidget {
    appearance: none;
    -webkit-appearance: none;
    border: 1px solid #20252D;
    background: #171A1F;
    font: inherit;
  }

  .dashboardLinkWidget:hover {
    border-color: #313844;
    background: #191D23;
    transform: translateY(-1px);
  }

  /* Bottom navigation is independent and never covered by profile UI. */
  .mobile-bottom-nav {
    position: fixed !important;
    z-index: 900 !important;
    left: 10px !important;
    right: 10px !important;
    bottom: calc(10px + env(safe-area-inset-bottom)) !important;
    width: auto !important;
    height: 72px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: space-around !important;
    padding: 0 4px !important;
    border: 1px solid #29303A !important;
    border-radius: 23px !important;
    background: rgba(20,23,29,.98) !important;
    backdrop-filter: blur(20px) !important;
    -webkit-backdrop-filter: blur(20px) !important;
    box-shadow: 0 18px 48px rgba(0,0,0,.45) !important;
  }

  .mobile-bottom-nav button {
    appearance: none;
    border: 0;
    background: transparent;
    color: #89909B;
    min-width: 0 !important;
    flex: 1;
    height: 60px;
    padding: 4px 1px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    font-family: Inter, sans-serif;
    font-size: 8px;
    cursor: pointer;
  }

  .mobile-bottom-nav button.active { color: #69DE7F; }
  .mobile-bottom-nav button span { white-space: nowrap; font-size: 8px; }

  .mobile-bottom-nav .mobile-bottom-add {
    flex: 0 0 56px !important;
    width: 56px !important;
    height: 56px !important;
    min-width: 56px !important;
    border-radius: 19px !important;
    background: #51D96B !important;
    color: #0E1810 !important;
    transform: translateY(-14px) !important;
    box-shadow: 0 10px 28px rgba(79,227,107,.24) !important;
  }

  .mobile-bottom-nav .mobile-bottom-add svg {
    width: 27px !important;
    height: 27px !important;
  }

  /* Mobile profile dropdown opened only by the circular V avatar. */
  .profile-menu-backdrop { background: rgba(0,0,0,.25); }
  .profile-menu-popover {
    top: calc(20px + env(safe-area-inset-top));
    right: 16px;
    left: auto;
    bottom: auto;
    width: min(320px, calc(100vw - 32px));
  }

  .profile-menu-header {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 18px;
  }

  .profile-menu-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    flex: 0 0 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(145deg, #E3BE63, #A97E30);
    color: #18140C;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700;
    font-size: 18px;
  }

  .profile-menu-name {
    color: #F4F2EC;
    font-size: 16px;
    font-weight: 600;
  }

  .profile-menu-space {
    margin-top: 4px;
    color: #89909B;
    font-size: 12px;
  }

  .profile-menu-divider {
    height: 1px;
    margin: 0 12px;
    background: #2A313C;
  }

  .profile-menu-icon-close {
    width: 30px;
    height: 30px;
    border-radius: 9px;
    border: 1px solid #303846;
    background: #1A2029;
    color: #8D96A3;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
  }

  .profile-menu-item {
    width: 100%;
    min-height: 54px;
    padding: 0 18px;
    border: 0;
    background: transparent;
    color: #D9DDE5;
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
    font-family: Inter, sans-serif;
    font-size: 14px;
    cursor: pointer;
  }

  .profile-menu-item-rich {
    min-height: 72px;
    padding-top: 10px;
    padding-bottom: 10px;
  }

  .profile-menu-item-icon {
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    border-radius: 10px;
    background: #202631;
    color: #C9A455;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .profile-menu-item-copy {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .profile-menu-item-copy strong {
    color: #E6E8EC;
    font-size: 14px;
    font-weight: 600;
  }

  .profile-menu-item-copy small {
    color: #7F8794;
    font-size: 11px;
    line-height: 1.35;
  }

  .profile-menu-item > svg:last-child {
    flex: 0 0 auto;
    color: #7D8591;
  }

  .profile-menu-item:hover { background: rgba(255,255,255,.025); }
  .profile-menu-logout { color: #E78A78; }
  .profile-menu-logout .profile-menu-item-icon { color: #D9735C; }
  .profile-menu-close { color: #9CA4AF; }
}


@media (max-width: 768px) {
  .global-settings-overlay {
    position: fixed !important;
    inset: 0 !important;
    z-index: 99999 !important;
    padding: max(10px, env(safe-area-inset-top)) 0 0 !important;
    align-items: stretch !important;
    justify-content: stretch !important;
  }

  .global-settings-shell {
    width: 100% !important;
    height: 100dvh !important;
    min-height: 100dvh !important;
    max-height: 100dvh !important;
    border: 0 !important;
    border-radius: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
  }

  .global-settings-sidebar {
    position: relative !important;
    top: auto !important;
    z-index: 4 !important;
    flex: 0 0 auto !important;
    display: flex !important;
    gap: 6px !important;
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch !important;
    scrollbar-width: none !important;
    padding: 10px 12px !important;
    border-right: 0 !important;
    border-bottom: 1px solid #292F38 !important;
    background: #12161B !important;
  }

  .global-settings-sidebar::-webkit-scrollbar { display: none; }
  .global-settings-brand { display: none !important; }

  .global-settings-nav {
    width: auto !important;
    min-width: max-content !important;
    flex: 0 0 auto !important;
    min-height: 42px !important;
    padding: 10px 13px !important;
    touch-action: manipulation !important;
    white-space: nowrap !important;
  }

  .global-settings-content {
    flex: 1 1 auto !important;
    min-height: 0 !important;
    padding: 20px 18px calc(34px + env(safe-area-inset-bottom)) !important;
    overflow-y: auto !important;
    -webkit-overflow-scrolling: touch !important;
  }

  .global-settings-header h2 { font-size: 25px !important; }

  .settings-row {
    align-items: flex-start !important;
    gap: 14px !important;
    flex-direction: column !important;
  }

  .settings-row > :last-child {
    width: 100%;
    align-self: stretch;
  }

  .settings-control,
  .settings-action-button,
  .settings-key-row input,
  .settings-key-row button {
    min-height: 44px !important;
  }

  .settings-toggle { width: 51px !important; height: 31px !important; min-width: 51px !important; max-width: 51px !important; align-self: flex-end !important; }
  .theme-picker { width: 100% !important; max-width: none !important; }
  /* On mobile the theme menu stays in normal flow so it never overlaps the next settings row. */
  .theme-picker-menu {
    position: static !important;
    width: 100% !important;
    margin-top: 8px !important;
    top: auto !important;
    left: auto !important;
    right: auto !important;
    z-index: auto !important;
  }

  .settings-row-value {
    display: inline-flex !important;
    width: 100% !important;
    min-height: 42px !important;
    align-items: center !important;
    justify-content: space-between !important;
    padding: 0 12px !important;
    border: 1px solid #303742 !important;
    border-radius: 10px !important;
    background: #1A2028 !important;
  }

  .settings-key-row { width:100% !important; flex-wrap:wrap !important; margin-top:12px !important; }
  .settings-key-row input { width:100% !important; max-width:none !important; }
}

@media (max-width: 1023px) {
  .ledger-topbar {
    width: 100% !important;
    overflow: visible !important;
  }

  .ledger-topbar .global-search {
    margin: 0 !important;
  }

  .mobile-quick-actions {
    align-items: start !important;
  }

  .mobile-quick-action {
    min-height: 80px !important;
  }

  .mobile-add-action {
    transform: translateY(-2px);
  }

  .mobile-bottom-nav {
    bottom: calc(10px + env(safe-area-inset-bottom)) !important;
  }
}

@media (max-width: 380px) {
  .ledger-topbar { padding-left: 14px !important; padding-right: 14px !important; }
  .ledger-page, .modulePage { padding-left: 14px !important; padding-right: 14px !important; }
  .mobile-avatar-button { width: 50px !important; height: 50px !important; min-width: 50px !important; flex-basis: 50px !important; }
  .mobile-quick-action svg, .mobile-quick-action > span:first-child { width: 46px; height: 46px; }
  .mobile-add-action svg { width: 54px !important; height: 54px !important; }
}


/* =========================================================
   POCKET MOTION SYSTEM v2
   Interaction-first motion: fast feedback, soft surfaces,
   no gratuitous bouncing. Designed for mouse + touch.
========================================================= */
:root {
  --pocket-ease: cubic-bezier(.22, 1, .36, 1);
  --pocket-ease-soft: cubic-bezier(.16, 1, .3, 1);
  --pocket-fast: 150ms;
  --pocket-medium: 220ms;
  --pocket-slow: 340ms;
}

@media (hover: hover) and (pointer: fine) {
  .ledger-nav button:hover,
  .topActions button:hover,
  .iconTopBtn:hover,
  .secondaryBtn:hover,
  .linkBtn:hover,
  .iconBtn:hover,
  .iconOnlyBtn:hover,
  .commandItem:hover,
  .quickCard:hover,
  .mobile-quick-action:hover,
  .global-settings-nav:hover,
  .settings-action-button:hover,
  .profile-menu-item:hover {
    transform: translateY(-1px);
  }

  .quickCard:hover {
    box-shadow: 0 16px 32px rgba(0,0,0,.16);
  }

  .iconTopBtn:hover,
  .secondaryBtn:hover,
  .settings-action-button:hover {
    border-color: #404854;
  }
}

button,
a,
select,
input,
textarea,
[role="button"] {
  transition:
    transform var(--pocket-fast) var(--pocket-ease),
    opacity var(--pocket-fast) ease,
    color var(--pocket-fast) ease,
    background-color var(--pocket-medium) ease,
    border-color var(--pocket-medium) ease,
    box-shadow var(--pocket-medium) var(--pocket-ease);
}

button:not(:disabled):active,
[role="button"]:active {
  transform: translateY(1px) scale(.985) !important;
}

.global-search:focus-visible,
.global-search:focus-within {
  border-color: #3B8050 !important;
  box-shadow: 0 0 0 3px rgba(79,227,107,.08);
}

.mobile-avatar-button {
  will-change: transform;
}

.mobile-avatar-button:hover {
  transform: translateY(-2px) scale(1.01);
}

.mobile-avatar-button:active {
  transform: scale(.95) !important;
}

.pocket-page-transition {
  animation: pocketRouteIn var(--pocket-slow) var(--pocket-ease) both;
}

@keyframes pocketRouteIn {
  from {
    opacity: 0;
    transform: translate3d(0, 8px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

.pocket-page-transition > * {
  animation: pocketSectionIn var(--pocket-medium) var(--pocket-ease-soft) both;
}

.pocket-page-transition > *:nth-child(2) { animation-delay: 24ms; }
.pocket-page-transition > *:nth-child(3) { animation-delay: 48ms; }
.pocket-page-transition > *:nth-child(4) { animation-delay: 72ms; }

@keyframes pocketSectionIn {
  from {
    opacity: 0;
    transform: translate3d(0, 7px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

.panel,
.widget,
.accountCard,
.placeholderCard,
.quickCard,
.monthCard,
.netWorthCard,
.global-settings-shell,
.profile-menu-popover,
.pocket-modal-card,
.commandPanel,
.mobile-bottom-nav {
  will-change: transform;
}

.panel:hover,
.widget:hover,
.accountCard:hover,
.placeholderCard:hover,
.netWorthCard:hover,
.monthCard:hover {
  transform: translateY(-1px);
}

.ledger-row,
.account-row,
.category-row,
.goal-row,
.mini-budget,
.settings-row {
  animation: pocketListIn 240ms var(--pocket-ease-soft) both;
}

@keyframes pocketListIn {
  from {
    opacity: 0;
    transform: translate3d(0, 5px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

.ledger-row:hover {
  background: rgba(255,255,255,.018);
  border-radius: 8px;
}

.pocket-modal-backdrop,
.global-settings-overlay,
.universal-search-overlay,
.profile-menu-backdrop {
  animation: pocketOverlayInV2 180ms ease both;
}

@keyframes pocketOverlayInV2 {
  from { opacity: 0; }
  to { opacity: 1; }
}

.pocket-modal-card,
.global-settings-shell,
.universal-search-panel,
.profile-menu-popover,
.commandPanel {
  animation: pocketSurfaceInV2 240ms var(--pocket-ease) both;
}

@keyframes pocketSurfaceInV2 {
  from {
    opacity: 0;
    transform: translate3d(0, 10px, 0) scale(.985);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
}

.profile-menu-item,
.global-settings-nav,
.universal-search-result,
.commandItem,
.settings-action-button {
  position: relative;
  overflow: hidden;
}

.profile-menu-item::after,
.global-settings-nav::after,
.universal-search-result::after,
.commandItem::after,
.settings-action-button::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(255,255,255,.04);
  opacity: 0;
  pointer-events: none;
  transition: opacity 140ms ease;
}

.profile-menu-item:active::after,
.global-settings-nav:active::after,
.universal-search-result:active::after,
.commandItem:active::after,
.settings-action-button:active::after {
  opacity: 1;
}

.settings-row {
  transition: background-color var(--pocket-medium) ease, transform var(--pocket-fast) var(--pocket-ease);
}

.settings-row:focus-within {
  background: rgba(255,255,255,.018);
  border-radius: 10px;
}

.global-settings-nav.active {
  box-shadow: inset 2px 0 0 #4FE36B;
}

.mobile-quick-actions .mobile-quick-action:nth-child(1) { animation: pocketQuickIn 300ms 20ms both; }
.mobile-quick-actions .mobile-quick-action:nth-child(2) { animation: pocketQuickIn 300ms 45ms both; }
.mobile-quick-actions .mobile-quick-action:nth-child(3) { animation: pocketQuickIn 320ms 70ms both; }
.mobile-quick-actions .mobile-quick-action:nth-child(4) { animation: pocketQuickIn 300ms 95ms both; }
.mobile-quick-actions .mobile-quick-action:nth-child(5) { animation: pocketQuickIn 300ms 120ms both; }

@keyframes pocketQuickIn {
  from { opacity: 0; transform: translateY(7px); }
  to { opacity: 1; transform: translateY(0); }
}

.mobile-bottom-nav button.active svg {
  animation: pocketNavActive 260ms var(--pocket-ease) both;
}

@keyframes pocketNavActive {
  0% { transform: scale(.9); opacity: .7; }
  100% { transform: scale(1); opacity: 1; }
}

.mobile-bottom-nav .mobile-bottom-add:hover {
  transform: translateY(-16px) scale(1.025) !important;
}

.mobile-bottom-nav .mobile-bottom-add:active {
  transform: translateY(-13px) scale(.96) !important;
}

/* Inputs get calm focus rather than abrupt borders. */
.input:focus,
.settings-key-row input:focus,
.searchInput:focus,
.commandInput:focus {
  border-color: #3A8050 !important;
  box-shadow: 0 0 0 3px rgba(79,227,107,.07);
}

/* Make scrollbars subtle and non-jarring on modern browsers. */
* {
  scrollbar-width: thin;
  scrollbar-color: #343B46 transparent;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    animation-delay: 0ms !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}

/* =========================================================
   Profile menu polish
   ========================================================= */
.profile-menu-backdrop {
  background: rgba(0, 0, 0, .30);
  backdrop-filter: blur(1.5px);
  -webkit-backdrop-filter: blur(1.5px);
}

.profile-menu-popover {
  width: 344px !important;
  max-width: calc(100vw - 294px);
  background: #171B21 !important;
  border: 1px solid #303742 !important;
  border-radius: 18px !important;
  overflow: hidden !important;
  box-shadow: 0 22px 60px rgba(0,0,0,.46), 0 2px 12px rgba(0,0,0,.22) !important;
  transform-origin: left bottom;
}

.profile-menu-header {
  display: grid !important;
  grid-template-columns: 46px minmax(0,1fr) 32px;
  align-items: center !important;
  gap: 12px !important;
  min-height: 78px !important;
  padding: 16px 16px 14px !important;
  background: linear-gradient(180deg, rgba(255,255,255,.018), rgba(255,255,255,0));
}

.profile-menu-avatar {
  width: 46px !important;
  height: 46px !important;
  border-radius: 14px !important;
  background: linear-gradient(145deg,#E3BE63,#A97E30) !important;
  color: #18140C !important;
  box-shadow: 0 8px 22px rgba(201,164,85,.14);
}

.profile-menu-name {
  color: #F3F2ED !important;
  font: 600 14px/1.2 Inter, sans-serif !important;
  letter-spacing: -.1px;
}

.profile-menu-space {
  margin-top: 4px !important;
  color: #848C98 !important;
  font: 11px/1.3 Inter, sans-serif !important;
}

.profile-menu-icon-close {
  width: 32px !important;
  height: 32px !important;
  border-radius: 9px !important;
  border: 1px solid #303742 !important;
  background: #1D232B !important;
  color: #9CA4B0 !important;
}

.profile-menu-divider {
  height: 1px !important;
  margin: 0 !important;
  background: #292F38 !important;
}

.profile-menu-item {
  width: 100% !important;
  min-height: 64px !important;
  padding: 9px 14px !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  color: #D9DDE5 !important;
  display: grid !important;
  grid-template-columns: 36px minmax(0,1fr) 16px;
  align-items: center !important;
  gap: 11px !important;
  text-align: left !important;
  font-family: Inter, sans-serif !important;
  cursor: pointer !important;
  transition: background .16s ease, transform .16s ease !important;
}

.profile-menu-item-rich {
  min-height: 68px !important;
}

.profile-menu-item:hover {
  background: #1D232B !important;
  transform: none !important;
}

.profile-menu-item:active {
  background: #222932 !important;
}

.profile-menu-item-icon {
  width: 36px !important;
  height: 36px !important;
  border-radius: 10px !important;
  background: #20262E !important;
  color: #C9A455 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.profile-menu-item-copy {
  min-width: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-start !important;
  gap: 3px !important;
}

.profile-menu-item-copy strong {
  color: #E7E8EC !important;
  font: 600 13px/1.2 Inter, sans-serif !important;
}

.profile-menu-item-copy small {
  display: block !important;
  color: #7F8895 !important;
  font: 10px/1.35 Inter, sans-serif !important;
  white-space: normal !important;
}

.profile-menu-item > svg:last-child {
  color: #66707D !important;
}

.profile-menu-logout {
  margin: 0 !important;
}

.profile-menu-logout .profile-menu-item-icon {
  color: #D9735C !important;
}

@media (max-width: 1023px) {
  .profile-menu-popover {
    width: min(344px, calc(100vw - 32px)) !important;
    max-width: none !important;
    transform-origin: top right;
  }
}

@media (max-width: 400px) {
  .profile-menu-popover {
    width: calc(100vw - 20px) !important;
  }
}

/* FINAL PROFILE MENU POSITION + COLOR
   Desktop: open exactly from the existing profile-card area in the sidebar.
   Mobile: keep the menu attached to the top-right V avatar.
*/
.profile-menu-popover {
  left: 18px !important;
  right: auto !important;
  bottom: 18px !important;
  top: auto !important;
  width: 220px !important;
  max-width: 220px !important;
  background: #15181D !important;
  border: 1px solid #242830 !important;
  border-radius: 13px !important;
  box-shadow: 0 24px 70px rgba(0,0,0,.52), 0 4px 18px rgba(0,0,0,.28) !important;
  transform-origin: left bottom !important;
}

.profile-menu-header {
  background: #15181D !important;
  min-height: 68px !important;
  padding: 12px 10px !important;
}

.profile-menu-divider {
  background: #242830 !important;
}

.profile-menu-item {
  min-height: 54px !important;
  padding: 8px 10px !important;
  grid-template-columns: 32px minmax(0,1fr) 14px !important;
  gap: 9px !important;
  background: #15181D !important;
}

.profile-menu-item-rich {
  min-height: 58px !important;
}

.profile-menu-item:hover {
  background: #1A1E24 !important;
}

.profile-menu-item:active {
  background: #20242A !important;
}

.profile-menu-item-icon {
  width: 32px !important;
  height: 32px !important;
  border-radius: 9px !important;
  background: #1F242B !important;
}

.profile-menu-name {
  font-size: 13px !important;
}

.profile-menu-space {
  font-size: 10px !important;
}

@media (max-width: 1023px) {
  .profile-menu-popover {
    left: auto !important;
    right: 16px !important;
    bottom: auto !important;
    top: calc(86px + env(safe-area-inset-top)) !important;
    width: min(344px, calc(100vw - 32px)) !important;
    max-width: none !important;
    border-radius: 18px !important;
  }
}


  @media (max-width: 1023px) {
    /* Mobile: remove the desktop command / appearance / notifications / date / add row. */
    .ledger-topbar .desktop-top-actions {
      display: none !important;
    }
  }



/* Final iOS switch correction: uses a pseudo-element track/knob so no older CSS can distort it. */
.settings-toggle {
  position: relative !important;
  display: inline-block !important;
  width: 51px !important;
  min-width: 51px !important;
  max-width: 51px !important;
  height: 31px !important;
  min-height: 31px !important;
  max-height: 31px !important;
  flex: 0 0 51px !important;
  padding: 0 !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 999px !important;
  background: transparent !important;
  box-shadow: none !important;
  appearance: none !important;
  -webkit-appearance: none !important;
  cursor: pointer !important;
  overflow: visible !important;
}
.settings-toggle::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: #3A3A3C;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.18);
  transition: background-color 180ms ease, box-shadow 180ms ease;
}
.settings-toggle::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 27px;
  height: 27px;
  border-radius: 50%;
  background: #FFFFFF;
  box-shadow: 0 2px 5px rgba(0,0,0,.28), 0 .5px 1px rgba(0,0,0,.18);
  transform: translateX(0);
  transition: transform 190ms cubic-bezier(.2,.85,.25,1.2);
  z-index: 1;
}
.settings-toggle.on::before {
  background: #34C759;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.05);
}
.settings-toggle.on::after {
  transform: translateX(20px);
}
.settings-toggle > .settings-toggle-knob {
  display: none !important;
}
.settings-toggle:active {
  transform: scale(.97) !important;
}
.settings-toggle:focus-visible {
  outline: 2px solid rgba(79,227,107,.42) !important;
  outline-offset: 3px !important;
}
@media (max-width: 768px) {
  .settings-row > .settings-toggle,
  .settings-row > .settings-toggle.on {
    width: 51px !important;
    min-width: 51px !important;
    max-width: 51px !important;
    height: 31px !important;
    min-height: 31px !important;
    max-height: 31px !important;
    flex: 0 0 51px !important;
    align-self: flex-end !important;
  }
}

/* Final light-theme contrast fixes for the custom controls. */
html[data-pocket-theme="light"] .theme-picker-button {
  background: #F7F8FA !important;
  border-color: #D7DDE4 !important;
  color: #20252B !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.9) !important;
}
html[data-pocket-theme="light"] .theme-picker-button:hover {
  background: #F0F3F6 !important;
  border-color: #C8D0D9 !important;
}
html[data-pocket-theme="light"] .theme-picker-leading-icon,
html[data-pocket-theme="light"] .theme-picker-option-icon {
  background: #EEF2F5 !important;
  border-color: #D7DDE4 !important;
  color: #2A9D47 !important;
}
html[data-pocket-theme="light"] .theme-picker-copy strong,
html[data-pocket-theme="light"] .theme-picker-option-copy strong {
  color: #1E2329 !important;
}
html[data-pocket-theme="light"] .theme-picker-copy small,
html[data-pocket-theme="light"] .theme-picker-option-copy small {
  color: #68717C !important;
}
html[data-pocket-theme="light"] .theme-picker-chevron {
  color: #66717D !important;
}
html[data-pocket-theme="light"] .theme-picker-menu {
  background: #FFFFFF !important;
  border-color: #D7DDE4 !important;
  box-shadow: 0 18px 46px rgba(30,38,48,.18), 0 3px 12px rgba(30,38,48,.08) !important;
}
html[data-pocket-theme="light"] .theme-picker-option {
  color: #252B31 !important;
}
html[data-pocket-theme="light"] .theme-picker-option:hover,
html[data-pocket-theme="light"] .theme-picker-option.active {
  background: #F0F5F1 !important;
}
html[data-pocket-theme="light"] .theme-picker-option.active .theme-picker-option-icon {
  background: #E8F5EB !important;
  border-color: #BFE2C7 !important;
  color: #188A36 !important;
}
html[data-pocket-theme="light"] .theme-picker-check {
  color: #188A36 !important;
}
html[data-pocket-theme="light"] .theme-picker-option:active,
html[data-pocket-theme="light"] .theme-picker-button:active {
  background: #E9EEF2 !important;
}
@media (max-width: 768px) {
  /* Mobile dashboard: avoid CSS-grid row stretching that creates blank space beside
     taller widgets. Keep Spending and Recent transactions readable at full width,
     then return to the compact two-column layout for the smaller cards. */
  .widget-grid {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    align-items: start !important;
    gap: 12px !important;
  }

  .widget-grid > * {
    min-width: 0 !important;
    align-self: start !important;
  }

  .widget-grid > :nth-child(2),
  .widget-grid > :nth-child(3) {
    grid-column: 1 / -1 !important;
    width: 100% !important;
  }

  .widget-grid > :nth-child(4),
  .widget-grid > :nth-child(5),
  .widget-grid > :nth-child(6),
  .widget-grid > :nth-child(7) {
    grid-column: auto !important;
    width: 100% !important;
  }
}

`;

const styles = {
  app: {
    display: "flex",
    minHeight: "100vh",
    background: "#0E1013",
    color: "#ECEAE3",
    fontFamily: "Inter, sans-serif",
  },
  sidebar: {
    width: 252,
    height: "100vh",
    maxHeight: "100vh",
    position: "sticky",
    top: 0,
    alignSelf: "flex-start",
    borderRight: "1px solid #22262E",
    padding: "28px 16px 18px",
    flexShrink: 0,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "#0D0F12",
  },
  brand: { display: "flex", alignItems: "center", gap: 10, padding: "0 10px" },
  brandMark: {
    width: 32,
    height: 32,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#17321D",
    color: "#4FE36B",
    border: "1px solid #285C35",
  },
  brandText: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 21,
    fontWeight: 700,
    letterSpacing: -0.5,
    color: "#F4F2EC",
  },
  welcomeBlock: { padding: "54px 12px 30px" },
  welcomeSmall: { color: "#7D828C", fontSize: 14, marginBottom: 3 },
  welcomeName: {
    color: "#F4F2EC",
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 30,
    fontWeight: 600,
    letterSpacing: -1,
  },
  welcomeCopy: {
    color: "#7D828C",
    fontSize: 12,
    marginTop: 7,
    lineHeight: 1.5,
  },
  navLabel: {
    fontSize: 9,
    letterSpacing: "0.16em",
    color: "#535862",
    fontWeight: 600,
    padding: "0 12px 8px",
  },
  nav: { display: "flex", flexDirection: "column", gap: 3 },
  navItem: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "10px 11px",
    borderRadius: 9,
    border: "none",
    fontSize: 13,
    fontFamily: "Inter, sans-serif",
    cursor: "pointer",
    textAlign: "left",
    transition: "all .18s ease",
  },
  navKey: {
    fontSize: 9,
    color: "#555A64",
    background: "#171A1F",
    border: "1px solid #272B33",
    borderRadius: 5,
    padding: "2px 5px",
    fontFamily: "Inter, sans-serif",
  },
  navDivider: { height: 1, background: "#22262E", margin: "20px 10px 18px" },
  sidebarSpacer: { flex: 1 },
  profileCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
    width: "100%",
    padding: 10,
    borderRadius: 13,
    border: "1px solid #242830",
    background: "#15181D",
    color: "#ECEAE3",
    cursor: "pointer",
    textAlign: "left",
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    background: "#313640",
    color: "#F4F2EC",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 13,
  },
  profileName: { fontSize: 12, fontWeight: 600 },
  profilePlan: { fontSize: 10, color: "#69707A", marginTop: 2 },
  main: { flex: 1, minWidth: 0, maxWidth: "100%" },
  topBar: {
    display: "grid",
    gridTemplateColumns: "minmax(280px, 1fr) auto",
    alignItems: "center",
    gap: 14,
    padding: "24px 32px 12px",
    position: "sticky",
    top: 0,
    zIndex: 5,
    background: "rgba(14,16,19,.92)",
    backdropFilter: "blur(16px)",
  },
  globalSearch: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: 46,
    padding: "0 10px 0 15px",
    borderRadius: 14,
    border: "1px solid #292D35",
    background: "#14171B",
    color: "#777C85",
    fontSize: 13,
    cursor: "pointer",
    minWidth: 0,
  },
  searchKey: {
    color: "#8A8F98",
    background: "#20242A",
    border: "1px solid #2F343D",
    borderRadius: 7,
    padding: "5px 8px",
    fontSize: 10,
    fontFamily: "Inter, sans-serif",
  },
  topActions: { display: "flex", alignItems: "center", gap: 8 },
  iconTopBtn: {
    width: 42,
    height: 42,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    border: "1px solid #292D35",
    background: "#14171B",
    color: "#858A94",
    cursor: "pointer",
  },
  datePill: {
    padding: "8px 13px",
    borderRadius: 12,
    border: "1px solid #292D35",
    background: "#14171B",
    minWidth: 150,
  },
  datePillText: { fontSize: 11, color: "#E7E5DF" },
  datePillSub: { fontSize: 9, color: "#616771", marginTop: 2 },
  utilityRow: {
    gridColumn: "1 / -1",
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    minHeight: 30,
  },
  primaryBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    background: "#4FE36B",
    color: "#08120B",
    border: "none",
    borderRadius: 10,
    padding: "10px 15px",
    fontSize: 12,
    fontWeight: 700,
    fontFamily: "Inter, sans-serif",
    cursor: "pointer",
  },
  secondaryBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#14171B",
    color: "#C4A55C",
    border: "1px solid #3A3425",
    borderRadius: 9,
    padding: "8px 11px",
    fontSize: 11,
    fontFamily: "Inter, sans-serif",
    cursor: "pointer",
  },
  dashboardPage: {
    padding: "16px 32px 42px",
    maxWidth: 1500,
    margin: "0 auto",
  },
  heroGrid: {
    display: "grid",
    gridTemplateColumns: "1.35fr 1fr",
    gap: 14,
    marginBottom: 14,
  },
  netWorthCard: {
    minHeight: 245,
    borderRadius: 18,
    border: "1px solid #292D35",
    background: "linear-gradient(145deg,#191D22,#121519)",
    padding: 24,
    position: "relative",
    overflow: "hidden",
  },
  cardEyebrow: {
    fontSize: 9,
    letterSpacing: "0.15em",
    color: "#777C85",
    fontWeight: 700,
  },
  netWorthValue: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 48,
    lineHeight: 1,
    marginTop: 12,
    letterSpacing: -2,
    color: "#F4F2EC",
  },
  netWorthTrend: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    marginTop: 13,
    color: "#4FE36B",
    fontSize: 11,
  },
  sparkline: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 24,
    height: 65,
    borderBottom: "1px solid #242830",
    background: "linear-gradient(180deg,transparent,#121519)",
  },
  sparkDot: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#4FE36B",
    boxShadow: "0 0 0 4px rgba(79,227,107,.10)",
    transform: "translate(-50%,-50%)",
  },
  sparkEmpty: {
    position: "absolute",
    bottom: 5,
    left: 0,
    color: "#4D535D",
    fontSize: 10,
  },
  monthCard: {
    minHeight: 245,
    borderRadius: 18,
    border: "1px solid #292D35",
    background: "#171A1F",
    padding: 24,
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  monthTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 23,
    fontWeight: 600,
    marginTop: 7,
  },
  metricRows: { marginTop: 34, display: "grid", gap: 16 },
  widgetGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3,minmax(0,1fr))",
    gap: 14,
  },
  dashboardLinkWidget: {
    width: "100%",
    textAlign: "left",
    color: "inherit",
    cursor: "pointer",
    transition:
      "transform 160ms ease, border-color 160ms ease, background 160ms ease",
  },
  widget: {
    border: "1px solid #292D35",
    borderRadius: 17,
    background: "#171A1F",
    padding: 18,
    minWidth: 0,
    overflow: "hidden",
  },
  widgetHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 14,
  },
  widgetTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 14,
    fontWeight: 600,
    color: "#F0EEE8",
  },
  widgetSub: { fontSize: 10, color: "#626872", marginTop: 4 },
  widgetMore: { color: "#646A74", fontSize: 12, letterSpacing: 2 },
  linkBtn: {
    background: "transparent",
    border: "none",
    color: "#8A909A",
    fontSize: 10,
    cursor: "pointer",
  },
  categoryRow: {
    display: "grid",
    gridTemplateColumns: "90px 1fr 62px",
    gap: 8,
    alignItems: "center",
    margin: "13px 0",
  },
  categoryName: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 11,
    color: "#A8ACB4",
    minWidth: 0,
  },
  categoryDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  categoryBarTrack: {
    height: 7,
    background: "#292D35",
    borderRadius: 10,
    overflow: "hidden",
  },
  categoryBar: { height: "100%", borderRadius: 10 },
  categoryAmount: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "#D8D5CE",
    textAlign: "right",
  },
  reminderDashboardRow: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "10px 0",
    borderBottom: "1px solid #23272F",
  },
  reminderDashboardDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#4FE36B",
    flexShrink: 0,
  },
  reminderDashboardTitle: {
    flex: 1,
    minWidth: 0,
    color: "#E4E7EB",
    fontSize: 11,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  reminderDashboardDate: {
    color: "#858D98",
    fontSize: 10,
    whiteSpace: "nowrap",
  },
  ledgerRow: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "10px 0",
    borderBottom: "1px solid #23272F",
  },
  ledgerCategory: {
    color: "#E8E5DE",
    fontSize: 11,
    fontFamily: "Inter, sans-serif",
  },
  ledgerMeta: {
    color: "#5F656F",
    fontSize: 9,
    fontFamily: "Inter, sans-serif",
    marginTop: 2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  ledgerAmount: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  iconBtn: {
    background: "transparent",
    border: "none",
    color: "#5F656F",
    cursor: "pointer",
    padding: 4,
    display: "flex",
  },
  budgetRingWrap: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    padding: "14px 0 18px",
  },
  budgetRing: {
    width: 92,
    height: 92,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  budgetRingInner: {
    width: 68,
    height: 68,
    borderRadius: "50%",
    background: "#171A1F",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 20,
  },
  budgetRingInnerSpan: { fontSize: 10 },
  budgetBig: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 22,
    color: "#F0EEE8",
  },
  miniBudget: {
    display: "flex",
    justifyContent: "space-between",
    padding: "9px 0",
    borderTop: "1px solid #242830",
    color: "#9297A0",
    fontSize: 10,
  },
  accountRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 0",
    borderBottom: "1px solid #242830",
    color: "#B0B4BC",
    fontSize: 11,
  },
  accountRowStrong: { fontFamily: "'IBM Plex Mono', monospace" },
  accountDot: { width: 7, height: 7, borderRadius: "50%" },
  goalRow: { padding: "10px 0", borderBottom: "1px solid #242830" },
  goalLine: {
    display: "flex",
    justifyContent: "space-between",
    color: "#A8ACB4",
    fontSize: 10,
    marginBottom: 7,
  },
  progressTrack: {
    height: 5,
    background: "#242830",
    borderRadius: 5,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 5 },
  modulePage: { padding: "46px 32px", maxWidth: 1100, margin: "0 auto" },
  moduleHero: {
    display: "flex",
    gap: 18,
    alignItems: "center",
    padding: 26,
    borderRadius: 18,
    border: "1px solid #292D35",
    background: "#171A1F",
  },
  moduleIcon: {
    width: 54,
    height: 54,
    borderRadius: 14,
    background: "#18231B",
    color: "#4FE36B",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  moduleEyebrow: { color: "#656B75", fontSize: 9, letterSpacing: "0.15em" },
  moduleTitle: {
    margin: "7px 0 4px",
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 36,
    letterSpacing: -1,
  },
  moduleCopy: { color: "#747A84", fontSize: 12, margin: 0 },
  placeholderGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2,1fr)",
    gap: 14,
    marginTop: 14,
  },
  placeholderCard: {
    display: "grid",
    gridTemplateColumns: "24px 1fr",
    columnGap: 10,
    rowGap: 5,
    padding: 18,
    borderRadius: 15,
    border: "1px solid #292D35",
    background: "#14171B",
    color: "#8D929B",
  },
  commandOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 100,
    background: "rgba(4,6,8,.72)",
    backdropFilter: "blur(15px)",
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    paddingTop: "10vh",
  },
  commandPanel: {
    width: "min(620px, calc(100vw - 28px))",
    background: "#171A1F",
    border: "1px solid #343944",
    borderRadius: 16,
    boxShadow: "0 30px 90px rgba(0,0,0,.5)",
    overflow: "hidden",
  },
  commandSearchRow: {
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: 15,
    borderBottom: "1px solid #292D35",
  },
  commandInput: {
    flex: 1,
    minWidth: 0,
    border: "none",
    outline: "none",
    background: "transparent",
    color: "#F0EEE8",
    fontSize: 14,
  },
  commandEsc: {
    fontSize: 9,
    color: "#666C76",
    border: "1px solid #30353E",
    borderRadius: 5,
    padding: "4px 6px",
  },
  commandLabel: {
    color: "#555B65",
    fontSize: 9,
    letterSpacing: "0.16em",
    padding: "13px 15px 7px",
  },
  commandItem: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "11px 15px",
    border: "none",
    background: "transparent",
    color: "#ECEAE3",
    textAlign: "left",
    cursor: "pointer",
  },
  commandIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: "#20242B",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#8D929B",
  },
  panel: {
    background: "#171A1F",
    border: "1px solid #292D35",
    borderRadius: 12,
    padding: 20,
    minWidth: 0,
    boxSizing: "border-box",
  },
  panelTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 13,
    fontWeight: 600,
    color: "#ECEAE3",
    marginBottom: 14,
    marginTop: 22,
  },
  statLabel: {
    fontSize: 11,
    color: "#8B8F98",
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  statValue: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 20,
    fontWeight: 500,
  },
  accountCard: {
    background: "#1C1F26",
    border: "1px solid #22262E",
    borderRadius: 8,
    padding: 16,
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(10,11,14,.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  modal: {
    background: "#1A1D24",
    border: "1px solid #2A2E37",
    borderRadius: 12,
    padding: 24,
    width: "min(340px,92vw)",
    maxHeight: "85vh",
    overflowY: "auto",
    boxSizing: "border-box",
  },
  toggleBtn: {
    flex: 1,
    padding: "8px 0",
    borderRadius: 6,
    border: "1px solid #2A2E37",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "Inter, sans-serif",
    cursor: "pointer",
  },
  input: {
    width: "100%",
    background: "#14161B",
    border: "1px solid #2A2E37",
    borderRadius: 6,
    padding: "9px 10px",
    color: "#ECEAE3",
    fontSize: 13,
    fontFamily: "Inter, sans-serif",
    outline: "none",
    boxSizing: "border-box",
  },
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#14161B",
    border: "1px solid #2A2E37",
    borderRadius: 6,
    padding: "8px 10px",
  },
  searchInput: {
    background: "transparent",
    border: "none",
    outline: "none",
    color: "#ECEAE3",
    fontSize: 13,
    fontFamily: "Inter, sans-serif",
    flex: 1,
  },
  filterSelect: {
    background: "#14161B",
    border: "1px solid #2A2E37",
    borderRadius: 6,
    padding: "8px 10px",
    color: "#ECEAE3",
    fontSize: 12,
    fontFamily: "Inter, sans-serif",
  },
  iconOnlyBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    color: "#8B8F98",
    border: "1px solid #2A2E37",
    borderRadius: 6,
    width: 32,
    height: 32,
    cursor: "pointer",
  },
  scanBanner: {
    background: "#221D14",
    border: "1px solid #3A3423",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 12,
    color: "#C9A455",
    fontFamily: "Inter, sans-serif",
    marginBottom: 14,
    lineHeight: 1.5,
  },
  inlineLinkBtn: {
    background: "none",
    border: "none",
    padding: 0,
    color: "#C9A455",
    textDecoration: "underline",
    fontSize: 12,
    fontFamily: "Inter, sans-serif",
    cursor: "pointer",
  },
  dropZone: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    border: "1px dashed #2A2E37",
    borderRadius: 10,
    padding: "32px 16px",
    cursor: "pointer",
    background: "#14161B",
  },
  previewImg: {
    width: "100%",
    maxHeight: 260,
    objectFit: "contain",
    borderRadius: 8,
    border: "1px solid #2A2E37",
    background: "#0F1114",
  },
};
