import React, { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Link2,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";

const CATEGORY_META = {
  Personal: { dot: "#C9A455", bg: "rgba(201,164,85,.12)" },
  Finance: { dot: "#4FA98C", bg: "rgba(79,169,140,.12)" },
  Work: { dot: "#7C93C9", bg: "rgba(124,147,201,.12)" },
  Health: { dot: "#D9735C", bg: "rgba(217,115,92,.12)" },
  Other: { dot: "#9B7FC7", bg: "rgba(155,127,199,.12)" },
};

const REPEAT_OPTIONS = [
  ["none", "Does not repeat"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["yearly", "Yearly"],
];

const NOTIFICATION_OPTIONS = [
  ["none", "No notification"],
  ["5", "5 minutes before"],
  ["10", "10 minutes before"],
  ["30", "30 minutes before"],
  ["60", "1 hour before"],
  ["1440", "1 day before"],
];

function pad2(v) {
  return String(v).padStart(2, "0");
}

function toDateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date, amount) {
  const d = new Date(date);
  d.setDate(d.getDate() + amount);
  return d;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatMonth(date) {
  return date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function formatLongDate(dateKey) {
  return parseDateKey(dateKey).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatShortDate(dateKey) {
  return parseDateKey(dateKey).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function formatTime(value) {
  if (!value) return "Any time";
  const [h, m] = value.split(":").map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function sameDate(a, b) {
  return toDateKey(a) === toDateKey(b);
}

function dateSort(a, b) {
  return `${a.date || ""}T${a.time || "23:59"}`.localeCompare(
    `${b.date || ""}T${b.time || "23:59"}`,
  );
}

function makeBlankReminder(dateKey) {
  return {
    title: "",
    description: "",
    date: dateKey,
    time: "09:00",
    repeat: "none",
    category: "Personal",
    notification: "10",
    completed: false,
  };
}

export default function RemindersView({
  reminders,
  onCreate,
  onUpdate,
  onDelete,
  onToggleComplete,
}) {
  const todayKey = toDateKey(new Date());
  const [mode, setMode] = useState("calendar");
  const [calendarMode, setCalendarMode] = useState("month");
  const [cursorMonth, setCursorMonth] = useState(() =>
    startOfMonth(new Date()),
  );
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [detailsId, setDetailsId] = useState(null);
  const [draft, setDraft] = useState(() => makeBlankReminder(todayKey));
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [telegramUsername, setTelegramUsername] = useState("");
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramError, setTelegramError] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...reminders]
      .filter((r) => {
        if (status === "completed" && !r.completed) return false;
        if (status === "open" && r.completed) return false;
        if (!q) return true;
        return [r.title, r.description, r.category]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      })
      .sort(dateSort);
  }, [reminders, query, status]);

  const selectedReminders = useMemo(
    () =>
      filtered
        .filter((r) => r.date === selectedDate)
        .sort((a, b) => {
          if (a.completed !== b.completed) return a.completed ? 1 : -1;
          return dateSort(a, b);
        }),
    [filtered, selectedDate],
  );

  const monthDays = useMemo(() => {
    const first = startOfMonth(cursorMonth);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [cursorMonth]);

  const weekDays = useMemo(() => {
    const anchor = startOfWeek(parseDateKey(selectedDate));
    return Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
  }, [selectedDate]);

  const upcoming = useMemo(() => {
    const now = new Date();
    return filtered
      .filter(
        (r) =>
          !r.completed &&
          parseDateKey(r.date) >=
            new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      )
      .slice(0, 12);
  }, [filtered]);

  const detailsReminder = reminders.find((r) => r.id === detailsId) || null;

  useEffect(() => {
    let active = true;
    fetch("/api/telegram?action=status")
      .then((response) =>
        response.json().then((data) => ({ ok: response.ok, data })),
      )
      .then(({ ok, data }) => {
        if (!active) return;
        setTelegramConnected(Boolean(ok && data?.connected));
        setTelegramUsername(data?.username || data?.firstName || "");
      })
      .catch(() => {
        if (active) {
          setTelegramConnected(false);
          setTelegramUsername("");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function refreshTelegramStatus() {
    try {
      const response = await fetch("/api/telegram?action=status");
      const data = await response.json();
      const connected = Boolean(response.ok && data?.connected);
      setTelegramConnected(connected);
      setTelegramUsername(data?.username || data?.firstName || "");
      return connected;
    } catch {
      setTelegramConnected(false);
      setTelegramUsername("");
      return false;
    }
  }

  async function connectTelegram() {
    setTelegramBusy(true);
    setTelegramError("");
    try {
      const response = await fetch("/api/telegram?action=connect", {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Could not start Telegram connection.");
      if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
      setTelegramError(
        "Open Telegram and press Start in the Pocket bot, then tap Refresh connection.",
      );
    } catch (error) {
      setTelegramError(error.message || "Could not connect Telegram.");
    } finally {
      setTelegramBusy(false);
    }
  }

  function reminderAtISO(reminder) {
    if (!reminder?.date) return "";
    const localValue = `${reminder.date}T${reminder.time || "09:00"}:00`;
    const parsed = new Date(localValue);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }

  function recurrencePayload(reminder) {
    if (!reminder?.repeat || reminder.repeat === "none")
      return { recurrence: "none" };
    if (reminder.repeat === "daily") return { recurrence: "daily" };
    if (reminder.repeat === "monthly") {
      return {
        recurrence: "monthly",
        recurrenceDay: Number(reminder.date?.slice(-2) || 1),
      };
    }
    if (reminder.repeat === "yearly") return { recurrence: "yearly" };
    const day = parseDateKey(reminder.date).getDay();
    return { recurrence: "weekly", recurrenceDays: [day] };
  }

  async function handleToggleReminder(reminder) {
    const updated = onToggleComplete(reminder.id);
    if (!updated) return;
    try {
      if (updated.completed || !updated.notifyTelegram) {
        await fetch("/api/telegram?action=cancel-pocket-reminder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reminderId: updated.id }),
        });
      } else {
        await syncTelegramReminder(updated);
      }
    } catch (error) {
      setTelegramError(error.message || "Could not update Telegram reminder.");
    }
  }

  async function syncTelegramReminder(reminder) {
    if (!reminder?.id) return;
    if (reminder.notifyTelegram && !reminder.completed) {
      const response = await fetch(
        "/api/telegram?action=schedule-pocket-reminder",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reminderId: reminder.id,
            title: reminder.title,
            reminderAt: reminderAtISO(reminder),
            repeat: reminder.repeat || "none",
            ...recurrencePayload(reminder),
          }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Could not schedule Telegram reminder.");
    } else {
      await fetch("/api/telegram?action=cancel-pocket-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reminderId: reminder.id }),
      });
    }
  }

  const openCreate = (date = selectedDate) => {
    setEditingId(null);
    setDraft(makeBlankReminder(date));
    setShowForm(true);
  };

  const openEdit = (reminder) => {
    setEditingId(reminder.id);
    setDraft({ ...makeBlankReminder(reminder.date), ...reminder });
    setShowForm(true);
    setDetailsId(null);
  };

  const submitForm = async (event) => {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title || !draft.date) return;
    const payload = {
      ...draft,
      title,
      description: draft.description?.trim() || "",
      time: draft.time || "09:00",
      repeat: draft.repeat || "none",
      category: draft.category || "Personal",
      notification: draft.notification || "none",
      notifyTelegram: Boolean(draft.notifyTelegram),
    };

    if (payload.notifyTelegram && !telegramConnected) {
      setTelegramError("Connect Telegram before enabling Telegram reminders.");
      return;
    }

    try {
      const saved = editingId
        ? onUpdate(editingId, payload)
        : onCreate(payload);
      const reminderToSync = saved || { ...payload, id: editingId };
      await syncTelegramReminder(reminderToSync);
    } catch (error) {
      setTelegramError(error.message || "Could not sync Telegram reminder.");
      return;
    }

    setShowForm(false);
    setTelegramError("");
    setEditingId(null);
    setSelectedDate(payload.date);
    setCursorMonth(startOfMonth(parseDateKey(payload.date)));
  };

  return (
    <div className="reminders-page">
      <style>{remindersCss}</style>

      <header className="reminders-header">
        <div>
          <div className="reminders-eyebrow">PERSONAL SPACE</div>
          <div className="reminders-title-row">
            <div className="reminders-title-icon">
              <Bell size={22} />
            </div>
            <div>
              <h1>Reminders</h1>
              <p>Stay on top of what matters.</p>
            </div>
          </div>
        </div>
        <div className="reminders-header-actions">
          <div
            className={`telegram-status-pill ${telegramConnected ? "connected" : ""}`}
          >
            <span className="telegram-status-dot" />
            <span>
              {telegramConnected
                ? `Telegram${telegramUsername ? ` · ${telegramUsername}` : " connected"}`
                : "Telegram not connected"}
            </span>
            {telegramConnected ? (
              <button type="button" onClick={refreshTelegramStatus}>
                Refresh
              </button>
            ) : (
              <button
                type="button"
                onClick={connectTelegram}
                disabled={telegramBusy}
              >
                <Link2 size={13} /> {telegramBusy ? "Connecting…" : "Connect"}
              </button>
            )}
          </div>
          <label className="reminders-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reminders..."
            />
          </label>
          <button className="reminders-primary" onClick={() => openCreate()}>
            <Plus size={17} /> Add Reminder
          </button>
        </div>
      </header>

      <div className="reminders-tabs">
        {["calendar", "upcoming", "all", "completed"].map((id) => (
          <button
            key={id}
            className={mode === id ? "active" : ""}
            onClick={() => setMode(id)}
          >
            {id === "calendar" ? (
              <CalendarDays size={16} />
            ) : id === "upcoming" ? (
              <Clock3 size={16} />
            ) : id === "all" ? (
              <Filter size={16} />
            ) : (
              <Check size={16} />
            )}
            {id[0].toUpperCase() + id.slice(1)}
          </button>
        ))}
      </div>

      {mode === "calendar" ? (
        <div className="reminders-layout">
          <section className="calendar-shell">
            <div className="calendar-toolbar">
              <div className="calendar-nav">
                <button
                  onClick={() =>
                    setCursorMonth(
                      (d) => new Date(d.getFullYear(), d.getMonth() - 1, 1),
                    )
                  }
                >
                  <ChevronLeft size={17} />
                </button>
                <button
                  onClick={() => setCursorMonth(startOfMonth(new Date()))}
                >
                  Today
                </button>
                <button
                  onClick={() =>
                    setCursorMonth(
                      (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1),
                    )
                  }
                >
                  <ChevronRight size={17} />
                </button>
              </div>
              <h2>{formatMonth(cursorMonth)}</h2>
              <div className="calendar-mode-switch">
                {["month", "week", "day"].map((id) => (
                  <button
                    key={id}
                    className={calendarMode === id ? "active" : ""}
                    onClick={() => setCalendarMode(id)}
                  >
                    {id[0].toUpperCase() + id.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {calendarMode === "month" && (
              <div className="month-grid">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (day) => (
                    <div key={day} className="month-head">
                      {day}
                    </div>
                  ),
                )}
                {monthDays.map((day) => {
                  const key = toDateKey(day);
                  const inMonth = day.getMonth() === cursorMonth.getMonth();
                  const dayItems = filtered.filter((r) => r.date === key);
                  return (
                    <button
                      key={key}
                      className={`month-cell ${inMonth ? "" : "muted"} ${selectedDate === key ? "selected" : ""} ${key === todayKey ? "today" : ""}`}
                      onClick={() => {
                        setSelectedDate(key);
                        setCursorMonth(startOfMonth(day));
                      }}
                    >
                      <div className="month-cell-top">
                        <span>{day.getDate()}</span>
                        {key === todayKey && <span className="today-dot" />}
                      </div>
                      <div className="month-events">
                        {dayItems.slice(0, 3).map((r) => {
                          const meta =
                            CATEGORY_META[r.category] || CATEGORY_META.Other;
                          return (
                            <span
                              key={r.id}
                              className={`mini-event ${r.completed ? "done" : ""}`}
                              style={{ "--dot": meta.dot }}
                            >
                              <span className="mini-dot" />
                              {r.title}
                            </span>
                          );
                        })}
                        {dayItems.length > 3 && (
                          <span className="mini-more">
                            +{dayItems.length - 3} more
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {calendarMode === "week" && (
              <div className="week-grid">
                {weekDays.map((day) => {
                  const key = toDateKey(day);
                  const items = filtered.filter((r) => r.date === key);
                  return (
                    <div
                      key={key}
                      className={`week-column ${key === todayKey ? "today-column" : ""}`}
                    >
                      <button
                        className={`week-day-head ${key === selectedDate ? "selected" : ""}`}
                        onClick={() => setSelectedDate(key)}
                      >
                        <span>
                          {day.toLocaleDateString("en-IN", {
                            weekday: "short",
                          })}
                        </span>
                        <strong>{day.getDate()}</strong>
                      </button>
                      <div className="week-events">
                        {items.map((r) => (
                          <ReminderCompact
                            key={r.id}
                            reminder={r}
                            onClick={() => setDetailsId(r.id)}
                            onToggle={() => handleToggleReminder(r)}
                          />
                        ))}
                        {!items.length && (
                          <button
                            className="week-empty"
                            onClick={() => openCreate(key)}
                          >
                            + Add
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {calendarMode === "day" && (
              <DayTimeline
                dateKey={selectedDate}
                reminders={filtered.filter((r) => r.date === selectedDate)}
                onToggleReminder={handleToggleReminder}
                onOpen={setDetailsId}
                onAdd={() => openCreate(selectedDate)}
              />
            )}
          </section>

          <aside className="reminders-day-panel">
            <div className="day-panel-header">
              <div>
                <div className="day-panel-eyebrow">SELECTED DAY</div>
                <h3>{formatLongDate(selectedDate)}</h3>
              </div>
              <button
                className="icon-button"
                onClick={() => openCreate(selectedDate)}
                aria-label="Add reminder"
              >
                <Plus size={17} />
              </button>
            </div>

            <div className="day-panel-list">
              {selectedReminders.length === 0 ? (
                <button
                  className="empty-reminder"
                  onClick={() => openCreate(selectedDate)}
                >
                  <Bell size={18} />
                  <strong>No reminders yet</strong>
                  <span>Create one for this day.</span>
                </button>
              ) : (
                selectedReminders.map((r) => (
                  <ReminderListRow
                    key={r.id}
                    reminder={r}
                    onToggle={() => handleToggleReminder(r)}
                    onOpen={() => setDetailsId(r.id)}
                  />
                ))
              )}
            </div>

            <div className="day-panel-footer">
              Small reminders make big things happen.
            </div>
          </aside>
        </div>
      ) : (
        <section className="reminders-list-shell">
          <div className="list-toolbar">
            <div>
              <div className="reminders-eyebrow">REMINDERS</div>
              <h2>
                {mode === "upcoming"
                  ? "Upcoming"
                  : mode === "completed"
                    ? "Completed"
                    : "All reminders"}
              </h2>
            </div>
            <div className="list-toolbar-actions">
              {mode !== "calendar" && (
                <button
                  className={
                    status === "open" ? "filter-chip active" : "filter-chip"
                  }
                  onClick={() => setStatus(status === "open" ? "all" : "open")}
                >
                  Open only
                </button>
              )}
              {mode !== "calendar" && (
                <button
                  className={
                    status === "completed"
                      ? "filter-chip active"
                      : "filter-chip"
                  }
                  onClick={() =>
                    setStatus(status === "completed" ? "all" : "completed")
                  }
                >
                  Completed
                </button>
              )}
              <button
                className="reminders-primary"
                onClick={() => openCreate()}
              >
                <Plus size={17} /> Add Reminder
              </button>
            </div>
          </div>
          <div className="all-reminders-list">
            {(mode === "upcoming"
              ? upcoming
              : mode === "completed"
                ? filtered.filter((r) => r.completed)
                : filtered
            ).map((r) => (
              <ReminderListRow
                key={r.id}
                reminder={r}
                onToggle={() => handleToggleReminder(r)}
                onOpen={() => setDetailsId(r.id)}
              />
            ))}
            {(mode === "upcoming" ? upcoming : filtered).length === 0 && (
              <div className="empty-list">
                <Bell size={22} />
                <strong>Nothing here yet</strong>
                <span>Create a reminder and it will appear here.</span>
              </div>
            )}
          </div>
        </section>
      )}

      {showForm && (
        <div
          className="reminders-modal-overlay"
          onMouseDown={() => setShowForm(false)}
        >
          <form
            className="reminder-form-modal"
            onSubmit={submitForm}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="reminder-form-header">
              <div>
                <div className="reminders-eyebrow">REMINDER</div>
                <h3>{editingId ? "Edit Reminder" : "Create Reminder"}</h3>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowForm(false)}
              >
                <X size={18} />
              </button>
            </div>
            <label className="form-field">
              <span>Title</span>
              <input
                autoFocus
                value={draft.title}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, title: e.target.value }))
                }
                placeholder="e.g. Pay electricity bill"
              />
            </label>
            <label className="form-field">
              <span>Description</span>
              <textarea
                value={draft.description}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, description: e.target.value }))
                }
                placeholder="Add more details..."
                rows={3}
              />
            </label>
            <div className="form-grid-2">
              <label className="form-field">
                <span>Date</span>
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, date: e.target.value }))
                  }
                />
              </label>
              <label className="form-field">
                <span>Time</span>
                <input
                  type="time"
                  value={draft.time}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, time: e.target.value }))
                  }
                />
              </label>
            </div>
            <div className="form-grid-2">
              <label className="form-field">
                <span>Repeat</span>
                <select
                  value={draft.repeat}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, repeat: e.target.value }))
                  }
                >
                  {REPEAT_OPTIONS.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Category</span>
                <select
                  value={draft.category}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, category: e.target.value }))
                  }
                >
                  {Object.keys(CATEGORY_META).map((cat) => (
                    <option key={cat}>{cat}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="form-field">
              <span>Notification</span>
              <select
                value={draft.notification}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, notification: e.target.value }))
                }
              >
                {NOTIFICATION_OPTIONS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="telegram-reminder-option">
              <input
                type="checkbox"
                checked={Boolean(draft.notifyTelegram)}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, notifyTelegram: e.target.checked }))
                }
              />
              <span>Notify me on Telegram</span>
              <small>
                {telegramConnected
                  ? "Sent at the reminder time, even when Pocket is closed."
                  : "Connect Telegram above to enable this."}
              </small>
            </label>
            {telegramError && (
              <div className="telegram-reminder-error">{telegramError}</div>
            )}
            <div className="reminder-form-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="reminders-primary"
                disabled={!draft.title.trim() || !draft.date}
              >
                {editingId ? "Save reminder" : "Create reminder"}
              </button>
            </div>
          </form>
        </div>
      )}

      {detailsReminder && (
        <div
          className="reminders-modal-overlay"
          onMouseDown={() => setDetailsId(null)}
        >
          <div
            className="reminder-detail-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="detail-topbar">
              <button
                className="icon-button"
                onClick={() => setDetailsId(null)}
              >
                <X size={18} />
              </button>
              <div className="detail-actions">
                <button
                  className="icon-button"
                  onClick={() => openEdit(detailsReminder)}
                >
                  <Pencil size={17} />
                </button>
                <button
                  className="icon-button danger"
                  onClick={async () => {
                    try {
                      await fetch(
                        "/api/telegram?action=cancel-pocket-reminder",
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            reminderId: detailsReminder.id,
                          }),
                        },
                      );
                    } catch {}
                    onDelete(detailsReminder.id);
                    setDetailsId(null);
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
            <div className="detail-icon">
              <Bell size={22} />
            </div>
            <h3>{detailsReminder.title}</h3>
            <div className="detail-meta">
              <span>
                <CalendarDays size={15} />{" "}
                {formatLongDate(detailsReminder.date)}
              </span>
              <span>
                <Clock3 size={15} /> {formatTime(detailsReminder.time)}
              </span>
            </div>
            {detailsReminder.description && (
              <p className="detail-description">
                {detailsReminder.description}
              </p>
            )}
            <div className="detail-pills">
              <span>
                {detailsReminder.repeat === "none"
                  ? "Does not repeat"
                  : REPEAT_OPTIONS.find(
                      ([id]) => id === detailsReminder.repeat,
                    )?.[1]}
              </span>
              <span>{detailsReminder.category}</span>
              <span>
                {
                  NOTIFICATION_OPTIONS.find(
                    ([id]) => id === String(detailsReminder.notification),
                  )?.[1]
                }
              </span>
            </div>
            <button
              className={
                detailsReminder.completed
                  ? "complete-button done"
                  : "complete-button"
              }
              onClick={() => handleToggleReminder(detailsReminder)}
            >
              {detailsReminder.completed ? (
                <>
                  <RotateCcw size={17} /> Mark as open
                </>
              ) : (
                <>
                  <Check size={17} /> Mark as completed
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReminderListRow({ reminder, onToggle, onOpen }) {
  const meta = CATEGORY_META[reminder.category] || CATEGORY_META.Other;
  return (
    <div
      className={`reminder-list-row ${reminder.completed ? "done" : ""}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <button
        type="button"
        className={`reminder-check ${reminder.completed ? "checked" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={
          reminder.completed ? "Mark reminder open" : "Mark reminder completed"
        }
      >
        {reminder.completed && <Check size={12} />}
      </button>
      <span className="reminder-row-dot" style={{ background: meta.dot }} />
      <span className="reminder-row-copy">
        <strong>{reminder.title}</strong>
        <small>
          {formatTime(reminder.time)} · {reminder.category}
        </small>
      </span>
      <span className="reminder-row-date">
        {formatShortDate(reminder.date)}
      </span>
      <ChevronRight size={16} className="row-chevron" />
    </div>
  );
}

function ReminderCompact({ reminder, onClick, onToggle }) {
  const meta = CATEGORY_META[reminder.category] || CATEGORY_META.Other;
  return (
    <div
      className={`week-event ${reminder.completed ? "done" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <span className="week-event-dot" style={{ background: meta.dot }} />
      <span>
        {formatTime(reminder.time)} {reminder.title}
      </span>
      <button
        type="button"
        className="mini-complete"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {reminder.completed ? <Check size={10} /> : null}
      </button>
    </div>
  );
}

function DayTimeline({ dateKey, reminders, onToggleReminder, onOpen, onAdd }) {
  const slots = Array.from({ length: 16 }, (_, index) => index + 7);
  return (
    <div className="day-timeline">
      <div className="day-timeline-head">
        <div>
          <strong>{formatLongDate(dateKey)}</strong>
          <span>Tap a reminder to view details.</span>
        </div>
        <button className="reminders-primary" onClick={onAdd}>
          <Plus size={16} /> Add
        </button>
      </div>
      {slots.map((hour) => {
        const items = reminders.filter(
          (r) => Number((r.time || "00:00").split(":")[0]) === hour,
        );
        return (
          <div key={hour} className="timeline-row">
            <div className="timeline-time">
              {formatTime(`${pad2(hour)}:00`)}
            </div>
            <div className="timeline-line">
              {items.map((r) => (
                <div
                  key={r.id}
                  className={`timeline-event ${r.completed ? "done" : ""}`}
                  onClick={() => onOpen(r.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(r.id);
                    }
                  }}
                >
                  <span>{r.title}</span>
                  <small>
                    {formatTime(r.time)} · {r.category}
                  </small>
                  <button
                    type="button"
                    className="mini-complete"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleReminder(r);
                    }}
                  >
                    {r.completed && <Check size={11} />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const remindersCss = `
.reminders-page{padding:28px 32px 110px;color:#ECEAE3;min-height:100%;font-family:Inter,sans-serif}
.reminders-header{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;margin-bottom:18px}.reminders-eyebrow{font-size:9px;letter-spacing:.16em;font-weight:700;color:#69717D}.reminders-title-row{display:flex;align-items:center;gap:13px;margin-top:8px}.reminders-title-icon{width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;color:#68DD80;background:#17311D;border:1px solid #285C35}.reminders-header h1{margin:0;font:600 30px/1.05 'Space Grotesk',sans-serif;letter-spacing:-.8px}.reminders-header p{margin:6px 0 0;color:#7D8591;font-size:12px}.reminders-header-actions{display:flex;gap:10px;align-items:center}.reminders-search{display:flex;align-items:center;gap:9px;min-width:250px;border:1px solid #2F3640;background:#15191F;border-radius:12px;padding:0 12px;height:42px;color:#79818D}.reminders-search input{border:0;outline:0;background:transparent;color:#EDF0F4;width:100%;font:12px Inter}.reminders-search input::placeholder{color:#67707D}.reminders-primary{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:42px;border:1px solid #3D9551;background:#4FE36B;color:#08120B;border-radius:11px;padding:0 15px;font:600 12px Inter;cursor:pointer;white-space:nowrap}.reminders-primary:disabled{opacity:.5;cursor:not-allowed}.reminders-tabs{display:flex;gap:6px;padding:5px;border:1px solid #29303A;background:#11151A;border-radius:13px;width:max-content;margin-bottom:14px}.reminders-tabs button{display:flex;align-items:center;gap:7px;min-height:36px;padding:0 12px;border:0;background:transparent;color:#7D8591;border-radius:9px;font:600 11px Inter;cursor:pointer}.reminders-tabs button.active{background:#202730;color:#71DE86;box-shadow:inset 2px 0 0 #4FE36B}.reminders-layout{display:grid;grid-template-columns:minmax(0,1fr) 315px;gap:14px}.calendar-shell,.reminders-day-panel,.reminders-list-shell{border:1px solid #29303A;background:#14181D;border-radius:18px;overflow:hidden}.calendar-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 15px;border-bottom:1px solid #262C34}.calendar-toolbar h2{margin:0;font:600 17px 'Space Grotesk';text-transform:capitalize}.calendar-nav{display:flex;gap:6px}.calendar-nav button,.calendar-mode-switch button,.icon-button,.filter-chip,.secondary-action{border:1px solid #303742;background:#1A2028;color:#9CA4AF;border-radius:10px;min-height:34px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;font:600 11px Inter;cursor:pointer}.calendar-nav button:hover,.calendar-mode-switch button:hover,.icon-button:hover,.filter-chip:hover,.secondary-action:hover{background:#202730;color:#E8EBEF}.calendar-mode-switch{display:flex;gap:3px;padding:3px;border:1px solid #2B313A;border-radius:10px;background:#11151A}.calendar-mode-switch button{border:0;background:transparent;min-height:29px;border-radius:7px;padding:0 9px}.calendar-mode-switch button.active{background:#202730;color:#E5E9EE}.month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));min-width:0}.month-head{padding:11px 10px;border-bottom:1px solid #252B33;color:#67707C;font-size:10px;font-weight:700;text-transform:uppercase}.month-cell{min-height:118px;border:0;border-right:1px solid #232932;border-bottom:1px solid #232932;background:#14181D;color:#DDE1E6;padding:9px 8px;text-align:left;cursor:pointer;position:relative;overflow:hidden}.month-cell:nth-child(7n){border-right:0}.month-cell:hover{background:#181D23}.month-cell.muted{color:#4D5560}.month-cell.selected{background:#18211B;box-shadow:inset 0 0 0 1px #355A3D}.month-cell.today .month-cell-top>span:first-child{background:#4FE36B;color:#061108;border-radius:50%;width:23px;height:23px;display:inline-flex;align-items:center;justify-content:center;font-weight:700}.month-cell-top{display:flex;justify-content:space-between;align-items:center;font-size:11px}.today-dot{width:6px;height:6px;background:#4FE36B;border-radius:50%}.month-events{display:flex;flex-direction:column;gap:4px;margin-top:8px}.mini-event{display:flex;align-items:center;gap:5px;max-width:100%;font-size:9px;color:#B9C0CA;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mini-event.done{opacity:.45;text-decoration:line-through}.mini-dot{width:6px;height:6px;border-radius:50%;background:var(--dot);flex:0 0 6px}.mini-more{font-size:9px;color:#66707C}.reminders-day-panel{padding:15px;display:flex;flex-direction:column}.day-panel-header{display:flex;justify-content:space-between;gap:10px;padding-bottom:14px;border-bottom:1px solid #252B33}.day-panel-eyebrow{font-size:8px;letter-spacing:.16em;color:#6E7682;font-weight:700}.day-panel-header h3{margin:6px 0 0;font:600 18px 'Space Grotesk';text-transform:capitalize}.icon-button{width:36px;min-width:36px;padding:0;border-radius:10px}.icon-button.danger{color:#E38A78}.day-panel-list{display:flex;flex-direction:column;gap:6px;margin-top:12px}.reminder-list-row{width:100%;display:flex;align-items:center;gap:10px;border:1px solid #252C35;background:#161A20;color:#DDE1E6;padding:11px 9px;border-radius:12px;text-align:left;cursor:pointer}.reminder-list-row:hover{background:#1A1F26;border-color:#36404B}.reminder-list-row.done{opacity:.55}.reminder-list-row.done .reminder-row-copy strong{text-decoration:line-through}.reminder-check{width:20px;height:20px;border-radius:6px;border:1px solid #3A424D;background:#10151B;color:#07110A;display:flex;align-items:center;justify-content:center;flex:0 0 20px;padding:0;cursor:pointer}.reminder-check.checked{background:#4FE36B;border-color:#4FE36B}.reminder-row-dot{width:7px;height:7px;border-radius:50%;flex:0 0 7px}.reminder-row-copy{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}.reminder-row-copy strong{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reminder-row-copy small{color:#7B8490;font-size:10px}.reminder-row-date{color:#8E96A2;font-size:10px;white-space:nowrap}.row-chevron{color:#59626E;flex:0 0 auto}.empty-reminder{border:1px dashed #303844;background:transparent;border-radius:14px;padding:20px 14px;color:#707985;display:flex;flex-direction:column;align-items:center;gap:7px;text-align:center;cursor:pointer}.empty-reminder strong{color:#C5CAD1;font-size:12px}.empty-reminder span{font-size:10px}.day-panel-footer{margin-top:auto;padding-top:20px;color:#66707C;font-size:10px;text-align:center}.week-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));min-width:0}.week-column{border-right:1px solid #232932;min-height:520px}.week-column:last-child{border-right:0}.week-day-head{width:100%;display:flex;align-items:center;justify-content:space-between;padding:12px;border:0;border-bottom:1px solid #252B33;background:#14181D;color:#8D96A2;cursor:pointer}.week-day-head strong{width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#E3E7EC}.week-day-head.selected strong{background:#4FE36B;color:#08120B}.today-column .week-day-head span{color:#4FE36B}.week-events{padding:8px;display:flex;flex-direction:column;gap:7px}.week-event{display:flex;align-items:center;gap:6px;width:100%;text-align:left;border:1px solid #2A323C;background:#171C22;color:#DDE2E8;border-radius:9px;padding:8px;font-size:10px;cursor:pointer}.week-event.done{opacity:.5;text-decoration:line-through}.week-event-dot{width:6px;height:6px;border-radius:50%;flex:0 0 6px}.mini-complete{margin-left:auto;width:18px;height:18px;border:0;border-radius:6px;background:#242B33;color:#4FE36B;display:flex;align-items:center;justify-content:center;padding:0}.week-empty{border:1px dashed #303844;background:transparent;color:#67717D;border-radius:9px;padding:12px 7px;cursor:pointer}.day-timeline{padding:12px}.day-timeline-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 6px 14px}.day-timeline-head strong{display:block;font-size:14px}.day-timeline-head span{display:block;color:#707985;font-size:10px;margin-top:4px}.timeline-row{display:grid;grid-template-columns:64px 1fr;min-height:64px}.timeline-time{color:#6F7783;font-size:10px;padding-top:7px}.timeline-line{border-top:1px solid #222933;min-height:64px;padding:6px 0;display:flex;flex-direction:column;gap:5px}.timeline-event{width:100%;border:1px solid #2E3742;background:#1A2028;border-left:3px solid #4FE36B;color:#E2E6EA;padding:8px 9px;border-radius:9px;display:flex;align-items:center;gap:8px;cursor:pointer;text-align:left}.timeline-event.done{opacity:.5;text-decoration:line-through}.timeline-event span{font-size:11px;flex:1}.timeline-event small{color:#7D8691;font-size:9px}.reminders-list-shell{padding:16px}.list-toolbar{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding-bottom:14px;border-bottom:1px solid #252B33}.list-toolbar h2{margin:5px 0 0;font:600 20px 'Space Grotesk'}.list-toolbar-actions{display:flex;gap:7px;align-items:center}.filter-chip.active{background:#20352A;color:#6AE082;border-color:#31563C}.all-reminders-list{display:flex;flex-direction:column;gap:6px;padding-top:12px}.empty-list{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:250px;gap:7px;color:#707985}.empty-list strong{color:#C8CDD4;font-size:13px}.empty-list span{font-size:10px}.reminders-modal-overlay{position:fixed;inset:0;z-index:3000;background:rgba(3,5,7,.72);backdrop-filter:blur(11px);display:flex;align-items:center;justify-content:center;padding:18px}.reminder-form-modal,.reminder-detail-modal{width:min(520px,100%);max-height:min(86dvh,720px);overflow:auto;background:#151A20;border:1px solid #313946;border-radius:20px;box-shadow:0 30px 90px rgba(0,0,0,.62);padding:18px}.reminder-form-header,.detail-topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:15px}.reminder-form-header h3,.reminder-detail-modal h3{margin:5px 0 0;font:600 23px 'Space Grotesk'}.form-field{display:flex;flex-direction:column;gap:7px;margin-top:14px}.form-field>span{font-size:10px;font-weight:700;color:#8A929E;text-transform:uppercase;letter-spacing:.08em}.form-field input,.form-field textarea,.form-field select{width:100%;box-sizing:border-box;border:1px solid #303844;border-radius:11px;background:#11161B;color:#E9EDF1;outline:0;padding:11px 12px;font:12px Inter}.form-field textarea{resize:vertical;min-height:86px}.form-field input:focus,.form-field textarea:focus,.form-field select:focus{border-color:#4A8F5A;box-shadow:0 0 0 3px rgba(79,227,107,.08)}.form-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.reminder-form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.secondary-action{min-height:42px;padding:0 14px}.detail-topbar{margin-bottom:8px}.detail-actions{display:flex;gap:7px}.detail-icon{width:48px;height:48px;border-radius:14px;background:#17321D;border:1px solid #285C35;color:#62DA7B;display:flex;align-items:center;justify-content:center;margin-top:6px}.reminder-detail-modal h3{font-size:28px;margin-top:14px}.detail-meta{display:flex;flex-wrap:wrap;gap:12px;color:#8B95A1;font-size:11px;margin-top:9px}.detail-meta span{display:inline-flex;align-items:center;gap:5px}.detail-description{color:#CBD0D7;font-size:12px;line-height:1.6;margin:18px 0}.detail-pills{display:flex;flex-wrap:wrap;gap:7px}.detail-pills span{padding:7px 9px;border-radius:999px;background:#1F262F;border:1px solid #303844;color:#AEB6C0;font-size:10px}.complete-button{margin-top:20px;width:100%;min-height:46px;border-radius:12px;border:1px solid #3D9551;background:#4FE36B;color:#08120B;display:flex;align-items:center;justify-content:center;gap:7px;font:600 12px Inter;cursor:pointer}.complete-button.done{border-color:#3B424C;background:#20262E;color:#C0C6CE}
@media(max-width:1100px){.reminders-layout{grid-template-columns:1fr 290px}.month-cell{min-height:105px}.reminders-page{padding:24px 22px 100px}}
@media(max-width:768px){.reminders-page{padding:16px 14px 105px}.reminders-header{align-items:flex-start;flex-direction:column;gap:14px}.reminders-header-actions{width:100%;flex-direction:column}.reminders-search{width:100%;min-width:0}.reminders-primary{min-height:46px;width:100%}.reminders-tabs{width:100%;overflow-x:auto}.reminders-tabs button{flex:1;min-width:102px}.reminders-layout{grid-template-columns:1fr}.calendar-shell,.reminders-day-panel,.reminders-list-shell{border-radius:16px}.calendar-toolbar{flex-wrap:wrap}.calendar-toolbar h2{order:-1;width:100%;text-align:center}.calendar-nav{flex:1}.calendar-mode-switch{margin-left:auto}.month-cell{min-height:92px;padding:7px 6px}.mini-event{font-size:8px}.reminders-day-panel{padding:12px}.week-grid{overflow:auto}.week-column{min-width:138px}.day-timeline{padding:6px}.list-toolbar{align-items:flex-start;flex-direction:column}.list-toolbar-actions{width:100%;flex-wrap:wrap}.list-toolbar-actions .reminders-primary{width:auto;flex:1}.reminder-list-row{padding:12px 10px}.reminder-row-date{display:none}.form-grid-2{grid-template-columns:1fr}.reminder-form-modal,.reminder-detail-modal{width:100%;border-radius:18px;max-height:calc(100dvh - 24px)}.reminders-modal-overlay{padding:12px}.month-grid{min-width:0}.calendar-shell{overflow:hidden}.month-head,.month-cell{font-size:9px}.month-cell-top{font-size:10px}.mini-event{font-size:0}.mini-event .mini-dot{width:6px;height:6px}.mini-more{font-size:8px}}
html[data-pocket-theme="light"] .reminders-page{color:#20252B}.light-mode-placeholder{}
html[data-pocket-theme="light"] .calendar-shell,html[data-pocket-theme="light"] .reminders-day-panel,html[data-pocket-theme="light"] .reminders-list-shell{background:#fff;border-color:#D8DEE5}.light-mode-placeholder{}
html[data-pocket-theme="light"] .reminders-tabs{background:#F4F6F8;border-color:#D8DEE5}.light-mode-placeholder{}
html[data-pocket-theme="light"] .reminders-tabs button,html[data-pocket-theme="light"] .calendar-nav button,html[data-pocket-theme="light"] .calendar-mode-switch button,html[data-pocket-theme="light"] .icon-button,html[data-pocket-theme="light"] .filter-chip,html[data-pocket-theme="light"] .secondary-action{background:#fff;color:#69727E;border-color:#D6DCE2}.light-mode-placeholder{}
html[data-pocket-theme="light"] .reminders-tabs button.active{background:#E8F7EC;color:#188A36}.light-mode-placeholder{}
html[data-pocket-theme="light"] .calendar-mode-switch{background:#EEF1F4;border-color:#D8DEE5}.light-mode-placeholder{}
html[data-pocket-theme="light"] .calendar-mode-switch button.active{background:#fff;color:#1E2329;box-shadow:0 1px 3px rgba(20,30,40,.08)}.light-mode-placeholder{}
html[data-pocket-theme="light"] .month-cell{background:#fff;color:#30363E;border-color:#E6EAEE}.light-mode-placeholder{}
html[data-pocket-theme="light"] .month-cell:hover{background:#F8FAFB}.light-mode-placeholder{}
html[data-pocket-theme="light"] .month-cell.selected{background:#EDF8EF;box-shadow:inset 0 0 0 1px #87C894}.light-mode-placeholder{}
html[data-pocket-theme="light"] .calendar-toolbar,html[data-pocket-theme="light"] .day-panel-header,html[data-pocket-theme="light"] .list-toolbar{border-color:#E5E9EE}.light-mode-placeholder{}
html[data-pocket-theme="light"] .calendar-toolbar h2,html[data-pocket-theme="light"] .day-panel-header h3,html[data-pocket-theme="light"] .list-toolbar h2,html[data-pocket-theme="light"] .reminders-header h1{color:#1E2329}.light-mode-placeholder{}
html[data-pocket-theme="light"] .reminders-header p,html[data-pocket-theme="light"] .reminder-row-copy small,html[data-pocket-theme="light"] .day-panel-footer,html[data-pocket-theme="light"] .reminders-eyebrow,html[data-pocket-theme="light"] .widget-sub{color:#6C7580}.light-mode-placeholder{}
html[data-pocket-theme="light"] .reminder-list-row{background:#F7F9FB;border-color:#E0E5EA;color:#252B32}.light-mode-placeholder{}
html[data-pocket-theme="light"] .empty-reminder{border-color:#D7DDE4}.light-mode-placeholder{}
html[data-pocket-theme="light"] .reminders-search{background:#fff;border-color:#D7DDE4}.light-mode-placeholder{}
html[data-pocket-theme="light"] .reminders-search input{color:#252B32}.light-mode-placeholder{}
html[data-pocket-theme="light"] .reminder-form-modal,html[data-pocket-theme="light"] .reminder-detail-modal{background:#fff;border-color:#D7DDE4}.light-mode-placeholder{}
html[data-pocket-theme="light"] .form-field input,html[data-pocket-theme="light"] .form-field textarea,html[data-pocket-theme="light"] .form-field select{background:#F7F9FB;color:#252B32;border-color:#D8DEE5}.light-mode-placeholder{}
html[data-pocket-theme="light"] .detail-pills span{background:#F2F5F7;color:#69727E;border-color:#D8DEE5}.light-mode-placeholder{}
.telegram-status-pill{display:flex;align-items:center;gap:7px;min-height:38px;padding:0 10px;border:1px solid #303844;border-radius:999px;background:#151B21;color:#9AA4AF;font-size:10px;white-space:nowrap}.telegram-status-pill.connected{border-color:#31573B;background:#16251A;color:#71DA87}.telegram-status-dot{width:7px;height:7px;border-radius:50%;background:#8A929D;flex:0 0 7px}.telegram-status-pill.connected .telegram-status-dot{background:#4FE36B;box-shadow:0 0 0 3px rgba(79,227,107,.12)}.telegram-status-pill button{display:inline-flex;align-items:center;gap:4px;border:0;background:transparent;color:#67D97B;font:600 10px Inter;cursor:pointer;padding:4px 0}.telegram-status-pill button:disabled{opacity:.55}.telegram-reminder-option{display:grid;grid-template-columns:18px 1fr;column-gap:9px;align-items:start;margin-top:14px;padding:11px 12px;border:1px solid #2C3440;border-radius:12px;background:#12171C}.telegram-reminder-option input{margin-top:2px;width:16px;height:16px;accent-color:#34C759}.telegram-reminder-option span{font-size:12px;font-weight:600;color:#DCE1E7}.telegram-reminder-option small{grid-column:2;color:#7F8996;font-size:10px;line-height:1.45;margin-top:3px}.telegram-reminder-error{margin-top:9px;padding:9px 11px;border:1px solid rgba(217,115,92,.34);border-radius:10px;background:rgba(217,115,92,.08);color:#F0A08F;font-size:10px;line-height:1.45}
html[data-pocket-theme="light"] .telegram-status-pill{background:#F7F9FB;border-color:#D8DEE5;color:#68727D}.light-mode-placeholder{} html[data-pocket-theme="light"] .telegram-status-pill.connected{background:#ECF8EF;border-color:#B9E2C1;color:#188A36}.light-mode-placeholder{} html[data-pocket-theme="light"] .telegram-reminder-option{background:#F7F9FB;border-color:#D8DEE5}.light-mode-placeholder{} html[data-pocket-theme="light"] .telegram-reminder-option span{color:#252B32}.light-mode-placeholder{}
@media(max-width:768px){.telegram-status-pill{width:100%;justify-content:space-between;min-height:42px;border-radius:12px}.telegram-status-pill span:nth-child(2){flex:1}.telegram-reminder-option{padding:12px}}
`;
