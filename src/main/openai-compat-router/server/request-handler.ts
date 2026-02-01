/**
 * Request Handler
 *
 * Core logic for handling Anthropic -> OpenAI -> Anthropic conversion.
 * URL is the single source of truth - no inference, no override.
 */

import type { Response as ExpressResponse } from 'express'
import type { AnthropicRequest, BackendConfig } from '../types'
import {
  convertAnthropicToOpenAIChat,
  convertAnthropicToOpenAIResponses,
  convertOpenAIChatToAnthropic,
  convertOpenAIResponsesToAnthropic
} from '../converters'
import {
  streamOpenAIChatToAnthropic,
  streamOpenAIResponsesToAnthropic
} from '../stream'
import { getApiTypeFromUrl, isValidEndpointUrl, getEndpointUrlError, shouldForceStream } from './api-type'
import { withRequestQueue, generateQueueKey } from './request-queue'
import { runInterceptors } from '../interceptors'

export interface RequestHandlerOptions {
  debug?: boolean
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Anthropic error type to HTTP status code mapping
 */
const ERROR_STATUS_MAP: Record<string, number> = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  overloaded_error: 529,
  timeout_error: 504
}

/**
 * HTTP status code to Anthropic error type mapping (official only)
 */
const STATUS_ERROR_MAP: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  413: 'request_too_large',
  429: 'rate_limit_error',
  500: 'api_error',
  529: 'overloaded_error'
}

/**
 * Get Anthropic error type from HTTP status code
 */
function getErrorTypeFromStatus(status: number): string {
  return STATUS_ERROR_MAP[status] || 'api_error'
}

/**
 * Get error type and message from upstream response
 * Priority: upstream error.type (OpenAI format) > HTTP status mapping > 'api_error'
 */
function getUpstreamError(status: number, errorText: string): { type: string; message: string } {
  try {
    const json = JSON.parse(errorText)
    // OpenAI format: { error: { type, message } }
    if (json?.error?.type) {
      return { type: json.error.type, message: json.error.message || '' }
    }
  } catch {
    // Not JSON, ignore
  }
  return {
    type: getErrorTypeFromStatus(status),
    message: errorText || `HTTP ${status}`
  }
}

/**
 * Send error response in Anthropic JSON format
 *
 * Returns HTTP error status code + JSON body (not SSE).
 * SDK recognizes HTTP 4xx/5xx and throws APIError immediately.
 */
function sendError(
  res: ExpressResponse,
  errorType: string,
  message: string
): void {
  const status = ERROR_STATUS_MAP[errorType] || 500
  console.log(`[RequestHandler] Sending error: HTTP ${status} ${errorType} - ${message.slice(0, 100)}`)

  res.status(status)
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('request-id', `req_${Date.now()}`)
  res.setHeader('retry-after', '1')
  res.json({
    type: 'error',
    error: { type: errorType, message }
  })
}

/**
 * Make upstream request
 */
async function fetchUpstream(
  targetUrl: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
  customHeaders?: Record<string, string>
): Promise<globalThis.Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    console.log('[RequestHandler] Request timeout, aborting...')
    controller.abort()
  }, timeoutMs)

  try {
    // Build headers: start with custom headers, then add defaults
    // Custom headers can override Authorization if needed (e.g., OAuth providers)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(customHeaders || {}),
    }
    // Only add Authorization if not provided in custom headers
    if (!headers['Authorization']) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    return await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: signal ?? controller.signal
    })
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Handle messages request
 */
