// Common Indian makes and models for the add-vehicle picker. Reference data
// only: the owner can always type a make or model that is not listed, and the
// backend stores whatever text they choose.
export type VehicleKind = "two_wheeler" | "four_wheeler";

export interface Brand {
  name: string;
  /** Brand colour for the wordmark tile. */
  color: string;
  models: string[];
}

export const BRANDS: Record<VehicleKind, Brand[]> = {
  two_wheeler: [
    { name: "Hero", color: "#E11D2E", models: ["Splendor Plus", "HF Deluxe", "Passion", "Glamour", "Xtreme 160R", "Xpulse 200", "Destini 125", "Pleasure+"] },
    { name: "Honda", color: "#CC0000", models: ["Activa", "Shine", "SP 125", "Unicorn", "Dio", "Hornet 2.0", "CB350"] },
    { name: "Bajaj", color: "#0B4EA2", models: ["Pulsar 150", "Pulsar NS200", "Platina", "CT 110", "Avenger", "Dominar 400", "Chetak"] },
    { name: "TVS", color: "#1E3A8A", models: ["Jupiter", "Apache RTR 160", "Raider 125", "Ntorq 125", "XL100", "Ronin", "iQube"] },
    { name: "Royal Enfield", color: "#7C2D12", models: ["Classic 350", "Bullet 350", "Hunter 350", "Meteor 350", "Himalayan", "Interceptor 650"] },
    { name: "Yamaha", color: "#1D4ED8", models: ["FZ-S", "R15", "MT-15", "Fascino", "RayZR"] },
    { name: "Suzuki", color: "#DC2626", models: ["Access 125", "Burgman Street", "Gixxer", "Avenis"] },
    { name: "KTM", color: "#EA580C", models: ["Duke 200", "Duke 390", "RC 200", "Adventure 390"] },
    { name: "Ola", color: "#111827", models: ["S1 Pro", "S1 Air", "S1 X"] },
    { name: "Ather", color: "#111827", models: ["450X", "450S", "Rizta"] },
    { name: "Jawa", color: "#4B5563", models: ["42", "Perak", "350"] },
    { name: "BMW", color: "#1C69D4", models: ["G 310 R", "G 310 GS"] },
  ],
  four_wheeler: [
    { name: "Maruti Suzuki", color: "#1E3A8A", models: ["Swift", "Baleno", "Wagon R", "Alto K10", "Dzire", "Brezza", "Ertiga", "Celerio", "Fronx", "Grand Vitara"] },
    { name: "Hyundai", color: "#002C5F", models: ["i20", "Creta", "Venue", "Grand i10 Nios", "Verna", "Exter", "Aura", "Alcazar"] },
    { name: "Tata", color: "#1D4ED8", models: ["Nexon", "Punch", "Tiago", "Altroz", "Harrier", "Safari", "Tigor"] },
    { name: "Mahindra", color: "#B91C1C", models: ["Scorpio-N", "XUV700", "Thar", "Bolero", "XUV 3XO", "Scorpio Classic"] },
    { name: "Kia", color: "#05141F", models: ["Seltos", "Sonet", "Carens", "Carnival"] },
    { name: "Toyota", color: "#EB0A1E", models: ["Innova Crysta", "Innova Hycross", "Fortuner", "Glanza", "Urban Cruiser Hyryder"] },
    { name: "Honda", color: "#CC0000", models: ["City", "Amaze", "Elevate"] },
    { name: "MG", color: "#7F1D1D", models: ["Hector", "Astor", "ZS EV", "Comet EV", "Windsor EV"] },
    { name: "Renault", color: "#B45309", models: ["Kwid", "Kiger", "Triber"] },
    { name: "Skoda", color: "#166534", models: ["Kushaq", "Slavia", "Kylaq"] },
    { name: "Volkswagen", color: "#1E3A8A", models: ["Virtus", "Taigun"] },
    { name: "Nissan", color: "#374151", models: ["Magnite"] },
  ],
};
