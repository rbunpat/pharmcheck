# LINE OA Medication Checker: System Design & Build Guide

> **Status:** Draft v1.0
> **Scope:** MVP for a LINE Official Account that identifies a drug from a photo of its package, checks its อย. registration, screens it against the user's health profile, and refers risks to a licensed pharmacist.

---

## Table of Contents
1. Product summary and hard constraints
2. High-level architecture
3. Tech stack
4. Core user flows
5. Component design
6. Data model
7. Data sources
8. Data requirements
9. Clinical knowledge base options
10. Security and PDPA
11. SaMD and locked-algorithm compliance
12. Non-functional targets
13. Build instructions
14. Delivery plan
15. Open questions
16. Business model notes

---

## 1. Product summary and hard constraints

**Users:** Adult children aged 35–55 who look after elderly parents. They photograph a medicine package, and the system tells them what the drug is, whether it's correctly registered, and whether anything in the parent's health profile means a pharmacist should look at it first.

**Hard constraints:**

| # | Constraint | Design consequence |
|---|---|---|
| C1 | The LLM never writes answers | Every message the system sends comes from a fixed, versioned template |
| C2 | No medical advice | It doesn't say "take it", "don't take it" or "safe", and it doesn't diagnose. Risks only produce "พบข้อมูลที่ควรปรึกษาเภสัชกร" ("we found information you should check with a pharmacist") |
| C3 | Locked algorithm (Thai FDA (อย.) medical-software (SaMD) rules) | No continuous learning. Every model, rule set and data set is versioned, and every decision can be replayed |
| C4 | Pharmacists must be tied to a licensed pharmacy | Only pharmacists linked to a ขย.1-licensed pharmacy can take cases, and only during that pharmacy's opening hours |
| C5 | PDPA | Separate consent for health data, field-level encryption, EXIF/GPS removed from photos, real deletion of images, append-only audit log |
| C6 | Confidence below 0.85 | The system asks the user to retake the photo and never guesses |
| C7 | Drug data from อย., no scraping | Data comes only from official datasets or licensed sources |

---

## 2. High-level architecture

```text
 ┌──────────────┐        ┌─────────────────────────────────────────────────────────┐
 │  LINE App    │webhook │                      BACKEND (VPC)                      │
 │ (caregiver)  ├───────►│  Webhook GW ──enqueue──► Job Queue (Redis/BullMQ)       │
 │ chat + LIFF  │◄───────┤  (sig verify, ack <1s)          │                       │
 └──────────────┘ reply/ │                                 ▼                       │
                  push   │  Scan Pipeline:                                         │
                         │  1 Ingest → 2 Sanitize (EXIF strip) → 3 OCR →           │
                         │  4 Drug Matcher → 5 Rule Engine → 6 Templater           │
                         │        │                │                 │             │
                         │  Object Storage    PostgreSQL       Consult Matching    │
                         │  (encrypted, TTL)  (core + drug DB) (90s / 15m timers)  │
                         │        │                │                 │             │
                         │       KMS          Audit Log         Pharmacist API     │
                         │                    (append-only      (REST + WebSocket) │
                         │                     + WORM)                 │           │
                         │  Drug Data Ingestion:                       │           │
                         │  source → staging → pharmacist review → publish         │
                         └─────────────────────────────────────────────┼───────────┘
                                                                       ▼
                                                     Pharmacist Console (Web)
                                                     - ขย.1 pharmacy login + MFA
                                                     - availability toggle
                                                     - accept / answer cases
                                                     - drug-data review queue
```

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Webhook, core API, matching | TypeScript (NestJS) | Official LINE SDK; strong typing for the rule and template contracts |
| OCR | LLM vision API (pinned model ID), called from the worker | No OCR infrastructure to run; strong Thai label reading; structured JSON output |
| Database | PostgreSQL 16 | Relational integrity, `SKIP LOCKED`, row-level security, `pg_trgm` for fuzzy matching |
| Queue and timers | Redis + BullMQ (or SQS + EventBridge Scheduler) | Delayed jobs for the 90 s and 15 min timers, plus retries |
| Image storage | S3-compatible storage, SSE-KMS, lifecycle rules | Encrypted at rest, automatic expiry as a backstop |
| Keys | Cloud KMS, envelope encryption | Field-level encryption of the health profile |
| Pharmacist console | Next.js + Socket.IO | Real-time case offers with a countdown |
| User forms | LINE LIFF (React) | Consent and health-profile entry inside LINE |
| Hosting | Managed containers in a Thailand region | Keeps data in-country for PDPA |
| Observability | OpenTelemetry → Grafana/Datadog, Sentry | Trace each scan from webhook to reply |

