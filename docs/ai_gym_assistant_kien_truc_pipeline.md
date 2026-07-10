# Hệ thống AI Gym Assistant tự cập nhật tri thức (RAG) — Thiết kế kiến trúc chi tiết & khả thi chi phí thấp

Tài liệu thiết kế dành cho một developer/sinh viên triển khai thật, demo được, và phát triển thành khoá luận ngành Hệ thống thông tin.

---

## 0\. Quyết định kiến trúc cốt lõi (đọc trước tiên)

**"AI tự học" \= tự động làm mới KHO TRI THỨC (RAG), KHÔNG retrain model.**

| Cách hiểu sai                               | Cách làm đúng (tài liệu này)                                   |
| :------------------------------------------ | :------------------------------------------------------------- |
| Model tự cập nhật trọng số mỗi tuần         | Model **cố định**; chỉ vector database thay đổi                |
| Cần GPU lớn, tốn tiền, dễ "ngộ độc" dữ liệu | CPU/GPU nhỏ là đủ; chi phí \~0–40 USD/tháng                    |
| Khó demo, kết quả không ổn định             | Demo rõ ràng: thêm tài liệu mới → AI trả lời theo tài liệu mới |
| Rủi ro catastrophic forgetting              | Không có; chỉ thêm/sửa/xoá tri thức trong corpus               |

Hệ quả: pipeline của bạn là một **knowledge-update pipeline**. Mỗi chu kỳ (ngày/tuần) nó crawl → lọc → đánh giá → embed → ghi vào Qdrant. Khi user hỏi, AI luôn truy xuất tri thức **mới nhất, đã kiểm duyệt** và trả lời có trích dẫn nguồn.

(Nếu sau này muốn "tự học sâu" hơn → mục 12.2 nói về continual fine-tuning như hướng mở rộng, **không** bắt buộc cho khoá luận.)

---

## 1\. Các service & công nghệ

| \#  | Service                   | Vai trò                                                 | Công nghệ đề xuất                                                                           | Lý do (chi phí/khả thi)                             |
| :-- | :------------------------ | :------------------------------------------------------ | :------------------------------------------------------------------------------------------ | :-------------------------------------------------- |
| 1   | **API Gateway / RAG API** | Nhận câu hỏi, trả lời RAG                               | **FastAPI** (Python)                                                                        | Nhanh, async, dễ viết, hệ sinh thái AI tốt          |
| 2   | **Scheduler**             | Kích hoạt pipeline định kỳ                              | **Celery Beat** (giai đoạn 1), **K8s CronJob** (giai đoạn 2\)                               | Không cần service riêng nặng                        |
| 3   | **Crawler worker**        | Thu thập dữ liệu                                        | **Celery worker** \+ `httpx` \+ `trafilatura` \+ `feedparser` \+ PubMed E-utilities         | API PubMed miễn phí; trafilatura tách nội dung sạch |
| 4   | **Processing worker**     | Làm sạch, lọc trùng, phân loại, chấm điểm, kiểm an toàn | **Celery worker** \+ `langdetect` \+ `datasketch` (MinHash) \+ LLM-judge                    | Tách riêng để scale độc lập                         |
| 5   | **Embedding worker**      | Chia chunk \+ tạo vector                                | **Celery worker** \+ **BGE-M3** (`sentence-transformers` / FlagEmbedding)                   | Open-source, đa ngôn ngữ (Việt+Anh), miễn phí       |
| 6   | **Message broker**        | Hàng đợi bất đồng bộ                                    | **RabbitMQ** (mặc định) — _Kafka chỉ khi cần stream lớn_                                    | RabbitMQ nhẹ, dễ học, đủ dùng                       |
| 7   | **Vector DB**             | Lưu & truy xuất embedding                               | **Qdrant** (self-host) — _hoặc pgvector để siêu gọn_                                        | Miễn phí, lọc payload mạnh, hybrid search           |
| 8   | **Metadata DB**           | Trạng thái tài liệu, điểm, log                          | **PostgreSQL**                                                                              | Một DB quan hệ ổn định, miễn phí                    |
| 9   | **Object storage**        | File thô (HTML/PDF gốc)                                 | **MinIO** (S3-compatible)                                                                   | Miễn phí, chạy 1 container                          |
| 10  | **Cache / khóa**          | Dedup set, rate-limit, cache câu trả lời                | **Redis**                                                                                   | Nhẹ, đa dụng                                        |
| 11  | **LLM sinh câu trả lời**  | Tạo câu trả lời từ context                              | **API rẻ**: Gemini Flash / GPT‑4o‑mini / DeepSeek — _hoặc local_ **Qwen2.5** qua **Ollama** | API: vài USD/tháng; local: 0đ                       |
| 12  | **Reranker**              | Xếp hạng lại kết quả truy xuất                          | **bge-reranker-v2-m3** (local) hoặc Cohere Rerank (API)                                     | Tăng độ chính xác RAG đáng kể                       |
| 13  | **Monitoring**            | Metric, dashboard                                       | **Prometheus \+ Grafana**, **Flower** (Celery)                                              | Chuẩn công nghiệp, miễn phí                         |
| 14  | **Dashboard pipeline**    | Theo dõi crawl/accept/reject                            | Grafana (nhanh) hoặc **Streamlit** (đẹp, dễ demo)                                           | Streamlit dựng UI Python siêu nhanh                 |

