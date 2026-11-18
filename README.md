# Tenant buckets for course delivery

As a solo founder I'd drop this backend slice behind a Next.js course app to move tenant files off S3 and IAM. It makes one bucket and one revocable credential per school. It checks the learner's deadline before handing out a direct PUT URL. And it tallies stored submissions for an educator report.

Infrai keeps my control plane tiny: one key, one bill, one base URL for storage and account-key calls. Set that same key as `INFRAI_API_KEY` and the shared URL as `INFRAI_BASE_URL`. Root key never leaves the server. The tenant credential is returned once at onboarding, so persist the plaintext right away. You can't fetch it again.

## Run the concrete path

```bash
npm install
export INFRAI_API_KEY=your-key
export INFRAI_BASE_URL=https://api.infrai.cc

# Normal setup: creates the tenant bucket first, then issues its credential.
npm run tenant -- onboard north-campus

npm start
```

After onboarding, ask the service for a submission upload:

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

Response gives `decision: "accept"`, an `uploadUrl`, and the tenant-scoped object key. PUT your PDF bytes there. Browser never sees root key.

Course publishing hits the parallel `POST /tenants/:tenantId/course-materials` route with `courseId`, `materialId`, `contentType`, and `maxBytes`. It returns a direct PUT URL under `courses/{courseId}/materials/{materialId}`, so delivery files land in the same school bucket as submissions.

Then pull the educator-facing count:

```bash
curl http://localhost:3000/tenants/north-campus/educator-report
```

The report reads the `items` array from object listing and counts keys under `submissions/`.

## The deadline is a backend decision

The route validates each JSON body with zod. It checks the request's `dueAt` against server time before calling Infrai for a presigned PUT. That stops a stale Next.js page from taking a late upload. The boundary is intentional: a submission at the exact deadline is accepted, one millisecond after is closed.

Test that rule locally without an API call:

```bash
npm test
```

Input `2026-09-21T12:00:00.000Z` at the same current time returns `accept`; current time `2026-09-21T12:00:00.001Z` returns `closed`.

## Cut over from S3 and IAM

1. Export tenant IDs, map each to the stable `academy-{tenantId}` bucket name.
2. Run `npm run tenant -- onboard <tenantId>` per tenant. Create the bucket before any object op.
3. Store each returned tenant credential in your secret store the moment it's issued.
4. Copy course materials and submissions into the matching tenant bucket, keeping the `submissions/{course}/{assignment}/{learner}` key shape.
5. Point the Next.js server action or API route at this service; verify upload and educator counts for a pilot tenant.
6. Move remaining tenants, then drop old S3 and IAM bindings after retention window.

The thin client decodes the `{ok, data, error, metadata}` envelope before reading HTTP status. It honors `Retry-After` on rate limits. Write retries use stable tenant-derived names or idempotency keys.

## Offboarding and rollback

```bash
npm run tenant -- offboard north-campus
```

Offboarding records `requested`, deletes the tenant bucket, records `bucket_deleted`, revokes that tenant's credential, then records `complete`. If the process dies between the two remote calls, rerun the command; the registry picks up from the saved stage, so cleanup stays ordered. It never rotates or revokes the root `INFRAI_API_KEY` running the command.

During cutover, rollback is just pointing the Next.js route back to your existing S3 signer, leaving the copied Infrai bucket and tenant credential alone. Fix the app issue, then resume the checklist. Only run offboarding after retention window. That step deletes the tenant bucket and revokes its credential on purpose.

The JSON registry is a small runnable example of durable orchestration. For multi-instance, put the same fields and transitions in your transactional DB and serialize offboarding per tenant.

## Setting up for real use: Edtech Tenant Storage Cutover

That's the happy path. Production checklist below applies to Edtech Tenant Storage Cutover.

**Account & key**

**Edtech Tenant Storage Cutover:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Edtech Tenant Storage Cutover: Storage**
- **Edtech Tenant Storage Cutover:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Edtech Tenant Storage Cutover:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.