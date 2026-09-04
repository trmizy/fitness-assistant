# Bộ prompt Codex — AI Gym Assistant Knowledge Pipeline

> Prompt and research archive. These prompts are not runtime configuration and
> may refer to earlier architecture decisions.

> Dán từng prompt theo thứ tự vào Claude Code / Codex CLI / Cursor Agent.
> Mỗi prompt là một session độc lập. KHÔNG bỏ qua bước nào.

---

## Trước khi bắt đầu — tạo file CLAUDE.md (1 lần duy nhất)

Tạo file `CLAUDE.md` ở root repo, dán nội dung sau. Claude Code tự đọc file này mỗi lần.

```markdown
# Project: AI Gym Assistant — Knowledge Update Pipeline

## Stack

- Python 3.11, FastAPI 0.111, Celery 5.4, SQLAlchemy 2.0 (async), asyncpg
- RabbitMQ 3 (broker), Redis 7 (result backend + cache)
- Qdrant (vector DB, hybrid dense+sparse), PostgreSQL 16
- MinIO (S3-compatible object storage)
- FlagEmbedding: BAAI/bge-m3 (embedder), BAAI/bge-reranker-v2-m3 (reranker)
- OpenAI-compatible LLM client (supports DeepSeek / Gemini / GPT-4o-mini / Ollama)
- Prometheus + Grafana + Flower (monitoring)
- Streamlit (pipeline dashboard)

## Project layout

src/
config.py # Settings (pydantic-settings)
models/ # db_models.py (SQLAlchemy), pydantic_models.py
infra/ # database.py, minio_client.py, qdrant_setup.py, redis_client.py
pipeline/
celery_app.py
tasks/ # crawl.py, process.py, embed.py
scheduler.py
rag/ # embedder.py, searcher.py, reranker.py, prompts.py
api/
main.py
routers/ # ask.py, health.py, pipeline_status.py
monitoring/ # metrics.py, dashboard.py
db/init.sql
scripts/ # seed_sources.py, init_qdrant.py
tests/ # conftest.py, test_pipeline.py, test_rag.py
monitoring/ # prometheus.yml, grafana/
docker-compose.yml
requirements/ # base.txt, worker.txt, api.txt, dev.txt

## Key rules

- All DB access via SQLAlchemy async (AsyncSession)
- All tasks are Celery tasks; no direct function calls between pipeline stages
- Every chunk stored in Qdrant MUST have payload: document_id, chunk_id, text,
  source_name, source_url, source_tier, trust_score, topic, language, published_at
- RAG answers MUST include source citations; never fabricate
- Use TRUST_THRESHOLD=0.6 (accept), 0.4 (review), below 0.4 (reject)
- Load BGE-M3 and reranker as module-level singletons (not per-task)
```

---

## P01 — Project scaffold, Docker Compose, requirements, Makefiles

```
You are setting up a new Python project. Create the complete project scaffold
for an AI Gym Assistant knowledge-update pipeline.

Create exactly these files (do not add extras):

1. .env.example  — all env vars with placeholder values:
   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB=gymkb, POSTGRES_HOST=postgres, POSTGRES_PORT=5432
   RABBITMQ_USER, RABBITMQ_PASSWORD, RABBITMQ_HOST=rabbitmq, RABBITMQ_PORT=5672
   REDIS_HOST=redis, REDIS_PORT=6379
   MINIO_HOST=minio, MINIO_PORT=9000, MINIO_USER, MINIO_PASSWORD, MINIO_BUCKET=gym-raw-docs
   QDRANT_HOST=qdrant, QDRANT_PORT=6333, QDRANT_COLLECTION=fitness_knowledge
   LLM_API_KEY=your_key_here
   LLM_BASE_URL=https://api.openai.com/v1
   LLM_MODEL=gpt-4o-mini
   LLM_SAFETY_MODEL=gpt-4o-mini
   TRUST_THRESHOLD_ACCEPT=0.6
   TRUST_THRESHOLD_REVIEW=0.4
   CRAWL_SCHEDULE_HOUR=2

2. docker-compose.yml — services:
   postgres (postgres:16, volume pg_data, env from .env, port 5432)
   qdrant (qdrant/qdrant:latest, volume qdrant_data, port 6333)
   rabbitmq (rabbitmq:3-management, env from .env, ports 5672 and 15672)
   redis (redis:7-alpine, port 6379)
   minio (minio/minio:latest, command "server /data --console-address :9001",
          env from .env, ports 9000 and 9001, volume minio_data)
   api (build ./dockerfiles/api.Dockerfile, env_file .env,
        depends_on postgres qdrant redis, port 8000,
        volumes ["./src:/app/src"])
   worker-crawl (build ./dockerfiles/worker.Dockerfile, env_file .env,
                 command "celery -A src.pipeline.celery_app worker -Q crawl -c 2 -n crawl@%%h --loglevel=info",
                 depends_on rabbitmq postgres minio redis)
   worker-process (same Dockerfile, queue "process", concurrency 2)
   worker-embed (same Dockerfile, queue "embed", concurrency 1)
   beat (same Dockerfile, command "celery -A src.pipeline.celery_app beat --loglevel=info")
   flower (same Dockerfile, command "celery -A src.pipeline.celery_app flower --port=5555",
           port 5555, depends_on rabbitmq)
   prometheus (prom/prometheus:latest, volume ./monitoring/prometheus.yml, port 9090)
   grafana (grafana/grafana:latest, port 3000, volume grafana_data)
   All services on network "gymkb-net". All volumes declared at bottom.

3. dockerfiles/api.Dockerfile:
   FROM python:3.11-slim
   WORKDIR /app
   COPY requirements/base.txt requirements/api.txt ./requirements/
   RUN pip install --no-cache-dir -r requirements/base.txt -r requirements/api.txt
   COPY . .
   CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

4. dockerfiles/worker.Dockerfile:
   FROM python:3.11-slim
   WORKDIR /app
   RUN apt-get update && apt-get install -y gcc && rm -rf /var/lib/apt/lists/*
   COPY requirements/base.txt requirements/worker.txt ./requirements/
   RUN pip install --no-cache-dir -r requirements/base.txt -r requirements/worker.txt
   COPY . .

5. requirements/base.txt:
   sqlalchemy[asyncio]==2.0.30
   asyncpg==0.29.0
   pydantic-settings==2.3.4
   pydantic==2.7.4
   httpx==0.27.0
   redis==5.0.7
   minio==7.2.7
   python-dotenv==1.0.1
   prometheus-client==0.20.0
   structlog==24.2.0

6. requirements/worker.txt:
   celery[rabbitmq]==5.4.0
   trafilatura==1.9.0
   feedparser==6.0.11
   langdetect==1.0.9
   datasketch==1.6.5
   tiktoken==0.7.0
   FlagEmbedding==1.2.11
   openai==1.35.13

7. requirements/api.txt:
   fastapi==0.111.0
   uvicorn[standard]==0.30.1
   FlagEmbedding==1.2.11
   openai==1.35.13

8. requirements/dev.txt:
   pytest==8.2.2
   pytest-asyncio==0.23.7
   ragas==0.1.14
   streamlit==1.36.0
   httpx==0.27.0

9. Makefile with targets:
   up: docker compose up -d --build
   down: docker compose down
   logs: docker compose logs -f
   shell-api: docker compose exec api bash
   shell-worker: docker compose exec worker-crawl bash
   db-init: docker compose exec postgres psql -U $$POSTGRES_USER -d $$POSTGRES_DB -f /docker-entrypoint-initdb.d/init.sql
   test: docker compose exec api pytest tests/ -v

10. monitoring/prometheus.yml:
    global: {scrape_interval: 15s}
    scrape_configs:
      - job_name: gymkb-api, static_configs: [{targets: [api:8000]}]
      - job_name: gymkb-flower, static_configs: [{targets: [flower:5555]}]

11. Empty __init__.py files for all Python packages:
    src/__init__.py
    src/models/__init__.py
    src/infra/__init__.py
    src/pipeline/__init__.py
    src/pipeline/tasks/__init__.py
    src/rag/__init__.py
    src/api/__init__.py
    src/api/routers/__init__.py
    src/monitoring/__init__.py
    scripts/__init__.py
    tests/__init__.py

After creating all files, run: docker compose config --quiet
It must exit 0 with no errors.
```

