# Nonet Daily on Reddit

The Nonet prototype, ported into Reddit's Devvit "bare" web template.

- `public/splash.html` + `src/client/splash.ts`: the card in the feed. The cube comes apart into NONET, then "Play today's cube" opens the game.
- `public/game.html` + `src/client/game.ts`: the full game, the prototype's own code in `src/client/nonet/` unchanged.
- `public/fonts/`: the three fonts, self-hosted and cut down to the characters Nonet uses (Reddit won't load Google Fonts).
- `public/brand/`: wordmark, icon, paper grain.
- The server is the template's: it posts "Nonet: today's cube" when installed, and adds a subreddit menu item "Nonet: new daily cube post". The template's counter API is still there but unused.

## The subreddit

- Every night just after midnight Pacific the app posts the day's cube and pins it as the first community highlight.
- Mondays it posts the weekly top nine for last week, plus the solve of the week (the highest single-day score), pinned second.
- From 3 days in a row a player's user flair shows their streak ("Nonet · 7-day streak"), and their best once it lapses. Flair a player or a mod set some other way is left alone.
- The app writes `/wiki/nonet`: the short rules, the scoring table and the records (longest streaks, all-time points, past weeks). It rewrites it on install, every Monday, and from the mod menu "Nonet: update the wiki". The app account needs wiki permission.
- Mods can get the stored cubes from the mod menu "Nonet: message me the cube list": a private message with the last 30 days (tomorrow's included once it's made), each with its clues and answer. Cubes stay in Redis, which players can't read.
- Subreddit settings turn off auto posting, pinning and streak flair.

Not yet on Reddit's side: the week board and ranks on the splash are samples, and the daily turn pick is stored in the browser only. Both move to Redis on the server next.

## Run it

Needs Node 24 or newer.

1. Run step 1 from the Devvit "You're all set" page (`npm create devvit@latest <your code>`). It logs you in and makes a `nonet-daily` folder.
2. Copy everything in this folder over that `nonet-daily` folder, replacing files.
3. `cd nonet-daily && npm install`
4. `npm run dev` starts a playtest on your test subreddit and prints its link.
5. Open the subreddit. Install made a post; or use the subreddit menu, "Nonet: new daily cube post".

`npm test` runs types, lint, unit tests and the build.