Lưu ý version: các model (BGE‑M3, Qwen, Gemini Flash, GPT‑4o‑mini, DeepSeek…) thay đổi nhanh — khi triển khai hãy kiểm tra bản mới nhất. Kiến trúc không phụ thuộc vào model cụ thể: chỉ cần đổi config là thay được.

---

## 2\. Luồng dữ liệu chi tiết (crawl → AI trả lời)

### 2.1 Pha cập nhật tri thức (chạy nền, định kỳ)

1. **Scheduler** đến giờ (vd 02:00 hằng ngày) → tạo bản ghi `pipeline_runs(status=running)` → với mỗi `source` đang bật, phát task `crawl_source` vào hàng đợi `crawl`.
2. **Crawler worker** lấy task:
   - Fetch nội dung (API PubMed / RSS / web), **tôn trọng `robots.txt`** và rate-limit.
   - Tính `content_hash` (SHA‑256). Nếu trùng hash đã có → bỏ qua (dedup sơ cấp).
   - Lưu file thô lên **MinIO**, tạo `documents(status='crawled')`.
   - Phát task `process_document` vào hàng đợi `process`.
3. **Processing worker**:
   - Trích text sạch (`trafilatura`), phát hiện ngôn ngữ.
   - **Dedup ngữ nghĩa**: so cosine với vector đã có; nếu ≥ 0.95 → coi là trùng → `rejected (duplicate)`.
   - **Phân loại chủ đề** (training / nutrition / recovery / injury / general).
   - **Chấm điểm**: `trust_score` (theo tier nguồn \+ tín hiệu) và `quality_score`.
   - **Kiểm an toàn** (LLM-judge): phát hiện lời khuyên y tế nguy hiểm, quảng cáo supplement.
   - **Cổng quyết định**:
     - `trust_score ≥ 0.6` và không cờ an toàn → `status='scored'` → phát `embed_document`.
     - `0.4 ≤ trust_score < 0.6` → `status='review'` → đẩy `review_queue` (người duyệt).
     - `< 0.4` hoặc cờ an toàn → `status='rejected'`.
4. **Embedding worker**:
   - **Chunk** văn bản (\~512 token, overlap 64, tôn trọng ranh giới đoạn/mục).
   - Tạo vector bằng **BGE‑M3** (dense \+ sparse).
   - **Upsert** vào **Qdrant** kèm payload (nguồn, tier, trust, topic, ngày, url).
   - Ghi bảng `chunks`, đặt `documents.status='embedded'`.
   - Cập nhật bộ đếm `pipeline_runs` (accepted/rejected/review).

### 2.2 Pha phục vụ người dùng (đồng bộ, thời gian thực)

5. User hỏi qua app → **RAG API**:
   - Embed câu hỏi (BGE‑M3, dense+sparse).
   - **Hybrid search** trong Qdrant \+ **lọc payload** (`trust_score ≥ 0.6`, ưu tiên `published_at` gần) → lấy top‑K (vd 20).
   - **Rerank** (bge-reranker) → giữ top‑N (vd 5).
   - Dựng **context kèm nguồn** → gọi **LLM** với prompt RAG (bắt buộc trích dẫn).
   - Trả về câu trả lời \+ danh sách nguồn; ghi `query_logs` để đánh giá.
6. **Observability**: mọi bước bắn metric → Prometheus → Grafana. Flower theo dõi Celery.

### 2.3 Sơ đồ tuần tự (mermaid)

sequenceDiagram

    autonumber

    participant SCH as Scheduler

    participant MQ as RabbitMQ

    participant CR as Crawler

    participant PR as Processing

    participant EM as Embedding

    participant QD as Qdrant

    participant API as RAG API

    participant LLM as LLM

    SCH-\>\>MQ: phát task crawl\_source (định kỳ)

    MQ-\>\>CR: giao task

    CR-\>\>CR: fetch \+ hash \+ lưu MinIO

    CR-\>\>MQ: phát process\_document

    MQ-\>\>PR: giao task

    PR-\>\>PR: lọc trùng \+ phân loại \+ chấm điểm \+ kiểm an toàn

    alt đạt chuẩn

        PR-\>\>MQ: phát embed\_document

        MQ-\>\>EM: giao task

        EM-\>\>QD: upsert vector \+ payload

    else không đạt

        PR-\>\>PR: reject / đưa review

    end

    Note over QD: Kho tri thức luôn được làm mới

    API-\>\>QD: (khi user hỏi) hybrid search \+ lọc trust

    QD--\>\>API: top-K chunks

    API-\>\>LLM: prompt \+ context (kèm nguồn)

    LLM--\>\>API: câu trả lời có trích dẫn

