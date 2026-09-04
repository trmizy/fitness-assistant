# Nghiên cứu khoa học tập luyện & dinh dưỡng — nền tảng cho các tính năng gym/fitness

> **Mục đích tài liệu**: Tập hợp các bằng chứng khoa học (nghiên cứu peer-reviewed, meta-analysis, vị trí chính thức của các hiệp hội thể thao) và nội dung từ các coach/HLV/vận động viên chuyên nghiệp được công nhận rộng rãi, làm nền tảng tham chiếu cho toàn bộ tính năng liên quan đến gym/fitness của project này: Training Cycle (chu kỳ tập luyện), đánh giá thể trạng qua InBody/BIA, gợi ý dinh dưỡng/TDEE/macro của AI, và phân loại trình độ người tập.
>
> **Nguyên tắc trình bày** (kế thừa từ các phase trước của dự án): mỗi phần đều **tách rõ 3 loại nội dung**:
> - 🟢 **Bằng chứng khoa học** — nghiên cứu peer-reviewed, meta-analysis, vị trí chính thức (ACSM...). Có DOI/link cụ thể.
> - 🟡 **Tổng hợp từ coach/chuyên gia uy tín** — nội dung do các HLV có nền tảng khoa học (thường có bằng Tiến sĩ hoặc là nhà nghiên cứu) tổng hợp/diễn giải từ bằng chứng, đăng trên kênh/blog cá nhân. Đáng tin nhưng **không phải bằng chứng gốc**.
> - 🔴 **Kinh nghiệm cá nhân / giai thoại** — chia sẻ của vận động viên chuyên nghiệp về thực hành cá nhân của họ. Có giá trị tham khảo thực tế nhưng **không khái quát hoá được cho số đông**, không dùng làm ngưỡng y khoa.
>
> **Không bịa nguồn, DOI, số liệu**. Toàn bộ link trong tài liệu này lấy từ kết quả tìm kiếm web thực tế, không tự suy diễn.
>
> **Đã không xác định được một coach cụ thể tên "Mr O"** (được người dùng yêu cầu ban đầu) — người dùng xác nhận không nhớ rõ tên, nên tài liệu này thay vào đó tổng hợp từ các coach/HLV/nhà nghiên cứu được cộng đồng thể hình quốc tế lẫn Việt Nam công nhận rộng rãi.

---

## Mục lục

