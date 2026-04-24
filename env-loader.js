const fs = require("fs");
const path = require("path");

let hasLoadedEnvFile = false;

function normalizeValue(value) {
  const trimmedValue = String(value || "").trim();

  if (
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
  ) {
    return trimmedValue.slice(1, -1);
  }

  return trimmedValue;
}

function loadEnvFile(filePath = path.join(__dirname, ".env")) {
  if (hasLoadedEnvFile) {
    return;
  }

  hasLoadedEnvFile = true;

  try {
    const rawContent = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");

    rawContent.split(/\r?\n/).forEach((line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith("#")) {
        return;
      }

      const separatorIndex = trimmedLine.indexOf("=");

      if (separatorIndex < 0) {
        return;
      }

      const key = trimmedLine.slice(0, separatorIndex).trim();

      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
        return;
      }

      const value = trimmedLine.slice(separatorIndex + 1);
      process.env[key] = normalizeValue(value);
    });
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

module.exports = {
  loadEnvFile
};
