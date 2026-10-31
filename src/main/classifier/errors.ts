/**
 * Dostawca modelu nie może teraz odpowiedzieć (nie wina wiadomości, więc nie liczymy próby):
 * - down: brak połączenia, serwer Ollamy wyłączony albo limit zapytań
 * - no-model: wybrany model nie istnieje u dostawcy
 * - no-key: brak klucza API, klucz odrzucony albo wyczerpane środki
 */
export type UnavailableReason = 'down' | 'no-model' | 'no-key'

export class AiUnavailable extends Error {
  constructor(
    readonly reason: UnavailableReason,
    message: string
  ) {
    super(message)
  }
}