---

## P02 — Database schema + Settings

```
Project: AI Gym Assistant. Read CLAUDE.md first.
Existing files: docker-compose.yml, .env.example, requirements/

Create two files:

--- FILE 1: db/init.sql ---
Full PostgreSQL schema with these tables (use exactly these definitions):

CREATE TABLE sources (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    base_url        TEXT NOT NULL UNIQUE,
    source_type     TEXT NOT NULL CHECK (source_type IN ('rss','api','web')),
    trust_tier      SMALLINT NOT NULL DEFAULT 3 CHECK (trust_tier BETWEEN 1 AND 3),
    crawl_cron      TEXT DEFAULT '0 2 * * *',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_crawled_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE documents (
    id               BIGSERIAL PRIMARY KEY,
    source_id        BIGINT REFERENCES sources(id),
    url              TEXT NOT NULL,
    title            TEXT,
    author           TEXT,
    language         TEXT,
    content_hash     CHAR(64) NOT NULL UNIQUE,
    raw_object_key   TEXT,
    clean_text       TEXT,
    topic            TEXT CHECK (topic IN ('training','nutrition','recovery','injury','general')),
    trust_score      NUMERIC(4,3) CHECK (trust_score BETWEEN 0 AND 1),
    quality_score    NUMERIC(4,3) CHECK (trust_score BETWEEN 0 AND 1),
    safety_flag      BOOLEAN DEFAULT FALSE,
    status           TEXT NOT NULL DEFAULT 'crawled'
                     CHECK (status IN ('crawled','cleaned','scored','embedded','rejected','review')),
    rejection_reason TEXT,
    published_at     TIMESTAMPTZ,
    crawled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at     TIMESTAMPTZ
);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_topic  ON documents(topic);
CREATE INDEX idx_documents_source ON documents(source_id);
CREATE INDEX idx_documents_hash   ON documents(content_hash);

CREATE TABLE chunks (
    id            BIGSERIAL PRIMARY KEY,
    document_id   BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index   INT NOT NULL,
    text          TEXT NOT NULL,
    token_count   INT,
    vector_id     UUID NOT NULL,
    embedded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id, chunk_index)
);

CREATE TABLE pipeline_runs (
    id             BIGSERIAL PRIMARY KEY,
    run_type       TEXT NOT NULL DEFAULT 'scheduled_daily',
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at    TIMESTAMPTZ,
    docs_crawled   INT DEFAULT 0,
    docs_accepted  INT DEFAULT 0,
    docs_rejected  INT DEFAULT 0,
    docs_review    INT DEFAULT 0,
    status         TEXT DEFAULT 'running' CHECK (status IN ('running','success','failed'))
);

CREATE TABLE review_queue (
    id           BIGSERIAL PRIMARY KEY,
    document_id  BIGINT NOT NULL REFERENCES documents(id),
    reason       TEXT,
    status       TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    reviewed_by  TEXT,
    reviewed_at  TIMESTAMPTZ
);

CREATE TABLE query_logs (
    id              BIGSERIAL PRIMARY KEY,
    user_query      TEXT NOT NULL,
    retrieved_doc_ids BIGINT[],
    answer          TEXT,
    faithfulness    NUMERIC(4,3),
    latency_ms      INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

Also add: INSERT INTO sources (name, base_url, source_type, trust_tier) VALUES
('PubMed Central', 'https://eutils.ncbi.nlm.nih.gov', 'api', 1),
('WHO Nutrition', 'https://www.who.int/nutrition', 'web', 1),
('ACSM', 'https://www.acsm.org/education-resources/trending-topics-resources', 'web', 2),
('NSCA Blog', 'https://www.nsca.com/articles/feed', 'rss', 2),
('Examine.com', 'https://examine.com/feed/', 'rss', 2);

--- FILE 2: src/config.py ---
Use pydantic-settings BaseSettings. Class name: Settings.
Fields (all from env vars with these names):
  Database: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_HOST, POSTGRES_PORT (int=5432)
  Broker:   RABBITMQ_USER, RABBITMQ_PASSWORD, RABBITMQ_HOST, RABBITMQ_PORT (int=5672)
  Cache:    REDIS_HOST, REDIS_PORT (int=6379)
  MinIO:    MINIO_HOST, MINIO_PORT (int=9000), MINIO_USER, MINIO_PASSWORD, MINIO_BUCKET
  Qdrant:   QDRANT_HOST, QDRANT_PORT (int=6333), QDRANT_COLLECTION (default="fitness_knowledge")
  LLM:      LLM_API_KEY, LLM_BASE_URL, LLM_MODEL (default="gpt-4o-mini"),
            LLM_SAFETY_MODEL (default="gpt-4o-mini")
  Pipeline: TRUST_THRESHOLD_ACCEPT (float=0.6), TRUST_THRESHOLD_REVIEW (float=0.4),
            CRAWL_SCHEDULE_HOUR (int=2)

Add computed properties (using @property):
  database_url -> f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{db}"
  broker_url   -> f"amqp://{user}:{password}@{host}:{port}//"
  result_backend -> f"redis://{redis_host}:{redis_port}/0"
  redis_url    -> f"redis://{redis_host}:{redis_port}/0"

Add at module bottom: settings = Settings()

Verify by running: python -c "from src.config import settings; print(settings.database_url)"
(Will fail on missing env vars — that is expected. The import must succeed without error.)
```

