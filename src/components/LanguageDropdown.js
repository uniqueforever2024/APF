import { useEffect, useMemo, useRef, useState } from "react";

function LanguageDropdown({ currentLanguageId, languages, onSelect, className = "" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const currentLanguage = useMemo(
    () => languages.find((language) => language.id === currentLanguageId) || languages[0],
    [currentLanguageId, languages]
  );
  const otherLanguages = useMemo(
    () => languages.filter((language) => language.id !== currentLanguage?.id),
    [currentLanguage?.id, languages]
  );

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (!currentLanguage) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className={`language-dropdown ${open ? "open" : ""} ${className}`.trim()}
    >
      <button
        type="button"
        className="language-dropdown-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="language-flag" aria-hidden="true">
          {currentLanguage.flag}
        </span>
        <span className="language-dropdown-current">{currentLanguage.nativeLabel}</span>
        <span className="language-dropdown-caret" aria-hidden="true">
          {open ? "^" : "v"}
        </span>
      </button>

      {open ? (
        <div className="language-dropdown-menu" role="menu">
          {otherLanguages.map((language) => (
            <button
              key={language.id}
              type="button"
              className="language-dropdown-item"
              role="menuitem"
              onClick={() => {
                onSelect(language.id);
                setOpen(false);
              }}
            >
              <span className="language-flag" aria-hidden="true">
                {language.flag}
              </span>
              <span>{language.nativeLabel}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default LanguageDropdown;
