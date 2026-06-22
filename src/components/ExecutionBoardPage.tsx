import React, { useEffect, useMemo, useState } from "react";
import type { BoardMode, DB, Shift, ShiftActivity, TaskEvent } from "../types";
import {
  addShiftNoteDB,
  addTaskEventDB,
  getLatestTaskEvent,
  getTaskEventsForActivity,
} from "../dbHelpers";
import { NavBar } from "./NavBar";

type ExecutionBoardPageProps = {
  db: DB;
  setDB: (db: DB) => void;
  shiftId: number;
  onBackToShifts: () => void;
  onDashboardClick: () => void;
};

const SCHICHT_LABEL: Record<Shift["shiftType"], string> = {
  Frueh: "Frühschicht",
  Spaet: "Spätschicht",
  Nacht: "Nachtschicht",
};

const BEREICH_LABEL: Record<BoardMode, string> = {
  Primary: "Primär",
  Secondary: "Sekundär",
};

function formatDatum(iso: string): string {
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

function formatZeitstempel(timestamp: number): string {
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

function sortActivities(items: ShiftActivity[]): ShiftActivity[] {
  return [...items].sort((a, b) => a.sortOrderSnapshot - b.sortOrderSnapshot);
}

function isAutomaticParentNote(note: string): boolean {
  return note === "__AUTO_PARENT_DONE__";
}

export function ExecutionBoardPage({
  db,
  setDB,
  shiftId,
  onBackToShifts,
  onDashboardClick,
}: ExecutionBoardPageProps) {
  const shift = useMemo<Shift | null>(
    () => db.shifts.find((entry) => entry.id === shiftId) ?? null,
    [db.shifts, shiftId]
  );

  const [selectedMode, setSelectedMode] = useState<BoardMode>("Primary");
  const [selectedParentId, setSelectedParentId] = useState<number | null>(null);
  const [taskNoteDrafts, setTaskNoteDrafts] = useState<Record<number, string>>({});
  const [shiftNote, setShiftNote] = useState("");
  const [shiftNoteKind, setShiftNoteKind] = useState<"handover" | "warning" | "info">(
    "handover"
  );

  const rootAreas = useMemo(() => {
    if (!shift) return [];

    return sortActivities(
      shift.shiftActivities.filter((entry) => {
        if (entry.parentIdSnapshot !== null) return false;
        return normalizeBoardMode(entry.nameSnapshot) !== null;
      })
    );
  }, [shift]);

  useEffect(() => {
    if (rootAreas.length === 0) return;

    const hasSelected = rootAreas.some(
      (entry) => normalizeBoardMode(entry.nameSnapshot) === selectedMode
    );

    if (!hasSelected) {
      const fallback = normalizeBoardMode(rootAreas[0].nameSnapshot);
      if (fallback) setSelectedMode(fallback);
    }
  }, [rootAreas, selectedMode]);

  const selectedRoot =
    rootAreas.find(
      (entry) => normalizeBoardMode(entry.nameSnapshot) === selectedMode
    ) ?? null;

  const parentGroups = useMemo(() => {
    if (!shift || !selectedRoot) return [];

    return sortActivities(
      shift.shiftActivities.filter(
        (entry) => entry.parentIdSnapshot === selectedRoot.id
      )
    );
  }, [shift, selectedRoot]);

  useEffect(() => {
    if (parentGroups.length === 0) {
      setSelectedParentId(null);
      return;
    }

    const stillExists = parentGroups.some((entry) => entry.id === selectedParentId);

    if (!stillExists) {
      setSelectedParentId(parentGroups[0].id);
    }
  }, [parentGroups, selectedParentId]);

  const selectedParent =
    parentGroups.find((entry) => entry.id === selectedParentId) ?? null;

  const visibleTasks = useMemo(() => {
    if (!shift || !selectedParent) return [];

    return sortActivities(
      shift.shiftActivities.filter(
        (entry) => entry.parentIdSnapshot === selectedParent.id
      )
    );
  }, [shift, selectedParent]);

  const latestEventByTaskId = useMemo(() => {
    if (!shift) return new Map<number, TaskEvent | null>();

    return new Map(
      shift.shiftActivities.map((activity) => [
        activity.id,
        getLatestTaskEvent(shift, activity.id),
      ])
    );
  }, [shift]);

  useEffect(() => {
    setTaskNoteDrafts((current) => {
      const next = { ...current };

      for (const task of visibleTasks) {
        const latest = latestEventByTaskId.get(task.id);
        next[task.id] =
          current[task.id] ??
          (latest && !isAutomaticParentNote(latest.note) ? latest.note : "");
      }

      return next;
    });
  }, [visibleTasks, latestEventByTaskId]);

  useEffect(() => {
    if (!shift || !selectedParent) return;
    if (!selectedParent.nameSnapshot.match(/^MO Start$|^MO Ende$/i)) return;
    if (visibleTasks.length === 0) return;

    const latestParentEvent = getLatestTaskEvent(shift, selectedParent.id);
    const allDone = visibleTasks.every(
      (task) => latestEventByTaskId.get(task.id)?.status === "done"
    );

    if (allDone) {
      const parentAlreadyAutoDone =
        latestParentEvent?.status === "done" &&
        isAutomaticParentNote(latestParentEvent.note);

      if (!parentAlreadyAutoDone) {
        const next = addTaskEventDB(
          db,
          shift.id,
          selectedParent.id,
          "done",
          "__AUTO_PARENT_DONE__"
        );
        setDB(next);
      }

      return;
    }

    const hasAutoDoneEvent = shift.taskEvents.some(
      (event) =>
        event.shiftActivityId === selectedParent.id &&
        event.status === "done" &&
        isAutomaticParentNote(event.note)
    );

    if (hasAutoDoneEvent) {
      const next: DB = {
        ...db,
        shifts: db.shifts.map((entry) =>
          entry.id === shift.id
            ? {
                ...entry,
                taskEvents: entry.taskEvents.filter(
                  (event) =>
                    !(
                      event.shiftActivityId === selectedParent.id &&
                      event.status === "done" &&
                      isAutomaticParentNote(event.note)
                    )
                ),
              }
            : entry
        ),
      };

      setDB(next);
    }
  }, [db, setDB, shift, selectedParent, visibleTasks, latestEventByTaskId]);

  if (!shift) {
    return (
      <>
        <NavBar active="board" onDashboardClick={onDashboardClick} />
        <main className="main dashboard-layout">
          <article className="card empty">
            Schicht nicht gefunden.
          </article>
        </main>
      </>
    );
  }

  const datumLabel = formatDatum(shift.date);

  const leafTaskIds = new Set(
    shift.shiftActivities
      .map((entry) => entry.parentIdSnapshot)
      .filter((value): value is number => value !== null)
  );

  const totalLeafTasks = shift.shiftActivities.filter(
    (entry) => !leafTaskIds.has(entry.id)
  ).length;

  const latestEvents = shift.shiftActivities
    .map((entry) => getLatestTaskEvent(shift, entry.id))
    .filter((entry): entry is TaskEvent => entry !== null);

  const erledigtCount = latestEvents.filter((entry) => entry.status === "done").length;
  const blockiertCount = latestEvents.filter(
    (entry) => entry.status === "blocked"
  ).length;
  const uebersprungenCount = latestEvents.filter(
    (entry) => entry.status === "skipped"
  ).length;

  const offeneCount = Math.max(
    totalLeafTasks - erledigtCount - blockiertCount - uebersprungenCount,
    0
  );

  const gruppenErledigt = visibleTasks.filter(
    (task) => latestEventByTaskId.get(task.id)?.status === "done"
  ).length;

  const gruppenFortschritt =
    visibleTasks.length > 0
      ? Math.round((gruppenErledigt / visibleTasks.length) * 100)
      : 0;

  const saveStatus = (task: ShiftActivity, status: TaskEvent["status"]) => {
    const note = (taskNoteDrafts[task.id] ?? "").trim();
    const next = addTaskEventDB(db, shift.id, task.id, status, note);
    setDB(next);
  };

  const saveShiftNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftNote.trim()) return;

    const next = addShiftNoteDB(db, shift.id, shiftNote, shiftNoteKind);
    setDB(next);
    setShiftNote("");
  };

  return (
    <>
      <NavBar active="board" onDashboardClick={onDashboardClick} />

      <main className="main dashboard-layout">
        <section className="card">
          <div className="row">
            <div>
              <h1 className="card-title">Ausführungsboard</h1>
              <p className="card-subtitle">
                {SCHICHT_LABEL[shift.shiftType]} · {datumLabel} · CWID {shift.operator} ·{" "}
                {shift.line}
              </p>
            </div>

            <div className="spacer" />

            <button type="button" className="btn-ghost" onClick={onBackToShifts}>
              ← Zurück zu Schichten
            </button>
          </div>
        </section>

        <section className="grid grid-3">
          <article className="kpi-card">
            <div className="kpi-label">Gesamtaufgaben</div>
            <div className="kpi-value">{totalLeafTasks}</div>
          </article>

          <article className="kpi-card">
            <div className="kpi-label">Erledigt</div>
            <div className="kpi-value">{erledigtCount}</div>
          </article>

          <article className="kpi-card">
            <div className="kpi-label">Offen / Blockiert / Übersprungen</div>
            <div className="kpi-value">
              {offeneCount} / {blockiertCount} / {uebersprungenCount}
            </div>
          </article>
        </section>

        <section className="dashboard-grid">
          <article className="card">
            <h2 className="card-title">Bereiche</h2>
            <p className="card-subtitle">
              Wähle zwischen Primär und Sekundär.
            </p>

            <div className="parent-list">
              {(["Primary", "Secondary"] as BoardMode[]).map((mode) => {
                const exists = rootAreas.some(
                  (entry) => normalizeBoardMode(entry.nameSnapshot) === mode
                );

                return (
                  <button
                    key={mode}
                    type="button"
                    className={`parent-pill ${selectedMode === mode ? "parent-pill--active" : ""}`}
                    onClick={() => setSelectedMode(mode)}
                    disabled={!exists}
                  >
                    {BEREICH_LABEL[mode]}
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 18 }}>
              <h3 className="card-title" style={{ fontSize: 16 }}>
                MO-Bereiche
              </h3>
              <p className="card-subtitle">
                Wähle einen Elternpunkt wie MO Start oder MO Ende.
              </p>

              {parentGroups.length === 0 ? (
                <div className="card empty">Keine Bereiche gefunden.</div>
              ) : (
                <div className="parent-list">
                  {parentGroups.map((parent) => {
                    const latest = latestEventByTaskId.get(parent.id);

                    return (
                      <button
                        key={parent.id}
                        type="button"
                        className={`parent-pill ${selectedParentId === parent.id ? "parent-pill--active" : ""}`}
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

          <article className="card">
            <h2 className="card-title">
              {selectedParent ? selectedParent.nameSnapshot : "Aufgaben"}
            </h2>
            <p className="card-subtitle">
              {selectedParent
                ? "Unteraufgaben dieses Elternpunkts."
                : "Wähle links einen Elternpunkt aus."}
            </p>

            {selectedParent ? (
              <div className="task-progress-card">
                <div className="task-progress-head">
                  <span className="task-progress-title">Fortschritt</span>
                  <span className="task-progress-value">
                    {gruppenErledigt} / {visibleTasks.length} erledigt ({gruppenFortschritt}%)
                  </span>
                </div>

                <div className="task-progress-bar">
                  <div
                    className="task-progress-bar-fill"
                    style={{ width: `${gruppenFortschritt}%` }}
                  />
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
                  const latest = latestEventByTaskId.get(task.id);
                  const history = getTaskEventsForActivity(shift, task.id);

                  return (
                    <div key={task.id} className="shift-card task-card">
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
                            ? `Letzter Zeitstempel: ${formatZeitstempel(latest.timestamp)}`
                            : "Noch kein Zeitstempel"}
                        </div>

                        <div className="task-actions">
                          <button
                            type="button"
                            className="btn-primary task-status-btn"
                            onClick={() => saveStatus(task, "done")}
                          >
                            Erledigt
                          </button>

                          <button
                            type="button"
                            className="btn-ghost task-status-btn"
                            onClick={() => saveStatus(task, "blocked")}
                          >
                            Blockiert
                          </button>

                          <button
                            type="button"
                            className="btn-ghost task-status-btn"
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
                            className="input textarea task-note-textarea"
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
                          <div className="task-note-preview">
                            <strong>Historie:</strong>
                            <div style={{ marginTop: 8 }}>
                              {history.map((event) => (
                                <div key={event.id} className="shift-sub">
                                  {statusLabel(event.status)} ·{" "}
                                  {formatZeitstempel(event.timestamp)}
                                  {event.note && !isAutomaticParentNote(event.note)
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

        <section className="card">
          <h2 className="card-title">Übergabe & Meldungen</h2>
          <p className="card-subtitle">
            Hinweise für die nächste Schicht, Warnungen oder allgemeine Infos.
          </p>

          <form onSubmit={saveShiftNote}>
            <div className="field">
              <label className="label" htmlFor="shift-note-kind">
                Typ
              </label>

              <select
                id="shift-note-kind"
                className="select"
                value={shiftNoteKind}
                onChange={(event) =>
                  setShiftNoteKind(
                    event.target.value as "handover" | "warning" | "info"
                  )
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
                className="input textarea"
                value={shiftNote}
                onChange={(event) => setShiftNote(event.target.value)}
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
            {shift.notes.length === 0 ? (
              <div className="card empty">
                Noch keine Übergaben oder Meldungen erfasst.
              </div>
            ) : (
              [...shift.notes]
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
                        {formatZeitstempel(note.createdAt)}
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
