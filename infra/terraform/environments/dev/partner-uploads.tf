# Gym Partner self-service onboarding — S3 for legal documents and facility photos.
# See GYM_PARTNER_SECURITY_MODEL.md §6. Written for review; NOT applied by the code change
# that introduced it (needs the AWS account of whoever operates this environment).
#
# Two buckets with deliberately different exposure:
#
#   partner_private       legal documents + application photos while the application is under
#                         review. No public access of any kind; the app only ever hands out
#                         short-lived presigned URLs.
#   partner_public_photos branch photos AFTER approval (copied server-side from the private
#                         bucket). The bucket itself stays fully private too (Block Public Access,
#                         same module); public reads happen ONLY through a CloudFront origin
#                         access control, wired by ops before go-live — see the checklist in
#                         GYM_PARTNER_SECURITY_MODEL.md. Legal documents are never copied here.
#
# Both come from modules/private-s3-bucket: Block Public Access (all four flags), default
# server-side encryption AES256, versioning — the project standard.

variable "partner_upload_allowed_origins" {
  type        = list(string)
  description = "Browser origins allowed to POST application uploads directly to the private bucket."
  default     = ["https://localhost:5173", "http://localhost:5173"]
}

module "s3_partner_private" {
  source = "../../modules/private-s3-bucket"

  bucket_name = "${var.project}-partner-private-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

module "s3_partner_public_photos" {
  source = "../../modules/private-s3-bucket"

  bucket_name = "${var.project}-partner-photos-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

# The browser uploads straight to S3 with a presigned POST (size/type conditions are signed by
# the server), so the private bucket needs CORS for exactly the web origins and nothing else.
resource "aws_s3_bucket_cors_configuration" "partner_private" {
  bucket = module.s3_partner_private.bucket_name

  cors_rule {
    allowed_methods = ["POST", "PUT"]
    allowed_origins = var.partner_upload_allowed_origins
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }
}

# Objects that were presigned but never confirmed must not linger forever.
resource "aws_s3_bucket_lifecycle_configuration" "partner_private" {
  bucket = module.s3_partner_private.bucket_name

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# What the gym-service execution role needs — attach to it (kept separate so this file does
# not edit modules/iam, which another workstream owns).
data "aws_iam_policy_document" "partner_uploads_access" {
  statement {
    sid       = "PartnerPrivateObjects"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:GetObjectAttributes"]
    resources = ["${module.s3_partner_private.bucket_arn}/partner-applications/*"]
  }

  statement {
    sid       = "PartnerPublicPhotoCopy"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${module.s3_partner_public_photos.bucket_arn}/gym-photos/*"]
  }
}

resource "aws_iam_policy" "partner_uploads_access" {
  name   = "${var.project}-${var.environment}-partner-uploads-access"
  policy = data.aws_iam_policy_document.partner_uploads_access.json
}

output "partner_private_bucket" {
  value       = module.s3_partner_private.bucket_name
  description = "PARTNER_S3_PRIVATE_BUCKET for gym-service."
}

output "partner_public_photos_bucket" {
  value       = module.s3_partner_public_photos.bucket_name
  description = "PARTNER_S3_PUBLIC_BUCKET for gym-service (serve only through CloudFront OAC)."
}

output "partner_uploads_access_policy_arn" {
  value       = aws_iam_policy.partner_uploads_access.arn
  description = "Attach to the gym-service execution role."
}
