const path = require("path");
const { Client } = require("ssh2");

const posixPath = path.posix;
const SEARCH_RESULT_LIMIT = 200;
const LIST_ITEM_LIMIT = 1500;
const PREVIEW_BYTE_LIMIT = 64 * 1024;
const SECTION_DIRECTORY_MAP = {
  inbound: "RECU",
  outbound: "EMIS",
  recu: "RECU",
  emis: "EMIS",
  annonces: "RECU",
  scans: "RECU",
  annoncescarrieriod: "RECU",
  extractions: "EMIS",
  refclients: "EMIS",
  extractionannoncecarrier: "EMIS",
  integration: "EMIS",
  collas: "EMIS",
  integrationiodcarrier: "EMIS",
  impression: "EMIS",
  saisie1sap2mglots: "RECU",
  crintgsaisie1sap2mglots: "RECU",
  saisie2mglots2sap: "EMIS",
  crintgsaisie2mglots2sap: "EMIS"
};
const TEXT_FILE_EXTENSIONS = new Set([
  ".txt",
  ".log",
  ".csv",
  ".json",
  ".xml",
  ".edi",
  ".dat",
  ".err",
  ".out",
  ".md",
  ".html",
  ".htm"
]);

function isAbsoluteUrl(value) {
  return /^(https?:)?\/\//i.test(value);
}

function isHostPath(value) {
  return /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\//i.test(value);
}

function isArchiveConfigured(config) {
  return Boolean(config?.host && config?.username && config?.password);
}

function normalizeUnixPath(value) {
  const normalizedValue = String(value || "")
    .trim()
    .replace(/\\/g, "/");

  if (!normalizedValue) {
    return "/";
  }

  const candidatePath = normalizedValue.startsWith("/")
    ? normalizedValue
    : `/${normalizedValue.replace(/^\/+/, "")}`;
  const normalizedPath = posixPath.normalize(candidatePath);

  return normalizedPath.length > 1 ? normalizedPath.replace(/\/+$/, "") : normalizedPath;
}

function getSectionDirectory(type) {
  return SECTION_DIRECTORY_MAP[String(type || "").trim().toLowerCase()] || "";
}

function normalizeSectionType(type) {
  return getSectionDirectory(type) === "EMIS" ? "outbound" : "inbound";
}

function getSectionRoot(config, type) {
  const sectionDirectory = getSectionDirectory(type);

  if (!sectionDirectory) {
    return normalizeUnixPath(config.rootPath);
  }

  return normalizeUnixPath(posixPath.join(config.rootPath, sectionDirectory));
}