---

## P03 — SQLAlchemy models + Pydantic schemas

```
Project: AI Gym Assistant. Read CLAUDE.md first.
Existing: src/config.py, db/init.sql

--- FILE 1: src/models/db_models.py ---
SQLAlchemy 2.0 ORM models (DeclarativeBase, mapped_column, Mapped).
Map ALL tables from db/init.sql exactly.
Use these class names: Source, Document, Chunk, PipelineRun, ReviewQueue, QueryLog.
Use SQLAlchemy types: BigInteger, String, Text, SmallInteger, Boolean, Numeric,
                      DateTime(timezone=True), ARRAY(BigInteger) for retrieved_doc_ids.
For UUID column (vector_id in Chunk): from sqlalchemy.dialects.postgresql import UUID; use as_uuid=True.
Add __tablename__ = "sources" / "documents" etc.
Do NOT use relationship() — keep models simple.
Add repr methods showing id and key field.

--- FILE 2: src/models/pydantic_models.py ---
Pydantic v2 BaseModel schemas:

SourceRead(BaseModel): id, name, base_url, source_type, trust_tier, is_active, last_crawled_at
DocumentRead(BaseModel): id, source_id, url, title, topic, trust_score, status, crawled_at
DocumentCreate(BaseModel): source_id, url, title, author, language, content_hash,
                           raw_object_key, published_at  (all optional except source_id, url, content_hash)
ChunkCreate(BaseModel): document_id, chunk_index, text, token_count, vector_id (UUID)
PipelineRunRead(BaseModel): id, run_type, started_at, finished_at, docs_crawled,
                            docs_accepted, docs_rejected, docs_review, status
AskRequest(BaseModel): question (str, min_length=3, max_length=500),
                       topic_filter (optional str), language (str="vi")
AskResponse(BaseModel): answer (str), sources (list[SourceCitation]),
                        latency_ms (int), retrieved_count (int)
SourceCitation(BaseModel): title (str), url (str), source_name (str), trust_score (float)

All models: model_config = ConfigDict(from_attributes=True)

Verify: python -c "from src.models.db_models import Source, Document; from src.models.pydantic_models import AskRequest; print('OK')"
```

---

## P04 — Infrastructure clients

```
Project: AI Gym Assistant. Read CLAUDE.md first.
Existing: src/config.py, src/models/db_models.py

Create four files:

--- FILE 1: src/infra/database.py ---
- Create async SQLAlchemy engine using settings.database_url
- engine = create_async_engine(url, pool_size=10, max_overflow=20, echo=False)
- AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)
- async context manager: get_session() -> AsyncGenerator[AsyncSession, None]
  (yields session, always closes, rolls back on exception)
- async function: create_tables() — runs db/init.sql via text() if tables don't exist.
  Read the SQL file from Path(__file__).parent.parent.parent / "db" / "init.sql"
  Use conn.execute(text(sql)) inside async with engine.begin() as conn.
  Ignore errors if tables already exist (use try/except).

--- FILE 2: src/infra/minio_client.py ---
- Use minio.Minio client (sync, Celery workers are sync).
- Module-level singleton: _client: Minio = None
- get_client() -> Minio: lazy init using settings, ensure bucket exists.
- upload_raw(content: bytes, object_key: str) -> str:
  Uploads bytes to settings.MINIO_BUCKET, returns object_key.
  Content type "application/octet-stream".
- download_raw(object_key: str) -> bytes:
  Returns content as bytes.
- Wrap all methods in try/except, raise RuntimeError with context on failure.

--- FILE 3: src/infra/qdrant_setup.py ---
- Use qdrant_client.QdrantClient (sync).
- Module-level singleton: _client: QdrantClient = None
- get_client() -> QdrantClient: lazy init to settings.QDRANT_HOST:QDRANT_PORT.
- init_collection() — idempotent:
  Creates collection "fitness_knowledge" with:
    vectors_config = {"dense": VectorParams(size=1024, distance=Distance.COSINE)}
    sparse_vectors_config = {"sparse": SparseVectorParams(modifier=Modifier.IDF)}
  If collection already exists, skip (catch exception or check .get_collection).
  After creating, create payload indexes for: topic (KEYWORD), trust_score (FLOAT),
  source_tier (INTEGER), published_at (DATETIME), language (KEYWORD).
- Import: QdrantClient, models (VectorParams, SparseVectorParams, Distance, Modifier,
  PayloadSchemaType from qdrant_client.models)

--- FILE 4: src/infra/redis_client.py ---
- Use redis.Redis (sync, for Celery workers).
- Module-level: get_client() -> redis.Redis (lazy singleton, decode_responses=True).
- hash_exists(content_hash: str) -> bool:
  Checks Redis set "crawled_hashes" for membership.
- add_hash(content_hash: str) -> None:
  Adds to "crawled_hashes" set with no expiry.
- Note: this is a fast in-memory dedup cache. DB content_hash UNIQUE is the source of truth.

After all files, verify:
python -c "
from src.infra.database import get_session
from src.infra.minio_client import get_client as get_minio
from src.infra.qdrant_setup import get_client as get_qdrant
from src.infra.redis_client import get_client as get_redis
print('All imports OK')
"
```

---

## P05 — Celery app + task stubs

```
Project: AI Gym Assistant. Read CLAUDE.md first.
Existing: src/config.py, src/models/, src/infra/

--- FILE 1: src/pipeline/celery_app.py ---
from celery import Celery
from src.config import settings

app = Celery("gymkb")
app.config_from_object({
    "broker_url": settings.broker_url,
    "result_backend": settings.result_backend,
    "task_serializer": "json",
    "result_serializer": "json",
    "accept_content": ["json"],
    "timezone": "Asia/Ho_Chi_Minh",
    "task_routes": {
        "src.pipeline.tasks.crawl.*": {"queue": "crawl"},
        "src.pipeline.tasks.process.*": {"queue": "process"},
        "src.pipeline.tasks.embed.*": {"queue": "embed"},
    },
    "task_acks_late": True,
    "worker_prefetch_multiplier": 1,
})
# autodiscover tasks
app.autodiscover_tasks(["src.pipeline.tasks"])

--- FILE 2: src/pipeline/tasks/crawl.py ---
from src.pipeline.celery_app import app
import structlog
logger = structlog.get_logger()

@app.task(name="src.pipeline.tasks.crawl.kickoff_crawl", bind=True, max_retries=3)
def kickoff_crawl(self):
    """Triggered by Beat scheduler. Queries all active sources and dispatches crawl tasks."""
    raise NotImplementedError("Implement in P09")

@app.task(name="src.pipeline.tasks.crawl.crawl_source", bind=True, max_retries=3)
def crawl_source(self, source_id: int):
    """Fetch content from one source. Dispatches process_document for each new doc."""
    raise NotImplementedError("Implement in P06")

--- FILE 3: src/pipeline/tasks/process.py ---
from src.pipeline.celery_app import app
import structlog
logger = structlog.get_logger()

@app.task(name="src.pipeline.tasks.process.process_document", bind=True, max_retries=2)
def process_document(self, document_id: int):
    """Clean, dedup, classify, score, safety-check one document."""
    raise NotImplementedError("Implement in P07")

--- FILE 4: src/pipeline/tasks/embed.py ---
from src.pipeline.celery_app import app
import structlog
logger = structlog.get_logger()

@app.task(name="src.pipeline.tasks.embed.embed_document", bind=True, max_retries=2)
def embed_document(self, document_id: int):
    """Chunk text, generate BGE-M3 embeddings, upsert to Qdrant."""
    raise NotImplementedError("Implement in P08")

Verify:
python -c "from src.pipeline.celery_app import app; print(app.conf.broker_url)"
```

