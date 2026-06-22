import type {
  Activity,
  CompletionStatus,
  DB,
  Shift,
  ShiftActivity,
  ShiftNoteKind,
  TaskEvent,
} from "./types";
import { newId } from "./storage";

export function requireShift(db: DB, shiftId: number): Shift {
  const shift = db.shifts.find((entry) => entry.id === shiftId);

  if (!shift) {
    throw new Error(`Shift with id ${shiftId} not found`);
  }

  return shift;
}

export function getTaskEventsForActivity(
  shift: Shift,
  shiftActivityId: number
): TaskEvent[] {
  return shift.taskEvents
    .filter((event) => event.shiftActivityId === shiftActivityId)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function getLatestTaskEvent(
  shift: Shift,
  shiftActivityId: number
): TaskEvent | null {
  const events = getTaskEventsForActivity(shift, shiftActivityId);
  return events.length > 0 ? events[0] : null;
}

export function addTaskEventDB(
  db: DB,
  shiftId: number,
  shiftActivityId: number,
  status: CompletionStatus,
  note = ""
): DB {
  const next: DB = {
    ...db,
    nextId: db.nextId,
    shifts: [...db.shifts],
  };

  const id = newId(next);
  next.nextId = id + 1;

  const event: TaskEvent = {
    id,
    shiftActivityId,
    status,
    timestamp: Date.now(),
    note: note.trim(),
    imageData: null,
  };

  next.shifts = next.shifts.map((shift) =>
    shift.id === shiftId
      ? {
          ...shift,
          taskEvents: [...shift.taskEvents, event],
        }
      : shift
  );

  return next;
}

export function addShiftNoteDB(
  db: DB,
  shiftId: number,
  text: string,
  kind: ShiftNoteKind
): DB {
  const trimmed = text.trim();
  if (!trimmed) return db;

  const next: DB = {
    ...db,
    nextId: db.nextId,
    shifts: db.shifts.map((shift) =>
      shift.id === shiftId ? { ...shift, notes: [...shift.notes] } : shift
    ),
  };

  const id = newId(next);
  const createdAt = Date.now();

  next.nextId = id + 1;

  next.shifts = next.shifts.map((shift) =>
    shift.id === shiftId
      ? {
          ...shift,
          notes: [...shift.notes, { id, text: trimmed, kind, createdAt }],
        }
      : shift
  );

  return next;
}

export function addChildActivityForShiftDB(options: {
  db: DB;
  shiftId: number;
  parentActivityId: number;
  label: string;
}): { db: DB; newShiftActivity: ShiftActivity | null } {
  const { db, shiftId, parentActivityId, label } = options;
  const trimmed = label.trim();

  if (!trimmed) {
    return { db, newShiftActivity: null };
  }

  const parentActivity = db.activities.find(
    (activity) => activity.id === parentActivityId
  );

  if (!parentActivity) {
    console.warn("addChildActivityForShiftDB: parent activity not found", {
      parentActivityId,
    });
    return { db, newShiftActivity: null };
  }

  const next: DB = {
    ...db,
    nextId: db.nextId,
    activities: [...db.activities],
    shifts: db.shifts.map((shift) => ({
      ...shift,
      shiftActivities: [...shift.shiftActivities],
      taskEvents: [...shift.taskEvents],
    })),
  };

  const siblings = next.activities.filter(
    (activity) => activity.parentId === parentActivityId
  );

  const nextSort =
    siblings.length > 0
      ? Math.max(...siblings.map((entry) => entry.sortOrder)) + 1
      : 0;

  const newActivityId = newId(next);
  next.nextId = newActivityId + 1;

  const newActivity: Activity = {
    id: newActivityId,
    name: trimmed,
    color: parentActivity.color,
    sortOrder: nextSort,
    parentId: parentActivityId,
    archived: false,
  };

  next.activities.push(newActivity);

  const shiftIndex = next.shifts.findIndex((shift) => shift.id === shiftId);

  if (shiftIndex === -1) {
    console.warn("addChildActivityForShiftDB: shift not found", { shiftId });
    return { db, newShiftActivity: null };
  }

  const parentShiftActivity = next.shifts[shiftIndex].shiftActivities.find(
    (entry) => entry.activityId === parentActivityId
  );

  const newShiftActivityId = newId(next);
  next.nextId = newShiftActivityId + 1;

  const newShiftActivity: ShiftActivity = {
    id: newShiftActivityId,
    activityId: newActivityId,
    nameSnapshot: newActivity.name,
    colorSnapshot: newActivity.color,
    parentIdSnapshot: parentShiftActivity ? parentShiftActivity.id : null,
    sortOrderSnapshot: newActivity.sortOrder,
  };

  next.shifts[shiftIndex].shiftActivities.push(newShiftActivity);

  return { db: next, newShiftActivity };
}
