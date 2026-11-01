# Outside a session: the commit gate, CI, and pinning

## The commit gate

The [hooks](hooks.md) run only inside a Claude Code session. Text reaches a repository in other ways too. A teammate commits by hand, an agent writes a file through a shell command, or a pipeline generates one. The commit gate covers those paths. It runs Vale on the lines a commit adds, and it fails the commit when any of those lines has an error-level alert. It needs `git`, `node`, and `vale`. It does not need the plugin. Every committer meets the same policy.

The gate has two modes:

```
node "<repo or plugin dir>/src/cli/check-staged.js"              # pre-commit: what you are about to commit
node "<repo or plugin dir>/src/cli/check-staged.js" --base main  # CI: everything a branch added since main
```

**What it checks.** Markdown and HTML files: `.md`, `.mdx`, `.markdown`, `.html`, and `.htm`. Generated HTML such as a coverage report or a built docs site enters the gate too, so exempt those paths in `.vale.ini`. Within the checked files, only the lines you added. A file with old problems does not fail your commit when you touch one paragraph of it. The one exception is a rule that judges the whole document, such as a `metric` rule for sentence length or an `occurrence` rule with document-wide scope. Vale reports those at line 1. The gate keeps them whenever the file changed at all.

**Pre-commit mode** lints the staged content, so it sees exactly what will land. If you stage half of a file with `git add -p`, the gate checks that half and ignores the rest. **`--base` mode** lints the working tree and keeps the lines added since the merge-base with the ref you name, uncommitted edits included. An untracked prose file counts as added in full. That gives CI the same check over a whole branch, and `--base HEAD` checks exactly the lines you have not committed yet.

**Exit codes:**

- `0`: clean, or only warnings and suggestions.
- `1`: at least one error-level alert on an added line. The report lists them.
- `2`: `git` or `vale` failed, so the line filter cannot be trusted. The gate refuses to pass a commit it could not check.

**Escape hatches.** To skip the gate for one commit, run `JUST_SAY_SO_PRECOMMIT=0 git commit ...`. When `vale` is missing from PATH, the gate prints a notice and exits 0. Adding the gate to a repo never blocks commits on a machine without Vale.

**Configuration** is the `.vale.ini` alone: the nearest one above the file, or the shipped fallback when there is none. A term you allowed during a session is stored in that config's vocabulary. The gate allows it at commit time too.

**Installing it** in a repository: `/just-say-so:init` does it for the hook tooling the repo already has, and prints the step it cannot do itself (a dev dependency install or `pre-commit install`). By hand, by preference:

1. **The [pre-commit framework](https://pre-commit.com).** This repo ships [.pre-commit-hooks.yaml](../.pre-commit-hooks.yaml). Pin the hook at a tag, and the framework clones the script at that revision:

   ```yaml
   repos:
     - repo: https://github.com/ifandelse/just-say-so
       rev: v0.5.0
       hooks:
         - id: vale-staged
   ```

2. **Husky or plain `.git/hooks`.** Add this repo as a dev dependency from a tag, then call the bin from your hook. The lockfile is the pin, and the package has no transitive dependencies:

   ```json
   { "devDependencies": { "just-say-so": "github:ifandelse/just-say-so#v0.5.0" } }
   ```

   ```
   node_modules/.bin/just-say-so-staged
   ```

Do not point a hook at the Claude plugin cache. The path there is machine-specific and version-suffixed, and the hook silently skips every committer who lacks the plugin.

## Single-prompt runs (CI)

Non-interactive runs, such as `anthropics/claude-code-action`, submit one prompt and end. These behaviors matter there:

- `reply.mode: "warn"` delivers nothing in a single-prompt run: its report rides the next prompt, and there is none. Use `block` when the reply must pass. Otherwise set the reply check to `off` and let `files` and `publish` cover the text, which is where CI output lives.
- `rules.onContextStart: ["startup"]` injects the rules once at the start, which is all a single-prompt run needs.

To run CI stricter than developers' machines, commit a config for it and point the forced layer at that file:

```yaml
env:
  JUST_SAY_SO_FORCE_CONFIG: ${{ github.workspace }}/.github/just-say-so.ci.json
```

```json
{
  "rules": { "onContextStart": ["startup"] },
  "files": { "mode": "warn" },
  "reply": { "mode": "block" }
}
```

Fields the forced file sets win over the project file, so a mode committed to `.just-say-so.json` can never weaken the CI policy. Fields it leaves out come from the lower layers as usual.

## Pinning a version in CI

`anthropics/claude-code-action` installs plugins from a marketplace URL or directory path. You cannot name a branch, tag, or commit in either form. Every run installs whatever is on this repo's default branch at the time. If your repository requires pinned dependencies, that is not enough.

Until the action supports refs, pin by vendoring, which means copying the plugin into your repository:

1. Copy `.claude-plugin/`, `hooks/`, `rules/`, `skills/`, and `src/` from a tagged release into your repository, under a path such as `.github/plugins/just-say-so/`.
2. Point the action at that directory:

   ```yaml
   with:
     plugin_marketplaces: ${{ github.workspace }}/.github/plugins/just-say-so
   ```

3. Record the tag you copied. To upgrade later, diff your copy against the new tag (`git diff v0.1.2 v0.1.3` in a clone of this repo) and apply what changed.

The copy needs no install step: zero npm dependencies, Node ≥ 18.