---

## 3\. Thiết kế database (PostgreSQL)

\-- 3.1 Nguồn được phép crawl (ALLOWLIST — cốt lõi kiểm soát an toàn)

CREATE TABLE sources (

    id              BIGSERIAL PRIMARY KEY,

    name            TEXT NOT NULL,

    base\_url        TEXT NOT NULL UNIQUE,

    source\_type     TEXT NOT NULL CHECK (source\_type IN ('rss','api','web')),

    trust\_tier      SMALLINT NOT NULL DEFAULT 3 CHECK (trust\_tier BETWEEN 1 AND 3),

    crawl\_cron      TEXT DEFAULT '0 2 \* \* \*',   \-- mặc định 02:00 hằng ngày

    is\_active       BOOLEAN NOT NULL DEFAULT TRUE,

    last\_crawled\_at TIMESTAMPTZ,

    created\_at      TIMESTAMPTZ NOT NULL DEFAULT now()

);

\-- 3.2 Tài liệu (vòng đời: crawled → cleaned → scored → embedded | rejected | review)

CREATE TABLE documents (

    id               BIGSERIAL PRIMARY KEY,

    source\_id        BIGINT REFERENCES sources(id),

    url              TEXT NOT NULL,

    title            TEXT,

    author           TEXT,

    language         TEXT,                        \-- 'vi','en',...

    content\_hash     CHAR(64) NOT NULL UNIQUE,    \-- SHA-256 chống trùng cấp 1

    raw\_object\_key   TEXT,                        \-- key file thô trên MinIO

    clean\_text       TEXT,

    topic            TEXT,                        \-- training/nutrition/recovery/injury/general

    trust\_score      NUMERIC(4,3),               \-- 0..1

    quality\_score    NUMERIC(4,3),               \-- 0..1

    safety\_flag      BOOLEAN DEFAULT FALSE,       \-- TRUE \= nội dung nguy hiểm

    status           TEXT NOT NULL DEFAULT 'crawled'

                     CHECK (status IN ('crawled','cleaned','scored','embedded','rejected','review')),

    rejection\_reason TEXT,

    published\_at     TIMESTAMPTZ,

    crawled\_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    processed\_at     TIMESTAMPTZ

);

CREATE INDEX idx_documents_status ON documents(status);

CREATE INDEX idx_documents_topic ON documents(topic);

\-- 3.3 Chunk \+ trỏ tới point trong Qdrant

CREATE TABLE chunks (

    id            BIGSERIAL PRIMARY KEY,

    document\_id   BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

    chunk\_index   INT NOT NULL,

    text          TEXT NOT NULL,

    token\_count   INT,

    vector\_id     UUID NOT NULL,                 \-- point id trong Qdrant

    embedded\_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (document\_id, chunk\_index)

);

\-- 3.4 Theo dõi mỗi lần chạy pipeline (nguồn dữ liệu cho dashboard)

CREATE TABLE pipeline_runs (

    id             BIGSERIAL PRIMARY KEY,

    run\_type       TEXT NOT NULL,                \-- 'scheduled\_daily','manual',...

    started\_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    finished\_at    TIMESTAMPTZ,

    docs\_crawled   INT DEFAULT 0,

    docs\_accepted  INT DEFAULT 0,

    docs\_rejected  INT DEFAULT 0,

    docs\_review    INT DEFAULT 0,

    status         TEXT DEFAULT 'running'        \-- running/success/failed

);

\-- 3.5 Hàng đợi duyệt thủ công (human-in-the-loop) cho nội dung biên

CREATE TABLE review_queue (

    id           BIGSERIAL PRIMARY KEY,

    document\_id  BIGINT NOT NULL REFERENCES documents(id),

    reason       TEXT,

    status       TEXT DEFAULT 'pending',         \-- pending/approved/rejected

    reviewed\_by  TEXT,

    reviewed\_at  TIMESTAMPTZ

);

\-- 3.6 Log truy vấn RAG (để đánh giá chất lượng trả lời — RAGAS, latency)

CREATE TABLE query_logs (

    id              BIGSERIAL PRIMARY KEY,

    user\_query      TEXT NOT NULL,

    retrieved\_ids   BIGINT\[\],

    answer          TEXT,

    faithfulness    NUMERIC(4,3),

    latency\_ms      INT,

    created\_at      TIMESTAMPTZ NOT NULL DEFAULT now()

);

**Sơ đồ quan hệ (ERD rút gọn):** `sources 1—N documents 1—N chunks`; `documents 1—N review_queue`; `pipeline_runs` và `query_logs` độc lập (bảng theo dõi).

---

## 4\. Thiết kế vector database (Qdrant)

from qdrant_client import QdrantClient, models

client \= QdrantClient(url="http://qdrant:6333")

