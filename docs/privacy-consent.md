# Privacy and Consent

## Data Collected
- Account identifier (email OTP identity in production design; local account id in current demo mode).
- Profile context: segment, connectivity, language, learning goal, region, device class.
- Learning telemetry: start/completion and quiz event metadata.
- Course interaction data needed for continuity and KPI computation.

## Data Minimization
- Only fields required for personalization, continuity, and impact metrics are stored.
- No raw personal document uploads are required for core functionality.
- Public sharing is opt-in per course.

## Consent Assumptions
- Users consent to educational analytics for improvement and reporting when using the platform.
- Facilitators and organizations are expected to collect local consent where policy requires it.

## Retention and Deletion (Policy Target)
- Profile and progress records retained until user deletion request or program retention window end.
- Abuse and moderation records retained longer for safety audit integrity.
- Deletion workflow should remove personal profile and account-linked progress while preserving aggregated anonymized metrics.

## Security Notes
- Production target: Supabase with RLS and role separation.
- Demo fallback uses local server JSON persistence; this is acceptable for hackathon demos but not production.
