/**
 * Config Service - Manages application configuration
 */

import { app } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

// Import analytics config type
import type { AnalyticsConfig } from './analytics/types'
import type { AISourcesConfig, CustomSourceConfig } from '../../shared/types'
import { decryptString } from './secure-storage.service'

// ============================================================================
// ENCRYPTED DATA MIGRATION
// ============================================================================
// v1.2.10 and earlier used Electron's safeStorage to encrypt API keys/tokens.
// v1.2.12 removed encryption (causes macOS Keychain prompts) but kept decryption
// for backward compatibility. However, if decryption fails (Keychain unavailable,
// cross-machine migration, data corruption), decryptString() returns empty string,
// causing the app to think no API key is configured.
//
// This migration runs once at startup (before any service reads config) to:
// 1. Detect encrypted values (enc: prefix)
// 2. Attempt decryption
// 3. Save plaintext on success, clear invalid data on failure
// 4. Ensure subsequent reads get valid data
// ============================================================================

const ENCRYPTED_PREFIX = 'enc:'

interface MigrationResult {
  migrated: boolean
  fields: string[]
  failures: string[]
}

/**
 * Check if a value is encrypted (has enc: prefix)
 */
function isEncryptedValue(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX)
}

/**
 * Attempt to decrypt a value and return the result
 * @returns { success: true, value: decrypted } or { success: false }
 */
function tryDecrypt(value: string): { success: true; value: string } | { success: false } {
  const decrypted = decryptString(value)

  // decryptString returns empty string on failure, or the original value if not encrypted
  // For encrypted values, success means we got a non-empty, non-enc: prefixed result
  if (decrypted && !decrypted.startsWith(ENCRYPTED_PREFIX)) {
    return { success: true, value: decrypted }
  }

  return { success: false }
}

/**
 * Migrate encrypted credentials to plaintext
 *
 * This function reads the config file directly (bypassing getConfig() to avoid
 * triggering decryption in ai-sources/manager.ts) and migrates any encrypted
 * values to plaintext.
 *
 * Called once at app startup, before any IPC handlers are registered.
 */
function migrateEncryptedCredentials(): void {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    return // No config file, nothing to migrate
  }

  let parsed: Record<string, any>
  try {
    const content = readFileSync(configPath, 'utf-8')
    parsed = JSON.parse(content)
  } catch (error) {
    console.error('[Config Migration] Failed to read config file:', error)
    return // Don't block startup on migration failure
  }

  const result: MigrationResult = {
    migrated: false,
    fields: [],
    failures: []
  }

  // 1. Migrate legacy api.apiKey (if exists and encrypted)
  if (parsed.api && isEncryptedValue(parsed.api.apiKey)) {
    const decryptResult = tryDecrypt(parsed.api.apiKey)
    if (decryptResult.success) {
      parsed.api.apiKey = decryptResult.value
      result.migrated = true
      result.fields.push('api.apiKey')
    } else {
      parsed.api.apiKey = ''
      result.migrated = true
      result.failures.push('api.apiKey')
    }
  }

  // 2. Migrate aiSources.custom.apiKey
  if (parsed.aiSources?.custom && isEncryptedValue(parsed.aiSources.custom.apiKey)) {
    const decryptResult = tryDecrypt(parsed.aiSources.custom.apiKey)
    if (decryptResult.success) {
      parsed.aiSources.custom.apiKey = decryptResult.value
      result.migrated = true
      result.fields.push('aiSources.custom.apiKey')
    } else {
      parsed.aiSources.custom.apiKey = ''
      result.migrated = true
      result.failures.push('aiSources.custom.apiKey')
    }
  }

  // 3. Migrate OAuth provider tokens (accessToken, refreshToken)
  // OAuth providers are stored as aiSources[providerName] where providerName != 'current' and != 'custom'
  if (parsed.aiSources && typeof parsed.aiSources === 'object') {
    for (const [key, value] of Object.entries(parsed.aiSources)) {
      // Skip non-provider keys
      if (key === 'current' || key === 'custom' || !value || typeof value !== 'object') {
        continue
      }

      const provider = value as Record<string, any>

      // Migrate accessToken
      if (isEncryptedValue(provider.accessToken)) {
        const decryptResult = tryDecrypt(provider.accessToken)
        if (decryptResult.success) {
          provider.accessToken = decryptResult.value
          result.migrated = true
          result.fields.push(`aiSources.${key}.accessToken`)
        } else {
          provider.accessToken = ''
          result.migrated = true
          result.failures.push(`aiSources.${key}.accessToken`)
        }
      }

      // Migrate refreshToken
      if (isEncryptedValue(provider.refreshToken)) {
        const decryptResult = tryDecrypt(provider.refreshToken)
        if (decryptResult.success) {
          provider.refreshToken = decryptResult.value
          result.migrated = true
          result.fields.push(`aiSources.${key}.refreshToken`)
        } else {
          provider.refreshToken = ''
          result.migrated = true
          result.failures.push(`aiSources.${key}.refreshToken`)
        }
      }
    }
  }

  // Save migrated config if any changes were made
  if (result.migrated) {
    try {
      writeFileSync(configPath, JSON.stringify(parsed, null, 2))

      if (result.fields.length > 0) {
        console.log(`[Config Migration] Successfully migrated: ${result.fields.join(', ')}`)
      }
      if (result.failures.length > 0) {
        console.warn(
          `[Config Migration] Failed to decrypt (cleared): ${result.failures.join(', ')}. ` +
            'User will need to re-enter these credentials.'
        )
      }
    } catch (error) {
      console.error('[Config Migration] Failed to save migrated config:', error)
      // Don't throw - let the app continue, user can re-enter credentials
    }
  }
}

