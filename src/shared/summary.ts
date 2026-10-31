/** Krótszych wiadomości nie streszczamy: skrót byłby dłuższy niż sama treść. */
export const SUMMARY_MIN_CHARS = 400

export const isSummarizable = (bodyText: string): boolean => bodyText.trim().length >= SUMMARY_MIN_CHARS
