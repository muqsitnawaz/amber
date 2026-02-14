import { app, BrowserWindow, Tray, nativeImage, Menu, session } from "electron";
import * as path from "path";
import { loadOrDefault } from "./config";
import { ensureDirs } from "./storage";
import { registerIpcHandlers } from "./ipc";
import { startScheduler, stopScheduler, triggerManualSummarize } from "./summarizer/scheduler";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function createWindow() {
  const isDev = !app.isPackaged;
  const preloadPath = path.join(__dirname, "preload.js");
  const devUrl = process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_START_URL;

  mainWindow = new BrowserWindow({
    width: 920,
    height: 640,
    minWidth: 640,
    minHeight: 420,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: "#1c1c1e",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  const url = isDev
    ? (devUrl || "http://localhost:1420")
    : `file://${path.join(__dirname, "../dist/index.html")}`;

  if (isDev) {
    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, failedUrl) => {
      console.error(`Failed to load renderer ${failedUrl}: ${errorCode} ${errorDescription}`);
    });
  }

  mainWindow.loadURL(url);

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, "../assets/iconTemplate.png"),
  );

  tray = new Tray(icon);
  tray.setToolTip("Amber");

  tray.on("click", () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Amber",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: "separator" },
    {
      label: "Summarize Today",
      click: () => triggerManualSummarize(),
    },
    { type: "separator" },
    {
      label: "Quit Amber",
      accelerator: "CmdOrCtrl+Q",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

async function init() {
  const isDev = !app.isPackaged;

  // Set Content Security Policy (production only — Vite dev needs 'unsafe-inline'/eval)
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
          ],
        },
      });
    });
  }

  const config = await loadOrDefault();
  await ensureDirs(config.storage.base_dir);

  registerIpcHandlers();
  createTray();
  createWindow();

  if (app.dock) {
    app.dock.hide();
  }

  startScheduler(config);
  console.log("Amber ready");
}

app.on("ready", init);

app.on("activate", () => {
  mainWindow?.show();
  mainWindow?.focus();
});

app.on("window-all-closed", (e: Event) => e.preventDefault());

app.on("before-quit", () => {
  isQuitting = true;
  stopScheduler();
});
