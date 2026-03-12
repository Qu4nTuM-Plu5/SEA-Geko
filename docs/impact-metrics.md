# Impact Metrics Specification

## Core Metrics
- `users_reached`: unique learners with at least one tracked event.
- `skill_gain_pp`: average post-test score minus average pre-test score (percentage points).
- `confidence_gain`: average post confidence minus average pre confidence (1-5 scale).
- `completion_rate`: course_completed events / course_started events.
- `time_to_completion`: average minutes from course_started to course_completed.
- `d7_retention`: share of started users active on day 7.

## Event Model
- `course_started`
- `lesson_started`
- `lesson_completed`
- `quiz_submitted`
- `course_completed`
- `daily_active`

## Data Sources
- Assessment attempts: pre/post test records.
- Confidence surveys: pre/post 1-5 records.
- Progress events: longitudinal activity and completion timeline.

## Current Demo Computation
- Computes metrics from account-scoped events and attempts.
- Includes KPI cards in-app.
- Uses a basic D7 proxy and default timing fallback if full timestamps are unavailable.


