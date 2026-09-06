import { useMemo, useState } from "react";
import * as GyminiIcons from "../../components/icons/gymini";
import { GyminiMonkeyMark } from "../../components/icons/gymini/mascot";

/**
 * Dev-only visual review page for the Gymini icon system (spec §20 "Icon Gallery"). Not
 * linked from anywhere in the app's real navigation — reachable only by typing /dev/icons —
 * and renders nothing outside a dev build so it can never end up in a production bundle's
 * user-facing surface even if someone finds the URL.
 */
const SIZES = [16, 20, 24, 32] as const;

const ICON_GROUPS: Array<{ label: string; names: string[] }> = [
  {
    label: "Core (P0)",
    names: [
      "GyminiDashboardIcon",
      "GyminiInBodyIcon",
      "GyminiPlanIcon",
      "GyminiWorkoutIcon",
      "GyminiNutritionIcon",
      "GyminiDiscoverIcon",
      "GyminiServicesIcon",
      "GyminiChatIcon",
      "GyminiWalletIcon",
      "GyminiProfileIcon",
      "GyminiSettingsIcon",
    ],
  },
  {
    label: "Feature (P1)",
    names: [
      "GyminiUsersIcon",
      "GyminiContractIcon",
      "GyminiScheduleIcon",
      "GyminiGymIcon",
      "GyminiAdminIcon",
      "GyminiMarketplaceIcon",
      "GyminiCompareIcon",
      "GyminiCatalogIcon",
      "GyminiMoneyIcon",
      "GyminiSystemIcon",
      "GyminiDisputeIcon",
      "GyminiWorkflowIcon",
    ],
  },
];

export function IconGalleryPage() {
  const [size, setSize] = useState<(typeof SIZES)[number]>(24);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [query, setQuery] = useState("");

  const filteredGroups = useMemo(
    () =>
      ICON_GROUPS.map((group) => ({
        ...group,
        names: group.names.filter((n) =>
          n.toLowerCase().includes(query.trim().toLowerCase()),
        ),
      })).filter((group) => group.names.length > 0),
    [query],
  );

  if (!import.meta.env.DEV) {
    return null;
  }

  const isDark = theme === "dark";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: isDark ? "#0a0a0a" : "#f8fafc",
        color: isDark ? "#f4f4f5" : "#111827",
        padding: "24px clamp(16px, 4vw, 32px)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
        <GyminiMonkeyMark size={40} />
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
            GYMINI ICON SYSTEM
          </h1>
          <p style={{ fontSize: 13, opacity: 0.6, margin: 0 }}>
            dev-only review — /dev/icons — not linked from app navigation
          </p>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "center",
          margin: "20px 0 32px",
          maxWidth: "100%",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span style={{ fontWeight: 700 }}>Size:</span>
          {SIZES.map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              style={{
                marginRight: 6,
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid " + (isDark ? "#27272a" : "#d1d5db"),
                background: size === s ? "#22c55e" : "transparent",
                color: size === s ? "#052e16" : "inherit",
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span style={{ fontWeight: 700 }}>Theme:</span>
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid " + (isDark ? "#27272a" : "#d1d5db"),
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {isDark ? "Dark" : "Light"} (click to toggle)
          </button>
        </label>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icon name..."
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid " + (isDark ? "#27272a" : "#d1d5db"),
            background: isDark ? "#18181b" : "#fff",
            color: "inherit",
            fontSize: 13,
            minWidth: 220,
            flex: "1 1 220px",
            maxWidth: "100%",
          }}
        />
      </div>

      {filteredGroups.map((group) => (
        <div key={group.label} style={{ marginBottom: 32 }}>
          <h2
            style={{
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: 1,
              opacity: 0.5,
              marginBottom: 12,
            }}
          >
            {group.label}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 12,
            }}
          >
            {group.names.map((name) => {
              const Icon = (GyminiIcons as any)[name];
              if (!Icon) return null;
              return (
                <div
                  key={name}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    padding: 16,
                    borderRadius: 10,
                    border: "1px solid " + (isDark ? "#27272a" : "#e2e8f0"),
                    background: isDark ? "#111111" : "#ffffff",
                  }}
                >
                  <div style={{ display: "flex", gap: 10 }}>
                    <Icon size={size} style={{ color: isDark ? "#f4f4f5" : "#111318" }} />
                    <Icon size={size} style={{ color: "#22c55e" }} />
                  </div>
                  <span style={{ fontSize: 11, opacity: 0.7, textAlign: "center" }}>
                    {name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
