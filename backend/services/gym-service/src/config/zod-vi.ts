import { z } from 'zod';

/**
 * N09C-02: the default zod messages ("Required", "Unrecognized key(s) in object", "Invalid enum value ...") reached users as-is. This is the
 * global error map for gym-service: any schema that does NOT give its own message now answers in Vietnamese. A schema's own message (the
 * Vietnamese ones in brand/gym/plan/application schemas) always wins, zod only calls this map when none was given.
 */
const TYPE_VI: Record<string, string> = {
  string: 'văn bản',
  number: 'số',
  integer: 'số nguyên',
  boolean: 'đúng/sai',
  array: 'danh sách',
  object: 'đối tượng',
  date: 'ngày',
};

export const viZodErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'Thiếu thông tin bắt buộc' };
      return { message: `Dữ liệu sai kiểu, cần ${TYPE_VI[issue.expected] ?? 'kiểu khác'}` };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: 'Có trường không được hỗ trợ trong dữ liệu gửi lên' };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: 'Giá trị không nằm trong các lựa chọn cho phép' };
    case z.ZodIssueCode.invalid_literal:
    case z.ZodIssueCode.invalid_union:
    case z.ZodIssueCode.invalid_union_discriminator:
      return { message: 'Giá trị không hợp lệ' };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Email không đúng định dạng' };
      if (issue.validation === 'uuid') return { message: 'Mã định danh không hợp lệ' };
      if (issue.validation === 'url') return { message: 'Đường dẫn không hợp lệ' };
      return { message: 'Chuỗi ký tự không đúng định dạng' };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: Number(issue.minimum) === 1 ? 'Không được để trống' : `Cần tối thiểu ${issue.minimum} ký tự` };
      if (issue.type === 'array') return { message: `Cần tối thiểu ${issue.minimum} mục` };
      return { message: `Giá trị tối thiểu là ${issue.minimum}` };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Tối đa ${issue.maximum} ký tự` };
      if (issue.type === 'array') return { message: `Tối đa ${issue.maximum} mục` };
      return { message: `Giá trị tối đa là ${issue.maximum}` };
    case z.ZodIssueCode.custom:
      return { message: ctx.defaultError === 'Invalid input' ? 'Dữ liệu không hợp lệ' : ctx.defaultError };
    default:
      return { message: 'Dữ liệu không hợp lệ' };
  }
};

let installed = false;
/** Idempotent. app.ts calls it once at start-up. */
export function installViZodErrorMap(): void {
  if (installed) return;
  z.setErrorMap(viZodErrorMap);
  installed = true;
}
