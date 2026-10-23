import { useLocalSearchParams } from "expo-router";

import { GymListingScreen } from "../../src/features/gymListing/GymListingScreen";

/**
 * Gym Owner "Tin đăng & tiện ích" — a hidden route (see app/gym-owner/_layout.tsx), reached from "Phòng gym" and from a
 * branch's "Thông tin" tab, and opened by listing notifications with `?gymId=…`. The screen itself lives in
 * features/gymListing so its states can be tested without the router.
 */
export default function GymOwnerListingRoute() {
  const { gymId } = useLocalSearchParams<{ gymId?: string }>();
  return <GymListingScreen initialGymId={gymId ? String(gymId) : null} />;
}
