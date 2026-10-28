---
name: draft
description: Draft reminder bullets for the Vale rules this project enforces that the just-say-so rules text only names — grouped by theme, as a rules.extra fragment the user pastes and edits.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/src/cli/undescribed.js" *)
---

The user wants bullets for the Vale rules this project enforces that the reminder currently lists by name only. Arguments given, if any: $ARGUMENTS (pass `--all` through when the user wants warning and suggestion rules too).

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli/undescribed.js" $ARGUMENTS
```

If it reports nothing to draft, say so in one sentence and stop.

Otherwise write the bullets. Rules for the writing:

- Group rules by theme into as few bullets as read well. Forty figurative-verb rules are one bullet, not forty. Put every grouped rule's id in that bullet's `vale` list, copied exactly from the command output.
- Each bullet has `id` (a short kebab-case slug), `full` (one to three sentences, the instruction and what it covers), `short` (one sentence, under 20 words, for the reminder), and `vale`.
- Write instructions, not descriptions of the rule: "Do not open a reply with a pleasantry," not "This rule flags pleasantries."
- Follow the communication rules in force: lead with the instruction, one idea per sentence, concrete words, no banned terms.
- Use the rule's message, description, and the tokens it looks for as the source of what it checks. Do not invent coverage the rule does not have.

Print the result as one JSON object in a code block, in this shape:

```json
{
  "sections": [
    {
      "title": "Project rules",
      "rules": [
        { "id": "no-pleasantries", "full": "...", "short": "...", "vale": ["ai-tells.ClosingPleasantries", "ai-tells.OpeningCliches"] }
      ]
    }
  ]
}
```

Then tell the user, in three sentences at most: this is a draft to edit; save it as `.just-say-so-rules.json` in the project root, where the plugin finds it with no setting (or anywhere `rules.extra` points); the reminder then carries these bullets and stops naming those rules. Do not write any file yourself.
