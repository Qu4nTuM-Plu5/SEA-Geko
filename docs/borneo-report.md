# Borneo Hackathon Judge Report

## Problem Statement (25%)
- Problem: low-connectivity and disrupted learners in ASEAN lose learning continuity, while educators/community facilitators lack lightweight tools to produce localized practical courses quickly.
- Context relevance: targets rural and displaced settings where bandwidth, device capability, and language access are real constraints.
- Objectives:
  - Improve learning continuity in low bandwidth/offline conditions.
  - Increase skill and confidence with measurable pre/post outcomes.
  - Support ASEAN localization and inclusive access.
  - Map to SDGs: SDG 4 (Quality Education), SDG 8 (Decent Work), SDG 10 (Reduced Inequalities).
- AI acknowledgement: multi-provider LLM generation is used for course structure, lesson steps, tutor support, and adaptive personalization.

## AI Integration and Responsible Use (10%)
- Value add: AI automates course generation, adaptation by beneficiary segment, and language output, reducing educator workload.
- Appropriateness: text-first generation and adaptive prompts are prioritized for low-bandwidth conditions.
- Transparency: profile context, routing, and prompt adaptation rules are documented in code and README.
- Safety and ethics: moderation statuses, reporting flow, and high-risk handling paths are implemented.
- Data privacy: account-scoped tracking, explicit profile fields, and retention guidance are documented in privacy docs.

## Innovation and Originality (15%)
- Originality: combines adaptive AI generation, account-based offline continuity, and measurable impact analytics in one learning workflow.
- Problem-solution fit: each lane (youth, educator, displaced, community org) receives tailored constraints in generation prompts.
- ASEAN constraints: low-bandwidth mode, multilingual support, and non-video dependency are first-class.

## Functionality and Prototype (15%)
- Impact and feasibility: end-to-end flow runs from onboarding to generated modules to tracked completion.
- Efficiency: step content is generated on demand to reduce quota cost and latency.
- Practical usage: account-based downloaded courses can be reopened offline without raw file import.

## Visual Design (15%)
- UX: guided flow with clear states (assess, plan, generate, learn).
- Consistency: coherent typography and component styling.
- Accessibility: added labels and keyboard-friendly controls on core interactions; more audit work remains.
- ASEAN inclusivity: language selector and profile-linked preferred language are integrated.

## Pitching (10%)
- Core idea: AI-generated learning continuity for low-connectivity ASEAN learners.
- Values shown: inclusion, measurable outcomes, responsible AI, and scalability.
- Delivery focus: 3-minute demo script included in `pitch/demo-script-3min.md`.

## Market Potential and Scalability (10%)
- Commercial viability: usable by schools, NGOs, skilling hubs, and community orgs.
- Regional appeal: ASEAN language and bandwidth-aware model support multi-country deployment.
- Stakeholders: youth learners, educators, displaced learners, community organizations, and training partners.
- Scalability plan: phased rollouts with cohort analytics and public moderated sharing.
- Sustainability: ongoing metrics dashboard plus governance docs for post-hackathon continuity.
