function expectedShipDateContext(expectedShipDate) {
  if (!expectedShipDate) return undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(expectedShipDate)
    ? new Date(`${expectedShipDate}T12:00:00Z`)
    : new Date(expectedShipDate);
  if (Number.isNaN(date.getTime())) return undefined;

  const month = new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
  const shortMonth = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(date);
  const monthPattern = month === shortMonth
    ? month
    : `(?:${month}|${shortMonth}t?\\.?)`;

  return {
    month,
    pattern: new RegExp(
      `(\\bship(?:s|ped|ping)?(?:\\s+on)?\\s+)${monthPattern}\\s+\\d{1,2}(?:,\\s*\\d{4})?`,
      "gi"
    ),
  };
}

/**
 * Locate only the authored date portion so rich-text renderers can preserve
 * surrounding inline emphasis while replacing the day with the promised month.
 *
 * @param {string} copy
 * @param {string | undefined} expectedShipDate
 * @returns {{ start: number, end: number, value: string }[]}
 */
export function expectedShipDateReplacements(copy, expectedShipDate) {
  const context = expectedShipDateContext(expectedShipDate);
  if (!context) return [];

  return Array.from(copy.matchAll(context.pattern), (match) => {
    const prefix = match[1] ?? "";
    const start = (match.index ?? 0) + prefix.length;
    return {
      start,
      end: (match.index ?? 0) + match[0].length,
      value: context.month,
    };
  });
}

/**
 * Keep the operational ship date exact while reducing customer-facing copy to
 * the promised month.
 *
 * @param {string} copy
 * @param {string | undefined} expectedShipDate
 * @returns {string}
 */
export function normalizeExpectedShipDateLanguage(copy, expectedShipDate) {
  const replacements = expectedShipDateReplacements(copy, expectedShipDate);
  if (!replacements.length) return copy;

  return replacements.reduceRight(
    (result, replacement) =>
      `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`,
    copy
  );
}
