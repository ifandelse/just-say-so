---
name: doctor
description: Report how just-say-so reads this project's setup — the Vale binary and config in force, the bundled styles and their pins, which rules each target lints under, the raw section settings, and every warning (missing formats, dead chat.md sections, restated BasedOnStyles, package tag drift, a synced bundled style out of step, vocabulary entries a nonword rule ignores, sync needed, block mode with no error rule, legacy config keys).
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/src/cli/doctor.js" *)
---

The user wants to see how just-say-so reads this project's configuration. Run:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli/doctor.js"
```

Show the report verbatim in a code block. Then, in at most three sentences, say what each warning means for this project and which one to fix first. If there are no warnings, say so in one sentence. Do not edit any file unless the user asks.
