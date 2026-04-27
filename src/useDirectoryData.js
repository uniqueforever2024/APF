import { useEffect, useMemo, useState } from "react";
import {
  normalizeBusinessUnit,
  normalizeEntry,
  sortBusinessUnitsAlphabetically,
  sortEntriesAlphabetically
} from "./utils";

const API_BASE = process.env.REACT_APP_DIRECTORY_API || "http://localhost:3001";
const API_URL = `${API_BASE}/api/directory-data`;
const FALLBACK_DATA_PATH = `${process.env.PUBLIC_URL || ""}/APF_NEW.json`;

export default function useDirectoryData() {
  const [seedEntries, setSeedEntries] = useState([]);
  const [entries, setEntries] = useState([]);
  const [seedBusinessUnits, setSeedBusinessUnits] = useState([]);
  const [businessUnits, setBusinessUnits] = useState([]);
  const [dataMeta, setDataMeta] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    const parseEntries = (dataFile) =>
      Array.isArray(dataFile.entries)
        ? sortEntriesAlphabetically(dataFile.entries.map(normalizeEntry))
        : [];
    const parseBusinessUnits = (dataFile) =>
      Array.isArray(dataFile.businessUnits)
        ? sortBusinessUnitsAlphabetically(
            dataFile.businessUnits
              .map(normalizeBusinessUnit)
              .filter((businessUnit) => businessUnit.id && businessUnit.name)
          )
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
          const parsedBusinessUnits = parseBusinessUnits(dataFile);
          setSeedEntries(parsedSeed);
          setEntries(parsedSeed);
          setSeedBusinessUnits(parsedBusinessUnits);
          setBusinessUnits(parsedBusinessUnits);
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
        const parsedBusinessUnits = parseBusinessUnits(dataFile);
        setSeedEntries(parsedSeed);
        setEntries(parsedSeed);
        setSeedBusinessUnits(parsedBusinessUnits);
        setBusinessUnits(parsedBusinessUnits);
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
        setSeedBusinessUnits([]);
        setBusinessUnits([]);
        setDataMeta(null);
        setLoaded(true);
      }
    };

    loadEntries();

    return () => {
      active = false;
    };
  }, []);

  const persistData = async (nextEntries, nextBusinessUnits = businessUnits) => {
    const normalizedEntries = sortEntriesAlphabetically(nextEntries.map(normalizeEntry));
    const normalizedBusinessUnits = sortBusinessUnitsAlphabetically(
      nextBusinessUnits
        .map(normalizeBusinessUnit)
        .filter((businessUnit) => businessUnit.id && businessUnit.name)
    );
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        entries: normalizedEntries,
        businessUnits: normalizedBusinessUnits
      })
    });

    if (!response.ok) {
      throw new Error("Save failed");
    }

    const savedPayload = await response.json();
    const savedEntries = Array.isArray(savedPayload.entries)
      ? sortEntriesAlphabetically(savedPayload.entries.map(normalizeEntry))
      : [];
    const savedBusinessUnits = Array.isArray(savedPayload.businessUnits)
      ? sortBusinessUnitsAlphabetically(
          savedPayload.businessUnits
            .map(normalizeBusinessUnit)
            .filter((businessUnit) => businessUnit.id && businessUnit.name)
        )
      : [];

    setSeedEntries(savedEntries);
    setEntries(savedEntries);
    setSeedBusinessUnits(savedBusinessUnits);
    setBusinessUnits(savedBusinessUnits);
    setDataMeta(savedPayload.meta || null);
  };

  const actions = useMemo(
    () => ({
      async addEntry(entry) {
        await persistData([...entries, normalizeEntry(entry)]);
      },
      async updateEntry(id, updates) {
        const nextEntries = entries.map((entry) =>
          entry.id === id ? normalizeEntry({ ...entry, ...updates }) : entry
        );
        await persistData(nextEntries);
      },
      async removeEntry(id) {
        await persistData(entries.filter((entry) => entry.id !== id));
      },
      async importEntries(importedEntries) {
        await persistData(importedEntries.map(normalizeEntry));
      },
      async addBusinessUnit(businessUnit) {
        const normalizedBusinessUnit = normalizeBusinessUnit(businessUnit);
        const nextBusinessUnits = [
          ...businessUnits.filter(
            (existingBusinessUnit) =>
              normalizeBusinessUnit(existingBusinessUnit).id !== normalizedBusinessUnit.id
          ),
          normalizedBusinessUnit
        ];
        await persistData(entries, nextBusinessUnits);
      },
      async removeBusinessUnit(id, defaultBusinessUnits = []) {
        const normalizedId = String(id || "").trim().toLowerCase();

        if (!normalizedId) {
          return;
        }

        const nextEntries = entries.filter((entry) => entry.bu !== normalizedId);
        const nextBusinessUnits = businessUnits.filter(
          (businessUnit) => normalizeBusinessUnit(businessUnit).id !== normalizedId
        );
        const matchingDefaultUnit = defaultBusinessUnits
          .map(normalizeBusinessUnit)
          .find((businessUnit) => businessUnit.id === normalizedId);

        if (matchingDefaultUnit) {
          nextBusinessUnits.push({
            ...matchingDefaultUnit,
            removed: true
          });
        }

        await persistData(nextEntries, nextBusinessUnits);
      },
      async resetToSeed() {
        await persistData(seedEntries, seedBusinessUnits);
      }
    }),
    [businessUnits, entries, seedBusinessUnits, seedEntries]
  );

  return {
    seedEntries,
    entries,
    businessUnits,
    dataMeta,
    loaded,
    actions
  };
}
