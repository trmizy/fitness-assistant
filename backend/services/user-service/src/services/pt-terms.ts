/**
 * D25 - the platform's terms for trainers (PT): ONE versioned text, the only place it lives.
 *
 * The backend gates "accept a new client contract" on the version below, and `GET /pt-applications/terms`
 * serves this exact object to web and mobile, so the text a PT reads and the version the server checks can
 * never drift apart. Bump `PT_TERMS_VERSION` whenever any clause changes: every PT is then asked to confirm
 * again before taking NEW contracts (contracts already accepted keep running unchanged).
 *
 * Every clause below describes a rule that RUNS TODAY - the `source` of each is recorded next to it (not served
 * to clients). Exception, by the owner's decision (FH-9, draft-6): clause 2 also describes the PT holdback, which is
 * built but switched OFF (pt-holdback-rate.ts: PT_HOLDBACK_NEW_CONTRACTS_ENABLED, default off) and applies ONLY to contracts
 * created after it is switched on, for PTs who confirmed an OFFICIAL version of these terms that states it
 * (PT_HOLDBACK_TERMS_VERSION). The text says so itself ("hợp đồng được tạo sau khi quy định này có hiệu lực"); it never
 * presents the holdback as applying to a contract that already exists.
 *
 * DRAFT vs OFFICIAL (D74). While the wording awaits the owner's approval `PT_TERMS_IS_DRAFT` is true and the version id is a
 * DRAFT id ("...-pt-draft-N"). A confirmation of a draft is NOT an official acceptance and must never become one by flipping
 * the flag: the official text ships under a NEW, different id ("...-pt-v1"), and the gate only accepts a row for the CURRENT id,
 * so draft rows simply stop matching. `ptTermsReleaseProblem` pins the rule (unit test) and refuses to release draft terms to
 * production (scripts/check-pt-terms-release.ts, post-deploy-state-check T-01) - it is never evaluated at service start, so a
 * running production service cannot be taken down by it.
 */

export const PT_TERMS_VERSION = "2026-10-pt-draft-6";
export const PT_TERMS_IS_DRAFT = true;

/** A version id that marks a draft text. */
export function isDraftTermsVersionId(version: string): boolean {
  return /(^|[-_])draft([-_]|$)/i.test(version);
}

/**
 * Why this build of the terms must not be released, or null when it may. Rules:
 *  - a draft text must carry a draft id and an official text must NOT (flipping the flag alone is not enough);
 *  - draft terms must not be released to production (NODE_ENV=production).
 */
export function ptTermsReleaseProblem(
  env: Record<string, string | undefined>,
  terms: { version: string; isDraft: boolean } = { version: PT_TERMS_VERSION, isDraft: PT_TERMS_IS_DRAFT },
): string | null {
  const draftId = isDraftTermsVersionId(terms.version);
  if (terms.isDraft && !draftId) return `terms are flagged DRAFT but version "${terms.version}" is not a draft id`;
  if (!terms.isDraft && draftId) {
    return `terms are flagged OFFICIAL but still carry the draft id "${terms.version}": give the official text a new id so draft confirmations cannot count`;
  }
  if (terms.isDraft && env.NODE_ENV === "production") return `draft PT terms ("${terms.version}") must not be released to production`;
  return null;
}

export interface PtTermsSection {
  /** Stable id (used as a React key / test hook), never shown. */
  id: string;
  title: string;
  /** Paragraphs, plain Vietnamese. */
  body: string[];
  /** Where in the system/decisions the rule comes from. Server-side documentation only - stripped before serving. */
  source: string;
}

export const PT_TERMS_TITLE = "Điều khoản dành cho Huấn luyện viên";

export const PT_TERMS_INTRO =
  "Đây là những quy tắc đang áp dụng cho Huấn luyện viên (PT) trên Gymini. Bạn cần đồng ý trước khi nhận yêu cầu huấn luyện từ khách. " +
  "Điều khoản chỉ áp dụng cho các hợp đồng bạn chấp nhận SAU khi đồng ý; hợp đồng đã ký hoặc đang chạy không bị thay đổi.";

