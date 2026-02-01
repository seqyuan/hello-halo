/**
 * AI Model Section Component
 * Manages AI source configuration including OAuth providers and custom API keys
 */

import { useState, useEffect, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  Loader2, LogOut, Plus, Check, Globe, Key, RefreshCw, ChevronDown, Edit2, Trash2
} from 'lucide-react'
import { CheckCircle2, XCircle, Eye, EyeOff } from '../icons/ToolIcons'
import { useTranslation, getCurrentLanguage } from '../../i18n'
import { api } from '../../api'
import type {
  HaloConfig, AISourceType, OAuthSourceConfig, CustomSourceConfig
} from '../../types'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '../../types'
import type { LucideIcon } from 'lucide-react'

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

// Icon mapping for dynamic rendering
const ICON_MAP: Record<string, LucideIcon> = {
  globe: Globe,
  key: Key,
}

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

// Get icon component by name
function getIconComponent(iconName: string): LucideIcon {
  return ICON_MAP[iconName] || Globe
}

interface AIModelSectionProps {
  config: HaloConfig | null
  setConfig: (config: HaloConfig) => void
}

export function AIModelSection({ config, setConfig }: AIModelSectionProps) {
  const { t } = useTranslation()

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

  // Custom API multi-config support
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [customName, setCustomName] = useState('')

  // Custom model toggle
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

  // API Key visibility state
  const [showApiKey, setShowApiKey] = useState(false)

  // Sync state when config changes
  useEffect(() => {
    if (config?.aiSources?.current) {
      setCurrentSource(config.aiSources.current)
    }
  }, [config?.aiSources?.current])

  // Load auth providers and refresh AI sources config
  useEffect(() => {
    api.authGetProviders().then((result) => {
      if (result.success && result.data) {
        setAuthProviders(result.data as AuthProviderConfig[])
      }
    })

    api.refreshAISourcesConfig().then((result) => {
      if (result.success) {
        api.getConfig().then((configResult) => {
          if (configResult.success && configResult.data) {
            setConfig(configResult.data as HaloConfig)
          }
        })
      }
    })

    const unsubscribe = api.onAuthLoginProgress((data: { provider: string; status: string }) => {
      setLoginState(data)
      if (data.status === 'completed' || data.status === 'failed') {
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

  // Handle OAuth login
  const handleOAuthLogin = async (providerType: string) => {
    try {
      setLoginState({ provider: providerType, status: t('Starting login...') })
      const result = await api.authStartLogin(providerType)
      if (!result.success) {
        console.error('[AIModelSection] OAuth login start failed:', result.error)
        setLoginState(null)
        return
      }

      const { state, userCode, verificationUri } = result.data as {
        loginUrl: string
        state: string
        userCode?: string
        verificationUri?: string
      }

      setLoginState({
        provider: providerType,
        status: userCode ? t('Enter the code in your browser') : t('Waiting for login...'),
        userCode,
        verificationUri
      })

      const completeResult = await api.authCompleteLogin(providerType, state)
      if (!completeResult.success) {
        console.error('[AIModelSection] OAuth login complete failed:', completeResult.error)
        setLoginState(null)
        return
      }

      const configResult = await api.getConfig()
      if (configResult.success && configResult.data) {
        setConfig(configResult.data as HaloConfig)
        setCurrentSource(providerType as AISourceType)
      }
      setLoginState(null)
    } catch (err) {
      console.error('[AIModelSection] OAuth login error:', err)
      setLoginState(null)
    }
  }

  // Handle OAuth logout
  const handleOAuthLogout = async (providerType: string) => {
    try {
      setLoggingOutProvider(providerType)
      await api.authLogout(providerType)
      const configResult = await api.getConfig()
      if (configResult.success && configResult.data) {
        setConfig(configResult.data as HaloConfig)
        if (config?.aiSources?.custom?.apiKey) {
          setCurrentSource('custom')
        }
      }
    } catch (err) {
      console.error('[AIModelSection] OAuth logout error:', err)
    } finally {
      setLoggingOutProvider(null)
    }
  }

  // Handle OAuth model change
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

  // Handle save Custom API
  const handleSaveCustomApi = async () => {
    setIsValidating(true)
    setValidationResult(null)

    try {
      const validationResponse = await api.validateApi(apiKey, apiUrl, provider)

      if (!validationResponse.success || !validationResponse.data?.valid) {
        const errorMessage = validationResponse.data?.message || validationResponse.error || t('Connection failed')
        setValidationResult({
          valid: false,
          message: errorMessage
        })
        return
      }

      const normalizedUrl = validationResponse.data.normalizedUrl || apiUrl
      const detectedModel = validationResponse.data.model

      if (normalizedUrl !== apiUrl) {
        setApiUrl(normalizedUrl)
        setValidationResult({
          valid: true,
          message: t('URL auto-corrected and validated successfully')
        })
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      const isDefault = editingKey === 'custom' || (!editingKey && !config?.aiSources?.custom?.apiKey && !config?.aiSources?.['custom_'])

      let targetKey = editingKey
      let newId = (config?.aiSources?.[editingKey || ''] as any)?.id

      if (!targetKey) {
        if (isDefault && !config?.aiSources?.custom?.apiKey) {
          targetKey = 'custom'
        } else {
          newId = uuidv4()
          targetKey = `custom_${newId}`
        }
      }

      const customConfig: CustomSourceConfig = {
        id: newId,
        name: customName || (targetKey === 'custom' ? t('Default API') : t('Custom API')),
        type: 'custom',
        provider: provider as any,
        apiKey,
        apiUrl: normalizedUrl,
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

      if (targetKey === 'custom') {
        updates.api = {
          provider: provider as any,
          apiKey,
          apiUrl: normalizedUrl,
          model: customConfig.model,
          availableModels: customConfig.availableModels
        }
      }

      await api.setConfig(updates)
      setConfig({ ...config, ...updates } as HaloConfig)
      setCurrentSource(targetKey as AISourceType)
      setValidationResult({ valid: true, message: t('Connection successful, saved') })

      setTimeout(() => {
        setShowCustomApiForm(false)
        setEditingKey(null)
        setValidationResult(null)
      }, 1500)
    } catch (error) {
      console.error('[AIModelSection] Save failed:', error)
      setValidationResult({ valid: false, message: t('Save failed') })
    } finally {
      setIsValidating(false)
    }
  }

  // Handle add new custom source
  const handleAddCustom = () => {
    setEditingKey(null)
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
    const cfg = source as CustomSourceConfig
    setEditingKey(key)
    setProvider(cfg.provider || 'anthropic')
    setApiKey(cfg.apiKey || '')
    setApiUrl(cfg.apiUrl || '')
    setModel(cfg.model || '')
    setFetchedModels(cfg.availableModels || [])
    setCustomName(cfg.name || (key === 'custom' ? t('Default API') : t('Custom API')))
    setShowCustomApiForm(true)
    setValidationResult(null)
  }

  // Handle delete custom source
  const handleDeleteCustom = async (key: string) => {
    const newAiSources = { ...config?.aiSources }
    delete newAiSources[key]

    if (config?.aiSources?.current === key) {
      const firstRemain = Object.keys(newAiSources).find(k => k.startsWith('custom') && k !== 'current')
      newAiSources.current = (firstRemain || 'custom') as AISourceType
    }

    const newConfig = { ...config, aiSources: newAiSources } as HaloConfig
    await api.setConfig(newConfig)
    setConfig(newConfig)
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
      const trimSlash = (s: string) => s.replace(/\/+$/, '')
      let baseUrl = trimSlash(apiUrl)

      if (baseUrl.endsWith('/chat/completions')) {
        baseUrl = baseUrl.slice(0, -'/chat/completions'.length)
      } else if (baseUrl.endsWith('/responses')) {
        baseUrl = baseUrl.slice(0, -'/responses'.length)
      } else if (baseUrl.endsWith('/v1/chat')) {
        baseUrl = baseUrl.slice(0, -'/chat'.length)
      }

      if (!baseUrl.includes('/v1')) {
        baseUrl = `${baseUrl}/v1`
      } else {
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

      if (data.data && Array.isArray(data.data)) {
        const models = data.data
          .map((m: any) => m.id)
          .filter((id: any) => typeof id === 'string')
          .sort()

        if (models.length === 0) {
          throw new Error('No models found in response')
        }

        setFetchedModels(models)

        if (models.length > 0 && (!model || model === 'gpt-4o-mini' || model === 'deepseek-chat')) {
          setModel(models[0])
        }

        setValidationResult({ valid: true, message: t('Models fetched successfully') })
      } else {
        throw new Error('Invalid API response format')
      }
    } catch (error) {
      console.error('[AIModelSection] Failed to fetch models:', error)
      setValidationResult({ valid: false, message: t('Failed to fetch models') })
    } finally {
      setIsFetchingModels(false)
    }
  }

  // Render custom API form
  const renderCustomApiForm = () => (
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
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={provider === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet'}
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
  )

  return (
    <section id="ai-model" className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium">{t('AI Model')}</h2>
      </div>

      <div className="space-y-4">
        {/* OAuth Providers - Dynamic rendering */}
        {authProviders
          .filter(p => p.type !== 'custom' && p.enabled)
          .map((providerItem) => {
            const providerConfig = config?.aiSources?.[providerItem.type] as OAuthSourceConfig | undefined
            const isLoggedIn = providerConfig?.loggedIn === true
            const isLoggingIn = loginState?.provider === providerItem.type
            const isLoggingOut = loggingOutProvider === providerItem.type
            const IconComponent = getIconComponent(providerItem.icon)

            if (isLoggedIn) {
              return (
                <div
                  key={providerItem.type}
                  className={`p-4 rounded-lg border-2 transition-all cursor-pointer ${
                    currentSource === providerItem.type
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/50'
                  }`}
                  onClick={() => handleSwitchSource(providerItem.type)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${providerItem.iconBgColor}20` }}
                      >
                        <IconComponent
                          className="w-6 h-6"
                          style={{ color: providerItem.iconBgColor }}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{getLocalizedText(providerItem.displayName)}</span>
                          {currentSource === providerItem.type && (
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
                        handleOAuthLogout(providerItem.type)
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

                  {currentSource === providerItem.type && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <label className="block text-xs text-muted-foreground mb-1.5">{t('Model')}</label>
                      <select
                        value={providerConfig?.model || ''}
                        onChange={(e) => handleOAuthModelChange(providerItem.type, e.target.value)}
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
              return (
                <div key={providerItem.type} className="p-4 rounded-lg border border-border bg-muted/30">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                    <div>
                      <span className="font-medium">{t('Logging in...')}</span>
                      <p className="text-xs text-muted-foreground">{loginState?.status}</p>
                    </div>
                  </div>

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
              return (
                <button
                  key={providerItem.type}
                  onClick={() => handleOAuthLogin(providerItem.type)}
                  className="w-full p-4 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center gap-3"
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${providerItem.iconBgColor}10` }}
                  >
                    <Plus className="w-5 h-5" style={{ color: providerItem.iconBgColor }} />
                  </div>
                  <div className="text-left">
                    <span className="font-medium">{t('Add')} {getLocalizedText(providerItem.displayName)}</span>
                    <p className="text-xs text-muted-foreground">{getLocalizedText(providerItem.description)}</p>
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
                className={`rounded-lg border-2 transition-all ${
                  isActive
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/50'
                }`}
              >
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

                {isEditing && (
                  <div className="p-4 pt-0 border-t border-border mt-4" onClick={(e) => e.stopPropagation()}>
                    {renderCustomApiForm()}
                  </div>
                )}
              </div>
            )
          })}

        {/* Add Custom API Button */}
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
          <div className="p-4 rounded-lg border border-border space-y-4">
            <h3 className="font-medium">{t('Configure New API')}</h3>
            {renderCustomApiForm()}
          </div>
        )}
      </div>
    </section>
  )
}
