import {loadFont} from '@remotion/google-fonts/Inter';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';

const {fontFamily} = loadFont();

const COLOR_BAR = '#D4AF37';
const COLOR_TEXT = '#ffffff';
const COLOR_MUTED = '#888888';
const COLOR_BG = '#0a0a0a';
const COLOR_AXIS = '#333333';

// Ideal composition size: 1280x720

const Title: React.FC<{children: React.ReactNode}> = ({children}) => (
	<div style={{textAlign: 'center', marginBottom: 40}}>
		<div style={{color: COLOR_TEXT, fontSize: 48, fontWeight: 600}}>
			{children}
		</div>
	</div>
);

const YAxis: React.FC<{steps: number[]; height: number}> = ({
	steps,
	height,
}) => (
	<div
		style={{
			display: 'flex',
			flexDirection: 'column',
			justifyContent: 'space-between',
			height,
			paddingRight: 16,
		}}
	>
		{steps
			.slice()
			.reverse()
			.map((step) => (
				<div
					key={step}
					style={{
						color: COLOR_MUTED,
						fontSize: 20,
						textAlign: 'right',
					}}
				>
					{step.toLocaleString()}
				</div>
			))}
	</div>
);

const Bar: React.FC<{
	height: number;
	progress: number;
}> = ({height, progress}) => (
	<div
		style={{
			flex: 1,
			display: 'flex',
			flexDirection: 'column',
			justifyContent: 'flex-end',
		}}
	>
		<div
			style={{
				width: '100%',
				height,
				backgroundColor: COLOR_BAR,
				borderRadius: '8px 8px 0 0',
				opacity: progress,
			}}
		/>
	</div>
);

const XAxis: React.FC<{
	children: React.ReactNode;
	labels: string[];
	height: number;
}> = ({children, labels, height}) => (
	<div style={{flex: 1, display: 'flex', flexDirection: 'column'}}>
		<div
			style={{
				display: 'flex',
				alignItems: 'flex-end',
				gap: 16,
				height,
				borderLeft: `2px solid ${COLOR_AXIS}`,
				borderBottom: `2px solid ${COLOR_AXIS}`,
				paddingLeft: 16,
			}}
		>
			{children}
		</div>
		<div
			style={{
				display: 'flex',
				gap: 16,
				paddingLeft: 16,
				marginTop: 12,
			}}
		>
			{labels.map((label) => (
				<div
					key={label}
					style={{
						flex: 1,
						textAlign: 'center',
						color: COLOR_MUTED,
						fontSize: 20,
					}}
				>
					{label}
				</div>
			))}
		</div>
	</div>
);

export const MyAnimation = () => {
	const frame = useCurrentFrame();
	const {fps, height} = useVideoConfig();

	const data = [
		{month: 'Jan', price: 2039},
		{month: 'Mar', price: 2160},
		{month: 'May', price: 2327},
		{month: 'Jul', price: 2426},
		{month: 'Sep', price: 2634},
		{month: 'Nov', price: 2672},
	];

	const minPrice = 2000;
	const maxPrice = 2800;
	const priceRange = maxPrice - minPrice;
	const chartHeight = height - 280;
	const yAxisSteps = [2000, 2400, 2800];

	return (
		<AbsoluteFill
			style={{
				backgroundColor: COLOR_BG,
				padding: 60,
				display: 'flex',
				flexDirection: 'column',
				fontFamily,
			}}
		>
			<Title>Gold Price 2024</Title>

			<div style={{display: 'flex', flex: 1}}>
				<YAxis steps={yAxisSteps} height={chartHeight} />
				<XAxis height={chartHeight} labels={data.map((d) => d.month)}>
					{data.map((item, i) => {
						const progress = spring({
							frame: frame - i * 5 - 10,
							fps,
							config: {damping: 18, stiffness: 80},
						});

						const barHeight =
							((item.price - minPrice) / priceRange) * chartHeight * progress;

						return (
							<Bar key={item.month} height={barHeight} progress={progress} />
						);
					})}
				</XAxis>
			</div>
		</AbsoluteFill>
	);
};
