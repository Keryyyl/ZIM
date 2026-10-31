import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { listModels } from './ollama'

/** Aplikacja uruchamiana z Findera ma ubogi PATH, więc sprawdzamy też typowe miejsca instalacji. */
const KNOWN_PATHS = [
  '/opt/homebrew/bin/ollama',
  '/usr/local/bin/ollama',
  '/Applications/Ollama.app/Contents/Resources/ollama'
]

export function findOllamaBinary(
  pathVar = process.env.PATH ?? '',
  exists: (p: string) => boolean = existsSync
): string | null {
  const fromPath = pathVar.split(delimiter).filter(Boolean).map((dir) => join(dir, 'ollama'))
  return [...fromPath, ...KNOWN_PATHS].find(exists) ?? null
}

export type ServerResult = 'running' | 'started' | 'missing' | 'failed'

export interface ServerDeps {
  isUp: () => Promise<boolean>
  spawn: (binary: string) => ChildProcess
  find: () => string | null
  sleep: (ms: number) => Promise<void>
}

const defaults: ServerDeps = {
  isUp: async () => (await listModels()) !== null,
  spawn: (binary) =>
    nodeSpawn(binary, ['serve'], {
      stdio: 'ignore',
      // te same ustawienia, które przyspieszają model w testach: flash attention i skompresowany cache KV
      env: { ...process.env, OLLAMA_FLASH_ATTENTION: '1', OLLAMA_KV_CACHE_TYPE: 'q8_0' }
    }),
  find: () => findOllamaBinary(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

let child: ChildProcess | null = null

/**
 * Upewnia się, że serwer Ollamy odpowiada. Jeśli już działa (aplikacja Ollama, brew services, wcześniejsza sesja),
 * nic nie robi i go nie zatrzyma; w przeciwnym razie uruchamia własny proces i czeka, aż będzie gotowy.
 */
export async function ensureOllamaRunning(timeoutMs = 15_000, deps: ServerDeps = defaults): Promise<ServerResult> {
  if (await deps.isUp()) return 'running'
  const binary = deps.find()
  if (!binary) return 'missing'

  let exited = false
  const proc = deps.spawn(binary)
  proc.on('error', () => (exited = true)) // np. brak uprawnień do pliku
  proc.on('exit', () => {
    exited = true
    if (child === proc) child = null
  })
  child = proc

  for (let waited = 0; waited < timeoutMs && !exited; waited += 300) {
    await deps.sleep(300)
    if (await deps.isUp()) return 'started'
  }
  stopOllama()
  return 'failed'
}

/** Zatrzymuje tylko serwer uruchomiony przez nas. */
export function stopOllama(): void {
  child?.kill()
  child = null
}
