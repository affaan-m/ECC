from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Storyboard:
    title: str
    description: str
    beats: tuple[str, str, str]


_STORIES = (
    Storyboard(
        title="The Patient Little Seed",
        description="A gentle story about teamwork and growing a garden.",
        beats=(
            "Pip finds a tiny seed beside the garden path.",
            "Friends take turns watering it and waiting.",
            "A bright flower blooms for everyone to enjoy.",
        ),
    ),
    Storyboard(
        title="The Bridge of Bright Ideas",
        description="A gentle story about listening and solving a problem together.",
        beats=(
            "Moss finds a puddle across the walking path.",
            "Friends share ideas and build a safe stepping-stone path.",
            "Everyone crosses together and thanks the team.",
        ),
    ),
    Storyboard(
        title="A Song for the Rainy Day",
        description="A gentle story about creativity and cheering up a friend.",
        beats=(
            "A rainy afternoon makes the meadow feel quiet.",
            "Pip and Moss make a cheerful song with gentle sounds.",
            "Friends share the song and enjoy the rain together.",
        ),
    ),
    Storyboard(
        title="The Reusable Picnic",
        description="A gentle story about caring for a shared meadow.",
        beats=(
            "Friends plan a picnic in their sunny meadow.",
            "They choose reusable plates and tidy up together.",
            "The meadow is clean and ready for another day.",
        ),
    ),
    Storyboard(
        title="The Turn-Taking Telescope",
        description="A gentle story about patience and sharing.",
        beats=(
            "Pip spots a sparkling star in the evening sky.",
            "Friends take turns looking through the telescope.",
            "Everyone shares one thing they noticed.",
        ),
    ),
    Storyboard(
        title="The Missing Blue Button",
        description="A gentle story about asking for help and being kind.",
        beats=(
            "Moss notices a button is missing from a craft project.",
            "Friends look carefully and ask one another for help.",
            "They find it and finish the project together.",
        ),
    ),
    Storyboard(
        title="The Meadow Welcome",
        description="A gentle story about making room for a new friend.",
        beats=(
            "A new neighbor arrives at the sunny meadow.",
            "Pip and Moss listen and offer a friendly welcome.",
            "The friends make a game everyone can enjoy.",
        ),
    ),
)


def generate_storyboard(episode_date: date) -> Storyboard:
    """Choose one fixed, original, pre-reviewed story without external input."""
    return _STORIES[episode_date.toordinal() % len(_STORIES)]
