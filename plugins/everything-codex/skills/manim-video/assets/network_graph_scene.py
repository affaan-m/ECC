from manim import DOWN, LEFT, RIGHT, UP, Circle, Create, FadeIn, FadeOut, Scene, Text, VGroup, CurvedArrow


class NetworkGraphExplainer(Scene):
    def construct(self):
        title = Text("Connections Optimizer", font_size=40).to_edge(UP)
        subtitle = Text("Prune low-signal follows. Strengthen warm paths.", font_size=20).next_to(title, DOWN)

        you = Circle(radius=0.45, color="#4F8EF7").shift(LEFT * 4 + DOWN * 0.5)
        you_label = Text("You", font_size=22).move_to(you.get_center())

        stale_a = Circle(radius=0.32, color="#7A7A7A").shift(LEFT * 1.6 + UP * 1.2)
        stale_b = Circle(radius=0.32, color="#7A7A7A").shift(LEFT * 1.2 + DOWN * 1.4)
        bridge = Circle(radius=0.38, color="#21A179").shift(RIGHT * 0.2 + UP * 0.2)
        target = Circle(radius=0.42, color="#FF9F1C").shift(RIGHT * 3.2 + UP * 0.7)
        new_target = Circle(radius=0.42, color="#FF9F1C").shift(RIGHT * 3.0 + DOWN * 1.4)

        stale_a_label = Text("stale", font_size=18).move_to(stale_a.get_center())
        stale_b_label = Text("noise", font_size=18).move_to(stale_b.get_center())
        bridge_label = Text("bridge", font_size=18).move_to(bridge.get_center())
        target_label = Text("target", font_size=18).move_to(target.get_center())
        new_target_label = Text("add", font_size=18).move_to(new_target.get_center())

        edge_stale_a = CurvedArrow(you.get_right(), stale_a.get_left(), angle=0.2, color="#7A7A7A")
        edge_stale_b = CurvedArrow(you.get_right(), stale_b.get_left(), angle=-0.2, color="#7A7A7A")
        edge_bridge = CurvedArrow(you.get_right(), bridge.get_left(), angle=0.0, color="#21A179")
        edge_target = CurvedArrow(bridge.get_right(), target.get_left(), angle=0.1, color="#21A179")
        edge_new_target = CurvedArrow(bridge.get_right(), new_target.get_left(), angle=-0.12, color="#21A179")

        self.play(FadeIn(title), FadeIn(subtitle))
        self.play(
            Create(you),
            FadeIn(you_label),
            Create(stale_a),
            Create(stale_b),
            Create(bridge),
            Create(target),
            FadeIn(stale_a_label),
            FadeIn(stale_b_label),
            FadeIn(bridge_label),
            FadeIn(target_label),
        )
        self.play(Create(edge_stale_a), Create(edge_stale_b), Create(edge_bridge), Create(edge_target))

        optimize = Text("Optimize the graph", font_size=24).to_edge(DOWN)
        self.play(FadeIn(optimize))
        self.play(FadeOut(stale_a), FadeOut(stale_b), FadeOut(stale_a_label), FadeOut(stale_b_label), FadeOut(edge_stale_a), FadeOut(edge_stale_b))
        self.play(Create(new_target), FadeIn(new_target_label), Create(edge_new_target))

        final_group = VGroup(you, you_label, bridge, bridge_label, target, target_label, new_target, new_target_label)
        self.play(final_group.animate.shift(UP * 0.1))
        self.wait(1)
