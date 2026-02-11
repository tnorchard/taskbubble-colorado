import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "../lib/supabaseClient";
import { useNavigate } from "react-router-dom";
import type { CalendarNote } from "../types";

type CalTask = {
  id: string;
  title: string;
  due_date: string | null;
  is_asap?: boolean;
  status: string;
  workspace_id: string;
  workspace_name?: string;
  company?: string | null;
  responsible_name?: string | null;
};

const NOTE_COLORS: Array<{ value: CalendarNote["color"]; label: string; css: string }> = [
  { value: "blue", label: "Blue", css: "rgba(37,99,235,0.7)" },
  { value: "green", label: "Green", css: "rgba(22,163,74,0.7)" },
  { value: "orange", label: "Orange", css: "rgba(234,88,12,0.7)" },
  { value: "red", label: "Red", css: "rgba(239,68,68,0.7)" },
  { value: "purple", label: "Purple", css: "rgba(147,51,234,0.7)" },
  { value: "pink", label: "Pink", css: "rgba(219,39,119,0.7)" },
];

function noteColorCss(color: CalendarNote["color"]) {
  return NOTE_COLORS.find((c) => c.value === color)?.css ?? NOTE_COLORS[0].css;
}

export function CalendarPage() {
  const supabase = getSupabase();
  const nav = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<CalTask[]>([]);
  const [notes, setNotes] = useState<CalendarNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Side panel state
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<CalTask | null>(null);

  // Note form state
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteColor, setNoteColor] = useState<CalendarNote["color"]>("blue");
  const [notePublic, setNotePublic] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserId(data.user.id);
    });
  }, [supabase]);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);

    // Load workspaces + tasks
    const { data: wsData } = await supabase.from("workspaces").select("id,name");
    const wsMap = new Map<string, string>();
    ((wsData ?? []) as Array<{ id: string; name: string }>).forEach((w) => wsMap.set(w.id, w.name));
    const wsIds = Array.from(wsMap.keys());

    let loadedTasks: CalTask[] = [];
    if (wsIds.length) {
      const { data: taskData } = await supabase
        .from("tasks")
        .select("id,title,due_date,is_asap,status,workspace_id,company,responsible_id")
        .in("workspace_id", wsIds)
        .is("deleted_at", null);

      const respIds = ((taskData ?? []) as any[]).map((t) => t.responsible_id).filter(Boolean);
      const profMap = new Map<string, string>();
      if (respIds.length) {
        const { data: profs } = await supabase.from("profiles").select("id,display_name,email").in("id", Array.from(new Set(respIds)));
        ((profs ?? []) as any[]).forEach((p) => profMap.set(p.id, p.display_name || p.email?.split("@")[0] || "User"));
      }

      loadedTasks = ((taskData ?? []) as any[]).map((t) => ({
        ...t,
        workspace_name: wsMap.get(t.workspace_id),
        responsible_name: t.responsible_id ? profMap.get(t.responsible_id) ?? null : null,
      }));
    }
    setTasks(loadedTasks);

    // Load calendar notes
    await loadNotes();
    setLoading(false);
  }

  async function loadNotes() {
    const { data } = await supabase
      .from("calendar_notes")
      .select("*")
      .order("created_at", { ascending: true });
    if (data) setNotes(data as CalendarNote[]);
  }

  // ── Calendar computation ──
  const calendarDays = useMemo(() => {
    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    const last = new Date(y, m + 1, 0);
    const startDay = new Date(y, m, 1).getDay();
    const days: Array<{ date: string; day: number; current: boolean; isToday: boolean }> = [];
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const prevLast = new Date(y, m, 0);
    for (let i = startDay - 1; i >= 0; i--) {
      const d = prevLast.getDate() - i;
      const dt = new Date(y, m - 1, d);
      const ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ date: ds, day: d, current: false, isToday: ds === todayStr });
    }
    for (let d = 1; d <= last.getDate(); d++) {
      const ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ date: ds, day: d, current: true, isToday: ds === todayStr });
    }
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const dt = new Date(y, m + 1, d);
      const ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ date: ds, day: d, current: false, isToday: ds === todayStr });
    }
    return days;
  }, [currentMonth]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, CalTask[]>();
    tasks.forEach((t) => {
      if (t.due_date && t.status !== "archived") {
        const list = map.get(t.due_date) ?? [];
        list.push(t);
        map.set(t.due_date, list);
      }
    });
    return map;
  }, [tasks]);

  const notesByDate = useMemo(() => {
    const map = new Map<string, CalendarNote[]>();
    notes.forEach((n) => {
      const list = map.get(n.note_date) ?? [];
      list.push(n);
      map.set(n.note_date, list);
    });
    return map;
  }, [notes]);

  const asapTasks = useMemo(
    () => tasks.filter((t) => (!t.due_date || t.is_asap) && t.status !== "done" && t.status !== "archived"),
    [tasks],
  );

  // ── Helpers ──
  function prevMonth() { setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
  function nextMonth() { setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1)); }
  function goToday() { setCurrentMonth(new Date()); }

  function selectDay(date: string) {
    setSelectedTask(null);
    setSelectedDate(date);
    resetNoteForm();
  }

  function resetNoteForm() {
    setShowNoteForm(false);
    setEditingNoteId(null);
    setNoteTitle("");
    setNoteBody("");
    setNoteColor("blue");
    setNotePublic(false);
  }

  function startAddNote() {
    resetNoteForm();
    setShowNoteForm(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  }

  function startEditNote(n: CalendarNote) {
    setEditingNoteId(n.id);
    setNoteTitle(n.title);
    setNoteBody(n.body);
    setNoteColor(n.color);
    setNotePublic(n.is_public);
    setShowNoteForm(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  }

  async function saveNote() {
    if (!noteTitle.trim() || !selectedDate || !userId) return;
    setNoteSaving(true);

    if (editingNoteId) {
      // Update
      await supabase.from("calendar_notes").update({
        title: noteTitle.trim(),
        body: noteBody.trim(),
        color: noteColor,
        is_public: notePublic,
      }).eq("id", editingNoteId);
    } else {
      // Insert
      await supabase.from("calendar_notes").insert({
        user_id: userId,
        note_date: selectedDate,
        title: noteTitle.trim(),
        body: noteBody.trim(),
        color: noteColor,
        is_public: notePublic,
      });
    }

    await loadNotes();
    resetNoteForm();
    setNoteSaving(false);
  }

  async function deleteNote(id: string) {
    if (!window.confirm("Delete this note?")) return;
    await supabase.from("calendar_notes").delete().eq("id", id);
    await loadNotes();
    if (editingNoteId === id) resetNoteForm();
  }

  function formatDateLabel(date: string) {
    const d = new Date(date + "T12:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  // ── Side panel data ──
  const dayTasks = selectedDate ? tasksByDate.get(selectedDate) ?? [] : [];
  const dayNotes = selectedDate ? notesByDate.get(selectedDate) ?? [] : [];

  if (loading) {
    return <div className="screen"><div className="screenInner"><div className="panel" style={{ padding: 32, textAlign: "center" }}>Loading calendar…</div></div></div>;
  }

  return (
    <div className="calPageScreen">
      <div className="calPageMain">
        {/* Header */}
        <div className="calPageHeader">
          <div className="calPageMonth">
            {currentMonth.toLocaleString(undefined, { month: "long", year: "numeric" })}
          </div>
          <div className="calPageNav">
            <button className="calPageNavBtn" type="button" onClick={prevMonth}>&#8249;</button>
            <button className="calPageNavBtn calPageToday" type="button" onClick={goToday}>Today</button>
            <button className="calPageNavBtn" type="button" onClick={nextMonth}>&#8250;</button>
          </div>
          <div className="calPageStats">
            <span>{tasks.length} tasks</span>
            <span className="bpStatDot" />
            <span>{notes.length} notes</span>
            <span className="bpStatDot" />
            <span>{asapTasks.length} ASAP</span>
          </div>
        </div>

        {/* ASAP lane */}
        {asapTasks.length > 0 ? (
          <div className="asapLane">
            <div className="asapLaneHeader">
              <div className="asapLaneTitle">ASAP</div>
              <div className="muted">{asapTasks.length}</div>
            </div>
            <div className="asapLaneScroll">
              {asapTasks.map((t) => (
                <button key={t.id} type="button" className={`asapPill ${selectedTask?.id === t.id ? "active" : ""}`}
                  onClick={() => { setSelectedDate(null); setSelectedTask(t); resetNoteForm(); }}>
                  <span className="asapDot" />
                  <span className="asapText">{t.title}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Calendar grid */}
        <div className="calendarGrid">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="calendarDayHead">{d}</div>
          ))}
          {calendarDays.map((day) => {
            const dtasks = tasksByDate.get(day.date) ?? [];
            const dnotes = notesByDate.get(day.date) ?? [];
            const isSelected = selectedDate === day.date;
            return (
              <div key={day.date}
                className={`calendarCell ${day.current ? "" : "otherMonth"} ${day.isToday ? "today" : ""} ${isSelected ? "calCellSelected" : ""}`}
                onClick={() => selectDay(day.date)}>
                <div className="calendarDayNum">{day.day}</div>
                <div className="calendarTaskList">
                  {dnotes.map((n) => (
                    <div key={n.id} className="calNoteChip" style={{ borderLeftColor: noteColorCss(n.color) }} title={`${n.title}${n.is_public ? " (Public)" : " (Private)"}`}>
                      <span className="calNoteChipVis">{n.is_public ? "🌐" : "🔒"}</span>
                      {n.title}
                    </div>
                  ))}
                  {dtasks.map((t) => (
                    <div key={t.id}
                      className={`calendarTask ${selectedTask?.id === t.id ? "active" : ""} ${t.status === "done" ? "done" : ""}`}
                      onClick={(e) => { e.stopPropagation(); setSelectedDate(null); setSelectedTask(t); resetNoteForm(); }}
                      title={`${t.title} (${t.workspace_name})`}>
                      {t.title}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Side panel: selected DAY ── */}
      {selectedDate ? (
        <div className="calPageSide">
          <div className="calPageSideHeader">
            <div>
              <div className="calPageSideDateLabel">{formatDateLabel(selectedDate)}</div>
              <div className="muted" style={{ marginTop: 2 }}>
                {dayTasks.length} task{dayTasks.length !== 1 ? "s" : ""} · {dayNotes.length} note{dayNotes.length !== 1 ? "s" : ""}
              </div>
            </div>
            <button className="bpChip" type="button" onClick={() => { setSelectedDate(null); resetNoteForm(); }}>&#10005;</button>
          </div>

          {/* Notes section */}
          <div className="calNotesSection">
            <div className="calNotesSectionHead">
              <span>Notes</span>
              <button className="calAddNoteBtn" type="button" onClick={startAddNote}>+ Add Note</button>
            </div>

            {/* Note form */}
            {showNoteForm ? (
              <div className="calNoteForm">
                <input ref={titleRef} className="calNoteInput" placeholder="Note title…" value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)} maxLength={200}
                  onKeyDown={(e) => { if (e.key === "Enter") void saveNote(); }} />
                <textarea className="calNoteTextarea" placeholder="Details (optional)…" value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)} rows={3} maxLength={2000} />
                <div className="calNoteColorRow">
                  {NOTE_COLORS.map((c) => (
                    <button key={c.value} type="button" title={c.label}
                      className={`calNoteColorDot ${noteColor === c.value ? "active" : ""}`}
                      style={{ background: c.css }}
                      onClick={() => setNoteColor(c.value)} />
                  ))}
                </div>
                <div className="calNoteVisRow">
                  <button type="button"
                    className={`calVisOption ${!notePublic ? "active" : ""}`}
                    onClick={() => setNotePublic(false)}>
                    <span className="calVisIcon">🔒</span>
                    <span className="calVisText">Private</span>
                  </button>
                  <button type="button"
                    className={`calVisOption ${notePublic ? "active" : ""}`}
                    onClick={() => setNotePublic(true)}>
                    <span className="calVisIcon">🌐</span>
                    <span className="calVisText">Public</span>
                  </button>
                </div>
                <div className="calNoteFormActions">
                  <button className="primaryBtn" type="button" disabled={!noteTitle.trim() || noteSaving}
                    onClick={() => void saveNote()}>
                    {noteSaving ? "Saving…" : editingNoteId ? "Update" : "Save"}
                  </button>
                  <button className="secondaryBtn" type="button" onClick={resetNoteForm}>Cancel</button>
                </div>
              </div>
            ) : null}

            {/* Note list */}
            {dayNotes.length === 0 && !showNoteForm ? (
              <div className="calNotesEmpty">No notes yet. Click "+ Add Note" to create one.</div>
            ) : null}
            {dayNotes.map((n) => {
              const isOwn = n.user_id === userId;
              return (
                <div key={n.id} className="calNoteCard" style={{ borderLeftColor: noteColorCss(n.color) }}>
                  <div className="calNoteCardHeader">
                    <div className="calNoteCardTitle">{n.title}</div>
                    <span className={`calNoteVisTag ${n.is_public ? "calNoteVisTagPublic" : "calNoteVisTagPrivate"}`}>
                      {n.is_public ? "🌐 Public" : "🔒 Private"}
                    </span>
                  </div>
                  {n.body ? <div className="calNoteCardBody">{n.body}</div> : null}
                  {isOwn ? (
                    <div className="calNoteCardActions">
                      <button type="button" className="calNoteActionBtn" onClick={() => startEditNote(n)}>Edit</button>
                      <button type="button" className="calNoteActionBtn calNoteActionDanger" onClick={() => void deleteNote(n.id)}>Delete</button>
                    </div>
                  ) : (
                    <div className="calNoteCardMeta muted" style={{ fontSize: 11, marginTop: 4 }}>Shared note</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Tasks on this day */}
          {dayTasks.length > 0 ? (
            <div className="calNotesSection">
              <div className="calNotesSectionHead"><span>Tasks Due</span></div>
              {dayTasks.map((t) => (
                <button key={t.id} type="button" className="calDayTaskCard" onClick={() => nav(`/w/${t.workspace_id}`)}>
                  <div className="calDayTaskTitle">{t.title}</div>
                  <div className="calDayTaskMeta">
                    <span className={`statusPill ${t.status}`} style={{ fontSize: 9 }}>
                      {t.status === "done" ? "✓ Done" : t.status === "in_progress" ? "◐ In Progress" : "○ Open"}
                    </span>
                    {t.workspace_name ? <span className="muted">{t.workspace_name}</span> : null}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Side panel: selected TASK (from ASAP) ── */}
      {selectedTask && !selectedDate ? (
        <div className="calPageSide">
          <div className="calPageSideHeader">
            <div className="bpDetailTitle">{selectedTask.title}</div>
            <button className="bpChip" type="button" onClick={() => setSelectedTask(null)}>&#10005;</button>
          </div>
          <div className="calPageSideBody">
            <div className="bpDetailMeta">
              <span>Due {selectedTask.due_date ?? "ASAP"}</span>
              {selectedTask.workspace_name ? <><span className="bpStatDot" /><span>{selectedTask.workspace_name}</span></> : null}
              {selectedTask.company ? <><span className="bpStatDot" /><span>{selectedTask.company}</span></> : null}
              {selectedTask.responsible_name ? <><span className="bpStatDot" /><span>{selectedTask.responsible_name}</span></> : null}
            </div>
            <div className={`statusPill ${selectedTask.status}`}>
              {selectedTask.status === "done" ? "✓ Complete" : selectedTask.status === "in_progress" ? "◐ In Progress" : "○ Open"}
            </div>
            <button className="primaryBtn" style={{ marginTop: 12 }} type="button" onClick={() => nav(`/w/${selectedTask.workspace_id}`)}>
              Open in Workspace
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
