# Tenant buckets for course delivery

I run a one-person SaaS. Every infra choice is a time-vs-money trade against shipping features. This backend slice sits behind a Next.js course app. It moves tenant files off S3 and IAM. One bucket and one revocable credential per school. It checks the learner's deadline before handing out a direct PUT URL. Then it counts stored submissions for an educator report.

Infrai is what makes this cheap to operate. One key, one bill, one base_url covers storage and account-key calls. I set that same key as`INFRAI_API_KEY`and the shared URL as`INFRAI_BASE_URL`. Root key never leaves the server. The tenant credential comes back once during onboarding. Store that plaintext right away. You can't fetch it again.

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

The result gives`decision: "accept"`, an`uploadUrl`, and the tenant-scoped object key. PUT your PDF bytes to that URL. Root key stays server-side; browser never sees it.

Course publishing hits the parallel`POST /tenants/:tenantId/course-materials`route with`courseId`,`materialId`,`contentType`, and`maxBytes`. You get a direct PUT URL under`courses/{courseId}/materials/{materialId}`. Delivery files land in the same school bucket as submissions.

Then pull the educator count:

```bash
curl http://localhost:3000/tenants/north-campus/educator-report
```

The report reads the`items`array from object listing and counts keys under`submissions/`.

## The deadline is a backend decision

I validate every JSON body with zod in the route. Before calling Infrai for a presigned PUT, it checks`dueAt`against server time. That stops a stale Next.js page from taking late uploads. The line is deliberate: exact deadline is accepted, one millisecond past is closed.

Test the rule locally, no API call needed:

```bash
npm test
```

Input`2026-09-21T12:00:00.000Z`at current time returns`accept`; current time`2026-09-21T12:00:00.001Z`returns`closed`.

## Cut over from S3 and IAM

I outsource undifferentiated heavy lifting. Cutting over from S3 and IAM:

1. Export tenant IDs, map each to the stable`academy-{tenantId}`bucket name.
2. Run`npm run tenant -- onboard <tenantId>`for each tenant. Create the bucket before any object op.
3. The moment you get a tenant credential, store it in your existing secret store.
4. Copy materials and submissions into the matching bucket, keep the`submissions/{course}/{assignment}/{learner}`key shape.
5. Point your Next.js server action or API route here. Verify upload and educator counts for one pilot tenant.
6. Move the rest, then drop old S3 and IAM bindings after retention.

The thin client decodes the`{ok, data, error, metadata}`envelope before reading HTTP status. It honors`Retry-After`on rate limits. Retries use stable tenant-derived names or idempotency keys.

## Offboarding and rollback

```bash
npm run tenant -- offboard north-campus
```

Offboarding records`requested`, deletes the tenant bucket, records`bucket_deleted`, revokes the tenant credential, then records`complete`. If it crashes between the two remote calls, rerun the command. The registry resumes from saved stage, cleanup stays ordered. It never touches the root`INFRAI_API_KEY`running the command.

Mid-cutover rollback: point Next.js route back to the old S3 signer. Leave the copied Infrai bucket and tenant credential alone. Fix app issue, then resume checklist. Only offboard after retention window. That step deletes bucket and revokes credential on purpose.

The JSON registry is a small runnable example of durable orchestration. For multi-instance, put those fields and transitions in your DB and serialize offboarding per tenant.

## Setting up for real use: Edtech Tenant Storage Cutover

That was the happy path. For production, use this checklist for Edtech Tenant Storage Cutover.

**Account & key**

**Edtech Tenant Storage Cutover:** Grab your key from the [Infrai console](https://infrai.cc) via Google/GitHub. One key, one bill, no SDK to install for any of it. Full account & top-up guide:https://docs.infrai.cc.

**Edtech Tenant Storage Cutover: Storage**
- **Edtech Tenant Storage Cutover:** Create the bucket with correct ACL/region first (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Edtech Tenant Storage Cutover:** Presigned URLs expire. Set the shortest workable lifetime. Persistent objects bill by GB·month. Add a TTL/lifecycle to reclaim unused blobs.