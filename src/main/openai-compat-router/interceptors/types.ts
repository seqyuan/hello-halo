/**
 * Request Interceptor Types
 *
 * Interceptors can modify requests before they are sent upstream,
 * or short-circuit the request entirely by returning a response.
 */

import type { Response as ExpressResponse } from 'express'

/**
 * OpenAI-format request (after conversion from Anthropic)
 */
export interface OpenAIRequest {
  model: string
  messages: Array<{
    role: string
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
  }>
  stream?: boolean
  tools?: unknown[]
  [key: string]: unknown
}

/**
 * Context passed to interceptors
 */
export interface InterceptorContext {
  /** Original Anthropic model name */
  originalModel: string
  /** Express response object for sending responses */
  res: ExpressResponse
}

/**
 * Result of an interceptor execution
 */
export type InterceptorResult =
  | { handled: false }                          // Continue to next interceptor
  | { handled: true; modified?: OpenAIRequest } // Modified request, continue processing
  | { handled: true; responded: true }          // Response already sent, stop processing

/**
 * Request interceptor interface
 */
export interface RequestInterceptor {
  /** Unique name for logging/debugging */
  name: string

  /**
   * Check if this interceptor should handle the request
   */
  shouldIntercept(request: OpenAIRequest, context: InterceptorContext): boolean

  /**
   * Handle the request
   * - Return { handled: false } to pass to next interceptor
   * - Return { handled: true, modified: request } to modify and continue
   * - Return { handled: true, responded: true } if response was sent
   */
  intercept(request: OpenAIRequest, context: InterceptorContext): InterceptorResult | Promise<InterceptorResult>
}
