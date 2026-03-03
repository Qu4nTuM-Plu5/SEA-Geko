# Responsible AI

## Purpose
This product uses AI to generate learning content and tutor responses for education continuity. It is not a clinical, legal, or emergency decision system.

## Guardrails
- Structured outputs: generation endpoints require strict JSON-compatible formats for each content type.
- Content sanitization: server-side validation normalizes malformed or placeholder outputs.
- Low-bandwidth adaptation: AI is instructed to prefer text-first approaches when connectivity is constrained.
- Segment-aware instructions: prompts include beneficiary context to reduce irrelevant assumptions.

## Safety Boundaries
- Mental health content (if any) is non-clinical informational support only.
- No diagnosis, treatment, or crisis counseling output should be treated as professional care.
- Unsafe, abusive, or harmful public content is reportable and can be hidden by moderation thresholds.

## Bias and Inclusion
- Beneficiary segmentation is explicit (youth, educator, displaced, community org).
- Language support is configurable per profile and session.
- Known gap: language quality consistency differs by model/provider and should be tested in-country.

## Human Oversight
- Course creators and facilitators can review content before public publishing.
- Public content has moderation states and reporting mechanisms.
- Judges and partners should treat AI outputs as draft educational material requiring facilitator review in sensitive contexts.
