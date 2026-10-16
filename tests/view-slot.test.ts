import { expect, test, vi } from "vitest";
import { createViewSlot } from "../modules/shell/view-slot";
import type { Host } from "../modules/extension-host/host";
test("view replacement waits for async cleanup; failed roots are fenced and fresh recovery roots work", async () => {
  let release!: () => void;
  const close = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const mountView = vi.fn(() => close);
  const slot = createViewSlot({ mountView } as unknown as Host);
  await slot.show("one", {} as HTMLElement);
  const clear = slot.clear();
  const root = {} as HTMLElement;
  const show = slot.show("two", root);
  await vi.waitFor(() => expect(close).toHaveBeenCalled());
  expect(mountView).toHaveBeenCalledTimes(1);
  release();
  await Promise.all([clear, show]);
  expect(mountView).toHaveBeenCalledTimes(2);
  close.mockImplementationOnce(() => Promise.reject(Error("release failed")));
  await expect(slot.clear()).rejects.toThrow("release failed");
  await expect(slot.show("three", root)).rejects.toThrow("release failed");
  expect(mountView).toHaveBeenCalledTimes(2);
  await slot.show("recovery", {} as HTMLElement);
  expect(mountView).toHaveBeenCalledTimes(3);
});
