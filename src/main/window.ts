import { join } from 'node:path'
import { app, BrowserWindow, session } from 'electron'

const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

export function applyContentSecurityPolicy() {
  // В dev Vite HMR внедряет инлайн-скрипт react-refresh и подключается по ws —
  // 'unsafe-inline' и ws: разрешены только здесь. В упакованной сборке (production)
  // DEV_SERVER_URL отсутствует, и CSP остаётся строгим без исключений.
  const scriptSrc = DEV_SERVER_URL ? "'self' 'unsafe-inline'" : "'self'"
  const connectSrc = DEV_SERVER_URL ? "'self' ws://localhost:*" : "'self'"
  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src ${connectSrc}`,
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (!app.isPackaged) {
    win.webContents.openDevTools()
  }

  return win
}
