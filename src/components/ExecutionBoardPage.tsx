import React, { useEffect, useMemo, useState } from "react";
import type { BoardMode, DB, Shift, ShiftActivity, TaskEvent } from "../types";
import {
  addShiftNoteDB,
  addTaskEventDB,
  getLatestTaskEvent,
  getTaskEventsForActivity,
  removeAutoParentDoneEventDB,
} from "../dbHelpers";
import { NavBar } from "./NavBar";

type ExecutionBoardPageProps = {
  db: DB;
  setDB: (db: DB) => void;
  shiftId: number;
  onBackToShifts: () => void;
  onDashboardClick: () => void;
};

const SHIFT_LABEL: Record<Shift["shiftType"], string> = {
  Frueh: "Frühschicht",
  Spaet: "Spätschicht",
  Nacht: "Nachtschicht",
};

const BOARD_LABEL: Record<BoardMode, string> = {
  Primary: "Primär",
  Secondary: "Sekundär",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("de-DE", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatTimestamp(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(timestamp);
  }
}

function statusLabel(status: TaskEvent["status"]): string {
  switch (status) {
    case "done":
      return "Erledigt";
    case "blocked":
      return "Blockiert";
    case "skipped":
      return "Übersprungen";
    default:
      return "Offen";
  }
}

function normalizeBoardMode(name: string): BoardMode | null {
  const normalized = name.trim().toLowerCase();

  if (
    normalized === "primary" ||
    normalized === "primär" ||
    normalized === "primaer"
  ) {
    return "Primary";
  }

  if (
    normalized === "secondary" ||
    normalized === "sekundär" ||
    normalized === "sekundaer"
  ) {
    return "Secondary";
  }

  return null;
}

function getBoardTheme(mode: BoardMode): React.CSSProperties {
  if (mode === "Secondary") {
    return {
      ["--context-accent" as string]: "#89D329",
      ["--context-accent-strong" as string]: "#5FAE1F",
      ["--context-accent-soft" as string]: "rgba(137, 211, 41, 0.14)",
      ["--context-accent-border" as string]: "rgba(137, 211, 41, 0.42)",
      ["--context-accent-shadow" as string]: "rgba(137, 211, 41, 0.22)",
    };
  }

  return {
    ["--context-accent" as string]: "#00BCFF",
    ["--context-accent-strong" as string]: "#007CC2",
    ["--context-accent-soft" as string]: "rgba(0, 188, 255, 0.14)",
    ["--context-accent-border" as string]: "rgba(0, 188, 255, 0.42)",
    ["--context-accent-shadow" as string]: "rgba(0, 188, 255, 0.22)",
  };
}

function sortActivities(items: ShiftActivity[]): ShiftActivity[] {
  return [...items].sort((a, b) => a.sortOrderSnapshot - b.sortOrderSnapshot);
}

function isAutoParentDone(note: string): boolean {
  return note === "__AUTO_PARENT_DONE__";
}

export function ExecutionBoardPage({
  db,
  setDB,
  shiftId,
  onBackToShifts,
  onDashboardClick,
}: ExecutionBoardPageProps) {
  const shift = useMemo(
    () => db.shifts.find((entry) => entry.id === shiftId) ?? null,
    [db.shifts, shiftId]
  );

  const [selectedMode, setSelectedMode] = useState<BoardMode>("Primary");
  const [selectedParentId, setSelectedParentId] = useState<number | null>(null);
  const [taskNoteDrafts, setTaskNoteDrafts] = useState<Record<number, string>>({});
  const [noteText, setNoteText] = useState("");
  const [noteKind, setNoteKind] = useState<"handover" | "warning" | "info">(
    "handover"
  );

  const shiftActivities = shift?.shiftActivities ?? [];
  const shiftNotes = shift?.notes ?? [];
  const shiftTaskEvents = shift?.taskEvents ?? [];

  const topLevelParents = useMemo(() => {
    return sortActivities(
      shiftActivities.filter((activity) => activity.parentIdSnapshot === null)
    );
  }, [shiftActivities]);

  useEffect(() => {
    const availableModes = topLevelParents
      .map((parent) => normalizeBoardMode(parent.nameSnapshot))
      .filter((value): value is BoardMode => value !== null);

    if (!availableModes.includes(selectedMode) && availableModes[0]) {
      setSelectedMode(availableModes[0]);
    }
  }, [topLevelParents, selectedMode]);

  const selectedRoot =
    topLevelParents.find(
      (parent) => normalizeBoardMode(parent.nameSnapshot) === selectedMode
    ) ?? null;

  const parentGroups = useMemo(() => {
    if (!selectedRoot) return [];

    return sortActivities(
      shiftActivities.filter(
        (activity) => activity.parentIdSnapshot === selectedRoot.id
      )
    );
  }, [shiftActivities, selectedRoot]);

  useEffect(() => {
    if (parentGroups.length === 0) {
      setSelectedParentId(null);
      return;
    }

    const exists = parentGroups.some((parent) => parent.id === selectedParentId);
    if (!exists) {
      setSelectedParentId(parentGroups[0].id);
    }
  }, [parentGroups, selectedParentId]);

  const selectedParent =
    parentGroups.find((parent) => parent.id === selectedParentId) ?? null;

  const visibleTasks = useMemo(() => {
    if (!selectedParent) return [];

    return sortActivities(
      shiftActivities.filter(
        (activity) => activity.parentIdSnapshot === selectedParent.id
      )
    );
  }, [shiftActivities, selectedParent]);

  const latestEventByShiftActivityId = useMemo(() => {
    if (!shift) return new Map<number, TaskEvent | null>();

    return new Map(
      shiftActivities.map((activity) => [
        activity.id,
        getLatestTaskEvent(shift, activity.id),
      ])
    );
  }, [shift, shiftActivities]);

  useEffect(() => {
    setTaskNoteDrafts((prev) => {
      const next = { ...prev };

      for (const task of visibleTasks) {
        const latest = latestEventByShiftActivityId.get(task.id);
        next[task.id] =
          prev[task.id] ??
          (latest && !isAutoParentDone(latest.note) ? latest.note : "");
      }

      return next;
    });
  }, [visibleTasks, latestEventByShiftActivityId]);

  useEffect(() => {
    if (!shift || !selectedParent) return;
    if (!/^MO Start$|^MO Ende$/i.test(selectedParent.nameSnapshot)) return;
    if (visibleTasks.length === 0) return;

    const allDone = visibleTasks.every(
      (task) => latestEventByShiftActivityId.get(task.id)?.status === "done"
    );

    const latestParentEvent = getLatestTaskEvent(shift, selectedParent.id);

    if (allDone) {
      const alreadyAutoDone =
        latestParentEvent?.status === "done" &&
        isAutoParentDone(latestParentEvent.note);

      if (!alreadyAutoDone) {
        setDB(
          addTaskEventDB(
            db,
            shift.id,
            selectedParent.id,
            "done",
            "__AUTO_PARENT_DONE__"
          )
        );
      }

      return;
    }

    const hasAutoDone = shiftTaskEvents.some(
      (event) =>
        event.shiftActivityId === selectedParent.id &&
        event.status === "done" &&
        isAutoParentDone(event.note)
    );

    if (hasAutoDone) {
      setDB(removeAutoParentDoneEventDB(db, shift.id, selectedParent.id));
    }
  }, [
    db,
    setDB,
    shift,
    selectedParent,
    visibleTasks,
    latestEventByShiftActivityId,
    shiftTaskEvents,
  ]);

  const dateLabel = shift ? formatDate(shift.date) : "";
  const boardThemeStyle = getBoardTheme(selectedMode);

  const parentIds = new Set(
    shiftActivities
      .map((activity) => activity.parentIdSnapshot)
      .filter((value): value is number => value !== null)
  );

  const totalLeafTasks = shiftActivities.filter(
    (activity) => !parentIds.has(activity.id)
  ).length;

  const latestEvents = shift
    ? shiftActivities
        .map((activity) => getLatestTaskEvent(shift, activity.id))
        .filter((event): event is TaskEvent => event !== null)
    : [];

  const doneCount = latestEvents.filter((event) => event.status === "done").length;
  const blockedCount = latestEvents.filter(
    (event) => event.status === "blocked"
  ).length;
  const skippedCount = latestEvents.filter(
    (event) => event.status === "skipped"
  ).length;
  const openCount = Math.max(
    totalLeafTasks - doneCount - blockedCount - skippedCount,
    0
  );

  const selectedParentStats = useMemo(() => {
    const total = visibleTasks.length;
    const done = visibleTasks.filter(
      (task) => latestEventByShiftActivityId.get(task.id)?.status === "done"
    ).length;
    const blocked = visibleTasks.filter(
      (task) => latestEventByShiftActivityId.get(task.id)?.status === "blocked"
    ).length;
    const skipped = visibleTasks.filter(
      (task) => latestEventByShiftActivityId.get(task.id)?.status === "skipped"
    ).length;
    const open = Math.max(total - done - blocked - skipped, 0);
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    return { total, done, blocked, skipped, open, percent };
  }, [visibleTasks, latestEventByShiftActivityId]);

  const saveStatus = (activity: ShiftActivity, status: TaskEvent["status"]) => {
    if (!shift) return;
    const note = (taskNoteDrafts[activity.id] ?? "").trim();
    setDB(addTaskEventDB(db, shift.id, activity.id, status, note));
  };

  const addShiftNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!shift) return;

    const next = addShiftNoteDB(db, shift.id, noteText, noteKind);
    if (next !== db) {
      setDB(next);
      setNoteText("");
    }
  };

  if (!shift) {
    return (
      <>
        <NavBar active="board" onDashboardClick={onDashboardClick} />
        <main className="main dashboard-layout">
          <article className="card empty">Schicht nicht gefunden.</article>
        </main>
      </>
    );
  }

  return (
    <>
      <NavBar active="board" onDashboardClick={onDashboardClick} />

      <main className="main dashboard-layout" style={boardThemeStyle}>
        <section className="card contextual-card">
          <div className="row">
            <div>
              <h1 className="card-title">Ausführungsboard</h1>
              <p className="card-subtitle">
                {SHIFT_LABEL[shift.shiftType]} · {dateLabel} · CWID {shift.operator} ·{" "}
                {shift.line}
              </p>
            </div>

            <div className="spacer" />

            <button
              type="button"
              className="btn-ghost contextual-ghost-btn"
              onClick={onBackToShifts}
            >
              ← Zurück zu Schichten
            </button>
          </div>
        </section>

        <section className="grid grid-3">
          <article className="kpi-card contextual-card">
            <div className="kpi-label">Gesamtaufgaben</div>
            <div className="kpi-value">{totalLeafTasks}</div>
          </article>

          <article className="kpi-card contextual-card">
            <div className="kpi-label">Erledigt</div>
            <div className="kpi-value">{doneCount}</div>
          </article>

          <article className="kpi-card contextual-card">
            <div className="kpi-label">Offen / Blockiert / Übersprungen</div>
            <div className="kpi-value">
              {openCount} / {blockedCount} / {skippedCount}
            </div>
          </article>
        </section>

        <section className="dashboard-grid">
          <article className="card contextual-card">
            <h2 className="card-title">Bereiche</h2>
            <p className="card-subtitle">Wähle Primär oder Sekundär.</p>

            <div className="parent-list">
              {(["Primary", "Secondary"] as BoardMode[]).map((mode) => {
                const exists = topLevelParents.some(
                  (parent) => normalizeBoardMode(parent.nameSnapshot) === mode
                );

                return (
                  <button
                    key={mode}
                    type="button"
                    className={`parent-pill contextual-pill ${
                      selectedMode === mode ? "parent-pill--active" : ""
                    }`}
                    onClick={() => setSelectedMode(mode)}
                    disabled={!exists}
                  >
                    {BOARD_LABEL[mode]}
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 18 }}>
              <h3 className="card-title" style={{ fontSize: 16 }}>
                Elternpunkte
              </h3>
              <p className="card-subtitle">Wähle MO Start oder MO Ende.</p>

              {parentGroups.length === 0 ? (
                <div className="card empty">Keine Elternpunkte gefunden.</div>
              ) : (
                <div className="parent-list">
                  {parentGroups.map((parent) => {
                    const latest = latestEventByShiftActivityId.get(parent.id);

                    return (
                      <button
                        key={parent.id}
                        type="button"
                        className={`parent-pill contextual-child-pill ${
                          selectedParentId === parent.id ? "parent-pill--active" : ""
                        }`}
                        onClick={() => setSelectedParentId(parent.id)}
                      >
                        {parent.nameSnapshot}
                        {latest?.status === "done" ? " · Erledigt" : ""}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </article>

          <article className="card contextual-card">
            <h2 className="card-title">
              {selectedParent ? selectedParent.nameSnapshot : "Aufgaben"}
            </h2>
            <p className="card-subtitle">
              {selectedParent
                ? "Unteraufgaben dieses Elternpunkts."
                : "Wähle links einen Elternpunkt aus."}
            </p>

            {selectedParent ? (
              <div className="task-progress-card contextual-surface">
                <div className="task-progress-head">
                  <span className="task-progress-title">Fortschritt</span>
                  <span className="task-progress-value">
                    {selectedParentStats.done} / {selectedParentStats.total} erledigt (
                    {selectedParentStats.percent}%)
                  </span>
                </div>

                <div className="task-progress-bar">
                  <div
                    className="task-progress-bar-fill"
                    style={{ width: `${selectedParentStats.percent}%` }}
                  />
                </div>

                <div className="task-progress-meta">
                  <span>Offen: {selectedParentStats.open}</span>
                  <span>Blockiert: {selectedParentStats.blocked}</span>
                  <span>Übersprungen: {selectedParentStats.skipped}</span>
                </div>
              </div>
            ) : null}

            {!selectedParent ? (
              <div className="card empty">Noch kein Elternpunkt ausgewählt.</div>
            ) : visibleTasks.length === 0 ? (
              <div className="card empty">
                Keine Unteraufgaben für diesen Elternpunkt definiert.
              </div>
            ) : (
              <div className="shift-list">
                {visibleTasks.map((task) => {
                  const latest = latestEventByShiftActivityId.get(task.id);
                  const history = getTaskEventsForActivity(shift, task.id);

                  return (
                    <div
                      key={task.id}
                      className="shift-card task-card contextual-task-card"
                    >
                      <div className="shift-meta task-meta">
                        <div className="task-topline">
                          <div className="shift-date">{task.nameSnapshot}</div>

                          <div
                            className={`status-badge ${
                              latest ? `status-${latest.status}` : "status-open"
                            }`}
                          >
                            {latest ? statusLabel(latest.status) : "Offen"}
                          </div>
                        </div>

                        <div className="shift-sub">
                          {latest
                            ? `Letzter Zeitstempel: ${formatTimestamp(latest.timestamp)}`
                            : "Noch kein Zeitstempel"}
                        </div>

                        <div className="task-actions">
                          <button
                            type="button"
                            className={`btn-primary task-status-btn ${
                              latest?.status === "done" ? "is-active" : ""
                            }`}
                            onClick={() => saveStatus(task, "done")}
                          >
                            Erledigt
                          </button>

                          <button
                            type="button"
                            className={`btn-ghost task-status-btn ${
                              latest?.status === "blocked" ? "is-active is-blocked" : ""
                            }`}
                            onClick={() => saveStatus(task, "blocked")}
                          >
                            Blockiert
                          </button>

                          <button
                            type="button"
                            className={`btn-ghost task-status-btn ${
                              latest?.status === "skipped" ? "is-active is-skipped" : ""
                            }`}
                            onClick={() => saveStatus(task, "skipped")}
                          >
                            Übersprungen
                          </button>
                        </div>

                        <div className="field task-note-field">
                          <label className="label" htmlFor={`task-note-${task.id}`}>
                            Notiz
                          </label>

                          <textarea
                            id={`task-note-${task.id}`}
                            className="input textarea task-note-textarea contextual-input"
                            rows={3}
                            value={taskNoteDrafts[task.id] ?? ""}
                            onChange={(event) =>
                              setTaskNoteDrafts((prev) => ({
                                ...prev,
                                [task.id]: event.target.value,
                              }))
                            }
                            placeholder="Hinweis, Beobachtung oder Grund eintragen ..."
                          />
                        </div>

                        {history.length > 0 ? (
                          <div className="task-note-preview contextual-surface">
                            <strong>Historie:</strong>
                            <div style={{ marginTop: 8 }}>
                              {history.map((event) => (
                                <div key={event.id} className="shift-sub">
                                  {statusLabel(event.status)} · {formatTimestamp(event.timestamp)}
                                  {event.note && !isAutoParentDone(event.note)
                                    ? ` · ${event.note}`
                                    : ""}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </section>

        <section className="card contextual-card">
          <h2 className="card-title">Übergabe & Meldungen</h2>
          <p className="card-subtitle">
            Hinweise für die nächste Schicht, Warnungen oder allgemeine Infos.
          </p>

          <form onSubmit={addShiftNote}>
            <div className="field">
              <label className="label" htmlFor="shift-note-kind">
                Typ
              </label>

              <select
                id="shift-note-kind"
                className="select contextual-input"
                value={noteKind}
                onChange={(event) =>
                  setNoteKind(event.target.value as "handover" | "warning" | "info")
                }
              >
                <option value="handover">Übergabe</option>
                <option value="warning">Warnung</option>
                <option value="info">Info</option>
              </select>
            </div>

            <div className="field">
              <label className="label" htmlFor="shift-note">
                Neue Notiz
              </label>

              <textarea
                id="shift-note"
                className="input textarea contextual-input"
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                rows={4}
                placeholder="Zum Beispiel: Material knapp, Linie wartet auf Freigabe ..."
              />
            </div>

            <div className="parent-list" style={{ marginTop: 12 }}>
              <button type="submit" className="btn-primary">
                Notiz speichern
              </button>
            </div>
          </form>

          <div className="shift-list" style={{ marginTop: 16 }}>
            {shiftNotes.length === 0 ? (
              <div className="card empty">
                Noch keine Übergaben oder Meldungen erfasst.
              </div>
            ) : (
              [...shiftNotes]
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((note) => (
                  <div
                    key={note.id}
                    className={`shift-card note-card note-${note.kind}`}
                  >
                    <div className="shift-meta">
                      <div className="shift-date">
                        {note.kind === "handover"
                          ? "Übergabe"
                          : note.kind === "warning"
                          ? "Warnung"
                          : "Info"}
                      </div>

                      <div className="shift-sub">
                        {formatTimestamp(note.createdAt)}
                      </div>

                      <div className="shift-sub">{note.text}</div>
                    </div>
                  </div>
                ))
            )}
          </div>
        </section>
      </main>
    </>
  );
}
