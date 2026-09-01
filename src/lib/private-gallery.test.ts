import { describe, expect, it } from "vitest";

import {
  canTransitionPrivateGalleryState,
  isPrivateGalleryCustomerVisible,
  isPrivateGalleryState,
  PRIVATE_GALLERY_CUSTOMER_VISIBLE_STATES,
  PRIVATE_GALLERY_OBJECT_BEARING_STATES,
  PRIVATE_GALLERY_STATE_TRANSITIONS,
  PRIVATE_GALLERY_STATES,
  PRIVATE_GALLERY_TERMINAL_STATE,
  type PrivateGalleryState,
} from "@/lib/private-gallery";

describe("private gallery state machine (ADR-0014 §5, §7)", () => {
  it("lists exactly the nine ADR states", () => {
    expect([...PRIVATE_GALLERY_STATES]).toEqual([
      "draft",
      "preparing",
      "ready",
      "published",
      "access-suspended",
      "expiring",
      "deleting",
      "deleted",
      "deletion-failed",
    ]);
  });

  it("recognizes only a real state string", () => {
    expect(isPrivateGalleryState("published")).toBe(true);
    expect(isPrivateGalleryState("live")).toBe(false);
    expect(isPrivateGalleryState(undefined)).toBe(false);
    expect(isPrivateGalleryState(0)).toBe(false);
  });

  it("serves a customer only in published", () => {
    expect([...PRIVATE_GALLERY_CUSTOMER_VISIBLE_STATES]).toEqual(["published"]);
    for (const state of PRIVATE_GALLERY_STATES) {
      expect(isPrivateGalleryCustomerVisible(state)).toBe(state === "published");
    }
  });

  it("has a transition table covering every state as a key", () => {
    expect(Object.keys(PRIVATE_GALLERY_STATE_TRANSITIONS).sort()).toEqual(
      [...PRIVATE_GALLERY_STATES].sort(),
    );
    for (const targets of Object.values(PRIVATE_GALLERY_STATE_TRANSITIONS)) {
      for (const target of targets) {
        expect(isPrivateGalleryState(target)).toBe(true);
      }
    }
  });

  it("allows the ADR's publish path and revoke/replace loop", () => {
    expect(canTransitionPrivateGalleryState("draft", "preparing")).toBe(true);
    expect(canTransitionPrivateGalleryState("preparing", "ready")).toBe(true);
    expect(canTransitionPrivateGalleryState("ready", "published")).toBe(true);
    expect(
      canTransitionPrivateGalleryState("published", "access-suspended"),
    ).toBe(true);
    expect(
      canTransitionPrivateGalleryState("access-suspended", "published"),
    ).toBe(true);
  });

  it("lets a delete reach expiring from every object-bearing state, but not from draft", () => {
    for (const state of PRIVATE_GALLERY_OBJECT_BEARING_STATES) {
      expect(canTransitionPrivateGalleryState(state, "expiring")).toBe(true);
    }
    // `draft` holds no objects: removing an abandoned draft is a plain row
    // delete, not the object-retention lifecycle (ADR-0014 §7).
    expect(canTransitionPrivateGalleryState("draft", "expiring")).toBe(false);
    expect(PRIVATE_GALLERY_STATE_TRANSITIONS.draft).toEqual(["preparing"]);
  });

  it("drives retention forward only and never back to published", () => {
    expect(canTransitionPrivateGalleryState("expiring", "deleting")).toBe(true);
    expect(canTransitionPrivateGalleryState("deleting", "deleted")).toBe(true);
    expect(canTransitionPrivateGalleryState("deleting", "deletion-failed")).toBe(
      true,
    );
    expect(canTransitionPrivateGalleryState("deletion-failed", "deleting")).toBe(
      true,
    );

    const forbiddenReturns: PrivateGalleryState[] = [
      "expiring",
      "deleting",
      "deleted",
      "deletion-failed",
    ];
    for (const state of forbiddenReturns) {
      expect(canTransitionPrivateGalleryState(state, "published")).toBe(false);
    }
  });

  it("makes deleted terminal", () => {
    expect(PRIVATE_GALLERY_TERMINAL_STATE).toBe("deleted");
    expect(PRIVATE_GALLERY_STATE_TRANSITIONS.deleted).toEqual([]);
  });
});
