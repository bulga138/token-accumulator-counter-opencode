/**
 * Configuration validation utilities.
 *
 * Validates gateway configuration before saving to catch errors early.
 * Provides detailed error messages to help users fix configuration issues.
 */

import type { GatewayConfig, GatewayAuth, GatewayFieldMapping } from '../config/index.js'
import { resolveJsonPath } from './jsonpath.js'

export interface ValidationError {
  field: string
  message: string
  suggestion?: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

/**
 * Validates a complete gateway configuration.
 * Returns detailed errors for each invalid field.
 */
export function validateGatewayConfig(config: unknown): ValidationResult {
  const errors: ValidationError[] = []

  // Check if config is an object
  if (!config || typeof config !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'config', message: 'Gateway config must be an object' }],
    }
  }

  const gatewayConfig = config as GatewayConfig

  // Validate endpoint
  const endpointErrors = validateEndpoint(gatewayConfig.endpoint)
  errors.push(...endpointErrors)

  // Validate auth
  const authErrors = validateAuth(gatewayConfig.auth)
  errors.push(...authErrors)

  // Validate mappings
  const mappingErrors = validateMappings(gatewayConfig.mappings)
  errors.push(...mappingErrors)

  // Validate cache TTL
  const ttlErrors = validateCacheTtl(gatewayConfig.cacheTtlMinutes)
  errors.push(...ttlErrors)

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validates the endpoint URL.
 */
function validateEndpoint(endpoint: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!endpoint) {
    errors.push({
      field: 'endpoint',
      message: 'Endpoint URL is required',
      suggestion: 'Add an endpoint like "https://gateway.example.com/user/info"',
    })
    return errors
  }

  if (typeof endpoint !== 'string') {
    errors.push({
      field: 'endpoint',
      message: 'Endpoint must be a string',
      suggestion: 'Use a URL string like "https://gateway.example.com/user/info"',
    })
    return errors
  }

  try {
    const url = new URL(endpoint)

    if (!url.protocol.startsWith('http')) {
      errors.push({
        field: 'endpoint',
        message: `Invalid protocol: ${url.protocol}`,
        suggestion: 'Use http:// or https://',
      })
    }

    if (!url.hostname) {
      errors.push({
        field: 'endpoint',
        message: 'Endpoint URL is missing hostname',
        suggestion: 'Use a valid URL like "https://gateway.example.com/user/info"',
      })
    }
  } catch {
    errors.push({
      field: 'endpoint',
      message: `Invalid URL: ${endpoint}`,
      suggestion: 'Use a valid URL like "https://gateway.example.com/user/info"',
    })
  }

  return errors
}

/**
 * Validates authentication configuration.
 */
function validateAuth(auth: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!auth) {
    errors.push({
      field: 'auth',
      message: 'Authentication configuration is required',
      suggestion: 'Add auth: { type: "bearer", tokenOrEnv: "${YOUR_API_KEY}" }',
    })
    return errors
  }

  if (typeof auth !== 'object') {
    errors.push({
      field: 'auth',
      message: 'Auth must be an object',
      suggestion: 'Use auth: { type: "bearer", tokenOrEnv: "${YOUR_API_KEY}" }',
    })
    return errors
  }

  const authConfig = auth as GatewayAuth

  // Validate auth type
  const validTypes = ['bearer', 'basic', 'header']
  if (!authConfig.type || !validTypes.includes(authConfig.type)) {
    errors.push({
      field: 'auth.type',
      message: `Invalid auth type: ${authConfig.type}`,
      suggestion: `Use one of: ${validTypes.join(', ')}`,
    })
  }

  // Validate auth fields based on type
  switch (authConfig.type) {
    case 'bearer':
      if (!authConfig.tokenOrEnv) {
        errors.push({
          field: 'auth.tokenOrEnv',
          message: 'Bearer token is required',
          suggestion: 'Add tokenOrEnv: "${YOUR_API_KEY}" or tokenOrEnv: "your-token-here"',
        })
      }
      break

    case 'basic':
      if (!authConfig.usernameOrEnv) {
        errors.push({
          field: 'auth.usernameOrEnv',
          message: 'Basic auth username is required',
          suggestion: 'Add usernameOrEnv: "${USERNAME}" or usernameOrEnv: "your-username"',
        })
      }
      if (!authConfig.passwordOrEnv) {
        errors.push({
          field: 'auth.passwordOrEnv',
          message: 'Basic auth password is required',
          suggestion: 'Add passwordOrEnv: "${PASSWORD}" or passwordOrEnv: "your-password"',
        })
      }
      break

    case 'header':
      if (!authConfig.headerName) {
        errors.push({
          field: 'auth.headerName',
          message: 'Custom header name is required',
          suggestion: 'Add headerName: "X-Api-Key"',
        })
      }
      if (!authConfig.headerValueOrEnv) {
        errors.push({
          field: 'auth.headerValueOrEnv',
          message: 'Custom header value is required',
          suggestion: 'Add headerValueOrEnv: "${YOUR_KEY}" or headerValueOrEnv: "your-key"',
        })
      }
      break
  }

  return errors
}

