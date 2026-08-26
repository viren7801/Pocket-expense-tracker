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
} from "lucide-react";
import { scanReceipt } from "./receiptScan";

const SEED_CATEGORIES = {
  income: ["Salary", "Business", "Freelance", "Investment", "Other Income"],
  expense: [
    "Food",
    "Transport",
    "Shopping",
    "Bills",
    "Health",
    "Entertainment",
    "Rent",
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
  const [tab, setTab] = useState("dashboard");
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
        });
        setSaveError(false);
      } catch (e) {
        setSaveError(true);
      }
    })();
  }, [accounts, transactions, budgets, goals, recurring, categories, loaded]);

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
          onAddTxn={() => {
            setEditingTxn(null);
            setTxnPrefill(null);
            setShowTxnForm(true);
          }}
          onExport={exportCSV}
          onImportClick={() => fileInputRef.current?.click()}
          onScanClick={() => setShowScanModal(true)}
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
        {tab === "recurring" && (
          <RecurringView
            recurring={recurring}
            accountName={accountName}
            onAdd={() => setShowRecurringForm(true)}
            onDelete={deleteRecurring}
          />
        )}
      </main>

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
  const items = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "transactions", label: "Ledger", icon: Receipt },
    { id: "accounts", label: "Accounts", icon: Landmark },
    { id: "budgets", label: "Budgets", icon: Target },
    { id: "goals", label: "Goals", icon: PiggyBank },
    { id: "recurring", label: "Recurring", icon: Repeat },
  ];
  return (
    <aside style={styles.sidebar} className="ledger-sidebar">
      <div style={styles.brand} className="brand">
        <Wallet size={20} color="#C9A455" />
        <span style={styles.brandText}>Ledger</span>
      </div>
      <nav
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          marginTop: 24,
        }}
        className="ledger-nav"
      >
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              ...styles.navItem,
              background: tab === id ? "#1F232B" : "transparent",
              color: tab === id ? "#ECEAE3" : "#8B8F98",
              borderLeft:
                tab === id ? "2px solid #C9A455" : "2px solid transparent",
            }}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

