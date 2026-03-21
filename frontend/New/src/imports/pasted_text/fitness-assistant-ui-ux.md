Design a complete web application UI/UX system for a product called “Fitness Assistant – AI Gym Coach”.

PRODUCT OVERVIEW
This is a health-tech and fitness-coaching platform for tracking gym training and personal health, analyzing body metrics from InBody reports, generating AI-powered workout and nutrition plans, connecting clients with personal trainers (PTs), supporting contract-based coaching relationships, scheduling sessions, realtime chat, and online coaching.

The product should feel like a modern, premium, data-driven health platform:
- trustworthy
- clean
- professional
- slightly premium
- technologically advanced
- fitness-focused but not overly aggressive or masculine
- suitable for an academic thesis demo and also realistic enough for real-world product development

PRIMARY USERS / ROLES
Design the product for 3 roles:
1. Client
2. PT / Coach
3. Admin

PLATFORM CONTEXT
This is a desktop-first responsive web app.
Design should be realistic and practical for implementation in React + TypeScript + Tailwind CSS.
Use reusable components and consistent patterns.
Do not create visually extreme or overly artistic layouts that are hard to implement.

VISUAL STYLE
Create a modern health-tech UI with:
- light mode first
- clean card-based layouts
- soft but professional shadows
- moderate border radius
- high readability for data-heavy screens
- clear content hierarchy
- modern icon style
- minimal clutter
- elegant use of whitespace
- dashboards that feel analytical and actionable
- subtle fitness/AI visual language
- premium but not flashy

COLOR DIRECTION
Use a health-tech color system:
- Primary: deep blue or blue-teal
- Secondary accents: teal, green, soft cyan
- Success: green
- Warning: amber
- Danger: red
- Neutral: slate / gray scale
Avoid overly saturated neon colors.
The interface should feel calm, intelligent, and trustworthy.

TYPOGRAPHY
Use a clean modern sans-serif style.
Emphasize readability for:
- data cards
- tables
- charts
- forms
- long dashboards
- health metrics
Headings should feel structured and professional.
Body text should be clear and compact without feeling cramped.

OVERALL UX PRINCIPLES
- clarity over decoration
- professional enterprise-grade layout with consumer-friendly polish
- strong information hierarchy
- reusable layout system
- consistent spacing and visual rhythm
- obvious status indicators for health data, contracts, plans, approvals, and sessions
- every complex flow should feel guided
- empty states should teach the user what to do next
- loading and processing states should be explicit
- error states should be helpful and calm
- action hierarchy should be clear

APP STRUCTURE
Create a full information architecture and UI system for these major modules.

==================================================
1. AUTHENTICATION
==================================================
Design these screens:
- Login
- Register
- Forgot password
- Reset password
- Optional onboarding flow after registration

Auth design style:
- clean split-screen or centered card layout
- premium health-tech feel
- optional illustration or abstract fitness/AI visualization
- clear form validation
- social login placeholders if needed
- CTA hierarchy should be obvious

==================================================
2. CLIENT APPLICATION
==================================================

2.1 Client Dashboard
Design a rich dashboard page with:
- top greeting section
- quick summary of current health/training state
- key health metric cards
- weight trend
- skeletal muscle mass trend
- body fat trend
- current active plan summary
- next coaching session summary
- contract status summary
- AI insight panel
- recent workout activity
- nutrition compliance snapshot
- quick action buttons:
  - Upload InBody
  - Log Workout
  - View Plan
  - Message PT
  - Book Session

Include:
- KPI cards
- mini charts
- progress rings/bars
- timeline widgets
- recommendation cards
- alerts/reminders section

2.2 Profile & Goal Setup
Design a page for:
- personal profile
- age, gender, height, weight baseline
- fitness goal selection:
  - lose fat
  - gain muscle
  - gain weight
  - maintain body
  - improve health
- training experience level
- activity level
- daily routine
- dietary preference
- sleep / lifestyle preference
- medical or health note placeholder
- “Become a PT” CTA with state display

This page should feel:
- guided
- editable
- structured in sections
- easy to scan
- suitable for long forms

2.3 InBody Module
Design a complete InBody experience:
- InBody overview page
- upload image page
- image preview page
- OCR / extraction processing state
- extraction review & confirmation screen
- manual edit screen for extracted fields
- InBody history table/list
- comparison view between two records
- trend dashboard for body metrics

Important metrics:
- weight
- height
- skeletal muscle mass
- body fat mass
- segmental lean analysis
- segmental fat analysis

Design needs:
- image upload card
- extraction status badges:
  - Uploaded
  - Processing
  - Extracted
  - Needs Confirmation
  - Failed
- review form with confidence indicators
- highlight changed metrics over time
- charts for trends
- segmented body analysis cards or diagrams
- ability to compare previous vs latest record

Make this one of the most impressive modules visually because it is a core feature.

