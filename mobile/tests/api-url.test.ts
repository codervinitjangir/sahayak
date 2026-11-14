import { describe, it, expect } from "vitest";
import { withApiPrefix } from "../src/utils/apiUrl";

describe("withApiPrefix", () => {
  it("adds /api/v1 to a bare host (the broken .env that 404ed every call)", () => {
    expect(withApiPrefix("http://192.168.1.55:8010")).toBe("http://192.168.1.55:8010/api/v1");
  });
  it("leaves a correct URL alone", () => {
    expect(withApiPrefix("http://localhost:8010/api/v1")).toBe("http://localhost:8010/api/v1");
  });
  it("tolerates a trailing slash and whitespace", () => {
    expect(withApiPrefix(" https://api.example.com/ ")).toBe("https://api.example.com/api/v1");
    expect(withApiPrefix("https://api.example.com/api/v1/")).toBe("https://api.example.com/api/v1");
  });
});