---

## 4. Core user flows

### 4.1 Onboarding and consent
1. The user adds the LINE OA and receives a welcome Flex message linking to the LIFF consent screen.
2. Consent is split into two parts: (a) terms of service and general data use; (b) explicit consent for health data (PDPA section 26). The second is never pre-ticked or bundled with the first.
3. The system stores the consent type, version and timestamp, and writes an audit entry.
4. The health profile is optional. Without it, the system can still identify the drug and check registration, and the reply says screening was limited.

### 4.2 Normal scan (no risks found)
```text
Photo → verify signature → enqueue → HTTP 200
 → show LINE loading animation
 → fetch image → strip EXIF (re-encode) → store encrypted
 → OCR → extract {registration_no, trade_name, strength, manufacturer} + confidence
 → drug matcher → drug_id + confidence
 → rule engine → INFO
 → templater → Flex Message → reply (or push if the reply token has expired)
```
**Target:** p95 under 8 s from photo to answer.

### 4.3 Referral to a pharmacist
```text
Rule engine → REFER
 → Flex: drug info + "พบข้อมูลที่ควรให้เภสัชกรดูก่อนใช้ เนื่องจาก {reason}" + [ปรึกษาเภสัชกร]
 → user confirms (postback) → consult_request = QUEUED
 → offered to one eligible pharmacist (90 s)
     ├ accepted → pharmacist answers → push to user → CLOSED
     ├ declined/timeout → offered to the next pharmacist
     └ no acceptance within 15 min → EXPIRED → template message to the user
```

---

## 5. Component design

### 5.1 Webhook gateway
- Verify the `X-Line-Signature` HMAC and reject anything that fails.
- Deduplicate on `webhookEventId` (Redis, 24 h TTL), because LINE can redeliver events.
- Only acknowledge and enqueue; do no processing inline.
- Event types: `follow`, `unfollow`, `message.image`, `message.text` (help/menu), `postback`.
- Rate limit: 10 scans per user per hour.

### 5.2 Image sanitizer
- Fix the orientation, then decode and re-encode as JPEG. This strips all metadata (EXIF, GPS, XMP).
- Store at `scans/{yyyy}/{mm}/{scan_id}.jpg` with SSE-KMS. The database holds only the object key.
- The console views images through 60-second signed URLs, and only for the pharmacist assigned to the case.

### 5.3 OCR service
**Locked-algorithm risk:** hosted LLM vision models can change or be retired without notice.

| Option | Pros | Cons |
|---|---|---|
| A. LLM vision API with a pinned model ID (e.g. a dated snapshot) | No OCR infrastructure to run; strong Thai label reading; returns structured JSON directly | Model may be retired; data leaves your systems; per-call cost |
| B. Self-hosted open-weights vision model in a versioned container | Fully locked; data stays in the VPC | Must reach 85% or better yourselves; GPU hosting to operate |

**Recommendation:** use option A for the MVP. Pin the exact model ID (a dated snapshot, never a floating alias), record `ocr_engine` and `ocr_model_version` on every scan, and keep the call behind a thin `OcrProvider` interface so option B can be swapped in later without touching the pipeline.

**Call shape:**
- Send the sanitised JPEG plus a fixed prompt that asks only for the fields below, and request JSON output.
- `POST /ocr {image} → {text, fields{registration_no, trade_name, strength, manufacturer}, field_confidence, model_version}`
- Set `temperature: 0`, a fixed `max_tokens`, and a request timeout; retry once on timeout or 5xx, then fail the scan.
- Never let the model decide the outcome. It only transcribes; the matcher and rule engine decide.