export async function handleMessagesRequest(
  anthropicRequest: AnthropicRequest,
  config: BackendConfig,
  res: ExpressResponse,
  options: RequestHandlerOptions = {}
): Promise<void> {
  const { debug = false, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const { url: backendUrl, key: apiKey, model, headers: customHeaders, apiType: configApiType } = config
  console.log('[RequestHandler]handleMessagesRequest',backendUrl)
  // Validate URL has valid endpoint suffix
  if (!isValidEndpointUrl(backendUrl)) {
    return sendError(res, 'invalid_request_error', getEndpointUrlError(backendUrl))
  }

  // Get API type from URL suffix, or use config override (guaranteed non-null after validation)
  const apiType = configApiType || getApiTypeFromUrl(backendUrl)!

  // Override model if specified in config
  if (model) {
    anthropicRequest.model = model
  }

  if (debug) {
    console.log('[RequestHandler] Backend:', backendUrl)
    console.log('[RequestHandler] API Key:', apiKey.slice(0, 8) + '...')
    console.log('[RequestHandler] ApiType:', apiType)
  }

  // Use request queue to prevent concurrent requests
  const queueKey = generateQueueKey(backendUrl, apiKey)

 

  await withRequestQueue(queueKey, async () => {
    try {
      // Determine stream mode
      const forceEnvStream = shouldForceStream()
      const preferStreamByWire = apiType === 'responses' && anthropicRequest.stream === undefined
      let wantStream = forceEnvStream || config.forceStream || preferStreamByWire || anthropicRequest.stream

      // Convert request
      const requestToSend = { ...anthropicRequest, stream: wantStream }
      const openaiRequest = apiType === 'responses'
        ? convertAnthropicToOpenAIResponses(requestToSend).request
        : convertAnthropicToOpenAIChat(requestToSend).request

      const toolCount = (openaiRequest as any).tools?.length ?? 0
      console.log(`[RequestHandler] wire=${apiType} tools=${toolCount}`)
      console.log(`[RequestHandler] POST ${backendUrl} (stream=${wantStream ?? false})`)

      // Run through interceptor chain
      const interceptResult = await runInterceptors(
        openaiRequest as any,
        { originalModel: anthropicRequest.model, res }
      )

      // If interceptor sent a response, we're done
      if (interceptResult.intercepted && 'responded' in interceptResult) {
        return
      }

      // Use potentially modified request from interceptors
      const interceptedRequest = interceptResult.request

      // Make upstream request - URL is used directly, no modification
      // console.log(`[RequestHandler] Request body:\n${JSON.stringify(interceptedRequest, null, 2)}`)
      let upstreamResp = await fetchUpstream(backendUrl, apiKey, interceptedRequest, timeoutMs, undefined, customHeaders)
      console.log(`[RequestHandler] Upstream response: ${upstreamResp.status}`)

      // Handle errors - use upstream error type if available, else map from status
      if (!upstreamResp.ok) {
        const errorText = await upstreamResp.text().catch(() => '')
        const { type: errorType, message: errorMessage } = getUpstreamError(upstreamResp.status, errorText)
        console.error(`[RequestHandler] Provider error ${upstreamResp.status}: ${errorText.slice(0, 200)}`)

        // Check if upstream requires stream=true, retry if needed
        const errorLower = errorText?.toLowerCase() || ''
        const requiresStream = errorLower.includes('stream must be set to true') ||
                               (errorLower.includes('non-stream') && errorLower.includes('not supported'))

        if (requiresStream && !wantStream) {
          console.warn('[RequestHandler] Upstream requires stream=true, retrying...')

          // Retry with stream enabled
          wantStream = true
          const retryRequest = apiType === 'responses'
            ? convertAnthropicToOpenAIResponses({ ...anthropicRequest, stream: true }).request
            : convertAnthropicToOpenAIChat({ ...anthropicRequest, stream: true }).request

          upstreamResp = await fetchUpstream(backendUrl, apiKey, retryRequest, timeoutMs, undefined, customHeaders)

          if (!upstreamResp.ok) {
            const retryErrorText = await upstreamResp.text().catch(() => '')
            const { type: retryErrorType, message: retryErrorMessage } = getUpstreamError(upstreamResp.status, retryErrorText)
            console.error(`[RequestHandler] Provider error ${upstreamResp.status}: ${retryErrorText.slice(0, 200)}`)
            return sendError(res, retryErrorType, retryErrorMessage)
          }
        } else {
          return sendError(res, errorType, errorMessage)
        }
      }

      // Handle streaming response
      if (wantStream) {
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        if (apiType === 'responses') {
          await streamOpenAIResponsesToAnthropic(upstreamResp.body, res, anthropicRequest.model, debug)
        } else {
          await streamOpenAIChatToAnthropic(upstreamResp.body, res, anthropicRequest.model, debug)
        }
        return
      }

      // Handle non-streaming response
      const openaiResponse = await upstreamResp.json()
      console.log(`[RequestHandler] Response body:\n${JSON.stringify(openaiResponse, null, 2)}`)
      const anthropicResponse = apiType === 'responses'
        ? convertOpenAIResponsesToAnthropic(openaiResponse)
        : convertOpenAIChatToAnthropic(openaiResponse, anthropicRequest.model)

      res.json(anthropicResponse)
    } catch (error: any) {
      // Handle abort/timeout
      if (error?.name === 'AbortError') {
        console.error('[RequestHandler] AbortError (timeout or client disconnect)')
        return sendError(res, 'timeout_error', 'Request timed out')
      }

      console.error('[RequestHandler] Internal error:', error?.message || error)
      return sendError(res, 'api_error', error?.message || 'Internal error')
    }
  })
}

/**
 * Handle token counting request (simple estimation)
 */
export function handleCountTokensRequest(
  messages: unknown,
  system: unknown
): { input_tokens: number } {
  let count = 0

  // Rough estimation: 4 characters ≈ 1 token
  if (system) {
    count += Math.ceil(JSON.stringify(system).length / 4)
  }
  if (messages) {
    count += Math.ceil(JSON.stringify(messages).length / 4)
  }

  return { input_tokens: count }
}
