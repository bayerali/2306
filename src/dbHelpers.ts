import type {
  Activity,
  CompletionStatus,
  DB,
  Shift,
  ShiftActivity,
  ShiftNoteKind,
  TaskEvent,
} from "./types";

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
  return getTaskEventsForActivity(shift, shiftActivityId)[0] ?? null;
}

export function addTaskEventDB(
  db: DB,
  shiftId: number,
  shiftActivityId: number,
  status: CompletionStatus,
  note = ""
): DB {
  const id = db.nextId;
  const event: TaskEvent = {
    id,
    shiftActivityId,
    status,
    timestamp: Date.now(),
    note: note.trim(),
    imageData: null,
  };

  return {
    ...db,
    nextId: id + 1,
    shifts: db.shifts.map((shift) =>
      shift.id === shiftId
        ? {
            ...shift,
            taskEvents: [...shift.taskEvents, event],
          }
        : shift
    ),
  };
}

export function removeAutoParentDoneEventDB(
  db: DB,
  shiftId: number,
  shiftActivityId: number
): DB {
  return {
    ...db,
    shifts: db.shifts.map((shift) =>
      shift.id === shiftId
        ? {
            ...shift,
            taskEvents: shift.taskEvents.filter(
              (event) =>
                !(
                  event.shiftActivityId === shiftActivityId &&
                  event.status === "done" &&
                  event.note === "__AUTO_PARENT_DONE__"
                )
            ),
          }
        : shift
    ),
  };
}

export function addShiftNoteDB(
  db: DB,
  shiftId: number,
  text: string,
  kind: ShiftNoteKind
): DB {
  const trimmed = text.trim();
  if (!trimmed) return db;

  const id = db.nextId;

  return {
    ...db,
    nextId: id + 1,
    shifts: db.shifts.map((shift) =>
      shift.id === shiftId
        ? {
            ...shift,
            notes: [
              ...shift.notes,
              {
                id,
                text: trimmed,
                createdAt: Date.now(),
                kind,
              },
            ],
          }
        : shift
    ),
  };
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

  const parentActivity = db.activities.find((activity) => activity.id === parentActivityId);

  if (!parentActivity) {
    return { db, newShiftActivity: null };
  }

  const siblings = db.activities.filter((activity) => activity.parentId === parentActivityId);
  const sortOrder =
    siblings.length > 0 ? Math.max(...siblings.map((entry) => entry.sortOrder)) + 1 : 0;

  const newActivityId = db.nextId;
  const newShiftActivityId = db.nextId + 1;

  const activity: Activity = {
    id: newActivityId,
    name: trimmed,
    color: parentActivity.color,
    sortOrder,
    parentId: parentActivityId,
    archived: false,
  };

  const shift = db.shifts.find((entry) => entry.id === shiftId);
  if (!shift) {
    return { db, newShiftActivity: null };
  }

  const parentShiftActivity = shift.shiftActivities.find(
    (entry) => entry.activityId === parentActivityId
  );

  const newShiftActivity: ShiftActivity = {
    id: newShiftActivityId,
    activityId: newActivityId,
    nameSnapshot: activity.name,
    colorSnapshot: activity.color,
    parentIdSnapshot: parentShiftActivity?.id ?? null,
    sortOrderSnapshot: activity.sortOrder,
  };

  return {
    db: {
      ...db,
      nextId: db.nextId + 2,
      activities: [...db.activities, activity],
      shifts: db.shifts.map((entry) =>
        entry.id === shiftId
          ? {
              ...entry,
              shiftActivities: [...entry.shiftActivities, newShiftActivity],
            }
          : entry
      ),
    },
    newShiftActivity,
  };
}
