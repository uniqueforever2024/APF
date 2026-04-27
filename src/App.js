import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildBulkTemplateCsv,
  buildDirectoryPreviewUrl,
  countEntriesBySection,
  createHashRoute,
  downloadFile,
  getEntriesForSection,
  mergeBulkEntries,
  parseBulkImportCsv,
  parseHashRoute
} from "./utils";
import {
  BU_OPTIONS,
  DEFAULT_SECTION,
  LANGUAGES,
  MAP_LINKS,
  SECTION_META,
  SECTION_ORDER
} from "./config";
import { getText } from "./text";
import useDirectoryData from "./useDirectoryData";

const AUTH_STORAGE_KEY = "apf_new_auth_session_v1";
const THEME_STORAGE_KEY = "apf_new_theme_mode_v1";
const DIRECTORY_API_BASE = process.env.REACT_APP_DIRECTORY_API || "http://localhost:3001";
const AUTH_API_URL = `${DIRECTORY_API_BASE}/api/auth/login`;
const BU_COLORS = {
  fr: "#3b82f6",
  it: "#16a34a",
  pl: "#dc2626",
  ua: "#facc15",
  hr: "#ef4444",
  si: "#22c55e",
  lt: "#f59e0b",
  ib: "#8b5cf6"
};
const LANGUAGE_FLAGS = {
  de: "🇩🇪",
  fr: "🇫🇷",
  en: "🇬🇧",
  it: "🇮🇹",
  pl: "🇵🇱"
};

