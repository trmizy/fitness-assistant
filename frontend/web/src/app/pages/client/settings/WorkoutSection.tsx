import { BarbellIcon as Dumbbell, SparkleIcon as Sparkles, TimerIcon as Timer, SpeakerHighIcon as Volume2, VibrateIcon as Vibrate } from "@phosphor-icons/react";
import { SectionCard } from "./components/SectionCard";
import { ToggleRow } from "./components/ToggleRow";
import { LinkRow } from "./components/LinkRow";
import { useWorkoutSettings } from "../../../hooks/useWorkoutSettings";

/**
 * Settings -> Workout exposes only controls wired into real WorkoutLogPage
 * behavior: RPE/RIR visibility, fallback rest duration, and Screen Wake Lock.
 */
export function WorkoutSection() {
  const { settings, update } = useWorkoutSettings();

  return (
    <SectionCard
      id="workout"
      icon={Dumbbell}
      iconColor="text-orange-400"
      iconBg="bg-orange-500/10 border-orange-500/20"
      title="Tập luyện"
      description="Hành vi khi đang tập và thiết bị tập luyện của bạn"
    >
      <ToggleRow
        label="Hiện chỉ số RPE/RIR"
        description="Ẩn/hiện thanh trượt RPE/RIR và phần giải thích khi ghi set trong buổi tập"
        checked={settings.showRpeRir}
        onChange={() => update({ showRpeRir: !settings.showRpeRir })}
        testId="settings-workout-show-rpe-rir"
      />

      <ToggleRow
        icon={Sparkles}
        label="Điền sẵn thông minh"
        description="Dùng mục tiêu hôm nay hoặc lần tập trước để gợi ý giá trị cho set tiếp theo"
        checked={settings.smartPrefill}
        onChange={() => update({ smartPrefill: !settings.smartPrefill })}
        testId="settings-workout-smart-prefill"
      />

      <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3">
        <div className="min-w-0 flex items-start gap-3">
          <Timer className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm text-zinc-200 font-semibold">
              Nghỉ mặc định
            </p>
            <p className="text-xs text-zinc-500">
              Dùng khi bài tập hoặc set không có thời gian nghỉ riêng
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <input
            data-testid="settings-workout-default-rest"
            type="number"
            min={15}
            max={300}
            step={15}
            value={settings.defaultRestSeconds}
            onChange={(event) =>
              update({ defaultRestSeconds: Number(event.target.value) })
            }
            className="w-20 px-2 py-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
          />
          <span className="text-xs text-zinc-500">giây</span>
        </div>
      </div>

      <ToggleRow
        label="Giữ màn hình sáng khi đang tập"
        description="Bật/tắt giữ màn hình sáng khi đồng hồ buổi tập hoặc bộ đếm giờ nghỉ đang chạy"
        checked={settings.keepScreenAwake}
        onChange={() => update({ keepScreenAwake: !settings.keepScreenAwake })}
        testId="settings-workout-keep-screen-awake"
      />

      <ToggleRow
        icon={Volume2}
        label="Âm báo hết giờ nghỉ"
        description="Phát tiếng bíp ngắn khi bộ đếm giờ nghỉ về 0, nếu trình duyệt cho phép âm thanh"
        checked={settings.restTimerSound}
        onChange={() => update({ restTimerSound: !settings.restTimerSound })}
        testId="settings-workout-rest-sound"
      />

      <ToggleRow
        icon={Vibrate}
        label="Rung khi hết giờ nghỉ"
        description="Rung trên thiết bị hỗ trợ khi bộ đếm giờ nghỉ kết thúc"
        checked={settings.restTimerVibration}
        onChange={() => update({ restTimerVibration: !settings.restTimerVibration })}
        testId="settings-workout-rest-vibration"
      />

      <LinkRow
        icon={Dumbbell}
        label="Thiết bị tập luyện"
        description="Đổi phòng gym hoặc cập nhật thiết bị bạn có để lọc bài tập phù hợp"
        to="/client/training-equipment"
        testId="settings-link-training-equipment"
      />
    </SectionCard>
  );
}
