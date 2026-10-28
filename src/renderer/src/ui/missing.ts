/** `missingOf(cond && 'группу', …)` — оставляет только сработавшие условия для `MissingHint`. */
export function missingOf(...items: (string | false | null | undefined)[]): string[] {
  return items.filter((m): m is string => typeof m === 'string' && m !== '')
}
