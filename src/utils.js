import { LEGACY_TYPE_MAP, SECTION_ORDER } from "./config";

const DIRECTORY_TARGET_PROTOCOL =
  process.env.REACT_APP_DIRECTORY_TARGET_PROTOCOL || "http";
const DIRECTORY_TARGET_HOST =
  process.env.REACT_APP_DIRECTORY_TARGET_HOST || "frb2bcdu01.groupecat.com";
const DIRECTORY_TARGET_PORT =
  process.env.REACT_APP_DIRECTORY_TARGET_PORT || "8000";
const LEGACY_DIRECTORY_TARGET_HOSTS = ["frbs.groupecat.com"];
const DIRECTORY_API_BASE =
  process.env.REACT_APP_DIRECTORY_API || "http://localhost:3001";
const ENTRY_SORTER = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});

function buildTargetOrigin() {
  const portPart = DIRECTORY_TARGET_PORT ? `:${DIRECTORY_TARGET_PORT}` : "";
  return `${DIRECTORY_TARGET_PROTOCOL}://${DIRECTORY_TARGET_HOST}${portPart}`;
}

function isKnownDirectoryTargetHost(hostname) {
  const normalizedHostname = String(hostname || "").trim().toLowerCase();

  return (
    normalizedHostname === DIRECTORY_TARGET_HOST.toLowerCase() ||
    LEGACY_DIRECTORY_TARGET_HOSTS.includes(normalizedHostname)
  );
}

function rewriteKnownDirectoryTargetUrl(value) {
  const trimmedValue = String(value || "").trim();

  if (!trimmedValue) {
    return trimmedValue;
  }

  if (isAbsoluteUrl(trimmedValue)) {
    try {
      const parsedUrl = new URL(trimmedValue);

      if (
        isKnownDirectoryTargetHost(parsedUrl.hostname) &&
        (!parsedUrl.port || parsedUrl.port === DIRECTORY_TARGET_PORT)
      ) {
        return `${buildTargetOrigin()}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
      }
    } catch (error) {
      return trimmedValue;
    }

    return trimmedValue;
  }

  if (isHostPath(trimmedValue)) {
    const [hostPart, ...pathParts] = trimmedValue.split("/");

    try {
      const parsedHost = new URL(`http://${hostPart}`);

      if (
        isKnownDirectoryTargetHost(parsedHost.hostname) &&
        (!parsedHost.port || parsedHost.port === DIRECTORY_TARGET_PORT)
      ) {
        return `${buildTargetOrigin()}/${pathParts.join("/")}`;
      }
    } catch (error) {
      return trimmedValue;
    }
  }

  return trimmedValue;
}

function isAbsoluteUrl(value) {
  return /^(https?:)?\/\//i.test(value);
}

function isHostPath(value) {
  return /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\//i.test(value);
}

export function normalizeLegacyType(type) {
  if (!type) {
    return "";
  }

  const normalized = type.toLowerCase();
  return LEGACY_TYPE_MAP[normalized] || "";
}

export function normalizeEntry(entry) {
  return {
    id: entry.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bu: (entry.bu || "").toLowerCase(),
    type: normalizeLegacyType(entry.type) || entry.type || "",
    label: (entry.label || "").trim(),
    url: (entry.url || "").trim(),
    backup: (entry.backup || "").trim()
  };
}

export function sortEntriesAlphabetically(entries) {
  return [...entries].sort((leftEntry, rightEntry) => {
    const left = normalizeEntry(leftEntry);
    const right = normalizeEntry(rightEntry);
    const comparisons = [
      ENTRY_SORTER.compare(left.bu, right.bu),
      ENTRY_SORTER.compare(left.type, right.type),
      ENTRY_SORTER.compare(left.label, right.label),
      ENTRY_SORTER.compare(left.backup, right.backup),
      ENTRY_SORTER.compare(left.url, right.url)
    ];

    const match = comparisons.find((value) => value !== 0);
    return match || ENTRY_SORTER.compare(left.id, right.id);
  });
}

export function buildDirectoryUrl(url) {
  const trimmedUrl = rewriteKnownDirectoryTargetUrl(url);

  if (!trimmedUrl) {
    return "#";
  }

  if (isAbsoluteUrl(trimmedUrl)) {
    return trimmedUrl;
  }

  if (isHostPath(trimmedUrl)) {
    return `http://${trimmedUrl}`;
  }

  return `${buildTargetOrigin()}/${trimmedUrl.replace(/^\/+/, "")}`;
}

export function buildDirectoryPreviewUrl(url, highlight = "") {
  const trimmedUrl = rewriteKnownDirectoryTargetUrl(url);
  const options =
    typeof highlight === "string"
      ? { highlight }
      : highlight && typeof highlight === "object"
        ? highlight
        : {};
  const params = new URLSearchParams({
    url: trimmedUrl
  });

  if (String(options.highlight || "").trim()) {
    params.set("highlight", String(options.highlight).trim());
  }

  if (String(options.reloadKey || "").trim()) {
    params.set("reload", String(options.reloadKey).trim());
  }

  if (String(options.context || "").trim()) {
    params.set("context", String(options.context).trim());
  }

  return `${DIRECTORY_API_BASE}/api/directory-preview?${params.toString()}`;
}

export function isEmailContact(value) {
  return /@/.test(value || "");
}

export function createHashRoute(route) {
  if (route.page === "logout") {
    return `#/logout/${route.lang || "en"}`;
  }

  if (route.page === "home") {
    return `#/home/${route.lang || "en"}`;
  }

  const sectionPart = route.section ? `/${route.section}` : "";
  return `#/${route.bu}/${route.lang || "en"}${sectionPart}`;
}

export function parseHashRoute(hash) {
  const cleanHash = (hash || "").replace(/^#\/?/, "");
  const parts = cleanHash.split("/").filter(Boolean);

  if (parts.length === 0 || parts[0] === "home" || parts[0] === "logout") {
    return {
      page: parts[0] === "logout" ? "logout" : "home",
      lang: parts[1] || "en",
      bu: "",
      section: ""
    };
  }

  return {
    page: "directory",
    bu: parts[0] || "fr",
    lang: parts[1] || "en",
    section: parts[2] || ""
  };
}

export function getEntriesForSection(entries, bu, type) {
  return sortEntriesAlphabetically(
    entries.filter((entry) => entry.bu === bu && entry.type === type)
  );
}

export function countEntriesBySection(entries, bu) {
  return SECTION_ORDER.reduce((accumulator, type) => {
    accumulator[type] = entries.filter(
      (entry) => entry.bu === bu && entry.type === type
    ).length;
    return accumulator;
  }, {});
}

export function downloadJson(filename, data) {
  downloadFile(
    filename,
    JSON.stringify(data, null, 2),
    "application/json"
  );
}

export function downloadFile(filename, content, type) {
  const blob = new Blob([content], {
    type
  });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  window.URL.revokeObjectURL(url);
}

function escapeCsvCell(value, delimiter) {
  const normalizedValue = String(value ?? "");

  if (
    normalizedValue.includes(delimiter) ||
    normalizedValue.includes('"') ||
    normalizedValue.includes("\n") ||
    normalizedValue.includes("\r")
  ) {
    return `"${normalizedValue.replace(/"/g, '""')}"`;
  }

  return normalizedValue;
}

export function buildBulkTemplateCsv(defaults = {}) {
  const delimiter = ";";
  const headers = ["id", "bu", "type", "label", "url", "backup"];
  const sampleRow = [
    "",
    defaults.bu || "fr",
    defaults.type || "annonces",
    "",
    "",
    ""
  ];

  return [
    headers.join(delimiter),
    sampleRow.map((value) => escapeCsvCell(value, delimiter)).join(delimiter)
  ].join("\r\n");
}

function detectDelimiter(text) {
  const firstContentLine = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .find((line) => line.trim());

  if (!firstContentLine) {
    return ";";
  }

  const semicolonCount = (firstContentLine.match(/;/g) || []).length;
  const commaCount = (firstContentLine.match(/,/g) || []).length;

  return semicolonCount >= commaCount ? ";" : ",";
}

function parseDelimitedText(text, delimiter) {
  const rows = [];
  let currentRow = [];
  let currentCell = "";
  let index = 0;
  let inQuotes = false;

  while (index < text.length) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 2;
        continue;
      }

      inQuotes = !inQuotes;
      index += 1;
      continue;
    }

    if (!inQuotes && character === delimiter) {
      currentRow.push(currentCell);
      currentCell = "";
      index += 1;
      continue;
    }

    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      index += 1;
      continue;
    }

    currentCell += character;
    index += 1;
  }

  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

