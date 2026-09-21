-- Một giấy tờ đối tác có thể gồm nhiều tệp (CCCD hai mặt, giấy phép nhiều trang).
-- Chỉ cộng thêm: bảng con mới; cột file_key cũ giữ lại nhưng không còn được ghi.
CREATE TABLE "gym_partner_document_files" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gym_partner_document_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gym_partner_document_files_document_id_idx" ON "gym_partner_document_files"("document_id");

ALTER TABLE "gym_partner_document_files" ADD CONSTRAINT "gym_partner_document_files_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "gym_partner_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Chép tệp đang có sang bảng mới (mỗi giấy tờ cũ = đúng 1 tệp), rồi dọn cột cũ để chỉ còn MỘT nguồn.
INSERT INTO "gym_partner_document_files" ("id", "document_id", "file_key", "mime_type", "size_bytes", "uploaded_by", "created_at")
SELECT gen_random_uuid()::text, d."id", d."file_key", COALESCE(d."mime_type", 'application/octet-stream'), d."size_bytes", d."uploaded_by", d."updated_at"
FROM "gym_partner_documents" d
WHERE d."file_key" IS NOT NULL;

UPDATE "gym_partner_documents" SET "file_key" = NULL, "mime_type" = NULL, "size_bytes" = NULL WHERE "file_key" IS NOT NULL;
