const { loadEnvFile } = require("./env-loader");

loadEnvFile();
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const OPTIONAL_APPS = {
  certificate: {
    directory: path.join(ROOT_DIR, "CERTIFICATE_NEW"),
    commandArgs: ["server.js"],
    extraEnv: {
      PORT: process.env.CERTIFICATE_APP_PORT || "3003"
    }
  },
  documentation: {
    directory: path.join(ROOT_DIR, "DOCUMENTATION_NEW")
  },
  sftp: {
    directory: path.join(ROOT_DIR, "SFTP_NEW")
  }
};

const children = [];
let shuttingDown = false;

function startProcess(commandArgs, options = {}) {
  const child = spawn(process.execPath, commandArgs, {
    cwd: options.cwd || ROOT_DIR,
    env: {
      ...process.env,
      ...(options.extraEnv || {})
    },
    stdio: "inherit"
  });

  children.push(child);
  return child;
}

function startOptionalProcess(config) {
  if (!config || !config.commandArgs || !fs.existsSync(config.directory)) {
    return null;
  }

  return startProcess(config.commandArgs, {
    cwd: config.directory,
    extraEnv: config.extraEnv
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  children.forEach((child) => {
    if (!child.killed) {
      child.kill();
    }
  });

  setTimeout(() => process.exit(exitCode), 300);
}

const apiServer = startProcess(["directory-data-server.js"]);
const clientServer = startProcess(
  [path.join("node_modules", "react-scripts", "bin", "react-scripts.js"), "start"],
  {
    extraEnv: {
      BROWSER: "none",
      DISABLE_ESLINT_PLUGIN: "true"
    }
  }
);
const certificateServer = startOptionalProcess(OPTIONAL_APPS.certificate);

Object.entries(OPTIONAL_APPS).forEach(([appId, config]) => {
  if (!fs.existsSync(config.directory)) {
    console.log(
      `${appId} app directory is not present in this workspace. The APF portal will still run.`
    );
  }
});

apiServer.on("exit", (code) => {
  if (!shuttingDown) {
    shutdown(code || 0);
  }
});

clientServer.on("exit", (code) => {
  if (!shuttingDown) {
    shutdown(code || 0);
  }
});

if (certificateServer) {
  certificateServer.on("exit", (code) => {
    if (!shuttingDown) {
      shutdown(code || 0);
    }
  });
}

process.on("exit", () => {
  children.forEach((child) => {
    if (!child.killed) {
      child.kill();
    }
  });
});

process.on("uncaughtException", (error) => {
  console.error("start-dev.js crashed", error);
  shutdown(1);
});

process.on("unhandledRejection", (error) => {
  console.error("start-dev.js encountered an unhandled rejection", error);
  shutdown(1);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
