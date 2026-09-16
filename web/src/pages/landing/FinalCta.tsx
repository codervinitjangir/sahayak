import React from 'react';
import { ArrowRight, Smartphone } from 'lucide-react';

export const FinalCta: React.FC = () => {
  return (
    <section className="final-cta" id="get-help" aria-label="Emergency roadside assistance action">
      <div className="final-cta__inner">
        <div>
          <h2 className="final-cta__heading">
            Stuck on the road? We'll be there.
          </h2>
          <p className="final-cta__sub">
            24/7 on-demand roadside assistance across Bengaluru. Mechanics dispatched in under 15 minutes.
          </p>
        </div>

        <div className="final-cta__buttons">
          <a href="/owner/request" className="final-cta__btn-web">
            Book Roadside Help
            <ArrowRight size={18} style={{ marginLeft: 8 }} />
          </a>
          <button
            type="button"
            className="final-cta__btn-store"
            onClick={() => window.alert('Sahayak app launching soon on iOS & Android!')}
          >
            <Smartphone size={20} />
            <span>Get the Sahayak App</span>
          </button>
        </div>
      </div>
    </section>
  );
};
