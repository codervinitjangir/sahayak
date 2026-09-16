import React from 'react';
import {
  RoadStrip,
  RoadsideScene,
  heroCollageKeyframes,
} from './HeroCollageEnhancements';

export const Hero: React.FC = () => {
  return (
    <section className="hero" id="top">
      {heroCollageKeyframes && <style>{heroCollageKeyframes}</style>}

      {/* Collage Art Background */}
      <div className="hero__collage">
        {/* Dark road with dashed lane markings */}
        <RoadStrip />

        {/* Cohesive car-and-mechanic illustration along the bottom road */}
        <RoadsideScene />
      </div>

      {/* Foreground Content */}
      <div className="hero__content">
        <h1 className="hero__headline">
          Vehicle breakdown?
          <br />
          <em>We come to you.</em>
        </h1>

        <p className="hero__sub">
          On-demand roadside assistance across Bengaluru.
          Certified mechanics and tow trucks at your doorstep —
          transparent pricing, no hidden charges.
        </p>

        <a href="/owner/request" className="hero__cta">
          Book Roadside Help
        </a>
      </div>
    </section>
  );
};

export default Hero;
