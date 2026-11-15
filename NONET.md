# Nonet Daily on Reddit

The Nonet prototype, ported into Reddit's Devvit "bare" web template.

- `public/splash.html` + `src/client/splash.ts`: the card in the feed. The cube comes apart into NONET, then "Play today's cube" opens the game.
- `public/game.html` + `src/client/game.ts`: the full game, the prototype's own code in `src/client/nonet/` unchanged.
- `public/fonts/`: the three fonts, self-hosted and cut down to the characters Nonet uses (Reddit won't load Google Fonts).
- `public/brand/`: wordmark, icon, paper grain.
- The server is the template's: it posts "Nonet: today's cube" when installed, and adds a subreddit menu item "Nonet: new daily cube post". The template's counter API is still there but unused.

Not yet on Reddit's side: the week board and ranks on the splash are samples, and the daily turn pick is stored in the browser only. Both move to Redis on the server next.

## Run it

Needs Node 24 or newer.

1. Run step 1 from the Devvit "You're all set" page (`npm create devvit@latest <your code>`). It logs you in and makes a `nonet-daily` folder.
2. Copy everything in this folder over that `nonet-daily` folder, replacing files.
3. `cd nonet-daily && npm install`
4. `npm run dev` starts a playtest on your test subreddit and prints its link.
5. Open the subreddit. Install made a post; or use the subreddit menu, "Nonet: new daily cube post".

`npm test` runs types, lint, unit tests and the build.
