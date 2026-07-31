// Cấu trúc i18n đơn giản — object hằng số tiếng Việt, chưa cần lib i18n
// đầy đủ (react-i18next...). Nếu cần đa ngôn ngữ thật sự sau này, đây là
// điểm mở rộng: đổi `strings` thành `strings[locale]` + hook `useLocale()`.
export const strings = {
  auth: {
    loginTitle: "Đăng nhập",
    registerTitle: "Tạo tài khoản",
    email: "Email",
    password: "Mật khẩu",
    firstName: "Tên",
    lastName: "Họ",
    loginButton: "Đăng nhập",
    registerButton: "Đăng ký",
    otpTitle: "Xác nhận OTP",
    otpDescription: "Nhập mã 6 số vừa gửi tới email của bạn",
    otpButton: "Xác nhận",
    noAccount: "Chưa có tài khoản?",
    hasAccount: "Đã có tài khoản?",
    goToRegister: "Đăng ký ngay",
    goToLogin: "Đăng nhập",
    invalidEmail: "Email không hợp lệ",
    passwordTooShort: "Mật khẩu tối thiểu 8 ký tự",
    otpInvalid: "Mã OTP phải có 6 chữ số",
    loginFailed: "Sai email hoặc mật khẩu",
    genericError: "Có lỗi xảy ra, vui lòng thử lại",
  },
  common: {
    loading: "Đang tải...",
    retry: "Thử lại",
    cancel: "Hủy",
    save: "Lưu",
    close: "Đóng",
    logout: "Đăng xuất",
  },
} as const;
