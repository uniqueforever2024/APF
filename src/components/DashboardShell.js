import { useEffect, useMemo, useRef, useState } from "react";
import {
  BU_OPTIONS,
  LANGUAGES,
  MAP_LINKS,
  SECTION_META,
  SECTION_ORDER
} from "../config";
import LanguageDropdown from "./LanguageDropdown";
import { buildDirectoryPreviewUrl } from "../utils";
import ThemeToggle from "./ThemeToggle";

function DashboardShell({
  route,
  text,
  navigate,
  themeMode,
  toggleThemeMode,
  canManage,
  entries,
  currentEntries,
  sectionCounts,
  visibleEntries,
  partnerSearchValue,
  setPartnerSearchValue,
  currentBu,
  currentSection,
  openManagerForCurrentContext,
  editEntry,
  logout
}) {
  const [activeEntryId, setActiveEntryId] = useState("");
  const partnerSearchInputRef = useRef(null);
  const t = (key, fallback) => text[key] || fallback;
  const currentBuMeta = BU_OPTIONS.find((bu) => bu.id === currentBu);
  const currentBuLabel = currentBuMeta?.label || currentBu.toUpperCase();
  const currentSectionLabel = t(
    SECTION_META[currentSection].labelKey,
    SECTION_META[currentSection].labelKey
  );

  useEffect(() => {
    if (route.page !== "directory" || currentEntries.length === 0) {
      setActiveEntryId("");
      return;
    }

    setActiveEntryId((previousId) => {
      if (currentEntries.some((entry) => entry.id === previousId)) {
        return previousId;
      }

      return "";
    });
  }, [currentEntries, route.page]);

  const activeEntry = useMemo(
    () => currentEntries.find((entry) => entry.id === activeEntryId) || null,
    [activeEntryId, currentEntries]
  );
  const isFocusedEntryView = Boolean(activeEntry);
  const businessUnitCounts = useMemo(
    () =>
      BU_OPTIONS.reduce((accumulator, bu) => {
        accumulator[bu.id] = entries.filter(
          (entry) => entry.bu === bu.id && entry.type === currentSection
        ).length;
        return accumulator;
      }, {}),
    [currentSection, entries]
  );
  const selectEntry = (entryId) => setActiveEntryId(entryId);
  const clearSelectedEntry = () => setActiveEntryId("");
  const focusSearchField = () => {
    partnerSearchInputRef.current?.focus();
    partnerSearchInputRef.current?.select();
  };
  const handlePartnerSearchSubmit = (event) => {
    event.preventDefault();

    if (visibleEntries[0]) {
      setActiveEntryId(visibleEntries[0].id);
    } else {
      focusSearchField();
    }
  };

  useEffect(() => {
    if (!activeEntry) {
      return;
    }

    setPartnerSearchValue("");
  }, [activeEntry, setPartnerSearchValue]);

  const goToBusinessUnit = (buId) =>
    navigate({
      page: "directory",
      bu: buId,
      lang: route.lang,
      section: SECTION_ORDER[0]
    });

  const renderBusinessUnitButton = (bu, className = "home-bu-button") => (
    <button
      key={bu.id}
      type="button"
      className={className}
      onClick={() => goToBusinessUnit(bu.id)}
    >
      <span className="home-bu-button-code">{bu.label}</span>
      <span>{bu.name}</span>
    </button>
  );

  const groupecatLogoSrc = `${process.env.PUBLIC_URL || ""}/groupecatlogo.png`;
  const themeToggleLabel =
    themeMode === "dark"
      ? t("lightMode", "Light mode")
      : t("darkMode", "Dark mode");
  const homeLabel = t("home", "Home");
  const logoutLabel = t("logout", "Logout");
  const getSectionTabTone = (sectionId) =>
    sectionId === SECTION_ORDER[0] ? "inbound" : "outbound";
  const renderSectionTabs = (className = "directory-section-tabs") => (
    <div className={className}>
      {SECTION_ORDER.map((item) => {
        const tone = getSectionTabTone(item);

        return (
          <button
            key={item}
            type="button"
            className={`tab directory-section-tab directory-section-tab-${tone} ${
              currentSection === item ? "active" : ""
            }`.trim()}
            onClick={() =>
              navigate({
                page: "directory",
                bu: currentBu,
                lang: route.lang,
                section: item
              })
            }
          >
            {t(SECTION_META[item].labelKey, SECTION_META[item].labelKey)}
            <span className="count-badge">{sectionCounts[item] || 0}</span>
          </button>
        );
      })}
    </div>
  );

  useEffect(() => {
    if (route.page !== "directory") {
      setPartnerSearchValue("");
    }
  }, [route.page, setPartnerSearchValue]);

  return (
    <div
      className={`app-shell authenticated-shell ${
        route.page === "directory" ? "authenticated-shell-directory" : ""
      }`}
    >
      <header className="app-header app-header-minimal">
        <div className="brand-block">
          <div className="brand-title-row">
            <img
              className="brand-mark"
              src={groupecatLogoSrc}
              alt="Groupecat logo"
            />
            <h1>{t("appHeaderTitle", "ACCESS TO PRODUCTION FILES")}</h1>
          </div>
        </div>
        <div className="header-actions">
          <div className="header-control-row">
            <ThemeToggle
              className="header-theme-toggle"
              themeMode={themeMode}
              onToggle={toggleThemeMode}
              label={themeToggleLabel}
            />
            <LanguageDropdown
              className="top-nav-language-dropdown header-language-dropdown"
              currentLanguageId={route.lang}
              languages={LANGUAGES}
              onSelect={(languageId) =>
                navigate({
                  page: route.page,
                  bu: route.bu,
                  lang: languageId,
                  section: route.page === "directory" ? currentSection : route.section
                })
              }
            />
          </div>
          <div className="header-command-row">
            {canManage ? (
              <button
                className="header-command-button"
                type="button"
                onClick={openManagerForCurrentContext}
              >
                <span className="header-command-icon" aria-hidden="true">
                  <HeaderActionIcon type="add" />
                </span>
                <span>{t("addNew", "Add New")}</span>
              </button>
            ) : null}
            <button
              className={`header-command-button header-command-button-icon-only ${
                route.page === "home" ? "active" : ""
              }`}
              type="button"
              onClick={() => navigate({ page: "home", lang: route.lang })}
              aria-label={homeLabel}
              title={homeLabel}
            >
              <span className="header-command-icon" aria-hidden="true">
                <HeaderActionIcon type="home" />
              </span>
            </button>
            <button
              className="header-command-button header-command-button-icon-only"
              type="button"
              onClick={logout}
              aria-label={logoutLabel}
              title={logoutLabel}
            >
              <span className="header-command-icon" aria-hidden="true">
                <HeaderActionIcon type="logout" />
              </span>
            </button>
          </div>
        </div>
      </header>

      {route.page === "home" ? (
        <main className="home-view home-view-simplified">
          <section className="home-map-panel home-map-panel-expanded">
            <div className="home-map-header">
              <div className="home-map-heading">
                <div className="eyebrow">{t("productionFiles", "Production Files")}</div>
                <h2>{t("businessUnit", "Business unit")}</h2>
                <p className="hero-copy-text">
                  {t(
                    "homeMapHint",
                    "Choose a business unit from the buttons above or directly on the map."
                  )}
                </p>
              </div>
              <div className="home-bu-actions">
                {BU_OPTIONS.map((bu) => renderBusinessUnitButton(bu))}
              </div>
            </div>

            <div className="hero-map home-map-large home-map-stage-shell">
              <div className="map-stage">
                <div className="home-map-art">
                  <img
                    src={`${process.env.PUBLIC_URL || ""}/Europe2.png`}
                    alt="Europe map"
                  />
                  {MAP_LINKS.map((point) => {
                    const bu = BU_OPTIONS.find((item) => item.id === point.id);

                    return (
                      <button
                        key={point.id}
                        type="button"
                        className="map-point"
                        style={{ top: point.top, left: point.left }}
                        aria-label={`Open ${bu ? bu.name : point.id.toUpperCase()}`}
                        onClick={() => goToBusinessUnit(point.id)}
                      >
                        {point.mapLabel || point.id.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </main>
      ) : (
        <main className="directory-layout">
          <aside className="sidebar sidebar-minimal bu-sidebar">
            <div className="section-header bu-sidebar-header">
              <h3>{t("businessUnit", "Business unit")}</h3>
              <span>{BU_OPTIONS.length}</span>
            </div>

            <div className="sidebar-section-list bu-sidebar-list">
              {BU_OPTIONS.map((bu) => (
                <button
                  key={bu.id}
                  type="button"
                  className={`sidebar-link bu-sidebar-link ${
                    currentBu === bu.id ? "active" : ""
                  }`}
                  onClick={() =>
                    navigate({
                      page: "directory",
                      bu: bu.id,
                      lang: route.lang,
                      section: currentSection
                    })
                  }
                >
                  <span className="bu-sidebar-label">{bu.label}</span>
                  <span className="count-badge">{businessUnitCounts[bu.id] || 0}</span>
                </button>
              ))}
            </div>
          </aside>

          <section
            className={`content-panel ${isFocusedEntryView ? "content-panel-focused" : ""}`.trim()}
          >
            {!isFocusedEntryView ? (
              <>
                <div className="content-toolbar content-toolbar-compact">
                  <div>
                    <div className="eyebrow">{currentBuLabel}</div>
                    <h2>{currentSectionLabel}</h2>
                    <p className="section-description">
                      {visibleEntries.length} {visibleEntries.length === 1 ? "partner" : "partners"} loaded
                      in this view.
                    </p>
                  </div>
                </div>

                <div className="directory-list-controls">
                  {renderSectionTabs("directory-section-tabs directory-section-tabs-list")}

                  <form
                    className="search-box search-box-single directory-partner-search"
                    onSubmit={handlePartnerSearchSubmit}
                  >
                    <input
                      ref={partnerSearchInputRef}
                      type="search"
                      value={partnerSearchValue}
                      placeholder={t("searchPartnerPlaceholder", "Search partner")}
                      onChange={(event) => setPartnerSearchValue(event.target.value)}
                    />
                  </form>
                </div>
              </>
            ) : null}

            {isFocusedEntryView
              ? renderSectionTabs("directory-section-tabs directory-section-tabs-focused")
              : null}

            <DirectoryWorkspace
              activeEntry={activeEntry}
              canManage={canManage}
              clearSelectedEntry={clearSelectedEntry}
              currentEntries={currentEntries}
              currentBuLabel={currentBuLabel}
              currentSectionLabel={currentSectionLabel}
              editEntry={editEntry}
              onSelectEntry={selectEntry}
              t={t}
              visibleEntries={visibleEntries}
            />
          </section>
        </main>
      )}
    </div>
  );
}

function DirectoryWorkspace({
  activeEntry,
  canManage,
  clearSelectedEntry,
  currentEntries,
  currentBuLabel,
  currentSectionLabel,
  editEntry,
  onSelectEntry,
  t,
  visibleEntries
}) {
  const isFocusedEntryView = Boolean(activeEntry);

  if (!isFocusedEntryView) {
    return (
      <div className="directory-workspace directory-workspace-list-only">
        <div className={`partner-table-shell ${canManage ? "admin-table-shell" : ""}`.trim()}>
          {visibleEntries.length === 0 ? (
            <div className="partner-table-empty-body">
              <div className="empty-state empty-state-table">
                <p>{t("noEntries", "No entries are available in this section yet.")}</p>
                <span>
                  {canManage
                    ? t("emptyHint", "Use the manager to add the first link.")
                    : t("noLinkAvailable", "No link is available here yet.")}
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="partner-table-header">
                <span>{t("partnerColumn", "Partner")}</span>
                <span>{t("supportColumn", "Contact")}</span>
              </div>

              <div className="partner-table-body">
                {visibleEntries.map((entry) => {
                  const contactValue = entry.backup || t("contactUnavailable", "Not available");

                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className="partner-table-row"
                      onClick={() => onSelectEntry(entry.id)}
                    >
                      <span className="partner-table-cell partner-table-name">{entry.label}</span>
                      <span className="partner-table-cell partner-table-contact">{contactValue}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="directory-workspace directory-workspace-single directory-workspace-focused">
      <PartnerPreviewPanel
        activeEntry={activeEntry}
        canManage={canManage}
        clearSelectedEntry={clearSelectedEntry}
        currentEntries={currentEntries}
        currentBuLabel={currentBuLabel}
        currentSectionLabel={currentSectionLabel}
        editEntry={editEntry}
        isFocusedEntryView={isFocusedEntryView}
        onSelectEntry={onSelectEntry}
        t={t}
      />
    </div>
  );
}

function PartnerPreviewPanel({
  activeEntry,
  canManage,
  clearSelectedEntry,
  currentEntries,
  currentBuLabel,
  currentSectionLabel,
  editEntry,
  isFocusedEntryView,
  onSelectEntry,
  t
}) {
  const [fileSearchValue, setFileSearchValue] = useState("");
  const [fileHighlightValue, setFileHighlightValue] = useState("");
  const [fileSearchReloadKey, setFileSearchReloadKey] = useState(0);
  const [previewTargetUrl, setPreviewTargetUrl] = useState("");
  const fileSearchInputRef = useRef(null);

  useEffect(() => {
    if (!activeEntry) {
      setFileSearchValue("");
      setFileHighlightValue("");
      setFileSearchReloadKey(0);
      setPreviewTargetUrl("");
      return;
    }

    setFileSearchValue("");
    setFileHighlightValue("");
    setFileSearchReloadKey(0);
    setPreviewTargetUrl(activeEntry.url);
  }, [activeEntry]);

  useEffect(() => {
    if (!activeEntry) {
      return undefined;
    }

    const handlePreviewNavigation = (event) => {
      if (event.data?.type !== "apf-directory-location") {
        return;
      }

      if (event.data.context && event.data.context !== activeEntry.id) {
        return;
      }

      if (typeof event.data.remoteUrl === "string" && event.data.remoteUrl.trim()) {
        setPreviewTargetUrl(event.data.remoteUrl.trim());
      }
    };

    window.addEventListener("message", handlePreviewNavigation);
    return () => {
      window.removeEventListener("message", handlePreviewNavigation);
    };
  }, [activeEntry]);

  if (!activeEntry) {
    return (
      <div className="preview-panel preview-panel-empty">
        <div className="preview-empty-state">
          <p>{t("previewTitle", "Partner preview")}</p>
          <span>{t("selectPartnerHint", "Select a partner to open it in this panel.")}</span>
        </div>
      </div>
    );
  }

  const resolvedPreviewTargetUrl = previewTargetUrl || activeEntry.url;
  const previewFrameUrl = buildDirectoryPreviewUrl(resolvedPreviewTargetUrl, {
    highlight: fileHighlightValue,
    reloadKey: fileSearchReloadKey,
    context: activeEntry.id
  });

  const handleFileSearch = (event) => {
    event.preventDefault();

    const term = fileSearchValue.trim();

    if (!term) {
      setFileHighlightValue("");
      fileSearchInputRef.current?.focus();
      fileSearchInputRef.current?.select();
      return;
    }

    setFileHighlightValue(term);
    setFileSearchReloadKey(Date.now());
  };

  return (
    <div className={`preview-panel ${isFocusedEntryView ? "preview-panel-focused" : ""}`.trim()}>
      <div className="preview-window-topbar">
        <div className="preview-window-chrome" aria-hidden="true">
          <span className="window-dot window-dot-red" />
          <span className="window-dot window-dot-amber" />
          <span className="window-dot window-dot-green" />
        </div>

        <div className="preview-window-meta">
          <span className="preview-window-label">
            {currentBuLabel} / {currentSectionLabel}
          </span>
          <strong>{activeEntry.label}</strong>
        </div>

        <div className="preview-actions">
          <div className="preview-primary-actions">
            <form
              className="search-box preview-search-box preview-topbar-search"
              onSubmit={handleFileSearch}
            >
              <input
                ref={fileSearchInputRef}
                type="search"
                value={fileSearchValue}
                placeholder={t("searchFilePlaceholder", "Search file")}
                onChange={(event) => setFileSearchValue(event.target.value)}
              />
              <button
                className="secondary-button search-file-button search-file-button-icon-only"
                type="submit"
                aria-label={t("searchFile", "Search File")}
                title={t("searchFile", "Search File")}
              >
                <span className="header-command-icon" aria-hidden="true">
                  <HeaderActionIcon type="search" />
                </span>
              </button>
            </form>
            <button
              className="secondary-button preview-back-button"
              type="button"
              onClick={clearSelectedEntry}
            >
              <span className="header-command-icon" aria-hidden="true">
                <HeaderActionIcon type="back" />
              </span>
              <span>{t("back", "Back")}</span>
            </button>
          </div>
          {canManage ? (
            <button
              className="secondary-button preview-edit-button"
              type="button"
              onClick={() => editEntry(activeEntry)}
            >
              {t("editEntry", "Edit")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="preview-frame-shell">
        <iframe
          key={`${activeEntry.id}-${fileHighlightValue}-${fileSearchReloadKey}`}
          className="preview-frame"
          src={previewFrameUrl}
          title={`${activeEntry.label} preview`}
          loading="lazy"
        />
      </div>
    </div>
  );
}

function HeaderActionIcon({ type }) {
  if (type === "home") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3.75 10.5L12 3.75l8.25 6.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M5.25 9.75V19.5a.75.75 0 0 0 .75.75h12a.75.75 0 0 0 .75-.75V9.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M10.25 20.25V14.5a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v5.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (type === "logout") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M10 5.5H7.5A1.5 1.5 0 0 0 6 7v10a1.5 1.5 0 0 0 1.5 1.5H10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14 8.5l4 3.5-4 3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9 12h8.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (type === "add") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 5.25v13.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M5.25 12h13.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle
          cx="12"
          cy="12"
          r="8.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (type === "search") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle
          cx="10.5"
          cy="10.5"
          r="5.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M15 15l4.25 4.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (type === "back") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M13.5 6.5L7.75 12l5.75 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8.25 12h8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return null;
}

export default DashboardShell;
