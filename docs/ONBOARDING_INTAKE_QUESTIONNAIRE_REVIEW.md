# Rà soát câu hỏi "dạo đầu" — Onboarding Wizard & Intake Form

> Design record — đối chiếu hiện trạng code thật với nghiệp vụ app khác, khoa học, và ý kiến chuyên gia. **Chưa implement trong tài liệu này** — đây là bản rà soát + đề xuất chờ duyệt, cùng tinh thần với `USER_LEVEL_PERSONALIZATION_PLAN.md`.
>
> Phạm vi: **loại trừ mọi thứ liên quan tiền/tài chính** theo yêu cầu. Tập trung vào — có hỏi trùng không, nên hỏi gì, và hỏi khác nhau thế nào theo cấp độ (mới/đã tập lâu/vận động viên).

---

## 0. Tóm tắt kết quả (đọc trước nếu vội)

1. **Có trùng lặp thật** — Intake Form (khi mua Personalized PT Service) hỏi lại gần như y hệt Onboarding Wizard, **không hề pre-fill** từ profile đã có sẵn. Người dùng đã trả lời trình độ/mục tiêu/chấn thương/chỉ số cơ thể lúc đăng ký, rồi phải gõ lại toàn bộ khi mua dịch vụ PT.
2. **Thiếu 1 lớp sàng lọc an toàn chuẩn quốc tế** — không có câu hỏi kiểu PAR-Q (đau ngực, chóng mặt, bác sĩ dặn không nên tập...) ở bước đăng ký. Hệ thống hiện chỉ bắt lỗi này **phản ứng** (qua AI chat triage khi user tự nhắc tới), không **chủ động** hỏi trước khi đưa ra bất kỳ đề xuất tập luyện nào.
3. **Số câu hỏi + cấu trúc bước hiện tại hợp lý** (6 bước, nhóm rõ ràng) nhưng **không phân nhánh theo trình độ** — người mới bị hỏi "Kiểu chia lịch ưa thích" (Push/Pull/Legs, Bro Split...) dù nhiều khả năng chưa biết các thuật ngữ này nghĩa là gì; vận động viên thi đấu lại **thiếu** câu hỏi quan trọng nhất với nhóm này (1RM/PR gần nhất, ngày thi đấu).
4. Cách phân loại BEGINNER/INTERMEDIATE/ADVANCED hiện tại (mô tả "dưới 6 tháng" / "6 tháng-2 năm" / "2+ năm") **khớp gần như chính xác** với chuẩn ACSM và cách các coach có tiếng tự đánh giá training age — không cần sửa phần này.

---

## 1. Hiện trạng — 3 nơi hỏi thông tin, đối chiếu trực tiếp qua code

| Trường | **Onboarding Wizard** (`OnboardingWizardPage.tsx`, bắt buộc lần đầu) | **Intake Form** (`PersonalizedServiceOrderPage.tsx`, chỉ khi mua PT service) | **ProfilePage** (sửa sau) |
|---|---|---|---|
| Tuổi | ✅ | ✅ **hỏi lại, ô trống** | ✅ (edit) |
| Giới tính | ✅ | ✅ **hỏi lại, ô trống** | ✅ (edit) |
| Chiều cao | ✅ | ✅ **hỏi lại, ô trống** | ✅ (edit) |
| Cân nặng hiện tại/mục tiêu | ✅ | ✅ **hỏi lại, ô trống** | ✅ (edit) |
| Mục tiêu (goal) | ✅ | ✅ **hỏi lại, mặc định MUSCLE_GAIN — sai lệch nếu user có goal khác đã lưu** | ✅ (edit) |
| Trình độ (experienceLevel) | ✅ | ✅ **hỏi lại, mặc định INTERMEDIATE — có thể sai với BEGINNER/ADVANCED đã lưu** | ✅ (edit) |
| Chấn thương | ✅ (textarea tự do) | ✅ **hỏi lại, ô trống, không thấy danh sách đã khai** | ✅ (edit) |
| Ngày tập/tuần | ✅ (chọn ngày cụ thể) | ✅ (chỉ số lượng, không phải ngày cụ thể — thực ra là câu hỏi khác, không trùng 100%) | ✅ |
| Nơi tập / thiết bị | ✅ (equipment picker chi tiết) | ✅ (chỉ 1 dropdown Gym/Nhà/Cả hai — thô hơn nhiều) | ✅ |
| Thi đấu chuyên nghiệp | ✅ (`competesInSport`) | ❌ không hỏi | ✅ |
| **Đồng ý chia sẻ dữ liệu với PT** | — | ✅ (đúng, hợp lý — bối cảnh mới, phải hỏi lại) | — |

