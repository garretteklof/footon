import { describe, expect, test } from "bun:test";
import { Garmin, MemoryTokenStore } from "@footon/garmin";
import { exercise } from "@footon/garmin/exercises";

describe("Garmin workspace package", () => {
  test("resolves both public entry points from fueld_b", () => {
    const client = new Garmin({ tokenStore: new MemoryTokenStore() });

    expect(typeof client.wellness.sleep).toBe("function");
    expect(exercise("SQUAT", "BARBELL_BACK_SQUAT").name).toBe("BARBELL_BACK_SQUAT");
  });
});
