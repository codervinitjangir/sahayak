import React, { useRef, useState, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  User,
  CircleDot,
  BatteryCharging,
  Fuel,
  Truck,
  Wrench,
  LucideIcon,
} from 'lucide-react';

// One star glyph, used by both the aggregate rating badge and the per-review
// rating rows. The path was previously pasted verbatim in both places.
const StarIcon: React.FC<{ className: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
  </svg>
);

interface Review {
  id: string;
  name: string;
  role: string;
  partner?: string;
  date: string;
  rating: number;
  text: string;
  service: {
    name: string;
    icon: LucideIcon;
    bg: string;
    color: string;
    border: string;
  };
  avatarBg: string;
  avatarColor: string;
}

const REVIEWS: Review[] = [
  {
    id: '1',
    name: 'Thanae',
    role: 'Customer · Indiranagar',
    partner: 'Fixed by Divya M. · ★4.9',
    date: 'May 01, 2025',
    rating: 5,
    text: 'Quick and professional assistance by service partner Divya. Helped with flat tyre replacement on Old Airport Road and ensured all wheel nuts were torqued properly. Reached in just 14 minutes. Seamless experience!',
    service: {
      name: 'Flat Tyre',
      icon: CircleDot,
      bg: 'rgba(15, 118, 110, 0.08)',
      color: '#0F766E',
      border: 'rgba(15, 118, 110, 0.22)',
    },
    avatarBg: '#E0F2FE',
    avatarColor: '#0284C7',
  },
  {
    id: '2',
    name: 'Arjun Kulkarni',
    role: 'Customer · Bellary Road',
    partner: 'Fixed by Imran S. · ★5.0',
    date: 'August 04, 2026',
    rating: 5,
    text: 'Clutch failure near Hebbal flyover. Tow partner Imran arrived with a flatbed in 22 minutes. Winch loading with zero bumper scrape, and tracked live to the authorised service center.',
    service: {
      name: 'Towing',
      icon: Truck,
      bg: 'rgba(109, 40, 217, 0.08)',
      color: '#6D28D9',
      border: 'rgba(109, 40, 217, 0.22)',
    },
    avatarBg: '#EDE9FE',
    avatarColor: '#7C3AED',
  },
  {
    id: '3',
    name: 'Jatinder Singh',
    role: 'Customer · Whitefield',
    partner: 'Fixed by Preethi K. · ★4.8',
    date: 'June 01, 2026',
    rating: 5,
    text: 'Dead battery issue sorted in 20 minutes flat. Technician Preethi was super professional, tested the alternator health, and gave clear battery condition advice. Transparent fixed pricing — no surge charges.',
    service: {
      name: 'Battery',
      icon: BatteryCharging,
      bg: 'rgba(180, 83, 9, 0.08)',
      color: '#B45309',
      border: 'rgba(180, 83, 9, 0.22)',
    },
    avatarBg: '#FEF3C7',
    avatarColor: '#D97706',
  },
  {
    id: '4',
    name: 'Pooja Hegde',
    role: 'Customer · HSR Layout',
    partner: 'Fixed by Suresh R. · ★4.7',
    date: 'July 19, 2026',
    rating: 5,
    text: 'Ran out of fuel on the Hosur Road elevated tollway at night. Requested emergency fuel delivery via Sahayak — partner Suresh arrived with a sealed 5L canister in 18 minutes. The live tracking gave immense peace of mind.',
    service: {
      name: 'Fuel Delivery',
      icon: Fuel,
      bg: 'rgba(2, 132, 199, 0.08)',
      color: '#0284C7',
      border: 'rgba(2, 132, 199, 0.22)',
    },
    avatarBg: '#FCE7F3',
    avatarColor: '#DB2777',
  },
  {
    id: '5',
    name: 'Manjeri Dharmarajan',
    role: 'Customer · Koramangala',
    partner: 'Fixed by Karthik N. · ★4.85',
    date: 'April 12, 2026',
    rating: 5,
    text: 'My car got a flat tyre near Sony World signal, so I requested help on Sahayak. Service partner Karthik arrived in 11 minutes with a hydraulic jack and electric inflator, and fixed it cleanly. A true lifesaver during peak traffic.',
    service: {
      name: 'Flat Tyre',
      icon: CircleDot,
      bg: 'rgba(15, 118, 110, 0.08)',
      color: '#0F766E',
      border: 'rgba(15, 118, 110, 0.22)',
    },
    avatarBg: '#CCFBF1',
    avatarColor: '#0F766E',
  },
  {
    id: '6',
    name: 'Kavita Sundaram',
    role: 'Customer · Electronic City',
    partner: 'Fixed by Anand R. · ★4.95',
    date: 'August 28, 2026',
    rating: 5,
    text: 'My scooter broke down with a drive belt snap in Electronic City Phase 1. Mechanic Anand had the exact belt in his service bike kit. Back on the road within 35 minutes! Top-notch roadside repair.',
    service: {
      name: 'Minor Repair',
      icon: Wrench,
      bg: 'rgba(22, 163, 74, 0.08)',
      color: '#15803D',
      border: 'rgba(22, 163, 74, 0.22)',
    },
    avatarBg: '#DCFCE7',
    avatarColor: '#16A34A',
  },
];

