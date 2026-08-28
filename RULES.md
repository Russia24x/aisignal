# RULES.md — Mandatory Workflow Rules

> **These rules are NON-NEGOTIABLE and apply to every session, every agent, and every git operation in this repository.**
> Violating any of them is a critical process failure — even if the code itself is correct.

**Repository:** `https://github.com/Russia24x/aisignal` (branch: `main`)

---

## Rule 1 — NEVER-FORCE-PUSH

**`git push --force` (and `--force-with-lease`) are ABSOLUTELY FORBIDDEN. No exceptions.**

- ❌ `git push --force`
- ❌ `git push -f`
- ❌ `git push --force-with-lease`

**If a normal `git push` is rejected (non-fast-forward):**

1. **STOP immediately.** Do not try to "fix" it on your own.
2. **Report** the exact rejection output to the user.
3. **Wait** for an explicit decision from the user before doing anything else with git.

Never rewrite published history. Never "recover" a rejected push by forcing. A rejected
push means the remote has commits we don't have locally — that is a signal to
*sync and reconcile*, never to overwrite.

---

## Rule 2 — SESSION-START-SYNC-CHECK

**At the start of EVERY session — and after ANY time gap (e.g. after receiving a new
user message following idle time) — run this check BEFORE making any new changes:**

```bash
git fetch origin
git status
```

Then compare local `main` with `origin/main`:

| Observation | Meaning | Action |
|---|---|---|
| `up to date with 'origin/main'` | clean / identical | ✅ Continue working normally |
| `Your branch is ahead of 'origin/main'` | local has unpushed commits | ⚠️ OK to continue, but push when work is committed |
| `Your branch is behind 'origin/main'` | remote has newer commits | 🛑 **STOP immediately** — report and wait for the user's decision |
| `have diverged` | both sides have different commits | 🛑 **STOP immediately** — report and wait for the user's decision |

**If STOP is triggered:** report the divergence (e.g. output of
`git log --oneline --graph --all -20`) and take NO further action — no pull, no
rebase, no merge, no reset — until the user explicitly decides how to reconcile.

**Only if the check is clean/up-to-date may you proceed with new work.**

---

## Why these rules exist

- The remote repository is the **single source of truth** for verified, reviewed state.
- Force-pushing destroys history that other sessions/machines may depend on.
- Silent divergence leads to lost work and irreproducible deployments.
- Security is priority one, two, and three — and that includes git workflow security.
