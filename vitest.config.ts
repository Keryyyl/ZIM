import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  // ._* to pliki AppleDouble z dysków exFAT/NTFS, nie testy
  test: { exclude: ['**/node_modules/**', '**/out/**', '**/._*'] }
})
