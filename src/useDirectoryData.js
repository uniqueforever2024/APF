import { useEffect, useState } from "react";
import {
  normalizeBusinessUnit,
  normalizeEntry,
  sortBusinessUnitsAlphabetically,
  sortEntriesAlphabetically
} from "./utils";

const API_BASE = process.env.REACT_APP_DIRECTORY_API || "http://localhost:3001";
const API_URL = `${API_BASE}/api/directory-data`;
const FALLBACK_ENTRIES_PATH = `${process.env.PUBLIC_URL || ""}/APF_NEW.json`;
const FALLBACK_BUSINESS_UNITS_PATH = `${process.env.PUBLIC_URL || ""}/APF_BUSINESS_UNITS.json`;

function parseEntries(dataFile) {
  return Array.isArray(dataFile?.entries)
    ? sortEntriesAlphabetically(dataFile.entries.map(normalizeEntry))
    : [];
}

function parseBusinessUnits(dataFile) {
  const rawBusinessUnits = Array.isArray(dataFile?.businessUnits)
    ? dataFile.businessUnits
    : Array.isArray(dataFile)
      ? dataFile
      : [];

  return sortBusinessUnitsAlphabetically(rawBusinessUnits.map(normalizeBusinessUnit));
}

export default function useDirectoryData() {
  const [entries, setEntries] = useState([]);
  const [businessUnits, setBusinessUnits] = useState([]);
  const [dataMeta, setDataMeta] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadDirectoryData() {
      try {
        const response = await fetch(API_URL);

        if (response.ok) {
          const payload = await response.json();

          if (!active) {
            return;
          }

          setEntries(parseEntries(payload));
          setBusinessUnits(parseBusinessUnits(payload));
          setDataMeta(payload.meta || null);
          setLoaded(true);
          return;
        }
      } catch (error) {
        // Fall back to bundled data when the API is unavailable.
      }

      try {
        const [entriesResponse, businessUnitsResponse] = await Promise.all([
          fetch(FALLBACK_ENTRIES_PATH),
          fetch(FALLBACK_BUSINESS_UNITS_PATH)
        ]);
        const [entriesPayload, businessUnitsPayload] = await Promise.all([
          entriesResponse.json(),
          businessUnitsResponse.json()
        ]);

        if (!active) {
          return;
        }

        setEntries(parseEntries(entriesPayload));
        setBusinessUnits(parseBusinessUnits(businessUnitsPayload));
        setDataMeta({
          source: "json-fallback",
          activeClient: "json",
          note: "Bundled directory data is active because the local API is unavailable."
        });
      } catch (error) {
        if (!active) {
          return;
        }

        setEntries([]);
        setBusinessUnits([]);
        setDataMeta(null);
      } finally {
        if (active) {
          setLoaded(true);
        }
      }
    }

    loadDirectoryData();

    return () => {
      active = false;
    };
  }, []);

  return {
    entries,
    businessUnits,
    dataMeta,
    loaded
  };
}