**Field extraction:**
- The model returns the four fields plus a per-field confidence.
- Validate every field with deterministic parsers before use:
  - Registration number: a versioned regex set (e.g. `1A 123/45`, `2A 12/2560 (NG)`), confirmed against the อย. format specification. A value that fails the regex is discarded.
  - Strength: `\d+(\.\d+)?\s?(mg|g|ml|mcg|%)`.
  - Trade name: cross-checked against the drug dictionary.
- If the model returns no confidence, derive it from the parser result and the matcher tier instead of trusting the model's own estimate.

### 5.4 Drug matcher

| Tier | Method | Confidence |
|---|---|---|
| 1 | Exact match on normalised registration number | OCR field confidence |
| 2 | Registration number with 1 OCR-confusable character (O/0, I/1) resolving to exactly one drug | OCR confidence × 0.9 |
| 3 | Trigram match on trade name + strength + manufacturer, with exactly one candidate above the threshold | similarity × OCR confidence |

- Final confidence = min(OCR confidence for the key field, match confidence).
- Below 0.85, or 2 or more candidates → `RETAKE`.
- Label readable but no match → `NOT_FOUND` → refer.

### 5.5 Rule engine
- Rules are declarative YAML in git, signed and released as an immutable `rule_version`.
- `evaluate(facts, drug, drug_info, alerts, profile, ruleset) → {flags[], decision}` is a pure function with no I/O or randomness.
- Each result stores its flags, decision, all version numbers and a hash of the inputs, so it can be replayed.

| ID | Condition | Flag | Decision |
|---|---|---|---|
| R00 | Confidence < 0.85 or ambiguous match | LOW_CONFIDENCE | RETAKE |
| R01 | No matching drug | NOT_FOUND | REFER |
| R02 | Registration cancelled, suspended or expired | REG_INACTIVE | REFER |
| R03 | Active อย. alert for the drug | FDA_ALERT | REFER |
| R04 | Allergy matches the drug's ingredient or class | ALLERGY | REFER |
| R05 | Contraindicated with one of the user's conditions | CONTRAINDICATION | REFER |
| R06 | Major/severe interaction with a current medicine | INTERACTION | REFER |
| R07 | No health profile | NO_PROFILE | INFO + limited-screening note |
| R99 | Otherwise | — | INFO |

The `{reason}` placeholder comes from a fixed phrase for each flag, never from free text.

### 5.6 Templater
- Templates have an ID and version (e.g. `TPL_NORMAL@3`). Placeholders are filled only from pharmacist-reviewed fields.
- Output is LINE Flex Message JSON, with text that renders at 18 pt or larger, high contrast and large buttons.
- Every message has a fixed footer: "ข้อมูลนี้ไม่ใช่คำแนะนำทางการแพทย์" ("this is not medical advice").
- A CI lint check fails the build if a template contains banned words such as "ปลอดภัย", "กินได้" or "ห้ามกิน".

**Templates:** NORMAL, RISK, REG_INACTIVE, FDA_ALERT, NOT_FOUND, RETAKE, NO_PROFILE_NOTE, NO_PHARMACIST_OPEN, CONSULT_QUEUED, CONSULT_EXPIRED, PHARMACIST_ANSWER_WRAPPER.

### 5.7 Consult matching engine
```text
PENDING_CONFIRM → QUEUED → OFFERED ⇄ (decline / 90 s timeout → QUEUED)
                                 → ACCEPTED → ANSWERED → CLOSED
QUEUED/OFFERED --15 min--> EXPIRED
any → CANCELLED
```
**Eligibility, checked at offer time:**
- Pharmacist is AVAILABLE and not busy with another case.
- Pharmacist's licence is valid, and the pharmacy's ขย.1 licence is valid.
- The current time in Asia/Bangkok is within the pharmacy's opening hours, minus a 10-minute margin before closing.
- The pharmacist hasn't already declined this request.
- The pharmacist who has been idle longest goes first.

