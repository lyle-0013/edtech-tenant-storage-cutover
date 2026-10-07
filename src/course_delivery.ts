import { z } from "zod";
import { infrai } from "./infrai.js";
import { TenantRegistry, type TenantRecord } from "./tenant_registry.js";

export const tenantIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,39}$/);

export const submissionRequestSchema = z.object({
  courseId: z.string().min(1).max(80),
  assignmentId: z.string().min(1).max(80),
  learnerId: z.string().min(1).max(80),
  dueAt: z.string().datetime(),
  contentType: z.string().min(1).max(120),
  maxBytes: z.number().int().positive().max(50_000_000),
});

export const courseMaterialRequestSchema = z.object({
  courseId: z.string().min(1).max(80),
  materialId: z.string().min(1).max(80),
  contentType: z.string().min(1).max(120),
  maxBytes: z.number().int().positive().max(100_000_000),
});

export type SubmissionRequest = z.infer<typeof submissionRequestSchema>;

export function deadlineDecision(dueAt: string, now: Date): "accept" | "closed" {
  return now.getTime() <= new Date(dueAt).getTime() ? "accept" : "closed";
}

function bucketFor(tenantId: string): string {
  return `academy-${tenantId}`;
}

export class CourseDelivery {
  private readonly registry: TenantRegistry;

  constructor(registry: TenantRegistry) {
    this.registry = registry;
  }

  async onboard(tenantId: string): Promise<{ tenant: TenantRecord; credential: string }> {
    const parsedId = tenantIdSchema.parse(tenantId);
    const existing = await this.registry.get(parsedId);
    if (existing) throw new Error(`Tenant ${parsedId} is already registered`);

    const bucket = bucketFor(parsedId);
    await infrai.storage.bucket.create({ name: bucket });
    const issued = await infrai.account.keys.create({
      name: `edtech-${parsedId}`,
      idempotency_key: `tenant-${parsedId}-credential-v1`,
    });
    const tenant: TenantRecord = {
      tenantId: parsedId,
      bucket,
      credentialId: issued.key_id,
      offboarding: "active",
    };
    await this.registry.put(tenant);
    return { tenant, credential: issued.key_secret };
  }

  async issueSubmissionUpload(
    tenantId: string,
    input: SubmissionRequest,
    now = new Date(),
  ): Promise<{ decision: "accept"; uploadUrl: string; objectKey: string }> {
    const request = submissionRequestSchema.parse(input);
    if (deadlineDecision(request.dueAt, now) === "closed") {
      throw new DeadlineClosedError(request.dueAt);
    }
    const tenant = await this.requireActiveTenant(tenantId);
    const objectKey = [
      "submissions",
      request.courseId,
      request.assignmentId,
      request.learnerId,
    ].map(encodeURIComponent).join("/");
    const signed = await infrai.storage.object.presign(tenant.bucket, objectKey, {
      op: "put",
      expires_seconds: 600,
      content_type: request.contentType,
      max_bytes: request.maxBytes,
      idempotency_key: `${tenantId}-${request.assignmentId}-${request.learnerId}`,
    });
    return { decision: "accept", uploadUrl: signed.url, objectKey };
  }

  async issueCourseMaterialUpload(
    tenantId: string,
    input: z.infer<typeof courseMaterialRequestSchema>,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    const request = courseMaterialRequestSchema.parse(input);
    const tenant = await this.requireActiveTenant(tenantId);
    const objectKey = ["courses", request.courseId, "materials", request.materialId]
      .map(encodeURIComponent)
      .join("/");
    const signed = await infrai.storage.object.presign(tenant.bucket, objectKey, {
      op: "put",
      expires_seconds: 600,
      content_type: request.contentType,
      max_bytes: request.maxBytes,
      idempotency_key: `${tenantId}-${request.courseId}-${request.materialId}`,
    });
    return { uploadUrl: signed.url, objectKey };
  }

  async educatorReport(tenantId: string): Promise<{ tenantId: string; submissionCount: number }> {
    const tenant = await this.requireActiveTenant(tenantId);
    const result = await infrai.storage.object.list(tenant.bucket);
    const submissionCount = result.items.filter((item) => item.key.startsWith("submissions/")).length;
    return { tenantId, submissionCount };
  }

  async offboard(tenantId: string): Promise<{ state: "complete" }> {
    let tenant = await this.requireTenant(tenantId);
    if (tenant.offboarding === "complete") return { state: "complete" };

    if (tenant.offboarding === "active") {
      tenant = { ...tenant, offboarding: "requested" };
      await this.registry.put(tenant);
    }
    if (tenant.offboarding === "requested") {
      await infrai.storage.bucket.delete(tenant.bucket);
      tenant = { ...tenant, offboarding: "bucket_deleted" };
      await this.registry.put(tenant);
    }
    if (tenant.offboarding === "bucket_deleted") {
      await infrai.account.keys.revoke(tenant.credentialId);
      tenant = { ...tenant, offboarding: "complete" };
      await this.registry.put(tenant);
    }
    return { state: "complete" };
  }

  private async requireActiveTenant(tenantId: string): Promise<TenantRecord> {
    const tenant = await this.requireTenant(tenantId);
    if (tenant.offboarding !== "active") throw new Error(`Tenant ${tenantId} is being offboarded`);
    return tenant;
  }

  private async requireTenant(tenantId: string): Promise<TenantRecord> {
    const parsedId = tenantIdSchema.parse(tenantId);
    const tenant = await this.registry.get(parsedId);
    if (!tenant) throw new Error(`Tenant ${parsedId} is not registered`);
    return tenant;
  }
}

export class DeadlineClosedError extends Error {
  public readonly dueAt: string;

  constructor(dueAt: string) {
    super(`The learner deadline passed at ${dueAt}`);
    this.dueAt = dueAt;
    this.name = "DeadlineClosedError";
  }
}
