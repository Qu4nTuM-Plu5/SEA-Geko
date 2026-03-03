# AI Singapore Submission Brief (Single-Scope Lane)

## Selected Lane
- Primary scope: Education access and learning continuity for low-connectivity and disrupted learners.

## Beneficiary Design
- Primary: youth 18-35 in rural/underserved settings.
- Secondary: educators/facilitators, displaced learners, and community-based organizations.
- Implementation: onboarding captures segment, connectivity level, learning goal, language, region, and device class.

## AI Solution
- AI-generated assessment, course outline, lesson plans, and step content.
- Adaptive prompt constraints by segment and connectivity:
  - low bandwidth: text-first, lightweight activities, fewer video dependencies
  - educator: facilitation tips
  - community org: checkpoint/reporting orientation
- Multilingual targeting: generation instructions include preferred language context.

## Meaningful Impact Framework
- Tracked outcomes:
  - users reached
  - skill gain percentage points (pre/post)
  - confidence gain (pre/post 1-5 scale)
  - completion rate
  - day-7 retention proxy
- Instrumentation:
  - `course_started`, `lesson_started`, `lesson_completed`, `quiz_submitted`, `course_completed`, `daily_active`

## Theme Alignment
- Knowledge and Skills: adaptive course generation and guided progression.
- Scientific Progress: practical AI application to personalize and localize learning.
- Stronger Communities: cohorts, moderated public sharing, and facilitator workflows.

## Risks and Controls
- Hallucination risk: constrained output schemas and content validation.
- Harmful content risk: report flow + moderation statuses (`clean`, `under_review`, `flagged`, `hidden`).
- Privacy risk: account-scoped data model and documented retention boundaries.
