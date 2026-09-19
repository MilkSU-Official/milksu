export type SearchableModelOption = {
  value: string
  label: string
  model: string
  disabled?: boolean
  title?: string
  /**
   * The provider's own words from the last real failure of this model, when there was one. It only
   * ever produces a red mark: the entry stays selectable, because a one-off provider outage must
   * not take a model away from the reader.
   */
  failedReason?: string
  failedAt?: string
}

/** One persisted failure record, as the backend reports it. */
export type ModelFailureRecord = {
  provider: string
  model: string
  reason?: string
  at?: string
}

/**
 * Annotate picker groups with the recorded failures, matching on the provider the group belongs to
 * and the model id. A model with no record is left exactly as it was, so nothing is marked by
 * default.
 */
export function annotateModelFailures(
  groups: SearchableModelGroup[],
  failures: readonly ModelFailureRecord[] | undefined,
  providerOf: (group: SearchableModelGroup) => string,
): SearchableModelGroup[] {
  if (!failures?.length) return groups
  const byKey = new Map<string, ModelFailureRecord>()
  for (const failure of failures) {
    const provider = String(failure?.provider ?? '').trim()
    const model = String(failure?.model ?? '').trim()
    if (!provider || !model) continue
    byKey.set(`${provider}\u0000${model}`, failure)
  }
  if (!byKey.size) return groups
  return groups.map(group => {
    const provider = providerOf(group)
    return {
      ...group,
      models: group.models.map(option => {
        const failure = byKey.get(`${provider}\u0000${option.model}`)
        return failure
          ? { ...option, failedReason: failure.reason ?? '', failedAt: failure.at }
          : option
      }),
    }
  })
}

export type SearchableModelGroup = {
  key: string
  label: string
  models: SearchableModelOption[]
}

export function filterSearchableModelGroups(
  groups: readonly SearchableModelGroup[],
  query: string,
): SearchableModelGroup[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return groups.map(group => ({ ...group, models: group.models.slice() }))
  return groups.flatMap(group => {
    if (group.label.toLocaleLowerCase().includes(normalized)) {
      return [{ ...group, models: group.models.slice() }]
    }
    const models = group.models.filter(model => (
      model.label.toLocaleLowerCase().includes(normalized)
      || model.model.toLocaleLowerCase().includes(normalized)
    ))
    return models.length ? [{ ...group, models }] : []
  })
}

export function filterSearchableModelOptions(
  options: readonly SearchableModelOption[],
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return options.slice()
  return options.filter(option => (
    option.label.toLocaleLowerCase().includes(normalized)
    || option.model.toLocaleLowerCase().includes(normalized)
  ))
}
