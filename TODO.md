# Roadmap and backlog

Working list, newest ideas first. Shipped work moves to the release notes and comes off this file.

## Features to explore

- [ ] **Astro docs site.** The README is written for a new user and the reference lives in `docs/`. A site would give the reference pages navigation and search, and a home for the rules text, the manifest shape, and the Vale integration notes. Open questions: hosted where, built from `docs/` as it stands or restructured, and whether the rules text renders from the manifest at build time so the site never drifts.
- [ ] **A just-say-so logo**, in the same spirit as the Vale logo: simple, flat, one idea. For the README, the docs site, and the plugin listing.
- [ ] **Linting commit messages.** The commit gate lints staged Markdown and HTML and never reads the message. Two pieces exist upstream: the Vale registry ships a `Commit` view, which reads a message as a subject, a body, and trailers, each its own scope (Vale 3.21 or newer), and the `Commits` package carries 102 rules from commitlint, gitlint, and others. The gate would gain a `commit-msg` hook, and `/init` would wire it. Decide which rules apply to a message: the shipped bullets, the `Commits` package, or both.

## Backlog

- [ ] **A golden test from rejected and rewritten pairs.** Each `/restate` record holds the rejected reply, the reason and tag, and the rewrite. Lint both sides and assert the rewrite carries fewer errors, so a rule change that starts flagging good rewrites or stops flagging bad originals fails a test. The Vale `Transcript` view (below) may be the cheapest harness: write the pairs out as one transcript and lint it as one file.
- [ ] **Plugin eval cases** through `claude plugin eval`, built from the same records: the prompt, the rejected reply as the bad answer, the rewrite as the good one, scored under the rules. This is the "does the plugin make the model write better" measurement the summary cannot give.
- [ ] **Manual tests on the day-job repos** for the phases checked here with synthetic data only: the publish fields and the Artifact gate beyond the one live check, drafting bullets, the summary, reason tags, and advice with the package cache filled. The plan is `docs/manual-tests.md` (gitignored).
- [ ] **`rules.messagesPath` relative paths** resolve against the launch directory, not the project. `rules.manifest` and `rules.extra` were fixed in 0.15.0; this one affects hook message wording only.

## Noticed, not planned

- The Vale registry's `Transcript` view lints only the model's turns of a plain-text chat log with `user:` and `assistant:` prefixes. It is the reply check done offline over a whole conversation, with no hook, which is what a harness without a reply hook (Cursor, Copilot CLI) would need. Claude Code's transcripts are JSONL, so an export step or a `dasel` view would come first. https://github.com/vale-cli/packages/blob/master/assets/views/Transcript.yml