**Implementation:** `FOR UPDATE SKIP LOCKED` prevents double offers. Two delayed jobs per request (90 s offer timeout, 15 min expiry) check the current state before acting, so they're idempotent. If no pharmacy is open, the user is told the opening hours immediately.

### 5.8 Pharmacist console
- **Login:** a pharmacy account linked to the ขย.1 licence, with individual pharmacist logins under it and MFA required. Licence numbers are checked at onboarding.
- **Features:** availability toggle (forced off outside opening hours), offer card with a 90 s countdown, case view (photo, OCR result, matched drug, flags, profile), answer composer (free text written by the pharmacist, sent with their name and licence number), and the drug-data review queue.
- **Access control:** a pharmacist can only open a case assigned to them while it's ACCEPTED. Anything else returns 403.
- Every view of a health profile or image is written to the audit log.

### 5.9 Drug data ingestion
```text
Official source → raw snapshot (immutable, with source_ref)
 → normalise → staging tables → diff against production
 → pharmacist review → approve → publish new drug_db_version
```
- Status changes and new alerts are fast-tracked: auto-published, then reviewed. They only add caution, never remove it. Confirm this approach with your regulatory consultant.
- Content fields are never published without review.

---

## 6. Data model

```sql
-- Users & consent
user(id PK, line_user_id UNIQUE, display_name, status, consent_version, consent_at,
     created_at, deleted_at)
consent(id PK, user_id FK, type ENUM('tos','health_data'), version, granted_at, withdrawn_at)
health_profile(user_id PK/FK, conditions_enc BYTEA, current_meds_enc BYTEA,
     allergies_enc BYTEA, dek_wrapped BYTEA, updated_at)
     -- coded values (ICD-10 / drug_id / allergy group) inside the ciphertext

-- Scanning
scan(scan_id PK, user_id FK, image_ref, image_deleted_at, ocr_text, extracted JSONB,
     confidence NUMERIC(4,3), ocr_engine, ocr_model_version, parser_version,
     matched_drug_id FK NULL, created_at)
screening_result(scan_id PK/FK, flags TEXT[], decision ENUM('INFO','REFER','RETAKE'),
     rule_version, drug_db_version, template_id, input_hash, created_at)

-- Drug knowledge
drug(drug_id PK, trade_name, generic_name, registration_no UNIQUE, status, strength,
     dosage_form, manufacturer, tmt_code, drug_db_version, source_ref, reviewed_by, reviewed_at)
drug_info(drug_id PK/FK, indications, side_effects, contraindications_text,
     source_ref, reviewed_by, reviewed_at, version)
drug_ingredient(drug_id FK, ingredient_code, class_code, allergy_group)
drug_interaction(ingredient_a, ingredient_b, severity, source_ref, kb_version, reviewed_by)
contraindication_map(ingredient_code, condition_code, source_ref, kb_version, reviewed_by)
drug_alert(alert_id PK, drug_id FK, fda_ref, alert_type, issued_at, summary, active)

-- Pharmacy side
pharmacy(pharmacy_id PK, license_no, license_expiry, name, address, open_hours JSONB,
     holidays JSONB, tz, verified_by, verified_at)
pharmacist(pharmacist_id PK, license_no, license_expiry, pharmacy_id FK, name,
     status ENUM('OFFLINE','AVAILABLE','BUSY'), last_assigned_at, mfa_secret_enc,
     verified_by, verified_at)
consult_request(request_id PK, scan_id FK, user_id FK, pharmacist_id FK NULL, status,
     offered_to, offered_at, declined_by UUID[], accepted_at, answered_at, closed_at,
     expires_at, answer_text, billing_ref NULL)

-- Audit
audit_log(id BIGSERIAL, actor, actor_type, action, entity, entity_id,
     before JSONB, after JSONB, at, prev_hash, hash)
```

**Notes:**
- The audit log is append-only: the app role has INSERT only, triggers block UPDATE and DELETE, a hash chain makes tampering detectable, and a nightly export goes to WORM storage (S3 Object Lock).
- The audit log never stores plaintext health data; profile changes are recorded as field names and hashes only.
- `billing_ref` is nullable so payments can be added later without a migration.

