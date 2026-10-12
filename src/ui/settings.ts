import { GOALS, type Goal } from "../core/goals";

// Advice settings, remembered between runs and shared with the item check window.
const GOAL_KEY = "poecheetah.goal";
const ASSUMPTIONS_KEY = "poecheetah.countAssumptions";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembering a setting is fine.
  }
}

export function savedGoal(): Goal {
  const g = read(GOAL_KEY);
  return GOALS.find((x) => x.id === g)?.id ?? "balanced";
}

export const saveGoal = (goal: Goal) => write(GOAL_KEY, goal);

export const savedCountAssumptions = () => read(ASSUMPTIONS_KEY) === "true";

export const saveCountAssumptions = (on: boolean) => write(ASSUMPTIONS_KEY, String(on));

/** Calls `fn` when another window (the item check pop-out or the main window) changes a saved setting. */
export function onSettingsChanged(fn: () => void): () => void {
  const listener = (e: StorageEvent) => {
    if (e.key === GOAL_KEY || e.key === ASSUMPTIONS_KEY || e.key === "poecheetah.league") fn();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