// ============================================================================
// API Config Change Notification (Callback Pattern)
// ============================================================================
// When API config changes (provider/apiKey/apiUrl), subscribers are notified.
// This allows agent.service to invalidate sessions without circular dependency.
// agent.service imports onApiConfigChange (agent → config, existing direction)
// config.service calls registered callbacks (no import from agent)
// ============================================================================

type ApiConfigChangeHandler = () => void
const apiConfigChangeHandlers: ApiConfigChangeHandler[] = []

/**
 * Register a callback to be notified when API config changes.
 * Used by agent.service to invalidate sessions on config change.
 *
 * @returns Unsubscribe function
 */
export function onApiConfigChange(handler: ApiConfigChangeHandler): () => void {
  apiConfigChangeHandlers.push(handler)
  return () => {
    const idx = apiConfigChangeHandlers.indexOf(handler)
    if (idx >= 0) apiConfigChangeHandlers.splice(idx, 1)
  }
}

// Types (shared with renderer)
interface HaloConfig {
  api: {
    provider: 'anthropic' | 'openai' | 'custom'
    apiKey: string
    apiUrl: string
    model: string
  }
  // Multi-source AI configuration (OAuth + Custom API)
  aiSources?: AISourcesConfig
  permissions: {
    fileAccess: 'allow' | 'ask' | 'deny'
    commandExecution: 'allow' | 'ask' | 'deny'
    networkAccess: 'allow' | 'ask' | 'deny'
    trustMode: boolean
  }
  appearance: {
    theme: 'light' | 'dark' | 'system'
  }
  system: {
    autoLaunch: boolean
  }
  remoteAccess: {
    enabled: boolean
    port: number
  }
  onboarding: {
    completed: boolean
  }
  // MCP servers configuration (compatible with Cursor / Claude Desktop format)
  mcpServers: Record<string, McpServerConfig>
  isFirstLaunch: boolean
  // Analytics configuration (auto-generated on first launch)
  analytics?: AnalyticsConfig
  // Git Bash configuration (Windows only)
  gitBash?: {
    installed: boolean
    path: string | null
    skipped: boolean
  }
}

// MCP server configuration types
type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig | McpSseServerConfig

interface McpStdioServerConfig {
  type?: 'stdio'  // Optional, defaults to stdio
  command: string
  args?: string[]
  env?: Record<string, string>
  timeout?: number
  disabled?: boolean  // Halo extension: temporarily disable this server
}

interface McpHttpServerConfig {
  type: 'http'
  url: string
  headers?: Record<string, string>
  disabled?: boolean  // Halo extension: temporarily disable this server
}

interface McpSseServerConfig {
  type: 'sse'
  url: string
  headers?: Record<string, string>
  disabled?: boolean  // Halo extension: temporarily disable this server
}