---

## 7. Data sources

| Layer | Content | Source | Tables |
|---|---|---|---|
| 1. Registration | Registration number, name, holder, status | อย. (open data or a formal data agreement) | `drug` |
| 2. Alerts | Recalls, cancellations, warnings | อย. announcements | `drug_alert` |
| 3. Standard codes | Product → ingredient → strength/form | Thai Medicines Terminology (TMT), from THIS | `drug_ingredient` |
| 4. Patient-facing info | Indications, common side effects | Package inserts, rewritten in plain Thai by pharmacists | `drug_info` |
| 5. Clinical rules | Contraindications, interactions, allergy groups | Licensed clinical knowledge base | `contraindication_map`, `drug_interaction` |

```text
อย. registration ─┐
                  ├─► match on registration_no ─► drug
TMT ──────────────┘          │
                             ├─► ingredients ─► drug_ingredient
Licensed clinical KB ────────┴─► drug_interaction, contraindication_map
Package inserts ─► pharmacist rewrite ─► drug_info
อย. alerts ─► drug_alert
```

**Sourcing rules:**
- No scraping of the อย. search portal or any third-party website.
- The อย. search portal may be used for one-at-a-time manual checks by pharmacists.
- Check whether TMT trade-product records include อย. registration numbers. If they do, linking is mostly automatic; if not, pharmacists have to map them.
- Check the licence terms for TMT and the knowledge base. They must allow patient-facing commercial use.

**If อย. data access is slow:**
1. Use open data and TMT releases for development and the OCR spike.
2. Have pharmacists enter and verify the top ~500 products by hand, checking each against the อย. portal.
3. Switch to the official feed when the agreement is signed. The pipeline stays the same.

---

## 8. Data requirements

| # | Data | Purpose | Needed by |
|---|---|---|---|
| 1 | Drug reference data | Identify drugs and screen for risks | Phase 2 |
| 2 | Package photos (test set) | OCR validation and regression tests | Phase 1 |
| 3 | Content you write | Templates, reason phrases, drug info | Phases 2–4 |
| 4 | Pharmacy and pharmacist records | Licence verification and matching | Phase 5 |
| 5 | User data | Consent, profile, scans | After launch |

### 8.1 Drug reference data (minimum for MVP)
- **Registrations:** all products, so the system can say "not found" reliably.
- **Alerts:** all current alerts.
- **Ingredients, patient info:** the top ~500 elderly-use products.
- **Contraindications:** common elderly conditions: high blood pressure, diabetes, chronic kidney disease, liver disease, heart failure, asthma/COPD, gout, peptic ulcer or GI bleeding, glaucoma, enlarged prostate, dementia.
- **Interactions:** major and severe only.
- **Allergy groups:** about 20–30 (penicillins, sulfonamides, NSAIDs, etc.).
- **Every row also needs:** `source_ref`, `version`, `reviewed_by`, `reviewed_at`.

### 8.2 Package photos
- 300–500 photos for the spike, growing to about 1,000 or more for the release golden set.
- Cover boxes, blister packs, bottles, sachets and herbal products; Thai-only and English-only labels; cheap Android phones and iPhones; low light, glare, angles and blur; cancelled, unregistered and look-alike products.
- Label each photo with the correct registration number, trade name and strength, and the expected outcome (match / not found / retake).
- Synthetic test profiles with the expected decision for each drug. Never use real patient data for testing.

### 8.3 Content you write
- All message templates and the reason phrase for each flag.
- Picklists for the health-profile form: conditions in Thai mapped to ICD-10, searchable drug names, allergy groups.
- Legal text (terms, privacy notice, health-data consent, disclaimer), reviewed by a lawyer.
- The banned-word list for the CI check.

### 8.4 Pharmacy and pharmacist records

| Pharmacy (ขย.1) | Pharmacist |
|---|---|
| Licence number and expiry date | Pharmacy Council licence number and expiry date |
| Name and address | Name and photo |
| Opening hours for each day, and holidays | Linked pharmacy |
| Contact person | Login + MFA |
| Copy of the licence document | Verification record |

### 8.5 User data

