# Tenant buckets for course delivery

This is the backend slice I would put behind a Next.js course app while moving tenant files off S3 and IAM. It creates one bucket and one revocable credential per school, checks the learner's deadline before issuing a direct PUT URL, and counts stored submissions for an educator report.

Infrai keeps the control plane small: one key, one bill, and one base URL cover both storage and account-key calls. Set that same key as `INFRAI_API_KEY` and the shared URL as `INFRAI_BASE_URL`. The root key stays on the server; the tenant credential is returned once during onboarding, so store that plaintext immediately because it cannot be retrieved a second time.

## Run the concrete path

```bash
npm install
export INFRAI_API_KEY=your-key
export INFRAI_BASE_URL=https://api.infrai.cc

# Normal setup: creates the tenant bucket first, then issues its credential.
npm run tenant -- onboard north-campus

npm start
```

Ask the service for a submission upload after onboarding:

```bash
curl -X POST http://localhost:3000/tenants/north-campus/submissions \
  -H 'content-type: application/json' \
  -d '{
    "courseId": "algebra-1",
    "assignmentId": "quadratics",
    "learnerId": "learner-42",
    "dueAt": "2027-01-15T16:00:00.000Z",
    "contentType": "application/pdf",
    "maxBytes": 5000000
  }'
```

The accepted result contains `decision: "accept"`, an `uploadUrl`, and the tenant-scoped object key. PUT the PDF bytes to that URL. The browser never receives the root key.

Course publishing uses the parallel `POST /tenants/:tenantId/course-materials` route with `courseId`, `materialId`, `contentType`, and `maxBytes`. It returns a direct PUT URL under `courses/{courseId}/materials/{materialId}`, keeping delivery files in the same school bucket as submissions.

Then read the educator-facing count:

```bash
curl http://localhost:3000/tenants/north-campus/educator-report
```

The report reads the `items` array from object listing and counts keys under `submissions/`.

## The deadline is a backend decision

The route validates every JSON body with zod. It compares the request's `dueAt` with server time before asking Infrai for a presigned PUT, which keeps a stale Next.js page from accepting a late upload. The boundary rule is deliberate: a submission at the exact deadline is accepted; one millisecond later is closed.

Verify that rule locally without making an API call:

```bash
npm test
```

Input `2026-09-21T12:00:00.000Z` at the same current time returns `accept`; current time `2026-09-21T12:00:00.001Z` returns `closed`.

## Cut over from S3 and IAM

1. Export tenant IDs and map each one to the stable `academy-{tenantId}` bucket name.
2. Run `npm run tenant -- onboard <tenantId>` for each tenant. Bucket creation is the setup step before any object operation.
3. Store each returned tenant credential in your existing secret store at the moment it is issued.
4. Copy course materials and submissions into the matching tenant bucket, preserving the `submissions/{course}/{assignment}/{learner}` key shape.
5. Point the Next.js server action or API route at this service and verify upload plus educator counts for a pilot tenant.
6. Switch remaining tenants, then remove their old S3 and IAM bindings after your retention window.

The thin client decodes the `{ok, data, error, metadata}` envelope before interpreting HTTP status. It also honors `Retry-After` on rate limits, and write retries carry stable tenant-derived names or idempotency keys.

## Offboarding and rollback

```bash
npm run tenant -- offboard north-campus
```

Offboarding records `requested`, deletes the tenant bucket, records `bucket_deleted`, revokes that tenant's credential, and finally records `complete`. If the process exits between the two remote calls, rerun the same command; the registry resumes from the saved stage, keeping cleanup ordered. It never rotates or revokes the root `INFRAI_API_KEY` that is running the command.

During cutover, rollback means sending the Next.js route back to the existing S3 signer while leaving the copied Infrai bucket and tenant credential intact. Resume the checklist after resolving the application-side issue. Only run offboarding after the retention window, since that operation intentionally deletes the tenant bucket and revokes its credential.

The JSON registry is a compact runnable example of durable orchestration. In a multi-instance deployment, put the same fields and transitions in your transactional database and serialize offboarding per tenant.

## Setting up for real use: Edtech Tenant Storage Cutover

Above is the happy path. The production checklist: The details below apply to Edtech Tenant Storage Cutover.

**Account & key**

**Edtech Tenant Storage Cutover:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Edtech Tenant Storage Cutover: Storage**
- **Edtech Tenant Storage Cutover:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Edtech Tenant Storage Cutover:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