// Paths
// Use os.homedir() instead of app.getPath('home') to respect HOME environment variable
// This is essential for E2E tests to run in isolated test directories
export function getHaloDir(): string {
  // 1. Support custom data directory via environment variable
  //    Useful for development to avoid conflicts with production data
  if (process.env.HALO_DATA_DIR) {
    let dir = process.env.HALO_DATA_DIR
    // Expand ~ to home directory (shell doesn't expand in env vars)
    if (dir.startsWith('~')) {
      dir = join(homedir(), dir.slice(1))
    }
    return dir
  }

  // 2. Auto-detect development mode: use separate directory
  //    app.isPackaged is false when running via electron-vite dev
  if (!app.isPackaged) {
    return join(homedir(), '.halo-dev')
  }

  // 3. Production: use default directory
  return join(homedir(), '.halo')
}

export function getConfigPath(): string {
  return join(getHaloDir(), 'config.json')
}

export function getTempSpacePath(): string {
  return join(getHaloDir(), 'temp')
}

export function getSpacesDir(): string {
  return join(getHaloDir(), 'spaces')
}

// Default model (Opus 4.5)
const DEFAULT_MODEL = 'claude-opus-4-5-20251101'

// Default configuration
const DEFAULT_CONFIG: HaloConfig = {
  api: {
    provider: 'anthropic',
    apiKey: '',
    apiUrl: 'https://api.anthropic.com',
    model: DEFAULT_MODEL
  },
  aiSources: {
    current: 'custom'
  },
  permissions: {
    fileAccess: 'allow',
    commandExecution: 'ask',
    networkAccess: 'allow',
    trustMode: false
  },
  appearance: {
    theme: 'dark'
  },
  system: {
    autoLaunch: false
  },
  remoteAccess: {
    enabled: false,
    port: 3456
  },
  onboarding: {
    completed: false
  },
  mcpServers: {},  // Empty by default
  isFirstLaunch: true
}

function normalizeAiSources(parsed: Record<string, any>): AISourcesConfig {
  const raw = parsed?.aiSources

  // If aiSources already exists, use it directly (no auto-rebuild from legacy api)
  if (raw && typeof raw === 'object') {
    const aiSources: AISourcesConfig = { ...raw }
    if (!aiSources.current) {
      aiSources.current = 'custom'
    }
    return aiSources
  }

  // First-time migration only: create aiSources from legacy api config
  const aiSources: AISourcesConfig = { current: 'custom' }
  const legacyApi = parsed?.api
  const hasLegacyApi = typeof legacyApi?.apiKey === 'string' && legacyApi.apiKey.length > 0

  if (hasLegacyApi) {
    const provider = legacyApi?.provider === 'openai' ? 'openai' : 'anthropic'
    aiSources.custom = {
      provider,
      apiKey: legacyApi.apiKey,
      apiUrl: legacyApi?.apiUrl || (provider === 'openai' ? 'https://api.openai.com' : 'https://api.anthropic.com'),
      model: legacyApi?.model || DEFAULT_MODEL
    } as CustomSourceConfig
  }

  return aiSources
}

function getAiSourcesSignature(aiSources?: AISourcesConfig): string {
  if (!aiSources) return ''
  const current = aiSources.current || 'custom'

  // Note: model is excluded from signature because V2 Session supports dynamic model switching
  // (via setModel method). Only changes to credentials/provider should invalidate sessions.
  if (current === 'custom') {
    const custom = aiSources.custom
    return [
      'custom',
      custom?.provider || '',
      custom?.apiUrl || '',
      custom?.apiKey || ''
      // model excluded: dynamic switching supported
    ].join('|')
  }

  const currentConfig = aiSources[current] as Record<string, any> | undefined
  if (currentConfig && typeof currentConfig === 'object') {
    return [
      'oauth',
      current,
      currentConfig.accessToken || '',
      currentConfig.refreshToken || '',
      currentConfig.tokenExpires || ''
      // model excluded: dynamic switching supported
    ].join('|')
  }

  return current
}

// Initialize app directories
export async function initializeApp(): Promise<void> {
  const haloDir = getHaloDir()
  const tempDir = getTempSpacePath()
  const spacesDir = getSpacesDir()
  const tempArtifactsDir = join(tempDir, 'artifacts')
  const tempConversationsDir = join(tempDir, 'conversations')

  // Create directories if they don't exist
  const dirs = [haloDir, tempDir, spacesDir, tempArtifactsDir, tempConversationsDir]
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  // Create default config if it doesn't exist
  const configPath = getConfigPath()
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2))
  }

  // Migrate encrypted credentials to plaintext (v1.2.10 -> v1.2.12+)
  // This must run before any service reads the config to ensure decryption
  // happens at the file level, not at read time where failures cause issues.
  migrateEncryptedCredentials()
}

