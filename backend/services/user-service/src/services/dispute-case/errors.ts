/** A deliberate, coded refusal: HTTP `status`, stable machine `code`, Vietnamese `message` (the controller spreads code into the body). */
export type CaseError = Error & { status: number; code: string; details?: unknown };

export function caseError(status: number, code: string, message: string, details?: unknown): CaseError {
  return Object.assign(new Error(message), { status, code, ...(details === undefined ? {} : { details }) });
}

export const notFoundCase = () => caseError(404, "CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");
export const forbiddenRole = () => caseError(403, "ADMIN_ONLY", "Chỉ quản trị viên được thực hiện thao tác này");
export const notInvestigator = () =>
  caseError(403, "NOT_ASSIGNED_INVESTIGATOR", "Chỉ điều tra viên được giao hồ sơ này mới được thực hiện thao tác này");
export const versionConflict = () =>
  caseError(409, "CASE_VERSION_CONFLICT", "Hồ sơ vừa được cập nhật bởi người khác. Vui lòng tải lại rồi thử lại");
