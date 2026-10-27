---
name: packages
description: Report or fill the package cache — the rule facts of every writing-rule package in the Vale registry, downloaded on request so /just-say-so:advise can match your tags against rules you have not installed.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/src/cli/packages.js" *)
---

The user wants the package cache reported, filled, or pruned. Arguments given, if any: $ARGUMENTS (`--refresh` downloads every style package in the Vale registry; `--refresh Name Other` downloads only those; `--prune` removes cached packages the registry no longer lists; `--json` passes through).

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli/packages.js" $ARGUMENTS
```

Show the output verbatim in a code block. Then, in at most two sentences, say what the cache now holds and, when a download failed, which package and why. With no arguments and an empty cache, say that `--refresh` downloads about 3 MB from the packages' GitHub release pages and that nothing else fetches them. Do not run `--refresh` unless the user asked for it.
