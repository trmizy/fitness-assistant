import { Text, View } from "react-native";
import { render } from "@testing-library/react-native";

/**
 * Guards the test setup itself. If this fails, nothing else in this folder is trustworthy —
 * it means the RN/Jest wiring (transforms, the relocated-package resolution, the preset) broke,
 * not the component under test.
 */
describe("testing setup", () => {
  it("renders a plain component", async () => {
    const view = await render(
      <View>
        <Text>xin chào</Text>
      </View>,
    );
    expect(view.getByText("xin chào")).toBeTruthy();
  });
});