| Collect | Don't collect |
|---|---|
| LINE user ID | Real name, national ID, phone number, address |
| Consent records | The parent's identity |
| Conditions, medicines and allergies as codes | Free-text medical history |
| Scans (deleted after N days) and OCR results | GPS or other photo metadata |
| Consult history | Location, contacts, profile picture |

Optional: age band and pregnancy status, only if a rule uses them.

---

## 9. Clinical knowledge base options

Drugs.com has no public API, and third-party "Drugs.com APIs" scrape the site. Don't use them.

| Option | Cost | Severity levels | Thai products | Notes |
|---|---|---|---|---|
| MIMS Thailand | Paid | Yes | Yes | Ask for a quote first |
| DrugBank (commercial) | Paid; has an API | Yes | Ingredient-based | Backup option for interactions |
| Lexicomp / Medi-Span, Micromedex, First Databank, Multum | Enterprise pricing | Yes | Ingredient-based | Strongest for regulatory review |
| Drug-data API resellers | Self-serve, paid | Varies | Varies | Check where their data comes from |
| NIH RxNorm | Free | — | No | Name standardisation only; the interaction API was shut down in January 2024 |
| openFDA | Free | No | No | Not good enough for screening |

**Rules:**
- Interactions and contraindications depend on active ingredients, so US data works once Thai products are mapped to ingredients through TMT.
- The licence must explicitly allow patient-facing screening.
- Import each release as a fixed, numbered version into your own database. Never call a live API for each scan.

---

## 10. Security and PDPA

| Requirement | Implementation |
|---|---|
| Separate consent | Separate consent types; health-data consent never pre-ticked; withdrawing it erases the profile |
| Field encryption | A data key per user, wrapped by KMS; decrypted only in the rule engine and the console API |
| EXIF/GPS | Re-encode on ingest |
| Retention | Daily job deletes images older than N days (suggest 30) and writes an audit entry; storage lifecycle rule at N+7 days as a backstop |
| Data subject rights | LIFF "My data" page: export and delete |
| Least privilege | Separate database roles per service; row-level security on `consult_request` |
| Transport | TLS 1.2+, HSTS, private subnets |
| Secrets | Secrets manager, rotated |
| Console hardening | MFA, 15 min idle timeout, no download button, watermark with pharmacist ID |

---

## 11. SaMD and locked-algorithm compliance
- Store these versions on every result: `ocr_model_version`, `parser_version`, `rule_version`, `drug_db_version`, `kb_version`, `template_version`.
- No learning in production. Any model update is a new release through change control.
- **Release gate:** the golden set must show at least 85% accuracy, and no expected REFER may become INFO.
- Follow IEC 62304 (software lifecycle) and ISO 14971 (risk management), with a traceability matrix from requirement to rule to test. Confirm with your อย. consultant.

---

## 12. Non-functional targets

| Metric | Target |
|---|---|
| Scan latency (p95) | ≤ 8 s |
| Webhook acknowledgement | ≤ 500 ms |
| OCR registration-number accuracy | ≥ 85% (aim for 90%) |
| INFO given when REFER was correct | 0 in the golden set |
| Availability (MVP) | 99.5% |
| Offer timeout / expiry | 90 s / 15 min |

---

## 13. Build instructions

### 13.1 Repo layout (monorepo)
```text
med-checker/
├── apps/
│   ├── webhook/          # NestJS: LINE webhook gateway
│   ├── worker/           # NestJS: scan pipeline + matching jobs
│   ├── console-api/      # NestJS: pharmacist REST + WebSocket
│   ├── console-web/      # Next.js: pharmacist console
│   └── liff/             # React: consent + health profile + My data
├── packages/
│   ├── ocr/              # OcrProvider interface + LLM vision API client (pinned model ID)
│   ├── rule-engine/      # pure TS evaluate()
│   ├── templates/        # Flex templates + banned-word lint
│   ├── db/               # migrations (SQL) + typed client
│   └── crypto/           # envelope encryption helpers
├── rules/                # YAML rule sets (versioned, signed)
├── ingestion/            # drug data import + staging + diff
├── golden/               # labelled photos + synthetic profiles + expected results
└── infra/                # Terraform / IaC
```

