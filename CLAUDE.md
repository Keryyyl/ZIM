# ZIM: desktopowy klient mailowy

Klient mailowy w stylu Superhuman: wiele skrzynek w jednej, tagi, reguły i klasyfikacja LLM,
widoki oparte o tagi i priorytet (np. potwierdzenia aplikacji nie trafiają do głównego inboxa).

## Stack
Electron + electron-vite, React, TypeScript, SQLite (better-sqlite3, FTS5), imapflow, mailparser,
nodemailer, Vitest. Menedżer pakietów: pnpm.

## Zasady
- Dane i hasła zostają lokalnie. Hasła/tokeny/klucze API tylko w Keychain (safeStorage), nigdy w bazie ani w logach.
  Jedyny wyjątek od „dane lokalnie”: model w chmurze, który użytkownik sam włączy (zob. Asystent AI).
- Rdzeń (`src/main/{db,mail,rules,classifier}`) nie zależy od Reacta ani API Electrona poza `index.ts`,
  żeby dało się go później przenieść (Tauri/CLI).
- Akcje na mailach (przeczytane, gwiazdka, archiwum, spam, kosz, usuwanie) działają w obie strony z serwerem IMAP:
  zmiana od razu w SQLite, a sync (`mail/sync.ts`, `mail/remote.ts`) wypycha różnicę między stanem docelowym
  (`folder`/`read`/`starred`) a stanem serwera (`mailbox`/`server_*`). Tagi są tylko lokalne.
- Załączniki odebranych maili: w SQLite tylko metadane z BODYSTRUCTURE (`attachments`, `db/attachments.ts`),
  a treść pobierana na żądanie jedną częścią MIME (`mail/attachment-cache.ts`) do cache w `userData/attachments`
  (limit 2 GB, usuwanie najdawniej używanych). Renderer zna tylko id załącznika, nigdy ścieżkę ani UID.
  Nazwy plików z maili przechodzą przez `safeFilename`; pliki wykonywalne wymagają potwierdzenia przed otwarciem.
- Asystent AI (`src/main/classifier/`): trzy tryby wybierane w Ustawieniach: brak, pobrany model (Ollama, domyślnie)
  albo zewnętrzny (Claude przez `anthropic.ts` z oficjalnym SDK, ChatGPT przez `openai.ts`). Wspólne wejście to
  `providers.ts` (`createChat`); tagowanie i skrót nie wiedzą, kto odpowiada. Model w chmurze wymaga klucza API
  (Keychain, klucz `ai:<dostawca>`, renderer go nie odczytuje) oraz jawnej zgody na wysyłanie treści maili
  (`ai.consent.<dostawca>`, egzekwowana w `db/settings.ts`). Błędy dostawcy (`errors.ts`: down/no-model/no-key) kończą
  przebieg kolejki bez zużywania prób. Tagowanie (`llm.ts`, `queue.ts`) wybiera tylko spośród istniejących tagów, w oparciu o ich
  opisy (`tags.description`), a odpowiedź jest wymuszona schematem JSON. Kolejka działa w tle po synchronizacji
  dla maili z ostatnich 30 dni z Odebranych/Archiwum; tagi od AI mają `message_tags.source = 'llm'` i nigdy nie
  nadpisują ręcznych. Gdy Ollama nie działa, kolejka kończy po cichu (bez zużywania prób) i wraca przy następnej synchronizacji.
  Treść maila jest daną, nie poleceniem: model nie wykonuje żadnych akcji, może tylko wybrać tagi z listy.
- Tagi ważności Pilne/Luźne/Zachować są wbudowane (`tags.system_key` = urgent/loose/keep, `shared/priority.ts`):
  tworzone przy pierwszym uruchomieniu (`ensureSystemTags`), nie do usunięcia, ale z edytowalną nazwą, kolorem i opisem
  dla AI. Logika (kolejność Odebranych, archiwizacja „keep”, grupa priorytetu w prompcie) zawsze po kluczu, nigdy po nazwie.
- Serwer Ollamy (`classifier/ollama-server.ts`): przy starcie aplikacji, gdy asystent jest włączony i serwer nie odpowiada,
  uruchamiamy `ollama serve` jako proces potomny i zatrzymujemy go przy wyjściu. Cudzego serwera (aplikacja Ollama,
  brew services) nie ruszamy.
- Skrót maila (`classifier/summary.ts`): tworzony dopiero po otwarciu wiadomości (nigdy w tle), zapisywany w
  `messages.summary` i pokazywany w zwijanej sekcji nad treścią. Pomijany dla krótkich maili (`shared/summary.ts`)
  i przy wyłączonym asystencie; ten sam klient Ollamy i ta sama zasada „treść to dane, nie polecenie”.
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
