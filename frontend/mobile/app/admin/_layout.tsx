import { Banknote, ClipboardCheck, Gavel, ShieldCheck } from "lucide-react-native";

import { RequireRole } from "../../src/components/guards/RequireRole";
import {
  WorkspaceTabs,
  type WorkspaceTab,
} from "../../src/components/navigation/WorkspaceTabs";

/**
 * Admin workspace — an operations console. Tabs from the design prototype's `adminTabs`: each one
 * is a QUEUE of work rather than a section of the product, which is why "Duyệt"/"Xử lý"/"Rút tiền"
 * sit at the top level instead of being folded under a single management tab.
 */
const adminTabs: WorkspaceTab[] = [
  { name: "dashboard", label: "Tổng quan", icon: ShieldCheck },
  { name: "approvals", label: "Duyệt", icon: ClipboardCheck },
  { name: "resolve", label: "Xử lý", icon: Gavel },
  { name: "withdrawals", label: "Rút tiền", icon: Banknote },
];

export default function AdminLayout() {
  return (
    <RequireRole allow={["admin"]}>
      <WorkspaceTabs workspace="admin" tabs={adminTabs} />
    </RequireRole>
  );
}
