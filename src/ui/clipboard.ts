import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "../data/db";

/**
 * The clipboard's text, or null when it holds none (an image, nothing).
 * Only read, never written: the player copies an item in game with Ctrl+C
 * and the app checks it (design doc §3.3, §4).
 */
export async function readClipboard(): Promise<string | null> {
  try {
    if (isTauri()) return await readText();
    // Browser preview: works only with the page focused and clipboard access allowed.
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

export const ITEM_CHECK_WINDOW = "item-check";

/** Opens the small always-on-top item check window, or brings it forward if it's open. */
export async function openItemCheckWindow(): Promise<void> {
  const open = await WebviewWindow.getByLabel(ITEM_CHECK_WINDOW);
  if (open) {
    await open.setFocus();
    return;
  }
  const win = new WebviewWindow(ITEM_CHECK_WINDOW, {
    url: "index.html#item-check",
    title: "POE Cheetah · Item check",
    width: 400,
    height: 480,
    minWidth: 300,
    minHeight: 200,
    alwaysOnTop: true,
  });
  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve()).catch(reject);
    win.once("tauri://error", (e) => reject(new Error(String(e.payload)))).catch(reject);
  });
}
