import { describe, it, expect } from "vitest";
import { isNoSignal, RetryStopped, sendWithRetry } from "../src/features/jobs/sendRetry";

const offline = Object.assign(new Error("Network Error"), { isAxiosError: true });
const refused = Object.assign(new Error("400"), { isAxiosError: true, response: { status: 400 } });

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

describe("sendWithRetry (G11)", () => {
  it("only an error with no response counts as no signal", () => {
    expect(isNoSignal(offline)).toBe(true);
    expect(isNoSignal(refused)).toBe(false);
    expect(isNoSignal(null)).toBe(false);
  });

  it("resends until the request lands", async () => {
    const c = clock();
    let calls = 0;
    const res = await sendWithRetry(async () => {
      calls += 1;
      if (calls < 3) throw offline;
      return "job-1";
    }, { ...c, intervalMs: 5000, windowMs: 60000 });
    expect(res).toBe("job-1");
    expect(calls).toBe(3);
  });

  it("never retries a request the server answered, even with an error", async () => {
    let calls = 0;
    await expect(sendWithRetry(async () => { calls += 1; throw refused; }, clock())).rejects.toBe(refused);
    expect(calls).toBe(1);
  });

  it("gives up when the window closes", async () => {
    const c = clock();
    let calls = 0;
    await expect(sendWithRetry(async () => { calls += 1; throw offline; }, { ...c, intervalMs: 5000, windowMs: 20000 }))
      .rejects.toBe(offline);
    expect(calls).toBe(4);
  });

  it("stops when the owner taps Stop", async () => {
    const c = clock();
    let stop = false;
    const p = sendWithRetry(async () => { stop = true; throw offline; }, { ...c, stopped: () => stop });
    await expect(p).rejects.toBeInstanceOf(RetryStopped);
  });
});
