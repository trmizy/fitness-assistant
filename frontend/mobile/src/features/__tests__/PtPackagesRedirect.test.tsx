import { render } from "@testing-library/react-native";

import PtPackagesRedirect from "../../../app/pt/packages";

/** Old deep links / pushes to /pt/packages must land on "Tin đăng", not a 404 (the screen itself is gone). Evidence: TEST FIXTURE. */
const mockRedirect = jest.fn();
jest.mock("expo-router", () => ({
  Redirect: (props: { href: string }) => {
    mockRedirect(props.href);
    return null;
  },
}));

it("redirects /pt/packages to /pt/listing", async () => {
  await render(<PtPackagesRedirect />);
  expect(mockRedirect).toHaveBeenCalledWith("/pt/listing");
});
