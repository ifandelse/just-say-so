---
name: allow
description: Permit a term the checker flagged — writes it to the project's Vale vocabulary (accept.txt) when a .vale.ini names StylesPath and Vocab, otherwise to disableWords/allowPhrases in .just-say-so.json.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/src/cli/allow.js" *)
---

The user wants to permit a term that the just-say-so checker flagged as a precise domain term in this project. Run:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli/allow.js" $ARGUMENTS
```

Report the command's output in one sentence. If the user gave no term, ask which term to allow before running anything.
