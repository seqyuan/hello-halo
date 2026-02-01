/**
 * Config IPC Handlers
 */

import { ipcMain } from 'electron'
import { getConfig, saveConfig } from '../services/config.service'
import { getAISourceManager } from '../services/ai-sources'
import { decryptString } from '../services/secure-storage.service'
import { validateApiConnection } from '../services/api-validator.service'
import { runConfigProbe, emitConfigChange } from '../services/health'

export function registerConfigHandlers(): void {
  // Get configuration
  ipcMain.handle('config:get', async () => {
    console.log('[Settings] config:get - Loading settings')
    try {
      const config = getConfig() as Record<string, any>

      // Decrypt custom API key before sending to renderer
      const decryptedConfig = { ...config }
      if (decryptedConfig.aiSources?.custom?.apiKey) {
        decryptedConfig.aiSources = {
          ...decryptedConfig.aiSources,
          custom: {
            ...decryptedConfig.aiSources.custom,
            apiKey: decryptString(decryptedConfig.aiSources.custom.apiKey)
          }
        }
      }
      // Also handle legacy api.apiKey
      if (decryptedConfig.api?.apiKey) {
        decryptedConfig.api = {
          ...decryptedConfig.api,
          apiKey: decryptString(decryptedConfig.api.apiKey)
        }
      }

      console.log('[Settings] config:get - Loaded, aiSource:', decryptedConfig.aiSources?.current || 'custom')
      return { success: true, data: decryptedConfig }
    } catch (error: unknown) {
      const err = error as Error
      console.error('[Settings] config:get - Failed:', err.message)
      return { success: false, error: err.message }
    }
  })

  // Save configuration
  ipcMain.handle('config:set', async (_event, updates: Record<string, unknown>) => {
    // Log what's being updated (without sensitive data)
    const updateKeys = Object.keys(updates)
    const aiSourcesCurrent = (updates.aiSources as any)?.current
    console.log('[Settings] config:set - Saving:', updateKeys.join(', '), aiSourcesCurrent ? `(aiSource: ${aiSourcesCurrent})` : '')

    try {
      const processedUpdates = { ...updates }
      const incomingAiSources = processedUpdates.aiSources as Record<string, any> | undefined

      if (incomingAiSources && typeof incomingAiSources === 'object') {
        const currentConfig = getConfig() as Record<string, any>
        const currentAiSources = currentConfig.aiSources || { current: 'custom' }

        // Start with incoming sources (this is the source of truth from frontend)
        const mergedAiSources: Record<string, any> = { ...incomingAiSources }

        // Deep merge: preserve nested fields for existing sources
        for (const key of Object.keys(incomingAiSources)) {
          if (key === 'current') continue
          const incomingValue = incomingAiSources[key]
          const currentValue = currentAiSources[key]
          if (
            incomingValue && typeof incomingValue === 'object' && !Array.isArray(incomingValue) &&
            currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
          ) {
            mergedAiSources[key] = { ...currentValue, ...incomingValue }
          }
        }

        processedUpdates.aiSources = mergedAiSources
      }

      const config = saveConfig(processedUpdates)
      console.log('[Settings] config:set - Saved successfully')

      // Check if aiSources changed - run config validation
      if (incomingAiSources) {
        // Emit config change event for health monitoring
        emitConfigChange('aiSources updated')

        // Run config probe to validate (async, don't block response)
        runConfigProbe().then(result => {
          if (!result.healthy) {
            console.warn('[Settings] config:set - Validation warning:', result.message)
          }
        }).catch(err => {
          console.error('[Settings] config:set - Probe failed:', err)
        })
      }

      return { success: true, data: config }
    } catch (error: unknown) {
      const err = error as Error
      console.error('[Settings] config:set - Failed:', err.message)
      return { success: false, error: err.message }
    }
  })

  // Validate API connection via SDK
  ipcMain.handle(
    'config:validate-api',
    async (_event, apiKey: string, apiUrl: string, provider: string) => {
      console.log('[Settings] config:validate-api - Validating:', provider, apiUrl ? `(url: ${apiUrl.slice(0, 30)}...)` : '(default url)')
      try {
        const result = await validateApiConnection({
          apiKey,
          apiUrl,
          provider: provider as 'anthropic' | 'openai'
        })
        console.log('[Settings] config:validate-api - Result:', result.valid ? 'valid' : 'invalid')
        return { success: true, data: result }
      } catch (error: unknown) {
        const err = error as Error
        console.error('[Settings] config:validate-api - Failed:', err.message)
        return { success: false, error: err.message }
      }
    }
  )

  // Refresh AI sources configuration (auto-detects logged-in sources)
  ipcMain.handle('config:refresh-ai-sources', async () => {
    console.log('[Settings] config:refresh-ai-sources - Refreshing all AI sources')
    try {
      const manager = getAISourceManager()
      await manager.refreshAllConfigs()
      const config = getConfig()
      console.log('[Settings] config:refresh-ai-sources - Refreshed, current:', (config as any).aiSources?.current || 'custom')
      return { success: true, data: config }
    } catch (error: unknown) {
      const err = error as Error
      console.error('[Settings] config:refresh-ai-sources - Failed:', err.message)
      return { success: false, error: err.message }
    }
  })

  console.log('[Settings] Config handlers registered')
}
