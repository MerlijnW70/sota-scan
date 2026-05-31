# sota-scan

### Is your project as good as the best out there? Find out.

Point it at your project. It asks one thing:

> **"What do the best projects have that I don't?"**

It checks the top real projects in your space. Compares them to yours. Hands you a scorecard and a to-do list.

Every gap points to a real project that already does it. No vague advice. No fluff.

---

## Why it's good

🪞 **An honest mirror.** Where you really stand.

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

- *"Is my project top-tier?"*
- *"What am I missing vs the best?"*

Done. It does the rest.

---

## How deep?

| Say | You get | For |
|---|---|---|
| `/sota-scan quick` | top 3 gaps | a fast check |
| `/sota-scan` | full scorecard | everyday use |
| `/sota-scan exhaustive` | the deepest scan | launch / investor ready |

---

## Good to know

- Needs **Claude Code** with internet.
- It won't tell you to pivot. Just how to win at what you already do.
- It scanned itself and came out top-tier. Proof in [`.sota/`](.sota/).

---

MIT licensed. Free to use and build on. See [LICENSE](LICENSE).
