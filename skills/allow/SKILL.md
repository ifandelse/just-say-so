---
name: allow
description: Permit a term the checker flagged — appends it to the project's Vale vocabulary (accept.txt) when the rules that report it honour the vocabulary, adds the Vocab key to .vale.ini when it lacks one, and explains the way out when a rule ignores the vocabulary.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/src/cli/allow.js" *)
---

The user wants to permit a term that the just-say-so checker flagged as a precise domain term in this project. Run:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli/allow.js" $ARGUMENTS
```

Show the command's output verbatim in a code block. It says whether the entry was written and which rules it silences. When it says a rule ignores the vocabulary, it also lists the two ways out, rewriting the phrase or turning the rule off; do not edit `.vale.ini` yourself, and do not add the `= NO` line unless the user asks for it. If the user gave no term, ask which term to allow before running anything.
