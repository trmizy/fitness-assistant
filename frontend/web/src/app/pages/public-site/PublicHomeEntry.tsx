import { PublicSiteLayout } from "../../components/public-site/PublicSiteLayout";
import { HomePage } from "./HomePage";

/**
 * Trang chủ cho khách tại "/" (RootRedirect tải lười chunk này). Dựng layout + trang chủ trong CÙNG một chunk
 * để không bị hai lượt tải nối nhau.
 */
export function PublicHomeEntry() {
  return (
    <PublicSiteLayout>
      <HomePage />
    </PublicSiteLayout>
  );
}
