import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  buildArchiveDownloadUrl,
  getArchiveFilePreview,
  listArchive,
  searchArchive
} from "./archiveApi";
import { BU_OPTIONS, LANGUAGES } from "./config";
import { getText } from "./text";
import useDirectoryData from "./useDirectoryData";
import { mergeBusinessUnits } from "./utils";
import LanguageDropdown from "./components/LanguageDropdown";
import ThemeToggle from "./components/ThemeToggle";

const AUTH_STORAGE_KEY = "apf_v2_auth_session";
const THEME_STORAGE_KEY = "apf_v2_theme_mode";
const LANGUAGE_STORAGE_KEY = "apf_v2_language";
const DIRECTORY_API_BASE = process.env.REACT_APP_DIRECTORY_API || "http://localhost:3001";
const DIRECTORY_DATA_API_URL = `${DIRECTORY_API_BASE}/api/directory-data`;
const ADMIN_LOGIN_API_URL = `${DIRECTORY_API_BASE}/api/auth/login`;
const EMPTY_BROWSER_STATE = {
  loading: false,
  error: "",
  currentPath: "",
  relativePath: "",
  parentRelativePath: "",
  rootPath: "",
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
const DEFAULT_BU_VISUAL = {
  accent: "#38bdf8",
  soft: "rgba(56, 189, 248, 0.16)",
  glow: "rgba(56, 189, 248, 0.26)"
};
const BU_VISUALS = {
  fr: {
    accent: "#3b82f6",
    soft: "rgba(59, 130, 246, 0.18)",
    glow: "rgba(59, 130, 246, 0.28)"
  },
  hr: {
    accent: "#ef4444",
    soft: "rgba(239, 68, 68, 0.18)",
    glow: "rgba(239, 68, 68, 0.28)"
  },
  ib: {
    accent: "#f97316",
    soft: "rgba(249, 115, 22, 0.18)",
    glow: "rgba(249, 115, 22, 0.28)"
  },
  it: {
    accent: "#22c55e",
    soft: "rgba(34, 197, 94, 0.18)",
    glow: "rgba(34, 197, 94, 0.28)"
  },
  lt: {
    accent: "#f59e0b",
    soft: "rgba(245, 158, 11, 0.18)",
    glow: "rgba(245, 158, 11, 0.28)"
  },
  pl: {
    accent: "#e11d48",
    soft: "rgba(225, 29, 72, 0.18)",
    glow: "rgba(225, 29, 72, 0.28)"
  },
  si: {
    accent: "#2563eb",
    soft: "rgba(37, 99, 235, 0.18)",
    glow: "rgba(37, 99, 235, 0.28)"
  },
  ua: {
    accent: "#2563eb",
    soft: "rgba(37, 99, 235, 0.18)",
    glow: "rgba(250, 204, 21, 0.22)"
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

function readStoredSession() {
  try {
    const rawValue = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
    return rawValue ? JSON.parse(rawValue) : null;
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

function getBusinessUnitName(businessUnits, businessUnitId) {
  return (
    businessUnits.find((businessUnit) => businessUnit.id === businessUnitId)?.name ||
    String(businessUnitId || "").toUpperCase()
  );
}

function getBusinessUnitFlag(businessUnits, businessUnitId) {
  return businessUnits.find((businessUnit) => businessUnit.id === businessUnitId)?.flag || "";
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

function getMapGroup(entry) {
  return /\/amap(?:[/_-]|$)/i.test(String(entry?.url || "")) ? "amap" : "bmap";
}

function getPartnerGroupKey(entry) {
  return [
    String(entry?.bu || "").trim().toLowerCase(),
    String(entry?.type || "").trim().toLowerCase(),
    String(entry?.label || "").trim().toLowerCase()
  ].join("|");
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
  const [session, setSession] = useState(() => readStoredSession());
  const [themeMode, setThemeMode] = useState(() => readStoredTheme());
  const [language, setLanguage] = useState(() => readStoredLanguage());
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedBuId, setSelectedBuId] = useState("");
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [fileSearchValue, setFileSearchValue] = useState("");
  const [partnerSearchValue, setPartnerSearchValue] = useState("");
  const [activeDirection, setActiveDirection] = useState("inbound");
  const [activeMapGroup, setActiveMapGroup] = useState("bmap");
  const [browsePath, setBrowsePath] = useState("");
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
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerMode, setManagerMode] = useState("create");
  const [managerForm, setManagerForm] = useState(() => createManagerDraft());
  const [managerSaving, setManagerSaving] = useState(false);
  const [managerError, setManagerError] = useState("");
  const menuRef = useRef(null);
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
  const isAdmin = session?.role === "admin";
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
  const selectedPartner = useMemo(
    () => currentBuEntries.find((entry) => entry.id === selectedPartnerId) || null,
    [currentBuEntries, selectedPartnerId]
  );
  const selectedPartnerMapEntries = useMemo(() => {
    if (!selectedPartner) {
      return [];
    }

    const selectedGroupKey = getPartnerGroupKey(selectedPartner);
    return currentBuEntries.filter((entry) => getPartnerGroupKey(entry) === selectedGroupKey);
  }, [currentBuEntries, selectedPartner]);
  const selectedPartnerMapGroups = useMemo(
    () => new Set(selectedPartnerMapEntries.map(getMapGroup)),
    [selectedPartnerMapEntries]
  );
  const showHomeView = !selectedBuId && !selectedPartner;

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
    if (session?.role !== "admin" && managerOpen) {
      setManagerOpen(false);
      setManagerMode("create");
      setManagerForm(createManagerDraft());
      setManagerError("");
      setManagerSaving(false);
    }
  }, [managerOpen, session]);

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
      setBrowsePath("");
    }
  }, [businessUnits, selectedBuId]);

  useEffect(() => {
    if (selectedPartnerId && !currentBuEntries.some((entry) => entry.id === selectedPartnerId)) {
      setSelectedPartnerId("");
      setBrowsePath("");
    }
  }, [currentBuEntries, selectedPartnerId]);

  useEffect(() => {
    const normalizedQuery = searchQuery.trim();

    if (normalizedQuery.length < 2) {
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
  }, [searchQuery, selectedPartner]);

  useEffect(() => {
    if (!selectedPartner) {
      setBrowserState(EMPTY_BROWSER_STATE);
      setFilePreviewState(EMPTY_FILE_PREVIEW_STATE);
      return undefined;
    }

    let cancelled = false;
    setFilePreviewState(EMPTY_FILE_PREVIEW_STATE);

    setBrowserState((previous) => ({
      ...previous,
      loading: true,
      error: ""
    }));

    listArchive(selectedPartner.id, browsePath)
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setBrowserState({
          loading: false,
          error: "",
          currentPath: String(payload?.currentPath || ""),
          relativePath: String(payload?.relativePath || ""),
          parentRelativePath: String(payload?.parentRelativePath || ""),
          rootPath: String(payload?.rootPath || ""),
          items: Array.isArray(payload?.items) ? payload.items : []
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setBrowserState({
          loading: false,
          error: error.message || "Unable to load this partner.",
          currentPath: "",
          relativePath: "",
          parentRelativePath: "",
          rootPath: "",
          items: []
        });
      });

    return () => {
      cancelled = true;
    };
  }, [browsePath, selectedPartner]);

  function clearSearchState() {
    setFileSearchValue("");
    setFilePreviewState(EMPTY_FILE_PREVIEW_STATE);
    setSearchState({
      loading: false,
      error: "",
      query: "",
      results: []
    });
  }

  async function saveDirectoryData(nextEntries, nextBusinessUnits = savedBusinessUnits) {
    const response = await fetch(DIRECTORY_DATA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
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

  function handleClientLogin() {
    setSession({
      role: "client",
      username: "portal-user"
    });
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

    setSession({
      role: "admin",
      username: payload.username || String(credentials?.username || "").trim().toLowerCase() || "admin"
    });
  }

  function handleOpenCreateManager() {
    if (!isAdmin) {
      return;
    }

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

  function handleManagerFieldChange(field, value) {
    setManagerForm((previousManagerForm) => ({
      ...previousManagerForm,
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
        setBrowsePath("");
      }

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
        setBrowsePath("");
      }

      clearSearchState();
      handleCloseManager();
    } catch (error) {
      setManagerError(error.message || t("removePartnerError", "Unable to remove the partner right now."));
      setManagerSaving(false);
    }
  }

  function handleLogout() {
    setSession(null);
    setSelectedBuId("");
    setSelectedPartnerId("");
    setBrowsePath("");
    clearSearchState();
    setMenuOpen(false);
    handleCloseManager();
  }

  function handleReturnHome() {
    setSelectedBuId("");
    setSelectedPartnerId("");
    setBrowsePath("");
    clearSearchState();
    setMenuOpen(false);
  }

  function handleSelectBusinessUnit(businessUnitId) {
    setSelectedBuId(businessUnitId);
    setSelectedPartnerId("");
    setBrowsePath("");
    clearSearchState();
  }

  function handleSelectPartner(entry) {
    const groupKey = getPartnerGroupKey(entry);
    const matchingEntries = entries.filter((candidate) => getPartnerGroupKey(candidate) === groupKey);
    const preferredEntry = getPreferredPartnerEntry(matchingEntries, activeMapGroup) || entry;

    setSelectedBuId(preferredEntry.bu);
    setSelectedPartnerId(preferredEntry.id);
    setBrowsePath("");
    clearSearchState();
  }

  function handleSelectPartnerMapGroup(mapGroup) {
    if (!selectedPartner) {
      return;
    }

    const nextPartner = selectedPartnerMapEntries.find(
      (entry) => getMapGroup(entry) === mapGroup
    );

    setActiveMapGroup(mapGroup);

    if (nextPartner && nextPartner.id !== selectedPartner.id) {
      setSelectedPartnerId(nextPartner.id);
      setBrowsePath("");
      clearSearchState();
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
    openFilePreview({
      entryId: result.entryId,
      relativePath: result.relativePath,
      source: "search",
      fileName: result.fileName,
      size: result.size,
      modifiedAt: result.modifiedAt
    });
  }

  function handleBrowseSearchResult(result) {
    setSelectedBuId(result.bu);
    setSelectedPartnerId(result.entryId);
    setBrowsePath(result.directory || "");
    setFilePreviewState(EMPTY_FILE_PREVIEW_STATE);
    clearSearchState();
  }

  function handleOpenFile(item) {
    if (!selectedPartner) {
      return;
    }

    openFilePreview({
      entryId: selectedPartner.id,
      relativePath: item.relativePath,
      source: "directory",
      fileName: item.name,
      size: item.size,
      modifiedAt: item.modifiedAt
    });
  }

  function handleCloseFilePreview() {
    setFilePreviewState(EMPTY_FILE_PREVIEW_STATE);
  }

  if (!session) {
    return (
      <LoginScreen
        language={language}
        onAdminLogin={handleAdminLogin}
        onLogin={handleClientLogin}
        onToggleTheme={() =>
          setThemeMode((previousThemeMode) =>
            previousThemeMode === "dark" ? "light" : "dark"
          )
        }
        onSelectLanguage={setLanguage}
        themeMode={themeMode}
        t={t}
      />
    );
  }

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="topbar-title">
          <img className="topbar-logo" src={`${assetBase}/groupecatlogo.png`} alt="Groupecat" />
          <div className="topbar-heading-copy">
            <strong>{t("appHeaderTitle", "ACCESS TO PRODUCTION FILES")}</strong>
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
          {isAdmin ? (
            <button className="secondary-button" type="button" onClick={handleOpenCreateManager}>
              <span>{t("openManager", "Add New Partner")}</span>
            </button>
          ) : null}
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
              className={`icon-action-button ${menuOpen ? "active" : ""}`.trim()}
              type="button"
              aria-label="Open menu"
              title="Open menu"
              onClick={() => setMenuOpen((previousMenuOpen) => !previousMenuOpen)}
            >
              <AppIcon type="menu" />
            </button>

            {menuOpen ? (
              <div className="menu-popover">
                {isAdmin ? (
                  <button className="menu-item" type="button" onClick={handleOpenCreateManager}>
                    <AppIcon type="plus" />
                    <span>{t("openManager", "Add New Partner")}</span>
                  </button>
                ) : null}
                <button className="menu-item" type="button">
                  <AppIcon type="help" />
                  <span>Help</span>
                </button>
                <button className="menu-item" type="button" onClick={handleLogout}>
                  <AppIcon type="logout" />
                  <span>{t("logout", "Logout")}</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="shell-body">
        {showHomeView ? (
          <>
            <section className="bu-strip">
              <div className="panel-header">
                <div>
                  <strong>Select partner by BU</strong>
                </div>
                <small>{businessUnits.length} business units</small>
              </div>

              <div className="bu-strip-grid">
                {businessUnits.map((businessUnit) => (
                  <button
                    key={businessUnit.id}
                    type="button"
                    className="bu-tile"
                    style={getBuVisualStyle(businessUnit.id)}
                    onClick={() => handleSelectBusinessUnit(businessUnit.id)}
                  >
                    <span className="bu-flag">{businessUnit.flag || businessUnit.label}</span>
                    <strong>{businessUnit.label}</strong>
                    <small>{businessUnit.name}</small>
                  </button>
                ))}
              </div>
            </section>

            <SearchPanel
              query={fileSearchValue}
              setQuery={setFileSearchValue}
              t={t}
            />

            {searchState.query ? (
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
          </>
        ) : null}

        {selectedBuId && !selectedPartner ? (
          <BusinessUnitDirectory
            businessUnit={currentBusinessUnit}
            entries={filteredBuEntries}
            partnerSearchValue={partnerSearchValue}
            setPartnerSearchValue={setPartnerSearchValue}
            activeDirection={activeDirection}
            setActiveDirection={setActiveDirection}
            onBrowsePartner={handleSelectPartner}
            t={t}
          />
        ) : null}

        {selectedPartner ? (
          <section className="partner-focus" style={getBuVisualStyle(selectedPartner.bu)}>
            <div className="focused-header">
              <div>
                <strong>{selectedPartner.label}</strong>
                <ContactValue
                  value={selectedPartner.backup}
                  fallback={t("contactUnavailable", "Contact not available")}
                />
              </div>

              <div className="focused-actions">
                {isAdmin ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => handleOpenEditManager(selectedPartner)}
                  >
                    <span>{t("editEntry", "Edit")}</span>
                  </button>
                ) : null}
                <button className="secondary-button" type="button" onClick={() => setSelectedPartnerId("")}>
                  <AppIcon type="back" />
                  <span>{t("backToList", "Back to list")}</span>
                </button>
              </div>
            </div>

            <PartnerFileControls
              activeMapGroup={getMapGroup(selectedPartner)}
              fileSearchValue={fileSearchValue}
              mapGroups={selectedPartnerMapGroups}
              onSelectMapGroup={handleSelectPartnerMapGroup}
              setFileSearchValue={setFileSearchValue}
              t={t}
            />

            {searchState.query ? (
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
              filePreviewState={filePreviewState}
              onBrowse={setBrowsePath}
              onClosePreview={handleCloseFilePreview}
              onOpenFile={handleOpenFile}
              selectedPartner={selectedPartner}
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
          onSubmit={handleManagerSubmit}
          open={managerOpen}
          saving={managerSaving}
          t={t}
          values={managerForm}
        />
      ) : null}
    </div>
  );
}

function BusinessUnitDirectory({
  businessUnit,
  entries,
  partnerSearchValue,
  setPartnerSearchValue,
  activeDirection,
  setActiveDirection,
  onBrowsePartner,
  t
}) {
  const businessUnitTitle = [businessUnit?.label || "BU", businessUnit?.name || "Business unit"]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="bu-directory" style={getBuVisualStyle(businessUnit?.id)}>
      <div className="bu-directory-hero">
        <div className="bu-directory-copy">
          <span className="bu-pill bu-pill-large">
            <span>{businessUnit?.flag || businessUnit?.label || "BU"}</span>
          </span>
          <strong>{businessUnitTitle}</strong>
        </div>
      </div>

      <section className="partners-panel">
        <div className="panel-header">
          <div>
            <strong>Partners</strong>
          </div>
          <small>{entries.length} partners</small>
        </div>

        <div className="directory-controls">
          <div className="search-input-shell partner-search-shell">
            <AppIcon type="search" />
            <input
              type="search"
              value={partnerSearchValue}
              placeholder={t("searchPartnerPlaceholder", "Search partner")}
              onChange={(event) => setPartnerSearchValue(event.target.value)}
            />
          </div>

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

        </div>

        {entries.length ? (
          <div className="partner-grid">
            {entries.map((entry) => (
              <button
                className="partner-grid-card"
                key={entry.id}
                type="button"
                style={getBuVisualStyle(entry.bu)}
                onClick={() => onBrowsePartner(entry)}
              >
                <strong>{entry.label}</strong>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title={t("noEntries", "No partners found.")}
            detail="Try another filter."
          />
        )}
      </section>
    </section>
  );
}

function LoginScreen({
  language,
  onAdminLogin,
  onLogin,
  onSelectLanguage,
  onToggleTheme,
  themeMode,
  t
}) {
  const assetBase = process.env.PUBLIC_URL || "";
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState("");

  async function handleAdminSubmit(event) {
    event.preventDefault();
    setAdminBusy(true);
    setAdminError("");

    try {
      await onAdminLogin({
        username: adminUsername,
        password: adminPassword
      });
    } catch (error) {
      setAdminError(error.message || t("loginErrorAdmin", "Admin access details are not correct."));
      setAdminBusy(false);
    }
  }

  return (
    <div className="login-page">
      <header className="login-header">
        <a
          className="login-brand login-brand-left"
          href="https://www.groupecat.com/"
          target="_blank"
          rel="noreferrer"
          aria-label="Open Groupecat website"
        >
          <img src={`${assetBase}/groupecatlogo.png`} alt="Groupecat logo" />
        </a>

        <div className="login-controls">
          <LanguageDropdown
            className="login-language-dropdown"
            currentLanguageId={language}
            languages={LANGUAGES}
            onSelect={onSelectLanguage}
          />
          <ThemeToggle
            className="login-theme-toggle"
            themeMode={themeMode}
            onToggle={onToggleTheme}
            label={themeMode === "dark" ? t("lightMode", "Light mode") : t("darkMode", "Dark mode")}
          />
          <button
            className={`login-version-button ${adminOpen ? "active" : ""}`.trim()}
            type="button"
            aria-pressed={adminOpen}
            onClick={() => {
              setAdminOpen((previousAdminOpen) => !previousAdminOpen);
              setAdminError("");
            }}
          >
            <span className="login-version-label">{t("loginVersion", "Version 2.0")}</span>
          </button>
        </div>
      </header>

      <main className="login-stage">
        <section className="login-hero">
          <h1>{t("appHeaderTitle", "ACCESS TO PRODUCTION FILES")}</h1>
          <button className="primary-button login-button" type="button" onClick={onLogin}>
            Login
          </button>
        </section>
      </main>

      {adminOpen ? (
        <div className="admin-login-overlay" role="presentation" onClick={() => setAdminOpen(false)}>
          <section
            className="admin-login-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-login-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="admin-login-copy">
              <span className="version-chip">{t("adminMode", "Admin mode")}</span>
              <strong id="admin-login-title">{t("adminAccessTitle", "Admin access")}</strong>
              <p>{t("adminWelcomeCopy", "Use your admin credentials to manage links and access the portal tools.")}</p>
            </div>

            <form className="admin-login-form" onSubmit={handleAdminSubmit}>
              <label>
                <span>{t("userId", "UserId")}</span>
                <input
                  autoComplete="username"
                  type="text"
                  value={adminUsername}
                  placeholder={t("userIdPlaceholder", "Enter your UserId")}
                  onChange={(event) => setAdminUsername(event.target.value)}
                />
              </label>

              <label>
                <span>{t("passwordLabel", "Password")}</span>
                <input
                  autoComplete="current-password"
                  type="password"
                  value={adminPassword}
                  placeholder={t("passwordPlaceholder", "Enter your password")}
                  onChange={(event) => setAdminPassword(event.target.value)}
                />
              </label>

              {adminError ? <div className="form-error">{adminError}</div> : null}

              <div className="admin-login-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setAdminOpen(false);
                    setAdminError("");
                  }}
                >
                  {t("backToClientLogin", "Back to client login")}
                </button>
                <button className="primary-button" type="submit" disabled={adminBusy}>
                  {adminBusy ? "Signing in..." : t("signIn", "Sign in")}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <footer className="login-footer">
        <a
          className="login-brand login-brand-right"
          href="https://www.hcltech.com/"
          target="_blank"
          rel="noreferrer"
          aria-label="Open HCL website"
        >
          <div className="hcl-mark">
            <span>{t("poweredManagedBy", "Powered and maintained by")}</span>
            <img src={`${assetBase}/hcltechlogo.png`} alt="HCL logo" />
          </div>
        </a>
      </footer>
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
        <div className="panel-header manager-header">
          <div className="manager-header-copy">
            <span className="version-chip">
              {mode === "edit" ? t("editEntry", "Edit") : t("openManager", "Add New Partner")}
            </span>
            <strong id="manager-title">{t("managerTitle", "Add New Partner")}</strong>
            <p>{t("managerCopy", "Changes are saved through the directory data service and are available to the portal immediately.")}</p>
          </div>

          <button className="secondary-button compact-button" type="button" onClick={onClose}>
            {t("cancel", "Cancel")}
          </button>
        </div>

        <form className="manager-form" onSubmit={onSubmit}>
          <label>
            <span>{t("businessUnit", "Business unit")}</span>
            <select value={values.bu} onChange={(event) => onChange("bu", event.target.value)}>
              <option value="">Select BU</option>
              {businessUnits.map((businessUnit) => (
                <option key={businessUnit.id} value={businessUnit.id}>
                  {businessUnit.label} - {businessUnit.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>{t("section", "Section")}</span>
            <select value={values.type} onChange={(event) => onChange("type", event.target.value)}>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
          </label>

          <label className="manager-field-full">
            <span>{t("label", "Label")}</span>
            <input
              type="text"
              value={values.label}
              onChange={(event) => onChange("label", event.target.value)}
            />
          </label>

          <label className="manager-field-full">
            <span>{t("url", "Path or full URL")}</span>
            <input
              type="text"
              value={values.url}
              placeholder={t("urlPlaceholder", "/B2BI_archives/... or full URL")}
              onChange={(event) => onChange("url", event.target.value)}
            />
          </label>

          <label className="manager-field-full">
            <span>{t("contact", "Backup email or note")}</span>
            <input
              type="text"
              value={values.backup}
              onChange={(event) => onChange("backup", event.target.value)}
            />
          </label>

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

function SearchPanel({ query, setQuery, t }) {
  return (
    <section className="search-panel">
      <div className="search-panel-cosmic-core" aria-hidden="true" />
      <div className="search-panel-planet search-panel-planet-one" aria-hidden="true" />
      <div className="search-panel-planet search-panel-planet-two" aria-hidden="true" />
      <div className="search-panel-planet search-panel-planet-three" aria-hidden="true" />
      <div className="search-panel-orbit search-panel-orbit-one" aria-hidden="true" />
      <div className="search-panel-orbit search-panel-orbit-two" aria-hidden="true" />
      <div className="search-panel-orbit search-panel-orbit-three" aria-hidden="true" />
      <div className="search-panel-ribbon search-panel-ribbon-left" aria-hidden="true" />
      <div className="search-panel-ribbon search-panel-ribbon-right" aria-hidden="true" />
      <div className="search-panel-spark search-panel-spark-one" aria-hidden="true" />
      <div className="search-panel-spark search-panel-spark-two" aria-hidden="true" />

      <div className="panel-header search-panel-header">
        <div>
          <strong>Search file</strong>
        </div>
      </div>

      <form className="search-form" onSubmit={(event) => event.preventDefault()}>
        <div className="search-input-shell">
          <AppIcon type="search" />
          <input
            type="search"
            value={query}
            placeholder={t("searchFilePlaceholder", "Search all production files")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </form>
    </section>
  );
}

function PartnerFileControls({
  activeMapGroup,
  fileSearchValue,
  mapGroups,
  onSelectMapGroup,
  setFileSearchValue,
  t
}) {
  return (
    <div className="partner-file-controls">
      <div className="search-input-shell partner-search-shell">
        <AppIcon type="search" />
        <input
          type="search"
          value={fileSearchValue}
          placeholder={t("searchFilePlaceholder", "Search file")}
          onChange={(event) => setFileSearchValue(event.target.value)}
        />
      </div>

      <div className="segmented-controls" aria-label="Map">
        {["amap", "bmap"].map((mapGroup) => (
          <button
            className={activeMapGroup === mapGroup ? "active" : ""}
            disabled={!mapGroups.has(mapGroup)}
            key={mapGroup}
            type="button"
            onClick={() => onSelectMapGroup(mapGroup)}
          >
            {mapGroup.toUpperCase()}
          </button>
        ))}
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
                    <span>{getBusinessUnitFlag(businessUnits, result.bu) || "BU"}</span>
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
  filePreviewState,
  onBrowse,
  onClosePreview,
  onOpenFile,
  selectedPartner,
  t
}) {
  if (browserState.loading) {
    return <EmptyState title={t("loadingDirectories", "Loading...")} detail={selectedPartner.label} />;
  }

  if (browserState.error) {
    return <EmptyState title="Directory unavailable" detail={browserState.error} tone="warning" />;
  }

  return (
    <section className="directory-browser">
      <div className="browser-bar">
        <div>
          <strong>{selectedPartner.label}</strong>
        </div>
      </div>

      <div className="browser-actions">
        {browserState.relativePath ? (
          <button
            className="secondary-button compact-button"
            type="button"
            onClick={() => onBrowse(browserState.parentRelativePath)}
          >
            <AppIcon type="back" />
            <span>Up one level</span>
          </button>
        ) : null}
      </div>

      {browserState.items.length ? (
        <div className="browser-table">
          {browserState.items.map((item) =>
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
                    <strong>{item.name}</strong>
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
                    <strong>{item.name}</strong>
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
        <path d="M4.5 7.5h15" />
        <path d="M4.5 12h15" />
        <path d="M4.5 16.5h15" />
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

  if (type === "help") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="8" />
        <path d="M9.8 9.6a2.4 2.4 0 0 1 4.4 1.35c0 1.8-2.2 2-2.2 3.4" />
        <path d="M12 17.2h.01" />
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

  return null;
}

export default App;