export function parseBulkImportCsv(text) {
  const normalizedText = String(text || "").replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(normalizedText);
  const rows = parseDelimitedText(normalizedText, delimiter).filter((row) =>
    row.some((cell) => String(cell || "").trim())
  );

  if (rows.length === 0) {
    return [];
  }

  const headerMap = rows[0].reduce((accumulator, header, index) => {
    accumulator[String(header || "").trim().toLowerCase()] = index;
    return accumulator;
  }, {});

  const pickValue = (cells, key) => {
    const columnIndex = headerMap[key];
    return columnIndex === undefined ? "" : String(cells[columnIndex] || "").trim();
  };

  return rows.slice(1).map((cells) => ({
    id: pickValue(cells, "id"),
    bu: pickValue(cells, "bu"),
    type: pickValue(cells, "type"),
    label: pickValue(cells, "label"),
    url: pickValue(cells, "url"),
    backup: pickValue(cells, "backup")
  }));
}

export function mergeBulkEntries(existingEntries, importedEntries) {
  const nextEntries = existingEntries.map((entry) => normalizeEntry(entry));
  let added = 0;
  let updated = 0;
  let skipped = 0;

  importedEntries.forEach((entry) => {
    const normalized = normalizeEntry(entry);

    if (!normalized.bu || !normalized.type || !normalized.label || !normalized.url) {
      skipped += 1;
      return;
    }

    const idMatchIndex = normalized.id
      ? nextEntries.findIndex((item) => item.id === normalized.id)
      : -1;

    if (idMatchIndex >= 0) {
      nextEntries[idMatchIndex] = normalizeEntry({
        ...nextEntries[idMatchIndex],
        ...normalized,
        id: nextEntries[idMatchIndex].id
      });
      updated += 1;
      return;
    }

    const fallbackMatchIndex = nextEntries.findIndex(
      (item) =>
        item.bu === normalized.bu &&
        item.type === normalized.type &&
        item.label.trim().toLowerCase() === normalized.label.trim().toLowerCase()
    );

    if (fallbackMatchIndex >= 0) {
      nextEntries[fallbackMatchIndex] = normalizeEntry({
        ...nextEntries[fallbackMatchIndex],
        ...normalized,
        id: nextEntries[fallbackMatchIndex].id
      });
      updated += 1;
      return;
    }

    nextEntries.push(normalized);
    added += 1;
  });

  return {
    entries: sortEntriesAlphabetically(nextEntries),
    added,
    updated,
    skipped
  };
}
