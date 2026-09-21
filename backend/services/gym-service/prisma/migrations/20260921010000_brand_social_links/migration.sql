-- Link mạng xã hội của thương hiệu (tuỳ chọn). Chỉ cộng thêm cột.
ALTER TABLE "gym_brands" ADD COLUMN "facebook_url" TEXT;
ALTER TABLE "gym_brands" ADD COLUMN "instagram_url" TEXT;
ALTER TABLE "gym_brands" ADD COLUMN "tiktok_url" TEXT;
ALTER TABLE "gym_brands" ADD COLUMN "youtube_url" TEXT;
