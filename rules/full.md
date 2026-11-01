## Communication rules

Apply to all prose: chat, explanations, docs, reports, answers.

### Precision first

- Use the correct technical term when it is the most accurate word. Never substitute a vaguer word for a precise one. Checked by 5 Vale rules, among them STE.Ambiguity, ai-tells.IncompleteComparison, ai-tells.FigurativeWorth.
- On first use of a term the reader may not know, add a short definition in the same sentence. Then use the term freely.
- The test: a technical term has a precise, checkable definition in its domain (idempotent, amortized, TLS). A buzzword could appear in any press release (robust, seamless). Keep the first kind, delete the second.
- Do not remove information the reader needs. Remove information they do not need. Simplify the sentence, not the substance.
- Claims you can check. Do not write "the only way", "handles all edge cases", or "every concern is addressed" unless you checked every case. Say which cases you checked. Checked by ai-tells.AbsoluteAssertions, ai-tells.UniversalObject, ai-tells.UniversalSubject.

### Sentence and paragraph mechanics

These are adapted from ASD-STE100 (Simplified Technical English), minus its 900-word approved
dictionary and minus its part-of-speech restrictions.

- Lead with the answer, decision, result, or required action. Checked by ai-tells.CataphoricForecasting, ai-tells.ExplainerLeads, ai-tells.RhetoricalDevices, ai-tells.RhetoricalSelfAnswer.
- Use descriptive headings and lists when they make longer text easier to scan. Checked by ai-tells.AnnouncementHeadings, ai-tells.MarketingHeadings, ai-tells.WrapUpHeadings, ai-tells.MicDropHeadings.
- One idea per sentence. Most sentences under 20 words. Checked by 6 Vale rules, among them STE.SentenceLength, ai-tells.ConsequenceClause, ai-tells.ConsequenceParticiple.
- Prefer active voice with a named actor (for example: "the scheduler retries the job," not "the job is retried"). Use passive voice when the actor is unknown or irrelevant. Checked by STE.PassiveVoice.
- Prefer simple tenses (for example: "we updated," not "has been updated") when they preserve the intended time and state.
- Use one term for each concept. Do not use that term for a different concept in the same document. Pick one of check/verify/validate for a given concept and keep it.
- Concrete verbs and nouns over abstractions. Checked by 8 Vale rules, among them ai-tells.AbstractionSubject, ai-tells.ServesAsDodge, ai-tells.PseudoCleft.
- Noun clusters: three words maximum. Write "the retry policy for the claim adjudication engine," not "claim adjudication engine retry policy configuration." Checked by STE.NounClusters, ai-tells.NounString.
- Give each paragraph one topic. Keep most paragraphs under six sentences. Checked by STE.ParagraphLength.
- Keep articles and relative pronouns. Write "verify that the handler returns null," not "verify handler returns null." Do not drop function words to save space. Checked by STE.Articles.
- End paragraphs with a fact or an instruction, never a flourish. The last sentence of an argument is where trained habit inserts an invented metaphor, personified code ("the config lies," "the field is a trap"), or the same point restated in stronger words. If the closing sentence adds no information, delete it. Checked by 50 Vale rules, among them ai-tells.MicDrop, ai-tells.PointVerdict, ai-tells.AnthropomorphicCognition.
- Punctuation. No em dashes. A semicolon joins two clauses only when the second has its own comma. Otherwise write two sentences. A literal `--` belongs in a code span. Checked by ai-tells.EmDashUsage, ai-tells.SemicolonUsage, ai-tells.DoubleHyphen.

### Banned

- These buzzwords are banned in vague or ornamental usage: leverage, robust, seamless, holistic, streamline, empower, cutting-edge, game-changing, synergy, delve, utilize (use "use"), structural spine, load bearing, blast radius, belt-and-suspenders, honest take. When these words have precise meaning or are relevant to the domain, use them. Checked by 16 Vale rules, among them JustSaySo.Buzzwords, JustSaySo.Substitutions, JustSaySo.Leverage.
- Any format of "it's not {x}, it's {y}". Checked by 8 Vale rules, among them JustSaySo.NegativeParallelism, ai-tells.ContrastiveNegation, ai-tells.ContrastiveFormulas.
- Filler frames: "It's important to note," "It should be noted that," "In today's landscape," "In order to" (use "to"). Checked by 16 Vale rules, among them JustSaySo.FillerFrames, JustSaySo.Substitutions, ai-tells.FillerPhrases.
- Empty intensifiers: very, truly, crucial, vital. Replace them with a measurement or a concrete consequence. Checked by 5 Vale rules, among them JustSaySo.Intensifiers, ai-tells.FillerIntensifier, ai-tells.OverusedVocabulary.
- Restating the question, re-summarizing what was just said, or repeating a point in new words. Checked by ai-tells.RestatementMarkers, ai-tells.SummativeAppositive, ai-tells.SelfReference, ai-tells.HollowAcknowledgment.
- Banned hedge frames: "It's important to note," "This may seem X, but," stacked hedges. Bare may/might/could are allowed when they state real uncertainty or permission. If uncertain, state what is uncertain and why. Checked by 9 Vale rules, among them ai-tells.HedgingPhrases, ai-tells.DefensiveHedges, ai-tells.StackedHedges.

### Final check

Delete any sentence whose removal loses nothing. Check the last sentence of each paragraph first, where flourish concentrates. Checked by ai-tells.EmptyPadding.
