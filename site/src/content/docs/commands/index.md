---
title: "Commands"
description: "The ten skills, in the order you meet them, and the shape every command page follows."
sidebar:
  label: Overview
  order: 0
---

just-say-so adds ten skills to Claude Code. Each has a page here with the same headings: what it does, the synopsis, the arguments, what it reads and writes, what it prints, and an example run.

In the order you are likely to meet them:

| Skill | When |
| --- | --- |
| [init](/commands/init/) | Setting a project up. |
| [doctor](/commands/doctor/) | A check behaves in a way you did not expect. |
| [restate](/commands/restate/) | The previous reply broke the rules in a way you noticed. |
| [allow](/commands/allow/) | The checker flagged a word that is a real term in this project. |
| [rules](/commands/rules/) and [remind](/commands/remind/) | Load the full rules, or inject the reminder, by hand. |
| [summary](/commands/summary/) | What the plugin has recorded, as facts with counts. |
| [advise](/commands/advise/) | What the recurring tags point at, as changes to make. |
| [packages](/commands/packages/) | Fill the package cache so advice can suggest rules you do not have. |
| [draft](/commands/draft/) | Bullets for a Vale package the reminder only names. |

Every skill wraps a script under `src/cli/`, which you can also run with `node` outside Claude Code. The skill shows the script's output verbatim and adds a few sentences on top.
