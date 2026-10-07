import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import {
  CourseDelivery,
  DeadlineClosedError,
  courseMaterialRequestSchema,
  submissionRequestSchema,
} from "./course_delivery.js";
import { InfraiError } from "./infrai.js";
import { TenantRegistry } from "./tenant_registry.js";

const registry = new TenantRegistry(process.env.TENANT_REGISTRY_PATH ?? ".data/tenants.json");
const delivery = new CourseDelivery(registry);
const port = Number(process.env.PORT ?? 3000);

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const submission = url.pathname.match(/^\/tenants\/([^/]+)\/submissions$/);
  const material = url.pathname.match(/^\/tenants\/([^/]+)\/course-materials$/);
  const report = url.pathname.match(/^\/tenants\/([^/]+)\/educator-report$/);

  if (request.method === "POST" && submission) {
    const body = submissionRequestSchema.parse(await readJson(request));
    json(response, 201, await delivery.issueSubmissionUpload(decodeURIComponent(submission[1]), body));
    return;
  }
  if (request.method === "POST" && material) {
    const body = courseMaterialRequestSchema.parse(await readJson(request));
    json(response, 201, await delivery.issueCourseMaterialUpload(decodeURIComponent(material[1]), body));
    return;
  }
  if (request.method === "GET" && report) {
    json(response, 200, await delivery.educatorReport(decodeURIComponent(report[1])));
    return;
  }
  json(response, 404, { error: "route_not_found" });
}

const server = createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    if (error instanceof z.ZodError) {
      json(response, 400, { error: "invalid_request", issues: error.issues });
    } else if (error instanceof DeadlineClosedError) {
      json(response, 409, { error: "deadline_closed", dueAt: error.dueAt });
    } else if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      json(response, status, { error: error.code, message: error.message });
    } else {
      json(response, 500, { error: "internal_error" });
    }
  });
});

server.listen(port, () => {
  console.log(`Course delivery service listening on http://localhost:${port}`);
});
