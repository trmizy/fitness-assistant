/** D7 - entry of the two money-exception chips: reads the capabilities once (A1) and hands the flags to the right view. */
import { HeldNoShowView } from "./HeldNoShowView";
import { LateOpenView } from "./LateOpenView";
import { useCapabilities } from "./useMoneyExceptionData";

export function MoneyExceptionView({ view }: { view: "held-no-show" | "late-open" }) {
  const caps = useCapabilities();
  // a failed capabilities read is "unknown", never "on": the views then show no write control
  const props = { caps: caps.data, capsFailed: caps.isError };
  return view === "held-no-show" ? <HeldNoShowView {...props} /> : <LateOpenView {...props} />;
}
