import { LEGACY_TYPE_MAP } from "./config";

const DEFAULT_ARCHIVE_ROOT_PATH = "/B2BP/UserData/archives";
const ENTRY_SORTER = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});
const BUSINESS_UNIT_SORTER = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});

function normalizePosixPath(value) {
  const normalizedValue = String(value || "")
    .trim()
    .replace(/\\/g, "/");

  if (!normalizedValue) {
    return "";
  }

  const absoluteValue = normalizedValue.startsWith("/")
    ? normalizedValue
    : `/${normalizedValue.replace(/^\/+/, "")}`;

  return absoluteValue.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function getSectionRoot(type) {
  return normalizePosixPath(
    `${DEFAULT_ARCHIVE_ROOT_PATH}/${normalizeLegacyType(type) === "outbound" ? "EMIS" : "RECU"}`
  );
}

export function normalizeLegacyType(type) {
  const normalizedType = String(type || "").trim().toLowerCase();
  return LEGACY_TYPE_MAP[normalizedType] || normalizedType;
}

export function normalizeArchivePath(value, type) {
  let nextValue = String(value || "")
    .trim()
    .replace(/\\/g, "/");
  const sectionRoot = getSectionRoot(type);

  if (!nextValue) {
    return sectionRoot;
  }

  if (/^(https?:)?\/\//i.test(nextValue)) {
    try {
      nextValue = decodeURIComponent(new URL(nextValue).pathname || "");
    } catch (error) {
      nextValue = nextValue.replace(/^https?:\/\/[^/]+/i, "");
    }
  } else if (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\//i.test(nextValue)) {
    nextValue = nextValue.slice(nextValue.indexOf("/"));
  }

  nextValue = nextValue.replace(/[?#].*$/, "").trim();

  if (!nextValue) {
    return sectionRoot;
  }

  if (/^\/?B2BI_archives\/?/i.test(nextValue)) {
    return normalizePosixPath(
      `${DEFAULT_ARCHIVE_ROOT_PATH}/${nextValue.replace(/^\/?B2BI_archives\/?/i, "")}`
    );
  }

  if (/^\/?archives\/?/i.test(nextValue)) {
    return normalizePosixPath(
      `${DEFAULT_ARCHIVE_ROOT_PATH}/${nextValue.replace(/^\/?archives\/?/i, "")}`
    );
  }

  if (/^\/?arch\/(RECU|EMIS)\/?/i.test(nextValue)) {
    return normalizePosixPath(
      `${DEFAULT_ARCHIVE_ROOT_PATH}/${nextValue.replace(/^\/?arch\/?/i, "")}`
    );
  }

  if (/^\/?(RECU|EMIS)(?:\/|$)/i.test(nextValue)) {
    return normalizePosixPath(`${DEFAULT_ARCHIVE_ROOT_PATH}/${nextValue.replace(/^\/+/, "")}`);
  }

  if (nextValue.startsWith("/")) {
    return normalizePosixPath(nextValue);
  }

  return normalizePosixPath(`${sectionRoot}/${nextValue.replace(/^\.?\/*/, "")}`);
}

export function normalizeEntry(entry) {
  return {
    id: String(entry?.id || "").trim() || `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bu: String(entry?.bu || "").trim().toLowerCase(),
    type: normalizeLegacyType(entry?.type || ""),
    label: String(entry?.label || "").trim(),
    url: normalizeArchivePath(entry?.url, entry?.type),
    backup: String(entry?.backup || "").trim()
  };
}

export function sortEntriesAlphabetically(entries) {
  return [...entries]
    .map(normalizeEntry)
    .sort((leftEntry, rightEntry) => {
      const comparisons = [
        ENTRY_SORTER.compare(leftEntry.bu, rightEntry.bu),
        ENTRY_SORTER.compare(leftEntry.type, rightEntry.type),
        ENTRY_SORTER.compare(leftEntry.label, rightEntry.label),
        ENTRY_SORTER.compare(leftEntry.backup, rightEntry.backup),
        ENTRY_SORTER.compare(leftEntry.url, rightEntry.url)
      ];
      return (
        comparisons.find((comparisonValue) => comparisonValue !== 0) ||
        ENTRY_SORTER.compare(leftEntry.id, rightEntry.id)
      );
    });
}

export function normalizeBusinessUnit(businessUnit) {
  const id = String(businessUnit?.id || "").trim().toLowerCase();
  const label = String(
    businessUnit?.label || (id ? `BU ${id.toUpperCase()}` : "")
  ).trim();
  const name = String(businessUnit?.name || label || id.toUpperCase()).trim();

  return {
    id,
    label,
    name,
    flag: String(businessUnit?.flag || "").trim(),
    flagId: String(businessUnit?.flagId || "").trim().toLowerCase(),
    removed: businessUnit?.removed === true
  };
}

export function sortBusinessUnitsAlphabetically(businessUnits) {
  return [...businessUnits]
    .map(normalizeBusinessUnit)
    .filter((businessUnit) => businessUnit.id && businessUnit.name)
    .sort((leftUnit, rightUnit) => {
      const comparisons = [
        BUSINESS_UNIT_SORTER.compare(leftUnit.label, rightUnit.label),
        BUSINESS_UNIT_SORTER.compare(leftUnit.name, rightUnit.name),
        BUSINESS_UNIT_SORTER.compare(leftUnit.id, rightUnit.id)
      ];
      return comparisons.find((comparisonValue) => comparisonValue !== 0) || 0;
    });
}

export function mergeBusinessUnits(defaultUnits, customUnits) {
  const mergedUnits = new Map();

  [...defaultUnits, ...customUnits].forEach((businessUnit) => {
    const normalizedUnit = normalizeBusinessUnit(businessUnit);

    if (!normalizedUnit.id) {
      return;
    }

    if (normalizedUnit.removed) {
      mergedUnits.set(normalizedUnit.id, normalizedUnit);
      return;
    }

    mergedUnits.set(normalizedUnit.id, {
      ...(mergedUnits.get(normalizedUnit.id) || {}),
      ...normalizedUnit,
      removed: false
    });
  });

  return sortBusinessUnitsAlphabetically(
    [...mergedUnits.values()].filter((businessUnit) => !businessUnit.removed)
  );
}

export function getEntriesForSection(entries, bu, type) {
  return sortEntriesAlphabetically(
    entries.filter((entry) => entry.bu === bu && normalizeLegacyType(entry.type) === type)
  );
}
