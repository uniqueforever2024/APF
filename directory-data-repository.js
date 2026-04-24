const fs = require("fs/promises");
const path = require("path");
const {
  DATA_FILE,
  BACKUP_DIR,
  db,
  canUseDatabase
} = require("./db.config");

const SUPPORTED_CLIENTS = new Set(["mssql", "mysql", "postgres"]);
const DIRECTORY_FIELDS = ["id", "bu", "type", "label", "url", "backup"];
const BACKUP_FILE_PREFIX = "directory-data-backup-";
const MAX_BACKUP_FILES = 30;

function validateIdentifier(value, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ""))) {
    throw new Error(`${label} "${value}" contains unsupported characters.`);
  }

  return value;
}

function quoteIdentifier(client, value) {
  const identifier = validateIdentifier(value, "Identifier");

  if (client === "mysql") {
    return `\`${identifier}\``;
  }

  if (client === "mssql") {
    return `[${identifier}]`;
  }

  return `"${identifier}"`;
}

function buildQualifiedTableName(client) {
  const tableName = quoteIdentifier(client, db.table);

  if (!db.schema) {
    return tableName;
  }

  return `${quoteIdentifier(client, db.schema)}.${tableName}`;
}

function getColumnPairs() {
  const pairs = DIRECTORY_FIELDS.map((field) => ({
    field,
    column: validateIdentifier(db.columns[field], `Column for ${field}`)
  }));

  if (db.columns.updatedAt) {
    pairs.push({
      field: "updatedAt",
      column: validateIdentifier(db.columns.updatedAt, "Updated-at column")
    });
  }

  return pairs;
}

function buildSelectList(client) {
  return DIRECTORY_FIELDS.map((field) => {
    const columnName = db.columns[field];
    return `${quoteIdentifier(client, columnName)} AS ${quoteIdentifier(
      client,
      field
    )}`;
  }).join(", ");
}

function buildOrderBy(client) {
  return ["bu", "type", "label", "id"]
    .map((field) => quoteIdentifier(client, db.columns[field]))
    .join(", ");
}

function buildInsertStatement(client, tableName, columnPairs) {
  const columnList = columnPairs
    .map((pair) => quoteIdentifier(client, pair.column))
    .join(", ");

  if (client === "postgres") {
    const valuesList = columnPairs.map((_, index) => `$${index + 1}`).join(", ");
    return `INSERT INTO ${tableName} (${columnList}) VALUES (${valuesList})`;
  }

  if (client === "mysql") {
    const valuesList = columnPairs.map(() => "?").join(", ");
    return `INSERT INTO ${tableName} (${columnList}) VALUES (${valuesList})`;
  }

  const valuesList = columnPairs
    .map((_, index) => `@p${index + 1}`)
    .join(", ");

  return `INSERT INTO ${tableName} (${columnList}) VALUES (${valuesList})`;
}

function buildRows(entries) {
  const timestamp = db.columns.updatedAt ? new Date() : null;

  return entries.map((entry) => ({
    id: String(entry.id || "").trim(),
    bu: String(entry.bu || "").trim().toLowerCase(),
    type: String(entry.type || "").trim(),
    label: String(entry.label || "").trim(),
    url: String(entry.url || "").trim(),
    backup: String(entry.backup || "").trim(),
    updatedAt: timestamp
  }));
}

function normalizeStoredEntry(entry) {
  return {
    id: String(entry?.id || "").trim(),
    bu: String(entry?.bu || "").trim().toLowerCase(),
    type: String(entry?.type || "").trim(),
    label: String(entry?.label || "").trim(),
    url: String(entry?.url || "").trim(),
    backup: String(entry?.backup || "").trim()
  };
}

function buildPayload(entries, meta) {
  return {
    generatedAt: new Date().toISOString(),
    entries: entries.map(normalizeStoredEntry),
    meta
  };
}

function buildMeta(source, extra = {}) {
  return {
    source,
    activeClient: source === "database" ? db.client : "json",
    requestedClient: db.client,
    table: db.table || null,
    ...extra
  };
}

async function ensureBackupDirectory() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