client.create_collection(

    collection\_name="fitness\_knowledge",

    \# Hybrid: vector đặc (semantic) \+ vector thưa (giống BM25) — BGE-M3 cho cả hai

    vectors\_config={

        "dense": models.VectorParams(size=1024, distance=models.Distance.COSINE),

    },

    sparse\_vectors\_config={

        "sparse": models.SparseVectorParams(modifier=models.Modifier.IDF),

    },

    \# Tối ưu RAM: lưu vector trên đĩa khi collection lớn

    on\_disk\_payload=True,

)

\# Payload index để LỌC NHANH khi truy vấn (an toàn \+ độ mới)

for field, schema in \[

    ("topic",        models.PayloadSchemaType.KEYWORD),

    ("trust\_score",  models.PayloadSchemaType.FLOAT),

    ("source\_tier",  models.PayloadSchemaType.INTEGER),

    ("published\_at", models.PayloadSchemaType.DATETIME),

    ("language",     models.PayloadSchemaType.KEYWORD),

\]:

    client.create\_payload\_index("fitness\_knowledge", field\_name=field, field\_schema=schema)

**Mỗi point (chunk) gồm payload:**

{

"document_id": 123,

"chunk_id": 456,

"text": "Nội dung chunk...",

"source_name": "PubMed",

"source_url": "https://...",

"source_tier": 1,

"trust_score": 0.92,

"topic": "nutrition",

"language": "en",

"published_at": "2025-08-01T00:00:00Z"

}

**Truy vấn hybrid \+ lọc an toàn:**

hits \= client.query_points(

    collection\_name="fitness\_knowledge",

    prefetch=\[

        models.Prefetch(query=dense\_vec, using="dense", limit=50),

        models.Prefetch(query=sparse\_vec, using="sparse", limit=50),

    \],

    query=models.FusionQuery(fusion=models.Fusion.RRF),   \# gộp 2 nguồn bằng RRF

    query\_filter=models.Filter(must=\[

        models.FieldCondition(key="trust\_score", range=models.Range(gte=0.6)),

    \]),

    limit=20,

).points

**Phương án siêu gọn (ít service nhất):** dùng **pgvector** ngay trong PostgreSQL (`CREATE EXTENSION vector;` \+ cột `vector(1024)` \+ index `HNSW`). Bớt 1 container. Đủ tốt ở quy mô vài chục–trăm nghìn chunk. Lên quy mô lớn / cần hybrid mạnh thì Qdrant vượt trội hơn. Cho khoá luận, Qdrant "ăn điểm" hơn về tính chuyên dụng.

---

## 5\. Kiểm soát chất lượng & an toàn tri thức

Đây là **đóng góp học thuật rõ nhất** của đề tài — hãy đầu tư phần này.

### 5.1 Phân tầng độ tin cậy nguồn (trust tier)

| Tier          | Điểm nền | Nguồn ví dụ                                                           |
| :------------ | :------- | :-------------------------------------------------------------------- |
| **1**         | 0.90     | PubMed/PMC, Cochrane, WHO, CDC/NIH, tạp chí bình duyệt, `.gov`/`.edu` |
| **2**         | 0.70     | ACSM, NSCA, ISSN position stands, Mayo Clinic, trang y tế uy tín      |
| **3**         | 0.40     | Blog/tạp chí fitness phổ thông (bắt buộc qua review)                  |
| **Blocklist** | —        | Trang bán supplement, MLM, trang dày CTA quảng cáo                    |

### 5.2 Công thức điểm tin cậy (gợi ý)

def trust_score(doc, source) \-\> float:

    s \= {1: 0.90, 2: 0.70, 3: 0.40}\[source.trust\_tier\]

    if doc.has\_citations:        s \+= 0.05     \# có trích dẫn khoa học

    if doc.is\_recent(years=5):   s \+= 0.05     \# còn mới

    if doc.author\_credentialed:  s \+= 0.03     \# tác giả có chuyên môn

    if doc.ad\_density \> 0.3:     s \-= 0.30     \# nhiều quảng cáo → phạt nặng

    if doc.is\_supplement\_promo:  s \-= 0.40     \# quảng cáo supplement

    return max(0.0, min(1.0, s))

### 5.3 Pipeline lọc nhiều tầng

1. **Allowlist nguồn** — chỉ crawl Tier 1/2 (Tier 3 phải review).
2. **Chất lượng trích xuất** — độ dài tối thiểu, ngôn ngữ hợp lệ.
3. **Lọc trùng** — hash (cấp 1\) \+ cosine ≥ 0.95 (cấp 2).
4. **Phát hiện quảng cáo/spam** — mật độ CTA \+ phân loại supplement promo.
5. **Chấm tin cậy & chất lượng** — công thức 5.2.
6. **Kiểm an toàn (LLM-judge)** — chặn lời khuyên nguy hiểm (nhịn ăn cực đoan, liều supplement nguy hiểm, giảm cân cấp tốc, claim y tế cần gặp bác sĩ).
7. **Cổng quyết định** — accept / reject / review (ngưỡng mục 2.1).
8. **Provenance** — mỗi chunk giữ nguồn \+ điểm để **trích dẫn** trong câu trả lời (chống "bịa").