export const PT_TERMS_SECTIONS: readonly PtTermsSection[] = [
  {
    id: "contract-flow",
    title: "1. Từ yêu cầu của khách đến hợp đồng có hiệu lực",
    body: [
      "Khách chọn một gói dịch vụ của bạn và gửi yêu cầu. Bạn có thể chấp nhận hoặc từ chối yêu cầu đó.",
      "Sau khi bạn chấp nhận, khách có 12 giờ để thanh toán. Quá hạn mà chưa thanh toán thì yêu cầu tự hủy và không phát sinh nghĩa vụ nào. Hợp đồng chỉ có hiệu lực sau khi khách đã thanh toán.",
      "Nếu hợp đồng gắn với một phòng gym, thỏa thuận giữa bạn và gym phải còn hiệu lực tại thời điểm bạn chấp nhận và lúc khách thanh toán; nếu không, hợp đồng mới đó không đi tiếp được.",
      "Hợp đồng gắn với một phòng gym phải có thời hạn cố định (gói PT của bạn phải có số ngày hiệu lực), và gói hội viên đang có của khách tại gym đó phải còn hiệu lực đủ dài để bao phủ toàn bộ thời hạn của hợp đồng. Điều kiện này được kiểm tra khi khách gửi yêu cầu, khi bạn chấp nhận và khi khách thanh toán; nếu không đạt, yêu cầu bị từ chối trước khi có bất kỳ khoản tiền nào được chuyển và hợp đồng giữ nguyên trạng thái.",
      "Khi tài khoản đang bị hạn chế, bạn không thể chấp nhận hợp đồng mới (xem mục 7).",
    ],
    source:
      "contract.service acceptContract / assertGymStillAcceptsContract / CONTRACT_PAYMENT_DEADLINE_HOURS=12 (D12, D13); assertPtMayAct (D31/D38); contract-gym-membership.service assertClientMayRequestGymContract / assertGymContractStillCovered (Codex #6: fixed duration + membership covering it, at request / PT accept / client pay)",
  },
  {
    id: "revenue-split",
    title: "2. Chia tiền của hợp đồng và khoản tạm giữ một phần thu nhập",
    body: [
      "Tỷ lệ chia được chốt vào từng hợp đồng ngay khi khách gửi yêu cầu và không đổi cho hợp đồng đó, kể cả khi thỏa thuận với gym thay đổi về sau.",
      "Hợp đồng không qua phòng gym: bạn nhận 90% giá trị hợp đồng, nền tảng nhận 10%.",
      "Hợp đồng qua phòng gym: tỷ lệ của bạn, của phòng gym và của nền tảng theo thỏa thuận hợp tác giữa bạn và thương hiệu gym tại thời điểm tạo hợp đồng.",
      "Tiền của từng buổi chỉ về ví của bạn sau khi buổi đó được xác nhận (xem mục 3).",
      "Khoản tạm giữ một phần thu nhập. Quy định này chỉ áp dụng cho hợp đồng được tạo sau khi quy định này có hiệu lực và sau khi bạn đã đồng ý phiên bản điều khoản có nội dung này; hợp đồng đã ký hoặc đang chạy không bị thay đổi.",
      "Mức giữ: 10% thu nhập dự kiến của bạn trên chính hợp đồng đó, tức là 10% của phần bạn được nhận theo tỷ lệ chia đã chốt của hợp đồng đó (không phải 10% số tiền khách trả), làm tròn xuống đồng. Ví dụ: hợp đồng 1.000.000đ, bạn nhận 90%, thu nhập dự kiến 900.000đ, mức giữ 90.000đ. Khoản này chỉ lấy từ phần của bạn, không bao giờ lấy từ phần của phòng gym hay của nền tảng, và không tính trên hợp đồng khác.",
      "Cách giữ: khi một buổi trở thành có thể thanh toán (khách xác nhận, hoặc hệ thống tự xác nhận hợp lệ; không phải lúc bạn bấm hoàn thành), thu nhập thật sự của buổi đó (sau khoản trừ vì vào phòng học muộn nếu có) được tạm giữ cho đến khi đủ mức giữ, phần còn lại về ví khả dụng của bạn như bình thường. Buổi bạn vắng mặt không tạo thu nhập nên không có gì bị giữ. Khi đã đủ mức giữ thì không giữ thêm. Số tiền giữ không bao giờ vượt quá thu nhập bạn đã thật sự kiếm được trên hợp đồng đó.",
      "Bản chất: khoản tạm giữ là tiền bạn đã kiếm, đang chưa rút được. Đây không phải phí, không phải doanh thu của nền tảng, và không được dùng để bù cho hợp đồng khác hoặc cấn trừ vào khoản nợ nào khác của bạn.",
      "Trả lại: khoản tạm giữ được trả vào ví khả dụng của bạn sau khi hợp đồng kết thúc và việc đối soát của chính hợp đồng đó hoàn tất, đúng một lần. Thời điểm trả phụ thuộc vào việc kết thúc và đối soát nên không có ngày cố định. Nếu hợp đồng kết thúc sớm, phần không liên quan đến việc nào của hợp đồng đó chưa xử lý xong được trả lại ngay khi kết thúc; Gymini không bao giờ tự tịch thu khoản tạm giữ.",
      "Khi nào được dùng: chỉ để trả cho khách một nghĩa vụ của CHÍNH hợp đồng đó mà quản trị viên đã xem xét và xác minh là thuộc trách nhiệm của bạn, và chỉ phần thuộc phần của bạn (bạn không phải chịu phần của phòng gym hay của nền tảng). Trước hết dùng phần tiền chờ của hợp đồng đó đã được tách riêng cho khoản ấy; không bao giờ trả một khoản hai lần. Việc dùng này không tự động xảy ra chỉ vì bạn bị hạn chế hoặc khóa tài khoản, bạn đơn phương chấm dứt hợp đồng, hay khách khiếu nại.",
      "Phần dự phòng khi còn việc chưa xử lý: khi hợp đồng kết thúc mà còn khoản có thể thuộc trách nhiệm của bạn chưa được tiền chờ của hợp đồng đó bảo đảm (ví dụ bạn có thể phải bồi thường khi bị xác minh là hủy hợp đồng hoặc vắng mặt nhiều lần, hoặc một khoản đang được đối soát), Gymini chỉ giữ lại phần tối đa bạn có thể phải chịu cho việc đó; phần còn lại trả cho bạn ngay. Nếu không tính được mức rủi ro một cách đáng tin cậy, Gymini có thể giữ tối đa toàn bộ khoản tạm giữ của hợp đồng đó, kèm lý do. Mỗi khoản dự phòng được ghi lại kèm lý do, bộ phận xử lý và hạn xem xét (14 ngày); quá hạn sẽ được đưa lên danh sách việc cần quản trị viên quyết định.",
      "Khi có quyết định: nếu không được xác minh là lỗi của bạn, toàn bộ phần dự phòng được trả lại cho bạn; nếu được xác minh, chỉ đúng phần đã xác minh được trả cho khách và phần còn lại trả lại cho bạn. Nếu khoản tạm giữ không đủ, phần còn thiếu được ghi nhận là khoản đang được đối soát với khách; Gymini không ứng tiền, không lấy từ hợp đồng khác và không tự động biến phần thiếu đó thành khoản nợ của bạn.",
    ],
    source:
      "contract.service.requestContract (rates default 0.10/0.90, gym rates from collaboration snapshot) (D3, D5, D11); contract-rates-survive-agreement-change test. FH-9 (owner decision, final): payment-service contract-money.ts holdbackTarget = rate x ptExpectedIncome(price, frozen rates) rounded down; contract-ledger.service releaseSession (hold collected when a session becomes payable, min(entitlement after D77, target - held), PT no-show earns nothing so nothing held; nothing held after the ending is recorded), terminateContract (releases everything not reserved; reserve per cause PT_FAULT / OPEN_OBLIGATION (PT-borne part) / UNSECURED_DISPUTE / UNCOMPUTABLE with a durable pt_holdback_reviews row, review-by PT_HOLDBACK_REVIEW_DAYS=14), releasePtHoldback (after end and no waiting reserve), holdback-review.service (admin VERIFIED / NOT_VERIFIED, four-eyes, CAS, idempotent, only the PT-borne verified part, same contract, shortfall -> OPEN obligation); pt-holdback-rate.ts (flag PT_HOLDBACK_NEW_CONTRACTS_ENABLED default OFF + PT_HOLDBACK_TERMS_VERSION + the PT's confirmation; non-retroactive via contracts.pt_holdback_policy_version)",
  },
  {
    id: "sessions",
    title: "3. Buổi tập: báo hoàn thành, xác nhận và khiếu nại",
    body: [
      "Sau khi buổi tập kết thúc, bạn báo hoàn thành buổi đó. Với buổi học trực tuyến, hệ thống tự ghi nhận khi phòng học đóng. Khách xác nhận, hoặc khiếu nại nếu buổi tập không diễn ra đúng.",
      "Nếu khách không phản hồi trong 3 ngày, hệ thống tự xác nhận buổi tập và chuyển tiền buổi đó cho các bên.",
      "Buổi bị khiếu nại được giữ lại cho đến khi quản trị viên Gymini xem xét và quyết định; tiền của buổi đó chưa được chuyển trong thời gian này.",
    ],
    source:
      "booking.service completeSession / confirmSession / disputeSession, AUTO_CONFIRM_DAYS=3, session-settlement (money-flow §3); room-close-resolution.service cases 3-5 (an ONLINE session still CONFIRMED when the room closes is moved to PENDING_CLIENT_CONFIRMATION by the system without the PT reporting)",
  },
  {
    id: "client-cancel",
    title: "4. Khi khách hủy",
    body: [
      "Khách hủy một buổi trước giờ hẹn từ 24 giờ trở lên: buổi được trả lại để đặt lại, không ai bị tính phí.",
      "Khách hủy buổi trong vòng 24 giờ trước giờ hẹn: khách mất buổi đó và bạn vẫn nhận tiền của buổi đó.",
      "Khách tự chấm dứt hợp đồng giữa chừng: khách được hoàn 90% giá trị phần chưa dùng; 10% còn lại được chia cho các bên theo tỷ lệ của hợp đồng đó.",
    ],
    source:
      "session-outcome.ts rows 1-2 (SESSION_LATE_CANCEL_HOURS=24); contract-money.ts CLIENT_CANCEL_REFUND_RATE=0.90 (D4)",
  },
  {
    id: "pt-cancel",
    title: "5. Khi bạn hủy, vắng mặt hoặc vào phòng học muộn",
    body: [
      "Bạn hủy buổi hoặc chặn ngày trước giờ hẹn từ 24 giờ trở lên: buổi được dời sang lịch khác, không ai bị tính phí.",
      "Bạn hủy hoặc chặn ngày trong vòng 24 giờ trước giờ hẹn, hoặc không có mặt ở buổi đã hẹn: buổi đó được đóng là «không diễn ra» và khách được hoàn giá trị của buổi đó (giá hợp đồng chia cho tổng số buổi) vào ví. Bạn không nhận tiền của buổi đó.",
      "Cần phân biệt hai khái niệm: «buổi được tính vào số buổi đã xử lý của gói» và «buổi bạn đã cung cấp dịch vụ». Buổi «không diễn ra» thuộc loại thứ nhất: nó được trừ vào số buổi của gói và hệ thống không tạo buổi bù. Nhưng đó không phải là buổi bạn đã dạy: nó không bao giờ được hiển thị là đã hoàn thành và không tạo thu nhập cho bạn.",
      "Khoản hoàn được lấy từ chính tiền của hợp đồng đó, không lấy từ tiền của hợp đồng khác. Gymini không cam kết mọi khoản còn thiếu đều được hoàn ngay; trên từng buổi, ứng dụng hiển thị đúng trường hợp đang xảy ra: (a) tiền của hợp đồng đủ — khách được hoàn đủ vào ví, buổi hiện «đã hoàn tiền»; (b) chỉ đủ một phần — khách được hoàn phần đó vào ví, phần còn lại được ghi nhận là khoản đang được đối soát giữa các bên, buổi hiện «đã hoàn một phần, còn … đang chờ xử lý»; (c) chưa hoàn được — toàn bộ khoản đang được đối soát, buổi hiện «chưa hoàn, đang chờ xử lý». Phần đang đối soát chỉ được coi là đã hoàn khi đã được xử lý xong, và không tự động trở thành khoản nợ của bạn.",
      "Buổi học trực tuyến mà bạn vào phòng học muộn hơn 15 phút so với giờ bắt đầu đã hẹn, trong khi khách cũng có mặt: buổi vẫn được tính là buổi đã diễn ra, nhưng khách được bồi thường một nửa giá trị của buổi đó (một nửa của giá hợp đồng chia cho tổng số buổi). Khoản bồi thường này được trừ vào chính tiền của buổi đó: bạn, phòng gym (nếu có) và nền tảng mỗi bên chịu phần của mình theo đúng tỷ lệ chia của hợp đồng. Sau khi buổi được xác nhận, bạn nhận phần còn lại của buổi đó sau khi đã trừ phần bồi thường của bạn; các buổi khác không bị ảnh hưởng. Nếu khoản bồi thường chưa thực hiện được ngay, nó được ghi nhận là khoản đang được đối soát với khách và không tự động trở thành khoản nợ của bạn.",
      "Nếu bạn vắng mặt 3 buổi trên cùng một hợp đồng, khách có quyền chấm dứt hợp đồng và được hoàn đầy đủ phần chưa dùng.",
      "Nếu bạn chấm dứt hợp đồng giữa chừng, khách được hoàn đầy đủ 100% phần chưa dùng. Hai trường hợp này (bạn hủy giữa chừng, hoặc vắng mặt 3 buổi) không tự động khiến bạn bị bồi thường thêm từ khoản tạm giữ ở mục 2: khoản đó chỉ được dùng sau khi quản trị viên xem xét và xác minh là thuộc trách nhiệm của bạn, và chỉ trên chính hợp đồng đó.",
    ],
    source:
      "session-outcome.ts rows 3-5; PT_REPEATED_NO_SHOW_THRESHOLD=3 (contract.service.ts); D19; payment-service compensateNoShow. DQ-2(a): refund of price/totalSessions to the wallet, session closed as not-delivered (NO_SHOW), counted in compensatedSessions (NOT usedSessions: it is not a delivered session), no replacement session, PT not paid. DQ-1: funded from the contract's own funds only; the refund state (FULL/PARTIAL/PENDING, session-refund-state.ts) comes from the ledger's paid/owed/unpaid and the live obligation; an unfunded remainder is a reconciling obligation, not PT debt. D77: room-close-resolution ptLate = PT joined > NO_SHOW_GRACE_MINUTES (15) after the start with the client present; payment-service computeLateArrivalCompensation = half of roundForClient(price/totalSessions), charged to PT/gym/platform by the contract's rates and deducted from THAT session's release (releaseSession dueOf); the rest is released on confirmation; an unperformed compensation is a record-only OPEN obligation (recordLateArrivalObligation)",
  },
  {
    id: "neutral-exit",
    title: "6. Khi khách rút lui vì bạn bị hạn chế",
    body: [
      "Nếu tài khoản hoặc một hợp đồng của bạn đang bị hạn chế, khách có quyền rút khỏi hợp đồng đó và được hoàn đầy đủ phần chưa dùng, không mất phí. Việc này không tự có nghĩa là bạn có lỗi và không dùng khoản tạm giữ ở mục 2 để bồi thường.",
      "Buổi bạn đã báo hoàn thành mà khách chưa xác nhận vẫn đi tiếp quy trình xác nhận ở mục 3 và không bị hoàn tự động; buổi đang khiếu nại được giữ chờ quyết định.",
    ],
    source: "client-exit.service CLIENT_EXIT_DUE_TO_PT_RESTRICTION (D32, D36)",
  },
  {
    id: "restriction",
    title: "7. Hạn chế, tạm đình chỉ và khóa tài khoản",
    body: [
      "Quản trị viên có thể hạn chế quyền hoạt động của bạn khi có khiếu nại hoặc nghi ngờ vi phạm. Có ba mức: hạn chế riêng một hợp đồng, hạn chế toàn tài khoản, hoặc khóa vĩnh viễn.",
      "Khi bị hạn chế, bạn không thể nhận hợp đồng mới hay thực hiện các thao tác mới trên phần bị hạn chế (đọc thông tin thì vẫn được). Việc hạn chế không tự hủy hợp đồng và không tự kết luận bạn có lỗi.",
      "Khi tài khoản bị khóa vĩnh viễn, các hợp đồng đang dở được kết thúc theo quyết định của nền tảng, khách được hoàn phần chưa sử dụng và khoản tạm giữ của từng hợp đồng (nếu có) được trả lại cho bạn theo mục 2. Việc khóa tài khoản không tự động bị coi là lỗi của bạn đối với từng khách.",
    ],
    source:
      "pt-restriction.service (assertPtMayAct, scopes CONTRACT_SCOPE / PT_ACCOUNT_SCOPE / PERMANENT_BAN) (D31, D38); TerminationReason.SERVICE_DISCONTINUED_BY_PLATFORM (D49; PT_BANNED is retired for new endings and is not PT fault)",
  },
  {
    id: "withdrawal",
    title: "8. Rút tiền",
    body: [
      "Tiền đã về ví khả dụng của bạn có thể gửi yêu cầu rút về tài khoản nhận tiền của bạn. Mỗi lần rút tối thiểu 10.000đ.",
      "Yêu cầu rút được quản trị viên duyệt và chuyển khoản; tiền của những buổi chưa được xác nhận thì chưa rút được.",
    ],
    source: "payment-service withdrawal.service MIN_WITHDRAWAL_AMOUNT=10000 (D26), approve/markPaid",
  },
  {
    id: "changes",
    title: "9. Khi điều khoản thay đổi",
    body: [
      "Khi Gymini thay đổi điều khoản này, bạn sẽ được yêu cầu xác nhận lại trước khi chấp nhận hợp đồng mới. Thay đổi chỉ áp dụng cho hợp đồng bạn chấp nhận sau khi đã đồng ý; hợp đồng đã ký hoặc đang chạy giữ nguyên.",
    ],
    source: "D25 (this feature): acceptContract gate PT_TERMS_NOT_ACCEPTED",
  },
  {
    id: "privacy-notice",
    title: "10. Thông báo về dữ liệu cá nhân khi bạn đồng ý điều khoản",
    body: [
      "Khi bạn bấm đồng ý điều khoản này, Gymini ghi lại địa chỉ IP và loại trình duyệt (hoặc ứng dụng) bạn đang dùng, cùng thời điểm và phiên bản điều khoản bạn đã đồng ý.",
      "Mục đích: chứng minh bạn đã đồng ý điều khoản và phòng chống gian lận. Gymini không dùng hai thông tin này cho mục đích khác.",
      "Ai xem được: chỉ quản trị viên Gymini. Địa chỉ IP và loại trình duyệt của bạn không hiển thị cho khách hàng hay cho PT khác.",
      "Thời gian lưu: 12 tháng kể từ khi bạn đồng ý. Sau đó Gymini xóa địa chỉ IP và loại trình duyệt khỏi bản ghi; bản ghi cho biết bạn đã đồng ý phiên bản nào, vào lúc nào vẫn được giữ lại. Ngoại lệ: nếu đang có tranh chấp hoặc yêu cầu pháp lý cần dùng đến hai thông tin này, Gymini giữ lại cho đến khi vụ việc được giải quyết rồi mới xóa.",
      "Quyền của bạn: bạn có thể hỏi Gymini những thông tin nào đang được lưu về bạn và yêu cầu xem, chỉnh sửa hoặc xóa khi không còn cần cho các mục đích trên, trừ khi thông tin đang phải giữ vì tranh chấp. Hãy liên hệ bộ phận hỗ trợ của Gymini để gửi yêu cầu.",
    ],
    source:
      "pt-terms.service accept (ip_address / user_agent on PtTermsAcceptance, from clientIpMiddleware + User-Agent); ip-ua-retention.service (IP_UA_RETENTION_MONTHS = 12, rows under legal_hold_until are skipped); admin-only access, never in a PT/client DTO or a log line. Owner decision: 12 months, subject to privacy/legal review (this draft text is not a compliance claim)",
  },
];

/** The text exactly as clients receive it (without the server-side `source` notes). */
export function publicPtTerms() {
  return {
    version: PT_TERMS_VERSION,
    isDraft: PT_TERMS_IS_DRAFT,
    title: PT_TERMS_TITLE,
    intro: PT_TERMS_INTRO,
    sections: PT_TERMS_SECTIONS.map(({ id, title, body }) => ({ id, title, body: [...body] })),
  };
}