function buildBackupName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${BACKUP_FILE_PREFIX}${stamp}.json`;
}

function buildBackupPayload(entries, source, extra = {}) {
  return {
    backupCreatedAt: new Date().toISOString(),
    source,
    entries: entries.map(normalizeStoredEntry),
    ...extra
  };
}

async function pruneBackupDirectory() {
  let directoryEntries = [];

  try {
    directoryEntries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  const backupFiles = directoryEntries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(BACKUP_FILE_PREFIX) &&
        entry.name.endsWith(".json")
    )
    .map((entry) => entry.name)
    .sort();
  const staleFiles = backupFiles.slice(
    0,
    Math.max(0, backupFiles.length - MAX_BACKUP_FILES)
  );

  await Promise.all(
    staleFiles.map((fileName) =>
      fs.unlink(path.join(BACKUP_DIR, fileName)).catch((error) => {
        if (error.code !== "ENOENT") {
          throw error;
        }
      })
    )
  );
}

async function writeBackupSnapshot(payload) {
  await ensureBackupDirectory();
  await fs.writeFile(
    path.join(BACKUP_DIR, buildBackupName()),
    JSON.stringify(payload, null, 2),
    "utf8"
  );
  await pruneBackupDirectory();
}

async function readJsonFileEntries() {
  try {
    const rawContent = await fs.readFile(DATA_FILE, "utf8");
    const parsedValue = JSON.parse(rawContent.replace(/^\uFEFF/, ""));
    return Array.isArray(parsedValue?.entries)
      ? parsedValue.entries.map(normalizeStoredEntry)
      : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeJsonFileEntries(entries, backupSource = "json") {
  await ensureBackupDirectory();

  const nextPayload = {
    generatedAt: new Date().toISOString(),
    entries: entries.map(normalizeStoredEntry)
  };

  const temporaryFile = `${DATA_FILE}.tmp`;

  try {
    await fs.writeFile(temporaryFile, JSON.stringify(nextPayload, null, 2), "utf8");
    await fs.rename(temporaryFile, DATA_FILE);
  } finally {
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
  }

  await writeBackupSnapshot(
    buildBackupPayload(nextPayload.entries, backupSource, {
      generatedAt: nextPayload.generatedAt
    })
  );
}

function createJsonRepository(note, source = "json") {
  const meta = buildMeta(source, {
    note: note || null
  });

  return {
    async readData() {
      const entries = await readJsonFileEntries();
      return buildPayload(entries, meta);
    },
    async writeData(entries) {
      const normalizedEntries = entries.map(normalizeStoredEntry);
      await writeJsonFileEntries(normalizedEntries, meta.source);
      return buildPayload(normalizedEntries, meta);
    },
    async getHealth() {
      return {
        ok: true,
        ...meta
      };
    },
    async close() {}
  };
}

async function createPostgresRepository() {
  const { Pool } = require("pg");
  const tableName = buildQualifiedTableName("postgres");
  const selectList = buildSelectList("postgres");
  const orderBy = buildOrderBy("postgres");
  const columnPairs = getColumnPairs();
  const insertStatement = buildInsertStatement(
    "postgres",
    tableName,
    columnPairs
  );
  const pool = new Pool({
    host: db.host,
    port: db.port || 5432,
    database: db.database,
    user: db.user || undefined,
    password: db.password || undefined,
    ssl: db.ssl ? { rejectUnauthorized: false } : false,
    min: db.poolMin,
    max: db.poolMax,
    connectionTimeoutMillis: db.connectionTimeoutMs
  });

  await pool.query(`SELECT ${selectList} FROM ${tableName} WHERE 1 = 0`);

  const meta = buildMeta("database");

  return {
    async readData() {
      const result = await pool.query(
        `SELECT ${selectList} FROM ${tableName} ORDER BY ${orderBy}`
      );

      return buildPayload(result.rows, meta);
    },
    async writeData(entries) {
      const rows = buildRows(entries);
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM ${tableName}`);

        for (const row of rows) {
          const parameters = columnPairs.map((pair) => row[pair.field]);
          await client.query(insertStatement, parameters);
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      await writeBackupSnapshot(
        buildBackupPayload(rows, "database", {
          client: db.client
        })
      );

      return buildPayload(rows, meta);
    },
    async getHealth() {
      await pool.query("SELECT 1");
      return {
        ok: true,
        ...meta
      };
    },
    async close() {
      await pool.end();
    }
  };
}

