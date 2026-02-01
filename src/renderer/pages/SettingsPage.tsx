/**
 * Settings Page - App configuration
 */

import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../stores/app.store'
import { api } from '../api'
import { v4 as uuidv4 } from 'uuid'
import type { HaloConfig, ThemeMode, McpServersConfig, AISourceType, OAuthSourceConfig, CustomSourceConfig } from '../types'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '../types'

/**
 * Localized text - either a simple string or object with language codes
 */
type LocalizedText = string | Record<string, string>

// Auth provider config from product.json
interface AuthProviderConfig {
  type: string
  displayName: LocalizedText
  description: LocalizedText
  icon: string
  iconBgColor: string
  recommended: boolean
  enabled: boolean
}
import { CheckCircle2, XCircle, ArrowLeft, Eye, EyeOff } from '../components/icons/ToolIcons'
import { Header } from '../components/layout/Header'
import { McpServerList } from '../components/settings/McpServerList'
import { useTranslation, setLanguage, getCurrentLanguage, SUPPORTED_LOCALES, type LocaleCode } from '../i18n'
import { Loader2, LogOut, Plus, Check, Globe, Key, MessageSquare, FolderOpen, type LucideIcon, RefreshCw, ChevronDown, Edit2, Trash2, Activity, AlertTriangle, CheckCircle, XOctagon, RotateCcw, FileText, Copy, ChevronRight } from 'lucide-react'

/**
 * Get localized text based on current language
 */
function getLocalizedText(value: LocalizedText): string {
  if (typeof value === 'string') {
    return value
  }
  const lang = getCurrentLanguage()
  return value[lang] || value['en'] || Object.values(value)[0] || ''
}

// Icon mapping for dynamic rendering
const ICON_MAP: Record<string, LucideIcon> = {
  globe: Globe,
  key: Key,
  'message-square': MessageSquare,
}

// Get icon component by name
function getIconComponent(iconName: string): LucideIcon {
  return ICON_MAP[iconName] || Globe
}

// Remote access status type
interface RemoteAccessStatus {
  enabled: boolean
  server: {
    running: boolean
    port: number
    token: string | null
    localUrl: string | null
    lanUrl: string | null
  }
  tunnel: {
    status: 'stopped' | 'starting' | 'running' | 'error'
    url: string | null
    error: string | null
  }
  clients: number
}

