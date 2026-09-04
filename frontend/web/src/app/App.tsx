import { RouterProvider } from "react-router";
import { router } from "./routes";
import { SettingsProvider } from "./context/SettingsContext";

export default function App() {
  return (
    <SettingsProvider>
      <RouterProvider router={router} />
    </SettingsProvider>
  );
}
