const path = require("path");
const { loadEnvFile } = require("./env-loader");

loadEnvFile(path.join(__dirname, ".env"));

const ROOT_DIR = __dirname;
const PORT = Number(process.env.DIRECTORY_API_PORT || 3001);
const DATA_FILE = path.join(ROOT_DIR, "public", "APF_NEW.json");
const BUSINESS_UNITS_FILE = path.join(ROOT_DIR, "public", "APF_BUSINESS_UNITS.json");
const BACKUP_DIR = path.join(ROOT_DIR, "backups");
const PROJECT_APPS = {
  documentation: path.join(ROOT_DIR, "DOCUMENTATION_NEW"),
  sftp: path.join(ROOT_DIR, "SFTP_NEW"),
  certificate: path.join(ROOT_DIR, "CERTIFICATE_NEW")
};

const DEFAULT_DB_PORTS = {
  mssql: 1433,
  mysql: 3306,
  postgres: 5432
};

function normalizeDbClient(value) {
  const normalizedValue = String(value || "json").trim().toLowerCase();

  if (normalizedValue === "postgresql") {
    return "postgres";
  }

  if (normalizedValue === "sqlserver") {
    return "mssql";
  }

  if (normalizedValue === "mariadb") {
    return "mysql";
  }

  return normalizedValue || "json";
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  const normalizedValue = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  return fallback;
}

function parseNumber(value, fallback) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function readStringEnv(name, fallback = "") {
  const rawValue = process.env[name];

  if (rawValue === undefined) {
    return fallback;
  }

  return String(rawValue).trim();
}

function readIdentifierEnv(name, fallback, allowBlank = false) {
  const rawValue = process.env[name];

  if (rawValue === undefined) {
    return fallback;
  }

  const trimmedValue = String(rawValue).trim();

  if (!trimmedValue) {
    return allowBlank ? "" : fallback;
  }

  return trimmedValue;
}

const requestedDbClient = normalizeDbClient(process.env.DIRECTORY_DB_CLIENT);
const defaultDbPort = DEFAULT_DB_PORTS[requestedDbClient] || 0;

const db = {
  client: requestedDbClient,
  host: readStringEnv("DIRECTORY_DB_HOST"),
  port: parseNumber(process.env.DIRECTORY_DB_PORT, defaultDbPort),
  database: readStringEnv("DIRECTORY_DB_NAME"),
  user: readStringEnv("DIRECTORY_DB_USER"),
  password: readStringEnv("DIRECTORY_DB_PASSWORD"),
  schema: readIdentifierEnv(
    "DIRECTORY_DB_SCHEMA",
    requestedDbClient === "postgres" ? "public" : "",
    true
  ),
  table: readIdentifierEnv("DIRECTORY_DB_TABLE", "directory_entries"),
  ssl: parseBoolean(process.env.DIRECTORY_DB_SSL, false),
  encrypt: parseBoolean(
    process.env.DIRECTORY_DB_ENCRYPT,
    requestedDbClient === "mssql"
  ),
  trustServerCertificate: parseBoolean(
    process.env.DIRECTORY_DB_TRUST_SERVER_CERTIFICATE,
    true
  ),
  poolMin: parseNumber(process.env.DIRECTORY_DB_POOL_MIN, 0),
  poolMax: parseNumber(process.env.DIRECTORY_DB_POOL_MAX, 10),
  connectionTimeoutMs: parseNumber(
    process.env.DIRECTORY_DB_CONNECTION_TIMEOUT_MS,
    15000
  ),
  columns: {
    id: readIdentifierEnv("DIRECTORY_DB_ID_COLUMN", "id"),
    bu: readIdentifierEnv("DIRECTORY_DB_BU_COLUMN", "bu"),
    type: readIdentifierEnv("DIRECTORY_DB_TYPE_COLUMN", "type"),
    label: readIdentifierEnv("DIRECTORY_DB_LABEL_COLUMN", "label"),
    url: readIdentifierEnv("DIRECTORY_DB_URL_COLUMN", "url"),
    backup: readIdentifierEnv("DIRECTORY_DB_BACKUP_COLUMN", "backup"),
    updatedAt:
      readIdentifierEnv(
        "DIRECTORY_DB_UPDATED_AT_COLUMN",
        "updated_at",
        true
      ) || null
  }
};

const supportedDatabaseClients = ["mssql", "mysql", "postgres"];
const canUseDatabase =
  supportedDatabaseClients.includes(db.client) &&
  Boolean(db.host) &&
  Boolean(db.database) &&
  Boolean(db.table);

const directoryTarget = {
  protocol: process.env.DIRECTORY_TARGET_PROTOCOL || "http",
  host: process.env.DIRECTORY_TARGET_HOST || "frb2bcdu01.groupecat.com",
  port: String(process.env.DIRECTORY_TARGET_PORT || "8000")
};

const directoryProxyProtocol = readStringEnv("DIRECTORY_PROXY_PROTOCOL", "http") || "http";
const directoryProxyHost = readStringEnv("DIRECTORY_PROXY_HOST");
const directoryProxy = {
  protocol: directoryProxyProtocol,
  host: directoryProxyHost,
  port: String(
    process.env.DIRECTORY_PROXY_PORT ||
      (directoryProxyHost ? (directoryProxyProtocol === "https" ? "443" : "80") : "")
  ),
  username: readStringEnv("DIRECTORY_PROXY_USERNAME"),
  password: readStringEnv("DIRECTORY_PROXY_PASSWORD"),
  bypassHosts: readStringEnv("DIRECTORY_PROXY_BYPASS_HOSTS")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
};

const adminAuth = {
  username: readStringEnv("APF_ADMIN_USERNAME", "admin").toLowerCase(),
  password: readStringEnv("APF_ADMIN_PASSWORD", "admin123")
};

module.exports = {
  PORT,
  ROOT_DIR,
  DATA_FILE,
  BUSINESS_UNITS_FILE,
  BACKUP_DIR,
  PROJECT_APPS,
  db,
  canUseDatabase,
  directoryTarget,
  directoryProxy,
  adminAuth
};