---

## P06 — Implement crawl_source task

```
Project: AI Gym Assistant. Read CLAUDE.md first.
Existing: src/pipeline/tasks/crawl.py (stubs), src/infra/, src/models/db_models.py, src/config.py
Read these files completely before writing: src/pipeline/tasks/crawl.py, src/infra/minio_client.py, src/infra/redis_client.py

Replace the stub implementations in src/pipeline/tasks/crawl.py with full implementations.
Keep the exact @app.task decorators and function signatures.

=== kickoff_crawl ===
1. Import asyncio; use asyncio.run() to call an async helper that:
   - Opens DB session (get_session from infra.database)
   - Creates PipelineRun(status='running', run_type='scheduled_daily'), commits, saves run_id
   - Queries: SELECT * FROM sources WHERE is_active = True
   - For each source: dispatch crawl_source.delay(source.id)
   - Logs: f"Pipeline run {run_id} started, dispatched {n} sources"
2. On any exception: log error, re-raise (Celery will retry).

=== crawl_source ===
Input: source_id (int)
1. Load Source from DB. If not found, log warning and return.
2. Branch on source.source_type:

   === "api" (PubMed) ===
   - Search URL: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi
     params: db=pubmed, term="exercise fitness nutrition muscle recovery",
             retmax=50, retmode=json, datetype=pdat, reldate=90
   - Use httpx.get() with timeout=30, follow_redirects=True
   - Parse JSON -> ids = data["esearchresult"]["idlist"]
   - For each pmid, fetch:
     https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id={pmid}&retmode=xml&rettype=abstract
   - Extract: title from <ArticleTitle>, abstract from <AbstractText>,
     published_at from <PubDate> (Year+Month), author from first <LastName>
   - Combine: content = f"{title}\n\n{abstract}"

   === "rss" ===
   - Use feedparser.parse(source.base_url)
   - For each entry: content = entry.get("summary","") or entry.get("content","")
     title = entry.get("title",""), url = entry.get("link","")
     published_at = entry.get("published_parsed") -> datetime if available

   === "web" ===
   - httpx.get(source.base_url, timeout=30, headers={"User-Agent":"GymKB-Bot/1.0"})
   - Check robots.txt: httpx.get(urljoin(base_url, "/robots.txt"))
     If "Disallow: /" found for our bot, skip and log warning.
   - trafilatura.extract(response.text) -> clean_text
   - title = source.name, content = clean_text

3. For each fetched item:
   - Skip if content is None or len(content) < 200
   - content_hash = hashlib.sha256(content.encode()).hexdigest()
   - Check Redis set "crawled_hashes": if exists -> skip (already processed)
   - Check DB: SELECT id FROM documents WHERE content_hash = hash -> if exists -> skip
   - Detect language: langdetect.detect(content[:500]) -> language str; default "en" on error
   - Upload raw content to MinIO: key = f"raw/{source_id}/{content_hash[:8]}.txt"
   - INSERT Document(source_id, url, title, content_hash, raw_object_key=key,
                     status='crawled', language, published_at)
   - Add hash to Redis
   - Dispatch: process_document.delay(doc.id)
   - Log: f"Crawled doc {doc.id} from {source.name}"

4. Rate limiting: time.sleep(1) between requests (respect API limits).
5. Update sources.last_crawled_at = now() after finishing.
6. Wrap entire source processing in try/except: log error, continue (don't crash task).
7. Use synchronous DB access with asyncio.run() wrapping async helpers.
   Create a helper module src/pipeline/db_sync.py with sync wrappers:
   - sync_get_session() using asyncio.run on async_sessionmaker
   Actually: use sqlalchemy sync engine (not async) inside Celery tasks.
   Create a SEPARATE sync engine in src/infra/database.py:
     sync_engine = create_engine(settings.database_url.replace("+asyncpg",""), pool_size=5)
     SyncSession = sessionmaker(sync_engine)
   Use SyncSession() context manager in all Celery tasks.

After implementation, verify task can be imported:
python -c "from src.pipeline.tasks.crawl import crawl_source; print('crawl_source:', crawl_source.name)"
```

---

## P07 — Implement process_document task

