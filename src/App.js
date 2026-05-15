import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  buildArchiveOpenUrl,
  buildArchiveDownloadUrl,
  getArchiveFilePreview,
  listArchive,
  searchArchive
} from "./archiveApi";
import { BU_OPTIONS, LANGUAGES } from "./config";
import { getText } from "./text";
import useDirectoryData from "./useDirectoryData";
import { mergeBusinessUnits, normalizeEntry } from "./utils";
import LanguageDropdown from "./components/LanguageDropdown";
import ThemeToggle from "./components/ThemeToggle";

const AUTH_STORAGE_KEY = "apf_v2_auth_session";
const THEME_STORAGE_KEY = "apf_v2_theme_mode";
const LANGUAGE_STORAGE_KEY = "apf_v2_language";
const DIRECTORY_API_BASE = process.env.REACT_APP_DIRECTORY_API || "http://localhost:3001";
const DIRECTORY_DATA_API_URL = `${DIRECTORY_API_BASE}/api/directory-data`;
const ADMIN_LOGIN_API_URL = `${DIRECTORY_API_BASE}/api/auth/login`;
const BULK_TEMPLATE_FILE_NAME = "apf-partner-bulk-template.csv";
const BULK_TEMPLATE_HEADERS = ["id", "bu", "type", "label", "url", "backup"];
const SUPPORT_EMAIL = "HCL-EDI-TEAM@hcltech.com";
const EMPTY_BROWSER_STATE = {
  loading: false,
  error: "",
  entry: null,
  currentPath: "",
  relativePath: "",
  parentRelativePath: "",
  rootPath: "",
  canGoUp: false,
  items: []
};
const EMPTY_FILE_PREVIEW_STATE = {
  loading: false,
  error: "",
  source: "",
  entryId: "",
  relativePath: "",
  fileName: "",
  size: 0,
  modifiedAt: "",
  contentType: "",
  content: "",
  notice: "",
  previewable: false,
  open: false
};
const DEFAULT_CLIENT_SESSION = {
  role: "client",
  username: "portal-user"
};
const DEFAULT_BU_VISUAL = {
  accent: "#89a8ff",
  soft: "rgba(137, 168, 255, 0.12)",
  glow: "rgba(137, 168, 255, 0.18)"
};
const BU_VISUALS = {
  fr: {
    accent: "#7eaef8",
    soft: "rgba(126, 174, 248, 0.12)",
    glow: "rgba(126, 174, 248, 0.18)"
  },
  hr: {
    accent: "#7fbfb5",
    soft: "rgba(127, 191, 181, 0.12)",
    glow: "rgba(127, 191, 181, 0.18)"
  },
  ib: {
    accent: "#8ea6f0",
    soft: "rgba(142, 166, 240, 0.12)",
    glow: "rgba(142, 166, 240, 0.18)"
  },
  it: {
    accent: "#7fc9a8",
    soft: "rgba(127, 201, 168, 0.12)",
    glow: "rgba(127, 201, 168, 0.18)"
  },
  lt: {
    accent: "#b6b98c",
    soft: "rgba(182, 185, 140, 0.12)",
    glow: "rgba(182, 185, 140, 0.18)"
  },
  pl: {
    accent: "#a491df",
    soft: "rgba(164, 145, 223, 0.12)",
    glow: "rgba(164, 145, 223, 0.18)"
  },
  si: {
    accent: "#88bad0",
    soft: "rgba(136, 186, 208, 0.12)",
    glow: "rgba(136, 186, 208, 0.18)"
  },
  ua: {
    accent: "#8dbfff",
    soft: "rgba(141, 191, 255, 0.12)",
    glow: "rgba(141, 191, 255, 0.18)"
  }
};

function createEntryId() {
  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createManagerDraft(defaults = {}) {
  return {
    id: "",
    bu: "",
    type: "inbound",
    label: "",
    url: "",
    backup: "",
    ...defaults
  };
}

function createBusinessUnitDraft(defaults = {}) {
  return {
    id: "",
    label: "",
    name: "",
    flag: "",
    flagId: "",
    ...defaults
  };
}

function normalizeBusinessUnitCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function buildFlagEmoji(countryCode) {
  const normalizedCode = String(countryCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");

  if (normalizedCode.length !== 2) {
    return "";
  }

  return Array.from(normalizedCode)
    .map((character) => String.fromCodePoint(127397 + character.charCodeAt(0)))
    .join("");
}

function getBusinessUnitFlagFallback(businessUnitId) {
  return buildFlagEmoji(businessUnitId) || String(businessUnitId || "").trim().toUpperCase();
}

function escapeCsvValue(value) {
  const normalizedValue = String(value ?? "");

  return /[",\n\r]/.test(normalizedValue)
    ? `"${normalizedValue.replace(/"/g, '""')}"`
    : normalizedValue;
}

function buildPartnerBulkTemplate() {
  const rows = [
    BULK_TEMPLATE_HEADERS,
    ["", "fr", "inbound", "Sample Partner", "/B2BI_archives/RECU/sample-partner", "sample@example.com"]
  ];

  return `\uFEFF${rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n")}`;
}

function parseCsvText(rawValue) {
  const rows = [];
  let currentRow = [];
  let currentValue = "";
  let insideQuotes = false;

  for (let index = 0; index < rawValue.length; index += 1) {
    const character = rawValue[index];

    if (character === '"') {
      if (insideQuotes && rawValue[index + 1] === '"') {
        currentValue += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }

      continue;
    }

    if (character === "," && !insideQuotes) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && rawValue[index + 1] === "\n") {
        index += 1;
      }

      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += character;
  }

  if (currentValue || currentRow.length) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  return rows;
}

function normalizeBulkImportEntry(entry, rowLabel) {
  const rawEntry = {
    id: String(entry?.id || "").trim(),
    bu: String(entry?.bu || "").trim().toLowerCase(),
    type: String(entry?.type || "inbound").trim().toLowerCase(),
    label: String(entry?.label || "").trim(),
    url: String(entry?.url || "").trim(),
    backup: String(entry?.backup || "").trim()
  };

  if (!rawEntry.bu || !rawEntry.type || !rawEntry.label || !rawEntry.url) {
    throw new Error(`${rowLabel} must include bu, type, label, and url.`);
  }

  return normalizeEntry({
    ...rawEntry,
    id: rawEntry.id || createEntryId()
  });
}

async function parseBulkImportFile(file) {
  const rawValue = (await file.text()).replace(/^\uFEFF/, "");

  if (!rawValue.trim()) {
    throw new Error("The selected bulk file is empty.");
  }

  const looksLikeJson =
    /\.json$/i.test(file.name || "") ||
    rawValue.trimStart().startsWith("{") ||
    rawValue.trimStart().startsWith("[");

  if (looksLikeJson) {
    const parsedValue = JSON.parse(rawValue);
    const rawEntries = Array.isArray(parsedValue)
      ? parsedValue
      : Array.isArray(parsedValue?.entries)
        ? parsedValue.entries
        : parsedValue && typeof parsedValue === "object"
          ? [parsedValue]
          : [];

    if (!rawEntries.length) {
      throw new Error("The JSON file does not contain any partner entries.");
    }

    return rawEntries.map((entry, index) =>
      normalizeBulkImportEntry(entry, `Entry ${index + 1}`)
    );
  }

  const rows = parseCsvText(rawValue).filter((row) =>
    row.some((cell) => String(cell || "").trim())
  );

  if (rows.length < 2) {
    throw new Error("The CSV file must include a header row and at least one partner row.");
  }

  const headers = rows[0].map((header) => String(header || "").trim().toLowerCase());
  const requiredHeaders = ["bu", "type", "label", "url"];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));

  if (missingHeaders.length) {
    throw new Error(`Missing required CSV column(s): ${missingHeaders.join(", ")}.`);
  }

  return rows.slice(1).map((row, index) => {
    const record = headers.reduce((result, header, headerIndex) => {
      result[header] = row[headerIndex] ?? "";
      return result;
    }, {});

    return normalizeBulkImportEntry(record, `Row ${index + 2}`);
  });
}

function readStoredSession() {
  try {
    const rawValue = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
    const parsedValue = rawValue ? JSON.parse(rawValue) : null;

    if (parsedValue?.role === "admin") {
      const token = String(parsedValue?.token || "").trim();

      if (!token) {
        return DEFAULT_CLIENT_SESSION;
      }

      return {
        role: "admin",
        username: String(parsedValue?.username || "admin").trim().toLowerCase() || "admin",
        token
      };
    }

    return DEFAULT_CLIENT_SESSION;
  } catch (error) {
    return null;
  }
}

function readStoredTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch (error) {
    return "dark";
  }
}

function readStoredLanguage() {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) || "en";
  } catch (error) {
    return "en";
  }
}

function formatBytes(value) {
  const size = Number(value) || 0;

  if (!size) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const normalizedValue = size / 1024 ** index;

  return `${normalizedValue >= 10 || index === 0 ? normalizedValue.toFixed(0) : normalizedValue.toFixed(1)} ${units[index]}`;
}

function formatDateTime(value) {
  if (!value) {
    return "Not available";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch (error) {
    return value;
  }
}

function getModifiedTimestamp(value) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function sortDirectoryItems(items, sortOrder = "desc") {
  const direction = sortOrder === "asc" ? 1 : -1;

  return [...items].sort((leftItem, rightItem) => {
    if (leftItem.kind !== rightItem.kind) {
      return leftItem.kind === "directory" ? -1 : 1;
    }

    const leftTimestamp = getModifiedTimestamp(leftItem.modifiedAt);
    const rightTimestamp = getModifiedTimestamp(rightItem.modifiedAt);

    if (leftTimestamp === null && rightTimestamp !== null) {
      return 1;
    }

    if (leftTimestamp !== null && rightTimestamp === null) {
      return -1;
    }

    if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
      return (leftTimestamp - rightTimestamp) * direction;
    }

    return String(leftItem.name || "").localeCompare(String(rightItem.name || ""), undefined, {
      numeric: true,
      sensitivity: "base"
    });
  });
}

function getBusinessUnit(businessUnits, businessUnitId) {
  return businessUnits.find((businessUnit) => businessUnit.id === businessUnitId) || null;
}

function getBusinessUnitName(businessUnits, businessUnitId) {
  return (
    getBusinessUnit(businessUnits, businessUnitId)?.name ||
    String(businessUnitId || "").toUpperCase()
  );
}

function getBusinessUnitFlag(businessUnits, businessUnitId) {
  return getBusinessUnit(businessUnits, businessUnitId)?.flag || "";
}

function getBusinessUnitFlagId(businessUnits, businessUnitId) {
  return getBusinessUnit(businessUnits, businessUnitId)?.flagId || "";
}

function getBuVisualStyle(businessUnitId) {
  const palette = BU_VISUALS[businessUnitId] || DEFAULT_BU_VISUAL;

  return {
    "--bu-accent": palette.accent,
    "--bu-soft": palette.soft,
    "--bu-glow": palette.glow
  };
}

function getContactHref(value) {
  const normalizedValue = String(value || "").trim();
  return normalizedValue && normalizedValue.includes("@") ? `mailto:${normalizedValue}` : "";
}

function getFlagAssetPath(flagId) {
  const normalizedFlagId = String(flagId || "").trim().toLowerCase();
  return normalizedFlagId ? `${process.env.PUBLIC_URL || ""}/flags/${normalizedFlagId}.svg` : "";
}

function getMapGroup(entry) {
  return /\/amap(?:[/_-]|$)/i.test(String(entry?.url || "")) ? "amap" : "bmap";
}

function splitArchivePath(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
}

function getArchiveMapMatch(value) {
  const pathSegments = splitArchivePath(value);
  const mapIndex = pathSegments.findIndex((segment) => /^(?:amap|bmap)(?:$|[_-].*)/i.test(segment));

  if (mapIndex === -1) {
    return null;
  }

  const segment = pathSegments[mapIndex];
  return {
    index: mapIndex,
    group: /^amap/i.test(segment) ? "amap" : "bmap",
    segment,
    segments: pathSegments,
    parentPathLower: pathSegments.slice(0, mapIndex).join("/").toLowerCase()
  };
}

function getPathMapGroup(value) {
  return getArchiveMapMatch(value)?.group || "";
}

function getRelativePathBetweenAbsolutePaths(fromPath, toPath) {
  const fromSegments = splitArchivePath(fromPath);
  const toSegments = splitArchivePath(toPath);
  let sharedIndex = 0;

  while (
    sharedIndex < fromSegments.length &&
    sharedIndex < toSegments.length &&
    fromSegments[sharedIndex].toLowerCase() === toSegments[sharedIndex].toLowerCase()
  ) {
    sharedIndex += 1;
  }

  return normalizeRelativeBrowsePath(
    [
      ...new Array(Math.max(fromSegments.length - sharedIndex, 0)).fill(".."),
      ...toSegments.slice(sharedIndex)
    ].join("/")
  );
}

function filterBrowserItems(items, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();

  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) => String(item?.name || "").toLowerCase().includes(normalizedQuery));
}

function buildSiblingMapSegment(segment, mapGroup) {
  return String(segment || "").replace(/^(?:amap|bmap)/i, mapGroup.toUpperCase());
}

