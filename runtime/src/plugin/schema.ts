import { isDeepStrictEqual } from 'node:util'
import { MAX_MANIFEST_BYTES, MAX_RUNTIME_RESULT_BYTES, type Manifest, type ToolContribution } from './types.ts'
import { isObject } from './util.ts'

const ALLOWED_SCHEMA_KEYWORDS = new Set([
  'type', 'description', 'properties', 'required',
  'additionalProperties', 'items', 'enum',
  'minLength', 'maxLength', 'minimum', 'maximum',
  'minItems', 'maxItems',
])

export function validateSchemaDefinition(schema: Record<string, unknown>, root: boolean): void {
  for (const key of Object.keys(schema)) {
    if (!ALLOWED_SCHEMA_KEYWORDS.has(key)) throw new Error(`unsupported JSON Schema keyword "${key}"`)
  }
  const typeName = schema.type
  if (typeof typeName !== 'string') throw new Error('every schema node requires a string type')
  if (root && typeName !== 'object') throw new Error('top-level schema type must be object')
  switch (typeName) {
    case 'object': {
      const properties = isObject(schema.properties) ? schema.properties : {}
      for (const [name, raw] of Object.entries(properties)) {
        if (!isObject(raw)) throw new Error(`property "${name}" schema must be an object`)
        try {
          validateSchemaDefinition(raw, false)
        } catch (error) {
          throw new Error(`property "${name}": ${error instanceof Error ? error.message : error}`)
        }
      }
      if (schema.required !== undefined) {
        if (!Array.isArray(schema.required)) throw new Error('required must be an array')
        const seen = new Set<string>()
        for (const raw of schema.required) {
          if (typeof raw !== 'string' || raw === '') throw new Error('required entries must be non-empty strings')
          if (seen.has(raw)) throw new Error(`required contains duplicate "${raw}"`)
          seen.add(raw)
          if (!(raw in properties)) throw new Error(`required property "${raw}" is not declared`)
        }
      }
      if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
        throw new Error('additionalProperties must be boolean in v1')
      }
      break
    }
    case 'array': {
      if (!isObject(schema.items)) throw new Error('array schema requires an items object')
      try {
        validateSchemaDefinition(schema.items, false)
      } catch (error) {
        throw new Error(`items: ${error instanceof Error ? error.message : error}`)
      }
      break
    }
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'null':
      break
    default:
      throw new Error(`unsupported JSON Schema type "${typeName}"`)
  }
  validateSchemaBounds(schema, typeName)
}

function validateSchemaBounds(schema: Record<string, unknown>, typeName: string): void {
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (schema[key] !== undefined) {
      const value = schema[key]
      if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > MAX_RUNTIME_RESULT_BYTES) {
        throw new Error(`${key} must be a bounded non-negative integer`)
      }
    }
  }
  for (const key of ['minimum', 'maximum'] as const) {
    if (schema[key] !== undefined && typeof schema[key] !== 'number') {
      throw new Error(`${key} must be numeric`)
    }
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.length > 128) {
      throw new Error('enum must contain 1-128 values')
    }
    for (const value of schema.enum) validateSchemaValueType(typeName, value)
  }
}

export function validateInputSchema(raw: unknown): void {
  const encoded = JSON.stringify(raw ?? null)
  if (!encoded || Buffer.byteLength(encoded) > MAX_MANIFEST_BYTES) {
    throw new Error('must be a bounded JSON object')
  }
  if (!isObject(raw) || raw.type !== 'object') throw new Error('top-level type must be object')
  validateSchemaDefinition(raw, true)
}

export function validateToolInput(value: unknown, schemaRaw: unknown): void {
  const encoded = JSON.stringify(value ?? null)
  if (!encoded || Buffer.byteLength(encoded) > MAX_RUNTIME_RESULT_BYTES) {
    throw new Error('tool input must be a bounded JSON object')
  }
  if (!isObject(schemaRaw)) throw new Error('tool input must be a bounded JSON object')
  validateSchemaValue(schemaRaw, value, 'input')
}