async function createMySqlRepository() {
  const mysql = require("mysql2/promise");
  const tableName = buildQualifiedTableName("mysql");
  const selectList = buildSelectList("mysql");
  const orderBy = buildOrderBy("mysql");
  const columnPairs = getColumnPairs();
  const insertStatement = buildInsertStatement("mysql", tableName, columnPairs);
  const pool = mysql.createPool({
    host: db.host,
    port: db.port || 3306,
    database: db.database,
    user: db.user || undefined,
    password: db.password || undefined,
    waitForConnections: true,
    connectionLimit: db.poolMax,
    queueLimit: 0,
    ssl: db.ssl ? {} : undefined,
    connectTimeout: db.connectionTimeoutMs
  });

  await pool.query(`SELECT ${selectList} FROM ${tableName} WHERE 1 = 0`);

  const meta = buildMeta("database");

  return {
    async readData() {
      const [rows] = await pool.query(
        `SELECT ${selectList} FROM ${tableName} ORDER BY ${orderBy}`
      );

      return buildPayload(rows, meta);
    },
    async writeData(entries) {
      const rows = buildRows(entries);
      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();
        await connection.query(`DELETE FROM ${tableName}`);

        for (const row of rows) {
          const parameters = columnPairs.map((pair) => row[pair.field]);
          await connection.query(insertStatement, parameters);
        }

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      await writeBackupSnapshot(
        buildBackupPayload(rows, "database", {
          client: db.client
        })
      );

      return buildPayload(rows, meta);
    },
    async getHealth() {
      await pool.query("SELECT 1");
      return {
        ok: true,
        ...meta
      };
    },
    async close() {
      await pool.end();
    }
  };
}

async function createMsSqlRepository() {
  const sql = require("mssql");
  const tableName = buildQualifiedTableName("mssql");
  const selectList = buildSelectList("mssql");
  const orderBy = buildOrderBy("mssql");
  const columnPairs = getColumnPairs();
  const insertStatement = buildInsertStatement("mssql", tableName, columnPairs);
  const pool = await new sql.ConnectionPool({
    server: db.host,
    port: db.port || 1433,
    database: db.database,
    user: db.user || undefined,
    password: db.password || undefined,
    pool: {
      min: db.poolMin,
      max: db.poolMax,
      idleTimeoutMillis: 30000
    },
    options: {
      encrypt: db.encrypt,
      trustServerCertificate: db.trustServerCertificate
    },
    connectionTimeout: db.connectionTimeoutMs,
    requestTimeout: db.connectionTimeoutMs
  }).connect();

  await pool
    .request()
    .query(`SELECT ${selectList} FROM ${tableName} WHERE 1 = 0`);

  const meta = buildMeta("database");

  return {
    async readData() {
      const result = await pool
        .request()
        .query(`SELECT ${selectList} FROM ${tableName} ORDER BY ${orderBy}`);

      return buildPayload(result.recordset, meta);
    },
    async writeData(entries) {
      const rows = buildRows(entries);
      const transaction = new sql.Transaction(pool);

      await transaction.begin();

      try {
        await new sql.Request(transaction).query(`DELETE FROM ${tableName}`);

        for (const row of rows) {
          const request = new sql.Request(transaction);

          columnPairs.forEach((pair, index) => {
            request.input(`p${index + 1}`, row[pair.field]);
          });

          await request.query(insertStatement);
        }

        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }

      await writeBackupSnapshot(
        buildBackupPayload(rows, "database", {
          client: db.client
        })
      );

      return buildPayload(rows, meta);
    },
    async getHealth() {
      await pool.request().query("SELECT 1");
      return {
        ok: true,
        ...meta
      };
    },
    async close() {
      await pool.close();
    }
  };
}

async function createDirectoryRepository() {
  if (!SUPPORTED_CLIENTS.has(db.client)) {
    return createJsonRepository(
      db.client === "json"
        ? "Bundled local storage is active until database details are provided."
        : `Unsupported database client "${db.client}".`
    );
  }

  if (!canUseDatabase) {
    return createJsonRepository(
      "Database settings are incomplete. Local JSON storage is active until the DB connection details are added.",
      "json-fallback"
    );
  }

  try {
    if (db.client === "postgres") {
      return await createPostgresRepository();
    }

    if (db.client === "mysql") {
      return await createMySqlRepository();
    }

    return await createMsSqlRepository();
  } catch (error) {
    console.warn(
      "Database repository initialization failed. Falling back to local JSON storage.",
      error.message
    );

    return createJsonRepository(
      `Database initialization failed: ${error.message}`,
      "json-fallback"
    );
  }
}

module.exports = {
  createDirectoryRepository
};