function TopBar({
  netWorth,
  monthIncome,
  monthExpense,
  onAddTxn,
  onExport,
  onImportClick,
  onScanClick,
  onSettingsClick,
  saveError,
}) {
  return (
    <div style={styles.topBar} className="ledger-topbar">
      <div
        style={{ display: "flex", gap: 32, flexWrap: "wrap" }}
        className="ledger-stats"
      >
        <Stat label="Net worth" value={fmtINR(netWorth)} color="#ECEAE3" />
        <Stat
          label="Income this month"
          value={fmtINR(monthIncome)}
          color="#4FA98C"
        />
        <Stat
          label="Expense this month"
          value={fmtINR(monthExpense)}
          color="#D9735C"
        />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
        className="ledger-actions"
      >
        {saveError && (
          <span
            style={{
              fontSize: 11,
              color: "#D9735C",
              fontFamily: "Inter, sans-serif",
            }}
          >
            Not saved — storage unavailable
          </span>
        )}
        <button
          style={styles.secondaryBtn}
          onClick={onImportClick}
          title="Import CSV"
        >
          <Upload size={14} /> Import
        </button>
        <button
          style={styles.secondaryBtn}
          onClick={onExport}
          title="Export CSV"
        >
          <Download size={14} /> Export
        </button>
        <button
          style={styles.secondaryBtn}
          onClick={onScanClick}
          title="Scan a receipt"
        >
          <Camera size={14} /> Scan receipt
        </button>
        <button style={styles.primaryBtn} onClick={onAddTxn}>
          <Plus size={15} /> Add entry
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, color }}>{value}</div>
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
  onEdit,
}) {
  return (
    <div style={{ padding: "0 32px 32px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
          marginBottom: 20,
        }}
        className="ledger-grid-3"
      >
        <InsightCard
          label="Savings rate this month"
          value={savingsRate === null ? "—" : `${savingsRate}%`}
          hint={
            savingsRate === null
              ? "No income logged yet"
              : savingsRate >= 0
                ? "of income kept"
                : "spent beyond income"
          }
          tone={
            savingsRate === null ? "neutral" : savingsRate >= 0 ? "good" : "bad"
          }
        />
        <InsightCard
          label="Spending vs last month"
          value={
            expenseChangePct === null
              ? "—"
              : `${expenseChangePct > 0 ? "+" : ""}${expenseChangePct}%`
          }
          hint={
            expenseChangePct === null
              ? "Not enough history"
              : expenseChangePct > 0
                ? "higher than last month"
                : "lower than last month"
          }
          tone={
            expenseChangePct === null
              ? "neutral"
              : expenseChangePct > 0
                ? "bad"
                : "good"
          }
        />
        <InsightCard
          label="Top category this month"
          value={topCategory ? topCategory[0] : "—"}
          hint={
            topCategory ? fmtINR(topCategory[1]) + " spent" : "No expenses yet"
          }
          tone="neutral"
        />
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}
        className="ledger-grid-main"
      >
        <div style={styles.panel}>
          <div style={{ ...styles.panelTitle, marginTop: 0 }}>
            Cash flow, last 6 months
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={trendData}>
              <CartesianGrid stroke="#232730" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#8B8F98"
                fontSize={12}
                tickLine={false}
                axisLine={{ stroke: "#232730" }}
              />
              <YAxis
                stroke="#8B8F98"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `₹${Math.round(v / 1000)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: "#1C1F26",
                  border: "1px solid #2A2E37",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "#ECEAE3" }}
                formatter={(v, k) => [
                  fmtINR(v),
                  k === "income" ? "Income" : "Expense",
                ]}
              />
              <Line
                type="monotone"
                dataKey="income"
                stroke="#4FA98C"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="expense"
                stroke="#D9735C"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>

          <div style={styles.panelTitle}>Net worth trend</div>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={netWorthTrend}>
              <CartesianGrid stroke="#232730" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#8B8F98"
                fontSize={12}
                tickLine={false}
                axisLine={{ stroke: "#232730" }}
              />
              <YAxis
                stroke="#8B8F98"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `₹${Math.round(v / 1000)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: "#1C1F26",
                  border: "1px solid #2A2E37",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "#ECEAE3" }}
                formatter={(v) => [fmtINR(v), "Net worth"]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#C9A455"
                strokeWidth={2}
                dot={{ r: 3, fill: "#C9A455" }}
              />
            </LineChart>
          </ResponsiveContainer>

          <div style={styles.panelTitle}>Recent entries</div>
          <div>
            {transactions.length === 0 && (
              <EmptyRow text="No entries yet. Add your first one." />
            )}
            {transactions.map((t) => (
              <LedgerRow
                key={t.id}
                t={t}
                accountLabel={accountName(t.accountId)}
                onEdit={() => onEdit(t)}
              />
            ))}
          </div>
        </div>

        <div style={styles.panel}>
          <div style={{ ...styles.panelTitle, marginTop: 0 }}>
            Spending by category — this month
          </div>
          {categoryBreakdown.length === 0 && (
            <EmptyRow text="No expenses logged this month." />
          )}
          {categoryBreakdown.length > 0 && (
            <ResponsiveContainer
              width="100%"
              height={Math.max(160, categoryBreakdown.length * 34)}
            >
              <BarChart
                data={categoryBreakdown}
                layout="vertical"
                margin={{ left: 8, right: 24 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="category"
                  width={90}
                  stroke="#8B8F98"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1C1F26",
                    border: "1px solid #2A2E37",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v) => fmtINR(v)}
                />
                <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={14}>
                  {categoryBreakdown.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function InsightCard({ label, value, hint, tone }) {
  const color =
    tone === "good" ? "#4FA98C" : tone === "bad" ? "#D9735C" : "#ECEAE3";
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
  const [accountId, setAccountId] = useState(
    seed?.accountId || accounts[0]?.id || "",
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
              if (!categories[tp].includes(category))
                setCategory(categories[tp][0]);
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
        <input
          list="cat-list"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={styles.input}
          placeholder="Type or pick a category"
        />
        <datalist id="cat-list">
          {cats.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="Account">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          style={styles.input}
        >
          {accounts.map((a) => (
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
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
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
              if (!categories[tp].includes(category))
                setCategory(categories[tp][0]);
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
        <input
          list="rec-cat-list"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={styles.input}
        />
        <datalist id="rec-cat-list">
          {cats.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="Account">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          style={styles.input}
        >
          {accounts.map((a) => (
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

@media (max-width: 768px) {
  .ledger-app { flex-direction: column !important; }

  .ledger-sidebar {
    width: 100% !important;
    border-right: none !important;
    border-bottom: 1px solid #22262E !important;
    padding: 12px !important;
    flex-shrink: 1 !important;
  }
  .ledger-sidebar .brand { display: none !important; }
  .ledger-nav {
    flex-direction: row !important;
    overflow-x: auto !important;
    gap: 2px !important;
    margin-top: 0 !important;
    -webkit-overflow-scrolling: touch;
  }
  .ledger-nav button {
    flex: 0 0 auto !important;
    white-space: nowrap !important;
    border-left: none !important;
    border-bottom: 2px solid transparent !important;
    padding: 8px 10px !important;
  }

  .ledger-topbar {
    padding: 16px !important;
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 12px !important;
  }
  .ledger-stats {
    gap: 16px !important;
    justify-content: space-between !important;
  }
  .ledger-actions {
    justify-content: stretch !important;
  }
  .ledger-actions button {
    flex: 1 1 auto !important;
    justify-content: center !important;
    font-size: 12px !important;
    padding: 9px 10px !important;
  }

  .ledger-page { padding: 0 14px 20px !important; }

  .ledger-grid-3, .ledger-grid-main {
    grid-template-columns: 1fr !important;
  }
}

@media (max-width: 420px) {
  .ledger-stats { gap: 10px 16px !important; }
}
`;

const styles = {
  app: {
    display: "flex",
    minHeight: "100vh",
    background: "#14161B",
    fontFamily: "Inter, sans-serif",
  },
  sidebar: {
    width: 200,
    borderRight: "1px solid #22262E",
    padding: "24px 12px",
    flexShrink: 0,
  },
  brand: { display: "flex", alignItems: "center", gap: 8, padding: "0 12px" },
  brandText: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 16,
    fontWeight: 600,
    color: "#ECEAE3",
    letterSpacing: 0.2,
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    borderRadius: 6,
    border: "none",
    background: "transparent",
    fontSize: 13,
    fontFamily: "Inter, sans-serif",
    cursor: "pointer",
    textAlign: "left",
  },
  main: { flex: 1, minWidth: 0 },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "28px 32px",
    flexWrap: "wrap",
    gap: 16,
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
  primaryBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#C9A455",
    color: "#14161B",
    border: "none",
    borderRadius: 6,
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "Inter, sans-serif",
    cursor: "pointer",
  },
  secondaryBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    color: "#C9A455",
    border: "1px solid #3A3423",
    borderRadius: 6,
    padding: "7px 12px",
    fontSize: 12,
    fontFamily: "Inter, sans-serif",
    cursor: "pointer",
  },
  chipBtn: {
    background: "#1C1F26",
    color: "#8B8F98",
    border: "1px solid #2A2E37",
    borderRadius: 5,
    padding: "5px 8px",
    fontSize: 11,
    fontFamily: "Inter, sans-serif",
    cursor: "pointer",
  },
  panel: {
    background: "#1A1D24",
    border: "1px solid #22262E",
    borderRadius: 10,
    padding: 20,
  },
  panelTitle: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 13,
    fontWeight: 600,
    color: "#ECEAE3",
    marginBottom: 14,
    marginTop: 22,
  },
  ledgerRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 0",
    borderBottom: "1px solid #20242C",
  },
  ledgerCategory: {
    color: "#ECEAE3",
    fontSize: 13,
    fontFamily: "Inter, sans-serif",
  },
  ledgerMeta: {
    color: "#585C66",
    fontSize: 11,
    fontFamily: "Inter, sans-serif",
    marginTop: 2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  ledgerAmount: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  iconBtn: {
    background: "transparent",
    border: "none",
    color: "#585C66",
    cursor: "pointer",
    padding: 4,
    display: "flex",
  },
  accountCard: {
    background: "#1C1F26",
    border: "1px solid #22262E",
    borderRadius: 8,
    padding: 16,
  },
  progressTrack: {
    height: 5,
    background: "#20242C",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 4 },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(10,11,14,0.6)",
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
    width: "min(340px, 92vw)",
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
