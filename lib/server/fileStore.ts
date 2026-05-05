import { randomUUID } from "crypto";

export type StoredExport = {
  glb: Buffer;
  png: Buffer;
  meta: Record<string, unknown>;
};

const exportsStore = new Map<string, StoredExport>();

export function saveExport(bundle: StoredExport): string {
  const id = randomUUID();
  exportsStore.set(id, bundle);
  return id;
}

export function getExport(id: string): StoredExport | undefined {
  return exportsStore.get(id);
}
