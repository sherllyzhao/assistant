import { describe, expect, it } from "vitest";
import {
  calculateChecksum,
  createSyncEnvelope,
  createTombstone,
  getEmbeddedImageUsage,
  mergeSyncData,
  normalizeSyncData,
  validateEmbeddedImageLimits,
} from "../src/lib/syncModel.js";
import { createDataExport, validateDataImport } from "../src/lib/dataPortability.js";

describe("syncModel", () => {
  it("normalizes all V3 collections", () => {
    const data = normalizeSyncData({ tasks: [{ id: "task-1" }] });

    expect(data.tasks).toHaveLength(1);
    expect(data.tools).toEqual([]);
    expect(data.habits).toEqual([]);
    expect(data.vaultCandidates).toEqual([]);
    expect(data.tombstones).toEqual([]);
  });

  it("keeps the newest entity and honors tombstones", () => {
    const merged = mergeSyncData(
      { tasks: [{ id: "task-1", title: "cloud", updatedAt: "2026-07-16T01:00:00.000Z" }] },
      {
        tasks: [{ id: "task-1", title: "local", updatedAt: "2026-07-16T02:00:00.000Z" }],
        tombstones: [createTombstone("tasks", "task-1", "device-a", new Date("2026-07-16T03:00:00.000Z"))],
      },
    );

    expect(merged.tasks).toEqual([]);
    expect(merged.tombstones).toHaveLength(1);
  });

  it("produces stable checksums and envelopes", async () => {
    const left = { tasks: [{ id: "task-1", title: "A" }], settings: { soundEnabled: false } };
    const right = { settings: { soundEnabled: false }, tasks: [{ title: "A", id: "task-1" }] };

    expect(await calculateChecksum(left)).toBe(await calculateChecksum(right));

    const envelope = await createSyncEnvelope(left, { revision: 4, deviceId: "device-a" });
    expect(envelope.revision).toBe(4);
    expect(envelope.schemaVersion).toBe(3);
    expect(envelope.checksum).toMatch(/^sha256:/);
  });

  it("measures embedded images and rejects configured limits", () => {
    const data = {
      tasks: [{
        id: "task-1",
        attachments: [{ id: "attachment-1", path: "data:image/png;base64,AAAA" }],
      }],
    };
    const limits = { perAttachmentBytes: 2, perTaskBytes: 10, accountBytes: 10 };

    expect(getEmbeddedImageUsage(data, limits).totalBytes).toBe(3);
    expect(validateEmbeddedImageLimits(data, limits)).toMatchObject({
      ok: false,
      code: "EMBEDDED_IMAGE_ATTACHMENT_LIMIT",
    });
  });

  it("exports and validates a checksum-protected document", async () => {
    const exported = await createDataExport(
      { tasks: [{ id: "task-1", title: "导出测试" }] },
      { revision: 7, appVersion: "3.0.0" },
    );
    const validated = await validateDataImport(exported);

    expect(validated.envelope.revision).toBe(7);
    expect(validated.statistics.tasks).toBe(1);

    await expect(validateDataImport({
      ...exported,
      envelope: { ...exported.envelope, checksum: "sha256:invalid" },
    })).rejects.toThrow("checksum");
  });
});
