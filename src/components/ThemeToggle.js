function ThemeToggle({ themeMode, onToggle, label, className = "" }) {
  const isDark = themeMode === "dark";

  return (
    <button
      type="button"
      className={`theme-toggle-button ${isDark ? "active" : ""} ${className}`.trim()}
      onClick={onToggle}
      aria-pressed={isDark}
      aria-label={label}
      title={label}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {isDark ? <SunIcon /> : <MoonIcon />}
      </span>
      <span className="theme-toggle-label">{label}</span>
    </button>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M15.5 3.75A8.75 8.75 0 1 0 20.25 18a7.5 7.5 0 1 1-4.75-14.25Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 2.75v2.1M12 19.15v2.1M21.25 12h-2.1M4.85 12h-2.1M18.55 5.45l-1.48 1.48M6.93 17.07l-1.48 1.48M18.55 18.55l-1.48-1.48M6.93 6.93 5.45 5.45"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default ThemeToggle;
