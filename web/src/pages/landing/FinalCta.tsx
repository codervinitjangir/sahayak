import React from 'react';

export const FinalCta: React.FC = () => {
  return (
    <section className="final-cta" id="get-help" aria-label="App download section">
      <div className="final-cta__inner">
        <div className="final-cta__content">
          <h2 className="final-cta__heading">
            Download the app now!
          </h2>
          <p className="final-cta__sub">
            Experience seamless online ordering only on the Zomato app
          </p>

          <div className="final-cta__badges">
            {/* Google Play Badge */}
            <a
              href="#download-play"
              className="final-cta__badge"
              onClick={(e) => {
                e.preventDefault();
                window.alert('Opening Google Play Store...');
              }}
              aria-label="Get it on Google Play"
            >
              <svg className="final-cta__badge-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3.609 1.814L13.792 12 3.61 22.186a2.007 2.007 0 0 1-.61-.926V2.74c.15-.363.363-.68.609-.926zM15.207 13.414l2.673 2.673-12.72 7.23a1.986 1.986 0 0 1-.986.233l11.033-10.136zM15.207 10.586L4.174.45A1.986 1.986 0 0 1 5.16.683l12.72 7.23-2.673 2.673zm1.414 1.414l3.18-1.808a1.5 1.5 0 0 1 0 2.616l-3.18-1.808z" fill="#fff"/>
              </svg>
              <div className="final-cta__badge-text">
                <span className="final-cta__badge-sub">GET IT ON</span>
                <span className="final-cta__badge-title">Google Play</span>
              </div>
            </a>

            {/* App Store Badge */}
            <a
              href="#download-apple"
              className="final-cta__badge"
              onClick={(e) => {
                e.preventDefault();
                window.alert('Opening Apple App Store...');
              }}
              aria-label="Download on the App Store"
            >
              <svg className="final-cta__badge-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.85c.66-.82 1.11-1.95.99-3.08-.96.04-2.16.64-2.84 1.44-.6.69-1.12 1.83-1 2.93 1.07.08 2.19-.57 2.85-1.29z" fill="#fff"/>
              </svg>
              <div className="final-cta__badge-text">
                <span className="final-cta__badge-sub">Download on the</span>
                <span className="final-cta__badge-title">App Store</span>
              </div>
            </a>
          </div>
        </div>

        {/* Right side: QR Code Card matching Zomato sample */}
        <div className="final-cta__qr-card">
          <p className="final-cta__qr-text">
            Scan the QR code to download the app
          </p>
          <div className="final-cta__qr-frame">
            <svg className="final-cta__qr-svg" viewBox="0 0 120 120" fill="none">
              <rect width="120" height="120" rx="12" fill="#ffffff" />
              {/* Corner Targets with Zomato reddish corners */}
              <rect x="12" y="12" width="28" height="28" rx="6" fill="#E23744" />
              <rect x="16" y="16" width="20" height="20" rx="4" fill="#ffffff" />
              <rect x="20" y="20" width="12" height="12" rx="2" fill="#E23744" />

              <rect x="80" y="12" width="28" height="28" rx="6" fill="#E23744" />
              <rect x="84" y="16" width="20" height="20" rx="4" fill="#ffffff" />
              <rect x="88" y="20" width="12" height="12" rx="2" fill="#E23744" />

              <rect x="12" y="80" width="28" height="28" rx="6" fill="#E23744" />
              <rect x="16" y="84" width="20" height="20" rx="4" fill="#ffffff" />
              <rect x="20" y="88" width="12" height="12" rx="2" fill="#E23744" />

              {/* QR Pattern Data Dots */}
              <rect x="46" y="16" width="8" height="8" rx="1" fill="#181818" />
              <rect x="58" y="16" width="8" height="8" rx="1" fill="#181818" />
              <rect x="66" y="26" width="6" height="6" rx="1" fill="#181818" />
              <rect x="46" y="28" width="8" height="6" rx="1" fill="#181818" />

              <rect x="16" y="46" width="8" height="8" rx="1" fill="#181818" />
              <rect x="28" y="46" width="6" height="8" rx="1" fill="#181818" />
              <rect x="16" y="58" width="8" height="8" rx="1" fill="#181818" />

              <rect x="46" y="46" width="10" height="10" rx="2" fill="#181818" />
              <rect x="62" y="46" width="8" height="8" rx="1" fill="#181818" />
              <rect x="58" y="58" width="12" height="10" rx="2" fill="#181818" />
              <rect x="46" y="62" width="8" height="8" rx="1" fill="#181818" />

              <rect x="80" y="46" width="8" height="8" rx="1" fill="#181818" />
              <rect x="94" y="46" width="12" height="8" rx="1" fill="#181818" />
              <rect x="80" y="58" width="10" height="10" rx="2" fill="#181818" />
              <rect x="96" y="62" width="10" height="8" rx="1" fill="#181818" />

              <rect x="46" y="80" width="8" height="10" rx="1" fill="#181818" />
              <rect x="58" y="80" width="10" height="8" rx="1" fill="#181818" />
              <rect x="46" y="96" width="10" height="10" rx="2" fill="#181818" />
              <rect x="60" y="92" width="8" height="14" rx="1" fill="#181818" />

              <rect x="80" y="80" width="10" height="8" rx="1" fill="#181818" />
              <rect x="94" y="82" width="12" height="8" rx="1" fill="#181818" />
              <rect x="80" y="94" width="8" height="12" rx="1" fill="#181818" />
              <rect x="92" y="96" width="14" height="10" rx="2" fill="#181818" />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FinalCta;
