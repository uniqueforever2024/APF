import { useEffect, useState } from "react";
import {
  normalizeBusinessUnit,
  normalizeEntry,
  sortBusinessUnitsAlphabetically,
  sortEntriesAlphabetically
} from "./utils";
import { getDirectoryApiBase } from "./apiBase";

const API_BASE = getDirectoryApiBase();
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
          return;
        }
      } catch (error) {
        void error;
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
      } catch (error) {
        if (!active) {
          return;
        }

        setEntries([]);
        setBusinessUnits([]);
      }
    }

    loadDirectoryData();

    return () => {
      active = false;
    };
  }, []);

  return {
    entries,
    businessUnits
  };
}
