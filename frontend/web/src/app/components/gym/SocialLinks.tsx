import {
  FacebookLogoIcon as Facebook,
  InstagramLogoIcon as Instagram,
  TiktokLogoIcon as Tiktok,
  YoutubeLogoIcon as Youtube,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

export type SocialKey = "facebookUrl" | "instagramUrl" | "tiktokUrl" | "youtubeUrl";
export type SocialLinksValue = Partial<Record<SocialKey, string | null>>;

/** Một danh sách duy nhất cho form nhập (wizard) và phần hiển thị (chi tiết phòng gym, admin). */
export const SOCIALS: { key: SocialKey; label: string; icon: Icon; placeholder: string }[] = [
  { key: "facebookUrl", label: "Facebook", icon: Facebook, placeholder: "https://facebook.com/ten-trang" },
  { key: "instagramUrl", label: "Instagram", icon: Instagram, placeholder: "https://instagram.com/ten-tai-khoan" },
  { key: "tiktokUrl", label: "TikTok", icon: Tiktok, placeholder: "https://tiktok.com/@ten-tai-khoan" },
  { key: "youtubeUrl", label: "YouTube", icon: Youtube, placeholder: "https://youtube.com/@ten-kenh" },
];

/** Nút mở trang mạng xã hội (tab mới, không gửi referrer). Không có link nào thì không vẽ gì. */
export function SocialLinks({ value, compact }: { value: SocialLinksValue | null | undefined; compact?: boolean }) {
  const links = SOCIALS.filter((s) => value?.[s.key]);
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((s) => (
        <a
          key={s.key}
          href={value![s.key]!}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={s.label}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-zinc-500 transition-colors"
        >
          <s.icon className="w-4 h-4 text-zinc-200" weight="fill" />
          {!compact && s.label}
        </a>
      ))}
    </div>
  );
}
