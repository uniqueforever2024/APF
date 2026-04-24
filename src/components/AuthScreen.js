import { LANGUAGES } from "../config";
import LanguageDropdown from "./LanguageDropdown";
import ThemeToggle from "./ThemeToggle";

const SUPPORT_EMAIL_HREF = "mailto:HCL-EDI_TEAM@gmail.com?subject=EDI%20LC%20APF%20Support";

function AuthScreen({
  route,
  navigate,
  themeMode,
  toggleThemeMode,
  loginMode,
  switchLoginMode,
  loginForm,
  setLoginForm,
  loginError,
  handleLogin,
  text
}) {
  const t = (key, fallback) => text[key] || fallback;
  const imageBase = process.env.PUBLIC_URL || "";
  const isAdmin = loginMode === "admin";
  const versionLabel = t("loginVersion", "version 2.2");
  const welcomeBackLabel = t("clientWelcomeBack", "Welcome back").toUpperCase();
  const adminCopy = t(
    "adminWelcomeCopy",
    "Use your admin credentials to manage links and access the portal tools."
  );
  const themeToggleLabel =
    themeMode === "dark"
      ? t("lightMode", "Light mode")
      : t("darkMode", "Dark mode");

  return (
    <div className="app-shell login-shell">
      <main className="login-screen login-screen-enhanced">
        <div className="login-ambient" aria-hidden="true">
          <span className="login-orb login-orb-one" />
          <span className="login-orb login-orb-two" />
          <span className="login-orb login-orb-three" />
          <span className="login-grid-wave login-grid-wave-primary" />
          <span className="login-grid-wave login-grid-wave-secondary" />
          <span className="login-spark login-spark-one" />
          <span className="login-spark login-spark-two" />
          <span className="login-spark login-spark-three" />
          <span className="login-spark login-spark-four" />
        </div>

        <div className="login-language-floating login-control-bar">
          <ThemeToggle
            className="login-theme-toggle"
            themeMode={themeMode}
            onToggle={toggleThemeMode}
            label={themeToggleLabel}
          />
          <LanguageDropdown
            className="login-language-dropdown"
            currentLanguageId={route.lang}
            languages={LANGUAGES}
            onSelect={(languageId) =>
              navigate({
                page: route.page,
                bu: route.bu,
                lang: languageId,
                section: route.section
              })
            }
          />
        </div>

        <section className="login-center">
          <div className="login-portal login-portal-rich">
            <div className="login-portal-left">
              <div className="login-hero-top">
                <a
                  className="login-corner-brand"
                  href="https://www.groupecat.com/"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open Groupe CAT website"
                  title="Open Groupe CAT website"
                >
                  <img src={`${imageBase}/groupecatlogo.png`} alt="Group CAT logo" />
                </a>

                <button
                  type="button"
                  className="login-copy-version-button"
                  onClick={() => switchLoginMode(isAdmin ? "client" : "admin")}
                  aria-pressed={isAdmin}
                >
                  <span className="login-copy-version">{versionLabel}</span>
                </button>
              </div>

              <div className="login-copy">
                <h1>{t("loginAccessTitle", "Access to Production file")}</h1>
              </div>
            </div>

            <div className={`login-panel ${isAdmin ? "admin-mode" : "client-mode"} login-panel-rich`}>
              <div className="login-panel-stack">
                {isAdmin ? (
                  <div className="login-panel-heading">
                    <span className="login-panel-intro">{t("signIn", "Sign in")}</span>
                    <h2>{t("adminAccessTitle", "Admin access")}</h2>
                    <p>{adminCopy}</p>
                  </div>
                ) : null}

                <div className="login-card-panel login-card-panel-elevated">
                  {isAdmin ? (
                    <form className="login-form admin-form" onSubmit={handleLogin}>
                      <label className="login-field">
                        <span>{t("userId", "UserId")}</span>
                        <input
                          type="text"
                          autoComplete="username"
                          placeholder={t("userIdPlaceholder", "Enter your UserId")}
                          value={loginForm.username}
                          onChange={(event) =>
                            setLoginForm((previous) => ({
                              ...previous,
                              username: event.target.value
                            }))
                          }
                        />
                      </label>

                      <label className="login-field">
                        <span>{t("passwordLabel", "Password")}</span>
                        <input
                          type="password"
                          autoComplete="current-password"
                          placeholder={t("passwordPlaceholder", "Enter your password")}
                          value={loginForm.password}
                          onChange={(event) =>
                            setLoginForm((previous) => ({
                              ...previous,
                              password: event.target.value
                            }))
                          }
                        />
                      </label>

                      {loginError ? <div className="login-error">{loginError}</div> : null}

                      <button className="primary-button login-submit" type="submit">
                        {t("signIn", "Sign in")}
                      </button>

                      <a className="secondary-button login-submit" href={SUPPORT_EMAIL_HREF}>
                        {t("supportButton", "Email support")}
                      </a>

                      <button
                        className="inline-button login-return-button"
                        type="button"
                        onClick={() => switchLoginMode("client")}
                      >
                        {t("backToClientLogin", "back to client login")}
                      </button>
                    </form>
                  ) : (
                    <form className="login-form client-form" onSubmit={handleLogin}>
                      <div className="client-login-box">
                        <span className="client-login-title">{welcomeBackLabel}</span>
                        {loginError ? <div className="login-error">{loginError}</div> : null}
                        <button className="primary-button login-submit" type="submit">
                          {t("signIn", "Sign in")}
                        </button>
                        <a className="secondary-button login-submit" href={SUPPORT_EMAIL_HREF}>
                          {t("supportButton", "Email support")}
                        </a>
                      </div>
                    </form>
                  )}
                </div>
              </div>

              <div className="login-bottom-arc">
                <span className="login-admin-copy">
                  {t("poweredManagedBy", "powered and maintained by")}
                </span>
                <a
                  className="login-powered-link"
                  href="https://www.hcltech.com/"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open HCLTech website"
                  title="Open HCLTech website"
                >
                  <img src={`${imageBase}/hcltechlogo.png`} alt="HCLTech logo" />
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default AuthScreen;
