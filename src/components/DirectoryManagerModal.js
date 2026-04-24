import { BU_OPTIONS, SECTION_META, SECTION_ORDER } from "../config";

function DirectoryManagerModal({
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
      <div className="manager-panel manager-panel-form" onClick={(event) => event.stopPropagation()}>
        <div className="manager-header">
          <h2>{t("addPartnerTitle", "Add New Partner")}</h2>
          <button
            className="modal-close-button"
            type="button"
            aria-label={t("closeManager", "Close form")}
            title={t("closeManager", "Close form")}
            onClick={() => setManagerOpen(false)}
          >
            x
          </button>
        </div>
        <p className="manager-copy">
          {t(
            "managerCopy",
            "Changes are saved through the directory data service and are available to the portal immediately."
          )}
        </p>

        <section className="manager-form-shell">
          <div className="bulk-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={managerSaving}
              onClick={downloadBulkTemplate}
            >
              {t("downloadTemplate", "Download template")}
            </button>

            <label className="secondary-button import-button">
              {t("importBulk", "Import bulk")}
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={managerSaving}
                onChange={(event) => {
                  const [file] = Array.from(event.target.files || []);

                  if (file) {
                    importBulkFile(file);
                  }

                  event.target.value = "";
                }}
              />
            </label>
          </div>

          <form className="entry-form" onSubmit={submitEntry}>
            <label>
              {t("businessUnit", "Business unit")}
              <select
                value={formState.bu}
                onChange={(event) =>
                  setFormState((previous) => ({
                    ...previous,
                    bu: event.target.value
                  }))
                }
              >
                {BU_OPTIONS.map((bu) => (
                  <option key={bu.id} value={bu.id}>
                    {bu.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              {t("section", "Section")}
              <select
                value={formState.type}
                onChange={(event) =>
                  setFormState((previous) => ({
                    ...previous,
                    type: event.target.value
                  }))
                }
              >
                {SECTION_ORDER.map((sectionType) => (
                  <option key={sectionType} value={sectionType}>
                    {t(SECTION_META[sectionType].labelKey, SECTION_META[sectionType].labelKey)}
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
                  setFormState((previous) => ({
                    ...previous,
                    label: event.target.value
                  }))
                }
              />
            </label>

            <label>
              {t("url", "Path or full URL")}
              <input
                type="text"
                value={formState.url}
                placeholder={t(
                  "urlPlaceholder",
                  "/B2BI_archives/... or full URL"
                )}
                onChange={(event) =>
                  setFormState((previous) => ({
                    ...previous,
                    url: event.target.value
                  }))
                }
              />
            </label>

            <label>
              {t("contact", "Backup email or note")}
              <input
                type="text"
                value={formState.backup}
                onChange={(event) =>
                  setFormState((previous) => ({
                    ...previous,
                    backup: event.target.value
                  }))
                }
              />
            </label>

            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={managerSaving}>
                {formState.id ? t("updateEntry", "Save changes") : t("addEntry", "Add link")}
              </button>
              <button
                className="secondary-button"
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
                  className="secondary-button danger"
                  type="button"
                  disabled={managerSaving}
                  onClick={() => {
                    removeEntry(formState.id);
                  }}
                >
                  {t("deleteEntry", "Remove")}
                </button>
              ) : null}
            </div>

            {managerNotice ? <div className="manager-notice">{managerNotice}</div> : null}
            {managerError ? <div className="manager-error">{managerError}</div> : null}
          </form>
        </section>
      </div>
    </div>
  );
}

export default DirectoryManagerModal;
