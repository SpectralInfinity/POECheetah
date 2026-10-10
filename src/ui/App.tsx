import { useState } from "react";
import { APP_BUILD, APP_VERSION } from "../buildInfo";
import { decodeBuildCode, readBuildSummary, type BuildSummary } from "../core/buildCode";

export function App() {
  const [code, setCode] = useState("");
  const [build, setBuild] = useState<BuildSummary | null>(null);
  const [error, setError] = useState("");

  async function readBuild() {
    setError("");
    setBuild(null);
    try {
      setBuild(readBuildSummary(await decodeBuildCode(code)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="app">
      <h1>POECheetah</h1>
      <p className="muted">What to do next for your Path of Exile build.</p>

      <label htmlFor="code">Path of Building code</label>
      <textarea
        id="code"
        rows={5}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="In Path of Building: Import/Export Build → Generate → Copy, then paste here"
        spellCheck={false}
      />
      <button type="button" onClick={readBuild} disabled={code.trim() === ""}>
        Read build
      </button>

      {error && <p className="error">{error}</p>}
      {build && (
        <p className="build">
          Level {build.level} {build.ascendancy || build.className}
          {build.ascendancy && <span className="muted"> ({build.className})</span>}
        </p>
      )}

      <footer className="muted">
        v{APP_VERSION} · {APP_BUILD} · Not affiliated with Grinding Gear Games.
      </footer>
    </main>
  );
}