/**
 * Validates JSONPath mappings.
 */
function validateMappings(mappings: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!mappings) {
    errors.push({
      field: 'mappings',
      message: 'Field mappings are required',
      suggestion: 'Add mappings: { totalSpend: "$.user_info.spend" }',
    })
    return errors
  }

  if (typeof mappings !== 'object') {
    errors.push({
      field: 'mappings',
      message: 'Mappings must be an object',
      suggestion: 'Use mappings: { totalSpend: "$.user_info.spend" }',
    })
    return errors
  }

  const mappingConfig = mappings as GatewayFieldMapping

  // totalSpend is required
  if (!mappingConfig.totalSpend) {
    errors.push({
      field: 'mappings.totalSpend',
      message: 'totalSpend mapping is required',
      suggestion: 'Add totalSpend: "$.path.to.spend" (e.g., "$.user_info.spend")',
    })
  } else {
    const jsonPathError = validateJsonPath(mappingConfig.totalSpend, 'mappings.totalSpend')
    if (jsonPathError) errors.push(jsonPathError)
  }

  // Validate optional mappings
  const optionalFields: Array<{ key: keyof GatewayFieldMapping; label: string }> = [
    { key: 'budgetLimit', label: 'budgetLimit' },
    { key: 'budgetResetAt', label: 'budgetResetAt' },
    { key: 'budgetDuration', label: 'budgetDuration' },
    { key: 'teamSpend', label: 'teamSpend' },
    { key: 'teamBudgetLimit', label: 'teamBudgetLimit' },
    { key: 'teamName', label: 'teamName' },
  ]

  for (const { key, label } of optionalFields) {
    const value = mappingConfig[key]
    if (value !== undefined && value !== null) {
      const jsonPathError = validateJsonPath(value, `mappings.${label}`)
      if (jsonPathError) errors.push(jsonPathError)
    }
  }

  return errors
}

/**
 * Validates a single JSONPath expression.
 */
