// @vitest-environment jsdom
// E3: owner request flow. The request goes out only with a pin, a service and a
// vehicle; it carries an idempotency key; a failed send says nothing was requested.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const nav = { goBack: vi.fn(), replace: vi.fn(), navigate: vi.fn(), popToTop: vi.fn() };
vi.mock("@react-navigation/native", () => ({ useNavigation: () => nav, useRoute: () => ({ params: { serviceType: "tyre" } }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("../../src/components/map/RealMap", () => ({ default: () => null }));
vi.mock("../../src/components/ui/SafetyActions", () => ({ default: () => null }));
vi.mock("../../src/components/ui/OwnerJobSafeguards", () => ({ default: () => null }));
vi.mock("../../src/features/account/AddVehicleModal", () => ({ default: () => null }));
vi.mock("../../src/features/shared/ownerData", () => ({ QK: { jobs: ["owner", "jobs"] } }));
vi.mock("../../src/store/jobStore", () => ({ useJobStore: () => ({ setStartCode: vi.fn() }) }));

const loc = vi.hoisted(() => ({
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  watchPositionAsync: vi.fn(),
  reverseGeocodeAsync: vi.fn(async () => [{ name: "MG Road", city: "Bengaluru" }]),
  Accuracy: { BestForNavigation: 6 },
}));
vi.mock("expo-location", () => loc);

const createJob = vi.fn();
vi.mock("../../src/services/api/jobs", () => ({
  jobsApi: { createJob: (...a: any[]) => createJob(...a), getJob: vi.fn(() => new Promise(() => {})), getScheduleSlots: vi.fn(async () => ({ slots: [{ start: "2026-11-22T04:30:00Z", end: "2026-11-22T06:30:00Z", label: "x" }], release_lead_min: 45 })),
             retrySearch: vi.fn(), cancelJob: vi.fn(), getRatings: vi.fn(), submitRating: vi.fn() },
}));
vi.mock("../../src/services/api/services", () => ({
  servicesApi: { listServices: async () => [
    { id: 1, code: "flat_tyre", name: "Flat tyre", requires_vehicle_equipment: false, base_price: 400,
      category_id: 1, category_code: "tyre", category_name: "Tyre" }] },
}));
let garage: any[] = [];
vi.mock("../../src/services/api/vehicles", () => ({ vehiclesApi: { fetchVehicles: async () => garage } }));
const alert = vi.fn();
// ADR-055 photos: the picker is native; the upload is checked through its module.
vi.mock("expo-image-picker", () => ({}));
vi.mock("../../src/features/jobs/photos/JobPhotoStrip", () => ({ default: () => null, OwnerIssuePhotos: () => null }));
vi.mock("../../src/features/jobs/contact/JobChatModal", () => ({ default: () => null }));
vi.mock("../../src/features/jobs/contact/useJobContact", () => ({ isActiveStatus: () => false, useShareOwnerLocation: () => false, useJobChat: () => ({ items: [], canSend: false, error: false, send: async () => undefined, unread: 0 }) }));
const uploadIssuePhotos = vi.fn(async () => ({ sent: 1, failed: 0 }));
vi.mock("../../src/features/jobs/photos/issuePhotos", () => ({ MAX_ISSUE_PHOTOS: 3, uploadIssuePhotos: (...a: unknown[]) => uploadIssuePhotos(...(a as [])) }));

// Screens report failures through the in-app dialog; capture its calls.
vi.mock("../../src/components/ui/AppDialog", () => ({ showDialog: (...a: any[]) => alert(...a) }));

import OwnerHelpFlowScreen from "../../src/features/jobs/screens/OwnerHelpFlowScreen";

const car = { id: "v1", user_id: "u", make: "Maruti", model: "Swift", vehicle_number: "KA01AB1234",
              vehicle_type: "four_wheeler", created_at: "" };

beforeEach(() => {
  vi.clearAllMocks();
  garage = [car];
  loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  loc.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 12.97, longitude: 77.59, accuracy: 10 } });
});
afterEach(cleanup);

const sendButton = () => screen.getByText("Get help now");

describe("OwnerHelpFlowScreen", () => {
  it("sends one request with pin, service, vehicle and an idempotency key, then searches", async () => {
    createJob.mockResolvedValue({ id: "j1", status: "matching" });
    render(<OwnerHelpFlowScreen />);
    await waitFor(() => expect(loc.reverseGeocodeAsync).toHaveBeenCalled());
    await screen.findByText(/KA01AB1234/);
    fireEvent.click(sendButton());
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1));
    const [body, key] = createJob.mock.calls[0];
    expect(body).toMatchObject({ vehicle_id: "v1", service_code: "flat_tyre", pickup_lat: 12.97, pickup_lng: 77.59 });
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(8);
    await screen.findByText("Finding a partner");
  });

  it("does not send without a vehicle", async () => {
    garage = [];
    render(<OwnerHelpFlowScreen />);
    await screen.findByText("Add your vehicle");
    await waitFor(() => expect(loc.reverseGeocodeAsync).toHaveBeenCalled());
    fireEvent.click(sendButton());
    expect(createJob).not.toHaveBeenCalled();
  });

  it("does not send without a location, and says why", async () => {
    loc.requestForegroundPermissionsAsync.mockResolvedValue({ status: "denied" });
    render(<OwnerHelpFlowScreen />);
    await screen.findByText(/Location access is off/);
    await screen.findByText(/KA01AB1234/);
    fireEvent.click(sendButton());
    expect(createJob).not.toHaveBeenCalled();
  });

  it("a failed send tells the owner nothing was requested and stays on the form", async () => {
    createJob.mockRejectedValue(new Error("offline"));
    render(<OwnerHelpFlowScreen />);
    await waitFor(() => expect(loc.reverseGeocodeAsync).toHaveBeenCalled());
    await screen.findByText(/KA01AB1234/);
    fireEvent.click(sendButton());
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0][0]).toBe("Request not sent");
    expect(screen.queryByText("Finding a partner")).toBeNull();
  });

  it("no photos means no upload call", async () => {
    createJob.mockResolvedValue({ id: "j2", status: "matching" });
    render(<OwnerHelpFlowScreen />);
    await waitFor(() => expect(loc.reverseGeocodeAsync).toHaveBeenCalled());
    await screen.findByText(/KA01AB1234/);
    fireEvent.click(sendButton());
    await screen.findByText("Finding a partner");
    expect(uploadIssuePhotos).not.toHaveBeenCalled();
  });

  it("the two flows are different screens: booking leads with the time and will not send without one", async () => {
    render(<OwnerHelpFlowScreen />);
    await screen.findByText(/KA01AB1234/);
    fireEvent.click(screen.getByText("Book later"));
    await screen.findByText("Book a service");
    expect(screen.getByText("Pick a time")).toBeTruthy();
    fireEvent.click(screen.getByText("Pick a time"));
    expect(createJob).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Help now"));
    await screen.findByText("Roadside help");
  });
});