function readStoredSession() {
  try {
    const rawValue = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!rawValue) return null;
    const parsedValue = JSON.parse(rawValue);
    return parsedValue?.role && parsedValue?.username ? parsedValue : null;
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

function App() {
  const [route, setRoute] = useState(() => parseHashRoute(window.location.hash));
  const [session, setSession] = useState(() => readStoredSession());
  const [themeMode, setThemeMode] = useState(() => readStoredTheme());
  const [loginMode, setLoginMode] = useState("client");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerError, setManagerError] = useState("");
  const [managerNotice, setManagerNotice] = useState("");
  const [managerSaving, setManagerSaving] = useState(false);
  const [partnerSearchValue, setPartnerSearchValue] = useState("");
  const [activeEntryId, setActiveEntryId] = useState("");
  const [managerFilters, setManagerFilters] = useState({
    bu: route.bu || "fr",
    type: route.section || DEFAULT_SECTION
  });
  const [formState, setFormState] = useState({
    id: "",
    bu: route.bu || "fr",
    type: route.section || DEFAULT_SECTION,
    label: "",
    url: "",
    backup: ""
  });

  const { entries, loaded, actions } = useDirectoryData();
  const text = getText(route.lang);
  const canManage = session?.role === "admin";
  const currentBu = route.bu || "fr";
  const currentSection = SECTION_ORDER.includes(route.section)
    ? route.section
    : DEFAULT_SECTION;

  useEffect(() => {
    const handleHashChange = () => setRoute(parseHashRoute(window.location.hash));
    if (!window.location.hash) window.location.hash = "#/home/en";
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    document.body.dataset.theme = themeMode;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch (error) {
      // Keep the theme in memory if storage is unavailable.
    }
    return () => {
      delete document.body.dataset.theme;
    };
  }, [themeMode]);

  useEffect(() => {
    setManagerFilters((previous) => ({
      ...previous,
      bu: route.bu || previous.bu,
      type: currentSection || previous.type
    }));
    setFormState((previous) => ({
      ...previous,
      bu: route.bu || previous.bu,
      type: currentSection || previous.type
    }));
  }, [currentSection, route.bu]);

  useEffect(() => {
    if (!formState.id) {
      setFormState((previous) => ({
        ...previous,
        bu: managerFilters.bu,
        type: managerFilters.type
      }));
    }
  }, [formState.id, managerFilters.bu, managerFilters.type]);

  useEffect(() => {
    if (!canManage && managerOpen) setManagerOpen(false);
  }, [canManage, managerOpen]);

  const sectionCounts = useMemo(
    () => countEntriesBySection(entries, currentBu),
    [entries, currentBu]
  );

  const currentEntries = useMemo(
    () => getEntriesForSection(entries, currentBu, currentSection),
    [currentBu, currentSection, entries]
  );

  const visibleEntries = useMemo(() => {
    const term = partnerSearchValue.trim().toLowerCase();
    if (!term) return currentEntries;
    return currentEntries.filter(
      (entry) =>
        entry.label.toLowerCase().includes(term) ||
        (entry.backup || "").toLowerCase().includes(term)
    );
  }, [currentEntries, partnerSearchValue]);

  const activeEntry = useMemo(
    () => currentEntries.find((entry) => entry.id === activeEntryId) || null,
    [activeEntryId, currentEntries]
  );

  useEffect(() => {
    if (route.page !== "directory") {
      setPartnerSearchValue("");
      setActiveEntryId("");
      return;
    }
    setActiveEntryId((previousId) =>
      currentEntries.some((entry) => entry.id === previousId) ? previousId : ""
    );
  }, [currentEntries, route.page]);

  useEffect(() => {
    if (route.page !== "directory" || route.section === currentSection) return;
    navigate({
      page: "directory",
      bu: currentBu,
      lang: route.lang || "en",
      section: currentSection
    });
  }, [currentBu, currentSection, route.lang, route.page, route.section]);

  const navigate = (nextRoute) => {
    window.location.hash = createHashRoute(nextRoute);
  };

  const toggleThemeMode = () => {
    setThemeMode((previous) => (previous === "dark" ? "light" : "dark"));
  };

  const clearSessionState = () => {
    window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
    setSession(null);
    setManagerOpen(false);
    setPartnerSearchValue("");
    setActiveEntryId("");
    setLoginMode("client");
    setLoginForm({ username: "", password: "" });
    setLoginError("");
    setManagerError("");
    setManagerNotice("");
  };

  const switchLoginMode = (nextMode) => {
    setLoginMode(nextMode);
    setLoginError("");
    setLoginForm({ username: "", password: "" });
  };

  const handleLogin = async (event) => {
    event.preventDefault();

    if (loginMode === "client") {
      const nextSession = { role: "client", username: "client" };
      window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      setLoginError("");
      setLoginForm({ username: "", password: "" });
      return;
    }

    try {
      const response = await fetch(AUTH_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginForm.username,
          password: loginForm.password
        })
      });

      if (!response.ok) {
        setLoginError(text.loginErrorAdmin || "Admin access details are not correct.");
        return;
      }

      const payload = await response.json();
      const normalizedUsername = String(payload.username || loginForm.username)
        .trim()
        .toLowerCase();
      const nextSession = { role: loginMode, username: normalizedUsername };
      window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      setLoginError("");
      setLoginForm({ username: "", password: "" });
    } catch (error) {
      setLoginError(text.loginErrorAdmin || "Admin access details are not correct.");
    }
  };

  const logout = () => {
    clearSessionState();
    navigate({ page: "home", lang: route.lang || "en" });
  };

  useEffect(() => {
    if (route.page !== "logout") return;
    clearSessionState();
    navigate({ page: "home", lang: route.lang || "en" });
  }, [route.page, route.lang]);

  const openManagerForCurrentContext = () => {
    if (!canManage) return;
    setManagerFilters({ bu: route.bu || "fr", type: currentSection });
    setFormState({
      id: "",
      bu: route.bu || "fr",
      type: currentSection,
      label: "",
      url: "",
      backup: ""
    });
    setManagerError("");
    setManagerNotice("");
    setManagerOpen(true);
  };

  const submitEntry = async (event) => {
    event.preventDefault();
    if (!canManage || !formState.label.trim() || !formState.url.trim()) return;

    setManagerSaving(true);
    setManagerError("");
    setManagerNotice("");

    try {
      if (formState.id) {
        await actions.updateEntry(formState.id, formState);
      } else {
        await actions.addEntry(formState);
      }

      setFormState((previous) => ({
        ...previous,
        id: "",
        label: "",
        url: "",
        backup: ""
      }));
      setManagerOpen(false);
    } catch (error) {
      setManagerError(
        text.savePartnerError ||
          "Unable to save the partner right now. Please make sure the local save service is running."
      );
    } finally {
      setManagerSaving(false);
    }
  };

  const removeEntryAndClose = async (id) => {
    if (!canManage) return;
    setManagerSaving(true);
    setManagerError("");
    setManagerNotice("");

    try {
      await actions.removeEntry(id);
      setManagerOpen(false);
    } catch (error) {
      setManagerError(
        text.removePartnerError ||
          "Unable to remove the partner right now. Please make sure the local save service is running."
      );
    } finally {
      setManagerSaving(false);
    }
  };

  const editEntry = (entry) => {
    if (!canManage) return;
    setManagerFilters({ bu: entry.bu, type: entry.type });
    setFormState(entry);
    setManagerError("");
    setManagerNotice("");
    setManagerOpen(true);
  };

  const downloadBulkTemplate = () => {
    const csvContent = buildBulkTemplateCsv({
      bu: formState.bu || route.bu || "fr",
      type: formState.type || currentSection
    });
    downloadFile(
      `partner-bulk-template-${formState.bu || "fr"}-${formState.type || currentSection}.csv`,
      csvContent,
      "text/csv;charset=utf-8"
    );
    setManagerError("");
    setManagerNotice(text.bulkTemplateReady || "Bulk template downloaded.");
  };

  const importBulkFile = async (file) => {
    if (!canManage || !file) return;
    setManagerSaving(true);
    setManagerError("");
    setManagerNotice("");

    try {
      const fileText = await file.text();
      const importedEntries = parseBulkImportCsv(fileText);
      const mergedResult = mergeBulkEntries(entries, importedEntries);

      if (mergedResult.added === 0 && mergedResult.updated === 0) {
        setManagerError(
          text.bulkImportEmpty ||
            "No valid bulk rows were found. Please use the downloaded template."
        );
        return;
      }

      await actions.importEntries(mergedResult.entries);
      const successTemplate =
        text.bulkImportSuccess ||
        "Bulk import completed: {added} added, {updated} updated.";
      setManagerNotice(
        successTemplate
          .replace("{added}", String(mergedResult.added))
          .replace("{updated}", String(mergedResult.updated))
      );
    } catch (error) {
      setManagerError(
        text.bulkImportError ||
          "Unable to import the bulk file right now. Please check the template and try again."
      );
    } finally {
      setManagerSaving(false);
    }
  };

  if (!loaded) {
    return <div className="loading-screen">{text.loadingDirectories || "Loading directories..."}</div>;
  }

  if (!session) {
    return (
      <AuthView
        loginMode={loginMode}
        switchLoginMode={switchLoginMode}
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        loginError={loginError}
        handleLogin={handleLogin}
        text={text}
        route={route}
        navigate={navigate}
        themeMode={themeMode}
        toggleThemeMode={toggleThemeMode}
      />
    );
  }

  return (
    <div className="site-shell portal-shell portal-shell-modern">
      <PortalNav
        route={route}
        text={text}
        canManage={canManage}
        navigate={navigate}
        themeMode={themeMode}
        toggleThemeMode={toggleThemeMode}
        logout={logout}
        openManagerForCurrentContext={openManagerForCurrentContext}
      />

      <div className="portal-content">
        {route.page === "home" ? (
          <HomeView
            text={text}
            entries={entries}
            route={route}
            navigate={navigate}
          />
        ) : (
          <DirectoryView
            text={text}
            route={route}
            navigate={navigate}
            canManage={canManage}
            currentBu={currentBu}
            currentSection={currentSection}
            sectionCounts={sectionCounts}
            entries={entries}
            currentEntries={currentEntries}
            visibleEntries={visibleEntries}
            activeEntry={activeEntry}
            partnerSearchValue={partnerSearchValue}
            setPartnerSearchValue={setPartnerSearchValue}
            setActiveEntryId={setActiveEntryId}
            editEntry={editEntry}
          />
        )}
      </div>

      {managerOpen && canManage ? (
        <ManagerModal
          text={text}
          formState={formState}
          setFormState={setFormState}
          submitEntry={submitEntry}
          downloadBulkTemplate={downloadBulkTemplate}
          importBulkFile={importBulkFile}
          removeEntry={removeEntryAndClose}
          managerError={managerError}
          managerNotice={managerNotice}
          managerSaving={managerSaving}
          setManagerOpen={setManagerOpen}
        />
      ) : null}
    </div>
  );
}

