# Limits

- Vale is markup-aware: code blocks and inline code in Markdown never match a rule. A file format Vale cannot identify scans as plain text, where a banned word in a string literal still flags; exempt those paths in `.vale.ini`.
- The edit-scoped feedback locates an `Edit` by searching for its `new_string` in the written file. A string that repeats yields the union of candidate ranges — extra facts, never a miss. A `Write` that replaced a file has nothing to diff against, so the whole file counts and the message says so.
- The checker never scans for may/might/could. The rules allow bare modals when they state real uncertainty or permission. The banned hedge frames are phrases. The checker catches the ones in its phrase list, and the remaining frames appear to the model only in the rules text.
- The violation-triggered injection depends on the harness delivering `UserPromptSubmit` events. Subagent turns never see it, and that is deliberate: each subagent gets its own copy of the rules at spawn instead.
- This repo's own docs and tests quote the banned words, and its `.vale.ini` turns every style off for those paths. Expect the same in any repo that documents its style rules.
