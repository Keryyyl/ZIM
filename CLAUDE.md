# ZIM: desktopowy klient mailowy

Klient mailowy w stylu Superhuman: wiele skrzynek w jednej, tagi, reguły i klasyfikacja LLM,
widoki oparte o tagi i priorytet (np. potwierdzenia aplikacji nie trafiają do głównego inboxa).

## Stack
Electron + electron-vite, React, TypeScript, SQLite (better-sqlite3, FTS5), imapflow, mailparser,
nodemailer, Vitest. Menedżer pakietów: pnpm.

## Zasady
- Dane i hasła zostają lokalnie. Hasła/tokeny tylko w Keychain (safeStorage), nigdy w bazie ani w logach.
- Rdzeń (`src/main/{db,mail,rules,classifier}`) nie zależy od Reacta ani API Electrona poza `index.ts`,
  żeby dało się go później przenieść (Tauri/CLI).
- Akcje na mailach (przeczytane, gwiazdka, archiwum, spam, kosz, usuwanie) działają w obie strony z serwerem IMAP:
  zmiana od razu w SQLite, a sync (`mail/sync.ts`, `mail/remote.ts`) wypycha różnicę między stanem docelowym
  (`folder`/`read`/`starred`) a stanem serwera (`mailbox`/`server_*`). Tagi są tylko lokalne.
- Załączniki odebranych maili: w SQLite tylko metadane z BODYSTRUCTURE (`attachments`, `db/attachments.ts`),
  a treść pobierana na żądanie jedną częścią MIME (`mail/attachment-cache.ts`) do cache w `userData/attachments`
  (limit 2 GB, usuwanie najdawniej używanych). Renderer zna tylko id załącznika, nigdy ścieżkę ani UID.
  Nazwy plików z maili przechodzą przez `safeFilename`; pliki wykonywalne wymagają potwierdzenia przed otwarciem.
- Najpierw reguły, LLM tylko jako fallback dla niesklasyfikowanych maili. Domyślnie lokalny model (Ollama).
- HTML maili renderować przez DOMPurify w iframe z sandboxem, z zablokowanymi zdalnymi obrazkami.

## Komendy
- `pnpm dev` uruchamia aplikację
- `pnpm test` uruchamia testy
- `pnpm typecheck` sprawdza typy

## Plan (kolejność)
1. Sync jednego konta IMAP do SQLite (`src/main/mail/sync.ts`)
2. Lista i czytnik, skróty klawiszowe (j/k/e/r)
3. Reguły, tagi, widoki (silnik reguł już jest w `rules/engine.ts`)
4. Wiele kont, zunifikowana skrzynka
5. Klasyfikator LLM (`classifier/llm.ts`)
6. Wysyłka, odpowiedzi, wyszukiwanie
