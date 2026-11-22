# Nonet

A daily sudoku cube for Reddit. Built with Devvit Web for Reddit's Game of the Day hackathon.

_Nonet_ is the sudoku word for a group of nine. Each face of the cube is one. There is one cube a day, the same for everyone, and a new one goes up just after midnight Pacific time. It's posted and pinned in the subreddit.

## How to play

A day of Nonet has three steps:

1. **Pick your turns.** Choose how far today's cube is scrambled: 0 to 3 turns, or up to 2 on Hard days. More turns are harder and worth more points. Your choice is locked in until tomorrow.
2. **Dial in.** Rotate the cube's rows and columns until no number repeats on a face or along a line.
3. **Fill in.** Fill the empty squares. Every face holds 1 to 9 once. Every line of nine, running across three faces, also holds 1 to 9 once.

Some extra rules and tools:

- **Lock-first squares (★).** Locking them before any other square earns +50 each. Lock all three and you get a peek at tomorrow's clues.
- **Help.** "Suggest a move" turns the cube for you, but it costs the no-help bonus.
- **Flatten cube.** Unfolds the cube into a flat net if you'd rather fill it in flat. On a phone the number pad sits at the bottom of the screen. On a wide screen it sits on the right.
- **How to play.** The ? button in the game has the full rules with pictures. First-time players start with a guided practice cube (they can skip it), and "Practice cube" brings it back any time, with no clock or score.

Each week has two Easy days, three Medium and two Hard. The order is shuffled at random every week, the same for everyone, so a Hard day can come on a Monday. Hard days have fewer clues.

### Scoring

Your first finished run each day is the one that counts.

- **Dialling in:** up to 300 points for turns and 200 for speed.
- **Filling in:** up to 300 for speed and 200 for accuracy. A wrong lock costs 25.
- **Bonuses:** +100 for using no suggested turns, and +50 for each ★ square.
- **Multiplier:** the total is multiplied by how many turns you picked and how hard the day is.
- **Retry:** you get one retry a day. It multiplies the day's total by 0.8.

## On Reddit

- **Daily posts.** The app posts each day's cube and pins it. Every Monday it also posts the week's top nine and the solve of the week.
- **Play of the week.** Every Monday the app also posts the week's best run as a replay. The post plays it back in the feed: each turn, the ★ squares, any misses and the last square, in about 45 seconds whatever the run's length, then offers today's cube. The game records each run's moves and the server checks them against the cube, so only real runs are shown. Players can switch off "Show my run if it's the play of the week" on their result screen, and the next best run goes up instead. The card in the feed shows today's cube number, how many people have played, the fastest time, and your streak and rank.
- **Streaks and flair.** A streak counts days in a row with a finished cube. Each week (Monday to Sunday), one missed day is covered by a rest day, so a single bad day doesn't end it. From 3 days in a row, a player's user flair shows their streak, such as "Nonet · 7-day streak". Once a streak lapses, the flair shows their best instead.
- **Results in the comments.** Once you've finished, "Post in the comments" posts your result on the day's post under your username: the cube number, turns, time, points, rank and ★. Nothing from the cube itself, so no spoilers.
- **Founder flair.** The first 100 players to finish a cube in the subreddit get numbered flair, "Nonet founder #1" to "#100", in front of their streak. It's a reason to start playing on day one.
- **Post flair.** The app tags its own posts as "Daily cube", "Weekly top nine" or "Event results", so players can filter the subreddit by them.
- **Boards.** There are boards for today, the week and all time, each showing where you stand.
- **Challenges.** Once you've finished, dare another player by username to beat your score on today's cube. They accept before they play.
- **Nonet Crews (連).** Team up with up to two other players. You play the same cube on your own time, and your scores add up.
  - Your crew streak grows on every day that all of you play, with the same one rest day a week.
  - You can nudge a crewmate who hasn't played yet.
  - Once everyone has played, you can post the crew's result as a comment.
  - A crew's line-up is locked for the week.
  - If a member misses three days in a row, the others can open their seat.
  - Crew names are checked for offensive words.
- **Wiki.** The app writes a small wiki under `/wiki/nonet`: a home page, then How to play, Scoring (with a worked example), Streaks and flair, Challenges and crews, Records and Questions. It rewrites every page each Monday.
- **Subreddit settings.** Mods can turn off auto-posting, pinning, the play of the week, streak flair, founder flair and post flair, and turn on crew flair, which is off by default. The mod menu can also make a post by hand, post the week's board, post the play of the week so far, update the wiki, send the mod the list of recent cubes and their answers, or turn on demo mode for an hour: the mod sees today's post as a new player on a busy day, with the guided practice first, then full sample boards, a crew invite and challenges. Only that mod sees it; it's kept apart from real crews and challenges, and their own scores and streak are untouched.

The game works in light and dark mode, on phones and desktops, and inside the Reddit app.

## Run it

You need Node 24 or newer and a Reddit developer account.

```bash
npm install
npm run dev     # playtest on your test subreddit; prints its link
npm test        # types, lint, unit tests and the build
npm run upload  # npm test, then the sweep, then devvit upload; stops at the first failure
```

### Before every upload

`npm run upload` won't upload unless the sweep passes. The sweep (`npm run check:ui`, in `tools/check/sweep.mjs`) opens every screen of the game at phone, small phone, sideways phone, tablet and desktop sizes, in dark and light mode, in Chrome's engine and Safari's. It fails on any of these:

- console errors, uncaught exceptions, missing files and broken images
- a page or panel that scrolls sideways, or content pushed off the screen
- a button or link that's off screen with nothing to scroll to it
- serious or critical accessibility problems (axe-core, WCAG 2.2 AA), such as low contrast or missing labels
- layout shift after a screen has settled

Before it starts, it runs its checks on a page built with each of these problems, and stops if any of them is missed. Smaller issues, like tap targets under 24px or text that may be clipped, are listed as warnings. Screenshots and `report.json` go to `dist/sweep/`. On a new machine, run `npm run check:setup` once to install the two browsers.

`npm test` also checks that every entrypoint, card button, brand image and font resolves (`src/client/links.test.ts`). It also sends every endpoint junk input, logged in and logged out, and expects a 4xx back, never a crash (`server.test.ts`).

After an upload, open the post on a real phone in the Reddit app and tap each of the card's buttons once.

Once it's installed, the app makes the first post. You can also use the subreddit menu item "Nonet: new daily cube post".

## Code

| Path                | What's in it                                                                                                                 |
| :------------------ | :--------------------------------------------------------------------------------------------------------------------------- |
| `src/server/`       | The Devvit server: daily cubes, scoring, boards, streaks, flair, challenges, crews, posts and the wiki, all stored in Redis. |
| `src/shared/`       | Types and rules shared by the server and the game.                                                                           |
| `src/client/`       | The feed card (`splash.ts`) and the game (`game.ts`, `nonet/`).                                                              |
| `public/`           | HTML entry points, self-hosted fonts and brand images.                                                                       |
| `tools/standalone/` | Builds a single offline HTML file of the game against a mock server, for demos.                                              |
| `tools/check/`      | The pre-upload sweep of every screen.                                                                                        |
