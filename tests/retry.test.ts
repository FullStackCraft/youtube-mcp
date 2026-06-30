import { describe, expect, it, vi } from "vitest";
import { normalizeGoogleError, withReadRetry } from "../src/google/retry.js";

describe("Google error normalization and retry", () => {
  it("maps quota and scope errors to stable codes", () => {
    expect(
      normalizeGoogleError({
        response: { status: 403, data: { error: { errors: [{ reason: "quotaExceeded" }] } } },
      }),
    ).toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(normalizeGoogleError({ response: { status: 403, data: { error: { errors: [] } } } })).toMatchObject({
      code: "INSUFFICIENT_SCOPE",
    });
    expect(normalizeGoogleError({ response: { status: 401 } })).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("retries transient reads but not non-retriable failures", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const transient = vi
      .fn()
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValue("ok");
    await expect(withReadRetry(transient, 2)).resolves.toBe("ok");
    expect(transient).toHaveBeenCalledTimes(2);

    const forbidden = vi.fn().mockRejectedValue({ response: { status: 403 } });
    await expect(withReadRetry(forbidden, 3)).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE" });
    expect(forbidden).toHaveBeenCalledTimes(1);
  });
});
