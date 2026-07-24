"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type GameVersion = {
  id: string;
  label: string;
  capturedAt: string;
  archiveNumber: number;
  runtimeVersion: string | null;
  sameWasmAs: number[];
  sameDataAs: number[];
  sameRuntimeAs: number[];
  archiveSource?: string;
  latest?: boolean;
};

type VersionManifest = {
  versions: GameVersion[];
};

const FAVORITES_KEY = "drive-mad-favorites";
const SELECTED_KEY = "drive-mad-version";

const dateLabel = (value: string) => value.slice(0, 10);

export default function Home() {
  const [manifest, setManifest] = useState<VersionManifest | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    fetch("./versions/manifest.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<VersionManifest>;
      })
      .then((data) => {
        setManifest(data);
        const saved = window.localStorage.getItem(SELECTED_KEY);
        setSelectedId(data.versions.some((version) => version.id === saved) && saved ? saved : data.versions[0]?.id ?? "");
        const raw = window.localStorage.getItem(FAVORITES_KEY);
        if (raw) {
          setFavorites(new Set(JSON.parse(raw)));
        }
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (selectedId) window.localStorage.setItem(SELECTED_KEY, selectedId);
  }, [selectedId]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const selected = useMemo(
    () => manifest?.versions.find((version) => version.id === selectedId),
    [manifest, selectedId],
  );

  const favoriteCount = useMemo(
    () => manifest?.versions.filter((v) => favorites.has(v.id)).length ?? 0,
    [manifest, favorites],
  );

  return (
    <main>
      <header>
        <h1>Drive Mad archive</h1>
        <span>{manifest ? `${manifest.versions.length} builds` : "loading"}{favoriteCount > 0 ? ` · ${favoriteCount} starred` : ""}</span>
      </header>

      <div className="controls">
        <label htmlFor="version">Build</label>
        <select id="version" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={!manifest}>
          {!manifest && <option>Loading…</option>}
          {manifest?.versions.map((version) => (
            <option key={version.id} value={version.id}>
              {favorites.has(version.id) ? "★ " : "  "}#{String(version.archiveNumber).padStart(2, "0")} · {dateLabel(version.capturedAt)}{version.latest ? " · current" : ""}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => frameRef.current?.requestFullscreen()} disabled={!selectedId}>Fullscreen</button>
      </div>

      {error ? <p className="error">Could not load versions: {error}</p> : selected && (
        <div className="details">
          <span>First seen {dateLabel(selected.capturedAt)}</span>
          <span>{selected.runtimeVersion ? `Fancade ${selected.runtimeVersion}` : "Runtime version not embedded"}</span>
          <span>{selected.sameWasmAs.length ? `Same WASM as #${selected.sameWasmAs.join(", #")}` : "Unique WASM"}</span>
          {selected.sameDataAs.length > 0 && <span>Same game data as #{selected.sameDataAs.join(", #")}</span>}
          <button className="star" type="button" onClick={() => toggleFavorite(selected.id)} title={favorites.has(selected.id) ? "Remove from favorites" : "Add to favorites"}>
            {favorites.has(selected.id) ? "★" : "☆"}
          </button>
          <code title="Poki build UUID">{selected.id}</code>
        </div>
      )}

      <div className="game">
        {selectedId ? (
          <iframe
            key={selectedId}
            ref={frameRef}
            src={`./versions/${selectedId}/index.html`}
            title={`Drive Mad build ${selected?.archiveNumber ?? ""}`}
            allow="autoplay; fullscreen; gamepad"
          />
        ) : <span>Loading…</span>}
      </div>

      <p className="note">Dates are the earliest archive capture found, not official release dates.</p>
    </main>
  );
}