```
Project: AI Gym Assistant. Read CLAUDE.md first.
Existing: src/pipeline/tasks/process.py (stub), src/infra/, src/config.py, src/models/db_models.py
Read completely: src/pipeline/tasks/process.py, src/infra/database.py, src/config.py

Replace stub in src/pipeline/tasks/process.py with full implementation.

=== process_document(self, document_id: int) ===

Step 1 — Load document
- Open SyncSession, load Document by id. If not found or status != 'crawled': return early.
- Load raw text from MinIO (infra.minio_client.download_raw(doc.raw_object_key)).decode()
  If raw_object_key is None, use doc.clean_text if set, else reject with reason "no_content".

Step 2 — Text extraction & quality check
- Run trafilatura.extract(raw_text, include_tables=False, no_fallback=True) -> clean_text
  If None, try trafilatura.extract(raw_text, no_fallback=False) -> clean_text
  If still None, reject(doc, "extraction_failed"), return.
- If len(clean_text.split()) < 100: reject(doc, "too_short"), return.
- Re-detect language: langdetect.detect(clean_text[:500]) -> update doc.language.

Step 3 — Dedup (hash already done in crawl; no semantic dedup here — done in embed stage)
  (No action needed here — content_hash UNIQUE covers exact duplication.)

Step 4 — Topic classification
- Simple keyword-based classification (fast, no LLM needed):
  topics_keywords = {
    "training": ["exercise","workout","rep","set","strength","cardio","resistance","HIIT","squat","deadlift","bench"],
    "nutrition": ["protein","carbohydrate","calorie","diet","macronutrient","supplement","vitamin","meal","fat","fiber"],
    "recovery": ["sleep","rest","recovery","foam roll","stretch","soreness","DOMS","mobility"],
    "injury": ["injury","pain","strain","sprain","tendon","ligament","rehabilitation","physical therapy"],
  }
  text_lower = clean_text.lower()
  scores = {topic: sum(1 for kw in kws if kw in text_lower) for topic, kws in topics_keywords.items()}
  doc.topic = max(scores, key=scores.get) if max(scores.values()) > 0 else "general"

Step 5 — Trust scoring
Create a helper function compute_trust_score(doc: Document, source: Source) -> float:
  base = {1: 0.90, 2: 0.70, 3: 0.40}[source.trust_tier]
  clean = doc.clean_text or ""
  # Positive signals
  if any(w in clean.lower() for w in ["doi:","pubmed","ncbi","j sports","am j","int j","sports med"]): base += 0.05
  if doc.published_at and (datetime.utcnow() - doc.published_at.replace(tzinfo=None)).days < 365*5: base += 0.03
  if doc.author: base += 0.02
  # Negative signals
  cta_words = ["buy now","click here","order now","limited offer","discount","promo code","affiliate"]
  cta_count = sum(clean.lower().count(w) for w in cta_words)
  if cta_count > 3: base -= 0.30
  supplement_promo = ["build muscle fast","lose weight overnight","miracle","guaranteed results",
                      "#1 supplement","as seen on","order today"]
  if any(p in clean.lower() for p in supplement_promo): base -= 0.40
  quality_score = min(1.0, len(clean.split()) / 500)  # longer = more content
  return max(0.0, min(1.0, base)), quality_score

Step 6 — Safety check via LLM
Create helper: llm_safety_check(text: str) -> dict {"safe": bool, "reason": str}
- Take first 2000 chars of clean_text.
- Call OpenAI client (from openai import OpenAI; client=OpenAI(api_key=settings.LLM_API_KEY, base_url=settings.LLM_BASE_URL))
- model = settings.LLM_SAFETY_MODEL, max_tokens=150, temperature=0
- System: "You are a health content safety reviewer. Respond ONLY with valid JSON."
- User prompt:
  """Review this fitness/health content for safety issues.
  Check for: extreme dietary restriction (<1000 cal/day), dangerous supplement dosing,
  claims to cure/treat disease without medical supervision, advice to ignore medical professionals.
  Content: {text[:2000]}
  Respond with ONLY this JSON (no markdown): {"safe": true, "reason": ""}"""
- Parse JSON from response. If parse fails, default to {"safe": True, "reason": "parse_error"}.
- On any API exception: log warning, return {"safe": True, "reason": "api_error"} (fail open).

Step 7 — Decision gate
- source = load Source(doc.source_id)
- trust_score, quality_score = compute_trust_score(doc, source)
- safety = llm_safety_check(clean_text[:2000])
- doc.clean_text = clean_text
- doc.trust_score = trust_score
- doc.quality_score = quality_score
- doc.processed_at = datetime.utcnow()

If not safety["safe"]:
    reject(doc, f"safety:{safety['reason']}")
elif trust_score >= settings.TRUST_THRESHOLD_ACCEPT:
    doc.status = "scored"
    session.commit()
    from src.pipeline.tasks.embed import embed_document
    embed_document.delay(doc.id)
    logger.info("doc_accepted", doc_id=doc.id, trust=trust_score)
elif trust_score >= settings.TRUST_THRESHOLD_REVIEW:
    doc.status = "review"
    # insert into review_queue
    review = ReviewQueue(document_id=doc.id, reason=f"trust_score={trust_score:.2f}")
    session.add(review)
    session.commit()
    logger.info("doc_review", doc_id=doc.id, trust=trust_score)
else:
    reject(doc, f"low_trust:{trust_score:.2f}")

Helper reject(doc, reason):
  doc.status = "rejected"; doc.rejection_reason = reason; session.commit()
  logger.info("doc_rejected", doc_id=doc.id, reason=reason)

Verify:
python -c "from src.pipeline.tasks.process import process_document; print('process_document:', process_document.name)"
```

---

## P08 — Implement embed_document task

```
Project: AI Gym Assistant. Read CLAUDE.md first.
Existing: src/pipeline/tasks/embed.py (stub), src/infra/qdrant_setup.py, src/models/db_models.py
Read completely: src/pipeline/tasks/embed.py, src/infra/qdrant_setup.py

Replace stub in src/pipeline/tasks/embed.py.

=== Module-level singleton for BGE-M3 (loaded ONCE at worker start) ===
Add at top of embed.py (outside any function):
  _embed_model = None
  def get_embed_model():
      global _embed_model
      if _embed_model is None:
          from FlagEmbedding import BGEM3FlagModel
          _embed_model = BGEM3FlagModel("BAAI/bge-m3", use_fp16=True)
          logger.info("BGE-M3 loaded")
      return _embed_model

=== Helper: chunk_text(text: str, chunk_size: int=400, overlap: int=64) -> list[str] ===
- Use tiktoken.get_encoding("cl100k_base") to count tokens.
- Split by double-newline first (respect paragraph boundaries).
- Then merge/split paragraphs to stay within chunk_size tokens.
- Overlap: last `overlap` tokens of previous chunk prepended to next.
- Return list of text strings. Minimum chunk: 50 tokens.
- Each chunk must have context — include first 50 tokens of document if chunk is not the first one.

=== Helper: embed_texts(texts: list[str]) -> tuple[list, list] ===
- model = get_embed_model()
- output = model.encode(texts, batch_size=8, max_length=512,
                        return_dense=True, return_sparse=True, return_colbert_vecs=False)
- dense_vecs = output["dense_vecs"]      # list of numpy arrays shape (1024,)
- sparse_vecs = output["lexical_weights"] # list of dicts {token_id: weight}
- return dense_vecs, sparse_vecs

=== Helper: is_near_duplicate(dense_vec, qdrant_client, threshold=0.97) -> bool ===
- Search Qdrant for top-1 nearest neighbor using dense vector.
- If score >= threshold: return True (near-duplicate).
- Return False otherwise.

=== embed_document(self, document_id: int) ===
1. Load Document from DB. If status != 'scored': return early.
2. text = doc.clean_text. If None or len < 100: reject doc, return.
3. chunks = chunk_text(text)
4. dense_vecs, sparse_vecs = embed_texts(chunks)
5. qclient = get_qdrant_client() (from infra.qdrant_setup)
6. For each (i, chunk_text_i, dense_i, sparse_i):
   - If is_near_duplicate(dense_i, qclient): skip this chunk (log: "near_dup_skipped").
   - vector_id = uuid4()
   - from qdrant_client.models import PointStruct, SparseVector
     point = PointStruct(
       id=str(vector_id),
       vector={
         "dense": dense_i.tolist(),
         "sparse": SparseVector(
           indices=[int(k) for k in sparse_i.keys()],
           values=[float(v) for v in sparse_i.values()]
         )
       },
       payload={
         "document_id": doc.id,
         "chunk_index": i,
         "text": chunk_text_i,
         "source_name": source.name,
         "source_url": doc.url,
         "source_tier": source.trust_tier,
         "trust_score": float(doc.trust_score or 0),
         "topic": doc.topic or "general",
         "language": doc.language or "en",
         "published_at": doc.published_at.isoformat() if doc.published_at else None,
       }
     )
   - qclient.upsert(settings.QDRANT_COLLECTION, points=[point])
   - INSERT Chunk(document_id=doc.id, chunk_index=i, text=chunk_text_i,
                  token_count=count_tokens(chunk_text_i), vector_id=vector_id)
7. doc.status = "embedded"; session.commit()
8. Log: f"Embedded doc {doc.id}: {len(chunks)} chunks"
9. On any exception: log error with stack trace, re-raise (Celery retry).

Add helper count_tokens(text) -> int using tiktoken (same encoding as chunk_text).

Verify:
python -c "from src.pipeline.tasks.embed import embed_document, get_embed_model; print('embed_document:', embed_document.name)"
```

