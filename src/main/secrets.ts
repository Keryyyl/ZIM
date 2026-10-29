import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'

// Hasła szyfrowane przez safeStorage (klucz w Keychain), trzymane poza bazą.
// Plik zawiera tylko zaszyfrowane bloby w base64, nigdy jawny tekst.
export function createSecretStore(path: string) {
  const read = (): Record<string, string> =>
    existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  const write = (data: Record<string, string>): void =>
    writeFileSync(path, JSON.stringify(data), { mode: 0o600 })

  return {
    set(key: string, secret: string): void {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Szyfrowanie systemowe niedostępne')
      write({ ...read(), [key]: safeStorage.encryptString(secret).toString('base64') })
    },
    get(key: string): string | null {
      const blob = read()[key]
      return blob ? safeStorage.decryptString(Buffer.from(blob, 'base64')) : null
    },
    delete(key: string): void {
      const data = read()
      delete data[key]
      write(data)
    }
  }
}
