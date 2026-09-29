import { useState } from "react";

/**
 * Ô nhập được mồi bằng giá trị từ máy chủ, nhưng người dùng sửa được — và khi máy chủ trả giá trị
 * MỚI (lưu xong, đổi tài khoản, kéo làm mới) thì ô phải nhận giá trị mới đó.
 *
 * Không dùng `useEffect` + `setState`: đó là một vòng render thừa cho mỗi lần dữ liệu về, và React
 * gọi thẳng nó là phản mẫu. Đây là mẫu "điều chỉnh state khi prop đổi" của chính React — so sánh
 * ngay trong lúc render và `setState` tại chỗ; React dựng lại component ngay lập tức trước khi vẽ,
 * nên không có nhấp nháy và không có render tầng.
 *
 * `seedKey` quyết định KHI NÀO mồi lại: đổi khoá thì lấy `seed` mới, còn giữa hai lần đổi thì chữ
 * người dùng đang gõ là bất khả xâm phạm.
 */
export function useServerSeededState<T>(seed: T, seedKey: string): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(seed);
  const [lastKey, setLastKey] = useState<string>(seedKey);

  if (seedKey !== lastKey) {
    setLastKey(seedKey);
    setValue(seed);
  }

  return [value, setValue];
}
