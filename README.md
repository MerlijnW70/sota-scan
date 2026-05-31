# sota-scan

### Is your project as good as the best ones out there? Find out — with receipts.

Point **sota-scan** at whatever you're building and it answers one simple question:

> **"What do the best projects like mine have that I don't?"**

It goes and looks at the top real projects in your space, compares them to yours, and hands you back a short, honest scorecard — plus a clear to-do list of exactly what to add next, with the most important thing first.

No vague advice. No "best practices" listicle. **Every single thing it says you're missing points to a real project that already has it**, so you can go look for yourself.

---

## Why people love it

🪞 **An honest mirror.** See where you *actually* stand against the best — not where you hope you stand.

🧾 **Receipts, not opinions.** It never just says "you should add X." It says "Project Y has X — here's where." If it can't point to a real source, it doesn't say it.

✅ **A real to-do list.** You get a ranked list of what to fix, worst-first, each with a one-line "why it matters" and a concrete first step you can start on today.

📈 **Tracks your progress.** Run it again next month and it shows what got better, what slipped, and how you stack up now.

---

## What you actually get back

A clean, at-a-glance report — the verdict and your single most important next move are right at the top:

```
🧭 SOTA Standing — my-project

   Verdict: Solid core, but behind the leaders on testing and security checks.

   Score:  █████░░░░░  63%        Standing: BEHIND        Compared against: 11 projects

   ▶ Do this next:
     Add automated injection detection — the one thing every serious
     competitor has and you don't. Copy the approach from <real project>.

   🏆 The leaders        📊 How you compare        🔧 Your to-do list (worst first)
```

…followed by a side-by-side comparison and the full to-do list, each item with a real project to learn from.

---

## Try it in 2 minutes

sota-scan is a small add-on ("skill") for [Claude Code](https://claude.com/claude-code). To install it, copy two files into your Claude setup:

**Mac / Linux**
```bash
mkdir -p ~/.claude/skills/sota-scan ~/.claude/workflows
cp SKILL.md ~/.claude/skills/sota-scan/
cp workflows/sota-scan-fanout.js ~/.claude/workflows/
```

**Windows (PowerShell)**
```powershell
New-Item -ItemType Directory -Force ~/.claude/skills/sota-scan, ~/.claude/workflows | Out-Null
Copy-Item SKILL.md ~/.claude/skills/sota-scan/
Copy-Item workflows/sota-scan-fanout.js ~/.claude/workflows/
```

Then open Claude Code inside any project and just say:

```
/sota-scan
```

or simply ask it in your own words:

- *"Is my project top-tier?"*
- *"What am I missing compared to the best?"*
- *"Go study what the best projects out there do, and compare us."*

That's it. It does the research and hands you the scorecard.

---

## Pick how deep you want to go

| Say… | You get… | Good for |
|---|---|---|
| `/sota-scan quick` | a fast ballpark, top 3 gaps | a 30-second gut check |
| `/sota-scan` | the full scorecard | the everyday "where do we stand?" |
| `/sota-scan exhaustive` | the deepest, widest scan | investor / launch-readiness, "leave nothing out" |

---

## Where it keeps your results

Each project you scan gets a small `.sota/` folder with its scorecard, so the next scan can show your progress over time. Keep it or ignore it — your choice.

---

## Good to know

- It needs **Claude Code** with internet access so it can look up real projects.
- It only compares you *within what your project is already trying to be* — it won't tell you to pivot, just how to be the best version of what you already are.
- Curious whether it practices what it preaches? It scanned **itself** against the best research/benchmarking tools and came out top-tier — that report is in this repo's [`.sota/`](.sota/) folder.

---

MIT licensed — free to use, copy, and build on. See [LICENSE](LICENSE).
