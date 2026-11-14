// @vitest-environment jsdom
// E3: partner offer flow. Accept / decline call the API and route correctly;
// the error codes the backend returns map to the right message.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const nav = { goBack: vi.fn(), replace: vi.fn(), navigate: vi.fn() };
let params: any = {};
vi.mock("@react-navigation/native", () => ({ useNavigation: () => nav, useRoute: () => ({ params }) }));
const respond = vi.fn();
vi.mock("../../src/services/api/jobs", () => ({ jobsApi: { respondToAssignment: (...a: any[]) => respond(...a) } }));
const alert = vi.fn();
vi.mock("react-native-web", async (orig) => {
  const rn: any = await orig();
  return { ...rn, Alert: { alert: (...a: any[]) => alert(...a) } };
});

import IncomingOfferScreen from "../../src/features/partner/screens/IncomingOfferScreen";

const offer = {
  assignment_id: "a1", job_id: "j1", offered_at: new Date().toISOString(),
  distance_at_offer_m: 2400, estimated_arrival_min: 9,
  job: { service_code: "FLAT_TYRE", service_name: "Flat tyre", vehicle_number: "KA01AB1234",
         pickup_address_text: "MG Road", price_estimate: 450, issue_description: null },
};
const apiError = (code: string) => ({ response: { data: { error: { code } } } });

beforeEach(() => { vi.clearAllMocks(); params = { offerData: offer, assignmentId: "a1" }; });
afterEach(cleanup);

describe("IncomingOfferScreen", () => {
  it("shows only what the offer carries", () => {
    render(<IncomingOfferScreen />);
    expect(screen.getByText("KA01AB1234")).toBeTruthy();
    expect(screen.getByText("MG Road")).toBeTruthy();
    expect(screen.getByText("9 min ETA")).toBeTruthy();
  });

  it("with no offer payload, invents nothing and offers a way back", () => {
    params = {};
    render(<IncomingOfferScreen />);
    expect(screen.getByText("Offer unavailable")).toBeTruthy();
    expect(screen.queryByText("MG Road")).toBeNull();
    fireEvent.click(screen.getByText("Back to dashboard"));
    expect(nav.goBack).toHaveBeenCalled();
  });

  it("accept calls the API and opens the active job", async () => {
    respond.mockResolvedValue({});
    render(<IncomingOfferScreen />);
    fireEvent.click(screen.getByText(/Accept Job/));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("ActiveJob", { jobId: "j1" }));
    expect(respond).toHaveBeenCalledWith("a1", "accept");
  });

  it.each([
    ["PARTNER_AT_CAPACITY", "Limit reached"],
    ["ASSIGNMENT_ALREADY_ANSWERED", "Offer expired"],
    ["SOMETHING_ELSE", "Could not accept"],
  ])("accept failing with %s says %s and does not open the job", async (code, title) => {
    respond.mockRejectedValue(apiError(code));
    render(<IncomingOfferScreen />);
    fireEvent.click(screen.getByText(/Accept Job/));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0][0]).toBe(title);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("decline records a rejection and leaves", async () => {
    respond.mockResolvedValue({});
    render(<IncomingOfferScreen />);
    fireEvent.click(screen.getByText("Decline"));
    await waitFor(() => expect(nav.goBack).toHaveBeenCalled());
    expect(respond).toHaveBeenCalledWith("a1", "reject", "Partner declined");
  });

  it("decline on an already-answered offer still leaves; other failures stay", async () => {
    respond.mockRejectedValueOnce(apiError("ASSIGNMENT_ALREADY_ANSWERED"));
    render(<IncomingOfferScreen />);
    fireEvent.click(screen.getByText("Decline"));
    await waitFor(() => expect(nav.goBack).toHaveBeenCalled());
    cleanup(); vi.clearAllMocks();
    respond.mockRejectedValueOnce(apiError("NETWORK"));
    render(<IncomingOfferScreen />);
    fireEvent.click(screen.getByText("Decline"));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0][0]).toBe("Could not decline");
    expect(nav.goBack).not.toHaveBeenCalled();
  });
});