function validateSchemaValue(schema: Record<string, unknown>, value: unknown, path: string): void {
  const typeName = String(schema.type ?? '')
  try {
    validateSchemaValueType(typeName, value)
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : error}`)
  }
  if (Array.isArray(schema.enum)) {
    const encoded = JSON.stringify(value)
    if (!schema.enum.some((candidate) => JSON.stringify(candidate) === encoded)) {
      throw new Error(`${path} is not one of the allowed values`)
    }
  }
  if (isObject(value)) {
    const properties = isObject(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const rawName of required) {
      const name = String(rawName)
      if (!(name in value)) throw new Error(`${path}.${name} is required`)
    }
    if (schema.additionalProperties === false) {
      for (const name of Object.keys(value)) {
        if (!(name in properties)) throw new Error(`${path}.${name} is not allowed`)
      }
    }
    for (const name of Object.keys(value).sort()) {
      const child = properties[name]
      if (!isObject(child)) continue
      validateSchemaValue(child, value[name], `${path}.${name}`)
    }
    return
  }
  if (Array.isArray(value)) {
    const minimum = schema.minItems
    const maximum = schema.maxItems
    if (typeof minimum === 'number' && value.length < minimum) {
      throw new Error(`${path} has fewer than ${minimum} items`)
    }
    if (typeof maximum === 'number' && value.length > maximum) {
      throw new Error(`${path} has more than ${maximum} items`)
    }
    const items = isObject(schema.items) ? schema.items : {}
    value.forEach((item, index) => validateSchemaValue(items, item, `${path}[${index}]`))
    return
  }
  if (typeof value === 'string') {
    const length = Array.from(value).length
    if (typeof schema.minLength === 'number' && length < schema.minLength) {
      throw new Error(`${path} is shorter than ${schema.minLength} characters`)
    }
    if (typeof schema.maxLength === 'number' && length > schema.maxLength) {
      throw new Error(`${path} is longer than ${schema.maxLength} characters`)
    }
    return
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      throw new Error(`${path} is below ${schema.minimum}`)
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      throw new Error(`${path} is above ${schema.maximum}`)
    }
  }
}

function validateSchemaValueType(typeName: string, value: unknown): void {
  switch (typeName) {
    case 'object':
      if (!isObject(value)) throw new Error('must be an object')
      return
    case 'array':
      if (!Array.isArray(value)) throw new Error('must be an array')
      return
    case 'string':
      if (typeof value !== 'string') throw new Error('must be a string')
      return
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) throw new Error('must be a number')
      return
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('must be an integer')
      return
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error('must be a boolean')
      return
    case 'null':
      if (value !== null) throw new Error('must be null')
      return
    default:
      throw new Error(`has unsupported type "${typeName}"`)
  }
}

function decodeObjectSchema(raw: unknown): Record<string, unknown> {
  if (!isObject(raw) || raw.type !== 'object') throw new Error('top-level schema must remain an object')
  return raw
}

function schemaProperties(schema: Record<string, unknown>): Record<string, unknown> {
  return isObject(schema.properties) ? schema.properties : {}
}

function schemaRequired(schema: Record<string, unknown>): Set<string> {
  const result = new Set<string>()
  const values = Array.isArray(schema.required) ? schema.required : []
  for (const value of values) {
    if (typeof value === 'string') result.add(value)
  }
  return result
}

function schemaDoesNotNarrowInput(currentRaw: unknown, nextRaw: unknown): void {
  const current = decodeObjectSchema(currentRaw)
  const next = decodeObjectSchema(nextRaw)
  const currentProperties = schemaProperties(current)
  const nextProperties = schemaProperties(next)
  for (const [name, definition] of Object.entries(currentProperties)) {
    if (!isDeepStrictEqual(definition, nextProperties[name])) {
      throw new Error(`property "${name}" was removed or narrowed`)
    }
  }
  const currentRequired = schemaRequired(current)
  for (const name of schemaRequired(next)) {
    if (!currentRequired.has(name)) throw new Error(`optional property "${name}" became required`)
  }
  const currentSpecified = typeof current.additionalProperties === 'boolean'
  const nextSpecified = typeof next.additionalProperties === 'boolean'
  const currentAdditional = current.additionalProperties === true
  const nextAdditional = next.additionalProperties === true
  if ((!currentSpecified || currentAdditional) && nextSpecified && !nextAdditional) {
    throw new Error('additionalProperties was narrowed')
  }
}

function schemaDoesNotBreakOutput(currentRaw: unknown, nextRaw: unknown): void {
  const current = decodeObjectSchema(currentRaw)
  const next = decodeObjectSchema(nextRaw)
  const currentProperties = schemaProperties(current)
  const nextProperties = schemaProperties(next)
  for (const [name, definition] of Object.entries(currentProperties)) {
    if (!isDeepStrictEqual(definition, nextProperties[name])) {
      throw new Error(`property "${name}" was removed or changed`)
    }
  }
  for (const name of schemaRequired(current)) {
    if (!schemaRequired(next).has(name)) {
      throw new Error(`required output property "${name}" is no longer guaranteed`)
    }
  }
  const currentSpecified = typeof current.additionalProperties === 'boolean'
  const nextSpecified = typeof next.additionalProperties === 'boolean'
  const currentAllowsAdditional = !currentSpecified || current.additionalProperties === true
  const nextAllowsAdditional = !nextSpecified || next.additionalProperties === true
  if (!currentAllowsAdditional && nextAllowsAdditional) {
    throw new Error('closed output schema became open')
  }
  if (!currentAllowsAdditional && Object.keys(nextProperties).length !== Object.keys(currentProperties).length) {
    throw new Error('closed output schema gained properties')
  }
}

export function validateSameMajorCompatibility(current: Manifest, next: Manifest): void {
  const nextTools = new Map<string, ToolContribution>()
  for (const tool of next.contributes?.tools ?? []) nextTools.set(tool.name, tool)
  for (const currentTool of current.contributes?.tools ?? []) {
    const nextTool = nextTools.get(currentTool.name)
    if (!nextTool) throw new Error(`same-major upgrade cannot remove tool "${currentTool.name}"`)
    if (currentTool.effect !== nextTool.effect || currentTool.external !== nextTool.external) {
      throw new Error(`same-major upgrade cannot change tool "${currentTool.name}" effect or external exposure`)
    }
    try {
      schemaDoesNotNarrowInput(currentTool.inputSchema, nextTool.inputSchema)
    } catch (error) {
      throw new Error(`same-major tool "${currentTool.name}" input schema: ${error instanceof Error ? error.message : error}`)
    }
    try {
      schemaDoesNotBreakOutput(currentTool.outputSchema, nextTool.outputSchema)
    } catch (error) {
      throw new Error(`same-major tool "${currentTool.name}" output schema: ${error instanceof Error ? error.message : error}`)
    }
  }
}

export function validateThirdPartyTools(manifest: Manifest): void {
  for (const tool of manifest.contributes?.tools ?? []) {
    if (tool.effect !== 'read') throw new Error(`third-party v1 tool "${tool.name}" must be read-only`)
  }
}