function AuthView({
  loginMode,
  switchLoginMode,
  loginForm,
  setLoginForm,
  loginError,
  handleLogin,
  text,
  route,
  navigate,
  themeMode,
  toggleThemeMode
}) {
  const isAdmin = loginMode === "admin";
  const imageBase = process.env.PUBLIC_URL || "";
  const t = (key, fallback) => text[key] || fallback;

  return (
    <div className="site-shell auth-shell auth-shell-modern">
      <main className={`auth-clean-stage ${isAdmin ? "admin-mode" : "client-mode"}`.trim()}>
        <section className="auth-clean-card">
          <header className="auth-clean-topbar">
            <div className="auth-clean-logo">
              <img src={`${imageBase}/groupecatlogo.png`} alt="Groupe CAT" />
            </div>

            <div className="auth-clean-toptools">
              <ThemeButton themeMode={themeMode} onToggle={toggleThemeMode} text={text} />
              <LanguageSelect route={route} navigate={navigate} showLabel />
              <button
                className={`auth-version-trigger ${isAdmin ? "active" : ""}`.trim()}
                type="button"
                aria-pressed={isAdmin}
                onClick={() => switchLoginMode(isAdmin ? "client" : "admin")}
              >
                {t("loginVersion", "version 2.2")}
              </button>
            </div>
          </header>

          <div className="auth-clean-center">
            <h1 className="auth-clean-title">ACCESS TO PRODUCTION FILES</h1>

            <form className="auth-clean-form" onSubmit={handleLogin}>
              {isAdmin ? (
                <div className="auth-admin-fields">
                  <label className="auth-clean-field">
                    <span className="visually-hidden">{t("userId", "UserId")}</span>
                    <input
                      type="text"
                      autoComplete="username"
                      value={loginForm.username}
                      placeholder={t("userIdPlaceholder", "Enter your UserId")}
                      onChange={(event) =>
                        setLoginForm((previous) => ({
                          ...previous,
                          username: event.target.value
                        }))
                      }
                    />
                  </label>
                  <label className="auth-clean-field">
                    <span className="visually-hidden">{t("passwordLabel", "Password")}</span>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={loginForm.password}
                      placeholder={t("passwordPlaceholder", "Enter your password")}
                      onChange={(event) =>
                        setLoginForm((previous) => ({
                          ...previous,
                          password: event.target.value
                        }))
                      }
                    />
                  </label>
                </div>
              ) : null}

              {loginError ? <div className="form-error auth-clean-error">{loginError}</div> : null}

              <button className="button button-primary auth-clean-cta" type="submit">
                {isAdmin ? t("signIn", "Sign in") : t("loginCta", "Login")}
              </button>
            </form>
          </div>

          <div className="auth-clean-footer">
            <span>{t("poweredManagedBy", "powered and maintained by")}</span>
            <div className="auth-clean-footer-logo">
              <img src={`${imageBase}/hcltechlogo.png`} alt="HCLTech" />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function PortalNav({
  route,
  text,
  canManage,
  navigate,
  themeMode,
  toggleThemeMode,
  logout,
  openManagerForCurrentContext
}) {
  const t = (key, fallback) => text[key] || fallback;
  return (
    <nav className="portal-header">
      <button
        type="button"
        className="portal-brand"
        onClick={() => navigate({ page: "home", lang: route.lang })}
      >
        <span className="portal-brand-mark">APF</span>
        <span className="portal-brand-copy">
          <strong>{t("appHeaderTitle", "ACCESS TO PRODUCTION FILES")}</strong>
          <small>{t("quickAccess", "Quick access")}</small>
        </span>
      </button>

      <div className="portal-header-tools">
        {canManage ? (
          <button
            type="button"
            className="portal-action-button portal-action-button-primary"
            onClick={openManagerForCurrentContext}
          >
            <UiIcon type="plus" />
            <span>{t("addNew", "Add New")}</span>
          </button>
        ) : null}

        <button
          type="button"
          className={`portal-action-button ${route.page === "home" ? "active" : ""}`.trim()}
          onClick={() => navigate({ page: "home", lang: route.lang })}
        >
          <UiIcon type="home" />
          <span>{t("home", "Home")}</span>
        </button>
        <ThemeButton themeMode={themeMode} onToggle={toggleThemeMode} text={text} />
        <LanguageSelect route={route} navigate={navigate} />
        <button className="portal-action-button" type="button" onClick={logout}>
          <UiIcon type="logout" />
          <span>{t("logout", "Logout")}</span>
        </button>
      </div>
    </nav>
  );
}

function HomeView({ text, entries, route, navigate }) {
  const t = (key, fallback) => text[key] || fallback;
  const imageBase = process.env.PUBLIC_URL || "";

  return (
    <main className="home-shell home-shell-modern">
      <div className="home-copy">
        <div className="home-copy-intro">
          <span className="eyebrow">{t("productionFiles", "Production Files")}</span>
          <h1>{t("businessUnit", "Business unit")}</h1>
          <p>
            {t(
              "homeMapHint",
              "Choose a business unit from the buttons above or directly on the map."
            )}
          </p>
        </div>
        <div className="home-bu-grid">
          {BU_OPTIONS.map((bu) => {
            const total = entries.filter((entry) => entry.bu === bu.id).length;
            return (
              <button
                key={bu.id}
                className="country-card bu-card"
                style={{ "--bu-color": BU_COLORS[bu.id] || "#3b82f6" }}
                type="button"
                onClick={() =>
                  navigate({
                    page: "directory",
                    bu: bu.id,
                    lang: route.lang,
                    section: SECTION_ORDER[0]
                  })
                }
              >
                <span className="country-flag">{bu.id.toUpperCase()}</span>
                <div>
                  <h3>{bu.label}</h3>
                  <p>{bu.name}</p>
                </div>
                <span>{total}</span>
              </button>
            );
          })}
        </div>
      </div>
      <section className="home-map-stage">
        <div className="home-map-stage-header">
          <div>
            <span className="eyebrow">{t("quickAccess", "Quick access")}</span>
            <h2>{t("welcomeTitle", "Business Unit Overview")}</h2>
          </div>
          <p>{entries.length} links available</p>
        </div>
        <div className="map-panel map-panel-modern">
          <img src={`${imageBase}/Europe2.png`} alt="Europe map" />
          {MAP_LINKS.map((point) => {
            const bu = BU_OPTIONS.find((item) => item.id === point.id);
            return (
              <button
                key={point.id}
                type="button"
                className="map-point"
                style={{ top: point.top, left: point.left }}
                onClick={() =>
                  navigate({
                    page: "directory",
                    bu: point.id,
                    lang: route.lang,
                    section: SECTION_ORDER[0]
                  })
                }
              >
                {point.mapLabel || bu?.label || point.id.toUpperCase()}
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function DirectoryView({
  text,
  route,
  navigate,
  canManage,
  currentBu,
  currentSection,
  sectionCounts,
  entries,
  currentEntries,
  visibleEntries,
  activeEntry,
  partnerSearchValue,
  setPartnerSearchValue,
  setActiveEntryId,
  editEntry
}) {
  const t = (key, fallback) => text[key] || fallback;
  const currentBuMeta = BU_OPTIONS.find((bu) => bu.id === currentBu);
  const currentSectionLabel = t(
    SECTION_META[currentSection].labelKey,
    SECTION_META[currentSection].labelKey
  );

  return (
    <main className={`directory-shell directory-shell-modern ${activeEntry ? "directory-shell-preview" : ""}`.trim()}>
      <aside className="directory-sidebar">
        <div className="directory-sidebar-header">
          <span className="eyebrow">{t("businessUnit", "Business unit")}</span>
          <strong>{BU_OPTIONS.length}</strong>
        </div>
        <div className="directory-sidebar-list">
          {BU_OPTIONS.map((bu) => {
            const count = entries.filter(
              (entry) => entry.bu === bu.id && entry.type === currentSection
            ).length;
            return (
              <button
                key={bu.id}
                type="button"
                className={`directory-sidebar-button ${currentBu === bu.id ? "active" : ""}`.trim()}
                onClick={() =>
                  navigate({
                    page: "directory",
                    bu: bu.id,
                    lang: route.lang,
                    section: currentSection
                  })
                }
              >
                <span>{bu.label}</span>
                <small>{count}</small>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="directory-content">
        <div className="directory-toolbar">
          <div className="directory-toolbar-meta">
            <span className="eyebrow">{currentBuMeta?.label || currentBu.toUpperCase()}</span>
            <h1>{currentSectionLabel}</h1>
            <p>
              {visibleEntries.length} {visibleEntries.length === 1 ? "partner" : "partners"} loaded
              in this view.
            </p>
          </div>
          <div className="directory-toolbar-actions">
            <SectionTabs
              text={text}
              route={route}
              navigate={navigate}
              currentBu={currentBu}
              currentSection={currentSection}
              sectionCounts={sectionCounts}
            />

            {!activeEntry ? (
              <form
                className="directory-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (visibleEntries[0]) setActiveEntryId(visibleEntries[0].id);
                }}
              >
                <input
                  type="search"
                  value={partnerSearchValue}
                  placeholder={t("searchPartnerPlaceholder", "Search partner")}
                  onChange={(event) => setPartnerSearchValue(event.target.value)}
                />
                <button className="button button-primary" type="submit">
                  <UiIcon type="search" />
                  <span>{t("searchAction", "Search")}</span>
                </button>
              </form>
            ) : null}
          </div>
        </div>

        <div className="directory-body">
          {activeEntry ? (
            <PreviewPanel
              text={text}
              activeEntry={activeEntry}
              currentBuLabel={currentBuMeta?.label || currentBu.toUpperCase()}
              currentSectionLabel={currentSectionLabel}
              canManage={canManage}
              editEntry={editEntry}
              clearSelectedEntry={() => setActiveEntryId("")}
            />
          ) : (
            <PartnerList
              text={text}
              visibleEntries={visibleEntries}
              canManage={canManage}
              setActiveEntryId={setActiveEntryId}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function SectionTabs({ text, route, navigate, currentBu, currentSection, sectionCounts }) {
  const t = (key, fallback) => text[key] || fallback;
  return (
    <div className="section-tabs">
      {SECTION_ORDER.map((section) => (
        <button
          key={section}
          type="button"
          className={currentSection === section ? "active" : ""}
          onClick={() =>
            navigate({
              page: "directory",
              bu: currentBu,
              lang: route.lang,
              section
            })
          }
        >
          <span>{t(SECTION_META[section].labelKey, SECTION_META[section].labelKey)}</span>
          <small>{sectionCounts[section] || 0}</small>
        </button>
      ))}
    </div>
  );
}

function PartnerList({ text, visibleEntries, setActiveEntryId }) {
  const t = (key, fallback) => text[key] || fallback;

  if (visibleEntries.length === 0) {
    return (
      <div className="directory-empty-state">
        <h3>{t("noEntries", "No entries are available in this section yet.")}</h3>
        <p>{t("noLinkAvailable", "No link is available here yet.")}</p>
      </div>
    );
  }

  return (
    <div className="directory-list-grid">
      {visibleEntries.map((entry) => (
        <button
          type="button"
          className="partner-card"
          key={entry.id}
          onClick={() => setActiveEntryId(entry.id)}
        >
          <div className="partner-card-body">
            <strong>{entry.label}</strong>
            <span>{entry.backup || t("contactUnavailable", "Not available")}</span>
          </div>
          <span className="partner-card-trail" aria-hidden="true">
            <UiIcon type="arrow-right" />
          </span>
        </button>
      ))}
    </div>
  );
}

function PreviewPanel({
  text,
  activeEntry,
  currentBuLabel,
  currentSectionLabel,
  canManage,
  editEntry,
  clearSelectedEntry
}) {
  const [fileSearchValue, setFileSearchValue] = useState("");
  const [fileHighlightValue, setFileHighlightValue] = useState("");
  const [fileSearchReloadKey, setFileSearchReloadKey] = useState(0);
  const [previewTargetUrl, setPreviewTargetUrl] = useState(activeEntry.url);
  const inputRef = useRef(null);
  const t = (key, fallback) => text[key] || fallback;

  useEffect(() => {
    setFileSearchValue("");
    setFileHighlightValue("");
    setFileSearchReloadKey(0);
    setPreviewTargetUrl(activeEntry.url);
  }, [activeEntry]);

  useEffect(() => {
    const handlePreviewNavigation = (event) => {
      if (event.data?.type !== "apf-directory-location") return;
      if (event.data.context && event.data.context !== activeEntry.id) return;
      if (typeof event.data.remoteUrl === "string" && event.data.remoteUrl.trim()) {
        setPreviewTargetUrl(event.data.remoteUrl.trim());
      }
    };

    window.addEventListener("message", handlePreviewNavigation);
    return () => window.removeEventListener("message", handlePreviewNavigation);
  }, [activeEntry]);

  const previewFrameUrl = buildDirectoryPreviewUrl(previewTargetUrl || activeEntry.url, {
    highlight: fileHighlightValue,
    reloadKey: fileSearchReloadKey,
    context: activeEntry.id
  });

  const handleFileSearch = (event) => {
    event.preventDefault();
    const term = fileSearchValue.trim();
    if (!term) {
      setFileHighlightValue("");
      inputRef.current?.focus();
      return;
    }
    setFileHighlightValue(term);
    setFileSearchReloadKey(Date.now());
  };

  return (
    <div className="preview-surface">
      <div className="preview-toolbar">
        <div className="preview-toolbar-meta">
          <span className="eyebrow">{currentBuLabel} / {currentSectionLabel}</span>
          <h2>{activeEntry.label}</h2>
        </div>
        <div className="preview-toolbar-actions">
          <form className="directory-search preview-search" onSubmit={handleFileSearch}>
            <input
              ref={inputRef}
              type="search"
              value={fileSearchValue}
              placeholder={t("searchFilePlaceholder", "Search file")}
              onChange={(event) => setFileSearchValue(event.target.value)}
            />
            <button className="button button-primary" type="submit">
              <UiIcon type="search" />
              <span>{t("searchFile", "Search File")}</span>
            </button>
          </form>
          {canManage ? (
            <button className="button button-secondary" type="button" onClick={() => editEntry(activeEntry)}>
              <UiIcon type="edit" />
              <span>{t("editEntry", "Edit")}</span>
            </button>
          ) : null}
          <button className="button button-secondary" type="button" onClick={clearSelectedEntry}>
            <UiIcon type="back" />
            <span>{t("backToList", "Back to list")}</span>
          </button>
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

function ManagerModal({
  text,
  formState,
  setFormState,
  submitEntry,
  downloadBulkTemplate,
  importBulkFile,
  removeEntry,
  managerError,
  managerNotice,
  managerSaving,
  setManagerOpen
}) {
  const t = (key, fallback) => text[key] || fallback;

  return (
    <div className="manager-overlay" onClick={() => setManagerOpen(false)}>
      <section className="manager-modal section-frame" onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{t("openManager", "Add New Partner")}</span>
            <h2>{t("addPartnerTitle", "Add New Partner")}</h2>
          </div>
          <button type="button" onClick={() => setManagerOpen(false)} aria-label={t("closeManager", "Close form")}>
            x
          </button>
        </div>
        <p>{t("managerCopy", "Changes are saved through the directory data service.")}</p>

        <div className="bulk-actions">
          <button className="button button-secondary" type="button" disabled={managerSaving} onClick={downloadBulkTemplate}>
            {t("downloadTemplate", "Download template")}
          </button>
          <label className="button button-secondary import-label">
            {t("importBulk", "Import bulk")}
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={managerSaving}
              onChange={(event) => {
                const [file] = Array.from(event.target.files || []);
                if (file) importBulkFile(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>

        <form className="manager-form" onSubmit={submitEntry}>
          <label>
            {t("businessUnit", "Business unit")}
            <select
              value={formState.bu}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, bu: event.target.value }))
              }
            >
              {BU_OPTIONS.map((bu) => (
                <option key={bu.id} value={bu.id}>{bu.label}</option>
              ))}
            </select>
          </label>
          <label>
            {t("section", "Section")}
            <select
              value={formState.type}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, type: event.target.value }))
              }
            >
              {SECTION_ORDER.map((section) => (
                <option key={section} value={section}>
                  {t(SECTION_META[section].labelKey, SECTION_META[section].labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("label", "Label")}
            <input
              type="text"
              value={formState.label}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, label: event.target.value }))
              }
            />
          </label>
          <label>
            {t("url", "Path or full URL")}
            <input
              type="text"
              value={formState.url}
              placeholder={t("urlPlaceholder", "/B2BI_archives/... or full URL")}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, url: event.target.value }))
              }
            />
          </label>
          <label>
            {t("contact", "Backup email or note")}
            <input
              type="text"
              value={formState.backup}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, backup: event.target.value }))
              }
            />
          </label>

          <div className="form-actions">
            <button className="button button-primary" type="submit" disabled={managerSaving}>
              {formState.id ? t("updateEntry", "Save changes") : t("addEntry", "Add link")}
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={managerSaving}
              onClick={() =>
                setFormState((previous) => ({
                  ...previous,
                  id: "",
                  label: "",
                  url: "",
                  backup: ""
                }))
              }
            >
              {t("clear", "Clear")}
            </button>
            {formState.id ? (
              <button
                className="button button-secondary danger"
                type="button"
                disabled={managerSaving}
                onClick={() => removeEntry(formState.id)}
              >
                {t("deleteEntry", "Remove")}
              </button>
            ) : null}
          </div>
          {managerNotice ? <div className="form-notice">{managerNotice}</div> : null}
          {managerError ? <div className="form-error">{managerError}</div> : null}
        </form>
      </section>
    </div>
  );
}

function ThemeButton({ themeMode, onToggle, text }) {
  const label = themeMode === "dark" ? text.lightMode || "Light" : text.darkMode || "Dark";

  return (
    <button className="icon-button" type="button" onClick={onToggle} aria-label={label} title={label}>
      <UiIcon type={themeMode === "dark" ? "sun" : "moon"} />
    </button>
  );
}

function LanguageSelect({ route, navigate, showLabel = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const currentLanguage =
    LANGUAGES.find((language) => language.id === (route.lang || "en")) || LANGUAGES[0];

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`language-control ${open ? "open" : ""}`} ref={rootRef}>
      <button
        className={`language-trigger ${showLabel ? "with-label" : ""}`.trim()}
        type="button"
        aria-label="Language"
        title="Language"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        {showLabel ? <FlagIcon id={currentLanguage.id} /> : <UiIcon type="language" />}
        {showLabel ? <span>{currentLanguage.label}</span> : null}
      </button>
      {open ? (
        <div className="language-menu" role="menu">
          {LANGUAGES.map((language) => (
            <button
              key={language.id}
              type="button"
              role="menuitem"
              className={currentLanguage.id === language.id ? "active" : ""}
              onClick={() => {
                navigate({
                  page: route.page,
                  bu: route.bu,
                  lang: language.id,
                  section: route.section
                });
                setOpen(false);
              }}
            >
              <FlagIcon id={language.id} />
              <span>{language.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FlagIcon({ id }) {
  if (id === "en") {
    return (
      <svg className="flag-svg" viewBox="0 0 32 22" aria-hidden="true">
        <rect width="32" height="22" rx="4" fill="#012169" />
        <path d="M0 0 32 22M32 0 0 22" stroke="#fff" strokeWidth="5" />
        <path d="M0 0 32 22M32 0 0 22" stroke="#c8102e" strokeWidth="2.5" />
        <path d="M16 0v22M0 11h32" stroke="#fff" strokeWidth="7" />
        <path d="M16 0v22M0 11h32" stroke="#c8102e" strokeWidth="4" />
      </svg>
    );
  }

  const flags = {
    de: { type: "horizontal", colors: ["#000000", "#dd0000", "#ffce00"] },
    fr: { type: "vertical", colors: ["#0055a4", "#ffffff", "#ef4135"] },
    it: { type: "vertical", colors: ["#009246", "#ffffff", "#ce2b37"] },
    pl: { type: "horizontal", colors: ["#ffffff", "#dc143c"] }
  };
  const flag = flags[id] || { type: "vertical", colors: ["#4aa3ff", "#ffffff", "#0b66c3"] };
  const horizontal = flag.type === "horizontal";

  return (
    <svg className="flag-svg" viewBox="0 0 32 22" aria-hidden="true">
      {flag.colors.map((color, index) => (
        <rect
          key={`${id}-${color}`}
          x={horizontal ? 0 : (32 / flag.colors.length) * index}
          y={horizontal ? (22 / flag.colors.length) * index : 0}
          width={horizontal ? 32 : 32 / flag.colors.length}
          height={horizontal ? 22 / flag.colors.length : 22}
          fill={color}
        />
      ))}
      <rect width="32" height="22" rx="4" fill="none" stroke="rgba(0,0,0,0.22)" />
    </svg>
  );
}

function UiIcon({ type }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
    focusable: "false"
  };

  if (type === "home") {
    return (
      <svg {...commonProps}>
        <path d="M4 10.6 12 4l8 6.6" />
        <path d="M6.2 9.7v9.1h11.6V9.7" />
        <path d="M10 18.8v-5h4v5" />
      </svg>
    );
  }

  if (type === "logout") {
    return (
      <svg {...commonProps}>
        <path d="M10 5.5H7.2c-.8 0-1.4.6-1.4 1.4v10.2c0 .8.6 1.4 1.4 1.4H10" />
        <path d="M14 8.2 18.2 12 14 15.8" />
        <path d="M9.2 12h8.6" />
      </svg>
    );
  }

  if (type === "plus") {
    return (
      <svg {...commonProps}>
        <path d="M12 5.2v13.6" />
        <path d="M5.2 12h13.6" />
      </svg>
    );
  }

  if (type === "sun") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.8v2.1M12 19.1v2.1M21.2 12h-2.1M4.9 12H2.8M18.5 5.5 17 7M7 17l-1.5 1.5M18.5 18.5 17 17M7 7 5.5 5.5" />
      </svg>
    );
  }

  if (type === "moon") {
    return (
      <svg {...commonProps}>
        <path d="M15.4 3.8A8.5 8.5 0 1 0 20.2 18a7.1 7.1 0 0 1-4.8-14.2Z" />
      </svg>
    );
  }

  if (type === "search") {
    return (
      <svg {...commonProps}>
        <circle cx="10.5" cy="10.5" r="4.8" />
        <path d="M14.2 14.2 18.4 18.4" />
      </svg>
    );
  }

  if (type === "edit") {
    return (
      <svg {...commonProps}>
        <path d="m5.6 16.9-.6 3.5 3.5-.6L18 10.3l-2.9-2.9Z" />
        <path d="m14.8 4.6 2.9 2.9" />
      </svg>
    );
  }

  if (type === "back") {
    return (
      <svg {...commonProps}>
        <path d="M14.6 6.2 8.8 12l5.8 5.8" />
        <path d="M9.6 12h8.2" />
      </svg>
    );
  }

  if (type === "arrow-right") {
    return (
      <svg {...commonProps}>
        <path d="M8 5.6 14.4 12 8 18.4" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M3.8 12h16.4" />
      <path d="M12 3.8c2.1 2.2 3.2 4.9 3.2 8.2s-1.1 6-3.2 8.2c-2.1-2.2-3.2-4.9-3.2-8.2s1.1-6 3.2-8.2Z" />
    </svg>
  );
}

export default App;