### 13.2 Environment variables
```bash
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
LIFF_ID=
DATABASE_URL=
REDIS_URL=
S3_BUCKET_SCANS=
KMS_KEY_ID=
OCR_PROVIDER=llm_vision
OCR_MODEL_ID=
OCR_API_KEY=
OCR_TIMEOUT_MS=20000
CONFIDENCE_THRESHOLD=0.85
OFFER_TIMEOUT_SEC=90
REQUEST_EXPIRY_SEC=900
IMAGE_RETENTION_DAYS=30
TZ_DEFAULT=Asia/Bangkok
```

### 13.3 Step-by-step

**Step 1: Infrastructure**
1. Create the cloud account in a Thailand region, a VPC with private subnets, managed Postgres 16, Redis, an S3 bucket (SSE-KMS, Object Lock bucket for audit exports) and a KMS key.
2. Set up CI with lint, unit tests, the template banned-word lint and golden-set tests.

**Step 2: Database**
1. Write migrations for every table in section 6. Enable `pg_trgm`.
2. Create roles: `webhook_role`, `worker_role`, `console_role`, `ingest_role`, `audit_writer`.
3. Add the audit protection:
```sql
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
CREATE FUNCTION audit_block() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION audit_block();
```

**Step 3: OCR spike (Phase 1)**
1. Collect and label 300–500 photos (section 8.2).
2. Build `packages/ocr` behind an `OcrProvider` interface, with an LLM vision API implementation: `POST /ocr {image} → {text, fields{registration_no, trade_name, strength, manufacturer}, field_confidence, model_version}`.
3. Benchmark two or three candidate LLM vision models on exact registration-number matches, and pick the one that reaches 85% or better. Compare cost per scan and latency at the same time.
4. Pin the chosen model ID (a dated snapshot, never a floating alias) and record it as `ocr_model_version`. Add a startup check that fails if the configured model ID is not the pinned one.

**Step 4: Drug data (Phase 2)**
1. Send the data request to อย., and request quotes from MIMS Thailand and DrugBank.
2. Build the ingestion flow: raw snapshot → normalise → staging → diff → review queue → publish.
3. Load TMT and map products to ingredients.
4. Pharmacists review the top ~500 products and write `drug_info` in plain Thai.

**Step 5: LINE OA (Phase 3)**
1. Create the Messaging API channel and LIFF app, and set the webhook URL.
2. Webhook flow: verify signature → deduplicate on `webhookEventId` → enqueue → return 200.
3. Build the LIFF consent screen (two separate consents) and the health-profile form (picklists only).
4. Set up the rich menu: Scan, My profile, My data, Help.

**Step 6: Rule engine and templates (Phase 4)**
Example rule file:
```yaml
# rules/2026.03.1.yaml
version: "2026.03.1"
threshold: 0.85
rules:
  - id: R00
    when: "facts.confidence < threshold or facts.candidates != 1"
    flag: LOW_CONFIDENCE
    decision: RETAKE
  - id: R02
    when: "drug.status in ['cancelled','suspended','expired']"
    flag: REG_INACTIVE
    decision: REFER
  - id: R04
    when: "intersects(profile.allergies, drug.allergy_groups + drug.ingredients)"
    flag: ALLERGY
    decision: REFER
  - id: R06
    when: "any_interaction(drug.ingredients, profile.current_med_ingredients, min_severity='major')"
    flag: INTERACTION
    decision: REFER
reasons:
  ALLERGY: "ข้อมูลการแพ้ยา"
  CONTRAINDICATION: "โรคประจำตัว"
  INTERACTION: "ยาที่ใช้อยู่"
  REG_INACTIVE: "สถานะทะเบียนยา"
  FDA_ALERT: "ประกาศจากสำนักงานคณะกรรมการอาหารและยา"
```
Engine signature:
```ts
export interface Decision {
  flags: string[];
  decision: 'INFO' | 'REFER' | 'RETAKE';
  ruleVersion: string;
  inputHash: string;
}
export function evaluate(input: ScreeningInput, ruleset: RuleSet): Decision; // pure, no I/O
```
Write golden-set tests that cover every rule, and make REFER→INFO regressions fail the build.