### 5.4 Prompt LLM-judge an toàn (mẫu)

Bạn là kiểm duyệt viên nội dung sức khỏe/thể hình. Đánh giá đoạn sau:

1\) Có lời khuyên y tế nguy hiểm không? (nhịn ăn cực đoan, liều thuốc/supplement

nguy hiểm, giảm cân quá nhanh, claim chữa bệnh)

2\) Có phải quảng cáo bán hàng trá hình không?

Trả về JSON: {"safe": true|false, "reason": "...", "category": "..."}

Chỉ trả JSON, không thêm gì khác.

### 5.5 Prompt RAG sinh câu trả lời (mẫu, bắt buộc trích dẫn)

Bạn là trợ lý thể hình. CHỈ dùng thông tin trong \[CONTEXT\] để trả lời.

\- Nếu context không đủ, nói rõ "chưa có đủ dữ liệu" — KHÔNG bịa.

\- Luôn trích dẫn nguồn dạng \[n\] tương ứng tài liệu trong context.

\- Với chấn thương/bệnh lý nghiêm trọng, khuyên người dùng gặp chuyên gia y tế.

\[CONTEXT\]

{context_kèm_số_thứ_tự_và_nguồn}

\[CÂU HỎI\] {question}

---

## 6\. Triển khai giai đoạn 1 — Docker Compose

### 6.1 Cấu trúc thư mục

ai-gym-kb/

├── docker-compose.yml

├── .env

├── api/ \# FastAPI: RAG serving

│ ├── Dockerfile

│ └── main.py

├── worker/ \# Celery: crawl / process / embed

│ ├── Dockerfile

│ ├── tasks.py

│ └── celery_app.py

├── dashboard/ \# Streamlit (tùy chọn)

│ └── app.py

├── db/

│ └── init.sql \# schema mục 3

└── monitoring/

    ├── prometheus.yml

    └── grafana/

### 6.2 `docker-compose.yml`

services:

postgres:

    image: postgres:16

    environment:

      POSTGRES\_DB: gymkb

      POSTGRES\_USER: gym

      POSTGRES\_PASSWORD: ${PG\_PASSWORD}

    volumes:

      \- pg\_data:/var/lib/postgresql/data

      \- ./db/init.sql:/docker-entrypoint-initdb.d/init.sql

    ports: \["5432:5432"\]

qdrant:

    image: qdrant/qdrant:latest

    volumes: \[qdrant\_data:/qdrant/storage\]

    ports: \["6333:6333"\]

rabbitmq:

    image: rabbitmq:3-management

    environment:

      RABBITMQ\_DEFAULT\_USER: gym

      RABBITMQ\_DEFAULT\_PASS: ${RABBIT\_PASSWORD}

    ports: \["5672:5672", "15672:15672"\]   \# 15672 \= UI quản trị

redis:

    image: redis:7

    ports: \["6379:6379"\]

minio:

    image: minio/minio:latest

    command: server /data \--console-address ":9001"

    environment:

      MINIO\_ROOT\_USER: gym

      MINIO\_ROOT\_PASSWORD: ${MINIO\_PASSWORD}

    volumes: \[minio\_data:/data\]

    ports: \["9000:9000", "9001:9001"\]

api:

    build: ./api

    env\_file: .env

    depends\_on: \[postgres, qdrant, redis\]

    ports: \["8000:8000"\]

\# Một image worker, chạy nhiều bản với cờ hàng đợi khác nhau

worker-crawl:

    build: ./worker

    command: celery \-A celery\_app worker \-Q crawl \-c 2 \-n crawl@%h

    env\_file: .env

    depends\_on: \[rabbitmq, postgres, minio\]

worker-process:

    build: ./worker

    command: celery \-A celery\_app worker \-Q process \-c 2 \-n process@%h

    env\_file: .env

    depends\_on: \[rabbitmq, postgres\]

worker-embed:

    build: ./worker

    command: celery \-A celery\_app worker \-Q embed \-c 1 \-n embed@%h

    env\_file: .env

    depends\_on: \[rabbitmq, qdrant\]

beat:

    build: ./worker

    command: celery \-A celery\_app beat \-l info

    env\_file: .env

    depends\_on: \[rabbitmq\]

flower:

    build: ./worker

    command: celery \-A celery\_app flower \--port=5555

    ports: \["5555:5555"\]

    depends\_on: \[rabbitmq\]

prometheus:

    image: prom/prometheus:latest

    volumes: \["./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml"\]

    ports: \["9090:9090"\]

grafana:

    image: grafana/grafana:latest

    ports: \["3000:3000"\]

    volumes: \[grafana\_data:/var/lib/grafana\]

\# Tùy chọn: LLM local thay cho API

\# ollama:

\# image: ollama/ollama:latest

\# volumes: \[ollama_data:/root/.ollama\]

\# ports: \["11434:11434"\]

volumes:

pg_data:

qdrant_data:

minio_data:

grafana_data:

