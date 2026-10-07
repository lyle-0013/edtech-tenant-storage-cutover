import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type TenantRecord = {
  tenantId: string;
  bucket: string;
  credentialId: string;
  offboarding: "active" | "requested" | "bucket_deleted" | "complete";
};

type RegistryData = { tenants: Record<string, TenantRecord> };

export class TenantRegistry {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async get(tenantId: string): Promise<TenantRecord | undefined> {
    return (await this.read()).tenants[tenantId];
  }

  async put(record: TenantRecord): Promise<void> {
    const data = await this.read();
    data.tenants[record.tenantId] = record;
    await this.write(data);
  }

  private async read(): Promise<RegistryData> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as RegistryData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { tenants: {} };
      throw error;
    }
  }

  private async write(data: RegistryData): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", "utf8");
    await rename(temporary, this.path);
  }
}