2.4 Workout Log
Design screens for:
- today’s workout
- exercise list
- exercise detail
- set / rep / weight / RPE logging
- completed workout summary
- weekly workout history
- performance trends
- personal records

UI should include:
- exercise cards
- tables for set logging
- check state / completed state
- progress indicators
- expandable exercise details
- workout calendar/history

2.5 Nutrition Log
Design screens for:
- daily meal logging
- calories/macros summary
- meal cards
- nutrition target vs actual
- food item search placeholder
- shopping list concept
- weekly nutrition compliance

UI should balance:
- numbers
- charts
- cards
- clear meal grouping

2.6 AI Plans
Design a plan management module for clients:
- AI-generated workout plan
- AI-generated meal plan
- plan detail page
- weekly plan structure
- daily task breakdown
- rationale panel explaining why AI recommends this plan
- plan status display:
  - Draft
  - Pending PT Review
  - Active
  - Archived
- PT-reviewed adjustment markers
- version comparison between AI draft and approved plan

Include:
- tabs
- plan summary cards
- exercise/day accordions
- macro targets
- explanation side panel
- status badges
- notes from PT

2.7 PT Discovery / Coaching Marketplace
Design pages for:
- PT listing page
- filter sidebar
- PT profile card
- PT detail page
- specialties
- credentials
- service packages
- pricing
- availability
- reviews placeholder
- CTA to request coaching / create contract

Style:
- professional marketplace feel
- trustworthy
- strong profile cards
- strong service/package layout

2.8 Contract Module
Design a full contract experience:
- contract list
- contract detail page
- contract creation/review page
- digital signature state
- contract lifecycle timeline
- package details
- PT and client details
- contract status:
  - Draft
  - Pending Signature
  - Active
  - Completed
  - Expired
  - Cancelled

Important UX:
- the contract should feel formal and trustworthy
- include legal/terms summary section
- show quota / remaining sessions
- show important dates
- show signature status
- show next allowed actions

2.9 Coaching Schedule / Booking
Design:
- booking calendar
- available slots
- session booking flow
- session detail
- upcoming sessions
- past sessions
- reschedule / cancel states

Important:
- active contract should visually unlock booking
- non-active contract should show restriction state
- schedule should be easy to read

2.10 Chat Module
Design a realtime chat experience between client and PT.
The chat should feel contextual and linked to a contract/coaching relationship.

Include:
- conversation list
- message panel
- contract context header
- session reminder banner
- status badge
- message composer
- empty state
- restricted state if no contract
- optional attachment placeholder
- clean modern message bubbles
- desktop two-column layout

2.11 Video Coaching
Design:
- waiting room
- live session layout
- video area placeholders
- session details side panel
- quick notes panel
- end session state
- post-session summary page

Style:
- clean, focused, minimal distractions
- professional coaching environment

2.12 AI Coach
Design an AI assistant/chat page:
- conversation panel
- input prompt
- suggested prompts
- AI answer cards
- retrieved knowledge / reference snippets
- recommendations
- disclaimer area that this is not medical advice

This page should feel intelligent and safe.

==================================================
3. PT / COACH APPLICATION
==================================================

3.1 PT Dashboard
Design a professional PT dashboard with:
- active clients count
- upcoming sessions
- active contracts
- pending plan reviews
- clients needing attention
- client progress alerts
- revenue/package summary placeholder
- coaching productivity snapshot

3.2 Client List
Design:
- searchable list/table
- filters
- client cards
- contract status
- goal tags
- latest InBody snapshot
- progress summary

3.3 Client Detail Page
This should be a very important PT screen.
Include:
- client profile summary
- active goal
- contract summary
- InBody history
- health metric trends
- workout adherence
- nutrition adherence
- AI plan draft
- PT adjustment tools
- chat shortcut
- schedule shortcut
- notes panel

The PT should immediately understand the client’s condition and progress.

3.4 Plan Review / Adjustment
Design a PT workflow where:
- AI suggests a plan
- PT reviews and modifies it
- PT approves or requests changes
- comparison between AI version and PT final version is visible

Use:
- side-by-side or diff-inspired layout
- inline editing
- comments
- approval buttons
- review status

3.5 Coaching Schedule
Design PT schedule view:
- calendar
- session cards
- filters
- session detail drawer
- reschedule / cancel controls

3.6 Session Notes
Design a structured note-taking interface for PT:
- session summary
- pain points
- progress
- recommendations
- next session focus
- homework / client tasks

3.7 PT Profile & Services
Design:
- PT public profile editor
- bio
- certifications placeholder
- specialties
- pricing packages
- availability settings
- PT verification status:
  - Not PT
  - Pending
  - Approved
  - Rejected

==================================================
4. ADMIN APPLICATION
==================================================

4.1 Admin Dashboard
Design an admin dashboard that shows:
- total users
- total PTs
- active contracts
- scheduled sessions
- OCR extraction success / fail rate
- system health summary
- usage overview
- important alerts