---

## P09 — Scheduler + kickoff + seed sources + Qdrant init scripts

```
Project: AI Gym Assistant. Read CLAUDE.md first.
Existing: all src/pipeline/tasks/, src/infra/, src/config.py

--- FILE 1: src/pipeline/celery_app.py (UPDATE — add beat schedule) ---
Add to the existing app.config_from_object dict:
  "beat_schedule": {
      "daily-crawl": {
          "task": "src.pipeline.tasks.crawl.kickoff_crawl",
          "schedule": crontab(hour=settings.CRAWL_SCHEDULE_HOUR, minute=0),
      }
  }
Import: from celery.schedules import crontab
Do NOT replace existing config, only add beat_schedule to the dict.

--- FILE 2: Replace stub kickoff_crawl in src/pipeline/tasks/crawl.py ---
Full implementation (described in P06 spec, Step: kickoff_crawl).
Use SyncSession (sync engine from infra/database.py).
Logic:
1. Open SyncSession
2. INSERT PipelineRun(status='running', run_type='scheduled_daily') -> get run_id
3. Query: session.execute(select(Source).where(Source.is_active == True))
4. For each source row: crawl_source.delay(source.id)
5. Log info: f"Run {run_id}: dispatched {count} sources"
6. On exception: update PipelineRun.status='failed', commit, re-raise.

--- FILE 3: scripts/seed_sources.py ---
Standalone script (if __name__ == "__main__"):
Inserts the 5 sources from db/init.sql using SyncSession if not already present.
Check by base_url before inserting.
Print result: "Seeded N sources."

--- FILE 4: scripts/init_qdrant.py ---
Standalone script (if __name__ == "__main__"):
Calls src.infra.qdrant_setup.init_collection()
Prints: "Qdrant collection initialized: fitness_knowledge"

--- FILE 5: scripts/run_pipeline_once.py ---
Standalone script for manual trigger / demo:
from src.pipeline.tasks.crawl import kickoff_crawl
result = kickoff_crawl.delay()
print(f"Pipeline kicked off. Task ID: {result.id}")
print("Monitor at http://localhost:5555")

Verify:
python -c "from src.pipeline.celery_app import app; print('beat_schedule' in app.conf.beat_schedule)"
python scripts/init_qdrant.py   # (will fail if Qdrant not running — import must succeed)
```

---

## P10 — RAG components (embedder, searcher, reranker, prompts)

```
Project: AI Gym Assistant. Read CLAUDE.md first.
Existing: src/config.py, src/infra/qdrant_setup.py

Create four files:

--- FILE 1: src/rag/embedder.py ---
Singleton BGE-M3 for the API service (same pattern as embed worker).

_model = None
def get_model():
    global _model
    if _model is None:
        from FlagEmbedding import BGEM3FlagModel
        _model = BGEM3FlagModel("BAAI/bge-m3", use_fp16=True)
    return _model

def embed_query(text: str) -> tuple[list[float], dict]:
    """Returns (dense_vector, sparse_dict) for a query string."""
    model = get_model()
    out = model.encode([text], max_length=512, return_dense=True,
                       return_sparse=True, return_colbert_vecs=False)
    dense = out["dense_vecs"][0].tolist()
    sparse = {int(k): float(v) for k, v in out["lexical_weights"][0].items()}
    return dense, sparse

--- FILE 2: src/rag/searcher.py ---
from qdrant_client.models import (Filter, FieldCondition, Range, MatchValue,
                                   Prefetch, FusionQuery, Fusion, SparseVector)
from src.infra.qdrant_setup import get_client
from src.config import settings

def hybrid_search(
    dense_vec: list[float],
    sparse_vec: dict,
    limit: int = 20,
    topic_filter: str | None = None,
    min_trust: float = 0.6,
    language: str | None = None,
) -> list[dict]:
    """Hybrid dense+sparse search with payload filters. Returns list of chunk payloads."""
    client = get_client()

    must_conditions = [
        FieldCondition(key="trust_score", range=Range(gte=min_trust))
    ]
    if topic_filter:
        must_conditions.append(FieldCondition(key="topic", match=MatchValue(value=topic_filter)))
    if language:
        must_conditions.append(FieldCondition(key="language", match=MatchValue(value=language)))

    flt = Filter(must=must_conditions)

    results = client.query_points(
        collection_name=settings.QDRANT_COLLECTION,
        prefetch=[
            Prefetch(query=dense_vec, using="dense", limit=50, filter=flt),
            Prefetch(
                query=SparseVector(
                    indices=list(sparse_vec.keys()),
                    values=list(sparse_vec.values())
                ),
                using="sparse", limit=50, filter=flt
            ),
        ],
        query=FusionQuery(fusion=Fusion.RRF),
        limit=limit,
        with_payload=True,
    ).points

    return [{"score": p.score, **p.payload} for p in results]

--- FILE 3: src/rag/reranker.py ---
Singleton reranker.

_reranker = None
def get_reranker():
    global _reranker
    if _reranker is None:
        from FlagEmbedding import FlagReranker
        _reranker = FlagReranker("BAAI/bge-reranker-v2-m3", use_fp16=True)
    return _reranker

def rerank(query: str, chunks: list[dict], top_n: int = 5) -> list[dict]:
    """Rerank retrieved chunks. Returns top_n chunks sorted by rerank score."""
    if not chunks:
        return []
    reranker = get_reranker()
    pairs = [[query, c["text"]] for c in chunks]
    scores = reranker.compute_score(pairs, normalize=True)
    if isinstance(scores, float):
        scores = [scores]
    scored = sorted(zip(scores, chunks), key=lambda x: x[0], reverse=True)
    return [c for _, c in scored[:top_n]]

--- FILE 4: src/rag/prompts.py ---
RAG_SYSTEM_PROMPT = """Bạn là trợ lý AI chuyên về thể hình, tập luyện và dinh dưỡng thể thao.
CHỈ sử dụng thông tin trong [CONTEXT] để trả lời. Quy tắc bắt buộc:
1. Luôn trích dẫn nguồn dạng [n] tương ứng với số thứ tự tài liệu trong context.
2. Nếu context không đủ thông tin, trả lời: "Tôi chưa có đủ dữ liệu về vấn đề này."
3. KHÔNG bịa thông tin, KHÔNG suy đoán ngoài context.
4. Với chấn thương hoặc vấn đề y tế nghiêm trọng, luôn khuyên gặp chuyên gia y tế.
5. Trả lời bằng ngôn ngữ của câu hỏi."""

def build_context(chunks: list[dict]) -> tuple[str, list[dict]]:
    """Build numbered context string and source list from reranked chunks."""
    context_parts = []
    sources = []
    for i, chunk in enumerate(chunks, 1):
        context_parts.append(
            f"[{i}] Nguồn: {chunk.get('source_name','?')} | "
            f"Độ tin cậy: {chunk.get('trust_score',0):.2f}\n"
            f"{chunk['text']}"
        )
        sources.append({
            "title": chunk.get("text", "")[:80] + "...",
            "url": chunk.get("source_url", ""),
            "source_name": chunk.get("source_name", ""),
            "trust_score": chunk.get("trust_score", 0.0),
        })
    return "\n\n---\n\n".join(context_parts), sources

Verify:
python -c "from src.rag.searcher import hybrid_search; from src.rag.prompts import RAG_SYSTEM_PROMPT; print('RAG OK')"
```

