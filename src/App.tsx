import React, { useEffect, useState } from "react";
import { loadDB, saveDB } from "./storage";
import type { DB } from "./types";
import { ShiftsPage } from "./components/ShiftsPage";
import { ExecutionBoardPage } from "./components/ExecutionBoardPage";

type Route =
  | { kind: "dashboard" }
  | { kind: "shift"; shiftId: number };

function parseHash(hash: string): Route {
  const raw = hash || "#/";

  if (raw.startsWith("#/shift/")) {
    const idPart = raw.replace("#/shift/", "");
    const id = Number(idPart);

    if (!Number.isNaN(id) && id > 0) {
      return { kind: "shift", shiftId: id };
    }
  }

  return { kind: "dashboard" };
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}

function navigate(path: string) {
  window.location.hash = path;
}

export default function App() {
  const [db, setDBState] = useState<DB>(() => loadDB());
  const route = useHashRoute();

  const setDB = (next: DB) => {
    setDBState(next);
    saveDB(next);
  };

  if (route.kind === "shift") {
    const shift = db.shifts.find((entry) => entry.id === route.shiftId);

    if (!shift) {
      navigate("/");
      return null;
    }

    return (
      <ExecutionBoardPage
        db={db}
        setDB={setDB}
        shiftId={route.shiftId}
        onBackToShifts={() => navigate("/")}
        onDashboardClick={() => navigate("/")}
      />
    );
  }

  return (
    <ShiftsPage
      db={db}
      setDB={setDB}
      onOpenShiftBoard={(id) => {
        if (id > 0) {
          navigate(`/shift/${id}`);
          return;
        }

        navigate("/");
      }}
    />
  );
}
