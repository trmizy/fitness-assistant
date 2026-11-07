# D6 — `/admin/complaints` legacy parity

Compared with `HEAD:frontend/web/src/app/pages/admin/AdminComplaintsPage.tsx`. A checked item means the function remains in the new UI/source; it does **not** mean a real backend integration was run.

- [x] List gym complaints and filter by `OPEN`, `IN_PROGRESS`, `RESOLVED`, or all. Added server pagination and URL state.
- [x] Refresh the current list, show loading/error/empty states, and show complaint status, issue, source, gym, description, and time.
- [x] Open a complaint detail dialog; view description, reporter source, gym, status, and authenticated photo tokens.
- [x] Move an open complaint to `IN_PROGRESS`.
- [x] Resolve with a required response to the reporter; show the stored response afterwards.
- [x] Preserve the warning: “Xử lý khiếu nại không tự hoàn tiền.”
- [x] Preserve the existing status update path and add `CASE_REQUIRED` guidance/link to the case rather than implying resolution/refund.
- [x] Add assignment via a real ADMIN selection (not an arbitrary typed ID), subject to server recheck.
- [x] Dialog close button/backdrop/Escape and focus return are retained in source.

**Not parity-approved by browser:** the mock run opened the dialog at 390 px and verified the start/resolve controls and no-auto-refund warning. It did not complete actual mocked status mutations, assignment, photo load, keyboard traversal, or account switch. No real API was used.

**Gym-case G1 differs from the old complaint flow:** an Open case form exists in source but is deliberately not rendered. The gym service has no trustworthy capabilities read endpoint, and `case.canSubmit` does not incorporate the environment flag; showing a write button would violate the brief's fail-closed rule. This is a blocker, not a completed feature.

