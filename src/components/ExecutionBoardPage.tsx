import React, { useMemo, useState } from "react";
import type {
  BoardMode,
  DB,
  Shift,
  ShiftActivity,
  TaskEvent,
} from "../types";
import {
  addShiftNoteDB,
  addTaskEventDB,
  getLatestTaskEvent,
  getTaskEventsForActivity,
} from "../dbHelpers";
import { NavBar } from "./NavBar";

export interface ExecutionBoardPageProps {
  db: DB;
  setDB: (db: DB) => void;
  shiftId: number;
  onBackToShifts: () => void;
  onDashboardClick: () => void;
}

type ThemeConfig = {
  pageClass: string;
  badgeClass: string;
  accentStyle: React.CSSProperties;
  softStyle: React.CSSProperties;
};

const THEMES: Record<BoardMode, ThemeConfig> = {
  Primary: {
    pageClass: "execution-theme-primary",
    badgeClass: "theme-badge-primary",
    accentStyle: {
      background: "linear-gradient(135deg, #0b3a82, #00bcff)",
      color: "#ffffff",
    },
    softStyle: {
      background: "rgba(11, 58, 130, 0.08)",
      border: "1px solid rgba(11, 58, 130, 0.18)",
      color: "#0b3a82",
    },
  },
  Secondary: {
    pageClass: "execution-theme-secondary",
    badgeClass: "theme-badge-secondary",
    accentStyle: {
      background: "linear-gradient(135deg, #4c9c2e, #89d329)",
      color: "#ffffff",
    },
    softStyle: {
      background: "rgba(76, 156, 46, 0.10)",
      border: "1px solid rgba(76, 156, 46, 0.22)",
      color: "#2e6d1d",
    },
  },
};

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeBoardMode(name: string): BoardMode | null {
  const normalized = name.trim().toLowerCase();
  if (normalized === "primary" || normalized === "primär" || normalized === "primaer") {
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

function statusLabel(status: TaskEvent["status"]): string {
  if (status === "done") return "Erledigt";
  if (status === "blocked") return "Blockiert";
  return "Übersprungen";
}

function statusClass(status: TaskEvent["status"]): string {
  if (status === "done") return "status-done";
  if (status === "blocked") return "status-blocked";
  return "status-skipped";
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

  const boardRoots = useMemo(() => {
    if (!shift) return [];
    return sortActivities(
      shift.shiftActivities.filter((entry) => {
        if (entry.parentIdSnapshot !== null) return false;
        return normalizeBoardMode(entry.nameSnapshot) !== null;
      })
    );
  }, [shift]);

  const [selectedMode, setSelectedMode] = useState<BoardMode>(() => {
    const first = boardRoots[0];
    return first ? normalizeBoardMode(first.nameSnapshot) ?? "Primary" : "Primary";
  });

  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [shiftNote, setShiftNote] = useState("");
  const [shiftNoteKind, setShiftNoteKind] = useState<"handover" | "warning" | "info">(
    "handover"
  );

  if (!shift) {
    return (
      <>
        <NavBar active="execution" onDashboardClick={onDashboardClick} />
        <main className="main dashboard-layout">
          <article className="card empty">
            Schicht nicht gefunden.
            <div style={{ marginTop: 16 }}>
              <button type="button" className="btn-primary" onClick={onBackToShifts}>
                Zurück zu Schichten
              </button>
            </div>
          </article>
        </main>
      </>
    );
  }

  const selectedRoot =
    boardRoots.find(
      (entry) => normalizeBoardMode(entry.nameSnapshot) === selectedMode
    ) ?? boardRoots[0] ?? null;

  const theme = THEMES[selectedMode];

  const levelTwoGroups = selectedRoot
    ? sortActivities(
        shift.shiftActivities.filter(
          (entry) => entry.parentIdSnapshot === selectedRoot.id
        )
      )
    : [];

  const getChildren = (parentId: number) =>
    sortActivities(
      shift.shiftActivities.filter((entry) => entry.parentIdSnapshot === parentId)
    );

  const handleTaskEvent = (
    shiftActivityId: number,
    status: TaskEvent["status"],
    note = ""
  ) => {
    const next = addTaskEventDB(db, shift.id, shiftActivityId, status, note);
    setDB(next);
    setNoteDrafts((current) => ({ ...current, [shiftActivityId]: "" }));
  };

  const handleAddShiftNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftNote.trim()) return;
    const next = addShiftNoteDB(db, shift.id, shiftNote, shiftNoteKind);
    setDB(next);
    setShiftNote("");
  };

  return (
    <>
      <NavBar active="execution" onDashboardClick={onDashboardClick} />

      <main className={`main dashboard-layout ${theme.pageClass}`}>
        <section className="card" style={theme.accentStyle}>
          <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
            <div>
              <div className={`theme-badge ${theme.badgeClass}`}>{selectedMode}</div>
              <h1 className="card-title" style={{ color: "inherit", marginTop: 10 }}>
                Execution Board
              </h1>
              <p className="card-subtitle" style={{ color: "rgba(255,255,255,0.92)" }}>
                {shift.operator} · {shift.line} · {shift.shiftType} · {shift.date}
              </p>
            </div>

            <div className="row" style={{ marginLeft: "auto", gap: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={onBackToShifts}
                style={{
                  background: "rgba(255,255,255,0.14)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.24)",
                }}
              >
                Zurück
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            {(["Primary", "Secondary"] as BoardMode[]).map((mode) => {
              const exists = boardRoots.some(
                (entry) => normalizeBoardMode(entry.nameSnapshot) === mode
              );

              return (
                <button
                  key={mode}
                  type="button"
                  className={selectedMode === mode ? "btn-primary" : "btn-secondary"}
                  onClick={() => setSelectedMode(mode)}
                  disabled={!exists}
                  style={
                    selectedMode === mode ? theme.accentStyle : undefined
                  }
                >
                  {mode}
                </button>
              );
            })}
          </div>
        </section>

        {!selectedRoot ? (
          <section className="card empty">
            Kein Top Parent für {selectedMode} gefunden. Lege im DB einen Root-Eintrag
            mit dem Namen Primary oder Secondary an.
          </section>
        ) : (
          <section className="dashboard-grid">
            <article className="card">
              <div className="row">
                <div>
                  <h2 className="card-title">Workflow</h2>
                  <p className="card-subtitle">
                    Aufgaben aus dem DB für {selectedMode}
                  </p>
                </div>
              </div>

              <div className="task-group-list">
                {levelTwoGroups.length === 0 ? (
                  <div className="card empty">
                    Keine Gruppen unter {selectedMode} gefunden.
                  </div>
                ) : (
                  levelTwoGroups.map((group) => {
                    const tasks = getChildren(group.id);

                    return (
                      <section
                        key={group.id}
                        className="card"
                        style={{ ...theme.softStyle, marginBottom: 16 }}
                      >
                        <div className="row">
                          <div>
                            <h3 className="card-title" style={{ marginBottom: 4 }}>
                              {group.nameSnapshot}
                            </h3>
                            <p className="card-subtitle">
                              {tasks.length} Aufgabe{tasks.length === 1 ? "" : "n"}
                            </p>
                          </div>
                        </div>

                        {tasks.length === 0 ? (
                          <div className="card empty">
                            Keine Aufgaben in dieser Gruppe.
                          </div>
                        ) : (
                          <div className="task-list">
                            {tasks.map((task) => {
                              const latest = getLatestTaskEvent(shift, task.id);
                              const history = getTaskEventsForActivity(shift, task.id);
                              const draft = noteDrafts[task.id] ?? "";

                              return (
                                <article key={task.id} className="task-row">
                                  <div className="task-main">
                                    <div className="task-title-row">
                                      <h4 className="task-title">{task.nameSnapshot}</h4>
                                      {latest ? (
                                        <span
                                          className={`status-pill ${statusClass(
                                            latest.status
                                          )}`}
                                        >
                                          {statusLabel(latest.status)}
                                        </span>
                                      ) : (
                                        <span className="status-pill">Offen</span>
                                      )}
                                    </div>

                                    <div className="task-meta">
                                      {latest ? (
                                        <>
                                          Letzter Eintrag: {formatDateTime(latest.timestamp)}
                                          {latest.note ? ` · ${latest.note}` : ""}
                                        </>
                                      ) : (
                                        <>Noch keine Zeitstempel.</>
                                      )}
                                    </div>

                                    <div
                                      className="row"
                                      style={{
                                        gap: 8,
                                        marginTop: 12,
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <button
                                        type="button"
                                        className="btn-primary"
                                        onClick={() => handleTaskEvent(task.id, "done")}
                                      >
                                        Done
                                      </button>

                                      <button
                                        type="button"
                                        className="btn-secondary"
                                        onClick={() => handleTaskEvent(task.id, "blocked", draft)}
                                      >
                                        Blocked
                                      </button>

                                      <button
                                        type="button"
                                        className="btn-secondary"
                                        onClick={() => handleTaskEvent(task.id, "skipped", draft)}
                                      >
                                        Skip
                                      </button>
                                    </div>

                                    <div style={{ marginTop: 12 }}>
                                      <input
                                        className="input"
                                        type="text"
                                        value={draft}
                                        onChange={(e) =>
                                          setNoteDrafts((current) => ({
                                            ...current,
                                            [task.id]: e.target.value,
                                          }))
                                        }
                                        placeholder="Optionale Notiz"
                                      />
                                    </div>

                                    {history.length > 0 ? (
                                      <div style={{ marginTop: 14 }}>
                                        <div className="task-history-title">
                                          Zeitstempel-Historie
                                        </div>
                                        <div className="task-history-list">
                                          {history.map((event) => (
                                            <div key={event.id} className="task-history-item">
                                              <span
                                                className={`status-pill ${statusClass(
                                                  event.status
                                                )}`}
                                              >
                                                {statusLabel(event.status)}
                                              </span>
                                              <span>{formatDateTime(event.timestamp)}</span>
                                              {event.note ? <span>· {event.note}</span> : null}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })
                )}
              </div>
            </article>

            <article className="card">
              <h2 className="card-title">Schichtnotizen</h2>
              <p className="card-subtitle">
                Übergabe, Warnungen und Infos für diese Schicht
              </p>

              <form onSubmit={handleAddShiftNote} className="new-shift-form">
                <div className="field">
                  <label className="label" htmlFor="shift-note-kind">
                    Typ
                  </label>
                  <select
                    id="shift-note-kind"
                    className="select"
                    value={shiftNoteKind}
                    onChange={(e) =>
                      setShiftNoteKind(
                        e.target.value as "handover" | "warning" | "info"
                      )
                    }
                  >
                    <option value="handover">Übergabe</option>
                    <option value="warning">Warnung</option>
                    <option value="info">Info</option>
                  </select>
                </div>

                <div className="field">
                  <label className="label" htmlFor="shift-note-text">
                    Notiz
                  </label>
                  <input
                    id="shift-note-text"
                    className="input"
                    type="text"
                    value={shiftNote}
                    onChange={(e) => setShiftNote(e.target.value)}
                    placeholder="Schichtnotiz eingeben"
                  />
                </div>

                <div className="new-shift-actions">
                  <button type="submit" className="btn-primary">
                    Notiz speichern
                  </button>
                </div>
              </form>

              <div style={{ marginTop: 20 }}>
                {shift.notes.length === 0 ? (
                  <div className="card empty">Noch keine Notizen vorhanden.</div>
                ) : (
                  <div className="task-history-list">
                    {[...shift.notes]
                      .sort((a, b) => b.createdAt - a.createdAt)
                      .map((note) => (
                        <div key={note.id} className="task-history-item">
                          <span className="status-pill">{note.kind}</span>
                          <span>{formatDateTime(note.createdAt)}</span>
                          <span>· {note.text}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </article>
          </section>
        )}
      </main>
    </>
  );
}