function buildMapBrowseTargets({ browserState, currentEntry, mapEntries = [] }) {
  const rootPath = String(browserState?.entry?.rootPath || currentEntry?.url || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const currentPath = String(browserState?.currentPath || rootPath)
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");

  if (!rootPath || !currentPath) {
    return {};
  }

  const currentMapMatch = getArchiveMapMatch(currentPath);

  if (currentMapMatch) {
    const knownSegmentsByGroup = new Map([[currentMapMatch.group, currentMapMatch.segment]]);

    mapEntries.forEach((entry) => {
      const entryMapMatch = getArchiveMapMatch(entry?.url || "");

      if (entryMapMatch && entryMapMatch.parentPathLower === currentMapMatch.parentPathLower) {
        knownSegmentsByGroup.set(entryMapMatch.group, entryMapMatch.segment);
      }
    });

    return ["amap", "bmap"].reduce((targets, mapGroup) => {
      const targetSegment =
        knownSegmentsByGroup.get(mapGroup) ||
        buildSiblingMapSegment(currentMapMatch.segment, mapGroup);
      const targetAbsolutePath = [
        ...currentMapMatch.segments.slice(0, currentMapMatch.index),
        targetSegment,
        ...currentMapMatch.segments.slice(currentMapMatch.index + 1)
      ].join("/");

      return {
        ...targets,
        [mapGroup]: getRelativePathBetweenAbsolutePaths(rootPath, targetAbsolutePath)
      };
    }, {});
  }

  const directTargets = ["amap", "bmap"].reduce((targets, mapGroup) => {
    const matchingItem = (browserState?.items || []).find(
      (item) =>
        item?.kind === "directory" &&
        new RegExp(`^${mapGroup}(?:$|[_-].*)`, "i").test(String(item?.name || ""))
    );

    if (!matchingItem) {
      return targets;
    }

    return {
      ...targets,
      [mapGroup]: normalizeRelativeBrowsePath(matchingItem.relativePath)
    };
  }, {});

  if (Object.keys(directTargets).length) {
    return directTargets;
  }

  return mapEntries.reduce((targets, entry) => {
    const entryMapMatch = getArchiveMapMatch(entry?.url || "");

    if (!entryMapMatch) {
      return targets;
    }

    return {
      ...targets,
      [entryMapMatch.group]: getRelativePathBetweenAbsolutePaths(rootPath, entry.url)
    };
  }, {});
}

function getPartnerBasePath(entry) {
  const normalizedPath = String(entry?.url || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const pathSegments = normalizedPath.split("/").filter(Boolean);
  const lastSegment = String(pathSegments[pathSegments.length - 1] || "").trim();

  if (/^(?:amap|bmap)(?:$|[_-])/i.test(lastSegment)) {
    pathSegments.pop();
  }

  return pathSegments.join("/").toLowerCase();
}

function normalizePartnerLabel(label) {
  const mapTokenPattern = /\b(?:amap|bmap)(?:[_\s-]*db)?\b/gi;
  const trailingTokenPattern = /\b(?:fr|be|pl|hr|ib|it|lt|ua|es|pt|si|ws)\b$/i;
  let normalizedValue = String(label || "")
    .trim()
    .replace(/\([^)]*\)/g, (match) => match.replace(mapTokenPattern, ""))
    .replace(mapTokenPattern, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  while (trailingTokenPattern.test(normalizedValue)) {
    normalizedValue = normalizedValue.replace(trailingTokenPattern, "").trim();
  }

  return normalizedValue.replace(/[^a-z0-9]+/g, "");
}

function getPartnerGroupKey(entry) {
  const variantKey = getPartnerMapVariantKey(entry);

  if (variantKey) {
    return variantKey;
  }

  const normalizedUrl = String(entry?.url || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();

  return [
    String(entry?.bu || "").trim().toLowerCase(),
    String(entry?.type || "").trim().toLowerCase(),
    normalizedUrl || String(entry?.id || "").trim().toLowerCase()
  ].join("|");
}

function getPartnerGroupEntries(entries, currentEntry) {
  const partnerGroupKey = getPartnerGroupKey(currentEntry);

  return entries.filter((entry) => getPartnerGroupKey(entry) === partnerGroupKey);
}

function getBulkEntryMatchKey(entry) {
  return [
    String(entry?.bu || "").trim().toLowerCase(),
    String(entry?.type || "").trim().toLowerCase(),
    normalizePartnerLabel(entry?.label || ""),
    getMapGroup(entry) || "default"
  ].join("|");
}

function mergeBulkEntries(existingEntries, importedEntries) {
  const entriesById = new Map(existingEntries.map((entry) => [entry.id, entry]));
  const entryIdByMatchKey = new Map(
    existingEntries.map((entry) => [getBulkEntryMatchKey(entry), entry.id])
  );
  let created = 0;
  let updated = 0;

  importedEntries.forEach((entry) => {
    const matchedEntryId =
      (entry.id && entriesById.has(entry.id) && entry.id) ||
      entryIdByMatchKey.get(getBulkEntryMatchKey(entry));

    if (matchedEntryId) {
      const nextEntry = {
        ...entry,
        id: matchedEntryId
      };

      entriesById.set(matchedEntryId, nextEntry);
      entryIdByMatchKey.set(getBulkEntryMatchKey(nextEntry), matchedEntryId);
      updated += 1;
      return;
    }

    entriesById.set(entry.id, entry);
    entryIdByMatchKey.set(getBulkEntryMatchKey(entry), entry.id);
    created += 1;
  });

  return {
    created,
    updated,
    entries: [...entriesById.values()]
  };
}

function getPreferredPartnerEntry(entries, preferredMapGroup = "bmap") {
  return (
    entries.find((entry) => getMapGroup(entry) === preferredMapGroup) ||
    entries.find((entry) => getMapGroup(entry) === "bmap") ||
    entries.find((entry) => getMapGroup(entry) === "amap") ||
    entries[0] ||
    null
  );
}

function getPartnerMapVariantKey(entry) {
  const normalizedPath = String(entry?.url || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const pathSegments = normalizedPath.split("/").filter(Boolean);
  const lastSegment = String(pathSegments[pathSegments.length - 1] || "").trim().toLowerCase();

  if (!/^(?:amap|bmap)(?:$|[_-].*)/.test(lastSegment)) {
    return "";
  }

  pathSegments.pop();

  return [
    String(entry?.bu || "").trim().toLowerCase(),
    String(entry?.type || "").trim().toLowerCase(),
    pathSegments.join("/").toLowerCase()
  ].join("|");
}

function getPartnerMapEntries(entries, currentEntry) {
  if (!currentEntry) {
    return [];
  }

  const variantKey = getPartnerMapVariantKey(currentEntry);

  if (!variantKey) {
    return entries.filter((entry) => entry.id === currentEntry.id);
  }

  return entries.filter((entry) => getPartnerMapVariantKey(entry) === variantKey);
}

function findPartnerMapEntry(entries, currentEntry, mapGroup) {
  return getPreferredPartnerEntry(
    getPartnerMapEntries(entries, currentEntry).filter((entry) => getMapGroup(entry) === mapGroup),
    mapGroup
  );
}

function normalizeRelativeBrowsePath(value) {
  const segments = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== ".");
  const normalizedSegments = [];

  segments.forEach((segment) => {
    if (segment === "..") {
      if (
        normalizedSegments.length &&
        normalizedSegments[normalizedSegments.length - 1] !== ".."
      ) {
        normalizedSegments.pop();
        return;
      }
    }

    normalizedSegments.push(segment);
  });

  return normalizedSegments.join("/");
}

function getPreviousBrowsePath(currentRelativePath) {
  const normalizedCurrentPath = normalizeRelativeBrowsePath(currentRelativePath);
  return normalizeRelativeBrowsePath(
    normalizedCurrentPath ? `${normalizedCurrentPath}/..` : ".."
  );
}

function getDirectionLabel(direction) {
  return String(direction || "").toLowerCase() === "outbound" ? "Outbound" : "Inbound";
}

function BusinessUnitFlag({ businessUnit, className = "bu-flag" }) {
  const flagLabel = String(
    businessUnit?.name || businessUnit?.label || businessUnit?.id || "Business unit"
  ).trim();
  const flagSrc = getFlagAssetPath(businessUnit?.flagId);

  if (flagSrc) {
    return <img className={className} src={flagSrc} alt={`${flagLabel} flag`} />;
  }

  return (
    <span className={className} aria-label={`${flagLabel} flag`}>
      {String(businessUnit?.flag || businessUnit?.id || "BU").trim() || "BU"}
    </span>
  );
}

function ContactValue({ value, fallback }) {
  const normalizedValue = String(value || "").trim();
  const contactHref = getContactHref(normalizedValue);

  if (!normalizedValue) {
    return <span className="muted-note">{fallback}</span>;
  }

  if (contactHref) {
    return (
      <a className="detail-link" href={contactHref}>
        {normalizedValue}
      </a>
    );
  }

  return <span className="detail-link">{normalizedValue}</span>;
}

function App() {
  const assetBase = process.env.PUBLIC_URL || "";
  const [session, setSession] = useState(() => readStoredSession() || DEFAULT_CLIENT_SESSION);
  const [themeMode, setThemeMode] = useState(() => readStoredTheme());
  const [language, setLanguage] = useState(() => readStoredLanguage());
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminLoginBusy, setAdminLoginBusy] = useState(false);
  const [adminLoginError, setAdminLoginError] = useState("");
  const [selectedBuId, setSelectedBuId] = useState("");
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [homeSearchMode, setHomeSearchMode] = useState("partner");
  const [homePartnerSearchValue, setHomePartnerSearchValue] = useState("");
  const [fileSearchValue, setFileSearchValue] = useState("");
  const [partnerSearchValue, setPartnerSearchValue] = useState("");
  const [partnerViewMode, setPartnerViewMode] = useState("grid");
  const [activeDirection, setActiveDirection] = useState("inbound");
  const [activeMapGroup, setActiveMapGroup] = useState("bmap");
  const [browsePath, setBrowsePath] = useState("");
  const [browseForwardStack, setBrowseForwardStack] = useState([]);
  const [directorySortOrder, setDirectorySortOrder] = useState("desc");
  const [browserSearchValue, setBrowserSearchValue] = useState("");
  const [searchState, setSearchState] = useState({
    loading: false,
    error: "",
    query: "",
    results: []
  });
  const [browserState, setBrowserState] = useState(EMPTY_BROWSER_STATE);
  const [filePreviewState, setFilePreviewState] = useState(EMPTY_FILE_PREVIEW_STATE);
  const [entries, setEntries] = useState([]);
  const [savedBusinessUnits, setSavedBusinessUnits] = useState([]);
  const [selectedBusinessUnitIds, setSelectedBusinessUnitIds] = useState([]);
  const [selectedPartnerKeys, setSelectedPartnerKeys] = useState([]);
  const [adminActionBusy, setAdminActionBusy] = useState(false);
  const [adminActionError, setAdminActionError] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerMode, setManagerMode] = useState("create");
  const [managerForm, setManagerForm] = useState(() => createManagerDraft());
  const [managerSaving, setManagerSaving] = useState(false);
  const [managerError, setManagerError] = useState("");
  const [bulkManagerOpen, setBulkManagerOpen] = useState(false);
  const [bulkUploadFile, setBulkUploadFile] = useState(null);
  const [bulkUploadSaving, setBulkUploadSaving] = useState(false);
  const [bulkUploadError, setBulkUploadError] = useState("");
  const [businessUnitManagerOpen, setBusinessUnitManagerOpen] = useState(false);
  const [businessUnitForm, setBusinessUnitForm] = useState(() => createBusinessUnitDraft());
  const [businessUnitSaving, setBusinessUnitSaving] = useState(false);
  const [businessUnitError, setBusinessUnitError] = useState("");
  const menuRef = useRef(null);
  const homePartnerSearchQuery = useDeferredValue(homePartnerSearchValue);
  const searchQuery = useDeferredValue(fileSearchValue);
  const {
    entries: initialEntries,
    businessUnits: initialBusinessUnits
  } = useDirectoryData();
  const businessUnits = useMemo(
    () => mergeBusinessUnits(BU_OPTIONS, savedBusinessUnits),
    [savedBusinessUnits]
  );
  const text = getText(language);
  const t = (key, fallback) => text[key] || fallback;
  const isAdmin = session?.role === "admin" && Boolean(String(session?.token || "").trim());
  const homePartnerResults = useMemo(() => {
    const normalizedQuery = homePartnerSearchQuery.trim().toLowerCase();

    if (normalizedQuery.length < 2) {
      return [];
    }

    const groupedEntries = new Map();

    entries.forEach((entry) => {
      const businessUnit = getBusinessUnit(businessUnits, entry.bu);
      const searchableValue = [
        entry.label,
        entry.type,
        businessUnit?.label,
        businessUnit?.name,
        businessUnit?.id
      ]
        .join(" ")
        .toLowerCase();

      if (!searchableValue.includes(normalizedQuery)) {
        return;
      }

      const groupKey = getPartnerGroupKey(entry);
      groupedEntries.set(groupKey, [...(groupedEntries.get(groupKey) || []), entry]);
    });

    return [...groupedEntries.values()]
      .map((groupEntries) => {
        const entry = getPreferredPartnerEntry(groupEntries, "bmap");

        if (!entry) {
          return null;
        }

        return {
          businessUnit: getBusinessUnit(businessUnits, entry.bu),
          entry
        };
      })
      .filter(Boolean)
      .sort((leftResult, rightResult) =>
        leftResult.entry.label.localeCompare(rightResult.entry.label, undefined, {
          numeric: true,
          sensitivity: "base"
        })
      );
  }, [businessUnits, entries, homePartnerSearchQuery]);
  const currentBusinessUnit = useMemo(
    () => businessUnits.find((businessUnit) => businessUnit.id === selectedBuId) || null,
    [businessUnits, selectedBuId]
  );
  const currentBuEntries = useMemo(
    () => (selectedBuId ? entries.filter((entry) => entry.bu === selectedBuId) : []),
    [entries, selectedBuId]
  );
  const filteredBuEntries = useMemo(() => {
    const normalizedPartnerSearch = partnerSearchValue.trim().toLowerCase();
    const groupedEntries = new Map();

    currentBuEntries
      .filter((entry) => entry.type === activeDirection)
      .filter((entry) =>
        normalizedPartnerSearch
          ? entry.label.toLowerCase().includes(normalizedPartnerSearch)
          : true
      )
      .forEach((entry) => {
        const groupKey = getPartnerGroupKey(entry);
        groupedEntries.set(groupKey, [...(groupedEntries.get(groupKey) || []), entry]);
      });

    return [...groupedEntries.values()]
      .map((groupEntries) => getPreferredPartnerEntry(groupEntries, activeMapGroup))
      .filter(Boolean)
      .sort((leftEntry, rightEntry) =>
        leftEntry.label.localeCompare(rightEntry.label, undefined, {
          numeric: true,
          sensitivity: "base"
        })
      );
  }, [activeDirection, activeMapGroup, currentBuEntries, partnerSearchValue]);
  const selectedBusinessUnitIdSet = useMemo(
    () => new Set(selectedBusinessUnitIds),
    [selectedBusinessUnitIds]
  );
  const allVisibleBusinessUnitsSelected =
    businessUnits.length > 0 &&
    businessUnits.every((businessUnit) => selectedBusinessUnitIdSet.has(businessUnit.id));
  const selectedPartnerKeySet = useMemo(
    () => new Set(selectedPartnerKeys),
    [selectedPartnerKeys]
  );
  const visiblePartnerKeys = useMemo(
    () => filteredBuEntries.map((entry) => getPartnerGroupKey(entry)),
    [filteredBuEntries]
  );
  const allVisiblePartnersSelected =
    visiblePartnerKeys.length > 0 &&
    visiblePartnerKeys.every((partnerKey) => selectedPartnerKeySet.has(partnerKey));
  const selectedPartner = useMemo(
    () => currentBuEntries.find((entry) => entry.id === selectedPartnerId) || null,
    [currentBuEntries, selectedPartnerId]
  );
  const selectedPartnerMapEntries = useMemo(() => {
    return getPartnerMapEntries(currentBuEntries, selectedPartner);
  }, [currentBuEntries, selectedPartner]);
  const selectedPartnerMapGroups = useMemo(
    () => new Set(selectedPartnerMapEntries.map(getMapGroup)),
    [selectedPartnerMapEntries]
  );
  const activePartnerMapEntry = useMemo(
    () => findPartnerMapEntry(currentBuEntries, selectedPartner, activeMapGroup),
    [activeMapGroup, currentBuEntries, selectedPartner]
  );
  const currentBrowserPath = useMemo(
    () =>
      String(browserState.currentPath || browserState.entry?.rootPath || selectedPartner?.url || ""),
    [browserState.currentPath, browserState.entry?.rootPath, selectedPartner?.url]
  );
  const currentBrowserMapGroup = useMemo(
    () => getPathMapGroup(currentBrowserPath),
    [currentBrowserPath]
  );
  const browserSearchMode = currentBrowserMapGroup ? "file" : "partner";
  const mapBrowseTargets = useMemo(
    () =>
      buildMapBrowseTargets({
        browserState,
        currentEntry: selectedPartner,
        mapEntries: selectedPartnerMapEntries
      }),
    [browserState, selectedPartner, selectedPartnerMapEntries]
  );
  const sortedBrowserItems = useMemo(
    () => sortDirectoryItems(browserState.items, directorySortOrder),
    [browserState.items, directorySortOrder]
  );
  const visibleBrowserItems = useMemo(
    () =>
      browserSearchMode === "partner"
        ? filterBrowserItems(sortedBrowserItems, browserSearchValue)
        : sortedBrowserItems,
    [browserSearchMode, browserSearchValue, sortedBrowserItems]
  );
  const displayedPartner =
    !browserState.loading && browserState.entry ? browserState.entry : selectedPartner;
  const canBrowseForward = browseForwardStack.length > 0;
  const showHomeView = !selectedBuId && !selectedPartner;
  const isArchiveFileSearchEnabled =
    (showHomeView && homeSearchMode === "file") ||
    Boolean(selectedPartner && browserSearchMode === "file");

  useEffect(() => {
    if (!selectedPartner) {
      return;
    }

    const nextMapGroup = currentBrowserMapGroup || getMapGroup(selectedPartner);

    if (activeMapGroup !== nextMapGroup) {
      setActiveMapGroup(nextMapGroup);
    }
  }, [activeMapGroup, currentBrowserMapGroup, selectedPartner]);

  useEffect(() => {
    if (!selectedPartner || !selectedPartnerMapEntries.length) {
      return;
    }

    if (activePartnerMapEntry || currentBrowserMapGroup) {
      return;
    }

    if (selectedPartnerMapGroups.has("bmap")) {
      setActiveMapGroup("bmap");
      return;
    }

    if (selectedPartnerMapGroups.has("amap")) {
      setActiveMapGroup("amap");
    }
  }, [
    activeMapGroup,
    activePartnerMapEntry,
    currentBrowserMapGroup,
    selectedPartner,
    selectedPartnerMapEntries.length,
    selectedPartnerMapGroups
  ]);

  useEffect(() => {
    if (!selectedPartner || !activePartnerMapEntry || activePartnerMapEntry.id === selectedPartner.id) {
      return;
    }

    setSelectedPartnerId(activePartnerMapEntry.id);
    resetBrowseNavigation();
  }, [activePartnerMapEntry, selectedPartner]);

  useEffect(() => {
    document.body.dataset.theme = themeMode;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch (error) {
      // Keep theme in memory if storage is unavailable.
    }

    return () => {
      delete document.body.dataset.theme;
    };
  }, [themeMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch (error) {
      // Keep language in memory if storage is unavailable.
    }
  }, [language]);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  useEffect(() => {
    setSavedBusinessUnits(initialBusinessUnits);
  }, [initialBusinessUnits]);

  useEffect(() => {
    try {
      if (session) {
        window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
      } else {
        window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
      }
    } catch (error) {
      // Keep session in memory if storage is unavailable.
    }
  }, [session]);

  useEffect(() => {
    if (session?.role !== "admin") {
      if (managerOpen) {
        setManagerOpen(false);
        setManagerMode("create");
        setManagerForm(createManagerDraft());
        setManagerError("");
        setManagerSaving(false);
      }

      if (bulkManagerOpen) {
        setBulkManagerOpen(false);
        setBulkUploadFile(null);
        setBulkUploadSaving(false);
        setBulkUploadError("");
      }

      if (businessUnitManagerOpen) {
        setBusinessUnitManagerOpen(false);
        setBusinessUnitForm(createBusinessUnitDraft());
        setBusinessUnitSaving(false);
        setBusinessUnitError("");
      }

      if (selectedPartnerKeys.length || adminActionError) {
        setSelectedPartnerKeys([]);
        setAdminActionError("");
      }
    }
  }, [
    adminActionError,
    bulkManagerOpen,
    businessUnitManagerOpen,
    managerOpen,
    selectedPartnerKeys.length,
    session
  ]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (selectedBuId && !businessUnits.some((businessUnit) => businessUnit.id === selectedBuId)) {
      setSelectedBuId("");
      setSelectedPartnerId("");
      resetBrowseNavigation();
    }
  }, [businessUnits, selectedBuId]);

  useEffect(() => {
    if (selectedPartnerId && !currentBuEntries.some((entry) => entry.id === selectedPartnerId)) {
      setSelectedPartnerId("");
      resetBrowseNavigation();
    }
  }, [currentBuEntries, selectedPartnerId]);

  useEffect(() => {
    const visibleBusinessUnitIds = new Set(businessUnits.map((businessUnit) => businessUnit.id));

    setSelectedBusinessUnitIds((previousSelectedBusinessUnitIds) => {
      const nextSelectedBusinessUnitIds = previousSelectedBusinessUnitIds.filter(
        (businessUnitId) => visibleBusinessUnitIds.has(businessUnitId)
      );

      return nextSelectedBusinessUnitIds.length === previousSelectedBusinessUnitIds.length
        ? previousSelectedBusinessUnitIds
        : nextSelectedBusinessUnitIds;
    });
  }, [businessUnits]);

  useEffect(() => {
    const visiblePartnerKeySet = new Set(visiblePartnerKeys);

    setSelectedPartnerKeys((previousSelectedPartnerKeys) => {
      const nextSelectedPartnerKeys = previousSelectedPartnerKeys.filter((partnerKey) =>
        visiblePartnerKeySet.has(partnerKey)
      );

      return nextSelectedPartnerKeys.length === previousSelectedPartnerKeys.length
        ? previousSelectedPartnerKeys
        : nextSelectedPartnerKeys;
    });
  }, [visiblePartnerKeys]);

  useEffect(() => {
    const normalizedQuery = isArchiveFileSearchEnabled ? searchQuery.trim() : "";

    if (!isArchiveFileSearchEnabled || normalizedQuery.length < 2) {
      setSearchState({
        loading: false,
        error: "",
        query: normalizedQuery,
        results: []
      });
      return undefined;
    }

    let cancelled = false;

    setSearchState((previous) => ({
      ...previous,
      loading: true,
      error: "",
      query: normalizedQuery
    }));

    searchArchive(normalizedQuery, selectedPartner ? { entryId: selectedPartner.id } : {})
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setSearchState({
          loading: false,
          error: "",
          query: normalizedQuery,
          results: Array.isArray(payload?.results) ? payload.results : []
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSearchState({
          loading: false,
          error: error.message || "Unable to search files.",
          query: normalizedQuery,
          results: []
        });
      });

    return () => {
      cancelled = true;
    };
  }, [isArchiveFileSearchEnabled, searchQuery, selectedPartner]);

  useEffect(() => {
    if (!selectedPartner) {
      setBrowserState(EMPTY_BROWSER_STATE);
      setFilePreviewState(EMPTY_FILE_PREVIEW_STATE);
      return undefined;
    }

    let cancelled = false;
    setFilePreviewState(EMPTY_FILE_PREVIEW_STATE);

    setBrowserState({
      ...EMPTY_BROWSER_STATE,
      loading: true,
      error: ""
    });

    listArchive(selectedPartner.id, browsePath)
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setBrowserState({
          loading: false,
          error: "",
          entry: payload?.entry || null,
          currentPath: String(payload?.currentPath || ""),
          relativePath: String(payload?.relativePath || ""),
          parentRelativePath: String(payload?.parentRelativePath || ""),
          rootPath: String(payload?.rootPath || ""),
          canGoUp: payload?.canGoUp === true,
          items: Array.isArray(payload?.items) ? payload.items : []
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setBrowserState({
          ...EMPTY_BROWSER_STATE,
          loading: false,
          error: error.message || "Unable to load this partner.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [browsePath, selectedPartner]);

  function resetBrowseNavigation(nextPath = "") {
    setBrowseForwardStack([]);
    setBrowsePath(normalizeRelativeBrowsePath(nextPath));
  }

  function browseDirectory(nextPath) {
    resetBrowseNavigation(nextPath);
  }

  function handleBrowsePreviousDirectory() {
    if (!browserState.canGoUp) {
      return;
    }

    const currentRelativePath = normalizeRelativeBrowsePath(browserState.relativePath);

    if (currentRelativePath) {
      setBrowseForwardStack((previousStack) => [...previousStack, currentRelativePath]);
    }

    setBrowsePath(getPreviousBrowsePath(currentRelativePath));
  }

  function handleBrowseNextDirectory() {
    const nextPath = browseForwardStack[browseForwardStack.length - 1];

    if (nextPath === undefined) {
      return;
    }

    setBrowseForwardStack((previousStack) => previousStack.slice(0, -1));
    setBrowsePath(normalizeRelativeBrowsePath(nextPath));
  }

  function clearSearchState() {
    setFileSearchValue("");
    setHomePartnerSearchValue("");
    setFilePreviewState(EMPTY_FILE_PREVIEW_STATE);
    setSearchState({
      loading: false,
      error: "",
      query: "",
      results: []
    });
  }

  function clearBusinessUnitSelection() {
    setSelectedBusinessUnitIds([]);
  }

  function clearPartnerSelection() {
    setSelectedPartnerKeys([]);
  }

  function handleCloseAdminLogin() {
    setAdminLoginOpen(false);
    setAdminUsername("");
    setAdminPassword("");
    setAdminLoginBusy(false);
    setAdminLoginError("");
  }

  async function saveDirectoryData(nextEntries, nextBusinessUnits = savedBusinessUnits) {
    const adminToken = String(session?.token || "").trim();

    if (!adminToken) {
      throw new Error("Admin authentication is required to save directory data.");
    }

    const response = await fetch(DIRECTORY_DATA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": adminToken
      },
      body: JSON.stringify({
        entries: nextEntries,
        businessUnits: nextBusinessUnits
      })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload?.error || "Unable to save directory data.");
    }

    setEntries(Array.isArray(payload?.entries) ? payload.entries : []);
    setSavedBusinessUnits(
      Array.isArray(payload?.businessUnits) ? payload.businessUnits : nextBusinessUnits
    );

    return payload;
  }

  async function handleAdminLogin(credentials) {
    const response = await fetch(ADMIN_LOGIN_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(credentials)
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.error || t("loginErrorAdmin", "Admin access details are not correct."));
    }

    const adminToken = String(payload?.token || "").trim();

    if (!adminToken) {
      throw new Error("Admin authentication is not available right now.");
    }

    setSession({
      role: "admin",
      username: payload.username || String(credentials?.username || "").trim().toLowerCase() || "admin",
      token: adminToken
    });
  }

  async function handleAdminModeSubmit(event) {
    event.preventDefault();
    setAdminLoginBusy(true);
    setAdminLoginError("");

    try {
      await handleAdminLogin({
        username: adminUsername,
        password: adminPassword
      });
      handleCloseAdminLogin();
    } catch (error) {
      setAdminLoginError(
        error.message || t("loginErrorAdmin", "Admin access details are not correct.")
      );
      setAdminLoginBusy(false);
    }
  }

  function handleOpenAdminMode() {
    setMenuOpen(false);

    if (isAdmin) {
      return;
    }

    setAdminLoginOpen(true);
    setAdminLoginError("");
  }

  function handleOpenCreateManager() {
    if (!isAdmin) {
      return;
    }

    setBusinessUnitManagerOpen(false);
    setBusinessUnitSaving(false);
    setBusinessUnitError("");
    setBulkManagerOpen(false);
    setBulkUploadFile(null);
    setBulkUploadError("");
    setAdminActionError("");
    setManagerMode("create");
    setManagerForm(
      createManagerDraft({
        bu: selectedBuId || businessUnits[0]?.id || "",
        type: activeDirection || "inbound"
      })
    );
    setManagerError("");
    setManagerOpen(true);
    setMenuOpen(false);
  }

  function handleOpenEditManager(entry = selectedPartner) {
    if (!isAdmin || !entry) {
      return;
    }

    setBusinessUnitManagerOpen(false);
    setBusinessUnitSaving(false);
    setBusinessUnitError("");
    setBulkManagerOpen(false);
    setBulkUploadFile(null);
    setBulkUploadError("");
    setAdminActionError("");
    setManagerMode("edit");
    setManagerForm(
      createManagerDraft({
        id: entry.id,
        bu: entry.bu,
        type: entry.type,
        label: entry.label,
        url: entry.url,
        backup: entry.backup
      })
    );
    setManagerError("");
    setManagerOpen(true);
    setMenuOpen(false);
  }

  function handleCloseManager() {
    setManagerOpen(false);
    setManagerMode("create");
    setManagerForm(createManagerDraft());
    setManagerError("");
    setManagerSaving(false);
  }

  function handleOpenBulkManager() {
    if (!isAdmin) {
      return;
    }

    setManagerOpen(false);
    setManagerError("");
    setManagerSaving(false);
    setBusinessUnitManagerOpen(false);
    setBusinessUnitSaving(false);
    setBusinessUnitError("");
    setBulkUploadFile(null);
    setBulkUploadError("");
    setBulkUploadSaving(false);
    setBulkManagerOpen(true);
    setMenuOpen(false);
  }

  function handleCloseBulkManager() {
    setBulkManagerOpen(false);
    setBulkUploadFile(null);
    setBulkUploadSaving(false);
    setBulkUploadError("");
  }

  function handleOpenBusinessUnitManager() {
    if (!isAdmin) {
      return;
    }

    setManagerOpen(false);
    setManagerError("");
    setManagerSaving(false);
    setBulkManagerOpen(false);
    setBulkUploadFile(null);
    setBulkUploadError("");
    setBusinessUnitForm(createBusinessUnitDraft());
    setBusinessUnitSaving(false);
    setBusinessUnitError("");
    setBusinessUnitManagerOpen(true);
    setMenuOpen(false);
  }

  function handleCloseBusinessUnitManager() {
    setBusinessUnitManagerOpen(false);
    setBusinessUnitForm(createBusinessUnitDraft());
    setBusinessUnitSaving(false);
    setBusinessUnitError("");
  }

  function handleManagerFieldChange(field, value) {
    setManagerForm((previousManagerForm) => ({
      ...previousManagerForm,
      [field]: value
    }));
  }

  function handleBusinessUnitFieldChange(field, value) {
    setBusinessUnitForm((previousBusinessUnitForm) => ({
      ...previousBusinessUnitForm,
      [field]: value
    }));
  }

  async function handleManagerSubmit(event) {
    event.preventDefault();

    const normalizedDraft = {
      id: managerForm.id || createEntryId(),
      bu: String(managerForm.bu || "").trim().toLowerCase(),
      type: String(managerForm.type || "inbound").trim().toLowerCase(),
      label: String(managerForm.label || "").trim(),
      url: String(managerForm.url || "").trim(),
      backup: String(managerForm.backup || "").trim()
    };

    if (!normalizedDraft.bu || !normalizedDraft.type || !normalizedDraft.label || !normalizedDraft.url) {
      setManagerError("Business unit, section, partner label, and path are required.");
      return;
    }

    setManagerSaving(true);
    setManagerError("");

    const nextEntries =
      managerMode === "edit"
        ? entries.map((entry) => (entry.id === managerForm.id ? normalizedDraft : entry))
        : [...entries, normalizedDraft];

    try {
      const payload = await saveDirectoryData(nextEntries);
      const savedEntries = Array.isArray(payload?.entries) ? payload.entries : [];
      const savedEntry =
        savedEntries.find((entry) => entry.id === normalizedDraft.id) ||
        savedEntries.find(
          (entry) =>
            entry.bu === normalizedDraft.bu &&
            entry.type === normalizedDraft.type &&
            entry.label === normalizedDraft.label &&
            entry.url === normalizedDraft.url
        ) ||
        null;

      if (savedEntry) {
        setSelectedBuId(savedEntry.bu);
        setSelectedPartnerId(savedEntry.id);
        setActiveDirection(savedEntry.type);
        resetBrowseNavigation();
      }

      clearPartnerSelection();
      setAdminActionError("");
      clearSearchState();
      handleCloseManager();
    } catch (error) {
      setManagerError(error.message || t("savePartnerError", "Unable to save the partner right now."));
      setManagerSaving(false);
    }
  }

  async function handleManagerDelete() {
    if (managerMode !== "edit" || !managerForm.id) {
      return;
    }

    setManagerSaving(true);
    setManagerError("");

    try {
      await saveDirectoryData(entries.filter((entry) => entry.id !== managerForm.id));

      if (selectedPartnerId === managerForm.id) {
        setSelectedPartnerId("");
        resetBrowseNavigation();
      }

      clearPartnerSelection();
      setAdminActionError("");
      clearSearchState();
      handleCloseManager();
    } catch (error) {
      setManagerError(error.message || t("removePartnerError", "Unable to remove the partner right now."));
      setManagerSaving(false);
    }
  }

  function handleBulkFileChange(event) {
    setBulkUploadFile(event.target.files?.[0] || null);
    setBulkUploadError("");
  }

  function handleTogglePartnerSelection(entry) {
    const partnerKey = getPartnerGroupKey(entry);

    setSelectedPartnerKeys((previousSelectedPartnerKeys) =>
      previousSelectedPartnerKeys.includes(partnerKey)
        ? previousSelectedPartnerKeys.filter((selectedPartnerKey) => selectedPartnerKey !== partnerKey)
        : [...previousSelectedPartnerKeys, partnerKey]
    );
  }

  function handleToggleBusinessUnitSelection(businessUnitId) {
    setSelectedBusinessUnitIds((previousSelectedBusinessUnitIds) =>
      previousSelectedBusinessUnitIds.includes(businessUnitId)
        ? previousSelectedBusinessUnitIds.filter(
            (selectedBusinessUnitId) => selectedBusinessUnitId !== businessUnitId
          )
        : [...previousSelectedBusinessUnitIds, businessUnitId]
    );
  }

  function handleToggleSelectAllBusinessUnits() {
    setSelectedBusinessUnitIds((previousSelectedBusinessUnitIds) => {
      if (allVisibleBusinessUnitsSelected) {
        return [];
      }

      return businessUnits.map((businessUnit) => businessUnit.id);
    });
  }

  function handleToggleSelectAllVisiblePartners() {
    setSelectedPartnerKeys((previousSelectedPartnerKeys) => {
      if (allVisiblePartnersSelected) {
        return previousSelectedPartnerKeys.filter(
          (selectedPartnerKey) => !visiblePartnerKeys.includes(selectedPartnerKey)
        );
      }

      return [...new Set([...previousSelectedPartnerKeys, ...visiblePartnerKeys])];
    });
  }

  function handleDownloadBulkTemplate() {
    const templateBlob = new Blob([buildPartnerBulkTemplate()], {
      type: "text/csv;charset=utf-8;"
    });
    const templateUrl = window.URL.createObjectURL(templateBlob);
    const link = document.createElement("a");

    link.href = templateUrl;
    link.download = BULK_TEMPLATE_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(templateUrl);
  }

  async function handleDeletePartner(entry) {
    if (!isAdmin || !entry) {
      return;
    }

    const partnerEntries = getPartnerGroupEntries(entries, entry);
    const partnerKey = getPartnerGroupKey(entry);
    const confirmMessage =
      partnerEntries.length > 1
        ? `Delete "${entry.label}" and its ${partnerEntries.length} saved links?`
        : `Delete "${entry.label}"?`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setAdminActionBusy(true);
    setAdminActionError("");

    try {
      await saveDirectoryData(
        entries.filter((currentEntry) => getPartnerGroupKey(currentEntry) !== partnerKey)
      );

      if (selectedPartner && getPartnerGroupKey(selectedPartner) === partnerKey) {
        setSelectedPartnerId("");
        resetBrowseNavigation();
      }

      clearPartnerSelection();
      clearSearchState();
    } catch (error) {
      setAdminActionError(
        error.message || t("removePartnerError", "Unable to remove the partner right now.")
      );
    } finally {
      setAdminActionBusy(false);
    }
  }

  async function handleDeleteSelectedPartners() {
    if (!selectedPartnerKeys.length) {
      return;
    }

    const selectedPartnerKeySetForDelete = new Set(selectedPartnerKeys);
    const entryCountToDelete = entries.filter((entry) =>
      selectedPartnerKeySetForDelete.has(getPartnerGroupKey(entry))
    ).length;

    if (
      !window.confirm(
        `Delete ${selectedPartnerKeys.length} selected partner${selectedPartnerKeys.length === 1 ? "" : "s"} and ${entryCountToDelete} saved link${entryCountToDelete === 1 ? "" : "s"}?`
      )
    ) {
      return;
    }

    setAdminActionBusy(true);
    setAdminActionError("");

    try {
      await saveDirectoryData(
        entries.filter((entry) => !selectedPartnerKeySetForDelete.has(getPartnerGroupKey(entry)))
      );

      if (
        selectedPartner &&
        selectedPartnerKeySetForDelete.has(getPartnerGroupKey(selectedPartner))
      ) {
        setSelectedPartnerId("");
        resetBrowseNavigation();
      }

      clearPartnerSelection();
      clearSearchState();
    } catch (error) {
      setAdminActionError(
        error.message || t("removePartnerError", "Unable to remove the partner right now.")
      );
    } finally {
      setAdminActionBusy(false);
    }
  }

  async function handleDeleteSelectedBusinessUnits() {
    if (!isAdmin || !selectedBusinessUnitIds.length) {
      return;
    }

    const selectedBusinessUnitIdSetForDelete = new Set(selectedBusinessUnitIds);
    const deletedBusinessUnits = businessUnits.filter((businessUnit) =>
      selectedBusinessUnitIdSetForDelete.has(businessUnit.id)
    );
    const businessUnitEntries = entries.filter((entry) =>
      selectedBusinessUnitIdSetForDelete.has(entry.bu)
    );
    const confirmMessage = `Delete ${deletedBusinessUnits.length} selected business unit${deletedBusinessUnits.length === 1 ? "" : "s"} and ${businessUnitEntries.length} partner link${businessUnitEntries.length === 1 ? "" : "s"}?`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setAdminActionBusy(true);
    setAdminActionError("");

    try {
      const nextBusinessUnits = [
        ...savedBusinessUnits.filter(
          (businessUnit) => !selectedBusinessUnitIdSetForDelete.has(businessUnit.id)
        ),
        ...deletedBusinessUnits.map((businessUnit) => ({
          id: businessUnit.id,
          removed: true
        }))
      ];

      await saveDirectoryData(
        entries.filter((entry) => !selectedBusinessUnitIdSetForDelete.has(entry.bu)),
        nextBusinessUnits
      );

      if (selectedBuId && selectedBusinessUnitIdSetForDelete.has(selectedBuId)) {
        setSelectedBuId("");
      }

      if (selectedPartner && selectedBusinessUnitIdSetForDelete.has(selectedPartner.bu)) {
        setSelectedPartnerId("");
      }

      resetBrowseNavigation();
      clearBusinessUnitSelection();
      clearPartnerSelection();
      clearSearchState();
    } catch (error) {
      setAdminActionError(
        error.message || "Unable to remove the business unit right now."
      );
    } finally {
      setAdminActionBusy(false);
    }
  }

  async function handleBulkUploadSubmit(event) {
    event.preventDefault();

    if (!bulkUploadFile) {
      setBulkUploadError("Select a CSV or JSON file before starting the bulk update.");
      return;
    }

    setBulkUploadSaving(true);
    setBulkUploadError("");

    try {
      const importedEntries = await parseBulkImportFile(bulkUploadFile);
      const mergeResult = mergeBulkEntries(entries, importedEntries);

      await saveDirectoryData(mergeResult.entries);

      if (importedEntries[0]) {
        setSelectedBuId(importedEntries[0].bu);
        setActiveDirection(importedEntries[0].type);
        setSelectedPartnerId("");
        resetBrowseNavigation();
      }

      clearPartnerSelection();
      setAdminActionError("");
      clearSearchState();
      handleCloseBulkManager();
    } catch (error) {
      setBulkUploadError(
        error.message || "Unable to process the bulk update file right now."
      );
      setBulkUploadSaving(false);
    }
  }

  async function handleBusinessUnitSubmit(event) {
    event.preventDefault();

    const normalizedId = normalizeBusinessUnitCode(businessUnitForm.id);
    const normalizedFlagId = normalizeBusinessUnitCode(businessUnitForm.flagId);
    const normalizedLabel =
      String(businessUnitForm.label || "").trim() || `BU ${normalizedId.toUpperCase()}`;
    const normalizedName = String(businessUnitForm.name || "").trim() || normalizedLabel;
    const normalizedFlag =
      String(businessUnitForm.flag || "").trim() || getBusinessUnitFlagFallback(normalizedId);

    if (!normalizedId) {
      setBusinessUnitError("Business unit code is required. Use letters, numbers, - or _.");
      return;
    }

    if (!normalizedName) {
      setBusinessUnitError("Business unit name is required.");
      return;
    }

    if (businessUnits.some((businessUnit) => businessUnit.id === normalizedId)) {
      setBusinessUnitError(`Business unit "${normalizedId}" already exists.`);
      return;
    }

    setBusinessUnitSaving(true);
    setBusinessUnitError("");

    try {
      const nextBusinessUnits = [
        ...savedBusinessUnits.filter((businessUnit) => businessUnit.id !== normalizedId),
        {
          id: normalizedId,
          label: normalizedLabel,
          name: normalizedName,
          flag: normalizedFlag,
          flagId: normalizedFlagId
        }
      ];

      await saveDirectoryData(entries, nextBusinessUnits);

      setSelectedBuId(normalizedId);
      setSelectedPartnerId("");
      resetBrowseNavigation();
      clearBusinessUnitSelection();
      clearPartnerSelection();
      setAdminActionError("");
      clearSearchState();
      handleCloseBusinessUnitManager();
    } catch (error) {
      setBusinessUnitError(
        error.message || "Unable to save the business unit right now."
      );
      setBusinessUnitSaving(false);
    }
  }

  function handleLogout() {
    setSession(DEFAULT_CLIENT_SESSION);
    setAdminLoginOpen(false);
    setAdminUsername("");
    setAdminPassword("");
    setAdminLoginBusy(false);
    setAdminLoginError("");
    setSelectedBuId("");
    setSelectedPartnerId("");
    setPartnerSearchValue("");
    setPartnerViewMode("grid");
    resetBrowseNavigation();
    clearBusinessUnitSelection();
    clearPartnerSelection();
    setAdminActionError("");
    clearSearchState();
    setMenuOpen(false);
    handleCloseManager();
    handleCloseBulkManager();
    handleCloseBusinessUnitManager();
  }

  function handleReturnHome() {
    setSelectedBuId("");
    setSelectedPartnerId("");
    setPartnerSearchValue("");
    setPartnerViewMode("grid");
    resetBrowseNavigation();
    clearBusinessUnitSelection();
    clearPartnerSelection();
    setAdminActionError("");
    clearSearchState();
    setMenuOpen(false);
  }

  function handleSelectBusinessUnit(businessUnitId) {
    setSelectedBuId(businessUnitId);
    setSelectedPartnerId("");
    setPartnerSearchValue("");
    setPartnerViewMode("grid");
    resetBrowseNavigation();
    clearBusinessUnitSelection();
    clearPartnerSelection();
    setAdminActionError("");
    clearSearchState();
  }

  function handleSelectPartner(entry) {
    setSelectedBuId(entry.bu);
    setSelectedPartnerId(entry.id);
    setActiveDirection(entry.type);
    setActiveMapGroup(getMapGroup(entry));
    setBrowserSearchValue("");
    resetBrowseNavigation();
    clearSearchState();
  }

  function handleSelectPartnerMapGroup(mapGroup) {
    if (!selectedPartner) {
      return;
    }

    const nextBrowsePath = mapBrowseTargets[mapGroup];

    if (nextBrowsePath === undefined) {
      return;
    }

    const nextPartner = findPartnerMapEntry(currentBuEntries, selectedPartner, mapGroup);

    setActiveMapGroup(mapGroup);
    setBrowserSearchValue("");
    setFilePreviewState(EMPTY_FILE_PREVIEW_STATE);
    clearSearchState();
    resetBrowseNavigation(nextBrowsePath);

    if (nextPartner && nextPartner.id !== selectedPartner.id) {
      setSelectedPartnerId(nextPartner.id);
    }
  }

  function openArchiveWindow(entryId, relativePath = "") {
    const archiveWindowUrl = buildArchiveOpenUrl(entryId, relativePath, themeMode);
    const previewWindow = window.open(archiveWindowUrl, "_blank");

    if (previewWindow) {
      previewWindow.opener = null;
      previewWindow.focus();
    }
  }

  async function openFilePreview({
    entryId,
    fileName,
    modifiedAt,
    relativePath,
    size,
    source
  }) {
    setFilePreviewState({
      ...EMPTY_FILE_PREVIEW_STATE,
      loading: true,
      open: true,
      source,
      entryId,
      relativePath,
      fileName,
      size,
      modifiedAt
    });

    try {
      const payload = await getArchiveFilePreview(entryId, relativePath);
      setFilePreviewState({
        loading: false,
        error: "",
        source,
        entryId,
        relativePath,
        fileName: payload?.fileName || fileName,
        size: Number(payload?.size) || Number(size) || 0,
        modifiedAt: payload?.modifiedAt || modifiedAt || "",
        contentType: payload?.contentType || "",
        content: String(payload?.content || ""),
        notice: String(payload?.notice || ""),
        previewable: payload?.previewable === true,
        open: true
      });
    } catch (error) {
      setFilePreviewState({
        ...EMPTY_FILE_PREVIEW_STATE,
        loading: false,
        error: error.message || "Unable to preview this file.",
        source,
        entryId,
        relativePath,
        fileName,
        size,
        modifiedAt,
        open: true
      });
    }
  }

  function handleOpenSearchResult(result) {
    openArchiveWindow(result.entryId, result.relativePath);
  }

  function handleBrowseSearchResult(result) {
    const matchedEntry = entries.find((entry) => entry.id === result.entryId) || null;

    setSelectedBuId(result.bu);
    setSelectedPartnerId(result.entryId);
    setBrowserSearchValue("");
    if (matchedEntry) {
      setActiveDirection(matchedEntry.type);
      setActiveMapGroup(getMapGroup(matchedEntry));
    }
    resetBrowseNavigation(result.directory || "");
    setFilePreviewState(EMPTY_FILE_PREVIEW_STATE);
    clearSearchState();
  }

  function handleOpenFile(item) {
    if (!selectedPartner) {
      return;
    }

    openArchiveWindow(selectedPartner.id, item.relativePath);
  }

  function handleCloseFilePreview() {
    setFilePreviewState(EMPTY_FILE_PREVIEW_STATE);
  }

  function handleToggleDirectorySortOrder() {
    setDirectorySortOrder((previousSortOrder) => (previousSortOrder === "asc" ? "desc" : "asc"));
  }
  const showHomePartnerResults =
    showHomeView && homeSearchMode === "partner" && homePartnerSearchQuery.trim().length >= 2;
  const showFileResults =
    Boolean(searchState.query) &&
    ((showHomeView && homeSearchMode === "file") ||
      Boolean(selectedPartner && browserSearchMode === "file"));

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="topbar-title">
          <img className="topbar-logo" src={`${assetBase}/groupecatlogo.png`} alt="Groupecat" />
          <div className="topbar-heading-copy">
            
            <strong>{t("appHeaderTitle", "ACCESS TO PRODUCTION FILE")}</strong>
          </div>
        </div>

        <div className="topbar-actions">
          {isAdmin ? <span className="status-badge warning">{t("adminMode", "Admin mode")}</span> : null}
          <LanguageDropdown
            currentLanguageId={language}
            languages={LANGUAGES}
            onSelect={setLanguage}
          />
          <ThemeToggle
            themeMode={themeMode}
            onToggle={() =>
              setThemeMode((previousThemeMode) =>
                previousThemeMode === "dark" ? "light" : "dark"
              )
            }
            label={themeMode === "dark" ? t("lightMode", "Light mode") : t("darkMode", "Dark mode")}
          />
          <button
            className="icon-action-button"
            type="button"
            aria-label={t("home", "Home")}
            title={t("home", "Home")}
            onClick={handleReturnHome}
          >
            <AppIcon type="home" />
          </button>
          <div className="menu-shell" ref={menuRef}>
            <button
              className={`icon-action-button menu-trigger-button ${menuOpen ? "active" : ""}`.trim()}
              type="button"
              aria-label="Open menu"
              title="Open menu"
              onClick={() => setMenuOpen((previousMenuOpen) => !previousMenuOpen)}
            >
              <AppIcon type="menu" />
            </button>

            {menuOpen ? (
              <div className="menu-popover menu-popover-minimal">
                <a
                  className="menu-item"
                  href={`mailto:${SUPPORT_EMAIL}`}
                  onClick={() => setMenuOpen(false)}
                >
                  <AppIcon type="mail" />
                  <span className="menu-item-copy">
                    <span className="menu-item-label">Help</span>
                  </span>
                </a>

                {isAdmin ? (
                  <>
                    <div className="menu-divider" aria-hidden="true" />

                    <button className="menu-item" type="button" onClick={handleOpenCreateManager}>
                      <AppIcon type="plus" />
                      <span className="menu-item-copy">
                        <span className="menu-item-label">{t("openManager", "Add New Partner")}</span>
                      </span>
                    </button>

                    <button className="menu-item" type="button" onClick={handleOpenBusinessUnitManager}>
                      <AppIcon type="office" />
                      <span className="menu-item-copy">
                        <span className="menu-item-label">
                          {t("openBusinessUnitManager", "Add New Business Unit")}
                        </span>
                      </span>
                    </button>

                    <button className="menu-item" type="button" onClick={handleOpenBulkManager}>
                      <AppIcon type="upload" />
                      <span className="menu-item-copy">
                        <span className="menu-item-label">{t("bulkUpdate", "Bulk update")}</span>
                      </span>
                    </button>

                    <button className="menu-item menu-item-danger" type="button" onClick={handleLogout}>
                      <AppIcon type="logout" />
                      <span className="menu-item-copy">
                        <span className="menu-item-label">{t("logout", "Logout")}</span>
                      </span>
                    </button>
                  </>
                ) : (
                  <button className="menu-item" type="button" onClick={handleOpenAdminMode}>
                    <AppIcon type="shield" />
                    <span className="menu-item-copy">
                      <span className="menu-item-label">{t("adminMode", "Admin mode")}</span>
                    </span>
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className={`shell-body ${showHomeView ? "shell-body-home" : ""}`.trim()}>
        {showHomeView ? (
          <section className="home-stage">
            <section className="bu-strip bu-strip-home">
              <div className="panel-header panel-header-centered panel-header-home">
                <div>
                  <span className="section-kicker">Business Units</span>
                </div>
              </div>

              {isAdmin ? (
                <div className="admin-partner-toolbar">
                  <div className="admin-partner-toolbar-copy">
                    <strong>
                      {selectedBusinessUnitIds.length
                        ? `${selectedBusinessUnitIds.length} selected`
                        : t("adminMode", "Admin mode")}
                    </strong>
                    <small>Business unit actions</small>
                  </div>

                  <div className="admin-partner-toolbar-actions">
                    <button
                      className="secondary-button compact-button"
                      type="button"
                      onClick={handleToggleSelectAllBusinessUnits}
                      disabled={!businessUnits.length || adminActionBusy}
                    >
                      {allVisibleBusinessUnitsSelected
                        ? t("clearSelection", "Clear selection")
                        : t("selectAllVisible", "Select all visible")}
                    </button>
                    <button
                      className="secondary-button compact-button admin-danger-button"
                      type="button"
                      onClick={handleDeleteSelectedBusinessUnits}
                      disabled={!selectedBusinessUnitIds.length || adminActionBusy}
                    >
                      {adminActionBusy ? t("deleting", "Deleting...") : t("deleteSelected", "Delete selected")}
                    </button>
                  </div>
                </div>
              ) : null}

              {adminActionError ? <div className="form-error inline-feedback">{adminActionError}</div> : null}

              <div className="bu-strip-grid bu-strip-grid-centered bu-strip-grid-home">
                {businessUnits.map((businessUnit) => (
                  <article
                    key={businessUnit.id}
                    className={`bu-tile bu-tile-home ${
                      selectedBusinessUnitIdSet.has(businessUnit.id) ? "selected" : ""
                    }`.trim()}
                    style={getBuVisualStyle(businessUnit.id)}
                  >
                    <div className="bu-tile-top">
                      <BusinessUnitFlag businessUnit={businessUnit} className="bu-flag" />
                      {isAdmin ? (
                        <label
                          className="partner-select-toggle checkbox-only"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            aria-label={`Select ${businessUnit.label}`}
                            type="checkbox"
                            checked={selectedBusinessUnitIdSet.has(businessUnit.id)}
                            onChange={() => handleToggleBusinessUnitSelection(businessUnit.id)}
                          />
                        </label>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      className="bu-tile-launch"
                      onClick={() => handleSelectBusinessUnit(businessUnit.id)}
                    >
                      <strong>{businessUnit.label}</strong>
                      <small>{businessUnit.name}</small>
                    </button>
                  </article>
                ))}
              </div>
            </section>

            <SearchPanel
              fileQuery={fileSearchValue}
              mode={homeSearchMode}
              onFileQueryChange={setFileSearchValue}
              onModeChange={setHomeSearchMode}
              onPartnerQueryChange={setHomePartnerSearchValue}
              partnerQuery={homePartnerSearchValue}
              t={t}
            />

            {showHomePartnerResults ? (
              <PartnerSearchResults
                onBrowsePartner={handleSelectPartner}
                results={homePartnerResults}
                t={t}
              />
            ) : null}

            {showFileResults ? (
              <SearchResults
                businessUnits={businessUnits}
                error={searchState.error}
                filePreviewState={filePreviewState}
                loading={searchState.loading}
                onClosePreview={handleCloseFilePreview}
                onBrowse={handleBrowseSearchResult}
                onOpen={handleOpenSearchResult}
                query={searchState.query}
                results={searchState.results}
                t={t}
              />
            ) : null}
          </section>
        ) : null}

        {selectedBuId && !selectedPartner ? (
          <BusinessUnitDirectory
            adminBusy={adminActionBusy}
            adminError={adminActionError}
            allVisiblePartnersSelected={allVisiblePartnersSelected}
            businessUnit={currentBusinessUnit}
            entries={filteredBuEntries}
            isAdmin={isAdmin}
            onDeletePartner={handleDeletePartner}
            onDeleteSelectedPartners={handleDeleteSelectedPartners}
            onEditPartner={handleOpenEditManager}
            onOpenManager={handleOpenCreateManager}
            partnerSearchValue={partnerSearchValue}
            partnerViewMode={partnerViewMode}
            selectedPartnerKeys={selectedPartnerKeys}
            setPartnerSearchValue={setPartnerSearchValue}
            activeDirection={activeDirection}
            setPartnerViewMode={setPartnerViewMode}
            setActiveDirection={setActiveDirection}
            onBackToList={handleReturnHome}
            onBrowsePartner={handleSelectPartner}
            onTogglePartnerSelection={handleTogglePartnerSelection}
            onToggleSelectAllPartners={handleToggleSelectAllVisiblePartners}
            t={t}
          />
        ) : null}

        {selectedPartner ? (
          <section className="partner-focus" style={getBuVisualStyle(selectedPartner.bu)}>
            <div className="focused-header">
              <div>
                <strong>{displayedPartner?.label || selectedPartner.label}</strong>
                <ContactValue
                  value={displayedPartner?.backup || selectedPartner.backup}
                  fallback={t("contactUnavailable", "Contact not available")}
                />
              </div>

              <div className="focused-actions">
                {isAdmin ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => handleOpenEditManager(selectedPartner)}
                    disabled={adminActionBusy}
                  >
                    <span>{t("editEntry", "Edit")}</span>
                  </button>
                ) : null}
                {isAdmin ? (
                  <button
                    className="secondary-button admin-danger-button"
                    type="button"
                    onClick={() => handleDeletePartner(selectedPartner)}
                    disabled={adminActionBusy}
                  >
                    <span>{t("deleteEntry", "Delete")}</span>
                  </button>
                ) : null}
                <button className="secondary-button" type="button" onClick={() => setSelectedPartnerId("")}>
                  <AppIcon type="back" />
                  <span>{t("backToList", "Back to list")}</span>
                </button>
              </div>
            </div>

            {adminActionError ? <div className="form-error inline-feedback">{adminActionError}</div> : null}

            <PartnerFileControls
              activeMapGroup={currentBrowserMapGroup || activeMapGroup}
              canGoForward={canBrowseForward}
              canGoUp={browserState.canGoUp}
              mapTargets={mapBrowseTargets}
              onBrowseNext={handleBrowseNextDirectory}
              onBrowsePrevious={handleBrowsePreviousDirectory}
              onSelectMapGroup={handleSelectPartnerMapGroup}
              searchMode={browserSearchMode}
              searchValue={browserSearchMode === "file" ? fileSearchValue : browserSearchValue}
              setSearchValue={
                browserSearchMode === "file" ? setFileSearchValue : setBrowserSearchValue
              }
              t={t}
            />

            {browserSearchMode === "file" && searchState.query ? (
              <SearchResults
                businessUnits={businessUnits}
                error={searchState.error}
                filePreviewState={filePreviewState}
                loading={searchState.loading}
                onClosePreview={handleCloseFilePreview}
                onBrowse={handleBrowseSearchResult}
                onOpen={handleOpenSearchResult}
                query={searchState.query}
                results={searchState.results}
              t={t}
            />
          ) : null}

          <DirectoryBrowser
              browserState={browserState}
              dateSortOrder={directorySortOrder}
              filePreviewState={filePreviewState}
              items={visibleBrowserItems}
              onBrowse={browseDirectory}
              onClosePreview={handleCloseFilePreview}
              onOpenFile={handleOpenFile}
              onToggleDateSort={handleToggleDirectorySortOrder}
              selectedPartner={displayedPartner || selectedPartner}
              t={t}
            />
          </section>
        ) : null}
      </main>

      {isAdmin ? (
        <DirectoryManager
          businessUnits={businessUnits}
          error={managerError}
          mode={managerMode}
          onChange={handleManagerFieldChange}
          onClose={handleCloseManager}
          onDelete={handleManagerDelete}
          onOpenBusinessUnitManager={handleOpenBusinessUnitManager}
          onSubmit={handleManagerSubmit}
          open={managerOpen}
          saving={managerSaving}
          t={t}
          values={managerForm}
        />
      ) : null}

      {isAdmin ? (
        <BulkPartnerManager
          error={bulkUploadError}
          file={bulkUploadFile}
          onClose={handleCloseBulkManager}
          onDownloadTemplate={handleDownloadBulkTemplate}
          onFileChange={handleBulkFileChange}
          onSubmit={handleBulkUploadSubmit}
          open={bulkManagerOpen}
          saving={bulkUploadSaving}
          t={t}
        />
      ) : null}

      {isAdmin ? (
        <BusinessUnitManager
          error={businessUnitError}
          onChange={handleBusinessUnitFieldChange}
          onClose={handleCloseBusinessUnitManager}
          onSubmit={handleBusinessUnitSubmit}
          open={businessUnitManagerOpen}
          saving={businessUnitSaving}
          t={t}
          values={businessUnitForm}
        />
      ) : null}

      <AdminAccessModal
        busy={adminLoginBusy}
        error={adminLoginError}
        onClose={handleCloseAdminLogin}
        onPasswordChange={setAdminPassword}
        onSubmit={handleAdminModeSubmit}
        onUsernameChange={setAdminUsername}
        open={adminLoginOpen}
        password={adminPassword}
        t={t}
        username={adminUsername}
      />
    </div>
  );
}

function BusinessUnitDirectory({
  adminBusy,
  adminError,
  allVisiblePartnersSelected,
  businessUnit,
  entries,
  isAdmin,
  onDeletePartner,
  onDeleteSelectedPartners,
  onEditPartner,
  onOpenManager,
  partnerSearchValue,
  partnerViewMode,
  selectedPartnerKeys,
  setPartnerSearchValue,
  activeDirection,
  setPartnerViewMode,
  setActiveDirection,
  onBackToList,
  onBrowsePartner,
  onTogglePartnerSelection,
  onToggleSelectAllPartners,
  t
}) {
  const businessUnitTitle = [
    String(businessUnit?.name || businessUnit?.label || "Business unit").toUpperCase(),
    getDirectionLabel(activeDirection).toUpperCase()
  ].join(" ");
  const selectedPartnerKeySet = new Set(selectedPartnerKeys);

  return (
    <section className="bu-directory-shell" style={getBuVisualStyle(businessUnit?.id)}>
      <section className="bu-directory">
        <div className="directory-header-inline">
          <div className="directory-header-copy">
            <BusinessUnitFlag businessUnit={businessUnit} className="bu-flag bu-directory-flag" />
            <div>
              <strong>{businessUnitTitle}</strong>
            </div>
          </div>

          <div className="directory-header-actions">
            {isAdmin ? (
              <button className="secondary-button compact-button" type="button" onClick={onOpenManager}>
                <AppIcon type="plus" />
                <span>{t("openManager", "Add New Partner")}</span>
              </button>
            ) : null}
            <button className="secondary-button compact-button" type="button" onClick={onBackToList}>
              <AppIcon type="back" />
              <span>{t("backToList", "Back to list")}</span>
            </button>
          </div>
        </div>

        <div className="directory-controls directory-controls-wide">
          <div className="segmented-controls" aria-label="Direction">
            <button
              className={activeDirection === "inbound" ? "active" : ""}
              type="button"
              onClick={() => setActiveDirection("inbound")}
            >
              Inbound
            </button>
            <button
              className={activeDirection === "outbound" ? "active" : ""}
              type="button"
              onClick={() => setActiveDirection("outbound")}
            >
              Outbound
            </button>
          </div>

          <div className="search-input-shell partner-search-shell directory-search-shell">
            <input
              type="search"
              value={partnerSearchValue}
              placeholder={t("searchPartnerPlaceholder", "Search partner")}
              onChange={(event) => setPartnerSearchValue(event.target.value)}
            />
            <div className="search-input-actions" aria-hidden="true">
              <span className="search-mode-icon">
                <AppIcon type="users" />
              </span>
              <span className="search-mode-icon accent">
                <AppIcon type="search" />
              </span>
            </div>
          </div>

          <div className="segmented-controls view-mode-toggle" aria-label="View">
            <button
              className={partnerViewMode === "grid" ? "active" : ""}
              type="button"
              onClick={() => setPartnerViewMode("grid")}
            >
              <AppIcon type="grid" />
              <span>Grid</span>
            </button>
            <button
              className={partnerViewMode === "list" ? "active" : ""}
              type="button"
              onClick={() => setPartnerViewMode("list")}
            >
              <AppIcon type="list" />
              <span>List</span>
            </button>
          </div>
        </div>

        <section className="partners-panel">
          {isAdmin ? (
            <div className="admin-partner-toolbar">
              <div className="admin-partner-toolbar-copy">
                <strong>
                  {selectedPartnerKeys.length
                    ? `${selectedPartnerKeys.length} selected`
                    : t("adminMode", "Admin mode")}
                </strong>
                <small>Partner actions</small>
              </div>

              <div className="admin-partner-toolbar-actions">
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={onToggleSelectAllPartners}
                  disabled={!entries.length || adminBusy}
                >
                  {allVisiblePartnersSelected
                    ? t("clearSelection", "Clear selection")
                    : t("selectAllVisible", "Select all visible")}
                </button>
                <button
                  className="secondary-button compact-button admin-danger-button"
                  type="button"
                  onClick={onDeleteSelectedPartners}
                  disabled={!selectedPartnerKeys.length || adminBusy}
                >
                  {adminBusy ? t("deleting", "Deleting...") : t("deleteSelected", "Delete selected")}
                </button>
              </div>
            </div>
          ) : null}

          {adminError ? <div className="form-error inline-feedback">{adminError}</div> : null}

          {entries.length ? (
            partnerViewMode === "list" ? (
              <div className="partner-list-modern">
                {entries.map((entry) => (
                  <article
                    className={`partner-list-card ${
                      selectedPartnerKeySet.has(getPartnerGroupKey(entry)) ? "selected" : ""
                    }`.trim()}
                    key={entry.id}
                    style={getBuVisualStyle(entry.bu)}
                  >
                    <button
                      className="partner-list-launch partner-list-launch-modern"
                      type="button"
                      onClick={() => onBrowsePartner(entry)}
                    >
                      <div className="partner-list-main">
                        <span className="partner-grid-card-eyebrow">
                          <BusinessUnitFlag
                            businessUnit={businessUnit}
                            className="bu-flag partner-grid-flag"
                          />
                          <span>{getDirectionLabel(entry.type)}</span>
                        </span>
                        <strong>{entry.label}</strong>
                      </div>
                      <span className="partner-list-arrow">
                        <AppIcon type="forward" />
                      </span>
                    </button>

                    {isAdmin ? (
                      <div className="partner-grid-card-admin partner-grid-card-admin-inline">
                        <label
                          className="partner-select-toggle"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selectedPartnerKeySet.has(getPartnerGroupKey(entry))}
                            onChange={() => onTogglePartnerSelection(entry)}
                          />
                          <span>{t("select", "Select")}</span>
                        </label>
                        <button
                          className="secondary-button compact-button"
                          type="button"
                          onClick={() => onEditPartner(entry)}
                          disabled={adminBusy}
                        >
                          {t("editEntry", "Edit")}
                        </button>
                        <button
                          className="secondary-button compact-button admin-danger-button"
                          type="button"
                          onClick={() => onDeletePartner(entry)}
                          disabled={adminBusy}
                        >
                          {t("deleteEntry", "Delete")}
                        </button>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="partner-grid">
                {entries.map((entry) => (
                  <article
                    className={`partner-grid-card ${
                      selectedPartnerKeySet.has(getPartnerGroupKey(entry)) ? "selected" : ""
                    }`.trim()}
                    key={entry.id}
                    style={getBuVisualStyle(entry.bu)}
                  >
                    <div className="partner-grid-card-top">
                      <span className="partner-grid-card-eyebrow">
                        <BusinessUnitFlag
                          businessUnit={businessUnit}
                          className="bu-flag partner-grid-flag"
                        />
                        <span>{getDirectionLabel(entry.type)}</span>
                      </span>

                      {isAdmin ? (
                        <label className="partner-select-toggle" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedPartnerKeySet.has(getPartnerGroupKey(entry))}
                            onChange={() => onTogglePartnerSelection(entry)}
                          />
                          <span>{t("select", "Select")}</span>
                        </label>
                      ) : null}
                    </div>

                    <button
                      className="partner-grid-card-launch"
                      type="button"
                      onClick={() => onBrowsePartner(entry)}
                    >
                      <div className="partner-grid-card-body">
                        <strong>{entry.label}</strong>
                      </div>

                      <div className="partner-grid-card-bottom">
                        <span className="partner-grid-card-arrow">
                          <AppIcon type="forward" />
                        </span>
                      </div>
                    </button>

                    {isAdmin ? (
                      <div className="partner-grid-card-admin">
                        <button
                          className="secondary-button compact-button"
                          type="button"
                          onClick={() => onEditPartner(entry)}
                          disabled={adminBusy}
                        >
                          {t("editEntry", "Edit")}
                        </button>
                        <button
                          className="secondary-button compact-button admin-danger-button"
                          type="button"
                          onClick={() => onDeletePartner(entry)}
                          disabled={adminBusy}
                        >
                          {t("deleteEntry", "Delete")}
                        </button>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )
          ) : (
            <EmptyState title={t("noEntries", "No partners found.")} detail="Try another filter." />
          )}
        </section>
      </section>
    </section>
  );
}

function PartnerSearchResults({ onBrowsePartner, results, t }) {
  return (
    <section className="results-panel">
      <div className="panel-header">
        <div>
          <span className="section-kicker">Partner search</span>
          <strong>{results.length} matches</strong>
        </div>
      </div>

      {results.length ? (
        <div className="partner-list-modern">
          {results.map(({ businessUnit, entry }) => (
            <article
              className="partner-list-card partner-list-card-search"
              key={entry.id}
              style={getBuVisualStyle(entry.bu)}
            >
              <button
                className="partner-list-launch partner-list-launch-modern"
                type="button"
                onClick={() => onBrowsePartner(entry)}
              >
                <div className="partner-list-main">
                  <span className="partner-grid-card-eyebrow">
                    <BusinessUnitFlag businessUnit={businessUnit} className="bu-flag partner-grid-flag" />
                    <span>{businessUnit?.label || entry.bu}</span>
                  </span>
                  <strong>{entry.label}</strong>
                </div>
                <span className="partner-list-arrow">
                  <AppIcon type="forward" />
                </span>
              </button>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title={t("noEntries", "No partners found.")} detail="Try another query." />
      )}
    </section>
  );
}

function ManagerModalHero({ badge, description, iconType, onClose, title, titleId }) {
  return (
    <div className="manager-modal-hero">
      <div className="manager-modal-hero-main">
        <div className="manager-modal-hero-icon" aria-hidden="true">
          <AppIcon type={iconType} />
        </div>

        <div className="manager-header-copy manager-header-copy-hero">
          <span className="version-chip">{badge}</span>
          <strong id={titleId}>{title}</strong>
          <p>{description}</p>
        </div>
      </div>

      <button className="manager-close-button" type="button" onClick={onClose} aria-label="Close">
        <AppIcon type="close" />
      </button>
    </div>
  );
}

function ManagerField({ after = null, children, className = "", hint = "", iconType, label }) {
  return (
    <label className={`manager-field ${className}`.trim()}>
      <span>{label}</span>
      <div className="manager-input-shell">
        <span className="manager-input-icon" aria-hidden="true">
          <AppIcon type={iconType} />
        </span>
        {children}
      </div>
      {after}
      {hint ? <small className="form-note">{hint}</small> : null}
    </label>
  );
}

function AdminAccessModal({
  busy,
  error,
  onClose,
  onPasswordChange,
  onSubmit,
  onUsernameChange,
  open,
  password,
  t,
  username
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="manager-overlay admin-access-overlay" role="presentation" onClick={onClose}>
      <section
        className="manager-modal admin-access-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-access-title"
        onClick={(event) => event.stopPropagation()}
      >
        <ManagerModalHero
          badge={t("adminMode", "Admin mode")}
          description={t("adminWelcomeCopy", "Use your admin credentials to manage links and access the portal tools.")}
          iconType="shield"
          onClose={onClose}
          title={t("adminAccessTitle", "Admin access")}
          titleId="admin-access-title"
        />

        <form className="manager-form admin-access-form" onSubmit={onSubmit}>
          <ManagerField iconType="users" label={t("userId", "UserId")}>
            <input
              autoComplete="username"
              type="text"
              value={username}
              placeholder={t("userIdPlaceholder", "Enter your UserId")}
              onChange={(event) => onUsernameChange(event.target.value)}
            />
          </ManagerField>

          <ManagerField iconType="lock" label={t("passwordLabel", "Password")}>
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              placeholder={t("passwordPlaceholder", "Enter your password")}
              onChange={(event) => onPasswordChange(event.target.value)}
            />
          </ManagerField>

          <div className="admin-access-extras">
            <label className="admin-access-checkbox">
              <input type="checkbox" checked readOnly />
              <span>{t("rememberMe", "Remember me")}</span>
            </label>

            <a className="admin-access-link" href={`mailto:${SUPPORT_EMAIL}`}>
              {t("forgotPassword", "Forgot password?")}
            </a>
          </div>

          {error ? <div className="form-error">{error}</div> : null}

          <div className="form-actions admin-access-actions">
            <button className="secondary-button compact-button" type="button" onClick={onClose}>
              {t("cancel", "Cancel")}
            </button>
            <button className="primary-button compact-button" type="submit" disabled={busy}>
              <span>{busy ? "Signing in..." : t("signIn", "Sign in")}</span>
              <AppIcon type="forward" />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function DirectoryManager({
  businessUnits,
  error,
  mode,
  onChange,
  onClose,
  onDelete,
  onOpenBusinessUnitManager,
  onSubmit,
  open,
  saving,
  t,
  values
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="manager-overlay" role="presentation" onClick={onClose}>
      <section
        className="manager-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manager-title"
        onClick={(event) => event.stopPropagation()}
      >
        <ManagerModalHero
          badge={mode === "edit" ? t("editEntry", "Edit") : t("openManager", "Add New Partner")}
          description={t("managerCopy", "Changes are saved through the directory data service and are available to the portal immediately.")}
          iconType="users"
          onClose={onClose}
          title={mode === "edit" ? t("editEntry", "Edit partner") : t("managerTitle", "Add New Partner")}
          titleId="manager-title"
        />

        <form className="manager-form partner-manager-form" onSubmit={onSubmit}>
          <ManagerField
            after={
              <button
                className="secondary-button compact-button manager-helper-button"
                type="button"
                onClick={onOpenBusinessUnitManager}
                disabled={saving}
              >
                <AppIcon type="office" />
                <span>{t("openBusinessUnitManager", "Add New Business Unit")}</span>
              </button>
            }
            iconType="office"
            label={t("businessUnit", "Business unit")}
          >
            <select value={values.bu} onChange={(event) => onChange("bu", event.target.value)}>
              <option value="">Select BU</option>
              {businessUnits.map((businessUnit) => (
                <option key={businessUnit.id} value={businessUnit.id}>
                  {businessUnit.label} - {businessUnit.name}
                </option>
              ))}
            </select>
          </ManagerField>

          <ManagerField iconType="grid" label={t("section", "Section")}>
            <select value={values.type} onChange={(event) => onChange("type", event.target.value)}>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
          </ManagerField>

          <ManagerField className="manager-field-full" iconType="tag" label={t("label", "Label")}>
            <input
              type="text"
              value={values.label}
              onChange={(event) => onChange("label", event.target.value)}
            />
          </ManagerField>

          <ManagerField className="manager-field-full" iconType="folder" label={t("url", "Path or full URL")}>
            <input
              type="text"
              value={values.url}
              placeholder={t("urlPlaceholder", "/B2BI_archives/... or full URL")}
              onChange={(event) => onChange("url", event.target.value)}
            />
          </ManagerField>

          <ManagerField className="manager-field-full" iconType="mail" label={t("contact", "Backup email or note")}>
            <input
              type="text"
              value={values.backup}
              onChange={(event) => onChange("backup", event.target.value)}
            />
          </ManagerField>

          {error ? <div className="form-error">{error}</div> : null}

          <div className="form-actions">
            {mode === "edit" ? (
              <button className="secondary-button compact-button danger" type="button" onClick={onDelete} disabled={saving}>
                {t("deleteEntry", "Remove")}
              </button>
            ) : null}
            <button className="secondary-button compact-button" type="button" onClick={onClose} disabled={saving}>
              {t("cancel", "Cancel")}
            </button>
            <button className="primary-button compact-button" type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : mode === "edit"
                  ? t("updateEntry", "Save changes")
                  : t("addEntry", "Add link")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function BusinessUnitManager({
  error,
  onChange,
  onClose,
  onSubmit,
  open,
  saving,
  t,
  values
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="manager-overlay" role="presentation" onClick={onClose}>
      <section
        className="manager-modal business-unit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="business-unit-title"
        onClick={(event) => event.stopPropagation()}
      >
        <ManagerModalHero
          badge={t("openBusinessUnitManager", "Add New Business Unit")}
          description={t(
            "businessUnitManagerCopy",
            "Add a business unit here and it will be saved through the existing directory data service. No backend code update is needed."
          )}
          iconType="office"
          onClose={onClose}
          title={t("businessUnitManagerTitle", "Create business unit")}
          titleId="business-unit-title"
        />

        <form className="manager-form business-unit-form" onSubmit={onSubmit}>
          <ManagerField
            hint={t("businessUnitCodeHint", "Use letters, numbers, - or _. Example: de")}
            iconType="code"
            label={t("businessUnitCode", "BU code")}
          >
            <input
              type="text"
              value={values.id}
              placeholder={t("businessUnitCodePlaceholder", "de")}
              onChange={(event) => onChange("id", event.target.value)}
              disabled={saving}
            />
          </ManagerField>

          <ManagerField iconType="office" label={t("businessUnitName", "Business unit name")}>
            <input
              type="text"
              value={values.name}
              placeholder={t("businessUnitNamePlaceholder", "Germany")}
              onChange={(event) => onChange("name", event.target.value)}
              disabled={saving}
            />
          </ManagerField>

          <ManagerField iconType="tag" label={t("businessUnitLabel", "Business unit label")}>
            <input
              type="text"
              value={values.label}
              placeholder={t("businessUnitLabelPlaceholder", "BU DE")}
              onChange={(event) => onChange("label", event.target.value)}
              disabled={saving}
            />
          </ManagerField>

          <ManagerField
            hint={t("businessUnitFlagHint", "Optional. Leave empty to auto-generate a badge from the BU code.")}
            iconType="flag"
            label={t("businessUnitFlag", "Flag or short badge")}
          >
            <input
              type="text"
              value={values.flag}
              placeholder={t("businessUnitFlagPlaceholder", "IN")}
              onChange={(event) => onChange("flag", event.target.value)}
              disabled={saving}
            />
          </ManagerField>

          <ManagerField
            className="manager-field-full"
            hint={t(
              "businessUnitFlagIdHint",
              "Optional. Use this only if a matching SVG already exists in public/flags."
            )}
            iconType="image"
            label={t("businessUnitFlagId", "Flag asset id")}
          >
            <input
              type="text"
              value={values.flagId}
              placeholder={t("businessUnitFlagIdPlaceholder", "de")}
              onChange={(event) => onChange("flagId", event.target.value)}
              disabled={saving}
            />
          </ManagerField>

          {error ? <div className="form-error">{error}</div> : null}

          <div className="form-actions">
            <button className="secondary-button compact-button" type="button" onClick={onClose} disabled={saving}>
              {t("cancel", "Cancel")}
            </button>
            <button className="primary-button compact-button" type="submit" disabled={saving}>
              {saving ? t("saving", "Saving...") : t("saveBusinessUnit", "Save business unit")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function BulkPartnerManager({
  error,
  file,
  onClose,
  onDownloadTemplate,
  onFileChange,
  onSubmit,
  open,
  saving,
  t
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="manager-overlay" role="presentation" onClick={onClose}>
      <section
        className="manager-modal bulk-manager-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-manager-title"
        onClick={(event) => event.stopPropagation()}
      >
        <ManagerModalHero
          badge={t("bulkUpdate", "Bulk update")}
          description={t(
            "bulkUpdateCopy",
            "Download the CSV template, fill it with multiple partners, and upload it here. CSV and JSON files are supported."
          )}
          iconType="upload"
          onClose={onClose}
          title={t("bulkUpdateTitle", "Bulk partner update")}
          titleId="bulk-manager-title"
        />

        <form className="manager-form bulk-manager-form" onSubmit={onSubmit}>
          <div className="manager-field-full bulk-template-actions manager-callout-card">
            <div className="manager-callout-copy">
              <span className="manager-input-icon manager-input-icon-static" aria-hidden="true">
                <AppIcon type="download" />
              </span>
              <div>
                <strong>{t("downloadTemplate", "Download template")}</strong>
                <small className="bulk-note">
                  {t(
                    "bulkTemplateHint",
                    "Leave id empty to add a new partner. Keep or supply id to update an existing one."
                  )}
                </small>
              </div>
            </div>
            <button
              className="secondary-button compact-button"
              type="button"
              onClick={onDownloadTemplate}
              disabled={saving}
            >
              <span>{t("downloadTemplate", "Download template")}</span>
            </button>
          </div>

          <ManagerField
            className="manager-field-full"
            hint={
              file?.name
                ? `${t("selectedFile", "Selected file")}: ${file.name}`
                : t("bulkUploadHint", "Choose a CSV or JSON file with partner entries.")
            }
            iconType="upload"
            label={t("bulkUploadFile", "Bulk update file")}
          >
            <input
              className="manager-file-input"
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={onFileChange}
              disabled={saving}
            />
          </ManagerField>

          {error ? <div className="form-error">{error}</div> : null}

          <div className="form-actions">
            <button className="secondary-button compact-button" type="button" onClick={onClose} disabled={saving}>
              {t("cancel", "Cancel")}
            </button>
            <button className="primary-button compact-button" type="submit" disabled={saving}>
              {saving ? t("uploading", "Uploading...") : t("bulkUpdate", "Bulk update")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SearchPanel({
  fileQuery,
  mode,
  onFileQueryChange,
  onModeChange,
  onPartnerQueryChange,
  partnerQuery,
  t
}) {
  const query = mode === "partner" ? partnerQuery : fileQuery;
  const setQuery = mode === "partner" ? onPartnerQueryChange : onFileQueryChange;

  return (
    <section className="search-panel">
      <form className="search-form" onSubmit={(event) => event.preventDefault()}>
        <div className="search-input-shell search-input-shell-large">
          <input
            type="search"
            value={query}
            placeholder="Search Partner or File..."
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="search-input-actions">
            {query ? (
              <button
                className="search-clear-button"
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("clear", "Clear")}
              >
                <AppIcon type="close" />
              </button>
            ) : null}
            <button
              className={`search-mode-button ${mode === "partner" ? "active" : ""}`.trim()}
              type="button"
              aria-label="Partner Search"
              title="Partner Search"
              onClick={() => onModeChange("partner")}
            >
              <AppIcon type="users" />
            </button>
            <button
              className={`search-mode-button ${mode === "file" ? "active" : ""}`.trim()}
              type="button"
              aria-label="File Search"
              title="File Search"
              onClick={() => onModeChange("file")}
            >
              <AppIcon type="file" />
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function PartnerFileControls({
  activeMapGroup,
  canGoForward,
  canGoUp,
  mapTargets,
  onBrowseNext,
  onBrowsePrevious,
  onSelectMapGroup,
  searchMode,
  searchValue,
  setSearchValue,
  t
}) {
  const searchPlaceholder =
    searchMode === "file"
      ? t("searchFilePlaceholder", "Search file")
      : t("searchPartnerPlaceholder", "Search partner");

  return (
    <div className="partner-file-controls">
      <div className="partner-file-controls-left">
        <div className="segmented-controls" aria-label="Map">
          {["bmap", "amap"].map((mapGroup) => (
            <button
              className={activeMapGroup === mapGroup ? "active" : ""}
              disabled={mapTargets?.[mapGroup] === undefined}
              key={mapGroup}
              type="button"
              onClick={() => onSelectMapGroup(mapGroup)}
            >
              {mapGroup.toUpperCase()}
            </button>
          ))}
        </div>

        <button
          className="secondary-button compact-button"
          disabled={!canGoUp}
          type="button"
          onClick={onBrowsePrevious}
        >
          <AppIcon type="back" />
          <span>{t("previousDirectory", "Previous directory")}</span>
        </button>

        <button
          className="secondary-button compact-button"
          disabled={!canGoForward}
          type="button"
          onClick={onBrowseNext}
        >
          <AppIcon type="forward" />
          <span>{t("nextDirectory", "Next directory")}</span>
        </button>
      </div>

      <div className="search-input-shell partner-search-shell">
        <input
          type="search"
          value={searchValue}
          placeholder={searchPlaceholder}
          onChange={(event) => setSearchValue(event.target.value)}
        />
        <div className="search-input-actions" aria-hidden="true">
          <span className="search-mode-icon">
            <AppIcon type={searchMode === "file" ? "file" : "users"} />
          </span>
          <span className="search-mode-icon accent">
            <AppIcon type="search" />
          </span>
        </div>
      </div>
    </div>
  );
}

function SearchResults({
  businessUnits,
  error,
  filePreviewState,
  loading,
  onClosePreview,
  onBrowse,
  onOpen,
  query,
  results,
  t
}) {
  return (
    <section className="results-panel">
      <div className="panel-header">
        <div>
          <strong>
            {loading ? "Searching..." : `${results.length} result${results.length === 1 ? "" : "s"}`}
          </strong>
        </div>
      </div>

      {loading ? (
        <EmptyState title="Search in progress" detail={`Scanning files for "${query}".`} />
      ) : error ? (
        <EmptyState title="Search unavailable" detail={error} tone="warning" />
      ) : results.length ? (
        <div className="search-result-list">
          {results.map((result) => (
            <article className="search-result-row" key={result.id} style={getBuVisualStyle(result.bu)}>
              <div className="search-result-primary">
                <div className="search-result-title">
                  <span className="bu-pill">
                    <BusinessUnitFlag
                      businessUnit={getBusinessUnit(businessUnits, result.bu)}
                      className="bu-flag bu-pill-flag"
                    />
                    <span>{getBusinessUnitName(businessUnits, result.bu)}</span>
                  </span>
                </div>
                <strong>{result.fileName}</strong>
                <p>{result.entryLabel}</p>
              </div>

              <div className="search-result-details">
                <div className="partner-list-detail">
                  <span>Size</span>
                  <small>{formatBytes(result.size)}</small>
                </div>
                <div className="partner-list-detail">
                  <span>Modified</span>
                  <small>{formatDateTime(result.modifiedAt)}</small>
                </div>
              </div>

              <div className="result-card-actions">
                <button className="primary-button compact-button" type="button" onClick={() => onOpen(result)}>
                  View
                </button>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={() => onBrowse(result)}
                >
                  Browse
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No files found"
          detail={`No file matched "${query}".`}
        />
      )}

      {filePreviewState.open && filePreviewState.source === "search" ? (
        <FilePreviewPanel filePreviewState={filePreviewState} onClosePreview={onClosePreview} />
      ) : null}
    </section>
  );
}

function DirectoryBrowser({
  browserState,
  dateSortOrder,
  filePreviewState,
  items,
  onBrowse,
  onClosePreview,
  onOpenFile,
  onToggleDateSort,
  selectedPartner,
  t
}) {
  if (browserState.loading) {
    return <EmptyState title={t("loadingDirectories", "Loading...")} detail={selectedPartner.label} />;
  }

  if (browserState.error) {
    return <EmptyState title="Directory unavailable" detail={browserState.error} tone="warning" />;
  }

  const sortArrow = dateSortOrder === "asc" ? "ASC" : "DESC";
  const sortDirectionLabel =
    dateSortOrder === "asc"
      ? t("sortOldestToNewest", "Oldest to newest")
      : t("sortNewestToOldest", "Newest to oldest");

  return (
    <section className="directory-browser">
      <div className="browser-bar">
        <div>
          <strong>{selectedPartner.label}</strong>
          <small>{`${items.length} item${items.length === 1 ? "" : "s"}`}</small>
        </div>
        <button
          className="secondary-button compact-button browser-sort-button"
          type="button"
          onClick={onToggleDateSort}
          aria-label={`${t("dateModified", "Date modified")}: ${sortDirectionLabel}`}
          title={`${t("dateModified", "Date modified")}: ${sortDirectionLabel}`}
        >
          <span className="browser-sort-button-label">{t("dateModified", "Date modified")}</span>
          <span className="browser-sort-button-direction" aria-hidden="true">
            {sortArrow}
          </span>
        </button>
      </div>

      {items.length ? (
        <div className="browser-table">
          {items.map((item) =>
            item.kind === "directory" ? (
              <button
                key={item.relativePath || item.name}
                type="button"
                className="browser-row"
                onClick={() => onBrowse(item.relativePath)}
              >
                <div className="browser-row-main">
                  <span className="browser-row-icon">
                    <AppIcon type="folder" />
                  </span>
                  <div>
                    <strong title={item.name}>{item.name}</strong>
                  </div>
                </div>
                <div className="browser-row-meta">
                  <span>{formatDateTime(item.modifiedAt)}</span>
                </div>
              </button>
            ) : (
              <div className="browser-row browser-row-file" key={item.relativePath || item.name}>
                <div className="browser-row-main">
                  <span className="browser-row-icon">
                    <AppIcon type="file" />
                  </span>
                  <div>
                    <strong title={item.name}>{item.name}</strong>
                  </div>
                </div>
                <div className="browser-row-meta">
                  <span>{formatBytes(item.size)}</span>
                  <span>{formatDateTime(item.modifiedAt)}</span>
                </div>
                <div className="browser-row-actions">
                  <a
                    className="secondary-button compact-button"
                    href={buildArchiveDownloadUrl(selectedPartner.id, item.relativePath)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download
                  </a>
                  <button
                    className="primary-button compact-button"
                    type="button"
                    onClick={() => onOpenFile(item)}
                  >
                    View
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      ) : (
        <EmptyState title="No files" detail={selectedPartner.label} />
      )}

      {filePreviewState.open && filePreviewState.source === "directory" ? (
        <FilePreviewPanel filePreviewState={filePreviewState} onClosePreview={onClosePreview} />
      ) : null}
    </section>
  );
}

function FilePreviewPanel({ filePreviewState, onClosePreview }) {
  return (
    <section className="file-preview-panel">
      <div className="file-preview-header">
        <div className="file-preview-meta-row">
          <strong className="file-preview-file-name">{filePreviewState.fileName || "File preview"}</strong>
          <span>{formatBytes(filePreviewState.size)}</span>
          <span>{formatDateTime(filePreviewState.modifiedAt)}</span>
        </div>

        <button className="secondary-button compact-button" type="button" onClick={onClosePreview}>
          Close
        </button>
      </div>

      {filePreviewState.loading ? (
        <EmptyState title="Loading preview..." detail={filePreviewState.fileName || "Selected file"} />
      ) : filePreviewState.error ? (
        <EmptyState title="Preview unavailable" detail={filePreviewState.error} tone="warning" />
      ) : filePreviewState.previewable ? (
        <div className="file-preview-content">
          {filePreviewState.notice ? <div className="file-preview-notice">{filePreviewState.notice}</div> : null}
          <pre>{filePreviewState.content}</pre>
        </div>
      ) : (
        <div className="file-preview-content">
          <div className="file-preview-notice">
            {filePreviewState.notice || "This file cannot be displayed inline. Use Download to access it."}
          </div>
        </div>
      )}
    </section>
  );
}

function EmptyState({ title, detail, tone = "neutral" }) {
  return (
    <div className={`empty-state ${tone}`.trim()}>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function AppIcon({ type }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
    focusable: "false"
  };

  if (type === "home") {
    return (
      <svg {...commonProps}>
        <path d="M4 10.5 12 4l8 6.5" />
        <path d="M6.5 9.5v10h11v-10" />
      </svg>
    );
  }

  if (type === "menu") {
    return (
      <svg {...commonProps}>
        <path d="M6 8h12" />
        <path d="M6 12h12" />
        <path d="M6 16h12" />
      </svg>
    );
  }

  if (type === "logout") {
    return (
      <svg {...commonProps}>
        <path d="M10 5.5H7.5A1.5 1.5 0 0 0 6 7v10a1.5 1.5 0 0 0 1.5 1.5H10" />
        <path d="M14 8.5 18 12l-4 3.5" />
        <path d="M9.5 12H18" />
      </svg>
    );
  }

  if (type === "search") {
    return (
      <svg {...commonProps}>
        <circle cx="10.5" cy="10.5" r="5.2" />
        <path d="M15 15 19 19" />
      </svg>
    );
  }

  if (type === "back") {
    return (
      <svg {...commonProps}>
        <path d="M14.5 6.5 8.5 12l6 5.5" />
        <path d="M9 12h8" />
      </svg>
    );
  }

  if (type === "forward") {
    return (
      <svg {...commonProps}>
        <path d="M9.5 6.5 15.5 12l-6 5.5" />
        <path d="M15 12H7" />
      </svg>
    );
  }

  if (type === "folder") {
    return (
      <svg {...commonProps}>
        <path d="M3.5 7.5h6l1.5 2H20a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1Z" />
      </svg>
    );
  }

  if (type === "file") {
    return (
      <svg {...commonProps}>
        <path d="M7 3.5h7l4 4v13H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" />
        <path d="M14 3.5v4h4" />
      </svg>
    );
  }

  if (type === "users") {
    return (
      <svg {...commonProps}>
        <path d="M9 11a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 9 11Z" />
        <path d="M15.5 9.5a2.25 2.25 0 1 0 0-4.5" />
        <path d="M4.8 18.5a4.8 4.8 0 0 1 8.4 0" />
        <path d="M14.2 18.5a4 4 0 0 1 5 0" />
      </svg>
    );
  }

  if (type === "grid") {
    return (
      <svg {...commonProps}>
        <path d="M5.5 5.5h5v5h-5Z" />
        <path d="M13.5 5.5h5v5h-5Z" />
        <path d="M5.5 13.5h5v5h-5Z" />
        <path d="M13.5 13.5h5v5h-5Z" />
      </svg>
    );
  }

  if (type === "list") {
    return (
      <svg {...commonProps}>
        <path d="M8 7h11" />
        <path d="M8 12h11" />
        <path d="M8 17h11" />
        <path d="M5 7h.01" />
        <path d="M5 12h.01" />
        <path d="M5 17h.01" />
      </svg>
    );
  }

  if (type === "shield") {
    return (
      <svg {...commonProps}>
        <path d="M12 4.2 18.2 6.5v4.9c0 4-2.4 6.7-6.2 8.4-3.8-1.7-6.2-4.4-6.2-8.4V6.5Z" />
        <path d="m9.4 12 1.7 1.7 3.5-3.7" />
      </svg>
    );
  }

  if (type === "close") {
    return (
      <svg {...commonProps}>
        <path d="M7 7 17 17" />
        <path d="M17 7 7 17" />
      </svg>
    );
  }

  if (type === "help") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="8" />
        <path d="M9.8 9.6a2.4 2.4 0 0 1 4.4 1.35c0 1.8-2.2 2-2.2 3.4" />
        <path d="M12 17.2h.01" />
      </svg>
    );
  }

  if (type === "mail") {
    return (
      <svg {...commonProps}>
        <path d="M4.5 7.5h15a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" />
        <path d="m5.5 9 6.5 5 6.5-5" />
      </svg>
    );
  }

  if (type === "trash") {
    return (
      <svg {...commonProps}>
        <path d="M5.5 7.5h13" />
        <path d="M9 7.5v-2h6v2" />
        <path d="M7.2 7.5l.8 10.5a1 1 0 0 0 1 .9h6a1 1 0 0 0 1-.9l.8-10.5" />
        <path d="M10 10.5v5.5" />
        <path d="M14 10.5v5.5" />
      </svg>
    );
  }

  if (type === "plus") {
    return (
      <svg {...commonProps}>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    );
  }

  if (type === "code") {
    return (
      <svg {...commonProps}>
        <path d="m9 8-4 4 4 4" />
        <path d="m15 8 4 4-4 4" />
        <path d="M13 6.5 11 17.5" />
      </svg>
    );
  }

  if (type === "tag") {
    return (
      <svg {...commonProps}>
        <path d="M11 4.5H6.5a1 1 0 0 0-1 1V10l7.5 7.5a1 1 0 0 0 1.4 0l3.1-3.1a1 1 0 0 0 0-1.4Z" />
        <path d="M8.5 8.5h.01" />
      </svg>
    );
  }

  if (type === "flag") {
    return (
      <svg {...commonProps}>
        <path d="M6.5 19V5.5" />
        <path d="M6.5 6h8l-1.5 3 1.5 3h-8" />
      </svg>
    );
  }

  if (type === "image") {
    return (
      <svg {...commonProps}>
        <rect x="4.5" y="5.5" width="15" height="13" rx="2" />
        <path d="m7.5 15 3-3 2.5 2.5 2-2 2 2.5" />
        <path d="M15.5 9.5h.01" />
      </svg>
    );
  }

  if (type === "lock") {
    return (
      <svg {...commonProps}>
        <rect x="6.5" y="10.5" width="11" height="8" rx="2" />
        <path d="M9 10.5V8.8a3 3 0 1 1 6 0v1.7" />
      </svg>
    );
  }

  if (type === "office") {
    return (
      <svg {...commonProps}>
        <path d="M5.5 20V7.5L12 4l6.5 3.5V20" />
        <path d="M9 20v-4.5h6V20" />
        <path d="M9 9.5h.01" />
        <path d="M15 9.5h.01" />
        <path d="M9 13h.01" />
        <path d="M15 13h.01" />
      </svg>
    );
  }

  if (type === "upload") {
    return (
      <svg {...commonProps}>
        <path d="M12 17.5V6.5" />
        <path d="M8.5 10 12 6.5 15.5 10" />
        <path d="M5 18.5h14" />
      </svg>
    );
  }

  if (type === "download") {
    return (
      <svg {...commonProps}>
        <path d="M12 6.5v11" />
        <path d="M8.5 14 12 17.5 15.5 14" />
        <path d="M5 18.5h14" />
      </svg>
    );
  }

  return null;
}

export default App;
