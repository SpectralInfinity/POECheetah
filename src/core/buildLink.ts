// Build links (design doc §3.0): a pasted link that holds a PoB code. Only
// addresses that serve the code itself are read: pobb.in's and pastebin's raw
// pages, and poe.ninja's character data (its `pathOfBuildingExport`).

export type BuildLink =
  /** The page's text is the PoB code. */
  | { kind: "raw"; url: string }
  /** A poe.ninja character page: the code comes from its character data. */
  | { kind: "ninja"; league: string; account: string; name: string };

/** What a pasted link points to; null when it isn't a build link the app reads. */
export function readBuildLink(text: string): BuildLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (host === "pobb.in") {
    // pobb.in/<id>, pobb.in/<id>/raw, pobb.in/u/<user>/<id>
    const id = parts[0] === "u" ? parts[2] : parts[0];
    return id ? { kind: "raw", url: `https://pobb.in/${encodeURIComponent(id)}/raw` } : null;
  }
  if (host === "pastebin.com") {
    const id = parts[0] === "raw" ? parts[1] : parts[0];
    return id ? { kind: "raw", url: `https://pastebin.com/raw/${encodeURIComponent(id)}` } : null;
  }
  if (host === "poe.ninja") {
    // poe.ninja/poe1/builds/<league>/character/<account>/<name> (older links lack "poe1")
    const at = parts.indexOf("character");
    if (parts[at - 2] !== "builds" || at < 0 || !parts[at + 1] || !parts[at + 2]) return null;
    return { kind: "ninja", league: parts[at - 1], account: parts[at + 1], name: parts[at + 2] };
  }
  return null;
}

interface SnapshotVersion {
  url: string;
  type: string;
  version: string;
  snapshotName?: string;
}

/** poe.ninja's character data address for a character page, from its league list (`index-state`). */
export function ninjaCharacterUrl(indexState: unknown, link: Extract<BuildLink, { kind: "ninja" }>): string {
  const versions = ((indexState as { snapshotVersions?: SnapshotVersion[] })?.snapshotVersions ?? []).filter(
    (v) => v.type === "exp" && (v.url === link.league || v.snapshotName === link.league),
  );
  const v = versions[0];
  if (!v) throw new Error(`poe.ninja has no ladder called "${link.league}" now.`);
  const q = new URLSearchParams({ account: link.account, name: link.name, overview: v.url, type: "exp" });
  return `https://poe.ninja/poe1/api/builds/${encodeURIComponent(v.version)}/character?${q}`;
}

/** The PoB code in poe.ninja's character data. */
export function ninjaCode(data: unknown): string {
  const code = (data as { pathOfBuildingExport?: unknown })?.pathOfBuildingExport;
  if (typeof code !== "string" || !code.trim()) throw new Error("poe.ninja has no Path of Building code for that character.");
  return code.trim();
}