**Kết luận mục 1**: 8/10 trường trong Intake Form là **bản sao gần như nguyên xi** của Onboarding, nhưng nộp qua một object `intakeData` hoàn toàn tách biệt (không đọc `GET /profile/me` để pre-fill). Đây là double data-entry thật — không phải cảm giác chủ quan.

**Ảnh hưởng thực tế** (theo đúng nguyên tắc UX ở mục 3): một buyer đã hoàn tất Onboarding (6 bước) rồi mua Personalized Service phải làm thêm ~10 trường nữa — đúng loại "homework" mà nghiên cứu drop-off cảnh báo, xảy ra ở đúng thời điểm nhạy cảm nhất (ngay sau khi trả tiền, kỳ vọng cao nhất, kiên nhẫn thấp nhất).

---

## 2. Cơ sở khoa học — sàng lọc an toàn trước khi tập

**🟢 PAR-Q (Physical Activity Readiness Questionnaire)** — công cụ sàng lọc tiêu chuẩn, dùng phổ biến nhất thế giới cho fitness/gym, gốc từ Canadian Society for Exercise Physiology, được NASM/ACSM dẫn chiếu như bước bắt buộc đầu tiên trong quy trình client intake chuẩn ([NASM blog](https://blog.nasm.org/everything-you-need-to-know-about-the-par-q); NASM OPT Model Phase 1 xác nhận "PAR-Q intake" là 1 trong các hạng mục đánh giá bắt buộc cùng overhead squat assessment — [NASM blog: Off to a Great Start](https://blog.nasm.org/off-to-a-great-start-phase-1-and-the-new-novice-client)).

7 câu hỏi Yes/No gốc:
1. Bác sĩ từng nói bạn có vấn đề tim mạch và chỉ nên tập theo chỉ định bác sĩ?
2. Bạn có thấy đau ngực khi vận động thể chất không?
3. Trong tháng qua, bạn có đau ngực khi KHÔNG vận động không?
4. Bạn có mất thăng bằng do chóng mặt, hoặc từng ngất xỉu không?
5. Bạn có vấn đề xương/khớp có thể nặng hơn nếu thay đổi cường độ vận động?
6. Bác sĩ có đang kê thuốc huyết áp/tim mạch cho bạn không?
7. Bạn có biết lý do nào khác khiến không nên vận động thể chất không?

Bản mở rộng 2024 — **PAR-Q+** — giữ nguyên tinh thần nhưng thêm nhánh follow-up chi tiết hơn cho từng bệnh lý mãn tính, dùng cho mọi độ tuổi (bản gốc giới hạn 15-69 tuổi) ([2024 PAR-Q+](https://eparmedx.com/wp-content/uploads/2023/12/PARQPlus2024Fillable.pdf)).

**Đối chiếu với app**: hiện `injuriesText` (Onboarding) chỉ là textarea tự do, không có cấu trúc yes/no nào cho 7 mục trên. AI chat (`safety_guard.ts`, nutrition/medical triage) **đã có** cơ chế chặn phản hồi khi user *tự nhắc tới* bệnh tim/thai kỳ/rối loạn ăn uống trong hội thoại — nhưng đây là an toàn **phản ứng**, không phải **chủ động**: nếu user không bao giờ gõ câu chứa "tim mạch" vào chat, hệ thống không biết, và AI vẫn có thể đề xuất lịch tập cường độ cao cho người có bệnh tim chưa từng khai báo.

**Nhận định cho sản phẩm**: đây là khoảng trống an toàn thật, chi phí thấp để đóng (7 câu yes/no, ~30 giây), lợi ích cao (chặn đúng nhóm rủi ro trước khi họ nhận bất kỳ đề xuất nào, không phải chờ họ tự nhắc trong chat).

---

## 3. Nghiệp vụ app khác — 2 triết lý đối lập, cả hai đều có bằng chứng

| App | Triết lý onboarding | Câu hỏi ngay từ đầu |
|---|---|---|
| **Fitbod** | Tối thiểu ma sát — chỉ hỏi trình độ tập trước khi cho xem gợi ý buổi tập đầu tiên; thiết bị/mục tiêu chi tiết đẩy sang phiên sau, khi user đã cam kết dùng thử ([so sánh Fitbod/Hevy/Strong](https://www.sensai.fit/blog/hevy-vs-strong-vs-fitbod)) | Trình độ tập → (xong, vào app ngay) |
| **Hevy Trainer** | Cá nhân hoá ngay từ đầu — chấp nhận hỏi nhiều hơn để có gợi ý sát hơn ngay lập tức | Trình độ, mục tiêu, thiết bị, tần suất, thời lượng buổi tập, nhóm cơ ưu tiên |
| **Trainerize** (phần mềm cho PT — **gần với "Personalized PT Service" của app này nhất**) | Rõ ràng khuyến nghị **phased onboarding**: "*gone are the days of 20+ intake questions on day one... start with essentials, then gather deeper insights later as trust grows*" ([Trainerize — Ultimate Guide to Onboarding New Fitness Clients](https://www.trainerize.com/blog/the-ultimate-guide-to-onboarding-new-fitness-clients/)) | Tối thiểu ban đầu + form/intake tự động gửi đúng lúc, không dồn hết vào ngày 1 |

**Nhận định cho sản phẩm**: app này hiện đang **gần với mô hình Hevy** (hỏi nhiều ngay từ đầu ở Onboarding) — hợp lý cho Onboarding một lần. Nhưng **Intake Form của Personalized Service đang đi ngược nguyên tắc phased-onboarding của chính loại sản phẩm gần nhất với nó (PT coaching software)** — hỏi lại từ đầu đúng những gì Onboarding đã hỏi, thay vì kế thừa + chỉ hỏi thêm phần **thực sự mới** cho bối cảnh PT (mức độ giám sát mong muốn, lịch sử tập với PT trước đó, kỳ vọng cụ thể với dịch vụ này).

---

## 4. Cơ sở phân loại trình độ — tự đánh giá có đáng tin không?

**🟢 Kraemer & Ratamess (2004/2009), ACSM Position Stand** (đã có sẵn trong `gym-fitness-research.md` §10) — nền tảng khoa học cho 3 mức BEGINNER/INTERMEDIATE/ADVANCED hiện có trong code.

**Bổ sung từ nghiên cứu ngoài**: nhiều nguồn coaching độc lập (không phải bài báo khoa học, nhưng phản ánh thực hành huấn luyện có ảnh hưởng rộng) đồng thuận rằng **thời gian tập không phải yếu tố quyết định duy nhất** — quan trọng hơn là **tốc độ tiến bộ còn lại** và **sức mạnh tương đối so với cân nặng cơ thể**: "*Beginner lifters can make fast linear progress... Advanced lifters progress very slowly, and almost always non-linearly*" ([Bony to Beastly](https://bonytobeastly.com/beginner-intermediate-advanced-lifter/); [GainFrame — 3-axis self-check](https://gainframe.app/blog/beginner-intermediate-advanced-lifter/)). Mốc thời gian phổ biến: Beginner <6 tháng, Novice 6-12 tháng, Intermediate 1-2 năm, Advanced 2+ năm — **khớp gần như y hệt mô tả hiện có trong `OnboardingWizardPage.tsx`** ("Dưới 6 tháng" / "6 tháng - 2 năm" / "2+ năm").

**Nhận định cho sản phẩm**: **không cần sửa** cách phân loại/mô tả 3 mức hiện tại — đã bám khá sát cả khoa học lẫn thực hành cộng đồng. Điểm có thể bổ sung (không bắt buộc): hỏi thêm 1 câu tự-đánh-giá phụ dạng "bạn có đang tiến bộ đều đặn mỗi tuần (tăng tạ/rep) không?" — vì các nguồn trên đều nhấn mạnh *tốc độ tiến bộ* quan trọng hơn *số tháng*, giúp phân biệt một người tập 3 năm nhưng dậm chân tại chỗ (thực chất cần được đối xử gần INTERMEDIATE hơn) với một người tập 3 năm có kỷ luật thật (ADVANCED đúng nghĩa). Đây là ý tưởng bổ sung nhỏ, không phải lỗi cần sửa gấp.

---

## 5. Nghiên cứu UX — độ dài form ảnh hưởng thế nào

**🟢 Dữ liệu ngành** (tổng hợp nhiều nguồn UX 2026):
- Quá 2-3 câu hỏi, form bắt đầu "cảm giác như bài tập về nhà" — user bắt đầu bỏ giữa chừng ([SEM Nexus](https://semnexus.com/app-onboarding-flow-benchmarks-where-users-drop-off-2026)).
- Mỗi trường thêm vào giảm ~3-5% tỷ lệ hoàn thành; mỗi bước thêm (>5 bước) giảm 10-15%/bước ([saasfactor.co](https://www.saasfactor.co/blogs/why-users-drop-off-during-onboarding-and-how-to-fix-it)).
- Hơn 3-4 lựa chọn cùng lúc → "decision fatigue", tỷ lệ hoàn thành có thể giảm tới 60% ([dotcominfoway](https://www.dotcominfoway.com/blog/why-your-apps-onboarding-flow-is-killing-retention-and-how-to-redesign-it/)).
- Nguyên tắc **progressive profiling**: chỉ hỏi tối thiểu cần thiết NGAY, phần còn lại hỏi đúng lúc/đúng ngữ cảnh sau — **trừ khi** là luồng giao dịch thực sự cần đủ dữ liệu ngay lập tức (ví dụ checkout) ([Descope — Progressive Profiling 101](https://www.descope.com/learn/post/progressive-profiling)).

**Nhận định cho sản phẩm**: Onboarding Wizard hiện tại (6 bước, mỗi bước 1-3 nhóm câu hỏi, có draft-resume localStorage đã implement rất tốt) **nằm trong ngưỡng an toàn** theo dữ liệu trên — không cần rút ngắn. Vấn đề thật nằm ở **Intake Form lặp lại** (mục 1) — đúng loại "thêm field không cần thiết" mà nghiên cứu cảnh báo, xảy ra thêm một lần nữa sau khi user đã "trả giá" bằng 6 bước Onboarding rồi.

---

## 6. Đề xuất — phân nhánh câu hỏi theo cấp độ (không đổi cấu trúc 6 bước hiện có)

Giữ nguyên khung 6 bước (`level → schedule → equipment → safety → body → review`) — chỉ thay đổi **nội dung hiển thị bên trong từng bước theo `experienceLevel` vừa chọn ở bước 1**, vì trình độ luôn được hỏi đầu tiên (đúng thứ tự hợp lý, không cần đổi).

| Bước | Người mới (BEGINNER) | Đã biết tập (INTERMEDIATE) | Lâu năm (ADVANCED) | + Vận động viên (`competesInSport=true`) |
|---|---|---|---|---|
| **Trình độ & Mục tiêu** | Giữ nguyên, thêm mô tả rõ hơn từng mức (đã tốt) | Giữ nguyên | Giữ nguyên | + hỏi môn thi đấu (text tự do) |
| **Lịch tập** | **Ẩn** "Kiểu chia lịch ưa thích" (thuật ngữ Push/Pull/Legs... người mới thường chưa biết, chọn bừa gây nhiễu dữ liệu) — mặc định hệ thống tự chọn Full Body/Upper-Lower theo ACSM | Hiện đầy đủ, có tooltip giải thích từng kiểu | Hiện đầy đủ | + hỏi ngày còn lại tới kỳ thi đấu tiếp theo (phục vụ `peakingDate`, đã được đề xuất trong `USER_LEVEL_PERSONALIZATION_PLAN.md` §D task 3) |
| **Thiết bị** | Giữ nguyên (preset "Tại nhà"/"Gym cơ bản" rất hợp beginner) | Giữ nguyên | Giữ nguyên | Giữ nguyên |
| **Sức khỏe & An toàn** | **Thêm 7 câu PAR-Q yes/no** (mục 2) — áp dụng cho MỌI mức, không riêng nhóm này | + PAR-Q | + PAR-Q, nhấn mạnh hơn (chi phí sai số cao hơn theo `USER_LEVEL_PERSONALIZATION_PLAN.md` mục D) | + PAR-Q + câu hỏi "đang trong giai đoạn cắt cân/giảm cân nhanh cho thi đấu?" (nối với `severe_energy_restriction_warning` đã có ở AI nutrition, tránh tách rời 2 hệ thống) |
| **Chỉ số cơ thể** | Giữ nguyên | Giữ nguyên | + hỏi thêm PR gần nhất 3 bài chính (nếu có) — phục vụ e1RM/load-based programming đã có sẵn engine (`computeE1rmTrend`) nhưng cần điểm khởi đầu | + PR gần nhất (bắt buộc, không phải "nếu có") |

**Lý do không tạo bước thứ 7 riêng cho PAR-Q**: theo đúng dữ liệu mục 5 (mỗi bước thêm giảm 10-15% hoàn thành) — nhét 7 câu yes/no ngắn vào bước "Sức khỏe & Thi đấu" đã có sẵn (cùng chủ đề, không lạc quẻ) rẻ hơn nhiều so với thêm 1 bước mới.

---

## 7. Đề xuất — xoá trùng lặp ở Intake Form

Thay vì object `intakeData` rỗng hoàn toàn:
1. `IntakeForm` gọi `GET /profile/me` trước khi render (đã có sẵn `profileService.getProfile` dùng chung ở Onboarding — tái dùng, không viết API mới).
2. Với mỗi trường đã có trong profile (tuổi/giới tính/chiều cao/cân nặng/mục tiêu/trình độ/chấn thương): hiển thị **read-only kèm nút "Sửa"** dẫn ngược về `/client/profile`, thay vì input trống bắt gõ lại — đúng mẫu `ReviewRow` component đã có sẵn trong `OnboardingWizardPage.tsx` (tái dùng UI pattern, không thiết kế mới).
3. **Chỉ giữ input thật sự mới cho bối cảnh này**: `daysPerWeek` (có thể khác lịch tập chung nếu dịch vụ PT có tần suất riêng), `trainingLocation`, `notes` (kỳ vọng cụ thể với dịch vụ), và khối consent checkboxes (đúng, phải hỏi lại — bối cảnh chia sẻ dữ liệu khác).
4. Nếu profile thiếu trường nào (user bỏ qua Onboarding) → mới hiện input trống tại đúng chỗ đó — giữ tinh thần progressive profiling (mục 5) thay vì hỏi lại toàn bộ vì thiếu 1 trường.

---

## 8. Việc chưa làm — cần bạn duyệt trước khi code

- [ ] Thêm 7 câu PAR-Q (yes/no) vào bước "Sức khỏe & An toàn" của Onboarding — cần quyết định: chặn cứng hay chỉ cảnh báo khi có câu trả lời "Có"? (đề xuất: không chặn đăng ký, nhưng gắn cờ để AI/Decision Engine biết và luôn chèn khuyến nghị "hỏi ý kiến bác sĩ trước" — nhất quán với nguyên tắc "không chặn cứng, chỉ cảnh báo, tôn trọng quyền tự quyết" đã dùng ở mục A trong `USER_LEVEL_PERSONALIZATION_PLAN.md`).
- [ ] Ẩn "Kiểu chia lịch ưa thích" cho BEGINNER — cần xác nhận UI (ẩn hẳn hay hiện nhưng disable + tooltip giải thích?).
- [ ] Pre-fill Intake Form từ Profile (mục 7) — thay đổi code thật, không chỉ tài liệu.
- [ ] Thêm field PR gần nhất / ngày thi đấu cho ADVANCED + `competesInSport` — phụ thuộc quyết định schema đã treo sẵn ở `USER_LEVEL_PERSONALIZATION_PLAN.md` §D (chưa implement).
- [ ] Câu hỏi tự-đánh-giá "tốc độ tiến bộ" bổ sung (mục 4) — ý tưởng phụ, độ ưu tiên thấp hơn các mục trên.

---

## Nguồn tham khảo

- PAR-Q (7 câu gốc): [NASM — Everything You Need to Know About the PAR-Q](https://blog.nasm.org/everything-you-need-to-know-about-the-par-q)
- PAR-Q+ 2024 (mở rộng): [eparmedx.com — 2024 PAR-Q+](https://eparmedx.com/wp-content/uploads/2023/12/PARQPlus2024Fillable.pdf)
- NASM OPT Model, Phase 1 intake: [NASM blog — Off to a Great Start: Phase 1 and the New (Novice) Client](https://blog.nasm.org/off-to-a-great-start-phase-1-and-the-new-novice-client)
- Fitbod/Hevy/Strong onboarding so sánh: [sensai.fit — Hevy vs Strong vs Fitbod (2026)](https://www.sensai.fit/blog/hevy-vs-strong-vs-fitbod)
- Trainerize — phased onboarding cho PT coaching: [Trainerize — The Ultimate Guide to Onboarding New Fitness Clients](https://www.trainerize.com/blog/the-ultimate-guide-to-onboarding-new-fitness-clients/)
- Training age / tự đánh giá trình độ: [Bony to Beastly — Are You a Beginner, Intermediate, or Advanced Lifter?](https://bonytobeastly.com/beginner-intermediate-advanced-lifter/), [GainFrame — Real Self-Assessment](https://gainframe.app/blog/beginner-intermediate-advanced-lifter/)
- Drop-off do độ dài form: [SEM Nexus — App Onboarding Flow Benchmarks 2026](https://semnexus.com/app-onboarding-flow-benchmarks-where-users-drop-off-2026), [saasfactor.co — Why Users Drop Off During Onboarding](https://www.saasfactor.co/blogs/why-users-drop-off-during-onboarding-and-how-to-fix-it), [dotcominfoway — App Onboarding Flow: Fix Retention Issues](https://www.dotcominfoway.com/blog/why-your-apps-onboarding-flow-is-killing-retention-and-how-to-redesign-it/)
- Progressive profiling: [Descope — Progressive Profiling 101](https://www.descope.com/learn/post/progressive-profiling)
- Nội bộ (đã có sẵn, không lặp lại nội dung): `docs/gym-fitness-research.md` §10 (ACSM Kraemer & Ratamess), `docs/USER_LEVEL_PERSONALIZATION_PLAN.md`, `docs/FITNESS_APP_DATA_AND_FEATURE_AUDIT.md` §4/§7/§10.

## Giới hạn của báo cáo này (thành thật)

- Không có quyền truy cập trực tiếp vào intake form thật của Renaissance Periodization/Stronger By Science (dịch vụ coaching trả phí, không công khai form) — phần "ý kiến chuyên gia" ở mục 3-4 dựa trên bài viết công khai của họ về nguyên tắc training age (đã có sẵn trong `gym-fitness-research.md`) và các template intake form phổ biến trong ngành PT (Jotform/Exercise.com/Carepatron), không phải form độc quyền của một coach cụ thể.
- Không fetch được toàn văn PDF PAR-Q+ gốc (định dạng scan/binary) — 7 câu PAR-Q cổ điển trích dẫn ở mục 2 là bản đã được NASM và hàng loạt tổ chức y tế/đại học tái xuất bản nguyên văn trong nhiều thập kỷ, mức tin cậy cao dù không fetch trực tiếp bản PDF gốc.
- Không khảo sát app gym Việt Nam cụ thể nào (chỉ có 3 app quốc tế Fitbod/Hevy/Strong + 1 phần mềm B2B Trainerize) — nếu cần đối chiếu thêm thị trường Việt Nam, cần một lượt nghiên cứu riêng.
