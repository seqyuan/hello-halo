/**
 * Request Interceptors
 *
 * Centralized interceptor management for request processing pipeline.
 */

export * from './types'
export { warmupInterceptor } from './warmup'

import type { RequestInterceptor, OpenAIRequest, InterceptorContext, InterceptorResult } from './types'
import { warmupInterceptor } from './warmup'

/**
 * Default interceptor chain - order matters!
 * First matching interceptor wins.
 */
const defaultInterceptors: RequestInterceptor[] = [
  warmupInterceptor,
  // Add more interceptors here as needed
]

/**
 * Run request through interceptor chain
 *
 * @returns { intercepted: false } if no interceptor handled the request
 * @returns { intercepted: true, request } if request was modified
 * @returns { intercepted: true, responded: true } if response was already sent
 */
export async function runInterceptors(
  request: OpenAIRequest,
  context: InterceptorContext,
  interceptors: RequestInterceptor[] = defaultInterceptors
): Promise<
  | { intercepted: false; request: OpenAIRequest }
  | { intercepted: true; request: OpenAIRequest }
  | { intercepted: true; responded: true }
> {
  let currentRequest = request

  for (const interceptor of interceptors) {
    if (!interceptor.shouldIntercept(currentRequest, context)) {
      continue
    }

    const result = await Promise.resolve(interceptor.intercept(currentRequest, context))

    if (!result.handled) {
      continue
    }

    // Response was sent, stop processing
    if ('responded' in result && result.responded) {
      return { intercepted: true, responded: true }
    }

    // Request was modified, continue with modified request
    if ('modified' in result && result.modified) {
      currentRequest = result.modified
      return { intercepted: true, request: currentRequest }
    }
  }

  return { intercepted: false, request: currentRequest }
}