---

## P11 — FastAPI API (ask endpoint + health + pipeline status)

```
Project: AI Gym Assistant. Read CLAUDE.md first.
Existing: src/rag/, src/models/pydantic_models.py, src/config.py, src/infra/database.py
Read completely: src/rag/prompts.py, src/models/pydantic_models.py

--- FILE 1: src/api/routers/ask.py ---
Full /ask endpoint:

from fastapi import APIRouter, HTTPException
from openai import OpenAI
import time
from src.models.pydantic_models import AskRequest, AskResponse, SourceCitation
from src.rag.embedder import embed_query
from src.rag.searcher import hybrid_search
from src.rag.reranker import rerank
from src.rag.prompts import RAG_SYSTEM_PROMPT, build_context
from src.config import settings
from src.monitoring.metrics import rag_latency, rag_requests_total
import structlog
import asyncio
from src.infra.database import get_session
from src.models.db_models import QueryLog
from datetime import datetime

router = APIRouter()
logger = structlog.get_logger()

def _get_llm_client():
    return OpenAI(api_key=settings.LLM_API_KEY, base_url=settings.LLM_BASE_URL)

@router.post("/ask", response_model=AskResponse)
async def ask(request: AskRequest):
    start = time.time()
    rag_requests_total.inc()

    try:
        # 1. Embed query
        dense, sparse = embed_query(request.question)

        # 2. Hybrid search
        chunks = hybrid_search(
            dense_vec=dense,
            sparse_vec=sparse,
            limit=20,
            topic_filter=request.topic_filter,
            min_trust=0.6,
        )

        if not chunks:
            return AskResponse(
                answer="Tôi chưa có đủ dữ liệu về vấn đề này. Hãy thử hỏi câu khác hoặc chờ hệ thống cập nhật thêm tri thức.",
                sources=[],
                latency_ms=int((time.time()-start)*1000),
                retrieved_count=0,
            )

        # 3. Rerank
        top_chunks = rerank(request.question, chunks, top_n=5)

        # 4. Build context
        context, sources = build_context(top_chunks)

        # 5. Call LLM
        client = _get_llm_client()
        completion = client.chat.completions.create(
            model=settings.LLM_MODEL,
            messages=[
                {"role": "system", "content": RAG_SYSTEM_PROMPT},
                {"role": "user", "content": f"[CONTEXT]\n{context}\n\n[CÂU HỎI]\n{request.question}"},
            ],
            max_tokens=800,
            temperature=0.3,
        )
        answer = completion.choices[0].message.content

        latency_ms = int((time.time() - start) * 1000)
        rag_latency.observe(latency_ms / 1000)

        # 6. Log async (fire-and-forget)
        asyncio.create_task(_log_query(request.question, top_chunks, answer, latency_ms))

        logger.info("ask_success", latency_ms=latency_ms, retrieved=len(chunks))
        return AskResponse(
            answer=answer,
            sources=[SourceCitation(**s) for s in sources],
            latency_ms=latency_ms,
            retrieved_count=len(chunks),
        )

    except Exception as e:
        logger.error("ask_error", error=str(e))
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")

async def _log_query(query, chunks, answer, latency_ms):
    async with get_session() as session:
        doc_ids = list({c.get("document_id") for c in chunks if c.get("document_id")})
        log = QueryLog(user_query=query, retrieved_doc_ids=doc_ids,
                       answer=answer, latency_ms=latency_ms)
        session.add(log)
        await session.commit()

--- FILE 2: src/api/routers/health.py ---
from fastapi import APIRouter
router = APIRouter()

@router.get("/health")
async def health():
    return {"status": "ok"}

@router.get("/metrics/pipeline")
async def pipeline_metrics():
    """Returns latest pipeline run stats for the dashboard."""
    from src.infra.database import get_session
    from src.models.db_models import PipelineRun
    from sqlalchemy import select, desc
    async with get_session() as session:
        result = await session.execute(
            select(PipelineRun).order_by(desc(PipelineRun.started_at)).limit(5)
        )
        runs = result.scalars().all()
    return {"runs": [
        {"id": r.id, "status": r.status, "started_at": str(r.started_at),
         "docs_crawled": r.docs_crawled, "docs_accepted": r.docs_accepted,
         "docs_rejected": r.docs_rejected, "docs_review": r.docs_review}
        for r in runs
    ]}

--- FILE 3: src/api/main.py ---
from fastapi import FastAPI
from prometheus_client import make_asgi_app
from src.api.routers import ask, health
from src.infra.database import create_tables
from contextlib import asynccontextmanager
import structlog

logger = structlog.get_logger()

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting AI Gym Assistant API")
    await create_tables()
    yield
    logger.info("Shutting down")

app = FastAPI(
    title="AI Gym Assistant API",
    description="RAG-powered fitness knowledge assistant",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(ask.router, prefix="/api/v1", tags=["ask"])
app.include_router(health.router, prefix="/api/v1", tags=["health"])

# Expose /metrics for Prometheus
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)

Verify:
python -c "from src.api.main import app; print('Routes:', [r.path for r in app.routes])"
```

---

## P12 — Prometheus metrics + Streamlit dashboard + integration test

