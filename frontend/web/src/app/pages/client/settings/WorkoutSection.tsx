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
      title="Tap luyen"
      description="Hanh vi khi dang tap va thiet bi tap luyen cua ban"
    >
      <ToggleRow
        label="Hien chi so RPE/RIR"
        description="An/hien thanh truot RPE/RIR va phan giai thich khi ghi set trong buoi tap"
        checked={settings.showRpeRir}
        onChange={() => update({ showRpeRir: !settings.showRpeRir })}
        testId="settings-workout-show-rpe-rir"
      />

      <ToggleRow
        icon={Sparkles}
        label="Dien san thong minh"
        description="Dung muc tieu hom nay hoac lan tap truoc de goi y gia tri cho set tiep theo"
        checked={settings.smartPrefill}
        onChange={() => update({ smartPrefill: !settings.smartPrefill })}
        testId="settings-workout-smart-prefill"
      />

      <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3">
        <div className="min-w-0 flex items-start gap-3">
          <Timer className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm text-zinc-200 font-semibold">
              Nghi mac dinh
            </p>
            <p className="text-xs text-zinc-500">
              Dung khi bai tap hoac set khong co thoi gian nghi rieng
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
          <span className="text-xs text-zinc-500">giay</span>
        </div>
      </div>

      <ToggleRow
        label="Giu man hinh khi dang tap"
        description="Bat/tat Screen Wake Lock khi dong ho buoi tap hoac timer nghi dang chay"
        checked={settings.keepScreenAwake}
        onChange={() => update({ keepScreenAwake: !settings.keepScreenAwake })}
        testId="settings-workout-keep-screen-awake"
      />

      <ToggleRow
        icon={Volume2}
        label="Am bao het gio nghi"
        description="Phat beep ngan khi rest timer ve 0 neu trinh duyet cho phep am thanh"
        checked={settings.restTimerSound}
        onChange={() => update({ restTimerSound: !settings.restTimerSound })}
        testId="settings-workout-rest-sound"
      />

      <ToggleRow
        icon={Vibrate}
        label="Rung khi het gio nghi"
        description="Dung Vibration API tren thiet bi ho tro khi rest timer ket thuc"
        checked={settings.restTimerVibration}
        onChange={() => update({ restTimerVibration: !settings.restTimerVibration })}
        testId="settings-workout-rest-vibration"
      />

      <LinkRow
        icon={Dumbbell}
        label="Thiet bi tap luyen"
        description="Doi phong gym hoac cap nhat thiet bi ban co de loc bai tap phu hop"
        to="/client/training-equipment"
        testId="settings-link-training-equipment"
      />
    </SectionCard>
  );
}
