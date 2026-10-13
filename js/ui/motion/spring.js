/**
 * spring.js - Damped Spring Physics Engine
 * Simulates second-order harmonic oscillator with velocity carry-over.
 * Allows interruptible animations that can be redirected mid-flight without snapping.
 */

export class Spring {
  constructor(config = {}) {
    this.stiffness = config.stiffness ?? 180; // k
    this.damping = config.damping ?? 24;     // c
    this.mass = config.mass ?? 1;             // m
    this.precision = config.precision ?? 0.001;

    this.current = config.from ?? 0;
    this.target = config.to ?? this.current;
    this.velocity = config.velocity ?? 0;

    this.onUpdate = config.onUpdate || null;
    this.onRest = config.onRest || null;

    this.rafId = null;
    this.lastTime = null;
    this.isRunning = false;
  }

  snapTo(value) {
    this.stop();
    this.current = value;
    this.target = value;
    this.velocity = 0;
    if (this.onUpdate) this.onUpdate(this.current);
  }

  setTarget(newTarget, initialVelocity = null) {
    this.target = newTarget;
    if (initialVelocity !== null && !isNaN(initialVelocity)) {
      this.velocity = initialVelocity;
    }
    if (!this.isRunning) {
      this.start();
    }
  }

  animateTo(newTarget, initialVelocity = null) {
    this.setTarget(newTarget, initialVelocity);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();

    const loop = (timestamp) => {
      if (!this.isRunning) return;

      const elapsed = Math.min((timestamp - this.lastTime) / 1000, 0.064); // Cap dt to 64ms
      this.lastTime = timestamp;

      // Numerical sub-stepping (3 sub-steps) for stability
      const subSteps = 3;
      const subDt = elapsed / subSteps;

      for (let i = 0; i < subSteps; i++) {
        // F = -k * (x - x_target) - c * v
        const displacement = this.current - this.target;
        const springForce = -this.stiffness * displacement;
        const dampingForce = -this.damping * this.velocity;
        const acceleration = (springForce + dampingForce) / this.mass;

        this.velocity += acceleration * subDt;
        this.current += this.velocity * subDt;
      }

      if (this.onUpdate) {
        this.onUpdate(this.current);
      }

      // Check if settled
      const isAtTarget = Math.abs(this.current - this.target) < this.precision;
      const isVelocityZero = Math.abs(this.velocity) < this.precision;

      if (isAtTarget && isVelocityZero) {
        this.current = this.target;
        this.velocity = 0;
        this.stop();
        if (this.onUpdate) this.onUpdate(this.current);
        if (this.onRest) this.onRest(this.current);
        return;
      }

      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  isAtRest() {
    return !this.isRunning;
  }
}