```
Project: AI Gym Assistant. Read CLAUDE.md first.
Existing: all src/, docker-compose.yml

--- FILE 1: src/monitoring/metrics.py ---
from prometheus_client import Counter, Histogram, Gauge

docs_crawled_total   = Counter("kb_docs_crawled_total",  "Docs crawled",  ["source_name"])
docs_accepted_total  = Counter("kb_docs_accepted_total", "Docs accepted", ["topic"])
docs_rejected_total  = Counter("kb_docs_rejected_total", "Docs rejected", ["reason"])
docs_review_total    = Counter("kb_docs_review_total",   "Docs for review")
stage_latency_secs   = Histogram("kb_stage_latency_seconds", "Stage latency", ["stage"],
                                  buckets=[0.1,0.5,1,2,5,10,30,60,120])
rag_latency          = Histogram("kb_rag_latency_seconds", "RAG latency",
                                  buckets=[0.1,0.25,0.5,1,2,5])
rag_requests_total   = Counter("kb_rag_requests_total", "Total RAG requests")
queue_depth          = Gauge("kb_queue_depth", "RabbitMQ queue depth", ["queue_name"])

Now go to src/pipeline/tasks/process.py and src/pipeline/tasks/embed.py:
- Import and use these metrics in the existing implementations:
  - In process_document: increment docs_accepted_total OR docs_rejected_total with labels.
  - In crawl_source: increment docs_crawled_total with label source.name.
  - Wrap each task's main logic with: with stage_latency_secs.labels(stage="process").time(): ...

--- FILE 2: src/monitoring/dashboard.py ---
Full Streamlit dashboard. Run standalone: streamlit run src/monitoring/dashboard.py

import streamlit as st
import requests
import pandas as pd
from datetime import datetime

API_BASE = "http://localhost:8000/api/v1"

st.set_page_config(page_title="Gym KB Pipeline Dashboard", layout="wide")
st.title("🏋️ AI Gym Assistant — Knowledge Pipeline Dashboard")

# Row 1: Pipeline runs
st.header("Pipeline Runs")
try:
    data = requests.get(f"{API_BASE}/metrics/pipeline", timeout=5).json()
    if data["runs"]:
        df = pd.DataFrame(data["runs"])
        df["started_at"] = pd.to_datetime(df["started_at"])
        # KPI metrics
        latest = data["runs"][0]
        c1,c2,c3,c4 = st.columns(4)
        c1.metric("Docs Crawled",   latest["docs_crawled"])
        c2.metric("Accepted ✅",    latest["docs_accepted"])
        c3.metric("Rejected ❌",    latest["docs_rejected"])
        c4.metric("Review 🔍",      latest["docs_review"])
        st.dataframe(df[["id","status","started_at","docs_crawled","docs_accepted","docs_rejected"]])
    else:
        st.info("No pipeline runs yet. Run: python scripts/run_pipeline_once.py")
except Exception as e:
    st.error(f"Cannot reach API: {e}. Make sure API is running on port 8000.")

# Row 2: Test RAG
st.header("Test RAG Answer")
question = st.text_input("Câu hỏi:", "Lịch tập tăng cơ 4 buổi/tuần cho người mới?")
if st.button("Hỏi AI"):
    with st.spinner("Đang truy xuất tri thức..."):
        try:
            resp = requests.post(f"{API_BASE}/ask",
                                 json={"question": question}, timeout=30).json()
            st.markdown(f"**Câu trả lời:**\n\n{resp['answer']}")
            st.caption(f"Latency: {resp['latency_ms']}ms | Retrieved: {resp['retrieved_count']} chunks")
            if resp["sources"]:
                st.subheader("Nguồn tham khảo")
                for s in resp["sources"]:
                    st.markdown(f"- [{s['source_name']}]({s['url']}) — Trust: {s['trust_score']:.2f}")
        except Exception as e:
            st.error(f"Error: {e}")

--- FILE 3: tests/conftest.py ---
import pytest
import asyncio

@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()

--- FILE 4: tests/test_pipeline.py ---
Smoke tests (do NOT require live services):

import pytest
from src.models.pydantic_models import AskRequest, AskResponse, SourceCitation
from src.rag.prompts import build_context, RAG_SYSTEM_PROMPT
from src.pipeline.tasks.process import compute_trust_score  # if extracted as module func

def test_ask_request_validation():
    r = AskRequest(question="How to build muscle?")
    assert len(r.question) >= 3

def test_ask_request_too_short():
    with pytest.raises(Exception):
        AskRequest(question="Hi")

def test_build_context_returns_numbered():
    chunks = [
        {"text": "Train hard.", "source_name": "PubMed",
         "source_url": "http://x.com", "trust_score": 0.9}
    ]
    ctx, sources = build_context(chunks)
    assert "[1]" in ctx
    assert len(sources) == 1
    assert sources[0]["source_name"] == "PubMed"

def test_rag_system_prompt_contains_rules():
    assert "KHÔNG bịa" in RAG_SYSTEM_PROMPT
    assert "trích dẫn" in RAG_SYSTEM_PROMPT

def test_chunk_text_basic():
    from src.pipeline.tasks.embed import chunk_text
    long_text = "This is a sentence about fitness training. " * 200
    chunks = chunk_text(long_text, chunk_size=400, overlap=64)
    assert len(chunks) > 1
    for c in chunks:
        assert len(c) > 10

Run tests: pytest tests/test_pipeline.py -v
All 5 tests must pass.

Final check — verify full import chain:
python -c "
from src.api.main import app
from src.pipeline.tasks.crawl import kickoff_crawl, crawl_source
from src.pipeline.tasks.process import process_document
from src.pipeline.tasks.embed import embed_document
from src.rag.searcher import hybrid_search
from src.rag.reranker import rerank
from src.monitoring.metrics import rag_requests_total
print('=== ALL IMPORTS OK ===')
print('Tasks:', crawl_source.name, process_document.name, embed_document.name)
print('API routes:', len(app.routes))
"
```

---

## Sau khi hoàn thành tất cả P01–P12

Chạy theo thứ tự:

```bash
# 1. Copy env
cp .env.example .env
# Điền: LLM_API_KEY, passwords

# 2. Khởi động tất cả service
make up

# 3. Chờ service healthy (~30s), rồi khởi tạo Qdrant
docker compose exec worker-crawl python scripts/init_qdrant.py

# 4. Seed sources
docker compose exec worker-crawl python scripts/seed_sources.py

# 5. Chạy pipeline lần đầu (demo)
docker compose exec worker-crawl python scripts/run_pipeline_once.py

# 6. Xem tiến trình
# Flower:    http://localhost:5555
# RabbitMQ:  http://localhost:15672
# MinIO:     http://localhost:9001
# Grafana:   http://localhost:3000
# API docs:  http://localhost:8000/docs

# 7. Test RAG
curl -X POST http://localhost:8000/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"Lịch tập tăng cơ cho người mới bắt đầu?"}'

# 8. Dashboard
docker compose exec api streamlit run src/monitoring/dashboard.py --server.port 8501
# http://localhost:8501
```
