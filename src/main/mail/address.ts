/** "Jan Kowalski <Jan@X.pl>" -> "jan@x.pl"; adres bez nawiasów zwraca znormalizowany. */
export function extractEmail(from: string): string | null {
  const bracketed = from.match(/<([^<>\s]+@[^<>\s]+)>/)
  const plain = from.match(/[^\s<>,"']+@[^\s<>,"']+/)
  const address = bracketed?.[1] ?? plain?.[0]
  return address ? address.toLowerCase() : null
}
