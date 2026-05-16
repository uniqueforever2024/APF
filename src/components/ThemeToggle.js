import AssetIcon from "./IconAsset";

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
        <AssetIcon name={isDark ? "moon" : "sun"} />
      </span>
    </button>
  );
}

export default ThemeToggle;
