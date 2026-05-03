# Project Handover: Fitness Assistant

## 1. Project Context
*   **Architecture**: Microservices based (API Gateway, Auth, User, Fitness, AI, Chat services) running in Docker.
*   **Tech Stack**: Node.js, Express, Prisma ORM, PostgreSQL, React (Vite), Tailwind CSS.
*   **Current Focus**: Transitioning mock UI to real database-backed features and populating core fitness data.

## 2. Recently Completed: Admin Dashboard Real-Time Data
*   **Goal**: Replace static mock data on the Admin Dashboard with live metrics.
*   **Backend Changes**:
    *   Updated `gateway/src/routes/proxy.routes.ts` (`/admin/dashboard`) to aggregate data from multiple microservices.
    *   Updated `user-service` to provide real-time stats:
        *   Added `countActive()` in `contract.repository.ts`.
        *   Added `adminGetStats` in `profile.controller.ts` to aggregate active contracts and InBody OCR scan statistics (grouped by status: `extracted`, `manual`, `pending`) for the last 7 days.
    *   Fixed a critical bug where `prisma` was not imported in `profile.controller.ts`, preventing stats from loading.
*   **Frontend Changes**:
    *   Refactored `AdminDashboard.tsx` and `UserManagement.tsx` to use `@tanstack/react-query` to fetch and display real data.
    *   Added loading states and error handling.

## 3. Current Work in Progress: Exercise Data Integration (Detailed)
*   **Objective**: Populate the `fitness-service` database with a comprehensive, free database of exercises, avoiding paid APIs (like RapidAPI's ExerciseDB).
*   **Source Data**: Sourced raw JSON data from the open-source GitHub repository `yuhonas/free-exercise-db`.
*   **Implementation Steps Taken**:
    1.  **Data Acquisition**: Downloaded the raw JSON dataset containing over 1,300 exercises.
    2.  **Schema Mapping**: Created a Prisma seed script (`backend/services/fitness-service/prisma/seed_exercises_json.ts`) to parse the JSON and map it to the existing `fitness-service` database schema. 
        *   *Mapping Logic included*:
            *   `category` -> `ExerciseType` (STRENGTH, CARDIO, MOBILITY)
            *   `equipment` -> `EquipmentType` (BODYWEIGHT, BARBELL, DUMBBELLS, etc.)
            *   `primaryMuscles` -> `BodyPart` (UPPER_BODY, LOWER_BODY, CORE, FULL_BODY)
            *   `force` -> `MovementType` (PUSH, PULL, HOLD)
            *   Constructed absolute image URLs pointing directly to the GitHub raw content.
    3.  **Execution Bypass**: Due to Docker volume mount configurations (only `src/` was mounted into `gymcoach-fitness-dev`), the seed script and JSON file were temporarily moved from `prisma/` into the `src/` directory to allow execution from within the container.
    4.  **Database Seeding**: Successfully executed the script via `npx tsx` inside the running `gymcoach-fitness-dev` container.
    5.  **Result**: Successfully imported **873 parsed exercises** into the `exercises` table in the `gymcoach_fitness` PostgreSQL database.

## 4. Next Steps for Next Agent
1.  **Cleanup Exercise Seeding**: Move `raw_exercises.json` and `seed_exercises_json.ts` from `backend/services/fitness-service/src/` back to `backend/services/fitness-service/prisma/`. Update the import path in the script from `./generated/prisma` back to `../src/generated/prisma`.
2.  **Verify Frontend Integration**: Check the client-side/PT-side workout creation screens to ensure the newly imported 873 exercises can be searched, selected, and displayed correctly (including the image URLs).
3.  **System Alerts Logic**: The `System Alerts` on the Admin dashboard currently only checks for `pendingPT` applications. Expand this logic in the gateway if more complex system health monitoring is required.
