import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { ensureOllamaRunning, findOllamaBinary, type ServerDeps } from './ollama-server'

describe('findOllamaBinary', () => {
  it('szuka w PATH, a potem w typowych miejscach instalacji', () => {
    expect(findOllamaBinary('/a:/b', (p) => p === '/b/ollama')).toBe('/b/ollama')
    expect(findOllamaBinary('/a', (p) => p === '/opt/homebrew/bin/ollama')).toBe('/opt/homebrew/bin/ollama')
    expect(findOllamaBinary('/a', () => false)).toBeNull()
  })
})

describe('ensureOllamaRunning', () => {
  const fakeProc = (): ChildProcess => Object.assign(new EventEmitter(), { kill: vi.fn() }) as unknown as ChildProcess

  const deps = (over: Partial<ServerDeps>): ServerDeps => ({
    isUp: async () => false,
    spawn: fakeProc,
    find: () => '/bin/ollama',
    sleep: async () => undefined,
    ...over
  })

  it('nie rusza serwera, który już działa', async () => {
    const spawn = vi.fn(fakeProc)
    expect(await ensureOllamaRunning(1000, deps({ isUp: async () => true, spawn }))).toBe('running')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('uruchamia serwer i czeka, aż odpowie', async () => {
    let calls = 0
    const spawn = vi.fn(fakeProc)
    const result = await ensureOllamaRunning(5000, deps({ isUp: async () => ++calls > 3, spawn }))
    expect(result).toBe('started')
    expect(spawn).toHaveBeenCalledWith('/bin/ollama')
  })

  it('zgłasza brak programu i zbyt długie uruchamianie', async () => {
    expect(await ensureOllamaRunning(1000, deps({ find: () => null }))).toBe('missing')
    const proc = fakeProc()
    expect(await ensureOllamaRunning(900, deps({ spawn: () => proc }))).toBe('failed')
    expect(proc.kill).toHaveBeenCalled()
  })

  it('przerywa czekanie, gdy proces od razu się kończy', async () => {
    const proc = fakeProc()
    const isUp = vi.fn(async () => false)
    const promise = ensureOllamaRunning(15_000, deps({ isUp, spawn: () => proc, sleep: async () => void proc.emit('exit') }))
    expect(await promise).toBe('failed')
    expect(isUp.mock.calls.length).toBeLessThan(5)
  })
})
