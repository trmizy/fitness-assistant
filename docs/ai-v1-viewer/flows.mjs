const ai = "backend/services/ai-service/src/";
const fitness = "backend/services/fitness-service/src/";
const user = "backend/services/user-service/src/";

function step(id, label, kind, description, input, output, source, section) {
  return { id, label, kind, description, input, output, source, section };
}

export const flows = {
  "kien-truc": {
    title: "Kiến trúc thực thi",
    summary: "Các điểm vào, nhánh điều phối và nơi AI đọc hoặc ghi dữ liệu.",
    selected: "ai",
    section: 2,
    rows: [
      ["Điểm vào", [
        step("client", "Web / Expo", "Giao diện", "Web và mobile gửi câu hỏi, yêu cầu tạo kế hoạch hoặc hành động đã xác nhận.", "Nội dung và phiên của người dùng.", "Yêu cầu HTTP hoặc kết nối SSE khi được cấu hình.", "frontend/web/src/app/pages/client/AICoachPage.tsx", 3),
        step("gateway", "Gateway / Lambda", "Giao vận", "Express Gateway định tuyến ở môi trường container. Trên AWS, HTTP Lambda và Streaming Lambda phục vụ các đường tương ứng.", "Yêu cầu của client.", "Chuyển tiếp tới Express app của AI service.", "backend/gateway/src/routes/proxy.routes.ts"),
        step("ai", "AI service", "Điều phối", "Express gắn các route Coach, vision, plan và admin. Middleware nhận định danh đã xác thực trước khi chuyển yêu cầu cho handler.", "Yêu cầu đã qua gateway hoặc Lambda.", "Chuyển tới Coach, tác vụ nền hoặc xử lý chuyên biệt.", ai + "app.ts"),
      ]],
      ["Xử lý yêu cầu", [
        step("coach", "Coach / RAG", "Hội thoại", "Điều phối hội thoại theo luật, workflow, dữ kiện người dùng và truy xuất tri thức.", "Câu hỏi, user và session.", "Câu trả lời và khối có cấu trúc nếu có.", ai + "llm/orchestrator.service.ts", 3),
        step("queue", "Hàng đợi AI", "Tác vụ nền", "Job đi qua BullMQ/Redis hoặc SQS, tùy cấu hình. Worker nhận job và kiểm lease trước khi ghi kết quả.", "Thông tin sinh hoặc điều chỉnh kế hoạch.", "Nháp giáo án/thực đơn và trạng thái job.", ai + "workers/queue-provider.ts", 7),
        step("special", "AI chuyên biệt", "Theo nghiệp vụ", "Xử lý ảnh Coach, diễn giải InBody và các yêu cầu phân tích/nháp từ fitness-service.", "Ảnh hoặc dữ kiện nghiệp vụ có schema.", "Kết quả có cấu trúc hoặc phần diễn giải.", ai + "routes/ai.routes.ts", 9),
      ]],
      ["Dữ liệu và mô hình", [
        step("data", "PostgreSQL / dịch vụ", "Lưu trữ", "PostgreSQL AI lưu phiên, hội thoại, nháp và thao tác. Fitness-service và user-service sở hữu dữ liệu tập, dinh dưỡng và hồ sơ.", "Định danh, dữ liệu phiên hoặc lời gọi nghiệp vụ.", "Bản ghi có quyền sở hữu và phản hồi từ API nghiệp vụ.", ai + "../prisma/schema.prisma", 10),
        step("vector", "Vector store", "Truy xuất", "Adapter chọn Qdrant hoặc OpenSearch để đọc các index tri thức.", "Vector truy vấn đúng chiều theo cấu hình.", "Đoạn tài liệu và metadata nguồn.", ai + "vector-store/provider.ts", 5),
        step("model", "LLM / embedding", "Provider", "Adapter chọn provider để sinh văn bản hoặc tạo embedding. Kết quả đi qua quy tắc và kiểm tra của từng chức năng.", "Prompt hoặc văn bản cần nhúng.", "Văn bản, JSON hoặc vector theo adapter.", ai + "services/llm.service.ts", 5),
      ]],
    ],
    edges: [
      ["client", "gateway"], ["gateway", "ai"], ["ai", "coach"], ["ai", "queue"], ["ai", "special"],
      ["coach", "data"], ["coach", "vector", "conditional"], ["coach", "model", "conditional"],
      ["queue", "data"], ["queue", "model"], ["special", "model"],
    ],
  },
  coach: {
    title: "Một lượt AI Coach",
    summary: "Theo dấu một câu hỏi từ kiểm phiên tới trả lời và lưu hội thoại.",
    selected: "safety",
    section: 3,
    rows: [
      ["Tiếp nhận", [
        step("request", "Câu hỏi", "API", "Hai endpoint JSON và SSE dùng cùng dịch vụ rag. clientRequestId cho phép đọc lại lượt đã lưu.", "question, sessionId và clientRequestId tùy chọn.", "Yêu cầu đã kiểm schema và định danh.", ai + "routes/ai.routes.ts"),
        step("session", "Kiểm phiên", "Hội thoại", "Kiểm quyền sở hữu và archive nếu có sessionId. Tạo phiên mới khi người dùng bắt đầu một cuộc hội thoại.", "User và sessionId, nếu có.", "Phiên có thể dùng để đọc lịch sử và lưu kết quả.", ai + "services/rag.service.ts"),
        step("safety", "An toàn", "Kiểm soát", "Phân loại ngôn ngữ và nguy cơ. Kiểm tuổi hồ sơ khi phù hợp. Các trường hợp an toàn đặc biệt có đường trả lời sớm.", "Câu hỏi và thông tin cần cho kiểm tra.", "Trả mẫu an toàn hoặc tiếp tục điều phối.", ai + "llm/safety_guard.ts", 6),
      ]],
      ["Hiểu và trả lời", [
        step("agent", "Workflow", "Handler", "Fitness Agent xét hành động, nhật ký, đề xuất và workflow đang chờ trong phiên. Khi handler trả null, pipeline tiếp tục đường chat.", "Intent, phiên và trạng thái action/workflow.", "Câu trả lời hoặc thẻ thao tác nếu thấy phù hợp.", ai + "services/fitness-agent.service.ts", 4),
        step("context", "Context / RAG", "Dữ kiện", "Lấy hồ sơ, lịch sử, memory và retrieval theo đường phù hợp. Dữ kiện của lượt được dùng trong phạm vi context.", "Câu hỏi, intent và các reader.", "Dữ kiện và đoạn tri thức để ghép prompt.", ai + "llm/context_plan.ts", 6),
        step("answer", "Luật / LLM", "Sinh phản hồi", "Luật xử lý một số tra cứu và phép tính. Khi intent cần mô hình, prompt builder ghép dữ kiện và gọi provider.", "Dữ kiện lượt, context, evidence và intent.", "Câu trả lời dự kiến hoặc fallback theo nhánh.", ai + "llm/orchestrator.service.ts"),
      ]],
      ["Hoàn tất", [
        step("template", "Trả lời sớm", "Theo điều kiện", "Một số câu đi vào nhánh an toàn, meta, tra cứu hoặc handler nghiệp vụ và trả kết quả riêng.", "Kết quả của guard hoặc handler chuyên biệt.", "Lời đáp định sẵn hoặc khối đã xử lý.", ai + "llm/orchestrator.service.ts"),
        step("validate", "Kiểm đầu ra", "Kiểm soát", "Kiểm claim, mức khớp số liệu và cấu trúc. Nhánh có mismatch quan trọng có thể dùng câu trả lời tất định.", "Câu trả lời dự kiến, intent và dữ kiện.", "Nội dung đã kiểm cùng metadata và cảnh báo.", ai + "llm/answer_validator.ts"),
        step("persist", "Lưu / trả lời", "Kết quả", "Lưu Conversation. SSE chia câu trả lời đã xử lý thành từng đoạn hiển thị rồi gửi done.", "Câu trả lời cuối và metadata.", "JSON hoặc sự kiện SSE, kèm ID hội thoại/phiên.", ai + "controllers/ai.controller.ts"),
      ]],
    ],
    edges: [
      ["request", "session"], ["session", "safety"], ["safety", "agent"], ["safety", "template", "conditional"],
      ["agent", "context", "conditional"], ["agent", "template", "conditional"], ["context", "answer"], ["answer", "validate"],
      ["validate", "persist"], ["template", "persist", "conditional"],
    ],
  },
  "xac-nhan": {
    title: "Workflow và biên xác nhận",
    summary: "Từ thu thập dữ kiện và hiển thị bản nháp đến gọi service sở hữu.",
    selected: "pending",
    section: 4,
    rows: [
      ["Chuẩn bị", [
        step("intent", "Intent & phiên", "Điều phối", "Kiểm phiên và trạng thái xác nhận trước khi tiếp tục workflow hoặc trả lời theo handler.", "Lời nhắn của user đã xác thực.", "Intent phù hợp và trạng thái workflow.", ai + "services/fitness-agent.service.ts"),
        step("slots", "Thu thập dữ kiện", "Workflow", "Đọc slot đã biết, hỏi giá trị thiếu, kiểm dữ kiện và tiếp tục đúng workflow khi có câu trả lời.", "Các slot đã lưu và dữ kiện mới.", "Dữ liệu đủ để tạo đề xuất hoặc câu hỏi tiếp.", ai + "agent-workflow/orchestrator.ts"),
        step("pending", "Nháp PENDING", "Xác nhận", "Các thao tác cần thẻ xác nhận lưu action theo user/phiên và có hạn dùng. UI hiển thị nội dung dự kiến trước khi áp dụng.", "Đề xuất hoặc bản nháp đủ dữ liệu.", "Action ID và thẻ xác nhận.", ai + "services/fitness-agent.service.ts"),
      ]],
      ["Thực thi", [
        step("dismiss", "Bỏ qua", "Theo điều kiện", "Dismiss và confirm cạnh tranh bằng cập nhật có điều kiện. Action đã hủy là trạng thái cuối.", "Action ID và thao tác bỏ qua.", "CANCELLED nếu action còn có thể hủy.", ai + "routes/fitness-agent.routes.ts"),
        step("claim", "Confirm / claim", "Xác nhận", "API kiểm quyền, hạn và trạng thái. Claim nguyên tử chuyển PENDING thành EXECUTING.", "Action ID, phiên, confirmed: true.", "Quyền thực thi của lần confirm thắng claim.", ai + "services/fitness-agent.service.ts"),
        step("domain", "API nghiệp vụ", "Tác dụng", "Action branch gọi fitness-service hoặc user-service. Gói roadmap, tập và dinh dưỡng ghi tiến độ từng phần.", "Payload đã gắn với action.", "Kết quả nghiệp vụ, có thể thành công một phần.", ai + "services/fitness-agent-tools.ts"),
      ]],
      ["Kết quả", [
        null,
        step("retry", "Thử lại", "Theo điều kiện", "Lỗi retryable giải phóng claim về PENDING. Với bundle, tiến độ phần hoàn tất được giữ cho lần sau.", "Lỗi có thể thử lại.", "Action trở lại PENDING.", ai + "services/fitness-agent.service.ts"),
        step("done", "Hoàn tất", "Kết quả", "Lưu COMPLETED và block kết quả. Confirm lặp sau hoàn tất có thể đọc lại kết quả đã ghi.", "Kết quả của API nghiệp vụ.", "ACTION_RESULT và trạng thái lưu.", ai + "services/fitness-agent.service.ts"),
      ]],
    ],
    edges: [["intent", "slots"], ["slots", "pending"], ["pending", "dismiss", "conditional"], ["pending", "claim"], ["claim", "domain"], ["domain", "done"], ["domain", "retry", "conditional"]],
  },
  rag: {
    title: "Truy xuất tri thức và nạp dữ liệu",
    summary: "Corpus được nạp riêng. Mỗi lượt chat truy xuất các đoạn phù hợp để cấp ngữ cảnh.",
    selected: "search",
    section: 5,
    rows: [
      ["Nạp kho tri thức", [
        step("source", "CSV / bằng chứng", "Nguồn dữ liệu", "Đọc bộ bài tập, kiến thức và FAQ. Knowledge pipeline còn nhận bằng chứng qua local JSONL, PubMed, RSS và web theo registry.", "Corpus và metadata nguồn.", "Payload chuẩn hóa hoặc tài liệu chờ duyệt.", ai + "knowledge-pipeline/service.ts"),
        step("ingest", "Duyệt và nhúng", "Ingest", "Tùy pipeline, kiểm chất lượng và trùng lặp, chia đoạn rồi tạo vector với search_document.", "Tài liệu đủ điều kiện.", "Vectors cùng payload và dấu vết nguồn.", ai + "knowledge-pipeline/qdrant-writer.ts"),
        step("index", "Vector index", "Lưu trữ", "Các collection giữ bài tập, tri thức, FAQ và evidence. Adapter kiểm chiều vector đã cấu hình.", "Vector tài liệu và payload.", "Index dùng để truy xuất semantic.", ai + "vector-store/provider.ts"),
      ]],
      ["Truy xuất theo lượt", [
        step("query", "Nhúng truy vấn", "Truy vấn", "Có thể mở rộng từ khóa trước khi nhúng bằng search_query. Tra lịch ăn/tập có đường bỏ qua RAG khi phù hợp.", "Câu hỏi và biến thể truy vấn.", "Vector truy vấn.", ai + "llm/retriever.ts"),
        step("search", "Tìm tài liệu", "Truy xuất", "Tìm theo scope phù hợp. Chat dùng các collection tri thức. Luồng chuyên lấy evidence giới hạn vào fitness_evidence.", "Vector, scope, ngưỡng và top K.", "Tập ứng viên theo từng index.", ai + "llm/retriever.ts"),
        step("rank", "Xếp hạng nguồn", "Lọc", "Nhận diện lớp nguồn, giới hạn FAQ tổng hợp và thực hiện lọc/xếp hạng. RAG_RETRIEVAL_V2 là nhánh theo cờ của RC2.", "Tài liệu và metadata.", "Các đoạn đã lọc, hoặc tập rỗng.", ai + "llm/retrieval_ranking.ts"),
      ]],
      ["Dùng trong phản hồi", [
        null,
        step("empty", "Retrieval rỗng", "Theo điều kiện", "Nếu truy xuất lỗi, hết giờ hoặc không có đoạn phù hợp, các nhánh phù hợp có thể dùng context rỗng, luật hoặc fallback.", "Tập rỗng hoặc lỗi truy xuất.", "Tiếp tục xử lý theo intent.", ai + "llm/orchestrator.service.ts", 3),
        step("prompt", "Ghép prompt", "Ngữ cảnh", "Giới hạn đoạn và ghép metadata nguồn với phần context được phép. Căn cứ cho từng nhận định cần đánh giá trên chính câu trả lời.", "Đoạn tri thức, provenance và context.", "Prompt gửi mô hình khi route yêu cầu.", ai + "llm/prompt_builder.ts", 3),
      ]],
    ],
    edges: [["source", "ingest"], ["ingest", "index"], ["query", "search"], ["index", "search"], ["search", "rank"], ["rank", "prompt"], ["rank", "empty", "conditional"]],
  },
  "sinh-ke-hoach": {
    title: "Sinh giáo án và thực đơn",
    summary: "Job tạo bản nháp có kiểm tra. Service nghiệp vụ lưu kế hoạch thực thi.",
    selected: "worker",
    section: 7,
    rows: [
      ["Tiếp nhận tác vụ", [
        step("input", "Form / chat", "Đầu vào", "Route trực tiếp hoặc workflow thu yêu cầu tạo/điều chỉnh kế hoạch.", "Goal và ràng buộc tập/ăn.", "Yêu cầu generation đủ dữ kiện.", ai + "routes/plan.routes.ts"),
        step("admit", "Admission", "Kiểm soát", "Kiểm quota và khóa lặp. Operation gắn khóa yêu cầu, fingerprint, actor, subject và target.", "Yêu cầu hợp lệ và định danh.", "Operation và plan được đưa vào hàng đợi.", ai + "services/generation-operations.ts"),
        step("queue", "BullMQ / SQS", "Tác vụ nền", "Publisher gửi job theo adapter. Worker claim lease, recovery xử lý job bị treo theo trạng thái.", "Operation cùng payload job.", "Job được chuyển tới processor.", ai + "workers/queue-provider.ts"),
      ]],
      ["Sinh và kiểm tra", [
        step("worker", "Worker sinh nháp", "LLM", "Worker lấy context và danh mục cho phép. Giáo án ground ID bài qua catalog. Thực đơn dùng ID thực phẩm và tính lại calo/macro.", "Dữ liệu job, catalog fitness-service và prompt.", "Nháp có cấu trúc cần kiểm tra.", ai + "workers/ai.worker.ts"),
        step("validate", "Repair & kiểm tra", "Kiểm soát", "Kiểm ràng buộc ngày/buổi, ID và thiết bị của giáo án. Với thực đơn, kiểm món, loại trừ, số bữa và độ lệch chỉ tiêu.", "Nháp từ worker và các trường tham chiếu.", "Nháp đạt kiểm tra hoặc lý do lỗi.", ai + "services/nutrition.processor.ts"),
        step("preview", "Preview", "Kết quả", "Ghi COMPLETED và phản hồi khi client tra job. Chat có thẻ xem trước khi lưu.", "Nháp đã kiểm tra.", "planId, nội dung và trạng thái.", ai + "controllers/plan.controller.ts"),
      ]],
      ["Lưu và xử lý lỗi", [
        null,
        step("failed", "Lỗi / recovery", "Theo điều kiện", "Đầu ra không đáp ứng kiểm tra được đánh dấu lỗi. Recovery có thể thực hiện lại phần xuất bản, xử lý lease hoặc replay auto-save tùy trạng thái.", "Lỗi hoặc operation cần xử lý.", "Trạng thái phản ánh kết quả hoặc tác vụ được tiếp tục.", ai + "services/generation-operations.ts"),
        step("save", "Lưu thực thi", "Tác dụng", "Fitness-service nhận import có sourcePlanId và quản lý chương trình thực thi. Bootstrap dinh dưỡng có đường auto-save đủ điều kiện.", "Plan đã hoàn tất và thao tác lưu phù hợp.", "WorkoutProgram, WorkoutSchedule hoặc NutritionProgram.", fitness + "routes/workout.routes.ts"),
      ]],
    ],
    edges: [["input", "admit"], ["admit", "queue"], ["queue", "worker"], ["worker", "validate"], ["validate", "preview"], ["validate", "failed", "conditional"], ["preview", "save"]],
  },
  inbody: {
    title: "OCR và giải thích InBody",
    summary: "Đọc phiếu đo, lưu bản ghi và giải thích các chỉ số là những bước riêng.",
    selected: "ocr",
    section: 8,
    rows: [
      ["Đọc phiếu", [
        step("upload", "Ảnh phiếu đo", "Đầu vào", "User-service nhận ảnh multipart, kiểm MIME, tên và kích thước, rồi tạo file tạm để xử lý.", "Ảnh phiếu InBody, tối đa 5 MB.", "Ảnh tạm cho OCR.", user + "routes/inbody.routes.ts"),
        step("ocr", "Vision OCR", "Mô hình", "Dùng provider vision với đường fallback theo cấu hình. Trích trường số đo, chuẩn hóa ngày và trả dữ liệu cho giao diện kiểm lại.", "Ảnh phiếu đo.", "result và entryData. File tạm được dọn cuối request.", user + "services/inbody-vision.service.ts"),
        step("entry", "Bản ghi InBody", "Dữ liệu", "Người dùng kiểm số đo rồi lưu hoặc sửa bằng API của user-service.", "Số đo đã được kiểm lại.", "InBodyEntry dùng làm nguồn cho phần diễn giải.", user + "controllers/inbody.controller.ts"),
      ]],
      ["Giải thích số đo", [
        step("read", "Đọc bản ghi", "Truy vấn", "Endpoint AI đọc entry thuộc người dùng và hồ sơ để chọn bản đo cần giải thích cùng bản trước đó.", "entryId tùy chọn và user đã xác thực.", "Hai mốc đo và bối cảnh cần dùng.", ai + "services/inbody-explanation.service.ts"),
        step("facts", "Tính facts", "Tất định", "Đánh dấu số lấy từ bản ghi và số được tính. Tạo thay đổi giữa các mốc khi có dữ liệu.", "Bản đo, thông tin hồ sơ và bản trước.", "Facts, chỉ số và chênh lệch.", ai + "llm/inbody-interpretation.ts"),
        step("explain", "Diễn giải", "LLM", "Model diễn giải từ facts. Lỗi model trả facts kèm trạng thái chưa có giải thích.", "Facts có nguồn từ bản ghi.", "explanation hoặc explanationError.", ai + "services/inbody-explanation.service.ts"),
      ]],
      ["Ảnh trong AI Coach", [
        step("vision", "Ảnh Coach", "Đầu vào", "Ảnh mục tiêu hoặc câu hỏi về ảnh đi vào route vision của Coach, với giới hạn 4 MB cho JPEG/PNG.", "Ảnh và session. Image-chat có thể kèm câu hỏi.", "Payload vision được kiểm.", ai + "routes/fitness-agent.routes.ts"),
        step("image", "Phân tích ảnh", "Mô hình", "Vision phân tích ảnh mục tiêu hoặc ảnh trong chat và trả kết quả cấu trúc.", "Ảnh và context tùy route.", "GOAL_ANALYSIS hoặc IMAGE_CHAT.", ai + "services/fitness-vision-chat.service.ts"),
        step("goal", "Xác nhận mục tiêu", "Theo điều kiện", "Endpoint goal/confirm nhận mục tiêu đã validate và gọi API nghiệp vụ khi user xác nhận.", "Mục tiêu và phiên sau khi người dùng chọn.", "Kết quả xác nhận trong hội thoại.", ai + "routes/fitness-agent.routes.ts"),
      ]],
    ],
    edges: [["upload", "ocr"], ["ocr", "entry"], ["entry", "read"], ["read", "facts"], ["facts", "explain"], ["vision", "image"], ["image", "goal", "conditional"]],
  },
  "chu-ky-pt": {
    title: "Đánh giá chu kỳ và trợ lý PT",
    summary: "Engine quyết định từ dữ liệu thực thi. AI giải thích và hỗ trợ đề xuất.",
    selected: "engine",
    section: 9,
    rows: [
      ["Đánh giá chu kỳ", [
        step("metrics", "Dữ liệu thực thi", "Nguồn dữ liệu", "Fitness-service tổng hợp dữ liệu tập luyện, dinh dưỡng và feedback liên quan tới chu kỳ.", "Số liệu và tiến độ của chu kỳ.", "Metric và tín hiệu cho engine.", fitness + "services/training-cycle.service.ts"),
        step("engine", "Engine quyết định", "Tất định", "Engine chạy trước khi gọi endpoint giải thích. Quyết định và lý do nghiệp vụ là dữ kiện đầu vào của AI.", "Tín hiệu chu kỳ và dữ kiện người dùng.", "Quyết định đề xuất và reason codes.", fitness + "services/cycle-decision.engine.ts"),
        step("explain", "Giải thích AI", "Diễn giải", "AI nhận quyết định đã tính, truy xuất evidence và tạo phần giải thích có fallback.", "Quyết định, số liệu và lý do.", "Giải thích cho CycleAssessment và audit.", ai + "services/cycle-assessment.service.ts"),
      ]],
      ["PT Copilot", [
        step("roster", "Dữ liệu học viên", "Truy vấn", "Đọc roster bằng API và dùng quan hệ PT–client đang hiệu lực để giới hạn dữ liệu.", "PT đã xác thực và cửa sổ thời gian.", "Tín hiệu tuân thủ của học viên được phép.", ai + "services/pt-copilot-roster.ts"),
        step("advice", "Soạn đề xuất", "Đề xuất", "Chọn học viên từ tên hoặc tín hiệu rồi tạo đề xuất theo dữ kiện. Hỏi rõ thêm khi mơ hồ.", "Roster và yêu cầu của PT.", "Bản nháp đề xuất kèm dữ kiện nguồn.", ai + "services/pt-copilot-proposals.ts"),
        step("audit", "Duyệt & ghi audit", "Xác nhận", "Khi PT duyệt hoặc bỏ qua, fitness-service kiểm lại quan hệ rồi ghi audit. Bản nháp có thể được PT sử dụng sau đó.", "Thao tác của PT đối với đề xuất.", "CoachClientActionAudit và kết quả xác nhận.", ai + "services/fitness-agent.service.ts"),
      ]],
    ],
    edges: [["metrics", "engine"], ["engine", "explain"], ["roster", "advice"], ["advice", "audit"]],
  },
  harness: {
    title: "Runtime Harness",
    summary: "Các lớp kiểm soát quanh mô hình khi Gymini xử lý yêu cầu thật.",
    note: "Kiểm soát xuyên suốt gồm quyền user/phiên, rate limit, trace và metrics, chống lặp job và các cờ cấu hình.",
    selected: "model",
    section: 11,
    reportAnchor: "111-runtime-harness-trong-luồng-ai",
    rows: [
      ["Trước khi gọi mô hình", [
        step("input", "Ngôn ngữ & phiên", "Đầu vào", "Route tiếp nhận yêu cầu đã xác thực. RAG service kiểm quyền phiên và nhận diện request đã lưu. Orchestrator chọn ngôn ngữ phản hồi.", "Câu hỏi, user và sessionId nếu có.", "Lượt xử lý có ngữ cảnh phiên và ngôn ngữ.", ai + "llm/orchestrator.service.ts"),
        step("safety", "Safety Guard", "Kiểm soát", "Kiểm văn bản và tuổi hồ sơ khi phù hợp. Một số trường hợp an toàn kết thúc sớm bằng mẫu phản hồi.", "Câu hỏi đã nhận và bối cảnh cần thiết.", "Cho phép đi tiếp hoặc trả mẫu an toàn.", ai + "llm/safety_guard.ts"),
        step("routing", "Định tuyến", "Điều phối", "Xét intent và trạng thái nghiệp vụ. Workflow theo luật có thể trả trực tiếp. Các cấu hình CI có thể sử dụng mô hình để hỗ trợ hiểu ý, còn nhánh hành động được mã điều phối chọn và kiểm.", "Câu hỏi, intent và trạng thái workflow.", "Handler nghiệp vụ, trả lời tất định hoặc nhánh cần LLM.", ai + "services/fitness-agent.service.ts"),
      ]],
      ["Dữ kiện, mô hình và kiểm đầu ra", [
        step("grounding", "Grounding", "Dữ kiện", "Giới hạn dữ kiện gửi tới model theo intent. Chat có thể lấy đoạn RAG. Thực đơn và giáo án dựa trên NutritionGoal khi áp dụng và danh mục chứa Exercise.id hoặc ID thực phẩm.", "Hồ sơ, mục tiêu, catalog và tri thức liên quan.", "Dữ kiện có nguồn để xây prompt hoặc áp luật.", ai + "llm/context_plan.ts"),
        step("model", "Gọi LLM", "Mô hình", "Chat có đường sinh văn bản và tool calling tùy cấu hình. Một số luồng đầu ra có cấu trúc gọi callLlmJson để trích JSON và kiểm bằng Zod. Helper mặc định tối đa hai lần thử và cho caller đặt ngân sách riêng.", "Prompt và giới hạn timeout/token của nhánh.", "Văn bản, kết quả có schema hoặc tín hiệu lỗi.", ai + "llm/json_llm_call.util.ts"),
        step("validate", "Kiểm đầu ra", "Kiểm soát", "Chat kiểm claim, ngôn ngữ, số liệu và cấu trúc. Nhánh worker kiểm ID danh mục, thiết bị hoặc chỉ tiêu dinh dưỡng theo invariant tương ứng. Các nhánh chuyên biệt có tiêu chí khác nhau.", "Đầu ra mô hình và ràng buộc nghiệp vụ.", "Kết quả đạt kiểm tra hoặc lỗi để xử lý.", ai + "llm/answer_validator.ts"),
      ]],
      ["Trả lời và áp dụng", [
        step("fallback", "Fallback / dừng", "Theo điều kiện", "Khi lỗi, chat có thể trả câu tất định. Worker có thể sửa từ catalog hoặc chỉnh lượng rồi kiểm lại. Kế hoạch vi phạm sau bước cuối được ghi lỗi.", "Lỗi mô hình hoặc lỗi kiểm đầu ra.", "Phản hồi thay thế, bản nháp được sửa hoặc trạng thái FAILED.", ai + "workers/ai.worker.ts"),
        step("confirm", "Biên xác nhận", "Xác nhận", "Action cần xác nhận được đưa ra dưới dạng thẻ hoặc bước xác nhận của workflow. Khi người dùng xác nhận, handler kiểm quyền và trạng thái rồi gọi API của service sở hữu.", "Đề xuất và thao tác xác nhận.", "Kết quả áp dụng từ service nghiệp vụ.", ai + "services/fitness-agent.service.ts", 4),
        step("result", "Trả kết quả", "Kết quả", "Chat lưu Conversation và trả JSON hoặc SSE. Worker lưu nội dung và trạng thái truy xuất theo job. Kết quả action phản ánh thao tác đã thực hiện.", "Kết quả chat, job hoặc action theo nhánh.", "Câu trả lời, preview, trạng thái lỗi hoặc kết quả nghiệp vụ.", ai + "services/rag.service.ts", 3),
      ]],
    ],
    edges: [
      ["input", "safety"], ["safety", "routing"], ["routing", "grounding"], ["grounding", "model"], ["model", "validate"],
      ["validate", "fallback", "conditional"], ["validate", "confirm", "conditional"], ["validate", "result"],
      ["fallback", "result", "conditional"], ["confirm", "result", "conditional"], ["safety", "result", "conditional"],
    ],
  },
  "danh-gia": {
    title: "Bộ kiểm thử và đánh giá",
    summary: "Từ chuẩn bị fixture cho đến thu dấu vết và chấm theo kỳ vọng.",
    selected: "gather",
    section: 11,
    reportAnchor: "112-bộ-kiểm-thử-và-đánh-giá",
    rows: [
      ["Điều kiện chạy", [
        step("preflight", "Preflight", "Harness", "Kiểm điều kiện của stack, tiến trình và job tồn. Đường có provider tính phí có cổng kiểm ngân sách.", "Cấu hình stack kiểm thử.", "Điều kiện chạy và giới hạn đã biết.", "test/ai-chat-full-verification/stack.mjs"),
        step("fixtures", "Fixture", "Dữ liệu test", "Tạo tài khoản hoặc dữ liệu kiểm thử theo persona và case. DB kiểm thử có phạm vi riêng.", "Kịch bản và persona.", "User, phiên và dữ liệu để chạy case.", "test/ai-chat-full-verification/setup-users.mjs"),
        step("input", "Case / oracle", "Kỳ vọng", "Case định nghĩa câu hỏi, điều kiện, hành động và kết quả cần đối chiếu. Held-out có quy trình mở riêng.", "Dataset và quy tắc đánh giá.", "Kịch bản chạy có tiêu chí chấm.", "test/ai-eval/run-eval.mjs"),
      ]],
      ["Chạy và ghi nhận", [
        step("runner", "Runner", "Thực thi", "Runner gửi lượt qua API hoặc trình duyệt tùy suite. Trong đợt audit, các suite đã chạy là fixture.", "Case và môi trường chạy tương ứng.", "Phản hồi từ điểm vào đã chọn.", "test/ai-chat-full-verification/journeys.mjs", 12),
        step("gather", "Trace & DB test", "Bằng chứng", "Harness ghi ID, thời gian, loại block, response và đọc trạng thái cần kiểm từ database test khi suite có bước đó.", "Phản hồi, log và hàng dữ liệu test.", "Trace và assertion theo từng lượt.", "test/ai-chat-full-verification/harness.mjs"),
        step("gate", "Provider gate", "Theo điều kiện", "Ghi nhận lượt inference/embedding, giới hạn call và ngân sách dự phòng. SDK probe của đợt audit dùng upstream loopback giả lập.", "Lời gọi qua cổng provider trong suite.", "Lượt được chuyển tiếp, từ chối hoặc usage đã ghi.", "test/ai-chat-full-verification/provider-gate.mjs"),
      ]],
      ["Đánh giá", [
        step("score", "Chấm tiêu chí", "Oracle", "System eval chấm routing, business, safety và side effect. Các phép chấm chất lượng dùng rubric riêng.", "Case, phản hồi và giá trị DB cần kiểm.", "Điểm và kết quả từng trục.", "test/ai-eval/score.mjs"),
        step("judge", "Judge riêng", "Theo điều kiện", "Quality eval có judge bằng mô hình và bộ chấm người. Điểm mỗi nguồn phải đi cùng provenance.", "Câu trả lời, persona và rubric.", "Kết quả của nguồn chấm tương ứng.", "test/ai-quality-eval/judge.mjs"),
        step("report", "Báo cáo", "Kết quả", "Báo cáo ghi 100/100 ca fixture trên 10 tệp. Các mức bằng chứng của từng loại kiểm thử được ghi riêng.", "Kết quả có phạm vi và lệnh đã chạy.", "Bảng kết quả và giới hạn diễn giải.", "docs/AI_V1_AUDIT_KHOA_LUAN.md", 12),
      ]],
    ],
    edges: [["preflight", "fixtures"], ["fixtures", "input"], ["input", "runner"], ["runner", "gather"], ["runner", "gate", "conditional"], ["gather", "score"], ["gather", "judge", "conditional"], ["score", "report"], ["judge", "report", "conditional"]],
  },
};