export const ReviewsSection: React.FC = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const animatedRef = useRef(false);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reviewCount, setReviewCount] = useState(5925);

  /* Count-up animation for the live rating badge */
  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced || typeof IntersectionObserver === 'undefined') {
      setReviewCount(5925);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !animatedRef.current) {
          animatedRef.current = true;
          const target = 5925;
          const start = 4800;
          const duration = 1200;
          const startTime = performance.now();

          const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out cubic
            const easeOut = 1 - Math.pow(1 - progress, 3);
            const current = Math.floor(start + (target - start) * easeOut);
            setReviewCount(current);

            if (progress < 1) {
              requestAnimationFrame(animate);
            } else {
              setReviewCount(target);
            }
          };

          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.2 }
    );

    if (badgeRef.current) {
      observer.observe(badgeRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const checkScroll = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setCanScrollLeft(scrollLeft > 10);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);

      const maxScroll = scrollWidth - clientWidth;
      if (maxScroll > 0) {
        const progress = scrollLeft / maxScroll;
        const index = Math.min(
          REVIEWS.length - 1,
          Math.max(0, Math.round(progress * (REVIEWS.length - 1)))
        );
        setActiveIndex(index);
      }
    }
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll, { passive: true });
      window.addEventListener('resize', checkScroll);
      return () => {
        el.removeEventListener('scroll', checkScroll);
        window.removeEventListener('resize', checkScroll);
      };
    }
  }, []);

  const handleScroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollDistance = 380;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollDistance : scrollDistance,
        behavior: 'smooth',
      });
    }
  };

  const scrollToReview = (index: number) => {
    if (scrollRef.current) {
      const cards = scrollRef.current.querySelectorAll('.review-card');
      if (cards[index]) {
        cards[index].scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'start',
        });
      }
    }
  };

  return (
    <section className="reviews-section" id="reviews" aria-label="Customer Reviews">
      <div className="reviews-layout">
        {/* ── Left Column: Header & Controls ── */}
        <div className="reviews-header">
          {/* Google Star Rating Badge with Animated Count */}
          <div className="reviews-badge" ref={badgeRef}>
            <div className="reviews-badge__stars" aria-label="5 stars rating">
              {[...Array(5)].map((_, i) => (
                <StarIcon key={i} className="reviews-badge__star" />
              ))}
            </div>
            <span className="reviews-badge__score">
              4.7 from {reviewCount.toLocaleString('en-US')}
            </span>
            <span className="reviews-badge__google">
              {/* Authentic Google 4-color 'G' icon */}
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              <span className="reviews-badge__label">Reviews</span>
            </span>
          </div>

          {/* Heading */}
          <h2 className="reviews-title">
            Loved By
            <br />
            The People
            <br />
            We Serve
          </h2>

          {/* Carousel Arrow Controls */}
          <div className="reviews-controls">
            <button
              type="button"
              className="reviews-btn"
              onClick={() => handleScroll('left')}
              disabled={!canScrollLeft}
              aria-label="Previous reviews"
            >
              <ArrowLeft size={18} />
            </button>
            <button
              type="button"
              className="reviews-btn"
              onClick={() => handleScroll('right')}
              disabled={!canScrollRight}
              aria-label="Next reviews"
            >
              <ArrowRight size={18} />
            </button>
          </div>
        </div>

        {/* ── Right Column: Cards Carousel Track + Pagination Dots ── */}
        <div className="reviews-carousel-column">
          <div className="reviews-track" ref={scrollRef}>
            {REVIEWS.map((review) => {
              const ServiceIcon = review.service.icon;
              return (
                <article key={review.id} className="review-card">
                  {/* Card Top: Stars & Date on Left, Service Tag on Right */}
                  <div className="review-card__top">
                    <div className="review-card__rating-group">
                      <div className="review-card__stars" aria-label={`${review.rating} out of 5 stars`}>
                        {[...Array(review.rating)].map((_, i) => (
                          <StarIcon key={i} className="review-card__star" />
                        ))}
                      </div>
                      <time className="review-card__date">{review.date}</time>
                    </div>

                    {/* Service-Type Tag in Top-Right Corner */}
                    <div
                      className="review-card__service-pill"
                      style={{
                        backgroundColor: review.service.bg,
                        color: review.service.color,
                        borderColor: review.service.border,
                      }}
                    >
                      <ServiceIcon size={12} strokeWidth={2.2} />
                      <span>{review.service.name}</span>
                    </div>
                  </div>

                  {/* Card Body: Review Quote */}
                  <p className="review-card__text">{review.text}</p>

                  {/* Card Bottom: Avatar + Customer Name + Partner Credit */}
                  <div className="review-card__author">
                    <div
                      className="review-card__avatar"
                      style={{
                        backgroundColor: review.avatarBg,
                        color: review.avatarColor,
                      }}
                      aria-hidden="true"
                    >
                      <User size={20} strokeWidth={2.2} />
                    </div>
                    <div className="review-card__meta">
                      <div className="review-card__name">{review.name}</div>
                      <div className="review-card__role">{review.role}</div>
                      {review.partner && (
                        <div className="review-card__partner-credit">
                          {review.partner}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Carousel Affordance: Centered Pagination Dots.
              These scroll a carousel rather than swapping tabpanels, so they are
              plain buttons in a group — role="tab" without a matching tabpanel is
              invalid ARIA and makes screen readers announce a control that isn't there. */}
          <div className="reviews-dots" role="group" aria-label="Review pagination">
            {REVIEWS.map((r, idx) => (
              <button
                key={r.id}
                type="button"
                aria-current={activeIndex === idx}
                aria-label={`Go to review ${idx + 1}: ${r.name}`}
                className={`reviews-dot ${activeIndex === idx ? 'reviews-dot--active' : ''}`}
                onClick={() => scrollToReview(idx)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default ReviewsSection;
