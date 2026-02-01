/**
 * System IPC Handlers - Auto launch, window controls, and logging
 */

import { ipcMain, BrowserWindow, shell } from 'electron'
import { dirname } from 'path'
import log from 'electron-log/main.js'
import { setAutoLaunch, getAutoLaunch } from '../services/config.service'
import { getMainWindow, onMainWindowChange } from '../services/window.service'

let mainWindow: BrowserWindow | null = null

export function registerSystemHandlers(): void {
  // Subscribe to window changes to set up event listeners
  onMainWindowChange((window) => {
    mainWindow = window
    if (window) {
      // Listen for maximize/unmaximize events and notify renderer
      window.on('maximize', () => {
        window.webContents.send('window:maximize-change', true)
      })
      window.on('unmaximize', () => {
        window.webContents.send('window:maximize-change', false)
      })
    }
  })

  // Get auto launch status
  ipcMain.handle('system:get-auto-launch', async () => {
    console.log('[Settings] system:get-auto-launch - Getting auto launch status')
    try {
      const enabled = getAutoLaunch()
      console.log('[Settings] system:get-auto-launch - Status:', enabled)
      return { success: true, data: enabled }
    } catch (error) {
      const err = error as Error
      console.error('[Settings] system:get-auto-launch - Failed:', err.message)
      return { success: false, error: err.message }
    }
  })

  // Set auto launch
  ipcMain.handle('system:set-auto-launch', async (_event, enabled: boolean) => {
    console.log('[Settings] system:set-auto-launch - Setting to:', enabled)
    try {
      setAutoLaunch(enabled)
      console.log('[Settings] system:set-auto-launch - Set successfully')
      return { success: true, data: enabled }
    } catch (error) {
      const err = error as Error
      console.error('[Settings] system:set-auto-launch - Failed:', err.message)
      return { success: false, error: err.message }
    }
  })

  // Set title bar overlay (Windows/Linux only)
  ipcMain.handle(
    'window:set-title-bar-overlay',
    async (_event, options: { color: string; symbolColor: string }) => {
      try {
        // Only works on Windows/Linux with titleBarOverlay enabled
        if (process.platform !== 'darwin' && mainWindow) {
          mainWindow.setTitleBarOverlay({
            color: options.color,
            symbolColor: options.symbolColor,
            height: 40
          })
        }
        return { success: true }
      } catch (error) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  // Maximize window
  ipcMain.handle('window:maximize', async () => {
    try {
      if (mainWindow) {
        mainWindow.maximize()
      }
      return { success: true }
    } catch (error) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Unmaximize window
  ipcMain.handle('window:unmaximize', async () => {
    try {
      if (mainWindow) {
        mainWindow.unmaximize()
      }
      return { success: true }
    } catch (error) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Check if window is maximized
  ipcMain.handle('window:is-maximized', async () => {
    try {
      const isMaximized = mainWindow?.isMaximized() ?? false
      return { success: true, data: isMaximized }
    } catch (error) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Toggle maximize
  ipcMain.handle('window:toggle-maximize', async () => {
    try {
      if (mainWindow) {
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize()
        } else {
          mainWindow.maximize()
        }
      }
      return { success: true, data: mainWindow?.isMaximized() ?? false }
    } catch (error) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Open log folder in system file manager
  ipcMain.handle('system:open-log-folder', async () => {
    console.log('[Settings] system:open-log-folder - Opening log folder')
    try {
      const logFile = log.transports.file.getFile()
      const logDir = dirname(logFile.path)
      await shell.openPath(logDir)
      console.log('[Settings] system:open-log-folder - Opened:', logDir)
      return { success: true, data: logDir }
    } catch (error) {
      const err = error as Error
      console.error('[Settings] system:open-log-folder - Failed:', err.message)
      return { success: false, error: err.message }
    }
  })

  console.log('[Settings] System handlers registered')
}
