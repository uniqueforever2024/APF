# APF2.0

Clean development workspace built from the active `APF_NEW` application and the sibling workspaces it actually uses.

## What this includes

- Main React APF app at the workspace root
- Database-ready directory data service with local JSON fallback
- React navigation for BU, language, sections, and content views
- In-app directory manager to add, edit, and remove entries instantly
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
- Use `.env.example` as the template for the DB connection values you will share next.
- Linked project workspaces are now resolved from inside `APF2.0` so future development can stay in one directory.
- Default production-path links resolve to `http://frb2bcdu01.groupecat.com:8000`.
- Full URLs to other hosts are preserved as-is.