export function SettingsPage() {
  const { t } = useTranslation()
  const { config, setConfig, goBack } = useAppStore()

  // AI Source state
  const [currentSource, setCurrentSource] = useState<AISourceType>(config?.aiSources?.current || 'custom')
  const [showCustomApiForm, setShowCustomApiForm] = useState(false)

  // OAuth providers state (dynamic from product.json)
  const [authProviders, setAuthProviders] = useState<AuthProviderConfig[]>([])
  const [loginState, setLoginState] = useState<{
    provider: string
    status: string
    userCode?: string
    verificationUri?: string
  } | null>(null)
  const [loggingOutProvider, setLoggingOutProvider] = useState<string | null>(null)

  // Custom API local state for editing
  const [apiKey, setApiKey] = useState(config?.aiSources?.custom?.apiKey || config?.api?.apiKey || '')
  const [apiUrl, setApiUrl] = useState(config?.aiSources?.custom?.apiUrl || config?.api?.apiUrl || '')
  const [provider, setProvider] = useState(config?.aiSources?.custom?.provider || config?.api?.provider || 'anthropic')
  const [model, setModel] = useState(config?.aiSources?.custom?.model || config?.api?.model || DEFAULT_MODEL)
  const [theme, setTheme] = useState<ThemeMode>(config?.appearance?.theme || 'system')

  // Custom API multi-config support
  const [editingKey, setEditingKey] = useState<string | null>(null) // null = creating new, or 'custom' = default
  const [customName, setCustomName] = useState('') // Display name for the config
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Custom model toggle: enable by default if current model is not in preset list
  const [useCustomModel, setUseCustomModel] = useState(() => {
    const currentModel = config?.aiSources?.custom?.model || config?.api?.model || DEFAULT_MODEL
    return !AVAILABLE_MODELS.some(m => m.id === currentModel)
  })

  // Connection status
  const [fetchedModels, setFetchedModels] = useState<string[]>(
    (config?.aiSources?.custom?.availableModels as string[]) || []
  )
  const [isFetchingModels, setIsFetchingModels] = useState(false)

  const [isValidating, setIsValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<{
    valid: boolean
    message?: string
  } | null>(null)

  // Remote access state
  const [remoteStatus, setRemoteStatus] = useState<RemoteAccessStatus | null>(null)
  const [isEnablingRemote, setIsEnablingRemote] = useState(false)
  const [isEnablingTunnel, setIsEnablingTunnel] = useState(false)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [isEditingPassword, setIsEditingPassword] = useState(false)
  const [customPassword, setCustomPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [isSavingPassword, setIsSavingPassword] = useState(false)

  // System settings state
  const [autoLaunch, setAutoLaunch] = useState(config?.system?.autoLaunch || false)

  // API Key visibility state
  const [showApiKey, setShowApiKey] = useState(false)

  // App version state
  const [appVersion, setAppVersion] = useState<string>('')

  // Health diagnostics state
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false)
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false)
  const [healthReport, setHealthReport] = useState<{
    timestamp: string
    version: string
    platform: string
    arch: string
    config: {
      currentSource: string
      provider: string
      hasApiKey: boolean
      apiUrlHost: string
      mcpServerCount: number
    }
    processes: {
      registered: number
      orphansFound: number
      orphansCleaned: number
    }
    health: {
      lastCheckTime: string
      consecutiveFailures: number
      recoveryAttempts: number
    }
    recentErrors: Array<{
      time: string
      source: string
      message: string
    }>
    system: {
      memory: { total: string; free: string }
      uptime: number
    }
  } | null>(null)
  const [isRecovering, setIsRecovering] = useState<string | null>(null)
  const [recoveryResult, setRecoveryResult] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [reportCopied, setReportCopied] = useState(false)

  // Real-time health check result (PPID scan + service probes)
  const [healthCheckResult, setHealthCheckResult] = useState<{
    timestamp: number
    processes: {
      claude: { expected: number; actual: number; pids: number[]; healthy: boolean }
      cloudflared: { expected: number; actual: number; pids: number[]; healthy: boolean }
    }
    services: {
      openaiRouter: { port: number | null; responsive: boolean; responseTime?: number; error?: string }
      httpServer: { port: number | null; responsive: boolean; responseTime?: number; error?: string }
    }
    issues: string[]
    healthy: boolean
    registryCleanup: { removed: number; orphans: number }
  } | null>(null)

  // Update check state
  const [updateStatus, setUpdateStatus] = useState<{
    checking: boolean
    hasUpdate: boolean
    upToDate: boolean
    version?: string
  }>({ checking: false, hasUpdate: false, upToDate: false })

  // Load app version
  useEffect(() => {
    api.getVersion().then((result) => {
      if (result.success && result.data) {
        setAppVersion(result.data)
      }
    })
  }, [])

  // Listen for update status
  useEffect(() => {
    const unsubscribe = api.onUpdaterStatus((data) => {
      if (data.status === 'checking') {
        setUpdateStatus({ checking: true, hasUpdate: false, upToDate: false })
      } else if (data.status === 'not-available') {
        setUpdateStatus({ checking: false, hasUpdate: false, upToDate: true })
      } else if (data.status === 'manual-download' || data.status === 'available' || data.status === 'downloaded') {
        setUpdateStatus({ checking: false, hasUpdate: true, upToDate: false, version: data.version })
      } else if (data.status === 'error') {
        setUpdateStatus({ checking: false, hasUpdate: false, upToDate: false })
      } else {
        setUpdateStatus(prev => ({ ...prev, checking: false }))
      }
    })
    return () => unsubscribe()
  }, [])

  // Load remote access status
  useEffect(() => {
    loadRemoteStatus()

    // Listen for status changes
    const unsubscribe = api.onRemoteStatusChange((data) => {
      setRemoteStatus(data as RemoteAccessStatus)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // Load auth providers and refresh AI sources config
  useEffect(() => {
    // Load available auth providers from product.json
    api.authGetProviders().then((result) => {
      if (result.success && result.data) {
        setAuthProviders(result.data as AuthProviderConfig[])
      }
    })

    // Refresh AI sources config
    api.refreshAISourcesConfig().then((result) => {
      if (result.success) {
        api.getConfig().then((configResult) => {
          if (configResult.success && configResult.data) {
            setConfig(configResult.data as HaloConfig)
          }
        })
      }
    })

    // Listen for auth login progress
    const unsubscribe = api.onAuthLoginProgress((data: { provider: string; status: string }) => {
      setLoginState(data)
      if (data.status === 'completed' || data.status === 'failed') {
        // Reload config after login completes
        setTimeout(() => {
          api.getConfig().then((configResult) => {
            if (configResult.success && configResult.data) {
              setConfig(configResult.data as HaloConfig)
            }
          })
          setLoginState(null)
        }, 500)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // Load system settings
  useEffect(() => {
    loadSystemSettings()
  }, [])

  const loadSystemSettings = async () => {
    try {
      const autoLaunchRes = await api.getAutoLaunch()
      if (autoLaunchRes.success) {
        setAutoLaunch(autoLaunchRes.data as boolean)
      }
    } catch (error) {
      console.error('[Settings] Failed to load system settings:', error)
    }
  }

  // Load QR code when remote is enabled
  useEffect(() => {
    if (remoteStatus?.enabled) {
      loadQRCode()
    } else {
      setQrCode(null)
    }
  }, [remoteStatus?.enabled, remoteStatus?.tunnel.url])

  const loadRemoteStatus = async () => {
    try {
      const response = await api.getRemoteStatus()
      if (response.success && response.data) {
        setRemoteStatus(response.data as RemoteAccessStatus)
      }
    } catch (error) {
      console.error('[Settings] loadRemoteStatus error:', error)
    }
  }

  const loadQRCode = async () => {
    const response = await api.getRemoteQRCode(false) // URL only, no token
    if (response.success && response.data) {
      setQrCode((response.data as any).qrCode)
    }
  }

  const handleToggleRemote = async () => {
    if (remoteStatus?.enabled) {
      // Disable
      const response = await api.disableRemoteAccess()
      if (response.success) {
        setRemoteStatus(null)
        setQrCode(null)
      }
    } else {
      // Enable
      setIsEnablingRemote(true)
      try {
        const response = await api.enableRemoteAccess()
        if (response.success && response.data) {
          setRemoteStatus(response.data as RemoteAccessStatus)
        }
      } catch {
        // Enable failed silently
      } finally {
        setIsEnablingRemote(false)
      }
    }
  }

  const handleToggleTunnel = async () => {
    if (remoteStatus?.tunnel.status === 'running') {
      // Disable tunnel
      await api.disableTunnel()
    } else {
      // Enable tunnel
      setIsEnablingTunnel(true)
      try {
        await api.enableTunnel()
      } finally {
        setIsEnablingTunnel(false)
      }
    }
    loadRemoteStatus()
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  // Auto-save helper for appearance settings
  const autoSave = useCallback(async (partialConfig: Partial<HaloConfig>) => {
    const newConfig = { ...config, ...partialConfig } as HaloConfig
    await api.setConfig(partialConfig)
    setConfig(newConfig)
  }, [config, setConfig])

  // Handle theme change with auto-save
  const handleThemeChange = async (value: ThemeMode) => {
    setTheme(value)
    // Sync to localStorage immediately (for anti-flash on reload)
    try {
      localStorage.setItem('halo-theme', value)
    } catch (e) { /* ignore */ }
    await autoSave({
      appearance: { theme: value }
    })
  }

  // Handle auto launch change
  const handleAutoLaunchChange = async (enabled: boolean) => {
    setAutoLaunch(enabled)
    try {
      await api.setAutoLaunch(enabled)
    } catch (error) {
      console.error('[Settings] Failed to set auto launch:', error)
      setAutoLaunch(!enabled) // Revert on error
    }
  }

  // Handle MCP servers save
  const handleMcpServersSave = async (servers: McpServersConfig) => {
    await api.setConfig({ mcpServers: servers })
    setConfig({ ...config, mcpServers: servers } as HaloConfig)
  }

  // Handle source switch
  const handleSwitchSource = async (source: AISourceType) => {
    setCurrentSource(source)
    const newConfig = {
      aiSources: {
        ...config?.aiSources,
        current: source
      }
    }
    await api.setConfig(newConfig)
    setConfig({ ...config, ...newConfig } as HaloConfig)
  }

  // Handle OAuth login (generic - works for any provider)
  const handleOAuthLogin = async (providerType: string) => {
    try {
      setLoginState({ provider: providerType, status: t('Starting login...') })
      const result = await api.authStartLogin(providerType)
      if (!result.success) {
        console.error('[Settings] OAuth login start failed:', result.error)
        setLoginState(null)
        return
      }

      // Get state and device code info from start result
      const { state, userCode, verificationUri } = result.data as {
        loginUrl: string
        state: string
        userCode?: string
        verificationUri?: string
      }

      // Update login state with device code info if available
      setLoginState({
        provider: providerType,
        status: userCode ? t('Enter the code in your browser') : t('Waiting for login...'),
        userCode,
        verificationUri
      })

      // Complete login - this polls for the token until user completes login
      const completeResult = await api.authCompleteLogin(providerType, state)
      if (!completeResult.success) {
        console.error('[Settings] OAuth login complete failed:', completeResult.error)
        setLoginState(null)
        return
      }

      // Success! Reload config
      const configResult = await api.getConfig()
      if (configResult.success && configResult.data) {
        setConfig(configResult.data as HaloConfig)
        setCurrentSource(providerType as AISourceType)
      }
      setLoginState(null)
    } catch (err) {
      console.error('[Settings] OAuth login error:', err)
      setLoginState(null)
    }
  }

  // Handle OAuth logout (generic - works for any provider)
  const handleOAuthLogout = async (providerType: string) => {
    try {
      setLoggingOutProvider(providerType)
      await api.authLogout(providerType)
      // Reload config
      const configResult = await api.getConfig()
      if (configResult.success && configResult.data) {
        setConfig(configResult.data as HaloConfig)
        // Switch to custom if available
        if (config?.aiSources?.custom?.apiKey) {
          setCurrentSource('custom')
        }
      }
    } catch (err) {
      console.error('[Settings] OAuth logout error:', err)
    } finally {
      setLoggingOutProvider(null)
    }
  }

  // Handle OAuth model change (generic - works for any provider)
  const handleOAuthModelChange = async (providerType: string, modelId: string) => {
    const providerConfig = config?.aiSources?.[providerType] as OAuthSourceConfig | undefined
    if (!providerConfig) return

    const newConfig = {
      aiSources: {
        ...config?.aiSources,
        [providerType]: {
          ...providerConfig,
          model: modelId
        }
      }
    }
    await api.setConfig(newConfig)
    setConfig({ ...config, ...newConfig } as HaloConfig)
  }

  // Handle save Custom API - validate then save both legacy api and aiSources.custom
  const handleSaveCustomApi = async () => {
    setIsValidating(true)
    setValidationResult(null)

    try {
      // Step 1: Validate API connection with real API call
      // This also normalizes the URL automatically
      const validationResponse = await api.validateApi(apiKey, apiUrl, provider)

      if (!validationResponse.success || !validationResponse.data?.valid) {
        // Validation failed - show error and don't save
        const errorMessage = validationResponse.data?.message || validationResponse.error || t('Connection failed')
        setValidationResult({
          valid: false,
          message: errorMessage
        })
        return
      }

      // Step 2: Validation succeeded - use normalized URL from validation
      const normalizedUrl = validationResponse.data.normalizedUrl || apiUrl
      const detectedModel = validationResponse.data.model

      // Update local state with normalized URL (so user sees the corrected URL)
      if (normalizedUrl !== apiUrl) {
        setApiUrl(normalizedUrl)
        console.log(`[Settings] URL normalized: ${apiUrl} → ${normalizedUrl}`)

        // Show a friendly message that URL was auto-corrected
        setValidationResult({
          valid: true,
          message: t('URL auto-corrected and validated successfully')
        })

        // Wait a moment to let user see the corrected URL
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      // Step 3: Prepare config object with validated data
      const isDefault = editingKey === 'custom' || (!editingKey && !config?.aiSources?.custom?.apiKey && !config?.aiSources?.['custom_']);

      let targetKey = editingKey;
      let newId = (config?.aiSources?.[editingKey || ''] as any)?.id;

      if (!targetKey) {
        // Creating new
        if (isDefault && !config?.aiSources?.custom?.apiKey) {
          targetKey = 'custom'; // First one is always default for back-compat
        } else {
          newId = uuidv4();
          targetKey = `custom_${newId}`;
        }
      }

      // Prepare custom config object with normalized URL
      const customConfig: CustomSourceConfig = {
        id: newId,
        name: customName || (targetKey === 'custom' ? t('Default API') : t('Custom API')),
        type: 'custom',
        provider: provider as any,
        apiKey,
        apiUrl: normalizedUrl, // Use normalized URL
        model: model || detectedModel || (provider === 'anthropic' ? 'claude-opus-4-5-20251101' : 'gpt-4o-mini'),
        availableModels: fetchedModels.length > 0 ? fetchedModels : detectedModel ? [detectedModel] : []
      }

      const updates: Partial<HaloConfig> = {
        aiSources: {
          ...config?.aiSources,
          current: targetKey as AISourceType,
          [targetKey]: customConfig
        }
      }

      // If we are updating the default 'custom' key, also update legacy api field for back-compat
      if (targetKey === 'custom') {
        updates.api = {
          provider: provider as any,
          apiKey,
          apiUrl: normalizedUrl, // Use normalized URL
          model: customConfig.model,
          availableModels: customConfig.availableModels
        }
      }

      // Step 4: Save to backend
      await api.setConfig(updates)
      setConfig({ ...config, ...updates } as HaloConfig)
      setCurrentSource(targetKey as AISourceType)
      setValidationResult({ valid: true, message: t('Connection successful, saved') })

      // Close form after a short delay to let user see success message
      setTimeout(() => {
        setShowCustomApiForm(false)
        setEditingKey(null)
        setValidationResult(null)
      }, 1500)
    } catch (error) {
      console.error('[Settings] Save failed:', error)
      setValidationResult({ valid: false, message: t('Save failed') })
    } finally {
      setIsValidating(false)
    }
  }

  // Handle add new custom source
  const handleAddCustom = () => {
    setEditingKey(null) // null = new
    setProvider('anthropic')
    setApiKey('')
    setApiUrl('https://api.anthropic.com')
    setModel(DEFAULT_MODEL)
    setFetchedModels([])
    setCustomName('')
    setShowCustomApiForm(true)
    setValidationResult(null)
  }

  // Handle edit custom source
  const handleEditCustom = (key: string, source: any) => {
    const config = source as CustomSourceConfig
    setEditingKey(key)
    setProvider(config.provider || 'anthropic')
    setApiKey(config.apiKey || '')
    setApiUrl(config.apiUrl || '')
    setModel(config.model || '')
    setFetchedModels(config.availableModels || [])

    // Determine name
    if (config.name) {
      setCustomName(config.name)
    } else {
      setCustomName(key === 'custom' ? t('Default API') : t('Custom API'))
    }

    setShowCustomApiForm(true)
    setValidationResult(null)
  }

  // Handle delete custom source
  const handleDeleteCustom = async (key: string) => {
    const newAiSources = { ...config?.aiSources }
    delete newAiSources[key]

    // If deleting current source, switch to fallback
    if (config?.aiSources?.current === key) {
      const firstRemain = Object.keys(newAiSources).find(k => k.startsWith('custom') && k !== 'current')
      newAiSources.current = (firstRemain || 'custom') as AISourceType
    }

    const newConfig = { ...config, aiSources: newAiSources } as HaloConfig
    await api.setConfig(newConfig)
    setConfig(newConfig)
    setShowDeleteConfirm(false)
  }


  // Fetch models from custom API
  const fetchModels = async () => {
    if (!apiUrl) {
      setValidationResult({ valid: false, message: t('Please enter API URL first') })
      return
    }
    if (!apiKey) {
      setValidationResult({ valid: false, message: t('Please enter API Key first') })
      return
    }

    setIsFetchingModels(true)
    setValidationResult(null)

    try {
      // For OpenAI compatible APIs, we need to construct the models endpoint
      // The URL normalization happens in validateApi, but for model fetching
      // we need to extract the base URL ourselves
      const trimSlash = (s: string) => s.replace(/\/+$/, '')
      let baseUrl = trimSlash(apiUrl)

      // Remove endpoint suffixes to get base URL
      if (baseUrl.endsWith('/chat/completions')) {
        baseUrl = baseUrl.slice(0, -'/chat/completions'.length)
      } else if (baseUrl.endsWith('/responses')) {
        baseUrl = baseUrl.slice(0, -'/responses'.length)
      } else if (baseUrl.endsWith('/v1/chat')) {
        baseUrl = baseUrl.slice(0, -'/chat'.length)
      }

      // Ensure /v1 is present
      if (!baseUrl.includes('/v1')) {
        baseUrl = `${baseUrl}/v1`
      } else {
        // Extract up to and including /v1
        const v1Idx = baseUrl.indexOf('/v1')
        baseUrl = baseUrl.slice(0, v1Idx + 3)
      }

      const modelsUrl = `${baseUrl}/models`

      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch models (${response.status})`)
      }

      const data = await response.json()

      // OpenAI compatible format: { data: [{ id: 'model-id', ... }] }
      if (data.data && Array.isArray(data.data)) {
        const models = data.data
          .map((m: any) => m.id)
          .filter((id: any) => typeof id === 'string')
          .sort()

        if (models.length === 0) {
          throw new Error('No models found in response')
        }

        setFetchedModels(models)

        // Auto-select first model if current one is not in list or is generic
        if (models.length > 0 && (!model || model === 'gpt-4o-mini' || model === 'deepseek-chat')) {
          setModel(models[0])
        }

        setValidationResult({ valid: true, message: t('Models fetched successfully') })
      } else {
        throw new Error('Invalid API response format')
      }
    } catch (error) {
      console.error('[Settings] Failed to fetch models:', error)
      setValidationResult({ valid: false, message: t('Failed to fetch models') })
    } finally {
      setIsFetchingModels(false)
    }
  }

  // Handle back - return to previous view (not always home)
  const handleBack = () => {
    goBack()
  }

  // Handle check for updates
  const handleCheckForUpdates = async () => {
    setUpdateStatus({ checking: true, hasUpdate: false, upToDate: false })
    await api.checkForUpdates()
  }

  // Handle run diagnostics
  const handleRunDiagnostics = async () => {
    setIsRunningDiagnostics(true)
    setRecoveryResult(null)
    try {
      // First, run immediate health check (PPID scan + service probes)
      const checkResult = await api.runHealthCheck()
      if (checkResult.success && checkResult.data) {
        setHealthCheckResult(checkResult.data)
      }

      // Then, generate the full diagnostic report
      const result = await api.generateHealthReport()
      if (result.success && result.data) {
        setHealthReport(result.data)
        setDiagnosticsExpanded(true)
      }
    } catch (error) {
      console.error('[Settings] Failed to run diagnostics:', error)
    } finally {
      setIsRunningDiagnostics(false)
    }
  }

  // Handle recovery action
  const handleRecovery = async (strategyId: string) => {
    setIsRecovering(strategyId)
    setRecoveryResult(null)
    try {
      const result = await api.triggerHealthRecovery(strategyId, true)
      if (result.success && result.data) {
        setRecoveryResult({
          success: result.data.success,
          message: result.data.message
        })
        // Refresh diagnostics after recovery
        if (result.data.success) {
          setTimeout(handleRunDiagnostics, 1000)
        }
      }
    } catch (error) {
      setRecoveryResult({
        success: false,
        message: t('Recovery failed')
      })
    } finally {
      setIsRecovering(null)
    }
  }

  // Copy report to clipboard
  const handleCopyReport = async () => {
    try {
      const result = await api.generateHealthReportText()
      if (result.success && result.data) {
        await navigator.clipboard.writeText(result.data)
        setReportCopied(true)
        setTimeout(() => setReportCopied(false), 2000)
      }
    } catch (error) {
      console.error('[Settings] Failed to copy report:', error)
    }
  }

  // Export report to file
  const handleExportReport = async () => {
    try {
      const result = await api.exportHealthReport()
      if (result.success && result.data?.path) {
        // Show success message
        setRecoveryResult({
          success: true,
          message: t('Report exported to') + ': ' + result.data.path
        })
        setTimeout(() => setRecoveryResult(null), 3000)
      }
    } catch (error) {
      console.error('[Settings] Failed to export report:', error)
    }
  }

  // Get health status color and icon
  const getHealthStatusStyle = (status: string) => {
    switch (status) {
      case 'healthy':
        return { color: 'text-green-500', bg: 'bg-green-500/10', icon: CheckCircle }
      case 'degraded':
        return { color: 'text-amber-500', bg: 'bg-amber-500/10', icon: AlertTriangle }
      case 'unhealthy':
        return { color: 'text-red-500', bg: 'bg-red-500/10', icon: XOctagon }
      default:
        return { color: 'text-muted-foreground', bg: 'bg-muted', icon: Activity }
    }
  }

  return (
    <div className="h-full w-full flex flex-col">
      {/* Header - cross-platform support */}
      <Header
        left={
          <>
            <button
              onClick={handleBack}
              className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <span className="font-medium text-sm">{t('Settings')}</span>
          </>
        }
      />

      {/* Content */}
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* AI Model Section */}
          <section className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium">{t('AI Model')}</h2>
            </div>

            <div className="space-y-4">
              {/* OAuth Providers - Dynamic rendering */}
              {authProviders
                .filter(p => p.type !== 'custom' && p.enabled)
                .map((provider) => {
                  const providerConfig = config?.aiSources?.[provider.type] as OAuthSourceConfig | undefined
                  const isLoggedIn = providerConfig?.loggedIn === true
                  const isLoggingIn = loginState?.provider === provider.type
                  const isLoggingOut = loggingOutProvider === provider.type
                  const IconComponent = getIconComponent(provider.icon)

                  if (isLoggedIn) {
                    // Logged in card
                    return (
                      <div
                        key={provider.type}
                        className={`p-4 rounded-lg border-2 transition-all cursor-pointer ${currentSource === provider.type
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-muted-foreground/50'
                          }`}
                        onClick={() => handleSwitchSource(provider.type)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {/* Provider Icon */}
                            <div
                              className="w-10 h-10 rounded-lg flex items-center justify-center"
                              style={{ backgroundColor: `${provider.iconBgColor}20` }}
                            >
                              <IconComponent
                                className="w-6 h-6"
                                style={{ color: provider.iconBgColor }}
                              />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{getLocalizedText(provider.displayName)}</span>
                                {currentSource === provider.type && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-primary/20 text-primary flex items-center gap-1">
                                    <Check className="w-3 h-3" />
                                    {t('Active')}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {providerConfig?.user?.name || t('Logged in')}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleOAuthLogout(provider.type)
                            }}
                            disabled={isLoggingOut}
                            className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            title={t('Logout')}
                          >
                            {isLoggingOut ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <LogOut className="w-4 h-4" />
                            )}
                          </button>
                        </div>

                        {/* Model selector for this provider */}
                        {currentSource === provider.type && (
                          <div className="mt-3 pt-3 border-t border-border">
                            <label className="block text-xs text-muted-foreground mb-1.5">{t('Model')}</label>
                            <select
                              value={providerConfig?.model || ''}
                              onChange={(e) => handleOAuthModelChange(provider.type, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full px-3 py-1.5 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                            >
                              {(providerConfig?.availableModels || []).map((modelId) => {
                                const displayName = providerConfig?.modelNames?.[modelId] || modelId
                                return (
                                  <option key={modelId} value={modelId}>
                                    {displayName}
                                  </option>
                                )
                              })}
                            </select>
                          </div>
                        )}
                      </div>
                    )
                  } else if (isLoggingIn) {
                    // Logging in progress
                    return (
                      <div key={provider.type} className="p-4 rounded-lg border border-border bg-muted/30">
                        <div className="flex items-center gap-3">
                          <Loader2 className="w-5 h-5 animate-spin text-primary" />
                          <div>
                            <span className="font-medium">{t('Logging in...')}</span>
                            <p className="text-xs text-muted-foreground">{loginState?.status}</p>
                          </div>
                        </div>

                        {/* Device code display for OAuth Device Code flow */}
                        {loginState?.userCode && loginState?.verificationUri && (
                          <div className="mt-4 p-4 bg-background border border-border rounded-lg">
                            <p className="text-xs text-muted-foreground mb-1">
                              {t('Visit this URL to login:')}
                            </p>
                            <a
                              href={loginState.verificationUri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline font-mono text-xs"
                            >
                              {loginState.verificationUri}
                            </a>
                            <p className="text-xs text-muted-foreground mt-3 mb-1">
                              {t('Enter this code:')}
                            </p>
                            <div className="flex items-center gap-2">
                              <code className="text-lg font-bold font-mono tracking-widest bg-muted px-3 py-1 rounded border border-border select-all">
                                {loginState.userCode}
                              </code>
                              <button
                                onClick={() => navigator.clipboard.writeText(loginState.userCode!)}
                                className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                                title={t('Copy code')}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  } else {
                    // Not logged in - show add button
                    return (
                      <button
                        key={provider.type}
                        onClick={() => handleOAuthLogin(provider.type)}
                        className="w-full p-4 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center gap-3"
                      >
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: `${provider.iconBgColor}10` }}
                        >
                          <Plus className="w-5 h-5" style={{ color: provider.iconBgColor }} />
                        </div>
                        <div className="text-left">
                          <span className="font-medium">{t('Add')} {getLocalizedText(provider.displayName)}</span>
                          <p className="text-xs text-muted-foreground">{getLocalizedText(provider.description)}</p>
                        </div>
                      </button>
                    )
                  }
                })}

              {/* Custom API Sources List */}
              {Object.keys(config?.aiSources || {})
                .filter(key => key === 'custom' || key.startsWith('custom_') || (config?.aiSources?.[key] as any)?.type === 'custom')
                .sort((a, b) => (a === 'custom' ? -1 : b === 'custom' ? 1 : a.localeCompare(b)))
                .map(key => {
                  const sourceConfig = config?.aiSources?.[key] as CustomSourceConfig
                  const isEditing = showCustomApiForm && editingKey === key
                  const isActive = currentSource === key

                  if (!sourceConfig || (!sourceConfig.apiKey && !isEditing)) return null

                  return (
                    <div
                      key={key}
                      className={`rounded-lg border-2 transition-all ${isActive
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/50'
                        }`}
                    >
                      {/* Card Header / Summary */}
                      <div
                        className="p-4 cursor-pointer flex items-center justify-between"
                        onClick={() => handleSwitchSource(key as AISourceType)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-[#da7756]/20 flex items-center justify-center">
                            <svg className="w-6 h-6 text-[#da7756]" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M4.709 15.955l4.72-2.647.08-.08 2.726-1.529.08-.08 6.206-3.48a.25.25 0 00.125-.216V6.177a.25.25 0 00-.375-.217l-6.206 3.48-.08.08-2.726 1.53-.08.079-4.72 2.647a.25.25 0 00-.125.217v1.746c0 .18.193.294.354.216h.001zm13.937-3.584l-4.72 2.647-.08.08-2.726 1.529-.08.08-6.206 3.48a.25.25 0 00-.125.216v1.746a.25.25 0 00.375.217l6.206-3.48.08-.08 2.726-1.53.08-.079 4.72-2.647a.25.25 0 00.125-.217v-1.746a.25.25 0 00-.375-.216z" />
                            </svg>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {sourceConfig.name || (sourceConfig.provider === 'anthropic' ? 'Claude API' : t('Custom API'))}
                              </span>
                              {isActive && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-primary/20 text-primary flex items-center gap-1">
                                  <Check className="w-3 h-3" />
                                  {t('Active')}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {/* Show model name */}
                              {AVAILABLE_MODELS.find(m => m.id === sourceConfig.model)?.name || sourceConfig.model}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleEditCustom(key, sourceConfig)
                            }}
                            className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
                            title={t('Edit')}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {/* Allow deleting any custom source except maybe if it's the only one? Or just allow deleting */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (window.confirm(t('Are you sure you want to delete this configuration?'))) {
                                handleDeleteCustom(key)
                              }
                            }}
                            className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            title={t('Delete')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Edit Form (Expanded) */}
                      {isEditing && (
                        <div className="p-4 pt-0 border-t border-border mt-4" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-4 pt-4">
                            {/* Name */}
                            <div>
                              <label className="block text-xs text-muted-foreground mb-1.5">{t('Name')}</label>
                              <input
                                type="text"
                                value={customName}
                                onChange={(e) => setCustomName(e.target.value)}
                                placeholder={t('My Custom API')}
                                className="w-full px-3 py-1.5 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                              />
                            </div>

                            {/* Provider */}
                            <div>
                              <label className="block text-xs text-muted-foreground mb-1.5">Provider</label>
                              <select
                                value={provider}
                                onChange={(e) => {
                                  const next = e.target.value as any
                                  setProvider(next)
                                  setValidationResult(null)
                                  if (next === 'anthropic') {
                                    if (!apiUrl || apiUrl.includes('openai')) setApiUrl('https://api.anthropic.com')
                                    if (!model || !model.startsWith('claude-')) {
                                      setModel(DEFAULT_MODEL)
                                      setUseCustomModel(false)
                                    }
                                  } else if (next === 'openai') {
                                    if (!apiUrl || apiUrl.includes('anthropic')) setApiUrl('https://api.openai.com')
                                    if (!model || model.startsWith('claude-')) setModel('gpt-4o-mini')
                                  }
                                }}
                                className="w-full px-3 py-1.5 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                              >
                                <option value="anthropic">{t('Claude (Recommended)')}</option>
                                <option value="openai">{t('OpenAI Compatible')}</option>
                              </select>
                            </div>

                            {/* API Key */}
                            <div>
                              <label className="block text-xs text-muted-foreground mb-1.5">API Key</label>
                              <div className="relative">
                                <input
                                  type={showApiKey ? 'text' : 'password'}
                                  value={apiKey}
                                  onChange={(e) => setApiKey(e.target.value)}
                                  placeholder={provider === 'openai' ? 'sk-xxxxxxxxxxxxx' : 'sk-ant-xxxxxxxxxxxxx'}
                                  className="w-full px-3 py-1.5 pr-10 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowApiKey(!showApiKey)}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>

                            {/* API URL */}
                            <div>
                              <label className="block text-xs text-muted-foreground mb-1.5">API URL</label>
                              <input
                                type="text"
                                value={apiUrl}
                                onChange={(e) => setApiUrl(e.target.value)}
                                placeholder="https://api.anthropic.com"
                                className="w-full px-3 py-1.5 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                              />
                            </div>

                            {/* Model */}
                            <div>
                              <label className="block text-xs text-muted-foreground mb-1.5">{t('Model')}</label>
                              {provider === 'anthropic' && !useCustomModel ? (
                                <select
                                  value={model}
                                  onChange={(e) => setModel(e.target.value)}
                                  className="w-full px-3 py-1.5 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                                >
                                  {AVAILABLE_MODELS.map((m) => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <div className="flex gap-2">
                                  <div className="relative flex-1">
                                    {fetchedModels.length > 0 ? (
                                      <select
                                        value={model}
                                        onChange={(e) => setModel(e.target.value)}
                                        className="w-full px-3 py-1.5 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors appearance-none"
                                      >
                                        {!fetchedModels.includes(model) && model && (
                                          <option value={model}>{model}</option>
                                        )}
                                        {fetchedModels.map((m) => (
                                          <option key={m} value={m}>
                                            {m}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <input
                                        type="text"
                                        value={model}
                                        onChange={(e) => setModel(e.target.value)}
                                        placeholder={provider === 'openai' ? "gpt-4o-mini" : "claude-sonnet"}
                                        className="w-full px-3 py-1.5 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                                      />
                                    )}
                                    {fetchedModels.length > 0 && (
                                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      </div>
                                    )}
                                  </div>

                                  <button
                                    type="button"
                                    onClick={fetchModels}
                                    disabled={isFetchingModels || !apiKey || !apiUrl}
                                    className="px-2.5 py-1.5 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg border border-border transition-colors disabled:opacity-50"
                                    title={t('Fetch available models')}
                                  >
                                    <RefreshCw className={`w-3.5 h-3.5 ${isFetchingModels ? 'animate-spin' : ''}`} />
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Save/Cancel button */}
                            <div className="flex items-center gap-3">
                              <button
                                onClick={handleSaveCustomApi}
                                disabled={isValidating || !apiKey}
                                className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                              >
                                {isValidating ? t('Testing connection...') : t('Connect and Save')}
                              </button>
                              <button
                                onClick={() => {
                                  setShowCustomApiForm(false)
                                  setEditingKey(null)
                                }}
                                className="px-4 py-1.5 text-sm text-muted-foreground hover:bg-secondary rounded-lg transition-colors"
                              >
                                {t('Cancel')}
                              </button>
                              {validationResult && (
                                <span className={`text-xs flex items-center gap-1 ${validationResult.valid ? 'text-green-500' : 'text-red-500'}`}>
                                  {validationResult.valid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                                  {validationResult.message}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}

              {/* Add Custom API Button (Always visible at bottom) */}
              {!showCustomApiForm || editingKey !== null ? (
                <button
                  onClick={handleAddCustom}
                  className="w-full p-4 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-lg bg-[#da7756]/10 flex items-center justify-center">
                    <Plus className="w-5 h-5 text-[#da7756]" />
                  </div>
                  <div className="text-left">
                    <span className="font-medium">{t('Add Custom API')}</span>
                    <p className="text-xs text-muted-foreground">{t('Connect to OpenAI, Local LLMs, etc.')}</p>
                  </div>
                </button>
              ) : (
                /* Creating New Form */
                <div className="p-4 rounded-lg border border-border space-y-4">
                  <h3 className="font-medium">{t('Configure New API')}</h3>

                  {/* Reuse Form Logic - Ideally this should be a component, but copying for now to ensure speed */}
                  <div className="space-y-4 pt-2">
                    {/* Name */}
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">{t('Name')}</label>
                      <input
                        type="text"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        placeholder={t('My Custom API')}
                        className="w-full px-3 py-1.5 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                      />
                    </div>

                    {/* Provider */}
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">Provider</label>
                      <select
                        value={provider}
                        onChange={(e) => {
                          const next = e.target.value as any
                          setProvider(next)
                          setValidationResult(null)
                          if (next === 'anthropic') {
                            if (!apiUrl || apiUrl.includes('openai')) setApiUrl('https://api.anthropic.com')
                            if (!model || !model.startsWith('claude-')) {
                              setModel(DEFAULT_MODEL)
                              setUseCustomModel(false)
                            }
                          } else if (next === 'openai') {
                            if (!apiUrl || apiUrl.includes('anthropic')) setApiUrl('https://api.openai.com')
                            if (!model || model.startsWith('claude-')) setModel('gpt-4o-mini')
                          }
                        }}
                        className="w-full px-3 py-1.5 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                      >
                        <option value="anthropic">{t('Claude (Recommended)')}</option>
                        <option value="openai">{t('OpenAI Compatible')}</option>
                      </select>
                    </div>

                    {/* API Key */}
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">API Key</label>
                      <div className="relative">
                        <input
                          type={showApiKey ? 'text' : 'password'}
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={provider === 'openai' ? 'sk-xxxxxxxxxxxxx' : 'sk-ant-xxxxxxxxxxxxx'}
                          className="w-full px-3 py-1.5 pr-10 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* API URL */}
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">API URL</label>
                      <input
                        type="text"
                        value={apiUrl}
                        onChange={(e) => setApiUrl(e.target.value)}
                        placeholder="https://api.anthropic.com"
                        className="w-full px-3 py-1.5 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                      />
                    </div>

                    {/* Model */}
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">{t('Model')}</label>
                      {provider === 'anthropic' && !useCustomModel ? (
                        <select
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                        >
                          {AVAILABLE_MODELS.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            {fetchedModels.length > 0 ? (
                              <select
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                                className="w-full px-3 py-1.5 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors appearance-none"
                              >
                                {!fetchedModels.includes(model) && model && (
                                  <option value={model}>{model}</option>
                                )}
                                {fetchedModels.map((m) => (
                                  <option key={m} value={m}>
                                    {m}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                                placeholder={provider === 'openai' ? "gpt-4o-mini" : "claude-sonnet"}
                                className="w-full px-3 py-1.5 text-sm bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                              />
                            )}
                            {fetchedModels.length > 0 && (
                              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                                <ChevronDown className="w-3.5 h-3.5" />
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={fetchModels}
                            disabled={isFetchingModels || !apiKey || !apiUrl}
                            className="px-2.5 py-1.5 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg border border-border transition-colors disabled:opacity-50"
                            title={t('Fetch available models')}
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isFetchingModels ? 'animate-spin' : ''}`} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Save/Cancel button */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleSaveCustomApi}
                        disabled={isValidating || !apiKey}
                        className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {isValidating ? t('Testing connection...') : t('Connect and Save')}
                      </button>
                      <button
                        onClick={() => {
                          setShowCustomApiForm(false)
                          setEditingKey(null)
                        }}
                        className="px-4 py-1.5 text-sm text-muted-foreground hover:bg-secondary rounded-lg transition-colors"
                      >
                        {t('Cancel')}
                      </button>
                      {validationResult && (
                        <span className={`text-xs flex items-center gap-1 ${validationResult.valid ? 'text-green-500' : 'text-red-500'}`}>
                          {validationResult.valid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                          {validationResult.message}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Permissions Section */}
          <section className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium">{t('Permissions')}</h2>
              <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-500">
                {t('Full Permission Mode')}
              </span>
            </div>

            {/* Info banner */}
            <div className="bg-muted/50 rounded-lg p-3 mb-4 text-sm text-muted-foreground">
              {t('We recommend full trust mode - use natural language to control Halo. UI-based permission settings coming in future versions.')}
            </div>

            <div className="space-y-4 opacity-50">
              {/* File Access */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{t('File Read/Write')}</p>
                  <p className="text-sm text-muted-foreground">{t('Allow AI to read and create files')}</p>
                </div>
                <select
                  value="allow"
                  disabled
                  className="px-3 py-1 bg-input rounded-lg border border-border cursor-not-allowed"
                >
                  <option value="allow">{t('Allow')}</option>
                </select>
              </div>

              {/* Command Execution */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{t('Execute Commands')}</p>
                  <p className="text-sm text-muted-foreground">{t('Allow AI to execute terminal commands')}</p>
                </div>
                <select
                  value="allow"
                  disabled
                  className="px-3 py-1 bg-input rounded-lg border border-border cursor-not-allowed"
                >
                  <option value="allow">{t('Allow')}</option>
                </select>
              </div>

              {/* Trust Mode */}
              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div>
                  <p className="font-medium">{t('Trust Mode')}</p>
                  <p className="text-sm text-muted-foreground">{t('Automatically execute all operations')}</p>
                </div>
                <label className="relative inline-flex items-center cursor-not-allowed">
                  <input
                    type="checkbox"
                    checked={true}
                    disabled
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-primary rounded-full">
                    <div className="w-5 h-5 bg-white rounded-full shadow-md transform translate-x-5 mt-0.5" />
                  </div>
                </label>
              </div>
            </div>
          </section>

          {/* Appearance Section */}
          <section className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-medium mb-4">{t('Appearance')}</h2>

            <div>
              <label className="block text-sm text-muted-foreground mb-2">{t('Theme')}</label>
              <div className="flex gap-4">
                {(['light', 'dark', 'system'] as ThemeMode[]).map((themeMode) => (
                  <button
                    key={themeMode}
                    onClick={() => handleThemeChange(themeMode)}
                    className={`px-4 py-2 rounded-lg transition-colors ${theme === themeMode
                      ? 'bg-primary/20 text-primary border border-primary'
                      : 'bg-secondary hover:bg-secondary/80'
                      }`}
                  >
                    {themeMode === 'light' ? t('Light') : themeMode === 'dark' ? t('Dark') : t('Follow System')}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Language Section */}
          <section className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-medium mb-4">{t('Language')}</h2>

            <div>
              <label className="block text-sm text-muted-foreground mb-2">{t('Language')}</label>
              <select
                value={getCurrentLanguage()}
                onChange={(e) => setLanguage(e.target.value as LocaleCode)}
                className="w-full px-4 py-2 bg-input rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
              >
                {Object.entries(SUPPORTED_LOCALES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* System Section */}
          {!api.isRemoteMode() && (
            <section className="bg-card rounded-xl border border-border p-6">
              <h2 className="text-lg font-medium mb-4">{t('System')}</h2>

              <div className="space-y-4">
                {/* Auto Launch */}
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{t('Auto Launch on Startup')}</p>
                      <span
                        className="inline-flex items-center justify-center w-4 h-4 text-xs rounded-full bg-muted text-muted-foreground cursor-help"
                        title={t('Automatically run Halo when system starts')}
                      >
                        ?
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('Automatically run Halo when system starts')}
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoLaunch}
                      onChange={(e) => handleAutoLaunchChange(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-secondary rounded-full peer peer-checked:bg-primary transition-colors">
                      <div
                        className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${autoLaunch ? 'translate-x-5' : 'translate-x-0.5'
                          } mt-0.5`}
                      />
                    </div>
                  </label>
                </div>

                {/* Open Log Folder */}
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <div className="flex-1">
                    <p className="font-medium">{t('Log Files')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('Open log folder for troubleshooting')}
                    </p>
                  </div>
                  <button
                    onClick={() => api.openLogFolder()}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded-lg transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" />
                    {t('Open Folder')}
                  </button>
                </div>

                {/* System Diagnostics */}
                <div className="pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-medium">{t('System Diagnostics')}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('Check system health and fix issues')}
                      </p>
                    </div>
                    <button
                      onClick={handleRunDiagnostics}
                      disabled={isRunningDiagnostics}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isRunningDiagnostics ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Activity className="w-4 h-4" />
                      )}
                      {isRunningDiagnostics ? t('Running...') : t('Run Diagnostics')}
                    </button>
                  </div>

                  {/* Diagnostics Results */}
                  {healthReport && (
                    <div className="mt-4 space-y-3">
                      {/* Health Status Summary */}
                      <div
                        className={`p-4 rounded-lg ${getHealthStatusStyle('healthy').bg} cursor-pointer`}
                        onClick={() => setDiagnosticsExpanded(!diagnosticsExpanded)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {(() => {
                              const hasIssues = healthReport.health.consecutiveFailures > 0 ||
                                healthReport.processes.orphansFound > 0 ||
                                healthReport.recentErrors.length > 0
                              const StatusIcon = hasIssues ? AlertTriangle : CheckCircle
                              const statusColor = hasIssues ? 'text-amber-500' : 'text-green-500'
                              return (
                                <>
                                  <StatusIcon className={`w-5 h-5 ${statusColor}`} />
                                  <div>
                                    <p className="font-medium">
                                      {hasIssues ? t('Issues Detected') : t('System Healthy')}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {t('Last check')}: {new Date(healthReport.timestamp).toLocaleString()}
                                    </p>
                                  </div>
                                </>
                              )
                            })()}
                          </div>
                          <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${diagnosticsExpanded ? 'rotate-90' : ''}`} />
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {diagnosticsExpanded && (
                        <div className="space-y-3 animate-in slide-in-from-top-2 duration-200">
                          {/* System Info */}
                          <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('System Info')}</p>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t('Version')}</span>
                                <span>{healthReport.version}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t('Platform')}</span>
                                <span>{healthReport.platform} ({healthReport.arch})</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t('Memory')}</span>
                                <span>{healthReport.system.memory.free} / {healthReport.system.memory.total}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t('Uptime')}</span>
                                <span>{Math.floor(healthReport.system.uptime / 3600)}h {Math.floor((healthReport.system.uptime % 3600) / 60)}m</span>
                              </div>
                            </div>
                          </div>

                          {/* Health Metrics */}
                          <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('Health Metrics')}</p>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t('Consecutive Failures')}</span>
                                <span className={healthReport.health.consecutiveFailures > 0 ? 'text-amber-500' : ''}>
                                  {healthReport.health.consecutiveFailures}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t('Recovery Attempts')}</span>
                                <span>{healthReport.health.recoveryAttempts}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t('Active Processes')}</span>
                                <span>{healthReport.processes.registered}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">{t('Orphans Found')}</span>
                                <span className={healthReport.processes.orphansFound > 0 ? 'text-amber-500' : ''}>
                                  {healthReport.processes.orphansFound}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Process Status (from PPID scan) */}
                          {healthCheckResult && (
                            <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('Process Status')}</p>
                              <div className="space-y-2">
                                {/* Claude processes */}
                                <div className="flex items-center justify-between text-sm">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${healthCheckResult.processes.claude.healthy ? 'bg-green-500' : 'bg-amber-500'}`} />
                                    <span className="text-muted-foreground">Claude (AI Sessions)</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className={healthCheckResult.processes.claude.healthy ? '' : 'text-amber-500'}>
                                      {healthCheckResult.processes.claude.actual} {t('running')}
                                    </span>
                                    {healthCheckResult.processes.claude.pids.length > 0 && (
                                      <span className="text-xs text-muted-foreground">
                                        (PID: {healthCheckResult.processes.claude.pids.join(', ')})
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {/* Cloudflared processes */}
                                <div className="flex items-center justify-between text-sm">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${healthCheckResult.processes.cloudflared.actual === 0 ? 'bg-muted-foreground' : healthCheckResult.processes.cloudflared.healthy ? 'bg-green-500' : 'bg-amber-500'}`} />
                                    <span className="text-muted-foreground">Cloudflared (Tunnel)</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className={healthCheckResult.processes.cloudflared.actual === 0 ? 'text-muted-foreground' : healthCheckResult.processes.cloudflared.healthy ? '' : 'text-amber-500'}>
                                      {healthCheckResult.processes.cloudflared.actual === 0 ? t('Not running') : `${healthCheckResult.processes.cloudflared.actual} ${t('running')}`}
                                    </span>
                                    {healthCheckResult.processes.cloudflared.pids.length > 0 && (
                                      <span className="text-xs text-muted-foreground">
                                        (PID: {healthCheckResult.processes.cloudflared.pids.join(', ')})
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Service Status (HTTP probes) */}
                          {healthCheckResult && (
                            <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('Service Status')}</p>
                              <div className="space-y-2">
                                {/* OpenAI Router */}
                                <div className="flex items-center justify-between text-sm">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${
                                      healthCheckResult.services.openaiRouter.port === null ? 'bg-muted-foreground' :
                                      healthCheckResult.services.openaiRouter.responsive ? 'bg-green-500' : 'bg-red-500'
                                    }`} />
                                    <span className="text-muted-foreground">OpenAI Router</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {healthCheckResult.services.openaiRouter.port === null ? (
                                      <span className="text-muted-foreground">{t('Not started')}</span>
                                    ) : healthCheckResult.services.openaiRouter.responsive ? (
                                      <>
                                        <span className="text-green-500">{t('Healthy')}</span>
                                        <span className="text-xs text-muted-foreground">
                                          (:{healthCheckResult.services.openaiRouter.port}, {healthCheckResult.services.openaiRouter.responseTime}ms)
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="text-red-500">{t('Not responding')}</span>
                                        <span className="text-xs text-muted-foreground">
                                          (:{healthCheckResult.services.openaiRouter.port})
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                {/* HTTP Server */}
                                <div className="flex items-center justify-between text-sm">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${
                                      healthCheckResult.services.httpServer.port === null ? 'bg-muted-foreground' :
                                      healthCheckResult.services.httpServer.responsive ? 'bg-green-500' : 'bg-red-500'
                                    }`} />
                                    <span className="text-muted-foreground">HTTP Server</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {healthCheckResult.services.httpServer.port === null ? (
                                      <span className="text-muted-foreground">{t('Not started')}</span>
                                    ) : healthCheckResult.services.httpServer.responsive ? (
                                      <>
                                        <span className="text-green-500">{t('Healthy')}</span>
                                        <span className="text-xs text-muted-foreground">
                                          (:{healthCheckResult.services.httpServer.port}, {healthCheckResult.services.httpServer.responseTime}ms)
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="text-red-500">{t('Not responding')}</span>
                                        <span className="text-xs text-muted-foreground">
                                          (:{healthCheckResult.services.httpServer.port})
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Registry Cleanup (if any) */}
                          {healthCheckResult && (healthCheckResult.registryCleanup.removed > 0 || healthCheckResult.registryCleanup.orphans > 0) && (
                            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 space-y-1">
                              <p className="text-xs font-medium text-amber-500 uppercase tracking-wide">{t('Cleanup Actions')}</p>
                              <div className="text-sm text-amber-500">
                                {healthCheckResult.registryCleanup.removed > 0 && (
                                  <p>{t('Removed {{count}} dead process entries', { count: healthCheckResult.registryCleanup.removed })}</p>
                                )}
                                {healthCheckResult.registryCleanup.orphans > 0 && (
                                  <p>{t('Found {{count}} orphan processes', { count: healthCheckResult.registryCleanup.orphans })}</p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Recent Errors */}
                          {healthReport.recentErrors.length > 0 && (
                            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 space-y-2">
                              <p className="text-xs font-medium text-red-500 uppercase tracking-wide">{t('Recent Errors')}</p>
                              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                                {healthReport.recentErrors.slice(0, 5).map((error, index) => (
                                  <div key={index} className="text-xs">
                                    <span className="text-muted-foreground">{error.time}</span>
                                    <span className="mx-1 text-muted-foreground">-</span>
                                    <span className="text-red-400">{error.message}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Recovery Actions */}
                          <div className="bg-muted/30 rounded-lg p-3 space-y-3">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('Recovery Actions')}</p>

                            {/* Recovery Result */}
                            {recoveryResult && (
                              <div className={`p-2 rounded-lg text-sm ${recoveryResult.success ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                {recoveryResult.message}
                              </div>
                            )}

                            <div className="flex flex-wrap gap-2">
                              {/* S2: Reset Agent Engine */}
                              <button
                                onClick={() => handleRecovery('S2')}
                                disabled={isRecovering !== null}
                                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 rounded-lg transition-colors disabled:opacity-50"
                                title={t('Kill all AI sessions and restart - fixes most issues')}
                              >
                                {isRecovering === 'S2' ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="w-3.5 h-3.5" />
                                )}
                                {t('Reset AI Engine')}
                              </button>

                              {/* S3: Restart App */}
                              <button
                                onClick={() => handleRecovery('S3')}
                                disabled={isRecovering !== null}
                                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                                title={t('Restart the entire application')}
                              >
                                {isRecovering === 'S3' ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-3.5 h-3.5" />
                                )}
                                {t('Restart App')}
                              </button>
                            </div>
                          </div>

                          {/* Export Actions */}
                          <div className="flex items-center gap-2 pt-2">
                            <button
                              onClick={handleCopyReport}
                              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              {reportCopied ? t('Copied!') : t('Copy Report')}
                            </button>
                            <button
                              onClick={handleExportReport}
                              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              {t('Export Report')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            </section>
          )}

          {/* MCP Servers Section */}
          <section className="bg-card rounded-xl border border-border p-6">
            <McpServerList
              servers={config?.mcpServers || {}}
              onSave={handleMcpServersSave}
            />

            {/* Help text */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{t('Format compatible with Cursor / Claude Desktop')}</span>
                <a
                  href="https://modelcontextprotocol.io/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:text-primary/80 transition-colors"
                >
                  {t('Learn about MCP')} →
                </a>
              </div>
              <p className="text-xs text-amber-500/80">
                ⚠️ {t('Configuration changes will take effect after starting a new conversation')}
              </p>
            </div>
          </section>

          {/* Remote Access Section - Only show in desktop app (not in remote mode) */}
          {!api.isRemoteMode() && (
          <section className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-medium mb-4">{t('Remote Access')}</h2>

            {/* Security Warning */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <span className="text-amber-500 text-xl">⚠️</span>
                <div className="text-sm">
                  <p className="text-amber-500 font-medium mb-1">{t('Security Warning')}</p>
                  <p className="text-amber-500/80">
                    {t('After enabling remote access, anyone with the password can fully control your computer (read/write files, execute commands). Do not share the access password with untrusted people.')}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {/* Enable/Disable Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{t('Enable Remote Access')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('Allow access to Halo from other devices')}
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={remoteStatus?.enabled || false}
                    onChange={handleToggleRemote}
                    disabled={isEnablingRemote}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-secondary rounded-full peer peer-checked:bg-primary transition-colors">
                    <div
                      className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${remoteStatus?.enabled ? 'translate-x-5' : 'translate-x-0.5'
                        } mt-0.5`}
                    />
                  </div>
                </label>
              </div>

              {/* Remote Access Details */}
              {remoteStatus?.enabled && (
                <>
                  {/* Local Access */}
                  <div className="bg-secondary/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{t('Local Address')}</span>
                      <div className="flex items-center gap-2">
                        <code className="text-sm bg-background px-2 py-1 rounded">
                          {remoteStatus.server.localUrl}
                        </code>
                        <button
                          onClick={() => copyToClipboard(remoteStatus.server.localUrl || '')}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          {t('Copy')}
                        </button>
                      </div>
                    </div>

                    {remoteStatus.server.lanUrl && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t('LAN Address')}</span>
                        <div className="flex items-center gap-2">
                          <code className="text-sm bg-background px-2 py-1 rounded">
                            {remoteStatus.server.lanUrl}
                          </code>
                          <button
                            onClick={() => copyToClipboard(remoteStatus.server.lanUrl || '')}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            {t('Copy')}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t('Access Password')}</span>
                        {!isEditingPassword ? (
                          <div className="flex items-center gap-2">
                            <code className="text-sm bg-background px-2 py-1 rounded font-mono tracking-wider">
                              {showPassword ? remoteStatus.server.token : '••••••••'}
                            </code>
                            <button
                              onClick={() => setShowPassword(!showPassword)}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              {showPassword ? t('Hide') : t('Show')}
                            </button>
                            <button
                              onClick={() => copyToClipboard(remoteStatus.server.token || '')}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              {t('Copy')}
                            </button>
                            <button
                              onClick={() => {
                                setIsEditingPassword(true)
                                setCustomPassword('')
                                setPasswordError(null)
                              }}
                              className="text-xs text-primary hover:text-primary/80"
                            >
                              {t('Edit')}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={customPassword}
                              onChange={(e) => {
                                setCustomPassword(e.target.value)
                                setPasswordError(null)
                              }}
                              placeholder={t('4-32 characters')}
                              maxLength={32}
                              className="w-32 px-2 py-1 text-sm bg-input rounded border border-border focus:border-primary focus:outline-none"
                            />
                            <button
                              onClick={async () => {
                                if (customPassword.length < 4) {
                                  setPasswordError(t('Password too short'))
                                  return
                                }
                                setIsSavingPassword(true)
                                setPasswordError(null)
                                try {
                                  const res = await api.setRemotePassword(customPassword)
                                  if (res.success) {
                                    setIsEditingPassword(false)
                                    setCustomPassword('')
                                    loadRemoteStatus()
                                  } else {
                                    setPasswordError(res.error || t('Failed to set password'))
                                  }
                                } catch (error) {
                                  setPasswordError(t('Failed to set password'))
                                } finally {
                                  setIsSavingPassword(false)
                                }
                              }}
                              disabled={isSavingPassword || customPassword.length < 4}
                              className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                            >
                              {isSavingPassword ? t('Saving...') : t('Save')}
                            </button>
                            <button
                              onClick={() => {
                                setIsEditingPassword(false)
                                setCustomPassword('')
                                setPasswordError(null)
                              }}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              {t('Cancel')}
                            </button>
                          </div>
                        )}
                      </div>
                      {passwordError && (
                        <p className="text-xs text-red-500">{passwordError}</p>
                      )}
                    </div>

                    {remoteStatus.clients > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{t('Connected Devices')}</span>
                        <span className="text-green-500">{t('{{count}} devices', { count: remoteStatus.clients })}</span>
                      </div>
                    )}
                  </div>

                  {/* Tunnel Section */}
                  <div className="pt-4 border-t border-border">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-medium">{t('Internet Access')}</p>
                        <p className="text-sm text-muted-foreground">
                          {t('Get public address via Cloudflare (wait about 10 seconds for DNS resolution after startup)')}
                        </p>
                      </div>
                      <button
                        onClick={handleToggleTunnel}
                        disabled={isEnablingTunnel}
                        className={`px-4 py-2 rounded-lg text-sm transition-colors ${remoteStatus.tunnel.status === 'running'
                          ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
                          : 'bg-primary/20 text-primary hover:bg-primary/30'
                          }`}
                      >
                        {isEnablingTunnel
                          ? t('Connecting...')
                          : remoteStatus.tunnel.status === 'running'
                            ? t('Stop Tunnel')
                            : remoteStatus.tunnel.status === 'starting'
                              ? t('Connecting...')
                              : t('Start Tunnel')}
                      </button>
                    </div>

                    {remoteStatus.tunnel.status === 'running' && remoteStatus.tunnel.url && (
                      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-green-500">{t('Public Address')}</span>
                          <div className="flex items-center gap-2">
                            <code className="text-sm bg-background px-2 py-1 rounded text-green-500">
                              {remoteStatus.tunnel.url}
                            </code>
                            <button
                              onClick={() => copyToClipboard(remoteStatus.tunnel.url || '')}
                              className="text-xs text-green-500/80 hover:text-green-500"
                            >
                              {t('Copy')}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {remoteStatus.tunnel.status === 'error' && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                        <p className="text-sm text-red-500">
                          {t('Tunnel connection failed')}: {remoteStatus.tunnel.error}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* QR Code */}
                  {qrCode && (
                    <div className="pt-4 border-t border-border">
                      <p className="font-medium mb-3">{t('Scan to Access')}</p>
                      <div className="flex flex-col items-center gap-3">
                        <div className="bg-white p-3 rounded-xl">
                          <img src={qrCode} alt="QR Code" className="w-48 h-48" />
                        </div>
                        <div className="text-center text-sm">
                          <p className="text-muted-foreground">
                            {t('Scan the QR code with your phone to access')}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
          )}

          {/* About Section */}
          <section className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-medium mb-4">{t('About')}</h2>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">{t('Version')}</span>
                <div className="flex items-center gap-3">
                  <span>{appVersion || '-'}</span>
                  <button
                    onClick={handleCheckForUpdates}
                    disabled={updateStatus.checking}
                    className="text-xs text-primary hover:text-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {updateStatus.checking ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {t('Checking...')}
                      </span>
                    ) : updateStatus.hasUpdate ? (
                      <span className="text-emerald-500">{t('New version available')}: {updateStatus.version}</span>
                    ) : updateStatus.upToDate ? (
                      <span className="text-muted-foreground">{t('Already up to date')}</span>
                    ) : (
                      t('Check for updates')
                    )}
                  </button>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('Build')}</span>
                <span> Powered by Claude Code </span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