function validateJsonPath(path: string, field: string): ValidationError | null {
  if (typeof path !== 'string') {
    return {
      field,
      message: `JSONPath must be a string, got ${typeof path}`,
      suggestion: 'Use a string like "$.user_info.spend"',
    }
  }

  if (!path.startsWith('$.')) {
    return {
      field,
      message: `Invalid JSONPath: ${path}`,
      suggestion: 'JSONPath must start with "$." (e.g., "$.user_info.spend")',
    }
  }

  // Check for unsupported features
  const unsupportedPatterns = [
    { pattern: /\*\*/, message: 'Recursive descent (..) is not supported' },
    { pattern: /\*/, message: 'Wildcards (*) are not supported' },
    { pattern: /\?\(/, message: 'Filter expressions ([?()]) are not supported' },
    { pattern: /\[.*:.*\]/, message: 'Slice notation ([start:end]) is not supported' },
  ]

  for (const { pattern, message } of unsupportedPatterns) {
    if (pattern.test(path)) {
      return {
        field,
        message: `${message} in: ${path}`,
        suggestion: 'Use simple dot notation with array indices: "$.a.b[0].c"',
      }
    }
  }

  // Validate syntax by checking segments
  const pathWithoutPrefix = path.slice(2) // Remove '$.'
  const segments = pathWithoutPrefix.split(/\.|\[(\d+)\]/).filter(Boolean)

  for (const seg of segments) {
    // Check for empty segments
    if (!seg) {
      return {
        field,
        message: `Invalid JSONPath syntax: ${path}`,
        suggestion: 'Check for double dots (..) or empty segments',
      }
    }

    // Check for valid identifier or array index
    const isValidIdentifier = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(seg)
    const isValidIndex = /^\d+$/.test(seg)

    if (!isValidIdentifier && !isValidIndex) {
      return {
        field,
        message: `Invalid segment "${seg}" in JSONPath: ${path}`,
        suggestion: 'Use valid JavaScript identifiers or array indices',
      }
    }
  }

  return null
}

/**
 * Validates cache TTL setting.
 */
function validateCacheTtl(ttl: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (ttl === undefined || ttl === null) {
    // TTL is optional, defaults to 15
    return errors
  }

  if (typeof ttl !== 'number') {
    errors.push({
      field: 'cacheTtlMinutes',
      message: `Cache TTL must be a number, got ${typeof ttl}`,
      suggestion: 'Use a number like 15 (for 15 minutes) or 0 (to disable caching)',
    })
    return errors
  }

  if (ttl < 0) {
    errors.push({
      field: 'cacheTtlMinutes',
      message: `Cache TTL cannot be negative: ${ttl}`,
      suggestion: 'Use 0 to disable caching, or a positive number like 15',
    })
  }

  if (ttl > 1440) {
    errors.push({
      field: 'cacheTtlMinutes',
      message: `Cache TTL is very high: ${ttl} minutes (${Math.round(ttl / 60)} hours)`,
      suggestion: 'Consider using a shorter TTL (15-60 minutes) for fresher data',
    })
  }

  return errors
}

/**
 * Tests JSONPath mappings against a sample JSON object.
 * Returns which paths resolved successfully and which failed.
 */
export function testJsonPathMappings(
  mappings: GatewayFieldMapping,
  sampleData: unknown
): {
  valid: boolean
  results: Array<{ field: string; path: string; resolved: boolean; value: unknown }>
} {
  const results: Array<{ field: string; path: string; resolved: boolean; value: unknown }> = []

  const fields: Array<{ key: keyof GatewayFieldMapping; label: string }> = [
    { key: 'totalSpend', label: 'totalSpend' },
    { key: 'budgetLimit', label: 'budgetLimit' },
    { key: 'budgetResetAt', label: 'budgetResetAt' },
    { key: 'budgetDuration', label: 'budgetDuration' },
    { key: 'teamSpend', label: 'teamSpend' },
    { key: 'teamBudgetLimit', label: 'teamBudgetLimit' },
    { key: 'teamName', label: 'teamName' },
  ]

  for (const { key, label } of fields) {
    const path = mappings[key]
    if (path) {
      const value = resolveJsonPath(sampleData, path)
      results.push({
        field: label,
        path,
        resolved: value !== undefined,
        value,
      })
    }
  }

  const allRequiredResolved = results.filter(r => r.field === 'totalSpend').every(r => r.resolved)

  return {
    valid: allRequiredResolved,
    results,
  }
}

/**
 * Formats validation errors for display.
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return 'No validation errors.'

  const lines = ['Configuration errors:']

  for (const error of errors) {
    lines.push(`  • ${error.field}: ${error.message}`)
    if (error.suggestion) {
      lines.push(`    Suggestion: ${error.suggestion}`)
    }
  }

  return lines.join('\n')
}
