import { useState } from 'react';
import Logo from './Logo.jsx';

const STEPS = [
  {
    icon: <Logo size={56} />,
    title: 'Welcome to Keystone',
    body: "A quick tour of what's here — six pages, and the gestures that make them fast to use.",
  },
  {
    icon: '🏠',
    title: 'Home',
    body: "Your day at a glance: goal progress rings, today's important reminders, tasks, and notes. Tap the + to quick-add any of them.",
  },
  {
    icon: '🎯',
    title: 'Goals',
    body: 'Track weekly or custom-period goals. Tap a goal to log progress toward it.',
  },
  {
    icon: '📅',
    title: 'Planner',
    body:
      'Day, Week, and Month views. Tap empty space on the timeline to add an event. Press and hold a block, then drag up or down to change its time — drag it all the way to the edge of the screen to move it to another day. Swipe left or right (on the timeline or on an event) to change days.',
  },
  {
    icon: '👥',
    title: 'People',
    body: 'Keep track of the people in your life — statuses, reconnect reminders, and notes. Pro unlocks status groups and a full contact timeline.',
  },
  {
    icon: '📍',
    title: 'Map',
    body: 'Drop pins for places that matter, and see where your contacts live. Long-press the map to drop a pin anywhere.',
  },
  {
    icon: '⚙️',
    title: 'More',
    body: 'Themes, notifications, backups, and everything else lives here — including this tour, if you ever want to replay it.',
  },
  {
    icon: '✅',
    title: "You're all set",
    body: 'Jump in — nothing here is permanent, and you can always come back to More to explore further.',
  },
];

export default function Tutorial({ onDone }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const s = STEPS[step];

  return (
    <div className="tutorial-backdrop">
      <div className="tutorial-card">
        <button className="tutorial-skip" onClick={onDone}>
          Skip
        </button>
        <div className="tutorial-icon">{s.icon}</div>
        <h2>{s.title}</h2>
        <p>{s.body}</p>
        <div className="tutorial-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={`tutorial-dot${i === step ? ' tutorial-dot--on' : ''}`} />
          ))}
        </div>
        <div className="tutorial-actions">
          {step > 0 && (
            <button className="btn btn-ghost" onClick={() => setStep((v) => v - 1)}>
              Back
            </button>
          )}
          <button
            className="btn btn-primary full"
            onClick={() => (last ? onDone() : setStep((v) => v + 1))}
          >
            {last ? "Let's go" : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