4.2 User Management
Design:
- searchable/filterable table
- user detail drawer
- role/status indicators
- account actions

4.3 PT Management
Design:
- PT list
- PT verification review
- approval workflow
- PT profile audit
- package/service overview

4.4 Contract Management
Design:
- contract table
- statuses
- filters
- detail view
- important dates
- action history

4.5 Session Management
Design:
- coaching session overview
- session status filters
- PT/client references
- support/admin intervention controls

4.6 System Monitoring Overview
Design a monitoring page for thesis/demo:
- request volume
- OCR extraction status
- processing queue status
- system alerts
- charts for service health
Keep it understandable for non-dev judges while still looking technical.

==================================================
5. NAVIGATION SYSTEM
==================================================

Create a complete navigation system:
- desktop left sidebar
- topbar with:
  - search
  - notifications
  - user avatar menu
  - quick actions
- role-based sidebar navigation
- clear active state
- expandable groups if necessary
- responsive sidebar behavior
- mobile fallback concept

==================================================
6. DESIGN SYSTEM
==================================================

Create a reusable design system including:
- color palette
- semantic colors
- typography scale
- spacing scale
- shadows
- radii
- button styles
- input styles
- dropdowns
- tabs
- badges
- chips
- cards
- modals
- drawers
- stepper
- timeline
- toast
- tooltip
- table
- pagination
- empty states
- skeleton states
- chart cards
- metric cards
- file upload component
- OCR review form component
- contract summary card
- chat message bubble
- conversation item
- calendar slot card
- session note editor
- AI recommendation card

==================================================
7. REQUIRED STATUS / STATE DESIGN
==================================================

Design explicit UI states for:
- AI Plan:
  - Draft
  - Pending PT Review
  - Active
  - Archived

- Contract:
  - Draft
  - Pending Signature
  - Active
  - Completed
  - Expired
  - Cancelled

- Coaching session:
  - Upcoming
  - Completed
  - Cancelled
  - Rescheduled

- PT Verification:
  - Not PT
  - Pending
  - Approved
  - Rejected

- InBody Extraction:
  - Uploaded
  - Processing
  - Extracted
  - Needs Confirmation
  - Failed

- Chat availability:
  - Available
  - Restricted
  - Contract Required

- Video session:
  - Waiting
  - Live
  - Ended

==================================================
8. IMPORTANT END-TO-END FLOWS
==================================================

Design complete flows for:
1. Register → onboarding → set goals → dashboard
2. Upload InBody image → processing → OCR review → confirm save → trend dashboard
3. AI plan generated → PT review → plan activated
4. PT browsing → contract creation → signature → contract active
5. Contract active → book coaching session → join video session → save session notes
6. Contract-linked chat between Client and PT
7. Client clicks “Become a PT” → status shown in profile
8. Admin reviews PT verification / system overview

==================================================
9. LAYOUT / COMPONENT EXPECTATIONS
==================================================

Use:
- dashboard cards
- charts
- trend lines
- tables
- calendars
- timelines
- drawers
- modals
- multistep forms
- contextual side panels
- comparison components
- review confirmation interfaces

For data-heavy pages, create:
- overview header
- filter/action toolbar
- main content grid
- right-side contextual panel when useful

==================================================
10. RESPONSIVE BEHAVIOR
==================================================

Design desktop-first, but also provide responsive logic for:
- tablet
- mobile fallback
Make mobile simplified but still usable for:
- dashboard
- chat
- InBody upload
- workout logging
- schedule
Do not make mobile the primary layout.

==================================================
11. MICROCOPY STYLE
==================================================

Microcopy tone:
- clear
- professional
- supportive
- health-oriented
- encouraging but not overly emotional
- concise for dashboards
- explicit for forms and status messages

==================================================
12. OUTPUT FORMAT
==================================================

Generate:
1. design direction / moodboard description
2. sitemap / information architecture
3. design system
4. full app shell and navigation
5. low-fidelity wireframes
6. high-fidelity screen concepts
7. reusable component library
8. desktop responsive layouts
9. main flows for all 3 roles
10. state variations for loading, empty, success, error, processing, restricted, and approval states

==================================================
13. PRIORITY SCREENS
==================================================

If you need to prioritize, start with these:
1. Client Dashboard
2. InBody Upload + OCR Review + InBody History
3. AI Plan page
4. Contract Detail page
5. Chat page
6. PT Dashboard
7. PT Client Detail page
8. Admin Dashboard
9. Login / Register
10. Booking Calendar

FINAL DESIGN GOAL
The final interface should be:
- beautiful enough for presentation/demo
- clear enough for judges to understand the business logic
- realistic enough for developers to build with React + Tailwind
- cohesive across Client, PT, and Admin roles
- especially strong in health metrics, plan management, contract flow, coaching flow, and chat flow