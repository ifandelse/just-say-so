---
title: "The rules manifest and the extra file"
description: "The shape of the rules file, the extra file that adds, replaces, or drops bullets, and the manifest override."
sidebar:
  order: 7
---

The rules text is rendered from `rules/manifest.json`. That file ships with the plugin and is a build source: the full text, the condensed reminder, and the JustSaySo Vale style all come from it. Edit it and the next plugin update overwrites it, so your changes go in a file of your own.

## The shape

Sections of bullets. Each bullet has an `id`, a `full` text, an optional `short` text, and a `vale` list naming the Vale rules that check it. A bullet with an empty `vale` list is a judgment rule: the model follows it, and no linter checks it.

```json
{
  "sections": [
    {
      "title": "Project rules",
      "rules": [
        { "id": "undefined-term", "full": "On first use of a term the reader may not know, define it in the same sentence.", "short": "Define a term on first use.", "vale": [] },
        { "id": "no-em-dash", "full": "Do not use em dashes.", "short": "No em dashes.", "vale": ["ai-tells.EmDashUsage"] }
      ]
    }
  ]
}
```

A bullet with a `short` text joins the condensed reminder. The `vale` list ties the bullet to its rules: the reminder drops the bullet when every one of those rules is turned off, and the summary classifies a tag with the bullet's id as Vale-backed.

## The extra file

Put a file named `.just-say-so-rules.json` in the project root, or in a directory above it, in the shape above. The plugin finds it with no setting; `rules.extra` names a different path when you want one.

- A bullet with a new `id` is appended under the file's own section.
- A bullet with the `id` of a shipped bullet replaces it in place, text, short, and Vale rules alike, and keeps its slot in the reminder while it has a short text.
- `{ "id": "headings-and-lists", "drop": true }` removes a shipped bullet from the full text and the reminder.

The doctor reports the file in force with its added, replaced, and dropped counts, and warns about a drop that matches no id or a bullet that names a Vale rule no installed style has. `/just-say-so:draft` writes bullets in this shape for the Vale rules your project enforces.

## The manifest override

`rules.manifest` replaces the shipped rules outright with a file of your own in the same shape. You then get no new shipped bullets on upgrade. The generated JustSaySo style still carries the shipped terms; put your own terms in a Vale style of your own and set `JustSaySo = NO` in `.vale.ini` where you disagree. The extra file still merges on top.

## Messages

The sentences the hooks say, the violation report, the rewrite instruction, the confirmation prompt, live in `rules/messages.json`. `rules.messagesPath` names a JSON file that overrides any subset of them by key, for a different wording or another language. The per-term hints in the Vale messages come from the manifest; a full translation edits both.
