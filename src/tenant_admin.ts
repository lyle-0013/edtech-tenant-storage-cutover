import { z } from "zod";
import { CourseDelivery } from "./course_delivery.js";
import { TenantRegistry } from "./tenant_registry.js";

const commandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("onboard"), tenantId: z.string() }),
  z.object({ command: z.literal("offboard"), tenantId: z.string() }),
]);

const command = commandSchema.parse({ command: process.argv[2], tenantId: process.argv[3] });
const registry = new TenantRegistry(process.env.TENANT_REGISTRY_PATH ?? ".data/tenants.json");
const delivery = new CourseDelivery(registry);

if (command.command === "onboard") {
  const result = await delivery.onboard(command.tenantId);
  console.log(JSON.stringify(result, null, 2));
  console.error("Store the returned credential now; its plaintext cannot be retrieved again.");
} else {
  console.log(JSON.stringify(await delivery.offboard(command.tenantId), null, 2));
}