function normalizeArchivePath(rawValue, type, config) {
  const sectionRoot = getSectionRoot(config, type);
  const rootPath = normalizeUnixPath(config.rootPath);
  let value = String(rawValue || "")
    .trim()
    .replace(/\\/g, "/");

  if (!value) {
    return sectionRoot;
  }

  if (isAbsoluteUrl(value)) {
    try {
      const parsedUrl = new URL(value);
      value = decodeURIComponent(parsedUrl.pathname || "");
    } catch (error) {
      value = value.replace(/^https?:\/\/[^/]+/i, "");
    }
  } else if (isHostPath(value)) {
    value = value.slice(value.indexOf("/"));
  }

  value = value.replace(/[?#].*$/, "").trim();

  if (!value) {
    return sectionRoot;
  }

  const prefixedMappings = [
    [/^\/?B2BI_archives\/?/i, `${rootPath}/`],
    [/^\/?archives\/?/i, `${rootPath}/`]
  ];

  for (const [pattern, replacement] of prefixedMappings) {
    if (pattern.test(value)) {
      return normalizeUnixPath(value.replace(pattern, replacement));
    }
  }

  if (/^\/?(RECU|EMIS)(?:\/|$)/i.test(value)) {
    return normalizeUnixPath(posixPath.join(rootPath, value.replace(/^\/+/, "")));
  }

  if (value.startsWith("/")) {
    return normalizeUnixPath(value);
  }

  return normalizeUnixPath(posixPath.join(sectionRoot, value.replace(/^\.?\/*/, "")));
}

function resolveArchivePath(rootPath, relativePath = "") {
  const normalizedRootPath = normalizeUnixPath(rootPath);
  const normalizedRelativePath = String(relativePath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const targetPath = normalizeUnixPath(
    normalizedRelativePath
      ? posixPath.join(normalizedRootPath, normalizedRelativePath)
      : normalizedRootPath
  );

  if (
    targetPath !== normalizedRootPath &&
    !targetPath.startsWith(`${normalizedRootPath}/`)
  ) {
    throw new Error("Requested path is outside the configured archive root.");
  }

  return {
    rootPath: normalizedRootPath,
    targetPath,
    relativePath:
      targetPath === normalizedRootPath
        ? ""
        : posixPath.relative(normalizedRootPath, targetPath)
  };
}

function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

function escapeFindPattern(value) {
  return String(value || "").replace(/([\\*?\[\]])/g, "\\$1");
}

function connect(config) {
  return new Promise((resolve, reject) => {
    const client = new Client();

    const cleanup = () => {
      client.removeAllListeners("ready");
      client.removeAllListeners("error");
    };

    client.once("ready", () => {
      cleanup();
      resolve(client);
    });
    client.once("error", (error) => {
      cleanup();
      reject(error);
    });
    client.connect({
      host: config.host,
      port: Number(config.port) || 22,
      username: config.username,
      password: config.password,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      readyTimeout: 20000,
      tryKeyboard: false
    });
  });
}

async function withConnection(config, task) {
  if (!isArchiveConfigured(config)) {
    throw new Error("Archive server credentials are not configured.");
  }

  const client = await connect(config);

  try {
    return await task(client);
  } finally {
    client.end();
  }
}

function getSftp(client) {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(sftp);
    });
  });
}

function statPath(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (error, stats) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stats);
    });
  });
}

function readDir(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (error, list) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(Array.isArray(list) ? list : []);
    });
  });
}

function execCommand(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }

      const stdout = [];
      const stderr = [];
      let finished = false;

      stream.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
      stream.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
      stream.on("close", (code) => {
        if (finished) {
          return;
        }

        finished = true;

        if (code && code !== 0) {
          reject(
            new Error(
              Buffer.concat(stderr).toString("utf8").trim() ||
                `Remote command failed with exit code ${code}.`
            )
          );
          return;
        }

        resolve(Buffer.concat(stdout).toString("utf8"));
      });
      stream.on("error", reject);
    });
  });
}

function formatTimestamp(epochSeconds) {
  const numericValue = Number(epochSeconds);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "";
  }

  return new Date(numericValue * 1000).toISOString();
}

function formatListItem(rootPath, parentPath, item) {
  const absolutePath = normalizeUnixPath(posixPath.join(parentPath, item.filename));
  const relativePath = posixPath.relative(rootPath, absolutePath);
  const attrs = item.attrs || {};
  const isDirectory =
    typeof attrs.isDirectory === "function" ? attrs.isDirectory() : false;
  const isSymbolicLink =
    typeof attrs.isSymbolicLink === "function" ? attrs.isSymbolicLink() : false;

  return {
    name: item.filename,
    absolutePath,
    relativePath: relativePath === "." ? "" : relativePath,
    kind: isDirectory ? "directory" : isSymbolicLink ? "symlink" : "file",
    size: Number(attrs.size) || 0,
    modifiedAt: formatTimestamp(attrs.mtime)
  };
}

function sortArchiveItems(items) {
  return [...items].sort((leftItem, rightItem) => {
    if (leftItem.kind !== rightItem.kind) {
      if (leftItem.kind === "directory") {
        return -1;
      }

      if (rightItem.kind === "directory") {
        return 1;
      }
    }

    return leftItem.name.localeCompare(rightItem.name, undefined, {
      numeric: true,
      sensitivity: "base"
    });
  });
}

function getContentType(filePath) {
  const extension = posixPath.extname(filePath).toLowerCase();
  const contentTypes = {
    ".csv": "text/csv; charset=utf-8",
    ".edi": "text/plain; charset=utf-8",
    ".err": "text/plain; charset=utf-8",
    ".gz": "application/gzip",
    ".htm": "text/html; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".log": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".zip": "application/zip"
  };

  return contentTypes[extension] || "application/octet-stream";
}

function isPreviewableTextFile(filePath, size) {
  const extension = posixPath.extname(filePath).toLowerCase();

  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return true;
  }

  return !extension && Number(size) > 0 && Number(size) <= PREVIEW_BYTE_LIMIT;
}

function readPreviewChunk(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    const stream = sftp.createReadStream(remotePath, {
      start: 0,
      end: PREVIEW_BYTE_LIMIT - 1
    });

    stream.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      totalBytes += chunk.length;

      if (totalBytes >= PREVIEW_BYTE_LIMIT) {
        stream.destroy();
      }
    });
    stream.on("error", reject);
    stream.on("close", () => {
      resolve(Buffer.concat(chunks, Math.min(totalBytes, PREVIEW_BYTE_LIMIT)));
    });
  });
}

function readFullFile(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    const stream = sftp.createReadStream(remotePath);

    stream.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      totalBytes += chunk.length;
    });
    stream.on("error", reject);
    stream.on("close", () => {
      resolve(Buffer.concat(chunks, totalBytes));
    });
  });
}

function buildSearchLookup(entries) {
  return [...entries]
    .map((entry) => ({
      ...entry,
      rootPath: normalizeUnixPath(entry.rootPath || entry.url)
    }))
    .sort((leftEntry, rightEntry) => rightEntry.rootPath.length - leftEntry.rootPath.length);
}

function matchSearchEntry(entries, absolutePath) {
  return (
    entries.find(
      (entry) =>
        absolutePath === entry.rootPath || absolutePath.startsWith(`${entry.rootPath}/`)
    ) || null
  );
}

function createArchiveService(config) {
  return {
    isConfigured() {
      return isArchiveConfigured(config);
    },
    normalizeArchivePath(rawValue, type) {
      return normalizeArchivePath(rawValue, type, config);
    },
    getSectionRoot(type) {
      return getSectionRoot(config, type);
    },
    async list(rootPath, relativePath = "") {
      const resolvedPath = resolveArchivePath(rootPath, relativePath);

      return withConnection(config, async (client) => {
        const sftp = await getSftp(client);
        const directoryStats = await statPath(sftp, resolvedPath.targetPath);

        if (
          !directoryStats ||
          typeof directoryStats.isDirectory !== "function" ||
          !directoryStats.isDirectory()
        ) {
          throw new Error("The requested archive path is not a directory.");
        }

        const list = await readDir(sftp, resolvedPath.targetPath);
        const items = sortArchiveItems(
          list
            .filter((item) => item.filename !== "." && item.filename !== "..")
            .slice(0, LIST_ITEM_LIMIT)
            .map((item) => formatListItem(resolvedPath.rootPath, resolvedPath.targetPath, item))
        );

        return {
          rootPath: resolvedPath.rootPath,
          currentPath: resolvedPath.targetPath,
          relativePath: resolvedPath.relativePath,
          parentRelativePath: resolvedPath.relativePath
            ? posixPath.dirname(resolvedPath.relativePath) === "."
              ? ""
              : posixPath.dirname(resolvedPath.relativePath)
            : "",
          items
        };
      });
    },
    async search(entries, query, entryId = "") {
      const normalizedQuery = String(query || "").trim();

      if (!normalizedQuery) {
        return {
          query: "",
          total: 0,
          results: []
        };
      }

      const scopedEntries = entries
        .filter((entry) => !entryId || entry.id === entryId)
        .map((entry) => ({
          ...entry,
          rootPath: normalizeArchivePath(entry.url, entry.type, config)
        }))
        .filter((entry) => entry.rootPath);

      if (scopedEntries.length === 0) {
        return {
          query: normalizedQuery,
          total: 0,
          results: []
        };
      }

      const lookupEntries = buildSearchLookup(scopedEntries);
      const uniqueRoots = [...new Set(lookupEntries.map((entry) => entry.rootPath))];
      const pattern = `*${escapeFindPattern(normalizedQuery)}*`;
      const command = `LC_ALL=C find ${uniqueRoots
        .map(shellQuote)
        .join(" ")} -type f -iname ${shellQuote(
        pattern
      )} -printf '%p\\t%s\\t%T@\\n' 2>/dev/null | head -n ${SEARCH_RESULT_LIMIT}`;

      return withConnection(config, async (client) => {
        const rawOutput = await execCommand(client, command);
        const results = rawOutput
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            const [absolutePath, size, modifiedAt] = line.split("\t");

            if (!absolutePath) {
              return null;
            }

            const matchingEntry = matchSearchEntry(lookupEntries, normalizeUnixPath(absolutePath));

            if (!matchingEntry) {
              return null;
            }

            const relativePath = posixPath.relative(
              matchingEntry.rootPath,
              normalizeUnixPath(absolutePath)
            );

            return {
              id: `${matchingEntry.id}:${relativePath}`,
              entryId: matchingEntry.id,
              entryLabel: matchingEntry.label,
              bu: matchingEntry.bu,
              type: normalizeSectionType(matchingEntry.type),
              absolutePath: normalizeUnixPath(absolutePath),
              relativePath,
              directory:
                posixPath.dirname(relativePath) === "."
                  ? ""
                  : posixPath.dirname(relativePath),
              fileName: posixPath.basename(absolutePath),
              size: Number(size) || 0,
              modifiedAt: formatTimestamp(modifiedAt)
            };
          })
          .filter(Boolean);

        return {
          query: normalizedQuery,
          total: results.length,
          results
        };
      });
    },
    async readPreview(rootPath, relativePath) {
      const resolvedPath = resolveArchivePath(rootPath, relativePath);

      return withConnection(config, async (client) => {
        const sftp = await getSftp(client);
        const fileStats = await statPath(sftp, resolvedPath.targetPath);

        if (
          !fileStats ||
          typeof fileStats.isDirectory === "function" &&
          fileStats.isDirectory()
        ) {
          throw new Error("The requested archive item is a directory.");
        }

        const previewable = isPreviewableTextFile(resolvedPath.targetPath, fileStats.size);

        if (!previewable) {
          return {
            previewable: false,
            fileName: posixPath.basename(resolvedPath.targetPath),
            size: Number(fileStats.size) || 0,
            modifiedAt: formatTimestamp(fileStats.mtime),
            contentType: getContentType(resolvedPath.targetPath),
            content: ""
          };
        }

        const buffer = await readPreviewChunk(sftp, resolvedPath.targetPath);

        return {
          previewable: true,
          fileName: posixPath.basename(resolvedPath.targetPath),
          size: Number(fileStats.size) || 0,
          modifiedAt: formatTimestamp(fileStats.mtime),
          contentType: getContentType(resolvedPath.targetPath),
          content: buffer.toString("utf8"),
          truncated: Number(fileStats.size) > buffer.length
        };
      });
    },
    async readFile(rootPath, relativePath, options = {}) {
      const resolvedPath = resolveArchivePath(rootPath, relativePath);
      const maxBytes = Number(options.maxBytes) || 0;

      return withConnection(config, async (client) => {
        const sftp = await getSftp(client);
        const fileStats = await statPath(sftp, resolvedPath.targetPath);

        if (
          !fileStats ||
          typeof fileStats.isDirectory === "function" &&
          fileStats.isDirectory()
        ) {
          throw new Error("The requested archive item is a directory.");
        }

        const size = Number(fileStats.size) || 0;

        if (maxBytes > 0 && size > maxBytes) {
          return {
            tooLarge: true,
            fileName: posixPath.basename(resolvedPath.targetPath),
            size,
            modifiedAt: formatTimestamp(fileStats.mtime),
            contentType: getContentType(resolvedPath.targetPath),
            buffer: null
          };
        }

        const buffer = await readFullFile(sftp, resolvedPath.targetPath);

        return {
          tooLarge: false,
          fileName: posixPath.basename(resolvedPath.targetPath),
          size,
          modifiedAt: formatTimestamp(fileStats.mtime),
          contentType: getContentType(resolvedPath.targetPath),
          buffer
        };
      });
    },
    async streamFile(rootPath, relativePath, response) {
      const resolvedPath = resolveArchivePath(rootPath, relativePath);

      if (!isArchiveConfigured(config)) {
        throw new Error("Archive server credentials are not configured.");
      }

      const client = await connect(config);

      try {
        const sftp = await getSftp(client);
        const fileStats = await statPath(sftp, resolvedPath.targetPath);

        if (
          !fileStats ||
          typeof fileStats.isDirectory === "function" &&
          fileStats.isDirectory()
        ) {
          throw new Error("The requested archive item is a directory.");
        }

        response.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Content-Type": getContentType(resolvedPath.targetPath),
          "Content-Length": Number(fileStats.size) || undefined,
          "Content-Disposition": `attachment; filename="${encodeURIComponent(
            posixPath.basename(resolvedPath.targetPath)
          )}"`
        });

        await new Promise((resolve, reject) => {
          const stream = sftp.createReadStream(resolvedPath.targetPath);

          stream.on("error", reject);
          response.on("close", resolve);
          response.on("finish", resolve);
          stream.pipe(response);
        });
      } finally {
        client.end();
      }
    }
  };
}

module.exports = {
  createArchiveService,
  normalizeArchivePath,
  resolveArchivePath,
  isArchiveConfigured
};