**Step 7: Matching engine and console (Phase 5)**
Offer query:
```sql
SELECT p.pharmacist_id
FROM pharmacist p
JOIN pharmacy ph ON ph.pharmacy_id = p.pharmacy_id
WHERE p.status = 'AVAILABLE'
  AND p.license_expiry > now()
  AND ph.license_expiry > now()
  AND is_open(ph.open_hours, ph.holidays, now() AT TIME ZONE 'Asia/Bangkok', interval '10 min')
  AND p.pharmacist_id <> ALL(:declined_by)
ORDER BY p.last_assigned_at NULLS FIRST
LIMIT 1
FOR UPDATE OF p SKIP LOCKED;
```
- Schedule the `offer_timeout` (90 s) and `request_expiry` (15 min) delayed jobs. Each checks the state before acting.
- Build the console: login + MFA, availability toggle, offer card with countdown, case view (signed URLs), answer composer, drug-data review queue.

**Step 8: Audit and retention (Phase 6)**
1. Set up the hash chain (`hash = sha256(prev_hash || row_json)`) and the nightly WORM export.
2. Add the daily image-deletion job plus the storage lifecycle backstop.
3. Build the "My data" export and delete page.
4. Complete the PDPA checklist and a penetration test.

### 13.4 Testing checklist
- [ ] Signature failure is rejected
- [ ] Duplicate webhook events are processed once
- [ ] EXIF/GPS is absent from stored images
- [ ] Confidence of 0.84 gives RETAKE; 0.85 continues
- [ ] Two matching candidates give RETAKE
- [ ] Every flag produces the correct template
- [ ] No template contains banned words
- [ ] A 90 s timeout re-offers to the next pharmacist
- [ ] 15 min with no acceptance gives EXPIRED and notifies the user
- [ ] No offers outside opening hours or with expired licences
- [ ] A pharmacist can't open another pharmacist's case
- [ ] UPDATE/DELETE on the audit log fails
- [ ] Images are deleted after N days
- [ ] Replaying a past scan gives an identical decision

---

## 14. Delivery plan

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 1. OCR spike (2–3 wk) | Photo set; OCR benchmark | ≥ 85% registration-number accuracy; locking approach decided |
| 2. Drug database (3–4 wk) | Data agreements; ingestion; review UI | Top 500 products reviewed and published |
| 3. LINE OA (2 wk) | Webhook, LIFF forms, Flex templates | Normal flow works end-to-end on staging |
| 4. Rule engine (2 wk) | Rules v1, templater, CI lint | Golden-set tests pass 100% |
| 5. Pharmacist console (3–4 wk) | Login + MFA, matching, case handling | 50 concurrent requests; timers behave correctly |
| 6. Audit and retention (1–2 wk) | Hash chain, WORM export, retention, data rights | PDPA checklist and penetration test passed |

**Start immediately:** photo collection (blocks Phase 1) and the อย. data request (longest lead time).

---

## 15. Open questions
1. Image retention period (the brief gives no number of days).
2. อย. bulk data or API access, update frequency, and who owns that conversation.
3. Which clinical knowledge base, and the budget for it.
4. Telepharmacy (สธ. 2569) details: what the pharmacist's answer must include, record-keeping, whether video is required.
5. Who reviews drug data: an in-house pharmacist team or partner pharmacies?
6. Out-of-hours behaviour: tell the user the opening hours, or queue until opening?
7. Herbal products: registration check only, or interaction screening too?
8. Does the TMT data include อย. registration numbers?

---

## 16. Business model notes
- Drugs.com earns its money from advertising and licenses its clinical content from other publishers, which is why it has no API.
- Avoid pharmaceutical advertising in this product. It would create a conflict of interest with the screening, and could cause problems in the SaMD review.
- Possible revenue options: a fee per pharmacist consult, partnerships with pharmacies, or B2B deals with insurers or hospitals. `billing_ref` is already in the data model for this.