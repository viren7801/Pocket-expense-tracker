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
} from "lucide-react";
import { scanReceipt } from "./receiptScan";
import PasswordsView from "./PasswordsView";
import NotesView from "./NotesView";
import ShareView from "./ShareView";

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

function fmtINR(n) {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.round(n));
  return sign + "₹" + abs.toLocaleString("en-IN");
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function LedgerApp() {
  const [loaded, setLoaded] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [goals, setGoals] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [categories, setCategories] = useState(SEED_CATEGORIES);
  const [passwordVault, setPasswordVault] = useState(null);
  const [notesVault, setNotesVault] = useState(null);
  const [tab, setTab] = useState("dashboard");
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
      <style>{fontImports}</style>
      <Sidebar tab={tab} setTab={setTab} />
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
          onProfileClick={() => setTab("accounts")}
          saveError={saveError}
        />
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
            monthIncome={monthIncome}
            monthExpense={monthExpense}
            onAddTxn={() => {
              setEditingTxn(null);
              setTxnPrefill(null);
              setShowTxnForm(true);
            }}
            onViewTransactions={() => setTab("transactions")}
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
        {tab === "passwords" && (
          <PasswordsView
            vault={passwordVault}
            onVaultChange={setPasswordVault}
          />
        )}
        {tab === "notes" && (
          <NotesView vault={notesVault} onVaultChange={setNotesVault} />
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

function Sidebar({ tab, setTab }) {
  const primary = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, key: "D" },
    { id: "transactions", label: "Pocket", icon: Wallet, key: "P" },
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
      <button style={styles.profileCard} onClick={() => setTab("accounts")}>
        <div style={styles.avatar}>V</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={styles.profileName}>Viren Patel</div>
          <div style={styles.profilePlan}>Personal space</div>
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
  saveError,
}) {
  return (
    <header style={styles.topBar} className="ledger-topbar">
      <div className="mobile-dashboard-header">
        <div>
          <div className="mobile-greeting">
            Hello, Viren <span>👋</span>
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

      <div style={styles.topActions}>
        <button
          style={styles.iconTopBtn}
          title="Command center"
          onClick={onSearch}
        >
          <Command size={17} />
        </button>
        <button style={styles.iconTopBtn} title="Appearance">
          <Sun size={17} />
        </button>
        <button style={styles.iconTopBtn} title="Notifications">
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

function CommandPalette({ onClose, onNavigate }) {
  const items = [
    ["dashboard", "Dashboard", LayoutDashboard],
    ["transactions", "Pocket", Wallet],
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
  monthIncome,
  monthExpense,
  onAddTxn,
  onViewTransactions,
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

        <div style={styles.widget}>
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
        </div>

        <div style={styles.widget}>
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
            transactions
              .slice(0, 5)
              .map((t) => (
                <LedgerRow
                  key={t.id}
                  t={t}
                  accountLabel={accountName(t.accountId)}
                  onEdit={() => onEdit(t)}
                />
              ))
          )}
        </div>

        <div style={styles.widget}>
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
        </div>

        <div style={styles.widget}>
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
        </div>

        <div style={styles.widget}>
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
        </div>
      </section>

      <section style={styles.quickRow} className="quickRow">
        <button style={styles.quickCard} onClick={onAddTxn}>
          <div style={styles.quickIcon}>
            <Plus size={19} />
          </div>
          <div>
            <strong>Add transaction</strong>
            <span>Record income or expense</span>
          </div>
          <ChevronRight size={16} />
        </button>
        <button style={styles.quickCard} onClick={onScanClick}>
          <div style={styles.quickIcon}>
            <Receipt size={19} />
          </div>
          <div>
            <strong>Scan receipt</strong>
            <span>Turn a receipt into an entry</span>
          </div>
          <ChevronRight size={16} />
        </button>
        <button style={styles.quickCard} onClick={() => onViewTransactions()}>
          <div style={styles.quickIcon}>
            <Settings size={19} />
          </div>
          <div>
            <strong>Manage Pocket</strong>
            <span>Accounts, budgets and goals</span>
          </div>
          <ChevronRight size={16} />
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
        onClick={onEdit}
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
        <button onClick={onEdit} style={styles.iconBtn} title="Edit">
          <Pencil size={13} />
        </button>
      )}
      {onDelete && (
        <button onClick={onDelete} style={styles.iconBtn} title="Delete">
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

function SettingsModal({ onClose }) {
  const [key, setKey] = useState(getApiKey());
  const [saved, setSaved] = useState(false);

  return (
    <ModalShell title="Claude API key" onClose={onClose}>
      <div
        style={{
          fontSize: 12,
          color: "#8B8F98",
          fontFamily: "Inter, sans-serif",
          marginBottom: 14,
          lineHeight: 1.5,
        }}
      >
        Used only in your browser to call Claude's API for receipt scanning.
        Stored locally on this device — it's never sent anywhere except
        api.anthropic.com. Get a key from your Claude Console account.
      </div>
      <Field label="API key">
        <input
          type="password"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setSaved(false);
          }}
          style={styles.input}
          placeholder="sk-ant-…"
        />
      </Field>
      <button
        style={{
          ...styles.primaryBtn,
          width: "100%",
          justifyContent: "center",
          marginTop: 10,
        }}
        onClick={() => {
          setApiKey(key);
          setSaved(true);
        }}
      >
        {saved ? "Saved" : "Save key"}
      </button>
    </ModalShell>
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

const fontImports = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap');
.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

@media (max-width: 1023px) and (min-width: 769px) {
  .ledger-sidebar { width: 210px !important; }
  .hero-grid { grid-template-columns: 1fr !important; }
  .widget-grid { grid-template-columns: repeat(2,minmax(0,1fr)) !important; }
  .widget-span-2 { grid-column: span 2 !important; }
}

.mobile-dashboard-header, .mobile-quick-actions, .mobile-bottom-nav { display: none; }

@media (max-width: 768px) {
  html, body, #root { width:100%; max-width:100%; overflow-x:hidden; background:#0E1013; }
  .ledger-app { display:block !important; min-height:100dvh !important; width:100% !important; overflow-x:hidden !important; }
  .ledger-sidebar { display:none !important; }
  .ledger-app > main { width:100% !important; min-width:0 !important; padding-bottom: calc(92px + env(safe-area-inset-bottom)) !important; }

  .ledger-topbar { display:block !important; position:relative !important; top:auto !important; padding:26px 22px 8px !important; background:#0E1013 !important; backdrop-filter:none !important; }
  .mobile-dashboard-header { display:flex !important; align-items:center; justify-content:space-between; margin-bottom:22px; }
  .mobile-greeting { font-family:'Space Grotesk',sans-serif; font-size:32px; line-height:1.1; font-weight:600; letter-spacing:-1.2px; color:#F4F2EC; }
  .mobile-subtitle { margin-top:7px; font-size:16px; color:#8B919B; }
  .mobile-avatar-button { width:56px; height:56px; flex:0 0 56px; border-radius:50%; border:1px solid rgba(201,164,85,.4); background:linear-gradient(145deg,#E3BE63,#A97E30); color:#18140C; font-size:21px; font-weight:700; cursor:pointer; }

  .ledger-topbar .globalSearch, .ledger-topbar .global-search { width:100% !important; height:64px !important; border-radius:20px !important; font-size:17px !important; padding:0 16px !important; box-sizing:border-box !important; }
  .ledger-topbar .topActions { display:none !important; }
  .mobile-quick-actions { display:grid !important; grid-template-columns:repeat(5,minmax(0,1fr)); gap:10px; margin:20px 0 18px; }
  .mobile-quick-action { border:0; background:transparent; color:#C8CBD2; min-width:0; padding:0; display:flex; flex-direction:column; align-items:center; gap:8px; font-size:13px; font-family:Inter,sans-serif; cursor:pointer; }
  .mobile-quick-action::first-line { color:inherit; }
  .mobile-quick-action svg, .mobile-quick-action > span:first-child { width:58px; height:58px; padding:0; display:flex; align-items:center; justify-content:center; border-radius:18px; border:1px solid #2B313B; background:#171B21; box-sizing:border-box; }
  .mobile-quick-action span:last-child { white-space:nowrap; font-size:13px; }
  .mobile-add-action { color:#75DD8A; font-weight:600; }
  .mobile-add-action svg { width:66px !important; height:66px !important; padding:17px !important; border:0 !important; border-radius:21px !important; background:#51D96B !important; color:#0D1810; box-shadow:0 12px 28px rgba(79,227,107,.16); }
  .mobile-add-action span:last-child { color:#75DD8A; }
  .ledger-utility-row { display:none !important; }

  .ledger-page, .modulePage { width:100% !important; min-width:0 !important; max-width:100% !important; box-sizing:border-box !important; padding:10px 22px 26px !important; }
  .ledger-grid-3, .ledger-grid-main, .hero-grid { grid-template-columns:1fr !important; width:100% !important; min-width:0 !important; }
  .ledger-grid-3 > *, .ledger-grid-main > *, .hero-grid > * { min-width:0 !important; max-width:100% !important; }
  .widget-grid { grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:12px !important; }
  .widget-span-2 { grid-column:span 2 !important; }
  .quickRow { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
  .placeholderGrid { grid-template-columns:1fr !important; }
  .recharts-responsive-container { min-width:0 !important; max-width:100% !important; }

  .mobile-bottom-nav { position:fixed; z-index:100; left:12px; right:12px; bottom:calc(10px + env(safe-area-inset-bottom)); height:70px; display:flex !important; align-items:center; justify-content:space-around; padding:0 7px; border:1px solid #29303A; border-radius:24px; background:rgba(20,23,29,.96); backdrop-filter:blur(20px); box-shadow:0 18px 48px rgba(0,0,0,.42); }
  .mobile-bottom-nav button { appearance:none; border:0; background:transparent; color:#89909B; min-width:52px; height:56px; padding:4px 3px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; font-family:Inter,sans-serif; font-size:9px; cursor:pointer; }
  .mobile-bottom-nav button.active { color:#69DE7F; }
  .mobile-bottom-nav .mobile-bottom-add { width:52px; height:52px; min-width:52px; border-radius:18px; background:#51D96B; color:#0E1810; transform:translateY(-13px); box-shadow:0 10px 28px rgba(79,227,107,.22); }
}

@media (max-width: 430px) {
  .ledger-topbar { padding-left:18px !important; padding-right:18px !important; }
  .ledger-page, .modulePage { padding-left:18px !important; padding-right:18px !important; }
  .mobile-greeting { font-size:28px; }
  .mobile-avatar-button { width:50px; height:50px; flex-basis:50px; font-size:19px; }
  .mobile-quick-actions { gap:7px; }
  .mobile-quick-action svg, .mobile-quick-action > span:first-child { width:52px; height:52px; border-radius:16px; }
  .mobile-add-action svg { width:60px !important; height:60px !important; border-radius:19px !important; padding:14px !important; }
  .mobile-quick-action span:last-child { font-size:12px; }
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
    borderRight: "1px solid #22262E",
    padding: "28px 16px 18px",
    flexShrink: 0,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
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
  quickRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3,1fr)",
    gap: 14,
    marginTop: 14,
  },
  quickCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    border: "1px solid #292D35",
    background: "#13161A",
    color: "#ECEAE3",
    textAlign: "left",
    cursor: "pointer",
  },
  quickIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    background: "#18231B",
    color: "#4FE36B",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  quickCardStrong: { fontSize: 11 },
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
