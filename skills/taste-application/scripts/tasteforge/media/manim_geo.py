"""Reusable geometry scenes. Configure render size, fps and output with Manim CLI."""

import numpy as np
from manim import (
    BLACK,
    ORIGIN,
    PI,
    TAU,
    WHITE,
    ApplyMethod,
    Circle,
    Create,
    Dot,
    FadeIn,
    GrowFromCenter,
    LaggedStart,
    Line,
    ParametricFunction,
    Scene,
    Transform,
    ValueTracker,
    VGroup,
    rate_functions,
)

PHI = (1.0 + np.sqrt(5.0)) / 2.0


def build_tick_grid(n_ticks, r_inner, r_outer):
    ticks = VGroup()
    for i in range(n_ticks):
        ang = TAU * i / n_ticks
        direction = np.array([np.cos(ang), np.sin(ang), 0.0])
        ticks.add(
            Line(
                r_inner * direction,
                r_outer * direction,
                stroke_width=1.0,
                color=WHITE,
                stroke_opacity=0.55,
            )
        )
    return ticks


def build_flower_ring(radius):
    flower = VGroup(
        Circle(radius=radius, stroke_width=1.2, color=WHITE, stroke_opacity=0.85)
    )
    for i in range(6):
        ang = TAU * i / 6
        circ = Circle(radius=radius, stroke_width=1.2, color=WHITE, stroke_opacity=0.85)
        circ.move_to(radius * np.array([np.cos(ang), np.sin(ang), 0.0]))
        flower.add(circ)
    return flower


def build_golden_spiral(a, quarter_turns):
    b = np.log(PHI) / (PI / 2.0)
    t_max = quarter_turns * (PI / 2.0)
    return ParametricFunction(
        lambda t: a * np.exp(b * t) * np.array([np.cos(t), np.sin(t), 0.0]),
        t_range=[0.0, t_max],
        stroke_width=1.6,
        color=WHITE,
        stroke_opacity=0.85,
    )


class SacredGeo(Scene):
    def construct(self):
        self.camera.background_color = BLACK
        ticks = build_tick_grid(n_ticks=72, r_inner=3.2, r_outer=3.45)
        flower = build_flower_ring(radius=1.05)
        spiral = build_golden_spiral(a=0.012, quarter_turns=14)
        dot = Dot(point=ORIGIN, radius=0.055, color=WHITE)
        dot.set_opacity(0.9)

        clock = ValueTracker(0.0)
        clock.add_updater(lambda m, dt: m.increment_value(dt))
        self.add(clock)
        base = dot.width

        def pulse(m):
            t = clock.get_value()
            s = 1.0 + 0.25 * np.sin(TAU * t / 2.2)
            m.scale_to_fit_width(base * s)
            m.move_to(ORIGIN)
            m.set_opacity(0.75 + 0.18 * np.sin(TAU * t / 2.2))

        self.play(
            FadeIn(ticks, run_time=1.4, rate_func=rate_functions.ease_out_sine),
            GrowFromCenter(dot, run_time=1.0),
        )
        dot.add_updater(pulse)
        ticks.add_updater(lambda m, dt: m.rotate(-0.05 * dt))
        self.play(
            Create(spiral, run_time=3.4, rate_func=rate_functions.ease_in_out_sine),
            LaggedStart(*[FadeIn(c) for c in flower], lag_ratio=0.12, run_time=2.8),
        )
        flower.add_updater(lambda m, dt: m.rotate(0.08 * dt))
        self.wait(2.8)


class Basket(Scene):
    def construct(self):
        self.camera.background_color = BLACK
        n = 12
        targets = VGroup()
        for i in range(n):
            ang = TAU * i / n
            r = 2.6
            c = Circle(radius=0.22, stroke_width=1.5, color=WHITE, stroke_opacity=0.7)
            c.move_to(r * np.array([np.cos(ang), np.sin(ang), 0.0]))
            targets.add(c)

        ring = Circle(radius=1.2, stroke_width=2.0, color=WHITE, stroke_opacity=0.9)
        center = Dot(point=ORIGIN, radius=0.08, color=WHITE)

        self.play(FadeIn(targets, run_time=1.2))
        self.play(
            LaggedStart(
                *[Transform(t, ring.copy().set_opacity(0.25)) for t in targets],
                lag_ratio=0.08,
                run_time=2.2,
            ),
            FadeIn(ring, run_time=2.2),
            FadeIn(center, run_time=1.0),
        )
        self.wait(2.5)


class MarketWeb(Scene):
    seed = 42

    def construct(self):
        self.camera.background_color = BLACK
        rng = np.random.default_rng(self.seed)
        n = 24
        nodes = VGroup()
        pos = []
        for i in range(n):
            ang = TAU * i / n + rng.uniform(-0.15, 0.15)
            r = rng.uniform(1.8, 3.2)
            p = r * np.array([np.cos(ang), np.sin(ang), 0.0])
            pos.append(p)
            nodes.add(Dot(point=p, radius=0.04, color=WHITE, fill_opacity=0.7))

        edges = VGroup()
        for i in range(n):
            for j in range(i + 1, n):
                d = np.linalg.norm(pos[i] - pos[j])
                if d < 2.0:
                    edges.add(
                        Line(
                            pos[i],
                            pos[j],
                            stroke_width=0.6,
                            color=WHITE,
                            stroke_opacity=0.25,
                        )
                    )

        self.play(FadeIn(nodes, run_time=1.2), FadeIn(edges, run_time=1.8))
        for _ in range(2):
            self.play(
                ApplyMethod(
                    nodes.rotate,
                    TAU / n,
                    run_time=3.0,
                    rate_func=rate_functions.ease_in_out_sine,
                )
            )
        self.wait(1.0)