### 6.3 Celery tasks (rút gọn, đại diện)

\# celery_app.py

from celery import Celery

app \= Celery("gymkb",

             broker="amqp://gym:pass@rabbitmq:5672//",

             backend="redis://redis:6379/0")

app.conf.task_routes \= {

    "tasks.crawl\_source":    {"queue": "crawl"},

    "tasks.process\_document":{"queue": "process"},

    "tasks.embed\_document":  {"queue": "embed"},

}

\# Lịch định kỳ (Celery Beat)

app.conf.beat_schedule \= {

    "daily-crawl": {"task": "tasks.kickoff\_crawl", "schedule": 24 \* 3600},

}

\# tasks.py

from celery_app import app

@app.task

def kickoff_crawl():

    \# tạo pipeline\_runs(status=running); với mỗi source active \-\> crawl\_source.delay(id)

    ...

@app.task

def crawl_source(source_id: int):

    \# fetch (API/RSS/web) \-\> hash \-\> nếu mới: lưu MinIO \+ insert documents \-\> process\_document.delay(doc\_id)

    ...

@app.task

def process_document(document_id: int):

    \# trafilatura \-\> langdetect \-\> dedup ngữ nghĩa \-\> phân loại topic

    \# \-\> trust\_score \+ quality\_score \-\> LLM-judge an toàn

    \# đạt: status='scored' \-\> embed\_document.delay(id)

    \# biên: status='review' \+ review\_queue ; trượt: status='rejected'

    ...

@app.task

def embed_document(document_id: int):

    \# chunk \-\> BGE-M3 (dense+sparse) \-\> upsert Qdrant \-\> insert chunks \-\> status='embedded'

    ...

### 6.4 RAG endpoint (rút gọn)

\# api/main.py

from fastapi import FastAPI

app \= FastAPI()

@app.post("/ask")

async def ask(payload: dict):

    q \= payload\["question"\]

    dense, sparse \= embed\_model.encode(q)                 \# BGE-M3

    hits \= qdrant\_hybrid\_search(dense, sparse,

                                trust\_gte=0.6, limit=20)   \# mục 4

    top \= reranker.rerank(q, \[h.payload\["text"\] for h in hits\])\[:5\]

    context, sources \= build\_context(top)                  \# kèm số \[n\] \+ nguồn

    answer \= llm.generate(RAG\_PROMPT.format(context=context, question=q))

    log\_query(q, top, answer)                              \# query\_logs

    return {"answer": answer, "sources": sources}

### 6.5 Chạy & demo

cp .env.example .env \# điền mật khẩu \+ API key LLM

docker compose up \-d \--build

docker compose ps

\# UI: RabbitMQ :15672 | Flower :5555 | MinIO :9001 | Grafana :3000 | API :8000/docs

---

## 7\. Giai đoạn 2 — Mở rộng lên Kubernetes

**Nguyên tắc:** worker là **stateless** → Deployment \+ autoscale; DB/Qdrant là **stateful** → StatefulSet (hoặc dịch vụ managed); scheduler → CronJob.

### 7.1 Deployment cho worker

apiVersion: apps/v1

kind: Deployment

metadata: {name: worker-embed}

spec:

replicas: 1

selector: {matchLabels: {app: worker-embed}}

template:

    metadata: {labels: {app: worker-embed}}

    spec:

      containers:

        \- name: worker

          image: registry/gymkb-worker:latest

          command: \["celery","-A","celery\_app","worker","-Q","embed","-c","1"\]

          envFrom: \[{secretRef: {name: gymkb-secrets}}\]

          resources:

            requests: {cpu: "250m", memory: "512Mi"}

            limits:   {cpu: "1",    memory: "1Gi"}

### 7.2 KEDA — autoscale theo độ dài hàng đợi (điểm nhấn kỹ thuật)

**KEDA** cho phép **scale-to-zero**: lúc rảnh 0 worker (tiết kiệm tối đa), khi hàng đợi dồn việc thì tự bung thêm.

apiVersion: keda.sh/v1alpha1

kind: ScaledObject

metadata: {name: embed-worker-scaler}

spec:

scaleTargetRef: {name: worker-embed}

minReplicaCount: 0 \# rảnh \-\> 0 pod

maxReplicaCount: 10

triggers:

    \- type: rabbitmq

      metadata:

        protocol: amqp

        queueName: embed

        mode: QueueLength

        value: "20"           \# \> 20 msg/replica thì scale thêm

        hostFromEnv: RABBITMQ\_URL

### 7.3 CronJob thay Celery Beat

apiVersion: batch/v1

kind: CronJob

metadata: {name: daily-crawl}

spec:

schedule: "0 2 \* \* \*" \# 02:00 hằng ngày

jobTemplate:

    spec:

      template:

        spec:

          restartPolicy: OnFailure

          containers:

            \- name: kickoff

              image: registry/gymkb-worker:latest

              command: \["python","-c","from tasks import kickoff\_crawl; kickoff\_crawl()"\]

              envFrom: \[{secretRef: {name: gymkb-secrets}}\]

