/**
 * URL Utilities
 *
 * URL helpers for API endpoint handling and normalization.
 */

/**
 * Extract base URL (protocol + host) from endpoint URL
 */
export function extractBaseUrl(endpointUrl: string): string {
  const url = new URL(endpointUrl)
  return `${url.protocol}//${url.host}`
}

/**
 * Normalize API URL based on provider type
 *
 * Ensures URLs are in the correct format expected by the router:
 * - Anthropic: base URL only (e.g., https://api.anthropic.com)
 * - OpenAI compatible: full endpoint URL (e.g., https://api.openai.com/v1/chat/completions)
 *
 * @param apiUrl - User-provided URL (may be incomplete)
 * @param provider - 'anthropic' or 'openai'
 * @returns Normalized URL ready for use
 */
export function normalizeApiUrl(apiUrl: string, provider: 'anthropic' | 'openai'): string {
  const trimSlash = (s: string) => s.replace(/\/+$/, '')
  let normalized = trimSlash(apiUrl)

  if (provider === 'anthropic') {
    // Anthropic: just trim trailing slashes
    return normalized
  }

  // OpenAI compatible: ensure URL ends with valid endpoint
  // Already has full endpoint? Return as-is
  if (normalized.endsWith('/chat/completions') || normalized.endsWith('/responses')) {
    return normalized
  }

  // Strip partial endpoint suffixes
  const partialSuffixes = ['/v1/chat', '/chat', '/v1/']
  for (const suffix of partialSuffixes) {
    if (normalized.endsWith(suffix)) {
      normalized = normalized.slice(0, -suffix.length)
      break
    }
  }

  // Ensure /v1 prefix exists
  const hasV1 = normalized.includes('/v1')
  if (hasV1) {
    // Extract up to /v1
    const v1Idx = normalized.indexOf('/v1')
    normalized = normalized.slice(0, v1Idx + 3)
  } else {
    normalized = `${normalized}/v1`
  }

  // Append standard endpoint
  return `${normalized}/chat/completions`
}
