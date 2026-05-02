import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  buildArchiveOpenUrl,
  getArchiveStatus,
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
const EMPTY_BROWSER_STATE = {
  loading: false,
  error: "",
  currentPath: "",
  relativePath: "",
  parentRelativePath: "",
  rootPath: "",
  items: []
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

function getSectionLabel(section, t) {
  return section === "outbound"
    ? t("extractions", "Outbound / EMIS")
    : t("annonces", "Inbound / RECU");
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

function getStatusTone(archiveStatus) {
  if (archiveStatus.loading) {
    return "neutral";
  }

  if (archiveStatus.error || !archiveStatus.configured) {
    return "warning";
  }

  return "success";
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
  const [session, setSession] = useState(() => readStoredSession());
  const [themeMode, setThemeMode] = useState(() => readStoredTheme());
  const [language, setLanguage] = useState(() => readStoredLanguage());
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedBuId, setSelectedBuId] = useState("");
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [fileSearchValue, setFileSearchValue] = useState("");
  const [browsePath, setBrowsePath] = useState("");
  const [archiveStatus, setArchiveStatus] = useState({
    loading: true,
    configured: false,
    host: "",
    rootPath: "",
    error: ""
  });
  const [searchState, setSearchState] = useState({
    loading: false,
    error: "",
    query: "",
    results: []
  });
  const [browserState, setBrowserState] = useState(EMPTY_BROWSER_STATE);
  const menuRef = useRef(null);
  const searchQuery = useDeferredValue(fileSearchValue);
  const { entries, businessUnits: savedBusinessUnits, dataMeta, loaded } = useDirectoryData();
  const businessUnits = useMemo(
    () => mergeBusinessUnits(BU_OPTIONS, savedBusinessUnits),
    [savedBusinessUnits]
  );
  const text = getText(language);
  const t = (key, fallback) => text[key] || fallback;
  const currentBusinessUnit = useMemo(
    () => businessUnits.find((businessUnit) => businessUnit.id === selectedBuId) || null,
    [businessUnits, selectedBuId]
  );
  const currentBuEntries = useMemo(
    () => (selectedBuId ? entries.filter((entry) => entry.bu === selectedBuId) : []),
    [entries, selectedBuId]
  );
  const selectedPartner = useMemo(
    () => currentBuEntries.find((entry) => entry.id === selectedPartnerId) || null,
    [currentBuEntries, selectedPartnerId]
  );
  const currentBuCounts = useMemo(
    () =>
      currentBuEntries.reduce(
        (accumulator, entry) => {
          accumulator.total += 1;
          accumulator[entry.type] = (accumulator[entry.type] || 0) + 1;

          if (entry.backup) {
            accumulator.withContact += 1;
          }

          return accumulator;
        },
        {
          total: 0,
          inbound: 0,
          outbound: 0,
          withContact: 0
        }
      ),
    [currentBuEntries]
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
    let cancelled = false;

    setArchiveStatus((previous) => ({ ...previous, loading: true, error: "" }));

    getArchiveStatus()
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setArchiveStatus({
          loading: false,
          configured: Boolean(payload?.configured),
          host: String(payload?.host || ""),
          rootPath: String(payload?.rootPath || ""),
          error: ""
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setArchiveStatus({
          loading: false,
          configured: false,
          host: "",
          rootPath: "",
          error: error.message || "Unable to reach the archive service."
        });
      });

    return () => {
      cancelled = true;
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

    searchArchive(normalizedQuery)
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
          error: error.message || "Unable to search the archive.",
          query: normalizedQuery,
          results: []
        });
      });

    return () => {
      cancelled = true;
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!selectedPartner) {
      setBrowserState(EMPTY_BROWSER_STATE);
      return undefined;
    }

    let cancelled = false;

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
          error: error.message || "Unable to load this partner directory.",
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
    setSearchState({
      loading: false,
      error: "",
      query: "",
      results: []
    });
  }

  function handleLogin() {
    setSession({
      role: "client",
      username: "portal-user"
    });
  }

  function handleLogout() {
    setSession(null);
    setSelectedBuId("");
    setSelectedPartnerId("");
    setBrowsePath("");
    clearSearchState();
    setMenuOpen(false);
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
    setSelectedBuId(entry.bu);
    setSelectedPartnerId(entry.id);
    setBrowsePath("");
    clearSearchState();
  }

  function handleOpenSearchResult(result) {
    window.open(
      buildArchiveOpenUrl(result.entryId, result.relativePath, themeMode),
      "_blank",
      "noopener,noreferrer"
    );
  }

  function handleBrowseSearchResult(result) {
    setSelectedBuId(result.bu);
    setSelectedPartnerId(result.entryId);
    setBrowsePath(result.directory || "");
    clearSearchState();
  }

  function handleOpenFile(item) {
    if (!selectedPartner) {
      return;
    }

    window.open(
      buildArchiveOpenUrl(selectedPartner.id, item.relativePath, themeMode),
      "_blank",
      "noopener,noreferrer"
    );
  }

  if (!session) {
    return (
      <LoginScreen
        language={language}
        onLogin={handleLogin}
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
          <span className="version-chip">Version 2.0</span>
          <div className="topbar-heading-copy">
            <strong>{t("appHeaderTitle", "ACCESS TO PRODUCTION FILES")}</strong>
            <small>Universal search on home. BU partner lists after selection.</small>
          </div>
        </div>

        <div className="topbar-actions">
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
            <SearchPanel
              archiveStatus={archiveStatus}
              query={fileSearchValue}
              scopeLabel={archiveStatus.rootPath || "All business units"}
              setQuery={setFileSearchValue}
              t={t}
            />

            {searchState.query ? (
              <SearchResults
                businessUnits={businessUnits}
                error={searchState.error}
                loading={searchState.loading}
                onBrowse={handleBrowseSearchResult}
                onOpen={handleOpenSearchResult}
                query={searchState.query}
                results={searchState.results}
                t={t}
              />
            ) : null}

            <section className="bu-strip">
              <div className="panel-header">
                <div>
                  <span>{t("businessUnit", "Business unit")}</span>
                  <strong>Select a partner directory by BU</strong>
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

            {!searchState.query ? (
              <section className="overview-grid">
                <MetricCard label={t("businessUnit", "Business unit")} value={String(businessUnits.length)} />
                <MetricCard label={t("partnerColumn", "Partner")} value={String(entries.length)} />
                <MetricCard
                  label="Archive root"
                  value={archiveStatus.rootPath || "Not configured"}
                  wide
                />
                <MetricCard
                  label="Data source"
                  value={loaded ? dataMeta?.source || "local-api" : "loading"}
                  wide
                />
              </section>
            ) : null}
          </>
        ) : null}

        {selectedBuId && !selectedPartner ? (
          <BusinessUnitDirectory
            businessUnit={currentBusinessUnit}
            counts={currentBuCounts}
            entries={currentBuEntries}
            onBrowsePartner={handleSelectPartner}
            onReturnHome={handleReturnHome}
            t={t}
            themeMode={themeMode}
          />
        ) : null}

        {selectedPartner ? (
          <section className="partner-focus" style={getBuVisualStyle(selectedPartner.bu)}>
            <div className="focused-header">
              <div>
                <div className="partner-focus-meta">
                  <span className="bu-pill">
                    <span>{currentBusinessUnit?.flag || ""}</span>
                    <span>{currentBusinessUnit?.label || selectedPartner.bu.toUpperCase()}</span>
                  </span>
                  <StatusBadge
                    label={getSectionLabel(selectedPartner.type, t)}
                    tone={selectedPartner.type === "outbound" ? "warning" : "success"}
                  />
                </div>
                <strong>{selectedPartner.label}</strong>
                <small>{selectedPartner.url}</small>
                <ContactValue
                  value={selectedPartner.backup}
                  fallback={t("contactUnavailable", "Contact not available")}
                />
              </div>

              <div className="focused-actions">
                <button className="secondary-button" type="button" onClick={() => setSelectedPartnerId("")}>
                  <AppIcon type="back" />
                  <span>{t("backToList", "Back to list")}</span>
                </button>
                <a
                  className="primary-button"
                  href={buildArchiveOpenUrl(selectedPartner.id, "", themeMode)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open archive
                </a>
              </div>
            </div>

            <DirectoryBrowser
              browserState={browserState}
              onBrowse={setBrowsePath}
              onOpenFile={handleOpenFile}
              selectedPartner={selectedPartner}
              t={t}
              themeMode={themeMode}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}

function BusinessUnitDirectory({
  businessUnit,
  counts,
  entries,
  onBrowsePartner,
  onReturnHome,
  t,
  themeMode
}) {
  return (
    <section className="bu-directory" style={getBuVisualStyle(businessUnit?.id)}>
      <div className="bu-directory-hero">
        <div className="bu-directory-copy">
          <span className="bu-pill bu-pill-large">
            <span>{businessUnit?.flag || ""}</span>
            <span>{businessUnit?.label || "BU"}</span>
          </span>
          <strong>{businessUnit?.name || "Business unit"}</strong>
          <p>Only partners from this business unit are shown here. Select a partner to open its archive.</p>
        </div>

        <button className="secondary-button" type="button" onClick={onReturnHome}>
          <AppIcon type="home" />
          <span>{t("home", "Home")}</span>
        </button>
      </div>

      <div className="bu-directory-summary">
        <MetricCard label={t("partnerColumn", "Partner")} value={String(counts.total)} />
        <MetricCard label={t("annonces", "Inbound / RECU")} value={String(counts.inbound)} />
        <MetricCard label={t("extractions", "Outbound / EMIS")} value={String(counts.outbound)} />
        <MetricCard label="Contacts ready" value={`${counts.withContact}/${counts.total || 0}`} />
      </div>

      <section className="partners-panel">
        <div className="panel-header">
          <div>
            <span>Partner directory</span>
            <strong>{businessUnit?.name || "Business unit"}</strong>
          </div>
          <small>{entries.length} partners</small>
        </div>

        {entries.length ? (
          <div className="partner-list">
            {entries.map((entry) => (
              <article className="partner-list-row" key={entry.id} style={getBuVisualStyle(entry.bu)}>
                <div className="partner-list-main">
                  <div className="partner-list-heading">
                    <div className="partner-list-identity">
                      <span className="bu-flag partner-list-flag">{businessUnit?.flag || businessUnit?.label || "BU"}</span>
                      <div>
                        <strong>{entry.label}</strong>
                        <div className="partner-list-meta">
                          <span>{businessUnit?.label || entry.bu.toUpperCase()}</span>
                          <StatusBadge
                            label={getSectionLabel(entry.type, t)}
                            tone={entry.type === "outbound" ? "warning" : "success"}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="partner-list-detail">
                    <span>Archive path</span>
                    <a
                      className="detail-link"
                      href={buildArchiveOpenUrl(entry.id, "", themeMode)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {entry.url}
                    </a>
                  </div>

                  <div className="partner-list-detail">
                    <span>Contact</span>
                    <ContactValue
                      value={entry.backup}
                      fallback={t("contactUnavailable", "Not available")}
                    />
                  </div>
                </div>

                <div className="partner-list-actions">
                  <a
                    className="secondary-button compact-button"
                    href={buildArchiveOpenUrl(entry.id, "", themeMode)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open archive
                  </a>
                  <button
                    className="primary-button compact-button"
                    type="button"
                    onClick={() => onBrowsePartner(entry)}
                  >
                    Browse folder
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title={t("noEntries", "No entries are available in this section yet.")}
            detail={t("noLinkAvailable", "No link is available here yet.")}
          />
        )}
      </section>
    </section>
  );
}

function LoginScreen({
  language,
  onLogin,
  onSelectLanguage,
  onToggleTheme,
  themeMode,
  t
}) {
  const assetBase = process.env.PUBLIC_URL || "";

  return (
    <div className="login-page">
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
          currentLanguageId={language}
          languages={LANGUAGES}
          onSelect={onSelectLanguage}
        />
        <ThemeToggle
          themeMode={themeMode}
          onToggle={onToggleTheme}
          label={themeMode === "dark" ? t("lightMode", "Light mode") : t("darkMode", "Dark mode")}
        />
      </div>

      <div className="login-layout">
        <section className="login-hero">
          <span className="version-chip">Version 2.0</span>
          <span className="login-kicker">Unix archive portal</span>
          <h1>{t("appHeaderTitle", "ACCESS TO PRODUCTION FILES")}</h1>
          <p>
            Browse configured partner folders from the central archive, switch by business unit,
            and keep file access focused on the right partner directory.
          </p>

          <div className="login-pill-row">
            <span className="login-pill">Universal search on home</span>
            <span className="login-pill">BU-specific partner directories</span>
            <span className="login-pill">Direct archive access</span>
          </div>
        </section>

        <section className="login-panel">
          <span className="login-kicker">Session</span>
          <strong>Client access</strong>
          <p>Enter the portal to browse business-unit partner archives.</p>
          <button className="primary-button login-button" type="button" onClick={onLogin}>
            Login
          </button>
        </section>
      </div>

      <a
        className="login-brand login-brand-right"
        href="https://www.hcltech.com/"
        target="_blank"
        rel="noreferrer"
        aria-label="Open HCL website"
      >
        <div className="hcl-mark">
          <span>Powered and maintained by</span>
          <img src={`${assetBase}/hcltechlogo.png`} alt="HCL logo" />
        </div>
      </a>
    </div>
  );
}

function SearchPanel({ archiveStatus, query, scopeLabel, setQuery, t }) {
  return (
    <section className="search-panel">
      <div className="search-panel-orbit search-panel-orbit-one" aria-hidden="true" />
      <div className="search-panel-orbit search-panel-orbit-two" aria-hidden="true" />
      <div className="search-panel-orbit search-panel-orbit-three" aria-hidden="true" />
      <div className="search-panel-ribbon search-panel-ribbon-left" aria-hidden="true" />
      <div className="search-panel-ribbon search-panel-ribbon-right" aria-hidden="true" />
      <div className="search-panel-spark search-panel-spark-one" aria-hidden="true" />
      <div className="search-panel-spark search-panel-spark-two" aria-hidden="true" />

      <div className="panel-header search-panel-header">
        <div>
          <span>Universal archive search</span>
          <strong>{scopeLabel}</strong>
        </div>
        <StatusBadge
          label={
            archiveStatus.loading
              ? "Connecting"
              : archiveStatus.configured
                ? "Archive online"
                : "Archive offline"
          }
          tone={getStatusTone(archiveStatus)}
        />
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

      <div className="search-meta">
        <small>{archiveStatus.rootPath || archiveStatus.error || "Archive root not configured."}</small>
      </div>
    </section>
  );
}

function SearchResults({
  businessUnits,
  error,
  loading,
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
          <span>Archive results</span>
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
                  <StatusBadge
                    label={getSectionLabel(result.type, t)}
                    tone={result.type === "outbound" ? "warning" : "success"}
                  />
                </div>
                <strong>{result.fileName}</strong>
                <p>{result.entryLabel}</p>
              </div>

              <div className="search-result-details">
                <div className="partner-list-detail">
                  <span>Folder</span>
                  <small>{result.directory || "/"}</small>
                </div>
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
                  Open file
                </button>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={() => onBrowse(result)}
                >
                  Open folder
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
    </section>
  );
}

function DirectoryBrowser({
  browserState,
  onBrowse,
  onOpenFile,
  selectedPartner,
  t,
  themeMode
}) {
  if (browserState.loading) {
    return <EmptyState title={t("loadingDirectories", "Loading directories...")} detail={selectedPartner.url} />;
  }

  if (browserState.error) {
    return <EmptyState title="Directory unavailable" detail={browserState.error} tone="warning" />;
  }

  return (
    <section className="directory-browser">
      <div className="browser-bar">
        <div>
          <span>Current path</span>
          <strong>{browserState.relativePath || "/"}</strong>
        </div>
        <small>{browserState.currentPath || selectedPartner.url}</small>
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
                    <small>{item.relativePath || "/"}</small>
                  </div>
                </div>
                <div className="browser-row-meta">
                  <span>Folder</span>
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
                    <small>{item.relativePath}</small>
                  </div>
                </div>
                <div className="browser-row-meta">
                  <span>{formatBytes(item.size)}</span>
                  <span>{formatDateTime(item.modifiedAt)}</span>
                </div>
                <div className="browser-row-actions">
                  <a
                    className="secondary-button compact-button"
                    href={buildArchiveOpenUrl(selectedPartner.id, item.relativePath, themeMode)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
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
        <EmptyState title="No files in this folder" detail={browserState.currentPath || selectedPartner.url} />
      )}
    </section>
  );
}

function MetricCard({ label, value, wide = false }) {
  return (
    <article className={`metric-card ${wide ? "metric-card-wide" : ""}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
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

function StatusBadge({ label, tone = "neutral" }) {
  return <span className={`status-badge ${tone}`.trim()}>{label}</span>;
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

  return null;
}

export default App;
