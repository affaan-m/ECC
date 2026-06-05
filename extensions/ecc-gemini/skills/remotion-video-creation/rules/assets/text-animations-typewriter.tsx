import {
	AbsoluteFill,
	interpolate,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';

const COLOR_BG = '#ffffff';
const COLOR_TEXT = '#000000';
const FULL_TEXT = 'From prompt to motion graphics. This is Remotion.';
const PAUSE_AFTER = 'From prompt to motion graphics.';
const FONT_SIZE = 72;
const FONT_WEIGHT = 700;
const CHAR_FRAMES = 2;
const CURSOR_BLINK_FRAMES = 16;
const PAUSE_SECONDS = 1;

// Ideal composition size: 1280x720

const getTypedText = ({
	frame,
	fullText,
	pauseAfter,
	charFrames,
	pauseFrames,
}: {
	frame: number;
	fullText: string;
	pauseAfter: string;
	charFrames: number;
	pauseFrames: number;
}): string => {
	const pauseIndex = fullText.indexOf(pauseAfter);
	const preLen =
		pauseIndex >= 0 ? pauseIndex + pauseAfter.length : fullText.length;

	let typedChars = 0;
	if (frame < preLen * charFrames) {
		typedChars = Math.floor(frame / charFrames);
	} else if (frame < preLen * charFrames + pauseFrames) {
		typedChars = preLen;
	} else {
		const postPhase = frame - preLen * charFrames - pauseFrames;
		typedChars = Math.min(
			fullText.length,
			preLen + Math.floor(postPhase / charFrames),
		);
	}
	return fullText.slice(0, typedChars);
};

const Cursor: React.FC<{
	frame: number;
	blinkFrames: number;
	symbol?: string;
}> = ({frame, blinkFrames, symbol = '\u258C'}) => {
	const opacity = interpolate(
		frame % blinkFrames,
		[0, blinkFrames / 2, blinkFrames],
		[1, 0, 1],
		{extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
	);

	return <span style={{opacity}}>{symbol}</span>;
};

export const MyAnimation = () => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();

	const pauseFrames = Math.round(fps * PAUSE_SECONDS);

	const typedText = getTypedText({
		frame,
		fullText: FULL_TEXT,
		pauseAfter: PAUSE_AFTER,
		charFrames: CHAR_FRAMES,
		pauseFrames,
	});

	return (
		<AbsoluteFill
			style={{
				backgroundColor: COLOR_BG,
			}}
		>
			<div
				style={{
					color: COLOR_TEXT,
					fontSize: FONT_SIZE,
					fontWeight: FONT_WEIGHT,
					fontFamily: 'sans-serif',
				}}
			>
				<span>{typedText}</span>
				<Cursor frame={frame} blinkFrames={CURSOR_BLINK_FRAMES} />
			</div>
		</AbsoluteFill>
	);
};
