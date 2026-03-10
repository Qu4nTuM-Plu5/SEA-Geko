# In-Country Localization QA Checklist

## Release metadata
- Locale:
- Reviewer:
- Country:
- Date:
- Build/commit:

## Language quality
- Terminology is natural for local learners (not literal machine translation).
- Tone matches product voice (clear, supportive, concise).
- SDG10-sensitive phrasing avoids exclusionary/offensive wording.
- Acronyms and technical terms are explained where needed.

## Functional QA
- Key parity with `en.json` confirmed.
- Placeholders preserved (`{name}`, `{{name}}`, `%s`, `%d`).
- No broken interpolation or variable order.
- Line wrapping/truncation verified on desktop and mobile.
- Buttons, tabs, and alerts fit within UI components.

## Domain QA (learning content)
- Course labels and progress terms are context-correct.
- Assessment/generation/error messages are understandable.
- Community/profile/download terms are culturally appropriate.

## Defect log
- Severity `P0`: blocks release.
- Severity `P1`: must fix before next patch.
- Severity `P2`: can ship with follow-up ticket.

| ID | Screen | Key | Issue | Severity | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

## Sign-off
- QA pass: Yes / No
- Approved by:
- Notes:

