/**
 * Path of Building export codes: the build's XML, zlib-compressed, then
 * base64 with the URL-safe alphabet (`-` and `_` instead of `+` and `/`).
 */

export interface BuildSummary {
  className: string;
  ascendancy: string;
  level: number;
}

/** Decodes a PoB code to its XML. Throws if the text isn't a PoB code. */
export async function decodeBuildCode(code: string): Promise<string> {
  const base64 = code.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) throw new Error("Not a Path of Building code");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  try {
    return await new Response(stream).text();
  } catch {
    throw new Error("Not a Path of Building code");
  }
}

/** Encodes build XML the way PoB does; used by tests and for sharing edited builds. */
export async function encodeBuildCode(xml: string): Promise<string> {
  const stream = new Blob([xml]).stream().pipeThrough(new CompressionStream("deflate"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}

/** Reads class, ascendancy and level from the `<Build>` element. */
export function readBuildSummary(xml: string): BuildSummary {
  const tag = xml.match(/<Build\s[^>]*>/)?.[0];
  if (!tag) throw new Error("Build XML has no <Build> element");
  const attr = (name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? "";
  return {
    className: attr("className"),
    ascendancy: attr("ascendClassName"),
    level: Number(attr("level")) || 1,
  };
}