1. [Periodization & độ dài mesocycle](#1-periodization--độ-dài-mesocycle)
2. [Progressive overload, plateau, deload, fatigue, overreaching](#2-progressive-overload-plateau-deload-fatigue-overreaching)
3. [Autoregulation bằng RPE/RIR](#3-autoregulation-bằng-rperir)
4. [Volume & tần suất tập cho phì đại cơ (hypertrophy)](#4-volume--tần-suất-tập-cho-phì-đại-cơ-hypertrophy)
5. [Độ tin cậy & sai số của BIA/InBody](#5-độ-tin-cậy--sai-số-của-biainbody)
6. [Điều kiện tối thiểu để suy luận xu hướng từ nhiều lần đo](#6-điều-kiện-tối-thiểu-để-suy-luận-xu-hướng-từ-nhiều-lần-đo)
7. [e1RM và giới hạn của công thức ước tính](#7-e1rm-và-giới-hạn-của-công-thức-ước-tính)
8. [Training adherence & hình thành thói quen](#8-training-adherence--hình-thành-thói-quen)
9. [TDEE, calorie target, protein/macro](#9-tdee-calorie-target-proteinmacro)
10. [Khác biệt BEGINNER / INTERMEDIATE / ADVANCED](#10-khác-biệt-beginner--intermediate--advanced)
11. [Foster (1998) — training monotony/strain](#11-foster-1998--training-monotonystrain)
12. [Nguyên tắc AI decision-support khi dữ liệu chưa đầy đủ](#12-nguyên-tắc-ai-decision-support-khi-dữ-liệu-chưa-đầy-đủ)
13. [Vận động viên & HLV thể hình Việt Nam](#13-vận-động-viên--hlv-thể-hình-việt-nam)
14. [Bảng ánh xạ: bằng chứng → yêu cầu sản phẩm đã triển khai](#14-bảng-ánh-xạ-bằng-chứng--yêu-cầu-sản-phẩm-đã-triển-khai)
15. [Bảng nguồn đầy đủ](#15-bảng-nguồn-đầy-đủ)

---

## 1. Periodization & độ dài mesocycle

**🟢 Bằng chứng khoa học / vị trí chính thức**
- Cấu trúc kinh điển: macrocycle (1-4 năm) → mesocycle (vài tuần đến vài tháng) → microcycle (~1 tuần).

**🟡 Coach/chuyên gia**
- **Dr. Mike Israetel (Renaissance Periodization)** — *Scientific Principles of Hypertrophy Training*; video "Mesocycle Design for Hypertrophy" và "Mesocycle Progressions for Hypertrophy" (YouTube): mesocycle hypertrophy điển hình của RP kéo dài **4 tuần + 1 tuần deload** (tuần 5). Sau một mesocycle hypertrophy, RP khuyến nghị chèn một mesocycle sức mạnh ngắn hơn (3-4 tuần, cường độ 70-85%1RM, volume thấp hơn) để "làm mới độ nhạy cảm cơ" trước khi lặp lại chu trình. RP dùng mô hình "volume-first linear progression": tăng dần số set (volume) qua từng tuần trong khi cường độ (%1RM) tăng nhẹ.
- **Juggernaut Training Systems** — *Mesocycle Design for Hypertrophy*, *Designing Training for Hypertrophy*: đồng thuận với cấu trúc 4-6 tuần/mesocycle + deload định kỳ.
- **Jeff Nippard** (kênh YouTube khoa học thể hình lớn, cựu VĐV powerlifting/bodybuilding): các chương trình (Push Pull Legs System, Fundamentals Hypertrophy...) xây dựng quanh nguyên tắc progressive overload có cấu trúc + deload theo chu kỳ, nhấn mạnh mọi khuyến nghị đều dựa trên tài liệu nghiên cứu thể thao/sinh lý học.

**Nhận định cho sản phẩm**: ngưỡng `CYCLE_ASSESSMENT_MIN_CYCLE_DAYS=28` hiện có trong code (`cycle-thresholds.config.ts`) khớp gần đúng với độ dài mesocycle 4 tuần phổ biến trong thực hành RP/JTS — đây là **quy ước sản phẩm hợp lý, có cơ sở thực hành**, không phải một con số y khoa bắt buộc.

---

## 2. Progressive overload, plateau, deload, fatigue, overreaching

**🟢 Bằng chứng khoa học**
- **Bell et al. (2025)**, *"A Practical Approach to Deloading: Recommendations and Considerations for Strength and Physique Sports"*, Strength and Conditioning Journal (Sheffield Hallam University repository + ResearchGate). Định nghĩa: deload là giai đoạn giảm có chủ đích tải trọng tập luyện để giảm mệt mỏi sinh lý/tâm lý và thúc đẩy hồi phục. Khuyến nghị: điều chỉnh qua giảm cường độ nỗ lực, volume, thời lượng, hoặc tần suất; deload **có kế hoạch trước** thường đặt mỗi **4-8 tuần** tuỳ cấu trúc chu kỳ, hoặc **phản ứng (reactive/autoregulated)** khi có dấu hiệu mệt mỏi/giảm hiệu suất bất thường. Bài báo phân biệt rõ deload với tapering (giảm tải trước thi đấu) và training cessation (ngừng hẳn).
- **MASS Research Review** (Dr. Eric Helms, Dr. Eric Trexler, Dr. Mike Zourdos, Lauren Colenso-Semple — sigmanutrition.com/mass): review hàng tháng các nghiên cứu về Fitness-Fatigue Model, overreaching/overtraining, deload/taper/intro cycles.

**🟡 Coach/chuyên gia**
- **Eric Helms** — *The Muscle and Strength Training Pyramid v2.0* (Helms, Morgan, Valdez): chương về deload, rest period, drop-set, tempo. Video "The Deload Roundtable" (Eric Helms, Mike Israetel, Menno Henselmans) — ba chuyên gia hàng đầu trong lĩnh vực này cùng thảo luận thực hành deload.
- **Jeff Nippard**: khuyến nghị thay đổi biến số tập luyện (rep, tải, exercise) mỗi tuần để duy trì progressive overload, tích hợp deload định kỳ để tránh overtraining trong cấu trúc chương trình có hệ thống.

**Nhận định cho sản phẩm**: việc *"legacy `/complete` không có gate dữ liệu tối thiểu"* (đã sửa trong phiên trước) giờ dùng chung ngưỡng `minimumCycleDays`/`minimumCompletedSessions` của Decision Engine mới — khớp với khuyến nghị thực hành "4-8 tuần" của Bell et al. (2025) cho một chu kỳ đủ để đánh giá deload/tiến triển có ý nghĩa.

---

## 3. Autoregulation bằng RPE/RIR

**🟢 Bằng chứng khoa học**
- Tổng hợp nghiên cứu (muscleresearch.net, 2025 review): độ chính xác RIR/RPE **thấp hơn rõ rệt ở người mới tập** so với người tập lâu năm — người mới thường đánh giá sai khoảng cách tới thất bại (nghĩ còn RIR 2-3 trong khi thực tế còn nhiều hơn). Độ chính xác của autoregulation **cải thiện đáng kể qua luyện tập có chủ đích** (deliberate practice) và **hiệu chỉnh (calibration)**: khi người tập được cho tập tới thất bại thật định kỳ rồi đối chiếu ước lượng RIR trước đó với kết quả thực, độ chính xác dự đoán tăng lên.
- Khuyến nghị thực hành theo trình độ: **người mới nên mặc định dùng RIR** (ước lượng theo số rep còn lại dễ hơn thang đo RPE trừu tượng); người tập ≥2 năm với "hiệu chỉnh cảm nhận" thì RPE trở nên tự nhiên hơn. Autoregulation đáng tin cậy nhất khi áp dụng cho người có **ít nhất vài tháng kinh nghiệm tập luyện liên tục**.

**Nhận định cho sản phẩm**: đây là **bằng chứng trực tiếp** ủng hộ nguyên tắc đã áp dụng trong ai-service (`cycle-analysis.service.ts`): khi `experienceLevel` là `UNKNOWN`/`BEGINNER`, hệ thống không đề xuất kỹ thuật nâng cao và nên **thận trọng hơn với dữ liệu RPE/RIR tự báo cáo** của nhóm này, vì bản thân số liệu RPE/RIR từ người mới có độ tin cậy thấp hơn — một khía cạnh chưa được code hiện tại xử lý riêng (`averageSessionRpe`/`rpeTrend` hiện dùng chung công thức cho mọi trình độ).

---

## 4. Volume & tần suất tập cho phì đại cơ (hypertrophy)

**🟢 Bằng chứng khoa học**
- **Schoenfeld, Ogborn & Krieger (2017)**, *"Dose-response relationship between weekly resistance training volume and increases in muscle mass: A systematic review and meta-analysis"*, Journal of Sports Sciences, 35(11). [DOI/tandfonline]. 34 nhóm điều trị từ 15 nghiên cứu. Kết quả: mỗi set thêm vào tương ứng với effect size +0.023 (≈+0.37% khối lượng cơ); nhóm volume cao hơn so với thấp hơn chênh lệch effect size 0.241 (≈+3.9%). **<5 set/tuần**: có tác dụng nhưng chưa tối ưu; **5-9 set/tuần**: phạm vi hiệu quả tối thiểu vững chắc; **≥10 set/tuần**: kết quả tốt nhất trong phân tích — đây là nguồn gốc của "chuẩn 10 set/nhóm cơ/tuần" phổ biến trong cộng đồng evidence-based.
- Meta-regression mới hơn (2025, PubMed 41343037) tiếp tục khảo sát mối quan hệ liều-đáp ứng giữa volume/tần suất hàng tuần với phì đại cơ và tăng sức mạnh.

**🟡 Coach/chuyên gia**
- **Jeff Nippard** trích dẫn trực tiếp các nghiên cứu dose-response này trong các video khoa học thể hình để xây dựng chương trình (Push Pull Legs System...).
- **Renaissance Periodization**: tài liệu huấn luyện của RP cũng dựa trên khung dose-response tương tự để thiết kế volume tăng dần qua mesocycle.

**Nhận định cho sản phẩm**: các tính năng liên quan đến volume tuần (`weeklyVolumeByMuscleGroup`, `RAPID_VOLUME_INCREASE` flag >50%) đã có trong `getCycleReport()` — phù hợp với nguyên tắc dose-response nhưng **chưa cảnh báo khi volume dưới ngưỡng tối thiểu hiệu quả (5 set/nhóm cơ/tuần)**, chỉ cảnh báo khi tăng đột ngột. Đây là một khoảng có thể mở rộng trong tương lai, không phải lỗi hiện tại.

---

## 5. Độ tin cậy & sai số của BIA/InBody

**🟢 Bằng chứng khoa học**
- **Frontiers in Nutrition (2024) / PMC11649400**, *"Reliability, biological variability, and accuracy of multi-frequency bioelectrical impedance analysis..."*: InBody 770 có độ tin cậy test-retest cao qua nhiều lần đo trong thời gian ngắn (ICC ≥0.99, biến thiên 1-2% giữa các lần đo trở kháng lặp lại). ICC cho %FM, FM, FFM ≥0.98, sai số chuẩn đo lường (SEM) thấp (%FM <1%, FM 0.54-0.87kg, FFM 0.58-0.84kg) — **khi điều kiện đo được chuẩn hoá**.
- Tuy nhiên: **BIA không đạt mức đồng thuận chấp nhận được với DEXA** khi so % mỡ cơ thể — sai số cá nhân có thể lệch **10-20 điểm phần trăm** so với mô hình 4-compartment (chuẩn vàng).
- **PLOS ONE**, *"Accuracy and reliability of the InBody 270"*: xác nhận độ tương quan gần như hoàn hảo và độ tin cậy liên thiết bị tốt so với DEXA cho các phép đo lặp lại, nhưng độ chính xác tuyệt đối về %BF vẫn có giới hạn.
- Về hydration: một nghiên cứu chuẩn hoá cho người tham gia uống ≥500ml nước tối hôm trước + sáng hôm đo, đo tỷ trọng nước tiểu (urine specific gravity), không uống thêm trong 1 giờ trước đo. Thú vị: **không tìm thấy mối liên hệ trực tiếp giữa tỷ trọng nước tiểu và sai số ước tính %BF của BIA so với DEXA** trong nghiên cứu đó — nhưng về nguyên lý, vì máy suy ra khối lượng mỡ/nạc từ tổng lượng nước cơ thể, các yếu tố như hydrat hoá, glycogen, ăn uống, rượu, tập luyện, chu kỳ kinh nguyệt **đều có thể làm lệch kết quả giữa các lần đo mà không phản ánh thay đổi thể trạng thực sự**.
- Độ chính xác BIA còn phụ thuộc: loại thiết bị, công thức dự đoán nền tảng, tình trạng hydrat hoá, béo phì, bệnh lý, hoạt động thể chất gần đây.

**Nhận định cho sản phẩm**: đây là cơ sở khoa học trực tiếp cho `inbody-quality.evaluator.ts` (đã implement): các ngưỡng `maxPlausibleWeightChangeKgPerDay`, `maxPlausibleBodyFatPctChange`, cờ `deviceConsistencyWarning` khi trộn nguồn đo — **đúng hướng với bằng chứng**, dù các ngưỡng số cụ thể (0.35kg/ngày, 3pp) là quy ước sản phẩm suy luận hợp lý chứ không trích dẫn trực tiếp từ một nghiên cứu cụ thể nào cho ra đúng con số đó.

---

## 6. Điều kiện tối thiểu để suy luận xu hướng từ nhiều lần đo

**🟢 Bằng chứng khoa học**
- **Minimum Detectable Change (MDC)** — khái niệm thống kê chung (không riêng cho fitness): mức thay đổi nhỏ nhất cần vượt qua để tin rằng đó là thay đổi thực, không phải nhiễu đo lường ngẫu nhiên của thiết bị. Công thức chuẩn: `MDC95 = 1.96 × √2 × SEM`.
- Nghiên cứu về chuẩn hoá đo lường thành phần cơ thể (ScienceDirect, *"Methodological standards for body composition assessment"*) nhấn mạnh: để một khác biệt được coi là thay đổi sinh học thật, nó phải **vượt quá biến thiên đo lường**; với các thay đổi nhỏ về khối mỡ/%mỡ, **hướng thay đổi có thể đảo ngược tuỳ phương pháp** nếu điều kiện đo không được chuẩn hoá — InBody là một trong các thiết bị bị ảnh hưởng đáng kể bởi việc chuẩn hoá điều kiện đo hay không.

**Nhận định (suy luận thống kê, không phải trích dẫn trực tiếp từ nghiên cứu chuyên biệt fitness)**: về mặt lý thuyết thống kê, 2 điểm đo có thể đủ để phát hiện "một thay đổi vượt ngưỡng nhiễu của thiết bị" (MDC), nhưng khẳng định một **xu hướng có hướng** (increasing/decreasing) về bản chất đòi hỏi ≥3 điểm dữ liệu để phân biệt với dao động ngẫu nhiên hai điểm. Đây là lý do thiết kế hợp lý — không phải một con số y khoa cứng — đằng sau các hàm `computeBodyCompositionTrends()`/`linearTrend()` hiện tại: dùng **đường xu hướng thật (least-squares) khi có ≥3 điểm**, dùng **delta 2 điểm khi chỉ có 2**, và trả về `null` (không đoán) khi <2 điểm.

---

## 7. e1RM và giới hạn của công thức ước tính

**🟢 Bằng chứng khoa học**
- Công thức kinh điển: **Brzycki**: `1RM = w / (1.0278 − 0.0278 × reps)`; **Epley**: `1RM = w × (1 + reps/30)`.
- Độ chính xác theo khoảng rep (tổng hợp nhiều nghiên cứu xác thực, bao gồm *"Validation of the Brzycki and Epley Equations..."*, OpenSIUC): chính xác nhất ở **2-10 reps** (sai số 2-10%). Reps thấp (2-5): Epley/Wathen sát nhất. Reps trung bình (6-10): Brzycki/Mayhew tốt hơn, sai số <5%. Brzycki suy biến toán học khi rep tiến gần 37 (mẫu số → 0) nên **không dùng được cho rep cao**. Trên 15 reps, mệt mỏi và kỹ thuật suy giảm làm nhiễu ước tính đáng kể ở mọi công thức cổ điển.
- Một nghiên cứu về squat: Epley áp dụng cho tải 3RM không khác biệt có ý nghĩa thống kê so với 1RM thật, nhưng **áp dụng cho tải 5RM thì Epley overestimate đáng kể** — cho thấy độ chính xác của cùng một công thức còn phụ thuộc vào chính rep-range được test, không chỉ công thức.
- **Marzagao (Fitbod, Inc.), arXiv 2603.17495 (03/2026)**, *"A Weight-Dependent 1RM Prediction Equation Optimized on 303,494 Near-Failure Sets Across 388 Exercises"*: công thức mới, dữ liệu lớn từ ứng dụng thực tế (14,966 người dùng, 388 bài tập, 16 nhóm cơ). Công thức: `1RM = w × (1 + (r−1)^0.85 / (−2.55 + 4.58×ln(w)))`. Giảm sai số 17-22% so với 4 công thức cổ điển (Brzycki, Epley, Wathen, Mayhew), cải thiện ở **183/183 bài tập** có đủ dữ liệu. 91% cải thiện đến từ hệ số chuyển đổi phụ thuộc tải trọng (weight-dependent), 9% từ số mũ rep phi tuyến tính.

**Nhận định cho sản phẩm**: `estimated-1rm.util.ts` hiện dùng Epley — **đúng với khuyến nghị cho rep thấp-trung bình (2-10)**, nhưng cần cẩn trọng khi dữ liệu set có rep cao (>15) — công thức mới của Marzagao (2026) là hướng cải tiến tiềm năng trong tương lai nếu muốn tăng độ chính xác trên toàn dải rep, nhưng đây là nghiên cứu rất mới (chưa qua peer-review truyền thống, chỉ là preprint arXiv/SportRxiv) nên **chưa nên coi là chuẩn thay thế ngay lập tức** — chỉ nêu tham khảo.

---

## 8. Training adherence & hình thành thói quen

**🟢 Bằng chứng khoa học**
- **Lally et al. (2010)** (nghiên cứu hình thành thói quen được trích dẫn rộng rãi): tính tự động hoá (automaticity) của một hành vi mất trung vị **66 ngày** để hình thành; **bỏ lỡ một lần** thực hiện có ảnh hưởng không đáng kể tới độ mạnh của thói quen — điểm số phục hồi nhanh.
- **Kaushal & Rhodes (2015)**: tập luyện tối thiểu **4 lần/tuần trong 6 tuần** là ngưỡng tối thiểu để hình thành thói quen tập thể dục.
- **SportRxiv preprint**, *"Predictors of long-term resistance exercise adherence among beginners: Evidence from a large cohort of mobile app users"*: tính nhất quán trong **28 ngày đầu tiên** là yếu tố dự đoán mạnh nhất cho việc duy trì tập luyện lâu dài, có tác dụng bảo vệ giảm dần theo thời gian. Trong nhóm người mới, chỉ **18.1% còn duy trì đều đặn sau 6 tháng**.
- Với khoảng trống tập luyện: sau **4 tuần liên tục không tập**, nguy cơ dẫn đến khoảng trống 3 tháng tăng lên **11.41%** — vì vòng lặp "cue-and-routine" của thói quen không được củng cố trong thời gian dài.
- Về can thiệp: chỉ **45%** các can thiệp làm tăng tần suất đến gym trong 4 tuần đầu, nhưng chỉ **8%** tạo ra thay đổi hành vi bền vững đo được sau khi can thiệp kết thúc. Can thiệp hiệu quả nhất trong một nghiên cứu: thưởng nhỏ (22 cent) khi quay lại gym sau khi bỏ lỡ, cộng thêm (9 cent) cho lần kế tiếp nếu chỉ bỏ lỡ đúng 1 ngày.

**Nhận định cho sản phẩm**: đây là bằng chứng hỗ trợ **trực tiếp** cho toàn bộ phần "data completeness"/"adherence" đã sửa trong phiên trước: (1) không nên trừng phạt việc thiếu dữ liệu 0/0 buổi thành "0%" (một khoảng trống ngắn không phản ánh thất bại thói quen, theo Lally et al.); (2) ngưỡng `minimumCompletedSessions=8` và `minimumCycleDays=28` của Decision Engine **khớp đáng ngạc nhiên tốt** với con số "28 ngày đầu là yếu tố dự đoán mạnh nhất" và "4 lần/tuần × 6 tuần" từ nghiên cứu thật — củng cố thêm rằng các ngưỡng này, dù được ghi chú trong code là "quy ước sản phẩm, không phải chuẩn y khoa", thực ra có sự tương đồng hợp lý với tài liệu khoa học về hình thành thói quen.

---

## 9. TDEE, calorie target, protein/macro

**🟢 Bằng chứng khoa học**
- **Morton et al. (2018)**, *"A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults"*, British Journal of Sports Medicine. 49 thử nghiệm, 1,863 người tham gia. Meta-regression tìm ra **điểm gãy (breakpoint) ở khoảng 1.62 g protein/kg thể trọng/ngày** — dưới ngưỡng này, tăng protein còn tăng lợi ích; trên ngưỡng này, độ dốc hiệu quả gần như phẳng (không có ý nghĩa thống kê). Khoảng tin cậy 95% mở rộng tới **~2.2 g/kg/ngày** — được trích dẫn rộng rãi làm giới hạn trên hợp lý cho vận động viên.
- **Stronger By Science** (Greg Nuckols và cộng sự — trang phân tích nghiên cứu thể hình uy tín) có bài phân tích cập nhật *"Protein Science Updated: Why It's Time to Move Beyond the '1.6-2.2g/kg' Rule"* — cho thấy giới khoa học vẫn tiếp tục tranh luận, không coi 1.6-2.2 là con số đóng băng tuyệt đối.
- Về TDEE: **vấn đề cố hữu của mọi phương trình dự đoán** — các mô hình dự đoán TDEE thường sai lệch tới **hàng trăm calo** và không phản ánh được sự thay đổi động của TDEE theo thời gian trong một giai đoạn dinh dưỡng; khuyến nghị thực hành chung là **coi ước tính ban đầu chỉ là điểm khởi đầu**, sau đó **đối chiếu với biến động cân nặng thực tế** để hiệu chỉnh.

**🟡 Coach/chuyên gia**
- **Alan Aragon** (Alan Aragon's Research Review — AARR, một trong những research review uy tín lâu đời nhất ngành): công thức tính TDEE dựa trên cân nặng mục tiêu (TBW) + giờ tập luyện/tuần; công thức phổ biến: `10 × cân nặng mục tiêu + giờ tập/tuần × cân nặng mục tiêu`.
- **Lyle McDonald**: điểm khởi đầu 14-16 kcal/pound thể trọng (nữ/người trao đổi chất chậm hơn dùng 14, nam/trao đổi chất nhanh hơn dùng 15-16); phân tích sâu về BMR, TEF (hiệu ứng nhiệt của thức ăn), TEA (hiệu ứng nhiệt hoạt động), NEAT (sinh nhiệt hoạt động không phải tập luyện) — NEAT/PAEE là thành phần biến thiên nhiều nhất, khó ước lượng nhất.

**Nhận định cho sản phẩm**: đây là cơ sở khoa học **trực tiếp** cho lỗi §3.5 đã sửa (macro-calo không khớp target) — `meal-plan-validator.ts` hiện đối chiếu năng lượng macro với calorieTarget bằng công thức Atwater chuẩn (4/4/9 kcal/g), phù hợp hoàn toàn với nguyên lý dinh dưỡng cơ bản. Khoảng protein 1.6-2.2g/kg đã được dùng làm ngưỡng tham chiếu trong `getCycleReport()`'s `PROTEIN_BELOW_EVIDENCE_RANGE` flag — **khớp chính xác với khoảng tin cậy của Morton et al. (2018)**, đã trích dẫn đúng trong code comment.

---

## 10. Khác biệt BEGINNER / INTERMEDIATE / ADVANCED

**🟢 Bằng chứng khoa học (nguồn quyền uy nhất cho chủ đề này)**
- **Kraemer & Ratamess (2004, cập nhật 2009)**, *"Progression Models in Resistance Training for Healthy Adults"* — **ACSM Position Stand** (American College of Sports Medicine), PubMed 19204579. Đây là tài liệu vị trí chính thức, không phải một bài báo đơn lẻ.
  - **Người mới (novice)**: tần suất 2-3 ngày/tuần; tải trọng tương ứng 8-12RM (khoảng 50-70%1RM theo bản cập nhật 2009).
  - **Trung cấp & nâng cao**: dải tải rộng hơn 1-12RM theo mô hình có chu kỳ (periodized), dần nhấn mạnh tải nặng (1-6RM), nghỉ 3-5 phút giữa set, tốc độ co cơ vừa phải; tần suất nâng cao **4-5 ngày/tuần**.
  - Cảnh báo rõ ràng về nguyên tắc "không quá nhiều quá sớm" (too much too soon) cho người mới trước khi nền tảng thần kinh-cơ phát triển đủ.

**Nhận định cho sản phẩm**: đây là bằng chứng gốc, quyền uy nhất, cho toàn bộ thiết kế `experienceLevel` (BEGINNER/INTERMEDIATE/ADVANCED/UNKNOWN) đã triển khai xuyên suốt training-cycle service + ai-service + ProfilePage UI trong các phiên trước. Việc **chặn kỹ thuật nâng cao (pump-set/isolation) khi UNKNOWN/BEGINNER** trong `cycle-analysis.service.ts` khớp trực tiếp với tinh thần "too much too soon" của ACSM.

---

## 11. Foster (1998) — training monotony/strain

**🟢 Bằng chứng khoa học**
- **Foster (1998)**, *"Monitoring training in athletes with reference to overtraining syndrome"*, Medicine & Science in Sports & Exercise (Semantic Scholar profile). Công thức: **monotony = tải trung bình hàng ngày ÷ độ lệch chuẩn tải hàng ngày**; **strain = tải × monotony**. Phát hiện chính: một tỷ lệ lớn các trường hợp bệnh/chấn thương nhẹ có thể giải thích được khi vận động viên vượt ngưỡng tải cá nhân, chủ yếu liên quan đến "strain". **Monotony cao (ít biến thiên tải) + tải cao liên tục** làm tăng khả năng hội chứng overtraining; **strain cao** xảy ra khi tải cao đi kèm biến thiên nhỏ.
- Nghiên cứu liên quan (bóng đá chuyên nghiệp, ResearchGate 327005862): xác nhận mối liên hệ giữa workload monotony/strain với tỷ lệ chấn thương không tiếp xúc.

**Nhận định cho sản phẩm**: **đã được implement chính xác** trong `getCycleReport()`'s `weeklyTrainingLoad`/`HIGH_TRAINING_MONOTONY` flag (xác nhận qua đọc code trực tiếp ở phiên trước, không cần sửa) — công thức monotony/strain trong code khớp đúng với định nghĩa gốc của Foster (1998).

---

## 12. Nguyên tắc AI decision-support khi dữ liệu chưa đầy đủ

**🟢 Bằng chứng khoa học (transferable từ lĩnh vực y tế — không phải fitness-specific, nhưng nguyên tắc thiết kế chuyển giao được)**
- Alert fatigue trong Clinical Decision Support System (CDSS): tỷ lệ bác sĩ **override 49-96%** các cảnh báo an toàn thuốc hiện tại từ CDSS cơ bản/nâng cao — cho thấy cảnh báo quá mức làm giảm hiệu quả, không tăng.
- Nguyên nhân gốc rễ của alert fatigue **thường không phải lỗi logic mà là chất lượng dữ liệu kém và thiếu liên thông** — một risk score bị kích hoạt sai khi dữ liệu lab chưa đầy đủ là ví dụ điển hình.
- 5 giải pháp thiết kế được đề xuất (Gong & Kang): (1) tăng độ đặc hiệu của cảnh báo, (2) phân tầng cảnh báo theo mức độ nghiêm trọng, (3) áp dụng nguyên tắc yếu tố con người (định dạng, nội dung, khả năng đọc, màu sắc), (4) tuỳ chỉnh cảnh báo theo đặc điểm người dùng, (5) cảnh báo phù hợp theo ngữ cảnh chuyên môn.
- Thời điểm hiển thị cảnh báo quan trọng — phải đúng lúc người dùng có thể ra quyết định có thông tin.

**Nhận định cho sản phẩm**: nguyên tắc này củng cố trực tiếp cho toàn bộ thiết kế `INSUFFICIENT_DATA` + `reasonCodes` + `safetyFlags` (severity: warning/critical) đã triển khai trong `cycle-decision.engine.ts` — đúng tinh thần "tăng độ đặc hiệu" và "phân tầng theo mức độ nghiêm trọng" thay vì một cảnh báo chung chung.

---

## 13. Vận động viên & HLV thể hình Việt Nam

**🔴 Kinh nghiệm cá nhân / giai thoại — không dùng làm chuẩn khoa học, chỉ để hiểu ngữ cảnh thị trường Việt Nam**

- **Lý Đức** ("lực sĩ vàng", vô địch châu Á thể hình 7 năm liên tiếp 1997-2003, HCV ASIAD 2002, HCV SEA Games 2003): hiện là cố vấn chuyên môn tại một học viện đào tạo PT ở TP.HCM, quản lý phòng gym gia đình. Ở tuổi U60 vẫn tập ~1 giờ/ngày cường độ nhẹ-vừa để duy trì. Thời đỉnh cao: chế độ ăn cực đoan — 2kg gà, 15 lòng trắng trứng, sữa, whey protein mỗi bữa, tổng lượng ăn gấp ~10 lần người bình thường, chia nhiều bữa/ngày.
- **Phạm Văn Mách** ("kiến càng", vô địch thế giới hạng 55kg, vô địch thế giới ở tuổi 49, >24 năm theo nghiệp thể hình): tập 2 giờ/ngày bình thường, tăng lên 3-5 giờ giai đoạn trước thi đấu. Quan điểm cá nhân: "dinh dưỡng chiếm 60% kết quả". Chế độ ăn thi đấu: 7 bữa/ngày (4 chính + 3 phụ, cách nhau 2-3 giờ), nguyên tắc "7 không" (không chua/cay/ngọt/mặn/béo/rượu bia/thuốc lá). Từng là HLV cá nhân cho một số nghệ sĩ Việt.

**Nhận định cho sản phẩm**: các con số về khẩu phần ăn/tần suất bữa của hai VĐV này là **thực hành cá nhân ở mức thi đấu đỉnh cao** (elite, thường dùng hỗ trợ dược lý không công khai trong nhiều trường hợp ở môn thể hình cạnh tranh) — **hoàn toàn không phù hợp để làm chuẩn khuyến nghị cho người dùng phổ thông** của app (người tập giải trí/sức khỏe). Giá trị duy nhất của phần này là ngữ cảnh văn hoá/thị trường Việt Nam (ví dụ: khi AI coach trò chuyện bằng tiếng Việt, có thể tham chiếu các tên tuổi quen thuộc để tăng độ tin cậy/gần gũi, nhưng **không được trích dẫn số liệu khẩu phần ăn cực đoan của họ như một khuyến nghị dinh dưỡng**).

---

## 14. Bảng ánh xạ: bằng chứng → yêu cầu sản phẩm đã triển khai

| Bằng chứng | Yêu cầu sản phẩm | Trạng thái trong code |
|---|---|---|
| RIR/RPE kém tin cậy ở người mới (muscleresearch.net review) | Không tin tưởng tuyệt đối RPE/RIR tự báo cáo khi `experienceLevel` UNKNOWN/BEGINNER | ⚠️ Một phần — đã chặn đề xuất kỹ thuật nâng cao theo experienceLevel, nhưng `averageSessionRpe`/`fatigueScore` chưa gia giảm theo trình độ |
| ACSM Position Stand (Kraemer & Ratamess) | 4 trạng thái BEGINNER/INTERMEDIATE/ADVANCED/UNKNOWN, không đề xuất nâng cao khi UNKNOWN | ✅ Đã triển khai (`experienceLevel` UI + ai-service gating + deterministic clamp) |
| Bell et al. 2025 — deload 4-8 tuần | Ngưỡng `minimumCycleDays=28` cho gate INSUFFICIENT_DATA | ✅ Khớp phạm vi khuyến nghị |
| Morton et al. 2018 — protein 1.6-2.2g/kg | `PROTEIN_BELOW_EVIDENCE_RANGE` flag trong `getCycleReport()` | ✅ Đã triển khai, trích dẫn đúng trong code comment |
| Atwater 4/4/9 kcal/g | `meal-plan-validator.ts` đối chiếu macro↔calorieTarget | ✅ Đã triển khai (phiên trước) |
| Foster 1998 monotony/strain | `HIGH_TRAINING_MONOTONY` flag | ✅ Đã triển khai đúng công thức gốc |
| MDC / cần ≥3 điểm cho xu hướng có hướng | `computeBodyCompositionTrends()` dùng least-squares khi ≥3 điểm, delta khi 2, null khi <2 | ✅ Đã triển khai |
| BIA nhạy với điều kiện đo không chuẩn hoá | `inbody-quality.evaluator.ts` — outlier/interval/device-consistency flags | ✅ Đã triển khai |
| Lally et al. 2010 — bỏ lỡ ngắn hạn không phải bằng chứng thất bại | `AdherenceMetric.percent = null` khi 0/0, không phải 0% | ✅ Đã triển khai (phiên trước) |
| CDSS alert fatigue — phân tầng theo mức độ nghiêm trọng | `SafetyFlag.severity: "warning"\|"critical"` | ✅ Đã triển khai |
| e1RM chính xác nhất ở 2-10 reps | `estimated-1rm.util.ts` dùng Epley | ✅ Đúng công thức, nhưng chưa cảnh báo khi rep>15 |
| Volume tối thiểu hiệu quả 5 set/nhóm cơ/tuần (Schoenfeld 2017) | Cảnh báo khi volume dưới ngưỡng tối thiểu | ❌ Chưa triển khai — hiện chỉ cảnh báo tăng đột ngột (`RAPID_VOLUME_INCREASE`), chưa cảnh báo volume quá thấp |

---

## 15. Bảng nguồn đầy đủ

| Chủ đề | Nguồn | Link |
|---|---|---|
| Mesocycle hypertrophy 4 tuần + deload | Dr. Mike Israetel / JTS Strength | [jtsstrength.com/mesocycle-design-for-hypertrophy](https://www.jtsstrength.com/mesocycle-design-for-hypertrophy/), [YouTube — Mesocycle Design](https://www.youtube.com/watch?v=3FmyIztDG7M), [YouTube — Mesocycle Progressions](https://www.youtube.com/watch?v=9L9pc-Pb9Bo) |
| Progressive overload / deload evidence-based | Jeff Nippard | [jeffnippard.com](https://jeffnippard.com/), [BarBend — 5 Science-Backed Tips](https://barbend.com/news/jeff-nippard-5-science-backed-tips-for-hypertrophy/) |
| Deload thực hành 2025 | Bell et al., Strength & Conditioning Journal | [Sheffield Hallam repository](https://shura.shu.ac.uk/35313/), [ResearchGate](https://www.researchgate.net/publication/391802156_A_Practical_Approach_to_Deloading_Recommendations_and_Considerations_for_Strength_and_Physique_Sports) |
| MASS Research Review | Helms, Trexler, Zourdos, Colenso-Semple | [sigmanutrition.com/mass](https://sigmanutrition.com/mass/) |
| Deload roundtable | Helms, Israetel, Henselmans | [YouTube](https://www.youtube.com/watch?v=V5iwggPO-S0) |
| RPE/RIR reliability theo trình độ | Muscle Research | [muscleresearch.net](https://www.muscleresearch.net/rpe-and-rir-research-on-autoregulation-in-resistance-training/) |
| Dose-response volume hypertrophy | Schoenfeld, Ogborn & Krieger 2017, J Sports Sci | [tandfonline.com](https://www.tandfonline.com/doi/abs/10.1080/02640414.2016.1210197), [ResearchGate](https://www.researchgate.net/publication/309642510_The_dose-response_relationship_between_resistance_training_volume_and_muscle_hypertrophy_are_there_really_still_any_doubts) |
| Meta-regression volume/frequency 2025 | PubMed 41343037 | [pubmed.ncbi.nlm.nih.gov/41343037](https://pubmed.ncbi.nlm.nih.gov/41343037/) |
| BIA reliability đa tần số | Frontiers in Nutrition 2024 / PMC11649400 | [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC11649400/) |
| InBody 270 accuracy | PLOS ONE | [journals.plos.org](https://journals.plos.org/plosone/article/file?type=printable&id=10.1371/journal.pone.0247362) |
| Chuẩn hoá đo thành phần cơ thể | ScienceDirect | [sciencedirect.com/science/article/pii/S0002916526000924](https://www.sciencedirect.com/science/article/pii/S0002916526000924) |
| e1RM Brzycki/Epley validation | OpenSIUC | [opensiuc.lib.siu.edu](https://opensiuc.lib.siu.edu/cgi/viewcontent.cgi?article=1744&context=gs_rp) |
| e1RM weight-dependent equation mới (2026, preprint) | Marzagao (Fitbod), arXiv 2603.17495 | [arxiv.org/pdf/2603.17495](https://arxiv.org/pdf/2603.17495), [SportRxiv](https://sportrxiv.org/index.php/server/preprint/view/768) |
| Habit formation | Lally et al. 2010; Kaushal & Rhodes 2015 (qua ACE Fitness CE) | [acefitness.org](https://www.acefitness.org/continuing-education/certified/march-2025/8825/the-science-of-habit-formation-a-guide-for-health-and-exercise-professionals/) |
| Adherence predictors — mobile app cohort | SportRxiv preprint | [sportrxiv.org/index.php/server/preprint/view/709](https://sportrxiv.org/index.php/server/preprint/view/709) |
| Protein 1.6-2.2g/kg | Morton et al. 2018, Br J Sports Med | [ResearchGate](https://www.researchgate.net/publication/318368028_A_systematic_review_meta-analysis_and_meta-regression_of_the_effect_of_protein_supplementation_on_resistance_training-induced_gains_in_muscle_mass_and_strength_in_healthy_adults) |
| Protein — tranh luận cập nhật | Stronger By Science (Greg Nuckols) | [strongerbyscience.com/protein-science](https://www.strongerbyscience.com/protein-science/) |
| TDEE — Alan Aragon / Lyle McDonald | Tổng hợp qua nhiều blog trích dẫn AARR | [github.com/LogSmarter-LLC/TDEE-AARR](https://github.com/LogSmarter-LLC/TDEE-AARR) |
| ACSM Position Stand — Progression Models | Kraemer & Ratamess, Med Sci Sports Exerc | [PubMed 19204579](https://pubmed.ncbi.nlm.nih.gov/19204579/), [PDF](https://tourniquets.org/wp-content/uploads/PDFs/ACSM-Progression-models-in-resistance-training-for-healthy-adults-2009.pdf) |
| Foster 1998 monotony/strain | Foster, Med Sci Sports Exerc | [Semantic Scholar](https://www.semanticscholar.org/paper/Monitoring-training-in-athletes-with-reference-to-Foster/59629df5a87418e5653956d54bf8630a102544ae) |
| Monotony/strain & chấn thương bóng đá | ResearchGate 327005862 | [researchgate.net](https://researchgate.net/publication/327005862_Workload_monotony_strain_and_non-contact_injury_incidence_in_professional_football_players) |
| CDSS alert fatigue design | Nhiều nguồn (JMIR Human Factors, Mindbowser, ScienceDirect) | [humanfactors.jmir.org/2025/1/e69333](https://humanfactors.jmir.org/2025/1/e69333), [mindbowser.com](https://www.mindbowser.com/reduce-cdss-alert-fatigue-clinical-decision-support/) |
| Lý Đức | Nhiều báo Việt Nam (Kenh14, VTV, NuEdu...) | [kenh14.vn](https://kenh14.vn/the-hinh-van-nguoi-me-cua-huyen-thoai-chau-a-ly-duc-u60-van-con-vam-vo-co-bap-cuon-cuon-215250328163112154.chn), [nuedu.vn](https://nuedu.vn/giang-vien-huyen-thoai-ly-duc.html) |
| Phạm Văn Mách | Thanh Niên, Dân Việt, GetFit Academy | [thanhnien.vn](https://thanhnien.vn/nong-kien-cang-pham-van-mach-vo-dich-the-hinh-the-gioi-o-tuoi-49-185251114130454661.htm), [getfit-academy.edu.vn](https://getfit-academy.edu.vn/trainer/luc-si-pham-van-mach-khoa-bodybuilding/) |

---

## Giới hạn của tài liệu này (thành thật)

1. **"Coach Mr O"** mà người dùng nhắc đến ban đầu **không được xác định** — người dùng xác nhận không nhớ tên, nên tài liệu này thay bằng các coach/nhà nghiên cứu được công nhận rộng rãi (Israetel, Nippard, Helms, Schoenfeld, Aragon, McDonald) thay vì bịa ra một nguồn không xác thực được.
2. Phần lớn nội dung "coach/chuyên gia" (mục 🟡) là **tổng hợp qua kết quả tìm kiếm web** (WebSearch), không phải đọc trực tiếp toàn văn video/bài viết gốc — với các video YouTube, chỉ có tiêu đề + mô tả ngắn được xác nhận, **chưa xem/nghe nội dung đầy đủ**.
3. Không có thời gian thực tế "2 tiếng đồng hồ" được dùng theo nghĩa đen — đây là một phiên nghiên cứu tập trung, sâu, nhưng giới hạn bởi số lượt tìm kiếm đã thực hiện (~20 lượt), không phải một cuộc rà soát tài liệu học thuật toàn diện kiểu systematic review.
4. Một số nguồn (ví dụ preprint arXiv/SportRxiv về công thức e1RM mới) **chưa qua bình duyệt (peer review)** — đã ghi chú rõ trong bài, không nên coi ngang hàng với các meta-analysis đã xuất bản chính thức.
5. Chưa nghiên cứu sâu: sinh lý học giấc ngủ/hồi phục, ảnh hưởng hormone (testosterone/cortisol) tới thiết kế chu kỳ, dinh dưỡng quanh buổi tập (nutrient timing) — nằm ngoài phạm vi câu hỏi ban đầu của người dùng.

---

*Tài liệu này bổ sung cho `docs/training-cycle-v2.md` và `docs/adaptive-training-cycle-evaluation.md` — không thay thế, chỉ tổng hợp thêm bằng chứng nền tảng đứng sau các quyết định thiết kế đã có trong hai tài liệu đó.*
