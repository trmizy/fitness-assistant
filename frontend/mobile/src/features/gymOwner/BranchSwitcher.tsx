import { ScrollView, Text, View } from "react-native";

import { Tappable } from "../../components/ui";
import { SelectField } from "../../components/SelectSheet";
import { branchName, type OwnedGym } from "./gymOwner";

/**
 * Chuyển CHI NHÁNH — không phải chuyển thương hiệu. Một chủ gym có đúng một thương hiệu
 * (`GymBrand.@@unique([ownerId])`), thứ họ đổi qua lại là các chi nhánh của nó.
 *
 * Hai hình thức, chọn theo số lượng: vài chi nhánh thì dải chip cho thấy tất cả trong một cái liếc.
 * Nhiều hơn thì dải chip thành một băng chuyền vô tận — tài khoản kiểm thử có **55 chi nhánh**, muốn
 * tới cái cuối phải vuốt hàng chục lần và không có cách nào tìm theo tên. Từ ngưỡng đó dùng bộ chọn
 * có ô tìm kiếm (`SelectField`, tìm không dấu) như mọi danh sách dài khác trong ứng dụng.
 */
const CHIP_LIMIT = 4;

export function BranchSwitcher({
  gyms,
  activeId,
  onChange,
}: {
  gyms: OwnedGym[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  if (gyms.length <= 1) return null;

  if (gyms.length > CHIP_LIMIT) {
    return (
      <View className="px-5 pt-4">
        <SelectField
          label="Chi nhánh"
          value={activeId}
          options={gyms.map((g) => ({ value: g.id, label: branchName(g) }))}
          onChange={onChange}
        />
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="mt-4"
      contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
    >
      {gyms.map((g) => {
        const on = g.id === activeId;
        return (
          <Tappable
            key={g.id}
            accessibilityLabel={branchName(g)}
            onPress={() => onChange(g.id)}
            className={`rounded-full border px-3.5 py-2 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
          >
            <Text className={`font-body-semibold text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>
              {branchName(g)}
            </Text>
          </Tappable>
        );
      })}
    </ScrollView>
  );
}
