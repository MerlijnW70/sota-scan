# sota-scan

### Is your project as good as the best out there? Find out.

Point it at your project. It asks one thing:

> **"What do the best projects have that I don't?"**

It checks the top real projects in your space. Compares them to yours. Hands you a scorecard and a to-do list.

Every gap points to a real project that already does it. No vague advice. No fluff.

---

## Why it's good

🪞 **An honest mirror.** Where you really stand.

🎯 **A fair fight.** It sorts projects by approach. It compares you to your real peers. Not a random pile. Borrowed ideas from other styles are marked optional, never counted against you.

🧾 **Receipts, not opinions.** Every gap names a real project.

✅ **A real to-do list.** Ranked. Worst first. With a next step.

📈 **Tracks progress.** Run it again. See what improved.

---

## What you get

```
🧭 SOTA Standing — my-project

   Verdict: Solid core. Behind on testing and security.

   Score:  █████░░░░░  63%      Standing: BEHIND      vs 11 projects

   ▶ Do this next:
     Add injection detection. Everyone serious has it. You don't.
     Copy it from <real project>.

   🏆 The leaders    📊 How you compare    🔧 To-do list
```

---

## Try it (2 min)

It's an add-on for [Claude Code](https://claude.com/claude-code). Copy two files in:

**Mac / Linux**

```bash
mkdir -p ~/.claude/skills/sota-scan ~/.claude/workflows
cp SKILL.md ~/.claude/skills/sota-scan/
cp workflows/sota-scan-fanout.js ~/.claude/workflows/
```

**Windows**

```powershell
New-Item -ItemType Directory -Force ~/.claude/skills/sota-scan, ~/.claude/workflows | Out-Null
Copy-Item SKILL.md ~/.claude/skills/sota-scan/
Copy-Item workflows/sota-scan-fanout.js ~/.claude/workflows/
```

Open Claude Code in any project. Say:

```
/sota-scan
```

Or just ask:

- _"Is my project top-tier?"_
- _"What am I missing vs the best?"_

Done. It does the rest.

---

## How deep?

| Say                     | You get          | For                     |
| ----------------------- | ---------------- | ----------------------- |
| `/sota-scan quick`      | top 3 gaps       | a fast check            |
| `/sota-scan`            | full scorecard   | everyday use            |
| `/sota-scan exhaustive` | the deepest scan | launch / investor ready |

**First time? Start with `quick`.** Cheap, fast taste. Go deeper once you like it.

---

## What it costs

It does real research — reads a dozen competitor projects, not just summaries. So it's not instant or free:

| Mode         | Roughly                           |
| ------------ | --------------------------------- |
| `quick`      | ~80–150k tokens · a minute or two |
| `standard`   | ~150–350k tokens · a few minutes  |
| `exhaustive` | ~400k+ tokens · several minutes   |

Use it now and then — before a launch, a pitch, or when you're curious — not on every commit. On a Claude plan it's bundled. Paying per token? Lean on `quick`.

---

## Good to know

- Needs **Claude Code** with internet.
- It won't tell you to pivot. Just how to win at what you already do.
- It scanned itself and came out top-tier. Proof in [`.sota/`](.sota/).

---

MIT licensed. Free to use and build on. See [LICENSE](LICENSE).
