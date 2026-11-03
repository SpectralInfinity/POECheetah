import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useRef, useState } from "react";
import { lastSession, parseLog, SESSION_GAP, summarize, type LogEvent, type Session } from "../core/gamelog";
import { isTauri } from "../data/db";
// Browser preview (`npm run dev`) can't read files: the made-up test log stands in.
import previewLog from "../core/__fixtures__/client-log.txt?raw";

const PATH_KEY = "poecheetah.logPath";
const CHARACTER_KEY = "poecheetah.character";
/** How often a live tracker reads the log's new lines. */
const POLL_MS = 2000;

const read = (key: string) => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembering it is fine.
  }
};

export const savedLogPath = () => read(PATH_KEY);
export const saveLogPath = (p: string) => write(PATH_KEY, p);
export const savedCharacter = () => read(CHARACTER_KEY);
export const saveCharacter = (c: string) => write(CHARACTER_KEY, c);

interface Chunk {
  text: string;
  from: number;
  to: number;
  size: number;
}

/** The usual places of the game's log that exist on this computer. */
export async function logCandidates(): Promise<string[]> {
  return isTauri() ? invoke<string[]>("log_candidates") : ["(browser preview: a made-up log)"];
}

/** New log text since `from`, or the log's last 8 MB when `from` is missing (enough for a day's play). */
async function readLog(path: string, from?: number): Promise<Chunk> {
  if (!isTauri()) return from === undefined ? { text: previewLog, from: 0, to: 1, size: 1 } : { text: "", from, to: from, size: 1 };
  return invoke<Chunk>("log_read", { path, from: from ?? null, tail: null });
}

/**
 * Follows the game log (design doc §3.4): reads the last session once, then,
 * while `live`, the new lines every two seconds. Shared by the Run tracker
 * panel and the overlay window, which each read the file themselves.
 */
export function useRunTracker(path: string, character: string, live: boolean) {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const offset = useRef<number | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const chunk = await readLog(path);
      offset.current = chunk.to;
      setEvents(lastSession(parseLog(chunk.text)));
    } catch (e) {
      offset.current = null;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [path]);

  useEffect(() => {
    if (!live || !path) return;
    let stopped = false;
    const tick = async () => {
      setNow(Date.now());
      if (offset.current === null) return;
      try {
        const chunk = await readLog(path, offset.current);
        if (stopped) return;
        offset.current = chunk.to;
        const added = parseLog(chunk.text);
        if (added.length) setEvents((old) => lastSession([...old, ...added]));
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : String(e));
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [live, path]);

  // Following live, the session runs until now, unless play stopped (a long break ends it).
  const last = events.length ? events[events.length - 1].at : 0;
  const stale = events.length > 0 && now - last > SESSION_GAP;
  const session: Session | null = events.length ? summarize(events, character, live && !stale ? now : undefined) : null;
  return { session, stale, error, load, loaded: offset.current !== null };
}

export const OVERLAY_WINDOW = "run-overlay";

/** Opens the run overlay (always on top, no frame, draggable), or closes it when open. */
export async function toggleOverlay(): Promise<boolean> {
  const open = await WebviewWindow.getByLabel(OVERLAY_WINDOW);
  if (open) {
    await open.close();
    return false;
  }
  const win = new WebviewWindow(OVERLAY_WINDOW, {
    url: "index.html#run-overlay",
    title: "POE Cheetah · Runs",
    width: 300,
    height: 120,
    alwaysOnTop: true,
    decorations: false,
    transparent: true,
    skipTaskbar: true,
    resizable: false,
    shadow: false,
  });
  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve()).catch(reject);
    win.once("tauri://error", (e) => reject(new Error(String(e.payload)))).catch(reject);
  });
  return true;
}

/** Lets clicks go through the overlay to the game (it can't be dragged then). */
export async function setOverlayClickThrough(on: boolean): Promise<void> {
  const open = await WebviewWindow.getByLabel(OVERLAY_WINDOW);
  await open?.setIgnoreCursorEvents(on);
}
