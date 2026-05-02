# APF2.0

Clean development workspace built from the active `APF_NEW` application and the sibling workspaces it actually uses.

## What this includes

- Main React APF app at the workspace root
- Database-ready directory data service with local JSON fallback
- React navigation for BU, language, sections, and archive content views
- In-app admin manager to add, edit, and remove BU-scoped archive roots instantly
- Unix archive browser backed by SSH/SFTP for partner folders under `RECU` and `EMIS`
- Dynamic home-page search that checks configured archive roots by file name
- Central DB config scaffold in `db.config.js` and `.env.example`
- Local fallback persistence with backup creation
- Bundled `DOCUMENTATION_NEW`, `SFTP_NEW`, and `CERTIFICATE_NEW` workspaces
- Central target connection defaults for production paths

## Available scripts

### `npm start`

Runs the app in development mode.

### `npm run build`

Builds the app for production.

## Notes

- The API now reads from a database when `DIRECTORY_DB_CLIENT`, host, database, and table details are configured.
- If the DB details are not present yet, the API falls back to `public/APF_NEW.json` and keeps backups in `APF_BACKUPS`.
- The live archive browser uses `ARCHIVE_SERVER_HOST`, `ARCHIVE_SERVER_USERNAME`, `ARCHIVE_SERVER_PASSWORD`, and `ARCHIVE_SERVER_ROOT_PATH` from `.env`.
- Stored partner paths are normalized to the Unix archive root so admins can paste full paths, legacy `B2BI_archives/...` paths, or partner folder names.
- Inbound paths resolve under `RECU` and outbound paths resolve under `EMIS`.
- Use `.env.example` as the template for the DB connection values you will share next.
- Linked project workspaces are now resolved from inside `APF2.0` so future development can stay in one directory.
- Default production-path links resolve to `http://frb2bcdu01.groupecat.com:8000`.
- Full URLs to other hosts are preserved as-is.
