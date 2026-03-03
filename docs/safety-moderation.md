# Safety and Moderation

## Public Content Lifecycle
1. User publishes course as private or public.
2. Public content enters moderation status (`under_review` by default in current demo implementation).
3. Community can report harmful or abusive content.
4. Status transitions:
- `clean`: visible and trusted
- `under_review`: pending checks
- `flagged`: risk identified, limited visibility
- `hidden`: removed from public feed

## Abuse Reporting
- Reports are recorded with reason and reporter id.
- Threshold-based auto-actions can flag/hide repeated abusive content.
- Moderation logs should be auditable in production.

## Current Heuristic Limits
- The current version uses simple thresholds and does not perform advanced classifier moderation.
- For production, add dedicated toxicity/PII/self-harm detection models and human escalation.

## Escalation Policy (Target)
- High-risk safety cases: immediate hide + moderator review.
- Repeat abusers: account-level restrictions.
- False positives: allow restore path with moderation action log.
