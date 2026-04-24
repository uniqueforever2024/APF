import { useEffect, useMemo, useState } from "react";
import { normalizeEntry, sortEntriesAlphabetically } from "./utils";

const API_BASE = process.env.REACT_APP_DIRECTORY_API || "http://localhost:3001";
const API_URL = `${API_BASE}/api/directory-data`;
const FALLBACK_DATA_PATH = `${process.env.PUBLIC_URL || ""}/APF_NEW.json`;

export default function useDirectoryData() {
  const [seedEntries, setSeedEntries] = useState([]);
  const [entries, setEntries] = useState([]);
  const [dataMeta, setDataMeta] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    const parseEntries = (dataFile) =>
      Array.isArray(dataFile.entries)
        ? sortEntriesAlphabetically(dataFile.entries.map(normalizeEntry))
        : [];

    const loadEntries = async () => {
      try {
        const response = await fetch(API_URL);

        if (response.ok) {
          const dataFile = await response.json();

          if (!active) {
            return;
          }

          const parsedSeed = parseEntries(dataFile);
          setSeedEntries(parsedSeed);
          setEntries(parsedSeed);
          setDataMeta(dataFile.meta || null);
          setLoaded(true);
          return;
        }
      } catch (error) {
        // Fall back to the bundled JSON if the local API is unavailable.
      }

      try {
        const response = await fetch(FALLBACK_DATA_PATH);
        const dataFile = await response.json();

        if (!active) {
          return;
        }

        const parsedSeed = parseEntries(dataFile);
        setSeedEntries(parsedSeed);
        setEntries(parsedSeed);
        setDataMeta({
          source: "json-fallback",
          activeClient: "json",
          note: "Client-side fallback is active because the directory API is unavailable."
        });
        setLoaded(true);
      } catch (error) {
        if (!active) {
          return;
        }

        setSeedEntries([]);
        setEntries([]);
        setDataMeta(null);
        setLoaded(true);
      }
    };

    loadEntries();

    return () => {
      active = false;
    };
  }, []);

  const persistEntries = async (nextEntries) => {
    const normalizedEntries = sortEntriesAlphabetically(nextEntries.map(normalizeEntry));
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        entries: normalizedEntries
      })
    });

    if (!response.ok) {
      throw new Error("Save failed");
    }

    const savedPayload = await response.json();
    const savedEntries = Array.isArray(savedPayload.entries)
      ? sortEntriesAlphabetically(savedPayload.entries.map(normalizeEntry))
      : [];

    setSeedEntries(savedEntries);
    setEntries(savedEntries);
    setDataMeta(savedPayload.meta || null);
  };

  const actions = useMemo(
    () => ({
      async addEntry(entry) {
        await persistEntries([...entries, normalizeEntry(entry)]);
      },
      async updateEntry(id, updates) {
        const nextEntries = entries.map((entry) =>
          entry.id === id ? normalizeEntry({ ...entry, ...updates }) : entry
        );
        await persistEntries(nextEntries);
      },
      async removeEntry(id) {
        await persistEntries(entries.filter((entry) => entry.id !== id));
      },
      async importEntries(importedEntries) {
        await persistEntries(importedEntries.map(normalizeEntry));
      },
      async resetToSeed() {
        await persistEntries(seedEntries);
      }
    }),
    [entries, seedEntries]
  );

  return {
    seedEntries,
    entries,
    dataMeta,
    loaded,
    actions
  };
}
