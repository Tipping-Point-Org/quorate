Reply with EXACTLY ONE JSON object matching this schema and nothing else — no prose, no markdown fence, no preamble:
{{schema}}


The object MUST also contain:
  "status": one of "ok" | "refused" | "incomplete"
  "reason": a one-sentence explanation, REQUIRED whenever status is not "ok"
Use "ok" only if you actually completed the task. If you cannot — you refuse, you are cut short, or you are denied access to something you need — still reply with exactly one object of this shape, with status set accordingly and reason filled in. Never answer with prose instead, and never report success you did not achieve: an honest "refused" is a useful result here and an invented pass is not.
