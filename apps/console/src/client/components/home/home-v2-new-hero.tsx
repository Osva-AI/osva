import { Link } from "react-router-dom";

import { LinkButton } from "../ui/button";

export function HomeV2NewHero({ canWrite }: { readonly canWrite: boolean }) {
  return (
    <section className="home-v2-hero" aria-labelledby="home-v2-new-title">
      <div className="home-v2-hero-copy">
        <p className="home-v2-eyebrow">Welcome to OSVA</p>
        <h1 id="home-v2-new-title" className="home-v2-hero-title">
          Build your first{" "}
          <span className="home-v2-hero-accent">AI agent.</span>
        </h1>
        <p className="home-v2-hero-lead">
          Have an idea for something AI could help with? We&apos;ll guide you
          through the essentials, then help you test it—without learning
          technical concepts first.
        </p>
        <div className="home-v2-hero-actions">
          <LinkButton variant="primary" to="/onboarding">
            Start guided setup
          </LinkButton>
          {canWrite ? (
            <LinkButton variant="secondary" to="/agents/new">
              Create directly
            </LinkButton>
          ) : null}
        </div>
        <p className="home-v2-hero-foot muted">
          You control what gets published and run. Prefer exploring? Browse{" "}
          <Link to="/examples">verified examples</Link> when you&apos;re ready.
        </p>
      </div>
      <div className="home-v2-journey-visual" aria-hidden="true">
        <div className="home-v2-journey-glow" />
        <div className="home-v2-journey-main">
          <div className="home-v2-journey-tile">
            <span className="home-v2-journey-ico">1</span>
            <span>
              <strong>Tell OSVA what you need</strong>
              <small>Start with a task, not settings</small>
            </span>
          </div>
          <div className="home-v2-journey-bridge" />
          <div className="home-v2-journey-tile home-v2-journey-tile-current">
            <span className="home-v2-journey-ico">2</span>
            <span>
              <strong>Build your agent</strong>
              <small>Choose what it knows and can do</small>
            </span>
          </div>
          <div className="home-v2-journey-bridge" />
          <div className="home-v2-journey-tile">
            <span className="home-v2-journey-ico">3</span>
            <span>
              <strong>Test before you use it</strong>
              <small>See the result of a real run</small>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