### 7.4 Stateful & vận hành

- **Qdrant / PostgreSQL**: StatefulSet \+ PersistentVolumeClaim (hoặc dùng managed Postgres \+ Qdrant Cloud free tier để bớt vận hành).
- **Ingress** (NGINX/Traefik) cho RAG API; **ConfigMap/Secret** cho cấu hình; **HPA** cho API theo CPU.
- **Helm chart** đóng gói toàn bộ (đẹp cho khoá luận).
- **Cụm rẻ:** k3s/minikube để demo; hoặc 1 node managed K8s.

---

## 8\. Đo hiệu năng pipeline & chất lượng RAG

### 8.1 Metric pipeline (Prometheus)

from prometheus_client import Counter, Histogram, Gauge

docs_crawled \= Counter("kb_docs_crawled_total", "Docs crawled", \["source"\])

docs_accepted \= Counter("kb_docs_accepted_total", "Docs accepted")

docs_rejected \= Counter("kb_docs_rejected_total", "Docs rejected", \["reason"\])

stage_latency \= Histogram("kb_stage_latency_seconds","Stage latency",\["stage"\])

queue_depth \= Gauge("kb_queue_depth", "Queue depth", \["queue"\])

rag_latency \= Histogram("kb_rag_latency_seconds", "RAG end-to-end latency")

**Chỉ số theo dõi:** throughput (docs/giờ), latency từng tầng (p50/p95), độ sâu hàng đợi, **tỉ lệ chấp nhận** (accepted / crawled), tỉ lệ lỗi, latency RAG (p50/p95/p99).

### 8.2 Chất lượng RAG (định lượng — phần "ăn điểm" khoá luận)

- **Truy xuất:** Hit Rate@K, **MRR**, **nDCG** (cần một bộ câu hỏi–đáp tham chiếu nhỏ, tự gắn nhãn).
- **Sinh câu trả lời:** dùng **RAGAS** → `faithfulness` (bám nguồn, chống bịa), `answer_relevancy`, `context_precision/recall`.
- **An toàn:** % câu trả lời gắn cảnh báo y tế đúng lúc; % nội dung nguy hiểm bị chặn.
- **Thí nghiệm so sánh:** **có** vs **không** auto-update → chứng minh tri thức mới giúp trả lời tốt hơn (đây là luận điểm trung tâm của đề tài).

### 8.3 Dashboard

Grafana cho metric hệ thống; thêm **Streamlit** một trang cho khía cạnh "tri thức": số tài liệu theo trạng thái, theo nguồn/tier, top chủ đề, lần chạy gần nhất, hàng chờ review. Rất dễ demo.

---

## 9\. Chi phí (tối ưu thấp nhất)

| Hạng mục         | Lựa chọn rẻ nhất                                    | Chi phí                  |
| :--------------- | :-------------------------------------------------- | :----------------------- |
| Hạ tầng          | **Oracle Cloud Always Free** (4 ARM core, 24GB RAM) | **0đ**                   |
| (hoặc) VPS       | Hetzner CPX31/CX41                                  | \~€13–17/tháng           |
| Vector DB        | Qdrant self-host                                    | 0đ                       |
| Metadata DB      | PostgreSQL self-host                                | 0đ                       |
| Broker           | RabbitMQ self-host                                  | 0đ                       |
| Object storage   | MinIO self-host                                     | 0đ                       |
| Cache            | Redis self-host                                     | 0đ                       |
| Embedding        | BGE‑M3 chạy local                                   | 0đ (chỉ tốn compute)     |
| Reranker         | bge-reranker-v2-m3 local                            | 0đ                       |
| LLM              | Gemini Flash / GPT‑4o‑mini / DeepSeek               | vài USD/tháng (mức demo) |
| (hoặc) LLM local | Qwen2.5 qua Ollama                                  | 0đ                       |
| Monitoring       | Prometheus \+ Grafana \+ Flower                     | 0đ                       |
| Dữ liệu          | PubMed E-utilities, RSS, `.gov/.edu`                | 0đ                       |
| **TỔNG**         |                                                     | **\~0–40 USD/tháng**     |

**Mẹo tiết kiệm thêm:** GitHub Student Pack, credit miễn phí của các cloud, Qdrant Cloud free tier (1GB). Toàn stack chạy gọn trên **một** máy ở giai đoạn 1\.

---

## 10\. Lộ trình triển khai (gợi ý 8–10 tuần)

1. **Tuần 1–2:** Dựng Docker Compose (Postgres, Qdrant, RabbitMQ, MinIO, Redis). Schema DB. Crawl 1 nguồn (PubMed) → lưu MinIO.
2. **Tuần 3:** Processing (clean \+ dedup \+ phân loại \+ trust score). Cổng quyết định.
3. **Tuần 4:** Embedding (BGE‑M3) \+ upsert Qdrant. RAG API `/ask` cơ bản.
4. **Tuần 5:** Rerank \+ prompt RAG \+ trích dẫn \+ LLM-judge an toàn. Celery Beat định kỳ.
5. **Tuần 6:** Prometheus/Grafana \+ Streamlit dashboard. Flower.
6. **Tuần 7:** Bộ câu hỏi đánh giá \+ RAGAS \+ so sánh có/không auto-update.
7. **Tuần 8:** Helm \+ k3s \+ KEDA \+ CronJob (giai đoạn 2). Viết báo cáo \+ demo.

