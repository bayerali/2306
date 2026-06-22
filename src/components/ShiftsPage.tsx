import React, { useMemo, useState } from "react";
import type { DB, Line, Shift, ShiftActivity, ShiftType } from "../types";
import { NavBar } from "./NavBar";

const SHIFT_LABEL: Record<ShiftType, string> = {
  Frueh: "Frühschicht",
  Spaet: "Spätschicht",
  Nacht: "Nachtschicht",
};

const LINE_OPTIONS: Line[] = ["SVP03", "SVP05", "SVP06", "SVP09"];

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

function inferShiftTypeFromTime(date = new Date()): ShiftType {
  const hour = date.getHours();
  if (hour >= 6 && hour < 14) return "Frueh";
  if (hour >= 14 && hour < 22) return "Spaet";
  return "Nacht";
}

export interface ShiftsPageProps {
  db: DB;
  setDB: (db: DB) => void;
  onOpenShiftBoard: (shiftId: number) => void;
}

export function ShiftsPage({
  db,
  setDB,
  onOpenShiftBoard,
}: ShiftsPageProps) {
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [shiftType, setShiftType] = useState<ShiftType>(() =>
    inferShiftTypeFromTime()
  );
  const [line, setLine] = useState<Line>("SVP03");
  const [operator, setOperator] = useState("");
  const [formError, setFormError] = useState("");

  const sortedShifts = useMemo(
    () => [...db.shifts].sort((a, b) => b.createdAt - a.createdAt),
    [db.shifts]
  );

  const totalShifts = db.shifts.length;
  const uniqueLines = new Set(db.shifts.map((s) => s.line)).size;
  const todayCount = db.shifts.filter((s) => s.date === today).length;

  const startShift = (e: React.FormEvent) => {
    e.preventDefault();

    const op = operator.trim();
    if (!op) {
      setFormError("Bitte die CWID eingeben.");
      return;
    }

    setFormError("");

    const sortedActivities = db.activities
      .filter((activity) => !activity.archived)
      .slice()
      .sort((a, b) => {
        if (a.parentId === b.parentId) return a.sortOrder - b.sortOrder;
        if (a.parentId === null) return -1;
        if (b.parentId === null) return 1;
        return a.sortOrder - b.sortOrder;
      });

    let nextIdValue = db.nextId;

    const takeId = () => {
      const id = nextIdValue;
      nextIdValue += 1;
      return id;
    };

    const activityIdToShiftActivityId = new Map<number, number>();

    const shiftActivities: ShiftActivity[] = sortedActivities.map((activity) => {
      const shiftActivityId = takeId();
      activityIdToShiftActivityId.set(activity.id, shiftActivityId);

      return {
        id: shiftActivityId,
        activityId: activity.id,
        nameSnapshot: activity.name,
        colorSnapshot: activity.color,
        parentIdSnapshot: null,
        sortOrderSnapshot: activity.sortOrder,
      };
    });

    for (const shiftActivity of shiftActivities) {
      const sourceActivity = sortedActivities.find(
        (activity) => activity.id === shiftActivity.activityId
      );

      if (!sourceActivity) continue;

      shiftActivity.parentIdSnapshot =
        sourceActivity.parentId === null
          ? null
          : activityIdToShiftActivityId.get(sourceActivity.parentId) ?? null;
    }

    const shiftId = takeId();

    const shift: Shift = {
      id: shiftId,
      date,
      shiftType,
      line,
      operator: op,
      createdAt: Date.now(),
      shiftActivities,
      taskEvents: [],
      notes: [],
    };

    const next: DB = {
      ...db,
      nextId: nextIdValue,
      shifts: [shift, ...db.shifts],
    };

    setDB(next);
    setOperator("");
    onOpenShiftBoard(shiftId);
  };

  const deleteShift = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!window.confirm("Diese Schicht wirklich löschen?")) return;

    setDB({
      ...db,
      shifts: db.shifts.filter((s) => s.id !== id),
    });
  };

  return (
    <>
      <NavBar active="shifts" onDashboardClick={() => onOpenShiftBoard(-1)} />

      <main className="main dashboard-layout">
        <section className="grid grid-3">
          <article className="kpi-card">
            <div className="kpi-label">Schichten gesamt</div>
            <div className="kpi-value">{totalShifts}</div>
          </article>

          <article className="kpi-card">
            <div className="kpi-label">Aktive Linien</div>
            <div className="kpi-value">{uniqueLines}</div>
          </article>

          <article className="kpi-card">
            <div className="kpi-label">Heute</div>
            <div className="kpi-value">{todayCount}</div>
          </article>
        </section>

        <section className="dashboard-grid">
          <article className="card">
            <h1 className="card-title">Neue Schicht starten</h1>
            <p className="card-subtitle">
              Erstelle eine neue Schicht und öffne direkt das Ausführungsboard.
            </p>

            <form className="new-shift-form" onSubmit={startShift}>
              <div className="field">
                <label className="label" htmlFor="shift-date">
                  Datum
                </label>
                <input
                  id="shift-date"
                  className="input"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="shift-type">
                  Schicht
                </label>
                <select
                  id="shift-type"
                  className="select"
                  value={shiftType}
                  onChange={(e) => setShiftType(e.target.value as ShiftType)}
                >
                  <option value="Frueh">Frühschicht</option>
                  <option value="Spaet">Spätschicht</option>
                  <option value="Nacht">Nachtschicht</option>
                </select>
              </div>

              <div className="field">
                <label className="label" htmlFor="shift-line">
                  Linie
                </label>
                <select
                  id="shift-line"
                  className="select"
                  value={line}
                  onChange={(e) => setLine(e.target.value as Line)}
                >
                  {LINE_OPTIONS.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="label" htmlFor="shift-operator">
                  CWID
                </label>
                <input
                  id="shift-operator"
                  className="input"
                  type="text"
                  value={operator}
                  onChange={(e) => setOperator(e.target.value)}
                  placeholder="z. B. AB1234"
                />
              </div>

              {formError ? (
                <div className="card empty" style={{ gridColumn: "1 / -1" }}>
                  {formError}
                </div>
              ) : null}

              <div className="new-shift-actions">
                <button type="submit" className="btn-primary start-btn">
                  Schicht starten →
                </button>
              </div>
            </form>
          </article>

          <article className="card">
            <div className="row">
              <div>
                <h2 className="card-title">Letzte Schichten</h2>
                <p className="card-subtitle">{sortedShifts.length} Einträge</p>
              </div>
            </div>

            {sortedShifts.length === 0 ? (
              <div className="card empty">
                Noch keine Schichten. Starte links deine erste Schicht.
              </div>
            ) : (
              <div className="shift-list">
                {sortedShifts.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`shift-card ${s.shiftType}`}
                    onClick={() => onOpenShiftBoard(s.id)}
                  >
                    <div className="shift-meta">
                      <div className="shift-date">{formatDate(s.date)}</div>
                      <div className="shift-sub">
                        {s.operator} · {s.line} · {SHIFT_LABEL[s.shiftType]}
                      </div>
                    </div>

                    <div className="shift-card-footer">
                      <button
                        type="button"
                        className="btn-danger shift-card-done-btn"
                        onClick={(e) => deleteShift(s.id, e)}
                      >
                        Löschen
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </article>
        </section>
      </main>
    </>
  );
}
