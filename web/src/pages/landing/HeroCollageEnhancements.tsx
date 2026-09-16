import React from 'react';

/* No animations — illustrations are static */
export const heroCollageKeyframes = '';

/* ══════════════════════════════════════════════════════════════
   1. Cohesive Car-and-Mechanic Illustration (along bottom road)
   - Natural, believable vehicle & human proportions
   - Cream bodywork (#FBF8F1)
   - Consistent charcoal outlines (#3A3630)
   - Restrained Sahayak teal accents (#0F766E / #14B8A6) on uniform vest, cap, vehicle rocker sill, and tool kit
   - Grounded naturally right above the bottom road
   ══════════════════════════════════════════════════════════════ */
export const RoadsideScene: React.FC = () => (
  <div
    className="hero__roadside-scene"
    aria-hidden="true"
  >
    <svg
      width="320"
      height="135"
      viewBox="0 0 320 135"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="presentation"
      style={{ filter: 'drop-shadow(0 4px 12px rgba(27,23,18,0.09))' }}
    >
      {/* ── Ground Contact Shadows along the road line ── */}
      <ellipse cx="204" cy="121" rx="90" ry="2.8" fill="#2A2520" opacity="0.16" />
      <ellipse cx="62" cy="121" rx="42" ry="2.2" fill="#2A2520" opacity="0.13" />

      {/* ── Roadside Equipment: Technician's Service Kit ── */}
      {/* Toolbox body */}
      <rect x="18" y="110" width="18" height="10" rx="1.5" fill="#FBF8F1" stroke="#3A3630" strokeWidth="1.8" />
      {/* Restrained teal accent line on toolbox */}
      <rect x="18" y="113.5" width="18" height="2.2" fill="#0F766E" />
      {/* Metal latch */}
      <rect x="25.5" y="112.5" width="3" height="3.5" rx="0.5" fill="#3A3630" />
      {/* Toolbox handle */}
      <path d="M 23 110 L 23 107.5 L 31 107.5 L 31 110" fill="none" stroke="#3A3630" strokeWidth="1.8" strokeLinecap="round" />

      {/* ── Hydraulic Service Jack under Front Sill ── */}
      <polygon points="112,120 116,109 121,109 125,120" fill="#2A2520" stroke="#3A3630" strokeWidth="1.2" />
      <line x1="112" y1="116.5" x2="100" y2="119.5" stroke="#3A3630" strokeWidth="1.6" strokeLinecap="round" />

      {/* ── Technician / Mechanic ── */}
      {/* Natural human proportions (~52 units tall crouching) */}

      {/* Head */}
      <circle cx="54" cy="65" r="6.2" fill="#FBF8F1" stroke="#3A3630" strokeWidth="2.2" />

      {/* Service cap with restrained teal crown */}
      <path
        d="M 47.5 64 C 47.5 59 58.5 58 61 61.5 L 67 62"
        fill="#0F766E"
        stroke="#3A3630"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />

      {/* Torso & Uniform Vest (Sahayak brand teal with clean charcoal outline) */}
      <path
        d="M 50 71.5 L 60 71.5 L 72 93 L 56 96 Z"
        fill="#0F766E"
        stroke="#3A3630"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      {/* Cream inner collar */}
      <polygon points="53,71.5 57,77 61,71.5" fill="#FBF8F1" stroke="#3A3630" strokeWidth="1.2" />
      {/* Restrained teal/mint reflective safety trim */}
      <line x1="53" y1="84.5" x2="68" y2="84.5" stroke="#14B8A6" strokeWidth="1.6" />

      {/* Arms & Lug Tool */}
      {/* Right arm extending to wheel hub */}
      <path
        d="M 62 76 L 78 86 L 116 105"
        fill="none"
        stroke="#3A3630"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Professional torque / cross lug wrench at wheel hub */}
      <line x1="108" y1="101" x2="132" y2="113" stroke="#3A3630" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="106" y1="107" x2="113" y2="95" stroke="#3A3630" strokeWidth="2" strokeLinecap="round" />

      {/* Left arm bracing near knee */}
      <path
        d="M 52 77 L 47 89 L 62 96"
        fill="none"
        stroke="#3A3630"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Natural crouching legs */}
      {/* Front bent leg */}
      <path
        d="M 58 96 L 78 106 L 74 120"
        fill="none"
        stroke="#3A3630"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Rear kneeling leg */}
      <path
        d="M 56 96 L 46 111 L 37 120"
        fill="none"
        stroke="#3A3630"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Work boots grounded at Y=120 */}
      <path d="M 69 120 L 78 120 L 78 116.5 L 73 116 Z" fill="#3A3630" />
      <path d="M 33 120 L 41 120 L 40 116.5 L 35 116 Z" fill="#3A3630" />

      {/* ── Modern Everyday Hatchback ── */}
      {/* Main body silhouette with wheel arches — warm cream bodywork & charcoal outline */}
      <path
        d={[
          'M 90 109',              // front bumper bottom
          'L 90 91',               // front bumper upright
          'Q 90 83 98 81',         // nose curve into hood
          'L 140 73',              // sloping hood
          'L 165 47',              // windshield rake (~35°)
          'Q 198 45 230 47',       // aerodynamic roofline
          'L 236 47',              // roof spoiler lip
          'L 258 68',              // rear hatch glass slope
          'Q 268 76 284 80',       // tail deck & light ledge
          'Q 290 87 288 98',       // rear bumper contour
          'L 285 109',             // rear bumper bottom
          'L 264 109',             // underside to rear wheel arch
          'A 18 18 0 0 0 228 109', // rear wheel arch
          'L 152 109',             // door sill between arches
          'A 18 18 0 0 0 116 109', // front wheel arch
          'Z',                     // front overhang bottom
        ].join(' ')}
        fill="#FBF8F1"
        stroke="#3A3630"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />

      {/* Greenhouse / Windows with charcoal pillars and soft tinted glass */}
      {/* Front window & windshield */}
      <path
        d="M 143 71 L 166 50 L 199 50 L 199 71 Z"
        fill="rgba(58,54,48,0.10)"
        stroke="#3A3630"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Rear window & quarter glass */}
      <path
        d="M 203 50 L 230 50 L 253 69 L 203 69 Z"
        fill="rgba(58,54,48,0.10)"
        stroke="#3A3630"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* B-pillar divider */}
      <line x1="201" y1="50" x2="201" y2="70" stroke="#3A3630" strokeWidth="2.2" />

      {/* Aerodynamic side mirror */}
      <path
        d="M 142 68 Q 140 65 135 66 Q 134 69 137 71 Z"
        fill="#3A3630"
      />

      {/* Waistline character crease */}
      <line x1="96" y1="79" x2="280" y2="79" stroke="#5B5346" strokeWidth="0.8" opacity="0.3" />

      {/* Door shutlines */}
      <path d="M 158 72 L 158 108" stroke="#3A3630" strokeWidth="1.2" opacity="0.45" />
      <path d="M 201 70 L 201 108" stroke="#3A3630" strokeWidth="1.2" opacity="0.45" />

      {/* Flush door handles */}
      <rect x="168" y="76" width="8" height="2.2" rx="1.1" fill="#3A3630" />
      <rect x="211" y="76" width="8" height="2.2" rx="1.1" fill="#3A3630" />

      {/* Restrained Teal Accents on Vehicle */}
      {/* Lower rocker sill pinstripe in Sahayak teal */}
      <line x1="156" y1="105" x2="224" y2="105" stroke="#0F766E" strokeWidth="2.4" strokeLinecap="round" />
      {/* Front fender badge */}
      <rect x="135" y="77.5" width="4.5" height="2" rx="0.8" fill="#0F766E" />

      {/* Lights */}
      {/* Front amber headlight cluster */}
      <path d="M 91 85 Q 102 84 105 82" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" />
      {/* Rear ruby LED taillight */}
      <path d="M 278 79 Q 287 81 286 86" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round" />

      {/* ── Wheels & Tires (contacting ground at Y=120) ── */}
      {/* Rear wheel */}
      <circle cx="246" cy="120" r="14" fill="#3A3630" />
      <circle cx="246" cy="120" r="9" fill="#FBF8F1" stroke="#3A3630" strokeWidth="1.6" />
      <circle cx="246" cy="120" r="6" fill="#F2ECE1" stroke="#3A3630" strokeWidth="1" />
      <circle cx="246" cy="120" r="2.5" fill="#3A3630" />

      {/* Front wheel (attending wheel, slightly raised on jack) */}
      <circle cx="134" cy="118" r="14" fill="#3A3630" />
      <circle cx="134" cy="118" r="9" fill="#FBF8F1" stroke="#3A3630" strokeWidth="1.6" />
      <circle cx="134" cy="118" r="6" fill="#F2ECE1" stroke="#3A3630" strokeWidth="1" />
      <circle cx="134" cy="118" r="2.5" fill="#3A3630" />
      {/* Lug nut studs */}
      <circle cx="131" cy="116" r="0.8" fill="#FBF8F1" />
      <circle cx="137" cy="116" r="0.8" fill="#FBF8F1" />
      <circle cx="137" cy="120" r="0.8" fill="#FBF8F1" />
      <circle cx="131" cy="120" r="0.8" fill="#FBF8F1" />
    </svg>
  </div>
);

/* ══════════════════════════════════════════════════════════════
   2. Road Strip (bottom of hero — dark road with dashed markings)
   ══════════════════════════════════════════════════════════════ */
export const RoadStrip: React.FC = () => (
  <div
    aria-hidden="true"
    style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      width: '100%',
      height: '48px',
      zIndex: 1,
      backgroundColor: '#3A3630',
      pointerEvents: 'none',
      display: 'flex',
      alignItems: 'center',
    }}
  >
    <div
      style={{
        width: '100%',
        height: '4px',
        background: 'repeating-linear-gradient(90deg, #F6F1E6 0 28px, transparent 28px 52px)',
      }}
    />
  </div>
);