---

## 11\. Trình bày thành khoá luận ngành Hệ thống thông tin

### 11.1 Tên đề tài (gợi ý)

**"Xây dựng hệ thống cập nhật tri thức tự động dựa trên RAG và kiến trúc microservices cho ứng dụng trợ lý AI hỗ trợ tập luyện thể hình"** _(Automated Knowledge-Update Pipeline using RAG and Microservices for an AI Gym Assistant)_

### 11.2 Cấu trúc các chương

- **Chương 1 — Mở đầu:** bối cảnh (tri thức fitness/sức khỏe thay đổi liên tục → RAG bị lỗi thời), vấn đề, mục tiêu, phạm vi, đóng góp, cấu trúc luận văn.
- **Chương 2 — Cơ sở lý thuyết & công nghệ:** LLM, embedding, **RAG**, vector database, microservices, message queue, container & orchestration, MLOps/LLMOps; khảo sát công trình liên quan.
- **Chương 3 — Phân tích & đặc tả yêu cầu:** yêu cầu chức năng/phi chức năng, sơ đồ use case, actor, kịch bản, ràng buộc (an toàn nội dung, chi phí).
- **Chương 4 — Thiết kế hệ thống:** kiến trúc tổng thể, thiết kế service, **CSDL** (mục 3), **vector DB** (mục 4), luồng dữ liệu (mục 2), cơ chế **kiểm soát chất lượng/an toàn** (mục 5), thiết kế triển khai (Docker → K8s).
- **Chương 5 — Hiện thực:** công nghệ, cấu hình, code chính, pipeline, RAG, dashboard, CI/CD.
- **Chương 6 — Thử nghiệm & đánh giá:** môi trường, dữ liệu thử, **đo hiệu năng pipeline** (mục 8.1) \+ **chất lượng RAG** (mục 8.2), so sánh có/không auto-update, phân tích chi phí.
- **Chương 7 — Kết luận & hướng phát triển:** kết quả, hạn chế, mở rộng.

### 11.3 Điểm nhấn để bảo vệ (đóng góp)

1. **Pipeline tự động hoá end‑to‑end** đúng tinh thần "tự học" ở tầng tri thức (không cần admin nhập tay).
2. **Kiến trúc microservices \+ message queue \+ container orchestration** (Docker → K8s \+ KEDA scale-to-zero).
3. **RAG \+ vector DB \+ hybrid search \+ rerank.**
4. **Cơ chế kiểm soát chất lượng & an toàn tri thức** (trust tier, LLM-judge, provenance/trích dẫn) — đóng góp học thuật rõ.
5. **Đánh giá định lượng** cả pipeline lẫn chất lượng trả lời (LLMOps).
6. **Khả thi, chi phí thấp, demo được.**

### 11.4 Kịch bản demo "ăn điểm"

Chạy Scheduler kích hoạt pipeline → mở dashboard xem **tài liệu mới được chấp nhận/loại** theo thời gian thực → hỏi AI một câu mà câu trả lời **phụ thuộc vào tài liệu vừa nạp** → AI trả lời đúng và **trích dẫn chính nguồn mới đó**. Đây là minh chứng trực quan cho "AI tự cập nhật tri thức".

---

## 12\. Mở rộng tương lai (ngoài phạm vi bắt buộc)

1. **Cá nhân hoá**: kết hợp hồ sơ người dùng (mục tiêu, chấn thương, lịch tập) vào truy xuất.
2. **Continual fine-tuning** (nếu cần "tự học" sâu): định kỳ LoRA fine-tune trên dữ liệu đã kiểm duyệt — **đắt, rủi ro**, chỉ làm khi RAG không đủ.
3. **Multimodal**: nhận diện tư thế tập từ video/ảnh.
4. **Knowledge graph**: liên kết khái niệm (bài tập ↔ nhóm cơ ↔ chấn thương) để suy luận tốt hơn.
5. **A/B testing** chiến lược truy xuất; **feedback loop** từ đánh giá người dùng.

---

### Phụ lục — Quy tắc an toàn nội dung sức khỏe (bắt buộc)

- Luôn **trích dẫn nguồn**; không bịa khi thiếu dữ liệu.
- Với chấn thương/bệnh lý nghiêm trọng → khuyên gặp **chuyên gia y tế**.
- Chặn mọi nội dung khuyến khích **nhịn ăn cực đoan, liều supplement nguy hiểm, giảm cân cấp tốc**.
- Không tư vấn liều thuốc kê đơn; chỉ cung cấp thông tin tổng quát, có nguồn.
