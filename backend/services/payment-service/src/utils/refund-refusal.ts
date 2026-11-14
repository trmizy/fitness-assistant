/** N13F-04 - the refusal body for an original with no wallet references (paid at a gateway, or a top-up). */
export function noWalletRefundRefusal(original: { purpose?: string | null; relatedEntityType?: string | null }): { code: string; message: string } {
  if (original.purpose === 'PT_CONTRACT' || original.relatedEntityType === 'PT_CONTRACT') {
    return {
      code: 'NOT_REFUNDABLE_CONTRACT_PAYMENT',
      message: 'Đây là khoản thanh toán hợp đồng PT qua cổng thanh toán nên không hoàn bằng nút này. Tiền hợp đồng được hoàn khi kết thúc hợp đồng hoặc khi xử lý hồ sơ khiếu nại.',
    };
  }
  if (original.purpose === 'GYM_MEMBERSHIP' || original.relatedEntityType === 'GYM_MEMBERSHIP') {
    return {
      code: 'NOT_REFUNDABLE_MEMBERSHIP_PAYMENT',
      message: 'Đây là khoản thanh toán gói hội viên qua cổng thanh toán nên không hoàn bằng nút này. Hãy hoàn qua quy trình hoàn gói hội viên của phòng gym.',
    };
  }
  if (original.purpose === 'WALLET_TOPUP') {
    return { code: 'NOT_REFUNDABLE', message: 'Đây là khoản nạp ví, không phải khoản mua nên không hoàn bằng nút này.' };
  }
  return { code: 'NOT_REFUNDABLE', message: 'Giao dịch này không đi qua ví nên không hoàn được bằng nút này.' };
}
