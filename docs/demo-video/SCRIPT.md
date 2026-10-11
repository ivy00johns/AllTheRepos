# SCRIPT — alltherepos-demo

**Voice:** TBD — human read or synthetic is still open (see [open decisions](../DEMO-VIDEO.md)).
**Voice settings:** TBD with the voice.
**Voice direction:** A developer talking to a developer. Dry, unhurried, a little wry — never
hyped. Let the screens carry the energy and the voice carry the meaning. Land the last word of
each line, then let the beat breathe before the cut; the gaps are what make the UI readable.

**Structure:** lines are tied to the ten beats in the narration arc in
[the demo video plan](../DEMO-VIDEO.md) — `(Beat N)`, not `(Frame N)`, because no storyboard
exists yet. They become storyboard frames at the sketch pass. `**Time:**` is a guide, not
authoritative; real timing comes from TTS word timestamps or the read-through.

---

## Line 1 — Cold open (Beat 1)

**Time:** 0:00 – 0:16
**Delivery:** Quiet, conspiratorial. Almost a joke between friends.

    Somewhere in your home folder is a project you can't remember the name of. You know it's
    there. You just can't remember what you called it, or where you put it, or what it does.

## Line 2 — What this is (Beat 2)

**Time:** 0:17 – 0:34
**Delivery:** Plain and declarative — this is the only line that states the product.

    AllTheRepos is one window for every git repository on your machine — hundreds, or
    thousands of them. Point it at the folders where you keep code, and it learns what all of
    them are, without moving a single one.

## Line 3 — The scan (Beat 3)

**Time:** 0:35 – 0:52
**Delivery:** Matter-of-fact, matching the grid filling. No urgency.

    Add a scan root, press Scan, and watch it fill. It walks the tree in a worker thread, reads
    each repository's remotes, languages and last commit, and writes the result into one SQLite
    file on your own disk.

## Line 4 — Search (Beat 4)

**Time:** 0:54 – 1:08
**Delivery:** The release of the tension from line 1. Slightly brighter.

    Then stop guessing at folder names. Search all of them at once — full text by default, and
    when Ollama is running, vector ranking fused into it, so even a half-remembered phrase still
    lands.

## Line 5 — Triage at a glance (Beat 5)

**Time:** 1:10 – 1:32
**Delivery:** Brisk list, one idea per clause, each landing on its own mark on screen.

    The grid answers what you would otherwise open six repositories to ask. How long since you
    touched it, what it is written in, whether the tree is dirty, whether the folder has moved
    off disk — and a mark that says whether it is yours, a clone, or only ever local.

## Line 6 — Your vocabulary (Beat 6)

**Time:** 1:33 – 1:44
**Delivery:** Warmer. This one is about the user, not the tool.

    Add your own words on top of it: tags, favourites, groups — and each project's own tasks
    read from the files that already declare them.

## Line 7 — Curated links and the graph (Beat 7)

**Time:** 1:45 – 2:02
**Delivery:** Forward-leaning, a little technical — this is the line your agents will care about.

    Draw the lines between repositories you already know belong together, see the whole shape as
    a graph, and let your own coding agents read those relationships through the built-in MCP
    server, so your tooling knows the map too.

## Line 8 — It keeps up (Beat 8)

**Time:** 2:04 – 2:15
**Delivery:** Offhand, almost an aside. Do not sell it.

    Scan roots, folders and file watching all stay live in the background, so when you come back
    to the window, the catalog is already correct.

## Line 9 — Local-first, provably (Beat 9)

**Time:** 2:16 – 2:30
**Delivery:** Steady and serious. This is the claim the whole piece rests on.

    No account, no telemetry, and nothing leaves the machine. One SQLite file that is yours —
    and every command, every write and every network request is inventoried and disclosed in the
    repository.

## Line 10 — Close (Beat 10)

**Time:** 2:31 – 2:41
**Delivery:** Light, a small smile. Then silence for the logo and the downloads line.

    Keyboard-first, free, and local. It is alpha on macOS — so download it, and finally find
    that repository you were looking for.

---

## Timing check

Spoken text across the ten lines is **333 words** — **2:28** at 135 wpm, against the 2:30 target
and the 3:00 hard cap in the plan. With the ~1.4s hold between beats, the piece runs **2:42**.

| Line  | 1  | 2  | 3  | 4  | 5  | 6  | 7  | 8  | 9  | 10 |
| ----- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- |
| Words | 35 | 38 | 38 | 33 | 50 | 24 | 38 | 25 | 31 | 21 |

The `**Time:**` on each line is **derived from that table, not guessed** — words ÷ 135 wpm, plus
the hold. 135 wpm is a typical pace for this register; the real numbers arrive as TTS word
timestamps or a read-through, and they replace these guides rather than the other way round.

A **word** here is a token containing a letter or a digit: a standalone em-dash is a pause, not a
word, and TTS emits no timestamp for one. Six of those were being counted before, which is why
these figures are 333 rather than 339 — the count moved because the rule got right, not because
the script did.

Two constraints that must survive any edit:

- **The `⌘K` palette is spoken about nowhere and shown at the close** — that pairing is
  deliberate; adding a line for it gives the close two endings.
- **No install claim beyond "alpha on macOS".** This build is ad-hoc signed and not notarised
  until ATR-046 lands, so a line promising a one-click install would be false. The first-launch
  steps belong to the DMG's `READ-ME-FIRST.txt`, not to the voiceover.
