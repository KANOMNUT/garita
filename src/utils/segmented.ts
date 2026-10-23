/** Arrow-key target in a radio group: one step from `from`, wrapping at both ends. */
export const stepIndex = (options: readonly unknown[], from: number, step: number): number =>
  (from + step + options.length) % options.length;
