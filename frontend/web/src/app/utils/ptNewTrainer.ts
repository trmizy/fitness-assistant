/**
 * "Mới trên Gymini" label for trainers approved within the last 30 days.
 * The backend decides who is new (`isNewTrainer` on every public PT, one 30-day rule shared with the ranking);
 * the client only shows the label. Unreviewed trainers keep "Chưa có đánh giá": the badge never implies a rating.
 */
export const NEW_TRAINER_LABEL = "Mới trên Gymini";
export const NEW_TRAINER_DESCRIPTION = "PT mới gia nhập nền tảng trong 30 ngày qua";

export function isNewTrainerPt(pt: { isNewTrainer?: unknown } | null | undefined): boolean {
  return pt?.isNewTrainer === true;
}