// Get configuration
export function getConfig(): HaloConfig {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(content)
    const aiSources = normalizeAiSources(parsed)
    // Deep merge to ensure all nested defaults are applied
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      api: { ...DEFAULT_CONFIG.api, ...parsed.api },
      aiSources,
      permissions: { ...DEFAULT_CONFIG.permissions, ...parsed.permissions },
      appearance: { ...DEFAULT_CONFIG.appearance, ...parsed.appearance },
      system: { ...DEFAULT_CONFIG.system, ...parsed.system },
      onboarding: { ...DEFAULT_CONFIG.onboarding, ...parsed.onboarding },
      // mcpServers is a flat map, just use parsed value or default
      mcpServers: parsed.mcpServers || DEFAULT_CONFIG.mcpServers,
      // analytics: keep as-is (managed by analytics.service.ts)
      analytics: parsed.analytics
    }
  } catch (error) {
    console.error('Failed to read config:', error)
    return DEFAULT_CONFIG
  }
}

// Save configuration
export function saveConfig(config: Partial<HaloConfig>): HaloConfig {
  const currentConfig = getConfig()
  const newConfig = { ...currentConfig, ...config }
  const previousAiSourcesSignature = getAiSourcesSignature(currentConfig.aiSources)

  // Deep merge for nested objects
  if (config.api) {
    newConfig.api = { ...currentConfig.api, ...config.api }
  }
  if (config.permissions) {
    newConfig.permissions = { ...currentConfig.permissions, ...config.permissions }
  }
  if (config.appearance) {
    newConfig.appearance = { ...currentConfig.appearance, ...config.appearance }
  }
  if (config.system) {
    newConfig.system = { ...currentConfig.system, ...config.system }
  }
  if (config.onboarding) {
    newConfig.onboarding = { ...currentConfig.onboarding, ...config.onboarding }
  }
  // mcpServers: replace entirely when provided (not merged)
  if (config.mcpServers !== undefined) {
    newConfig.mcpServers = config.mcpServers
  }
  // analytics: replace entirely when provided (managed by analytics.service.ts)
  if (config.analytics !== undefined) {
    newConfig.analytics = config.analytics
  }
  // gitBash: replace entirely when provided (Windows only)
  if ((config as any).gitBash !== undefined) {
    (newConfig as any).gitBash = (config as any).gitBash
  }

  const configPath = getConfigPath()
  writeFileSync(configPath, JSON.stringify(newConfig, null, 2))

  // Detect API config changes and notify subscribers
  // This allows agent.service to invalidate sessions when API config changes
  const nextAiSourcesSignature = getAiSourcesSignature(newConfig.aiSources)
  const aiSourcesChanged = previousAiSourcesSignature !== nextAiSourcesSignature

  if (config.api || config.aiSources) {
    const apiChanged =
      !!config.api &&
      (config.api.provider !== currentConfig.api.provider ||
        config.api.apiKey !== currentConfig.api.apiKey ||
        config.api.apiUrl !== currentConfig.api.apiUrl)

    if ((apiChanged || aiSourcesChanged) && apiConfigChangeHandlers.length > 0) {
      console.log('[Config] API config changed, notifying subscribers...')
      // Use setTimeout to avoid blocking the save operation
      // and ensure all handlers are called asynchronously
      setTimeout(() => {
        apiConfigChangeHandlers.forEach(handler => {
          try {
            handler()
          } catch (e) {
            console.error('[Config] Error in API config change handler:', e)
          }
        })
      }, 0)
    }
  }

  return newConfig
}

/**
 * Set auto launch on system startup
 */
export function setAutoLaunch(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true, // Start minimized
    // On macOS, also set to open at login for all users (requires admin)
    // path: process.execPath, // Optional: specify executable path
  })

  // Save to config
  saveConfig({ system: { autoLaunch: enabled } })
  console.log(`[Config] Auto launch set to: ${enabled}`)
}

/**
 * Get current auto launch status
 */
export function getAutoLaunch(): boolean {
  const settings = app.getLoginItemSettings()
  return settings.openAtLogin
}
