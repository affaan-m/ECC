import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useUser, useClerk, UserButton } from '@clerk/clerk-react';
import { useStore, useActions } from '../data/store.jsx';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import { Avatar, AvatarPicker } from '../components/Avatar.jsx';
import { Brand } from '../components/Logo.jsx';
import { selectTick } from '../data/haptics.js';
import {
  notificationsSupported,
  notificationPermission,
  requestNotificationPermission,
} from '../data/notifications.js';
import { downloadICS, parseICS } from '../data/ics.js';
import { formatTime } from '../data/helpers.js';
import ReorderToggleList from '../components/ReorderToggleList.jsx';
import SettingsGroup from '../components/SettingsGroup.jsx';
import { HOME_BLOCK_TYPES, normalizeHomeBlocks } from '../data/homeBlocks.js';
import { TAB_TYPES, normalizeTabOrder } from '../data/tabs.js';
import { QUICK_ADD_TYPES, normalizeQuickAdd } from '../data/quickAdd.js';
import { CLERK_ENABLED } from '../data/clerkConfig.js';
import { MAP_STYLE_OPTIONS } from '../data/mapStyles.js';
import {
  CONTACT_SWIPE_OPTIONS,
  DEFAULT_CONTACT_SWIPE_LEFT,
  DEFAULT_CONTACT_SWIPE_RIGHT,
} from '../data/contactSwipe.js';
import { backendConfigured } from '../data/api.js';
import Icon from '../components/Icon.jsx';

const formatHour = (h) => formatTime(`${String(h).padStart(2, '0')}:00`);
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: formatHour(h) }));

const DESTRUCTIVE_ACTIONS = {
  reset: {
    title: 'Reset to sample data?',
    body: 'This replaces your current data with the built-in sample set.',
    cta: 'Reset',
  },
  clear: {
    title: 'Clear everything?',
    body: 'This permanently removes all goals, events, and people. Your custom statuses are kept.',
    cta: 'Clear',
  },
  clearCache: {
    title: 'Clear cache?',
    body: 'This clears the offline app-shell cache and reloads Keystone. Your data (goals, events, people, notes) is untouched — it lives in local storage, not the cache.',
    cta: 'Clear cache',
  },
  clearContacts: {
    title: 'Remove all contacts?',
    body: 'This permanently removes everyone from People. Events and map pins are kept, just unlinked from the people they referenced.',
    cta: 'Remove all',
  },
};

// Swatches are each scheme's own light-mode accent, so the dot is literally
// the colour you get. Split into two rows because fifteen unlabelled dots in
// one grid gives no clue which are the soft ones (see styles.css for why the
// pastels are muted rather than pale).
const COLOR_SCHEMES = [
  { value: 'default', label: 'Gold', swatch: '#a9822a' },
  { value: 'emerald', label: 'Emerald', swatch: '#0f8f72' },
  { value: 'ocean', label: 'Ocean', swatch: '#1f6fb0' },
  { value: 'sunset', label: 'Sunset', swatch: '#d9601f' },
  { value: 'grape', label: 'Grape', swatch: '#7c4fd1' },
  { value: 'rose', label: 'Rose', swatch: '#c23d6b' },
  { value: 'forest', label: 'Forest', swatch: '#2f7d3a' },
  { value: 'slate', label: 'Slate', swatch: '#46586b' },
  { value: 'berry', label: 'Berry', swatch: '#a3306f' },
  { value: 'crimson', label: 'Crimson', swatch: '#c0392b' },
  { value: 'wine', label: 'Wine', swatch: '#8c2f43' },
  { value: 'clay', label: 'Clay', swatch: '#9c5b3c' },
  { value: 'olive', label: 'Olive', swatch: '#6d7d24' },
  { value: 'teal', label: 'Teal', swatch: '#0d8a9e' },
  { value: 'indigo', label: 'Indigo', swatch: '#4b56c9' },
  { value: 'plum', label: 'Plum', swatch: '#6b3b7a' },
  { value: 'charcoal', label: 'Charcoal', swatch: '#3d4348' },
];

const PASTEL_SCHEMES = [
  { value: 'lavender', label: 'Lavender', swatch: '#7a68b8' },
  { value: 'blush', label: 'Blush', swatch: '#c06b83' },
  { value: 'sage', label: 'Sage', swatch: '#5f8a63' },
  { value: 'sky', label: 'Sky', swatch: '#4f8bb5' },
  { value: 'apricot', label: 'Apricot', swatch: '#b8703c' },
  { value: 'seafoam', label: 'Seafoam', swatch: '#4e938c' },
];

const PRESET_COLORS = [
  '#2e9e6b',
  '#1f5f8b',
  '#e08a1e',
  '#8a5cd1',
  '#d1495b',
  '#3a9188',
  '#c2547a',
  '#5b7fb0',
];

export default function MorePage() {
  const { state } = useStore();
  const actions = useActions();
  const navigate = useNavigate();
  const [editingStatus, setEditingStatus] = useState(null);
  const [editingType, setEditingType] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'reset' | 'clear' | 'clearCache' | 'clearContacts' | null
  const [feedback, setFeedback] = useState(null); // string | null
  const [editingProfile, setEditingProfile] = useState(null);
  const [, setPermTick] = useState(0); // re-render after permission change
  // Which settings cards are expanded. All collapsed on arrival, so the page
  // opens as a scannable index rather than one long scroll; kept in component
  // state rather than persisted, since "where I left the accordion" isn't a
  // preference worth remembering across launches.
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const isOpen = (id) => openGroups.has(id);
  const toggleGroup = (id) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const fileRef = useRef(null);
  const icsFileRef = useRef(null);

  const theme = state.settings?.theme || 'system';
  const notifOn = !!state.settings?.notifications && notificationPermission() === 'granted';
  const isPro = !!state.settings?.isPro;
  const profileName = state.settings?.profileName || '';
  const profilePhoto = state.settings?.profilePhoto || '';
  const cloudSyncOn = !!state.settings?.cloudSync;

  const requirePro = (fn) => (isPro ? fn() : navigate('/pricing'));

  const exportICS = () => downloadICS(state.events, state.contacts);
  const importICS = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = parseICS(reader.result);
        if (imported.length === 0) return alert('No events found in that file.');
        for (const ev of imported) {
          actions.addEvent({
            ...ev,
            repeatUntil: '',
            repeatDays: [],
            doneDates: [],
            skipDates: [],
            typeId: '',
            color: '',
            reminder: 0,
            contactId: '',
          });
        }
        alert(`Imported ${imported.length} event${imported.length === 1 ? '' : 's'}.`);
      } catch {
        alert('That file could not be read as an .ics calendar.');
      }
    };
    reader.readAsText(file);
  };

  const toggleNotifications = async () => {
    if (notifOn) {
      actions.setSettings({ notifications: false });
      return;
    }
    const perm = await requestNotificationPermission();
    setPermTick((t) => t + 1);
    actions.setSettings({ notifications: perm === 'granted' });
  };

  const saveType = () => {
    const label = editingType.label.trim();
    if (!label) return;
    if (editingType.id) actions.updateEventType({ id: editingType.id, label, color: editingType.color });
    else actions.addEventType({ label, color: editingType.color });
    setEditingType(null);
  };

  const submitFeedback = (mode) => {
    const text = (feedback || '').trim();
    if (!text) return;
    if (mode === 'copy') {
      navigator.clipboard?.writeText(text).then(
        () => alert('Feedback copied to your clipboard.'),
        () => {}
      );
    } else {
      const url = `mailto:?subject=${encodeURIComponent('Keystone feedback')}&body=${encodeURIComponent(text)}`;
      window.location.href = url;
    }
    setFeedback(null);
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keystone-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        actions.importData(data);
      } catch {
        alert('That file could not be read as a Keystone backup.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const saveStatus = () => {
    const label = editingStatus.label.trim();
    if (!label) return;
    if (editingStatus.id) actions.updateStatus({ id: editingStatus.id, label, color: editingStatus.color });
    else actions.addStatus({ label, color: editingStatus.color });
    setEditingStatus(null);
  };

  const counts = {
    goals: state.goals.length,
    events: state.events.length,
    contacts: state.contacts.length,
  };

  const clearCache = async () => {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    window.location.reload();
  };

  const s = state.settings || {};
  const step = (key, delta, min, max) =>
    actions.setSettings({ [key]: Math.max(min, Math.min(max, (s[key] ?? 0) + delta)) });

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-row">
          <Brand>More</Brand>
        </div>
      </header>

      {isPro ? (
        <section className="pro-bubble-lg pro-bubble-lg--active">
          <span className="pro-bubble-lg-crown"><Icon name="crown" size={22} /></span>
          <div>
            <strong>Keystone Pro</strong>
            <p className="muted small">
              {CLERK_ENABLED && backendConfigured()
                ? 'Unlocked for good — thanks for buying.'
                : 'You have Pro (demo mode) active.'}
            </p>
          </div>
        </section>
      ) : (
        <button className="pro-bubble-lg" onClick={() => navigate('/pricing')}>
          <span className="pro-bubble-lg-crown"><Icon name="crown" size={22} /></span>
          <div>
            <strong>Unlock Keystone Pro</strong>
            <p className="muted small">
              One payment, yours for good — timelines, sharing, sync, themes, and more.
            </p>
          </div>
          <span className="pro-bubble-lg-arrow">›</span>
        </button>
      )}

      {CLERK_ENABLED && <AccountSection />}

      <SettingsGroup id="g0" open={isOpen("g0")} onToggle={() => toggleGroup("g0")}>
        <div className="section-head">
          <span className="detail-label">Profile</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditingProfile({ name: profileName, photo: profilePhoto })}>
            Edit
          </button>
        </div>
        <div className="profile-row">
          <Avatar name={profileName || 'You'} photo={profilePhoto} size="lg" />
          <div>
            <strong>{profileName || 'Add your name'}</strong>
            <p className="muted small">Stored only on this device.</p>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup id="g1" open={isOpen("g1")} onToggle={() => toggleGroup("g1")}>
        <span className="detail-label">Account & sync</span>
        <div className="section-head">
          <span>Cloud sync</span>
          <button
            className={`toggle${cloudSyncOn ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={cloudSyncOn}
            onClick={() => requirePro(() => actions.setSettings({ cloudSync: !cloudSyncOn }))}
          >
            <span className="toggle-knob" />
          </button>
        </div>
        {isPro && CLERK_ENABLED && backendConfigured() ? (
          <CloudSyncStatus cloudSyncOn={cloudSyncOn} />
        ) : (
          <p className="muted small">
            {isPro
              ? "Sync isn't connected to a server yet — flipping this on doesn't move your data anywhere. It's here so the setting is ready once a backend exists."
              : 'Keep your data synced across devices. Requires Pro.'}
          </p>
        )}
        <button className="btn btn-ghost full" onClick={() => requirePro(() => alert('Google sign-in requires a backend that is not connected in this build yet.'))}>
          <GoogleIcon /> Sign in with Google {!isPro && '· Pro'}
        </button>
        <p className="muted small">
          A personal Keystone login (no Google needed) is free and always available — this is
          only for connecting a Google account for calendar sync.
        </p>
      </SettingsGroup>

      <SettingsGroup id="g2" open={isOpen("g2")} onToggle={() => toggleGroup("g2")}>
        <span className="detail-label">Shared calendars</span>
        <p className="muted small">Invite someone to see or add events with you on a calendar you both share.</p>
        <button
          className="btn btn-ghost full"
          onClick={() => (isPro ? navigate('/shared-calendars') : navigate('/pricing'))}
        >
          <Icon name="users" /> Manage shared calendars {!isPro && '· Pro'}
        </button>
      </SettingsGroup>

      <SettingsGroup id="g3" open={isOpen("g3")} onToggle={() => toggleGroup("g3")}>
        <span className="detail-label">Calendar import / export</span>
        <p className="muted small">Move events to or from other calendar apps using the .ics format.</p>
        <div className="stack-btns">
          <button className="btn btn-ghost full" onClick={() => requirePro(exportICS)}>
            Export calendar (.ics) {!isPro && '· Pro'}
          </button>
          <button className="btn btn-ghost full" onClick={() => requirePro(() => icsFileRef.current?.click())}>
            Import calendar (.ics) {!isPro && '· Pro'}
          </button>
          <input ref={icsFileRef} type="file" accept=".ics,text/calendar" hidden onChange={importICS} />
        </div>
      </SettingsGroup>

      <SettingsGroup id="g4" open={isOpen("g4")} onToggle={() => toggleGroup("g4")}>
        <span className="detail-label">Appearance</span>
        <div className="seg seg--full">
          {['system', 'light', 'dark'].map((t) => (
            <button
              key={t}
              className={`seg-btn${theme === t ? ' seg-btn--on' : ''}`}
              onClick={() => actions.setSettings({ theme: t })}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <p className="muted small color-scheme-label">Color theme {!isPro && '· Pro'}</p>
        <SchemeRow
          schemes={COLOR_SCHEMES}
          isPro={isPro}
          current={state.settings?.colorScheme || 'default'}
          onPick={(v) => requirePro(() => actions.setSettings({ colorScheme: v }))}
        />
        <p className="muted small color-scheme-label">Pastel</p>
        <SchemeRow
          schemes={PASTEL_SCHEMES}
          isPro={isPro}
          current={state.settings?.colorScheme || 'default'}
          onPick={(v) => requirePro(() => actions.setSettings({ colorScheme: v }))}
        />

        {/* Was just "Contact icon size", which didn't say icon of what, or
            where. It's the photo/initials circle on the People list. */}
        <p className="muted small">Photo size on the People list</p>
        <div className="seg seg--full">
          {[
            { value: 'sm', label: 'Small' },
            { value: 'md', label: 'Medium' },
            { value: 'lg', label: 'Large' },
          ].map((o) => (
            <button
              key={o.value}
              className={`seg-btn${(s.contactIconSize || 'md') === o.value ? ' seg-btn--on' : ''}`}
              onClick={() => actions.setSettings({ contactIconSize: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="section-head">
          <span>Task completion animation</span>
          <button
            className={`toggle${(s.taskCompleteAnim ?? true) ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={s.taskCompleteAnim ?? true}
            onClick={() => actions.setSettings({ taskCompleteAnim: !(s.taskCompleteAnim ?? true) })}
          >
            <span className="toggle-knob" />
          </button>
        </div>

        <div className="section-head">
          <span>Haptic feedback</span>
          <button
            className={`toggle${(s.hapticsEnabled ?? true) ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={s.hapticsEnabled ?? true}
            onClick={() => actions.setSettings({ hapticsEnabled: !(s.hapticsEnabled ?? true) })}
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </SettingsGroup>

      <SettingsGroup id="g5" open={isOpen("g5")} onToggle={() => toggleGroup("g5")}>
        <span className="detail-label">Customize home screen {!isPro && '· Pro'}</span>
        <p className="muted small">
          Choose which blocks show on Home, and drag to reorder them — or edit this right from the Home page itself
          via the pencil icon in its header.
        </p>
        {isPro ? (
          <ReorderToggleList
            items={normalizeHomeBlocks(s.homeBlocks)}
            types={HOME_BLOCK_TYPES}
            onChange={(next) => actions.setSettings({ homeBlocks: next })}
          />
        ) : (
          <button type="button" className="bubble-reorder-locked" onClick={() => navigate('/pricing')}>
            <ul className="bubble-reorder-list bubble-reorder-list--preview">
              {HOME_BLOCK_TYPES.map((t) => (
                <li key={t.id} className="bubble-reorder-row">
                  <span className="bubble-reorder-icon"><Icon name={t.icon} size={20} /></span>
                  <span className="bubble-reorder-label">{t.label}</span>
                </li>
              ))}
            </ul>
            <span className="bubble-reorder-lock-hint">
              <LockIcon /> Unlock to customize
            </span>
          </button>
        )}
      </SettingsGroup>

      <SettingsGroup id="g6" open={isOpen("g6")} onToggle={() => toggleGroup("g6")}>
        <span className="detail-label">Customize quick-add menu {!isPro && '· Pro'}</span>
        <p className="muted small">Choose which actions the floating + button offers, and drag to reorder them.</p>
        {isPro ? (
          <ReorderToggleList
            items={normalizeQuickAdd(s.quickAdd)}
            types={QUICK_ADD_TYPES}
            onChange={(next) => actions.setSettings({ quickAdd: next })}
          />
        ) : (
          <button type="button" className="bubble-reorder-locked" onClick={() => navigate('/pricing')}>
            <ul className="bubble-reorder-list bubble-reorder-list--preview">
              {QUICK_ADD_TYPES.map((t) => (
                <li key={t.id} className="bubble-reorder-row">
                  <span className="bubble-reorder-icon"><Icon name={t.icon} size={20} /></span>
                  <span className="bubble-reorder-label">{t.label}</span>
                </li>
              ))}
            </ul>
            <span className="bubble-reorder-lock-hint">
              <LockIcon /> Unlock to customize
            </span>
          </button>
        )}
      </SettingsGroup>

      <SettingsGroup id="g7" open={isOpen("g7")} onToggle={() => toggleGroup("g7")}>
        <span className="detail-label">Customize navigation tabs {!isPro && '· Pro'}</span>
        <p className="muted small">Choose which tabs show in the bar, and drag to reorder them. More always stays on.</p>
        {isPro ? (
          <ReorderToggleList
            items={normalizeTabOrder(s.tabOrder)}
            types={TAB_TYPES}
            lockedIds={['more']}
            onChange={(next) => actions.setSettings({ tabOrder: next })}
          />
        ) : (
          <button type="button" className="bubble-reorder-locked" onClick={() => navigate('/pricing')}>
            <ul className="bubble-reorder-list bubble-reorder-list--preview">
              {TAB_TYPES.map((t) => (
                <li key={t.id} className="bubble-reorder-row">
                  <span className="bubble-reorder-label">{t.label}</span>
                </li>
              ))}
            </ul>
            <span className="bubble-reorder-lock-hint">
              <LockIcon /> Unlock to customize
            </span>
          </button>
        )}
      </SettingsGroup>

      <SettingsGroup id="g8" open={isOpen("g8")} onToggle={() => toggleGroup("g8")}>
        <span className="detail-label">Calendar settings</span>

        <div className="section-head">
          <span>24-hour time</span>
          <button
            className={`toggle${s.use24h ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={!!s.use24h}
            onClick={() => actions.setSettings({ use24h: !s.use24h })}
          >
            <span className="toggle-knob" />
          </button>
        </div>

        <div className="section-head">
          <span>Week starts on Sunday</span>
          <button
            className={`toggle${s.weekStartsSunday ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={!!s.weekStartsSunday}
            onClick={() => actions.setSettings({ weekStartsSunday: !s.weekStartsSunday })}
          >
            <span className="toggle-knob" />
          </button>
        </div>

        <div className="section-head">
          <span>Show tasks on day timeline</span>
          <button
            className={`toggle${s.showTasksOnTimeline ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={!!s.showTasksOnTimeline}
            onClick={() => actions.setSettings({ showTasksOnTimeline: !s.showTasksOnTimeline })}
          >
            <span className="toggle-knob" />
          </button>
        </div>

        {/* The two schedule warnings the planner can raise, separately
            switchable — the travel estimate is a guess from straight-line
            distance and some people will want it quiet while still being
            told about a genuine double-booking, which is a fact. */}
        <div className="section-head">
          <span>Warn about overlapping events</span>
          <button
            className={`toggle${s.warnOverlaps !== false ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={s.warnOverlaps !== false}
            onClick={() => actions.setSettings({ warnOverlaps: s.warnOverlaps === false })}
          >
            <span className="toggle-knob" />
          </button>
        </div>

        <div className="section-head">
          <span>Day & week templates</span>
          <button
            className={`toggle${s.showDayTemplates !== false ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={s.showDayTemplates !== false}
            onClick={() => actions.setSettings({ showDayTemplates: s.showDayTemplates === false })}
          >
            <span className="toggle-knob" />
          </button>
        </div>

        <div className="section-head">
          <span>Warn about tight travel time</span>
          <button
            className={`toggle${s.warnTravelTime !== false ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={s.warnTravelTime !== false}
            onClick={() => actions.setSettings({ warnTravelTime: s.warnTravelTime === false })}
          >
            <span className="toggle-knob" />
          </button>
        </div>

        <p className="muted small">Default event length</p>
        <div className="cadence-setting">
          <button className="step-btn" onClick={() => step('defaultEventDuration', -15, 15, 240)} aria-label="Shorter">
            −
          </button>
          <span className="cadence-value">
            <strong>{s.defaultEventDuration ?? 60}</strong> min
          </span>
          <button className="step-btn step-btn--plus" onClick={() => step('defaultEventDuration', 15, 15, 240)} aria-label="Longer">
            +
          </button>
        </div>

        <p className="muted small">Default reminder lead time</p>
        <div className="cadence-setting">
          <button className="step-btn" onClick={() => step('defaultReminderLead', -5, 0, 120)} aria-label="Less lead time">
            −
          </button>
          <span className="cadence-value">
            <strong>{s.defaultReminderLead ?? 0}</strong> min before
          </span>
          <button className="step-btn step-btn--plus" onClick={() => step('defaultReminderLead', 5, 0, 120)} aria-label="More lead time">
            +
          </button>
        </div>

        <p className="muted small">Timeline hours</p>
        <div className="field-row">
          <label className="field">
            <span>Starts</span>
            <Select
              value={s.timelineStartHour ?? 6}
              onChange={(v) =>
                actions.setSettings({
                  timelineStartHour: Math.min(Number(v), (s.timelineEndHour ?? 23) - 1),
                })
              }
              options={HOURS.filter((h) => h.value < (s.timelineEndHour ?? 23))}
            />
          </label>
          <label className="field">
            <span>Ends</span>
            <Select
              value={s.timelineEndHour ?? 23}
              onChange={(v) =>
                actions.setSettings({
                  timelineEndHour: Math.max(Number(v), (s.timelineStartHour ?? 6) + 1),
                })
              }
              options={HOURS.filter((h) => h.value > (s.timelineStartHour ?? 6))}
            />
          </label>
        </div>

        <div onClick={() => !isPro && navigate('/pricing')}>
          <p className="muted small">Event block opacity {!isPro && '· Pro'}</p>
          <input
            type="range"
            min="30"
            max="100"
            step="10"
            value={s.eventBlockOpacity ?? 100}
            onChange={(e) => {
              selectTick();
              requirePro(() => actions.setSettings({ eventBlockOpacity: Number(e.target.value) }));
            }}
            className="range-slider"
            disabled={!isPro}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup id="g9" open={isOpen("g9")} onToggle={() => toggleGroup("g9")}>
        <span className="detail-label">Map settings</span>
        <p className="muted small">Map style</p>
        <Select
          value={s.mapStyle || 'auto'}
          onChange={(v) => actions.setSettings({ mapStyle: v })}
          options={MAP_STYLE_OPTIONS}
        />
        <p className="muted small">
          "Match app theme" uses a light or dark basemap to match whichever the app is showing —
          a bright white map inside a dark app is the thing most worth avoiding here.
        </p>
        <div className="section-head">
          <span>Show contact places</span>
          <button
            className={`toggle${s.mapShowContactPins ?? true ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={s.mapShowContactPins ?? true}
            onClick={() => actions.setSettings({ mapShowContactPins: !(s.mapShowContactPins ?? true) })}
          >
            <span className="toggle-knob" />
          </button>
        </div>
        <div className="section-head">
          <span>Show custom places</span>
          <button
            className={`toggle${s.mapShowCustomPins ?? true ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={s.mapShowCustomPins ?? true}
            onClick={() => actions.setSettings({ mapShowCustomPins: !(s.mapShowCustomPins ?? true) })}
          >
            <span className="toggle-knob" />
          </button>
        </div>
        <p className="muted small">Pin emoji size</p>
        <input
          type="range"
          min="70"
          max="160"
          step="10"
          value={s.mapEmojiSize ?? 100}
          onChange={(e) => {
            selectTick();
            actions.setSettings({ mapEmojiSize: Number(e.target.value) });
          }}
          className="range-slider"
        />
      </SettingsGroup>

      <SettingsGroup id="g10" open={isOpen("g10")} onToggle={() => toggleGroup("g10")}>
        <div className="section-head">
          <span className="detail-label">Notifications</span>
          <button
            className={`toggle${notifOn ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={notifOn}
            onClick={toggleNotifications}
            disabled={!notificationsSupported()}
          >
            <span className="toggle-knob" />
          </button>
        </div>
        <p className="muted small">
          {notificationsSupported()
            ? 'Get reminders for goals and events while Keystone is open. (A web app can’t alert you once it’s fully closed.)'
            : 'This browser doesn’t support notifications.'}
        </p>
      </SettingsGroup>

      <SettingsGroup id="g11" open={isOpen("g11")} onToggle={() => toggleGroup("g11")}>
        <div className="section-head">
          <span className="detail-label">Arrival reminders</span>
          <button
            className={`toggle${state.settings?.locationRemindersEnabled ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={!!state.settings?.locationRemindersEnabled}
            onClick={() =>
              actions.setSettings({ locationRemindersEnabled: !state.settings?.locationRemindersEnabled })
            }
            disabled={!navigator.geolocation}
          >
            <span className="toggle-knob" />
          </button>
        </div>
        <p className="muted small">
          {navigator.geolocation
            ? 'Get notified when you’re near a place you’ve pinned on the Map with a reminder radius set. Only works while Keystone is open — a web app can’t track your location in the background.'
            : 'This browser doesn’t support location.'}
        </p>
      </SettingsGroup>

      <SettingsGroup id="g12" open={isOpen("g12")} onToggle={() => toggleGroup("g12")}>
        <div className="section-head">
          <span className="detail-label">Reconnect reminders</span>
          <button
            className={`toggle${s.reconnectRemindersEnabled === true ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={s.reconnectRemindersEnabled === true}
            onClick={() =>
              actions.setSettings({ reconnectRemindersEnabled: s.reconnectRemindersEnabled !== true })
            }
          >
            <span className="toggle-knob" />
          </button>
        </div>
        <p className="muted small">
          Flag people on the People tab when you haven't been in touch for this long.
          Only applies to people you've actually logged contact with — someone you've
          added but never spoken to has no lapse to report. You can override the
          interval per person.
        </p>
        {s.reconnectRemindersEnabled === true && (
        <div className="cadence-setting">
          <button
            className="step-btn"
            onClick={() =>
              actions.setSettings({ reconnectDays: Math.max(1, (state.settings?.reconnectDays ?? 30) - 5) })
            }
            aria-label="Fewer days"
          >
            −
          </button>
          <span className="cadence-value">
            <strong>{state.settings?.reconnectDays ?? 30}</strong> days
          </span>
          <button
            className="step-btn step-btn--plus"
            onClick={() =>
              actions.setSettings({ reconnectDays: Math.min(365, (state.settings?.reconnectDays ?? 30) + 5) })
            }
            aria-label="More days"
          >
            +
          </button>
        </div>
        )}
      </SettingsGroup>

      <SettingsGroup id="gswipe" open={isOpen('gswipe')} onToggle={() => toggleGroup('gswipe')}>
        <span className="detail-label">People swipe actions</span>
        <p className="muted small">
          What swiping a row on the People tab does. Deleting someone is still available from
          their own page and from Select mode, so it doesn't have to live on a swipe.
        </p>
        <p className="muted small">Swipe right</p>
        <Select
          value={s.contactSwipeRight ?? DEFAULT_CONTACT_SWIPE_RIGHT}
          onChange={(v) => actions.setSettings({ contactSwipeRight: v })}
          options={CONTACT_SWIPE_OPTIONS}
        />
        <p className="muted small">Swipe left</p>
        <Select
          value={s.contactSwipeLeft ?? DEFAULT_CONTACT_SWIPE_LEFT}
          onChange={(v) => actions.setSettings({ contactSwipeLeft: v })}
          options={CONTACT_SWIPE_OPTIONS}
        />
      </SettingsGroup>

      <SettingsGroup id="g13" open={isOpen("g13")} onToggle={() => toggleGroup("g13")}>
        <div className="section-head">
          <span>Birthdays & anniversaries</span>
          <button
            className={`toggle${s.contactBirthdaysEnabled !== false ? ' toggle--on' : ''}`}
            role="switch"
            aria-checked={s.contactBirthdaysEnabled !== false}
            onClick={() => actions.setSettings({ contactBirthdaysEnabled: s.contactBirthdaysEnabled === false })}
          >
            <span className="toggle-knob" />
          </button>
        </div>
        <p className="muted small">
          Surface a person's birthday or anniversary on Home and the calendar. Each is still
          optional per person — set them from a contact's Edit sheet.
        </p>
      </SettingsGroup>

      <SettingsGroup id="g14" open={isOpen("g14")} onToggle={() => toggleGroup("g14")}>
        <div className="section-head">
          <span className="detail-label">People statuses {!isPro && '· Pro'}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => requirePro(() => setEditingStatus({ label: '', color: PRESET_COLORS[0] }))}
          >
            + Add
          </button>
        </div>
        <p className="muted small">Custom labels you assign to people on the People tab.</p>
        <ul className="status-list">
          {state.statuses.map((s) => (
            <li key={s.id}>
              <button className="status-item" onClick={() => requirePro(() => setEditingStatus({ ...s }))}>
                <span className="swatch" style={{ background: s.color }} />
                <span>{s.label}</span>
                <span className="muted count-tag">
                  {state.contacts.filter((c) => c.statusId === s.id).length}
                </span>
              </button>
            </li>
          ))}
          {state.statuses.length === 0 && <li className="muted small">No statuses yet.</li>}
        </ul>
      </SettingsGroup>

      <SettingsGroup id="g15" open={isOpen("g15")} onToggle={() => toggleGroup("g15")}>
        <div className="section-head">
          <span className="detail-label">Event types</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setEditingType({ label: '', color: PRESET_COLORS[1] })}
          >
            + Add
          </button>
        </div>
        <p className="muted small">Color-coded categories for your calendar events.</p>
        <ul className="status-list">
          {(state.eventTypes || []).map((t) => (
            <li key={t.id}>
              <button className="status-item" onClick={() => setEditingType({ ...t })}>
                <span className="swatch" style={{ background: t.color }} />
                <span>{t.label}</span>
                <span className="muted count-tag">
                  {state.events.filter((e) => e.typeId === t.id).length}
                </span>
              </button>
            </li>
          ))}
          {(state.eventTypes || []).length === 0 && <li className="muted small">No types yet.</li>}
        </ul>
      </SettingsGroup>

      <SettingsGroup id="g16" open={isOpen("g16")} onToggle={() => toggleGroup("g16")}>
        <span className="detail-label">Feedback</span>
        <p className="muted small">Have an idea or found a bug? I'd love to hear it.</p>
        <div className="stack-btns">
          <button className="btn btn-ghost full" onClick={() => setFeedback('')}>
            <Icon name="lightbulb" /> Send feedback / suggest a feature
          </button>
          {/* The tour narrates the Home screen, so it goes there rather
              than playing on top of Settings. App.jsx owns the Tutorial for
              both the first run and this replay, so there's one code path. */}
          <button
            className="btn btn-ghost full"
            onClick={() => navigate('/', { state: { replayTour: true } })}
          >
            <Icon name="play" /> Replay the tour
          </button>
        </div>
      </SettingsGroup>

      <SettingsGroup id="g17" open={isOpen("g17")} onToggle={() => toggleGroup("g17")}>
        <span className="detail-label">Your data</span>
        <p className="muted small">
          Everything is stored privately on this device. {counts.goals} goals · {counts.events} events ·{' '}
          {counts.contacts} people.
        </p>
        <div className="stack-btns">
          <button className="btn btn-ghost full" onClick={exportData}>
            Export backup (.json)
          </button>
          <button className="btn btn-ghost full" onClick={() => fileRef.current?.click()}>
            Import backup
          </button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={importData} />
          <button className="btn btn-ghost full" onClick={() => setConfirm('reset')}>
            Reset to sample data
          </button>
          <button className="btn btn-danger-ghost full" onClick={() => setConfirm('clearCache')}>
            Clear cache
          </button>
          <button className="btn btn-danger-ghost full" onClick={() => setConfirm('clearContacts')}>
            Remove all contacts
          </button>
          <button className="btn btn-danger-ghost full" onClick={() => setConfirm('clear')}>
            Clear everything
          </button>
        </div>
      </SettingsGroup>

      <p className="muted small center-pad">Keystone · works offline · v0.2</p>

      {/* Status editor */}
      <Modal
        open={!!editingStatus}
        title={editingStatus?.id ? 'Edit status' : 'New status'}
        onClose={() => setEditingStatus(null)}
        fullPage
        footer={
          <div className="modal-actions">
            {editingStatus?.id && (
              <button
                className="btn btn-danger-ghost"
                onClick={() => {
                  actions.deleteStatus(editingStatus.id);
                  setEditingStatus(null);
                }}
              >
                Delete
              </button>
            )}
            <button className="btn btn-primary" onClick={saveStatus}>
              Save
            </button>
          </div>
        }
      >
        {editingStatus && (
          <div className="form">
            <label className="field">
              <span>Label</span>
              <input
                autoFocus
                value={editingStatus.label}
                onChange={(e) => setEditingStatus({ ...editingStatus, label: e.target.value })}
                placeholder="e.g. Close, Reconnect"
              />
            </label>
            <div className="field">
              <span>Color</span>
              <div className="color-grid">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`color-dot${editingStatus.color === c ? ' color-dot--on' : ''}`}
                    style={{ background: c }}
                    onClick={() => setEditingStatus({ ...editingStatus, color: c })}
                    aria-label={`Choose ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Event type editor */}
      <Modal
        open={!!editingType}
        title={editingType?.id ? 'Edit event type' : 'New event type'}
        onClose={() => setEditingType(null)}
        fullPage
        footer={
          <div className="modal-actions">
            {editingType?.id && (
              <button
                className="btn btn-danger-ghost"
                onClick={() => {
                  actions.deleteEventType(editingType.id);
                  setEditingType(null);
                }}
              >
                Delete
              </button>
            )}
            <button className="btn btn-primary" onClick={saveType}>
              Save
            </button>
          </div>
        }
      >
        {editingType && (
          <div className="form">
            <label className="field">
              <span>Label</span>
              <input
                autoFocus
                value={editingType.label}
                onChange={(e) => setEditingType({ ...editingType, label: e.target.value })}
                placeholder="e.g. Work, Health"
              />
            </label>
            <div className="field">
              <span>Color</span>
              <div className="color-grid">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`color-dot${editingType.color === c ? ' color-dot--on' : ''}`}
                    style={{ background: c }}
                    onClick={() => setEditingType({ ...editingType, color: c })}
                    aria-label={`Choose ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Feedback */}
      <Modal
        open={feedback !== null}
        title="Send feedback"
        onClose={() => setFeedback(null)}
        fullPage
        footer={
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => submitFeedback('copy')}>
              Copy
            </button>
            <button className="btn btn-primary" onClick={() => submitFeedback('email')}>
              Email it
            </button>
          </div>
        }
      >
        <div className="form">
          <label className="field">
            <span>What's on your mind?</span>
            <textarea
              autoFocus
              rows="5"
              value={feedback || ''}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="A feature idea, something confusing, a bug you hit…"
            />
          </label>
          <p className="muted small">
            "Email it" opens your mail app with the note ready to send. "Copy" puts it on your clipboard.
          </p>
        </div>
      </Modal>

      {/* Confirm reset / clear / clear cache / remove contacts */}
      <Modal
        open={['reset', 'clear', 'clearCache', 'clearContacts'].includes(confirm)}
        title={DESTRUCTIVE_ACTIONS[confirm]?.title}
        onClose={() => setConfirm(null)}
        footer={
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                if (confirm === 'reset') actions.resetData();
                else if (confirm === 'clear') actions.clearData();
                else if (confirm === 'clearContacts') actions.clearContacts();
                else if (confirm === 'clearCache') return clearCache();
                setConfirm(null);
              }}
            >
              {DESTRUCTIVE_ACTIONS[confirm]?.cta}
            </button>
          </div>
        }
      >
        <p>{DESTRUCTIVE_ACTIONS[confirm]?.body}</p>
      </Modal>

      {/* Profile editor */}
      <Modal
        open={!!editingProfile}
        title="Edit profile"
        onClose={() => setEditingProfile(null)}
        fullPage
        footer={
          <div className="modal-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                actions.setSettings({ profileName: editingProfile.name.trim(), profilePhoto: editingProfile.photo || '' });
                setEditingProfile(null);
              }}
            >
              Save
            </button>
          </div>
        }
      >
        {editingProfile && (
          <div className="form">
            <AvatarPicker
              name={editingProfile.name || 'You'}
              photo={editingProfile.photo}
              onChange={(photo) => setEditingProfile({ ...editingProfile, photo })}
            />
            <label className="field">
              <span>Name</span>
              <input
                autoFocus
                value={editingProfile.name}
                onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
                placeholder="Your name"
              />
            </label>
          </div>
        )}
      </Modal>

    </div>
  );
}

function AccountSection() {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();

  return (
    <section className="detail-section">
      <span className="detail-label">Account</span>
      {isSignedIn ? (
        <div className="profile-row">
          <UserButton afterSignOutUrl="/" />
          <div>
            <strong>{user?.primaryEmailAddress?.emailAddress || 'Signed in'}</strong>
            <p className="muted small">Your Pro purchase is tied to this account.</p>
          </div>
        </div>
      ) : (
        <>
          <p className="muted small">
            Sign in to buy Pro, sync your data, and keep your purchase across devices.
          </p>
          <button className="btn btn-ghost full" onClick={() => clerk.openSignIn()}>
            Sign in
          </button>
        </>
      )}
    </section>
  );
}

function CloudSyncStatus({ cloudSyncOn }) {
  const { isSignedIn } = useAuth();
  if (!cloudSyncOn) {
    return <p className="muted small">Keep your data synced across devices.</p>;
  }
  if (!isSignedIn) {
    return <p className="muted small">Sign in above to start syncing your data to your account.</p>;
  }
  return <p className="muted small">Your data syncs automatically to your account.</p>;
}

// One row of colour-scheme swatches. Shared by the standard and pastel rows
// so the lock/selection behaviour can't drift between them.
function SchemeRow({ schemes, isPro, current, onPick }) {
  return (
    <div className="scheme-grid">
      {schemes.map((s) => {
        const locked = !isPro && s.value !== 'default';
        const on = current === s.value;
        return (
          <button
            key={s.value}
            className={`scheme-dot${on ? ' scheme-dot--on' : ''}${locked ? ' scheme-dot--locked' : ''}`}
            style={{ background: s.swatch }}
            onClick={() => onPick(s.value)}
            title={s.label}
            aria-label={s.label}
          >
            {locked && <LockIcon />}
          </button>
        );
      })}
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" fill="currentColor" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M21.6 12.23c0-.68-.06-1.36-.18-2H12v3.79h5.4a4.62 4.62 0 0 1-2 3.03v2.5h3.23c1.9-1.75 2.97-4.33 2.97-7.32z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.97-.89 6.63-2.42l-3.23-2.5c-.9.6-2.05.96-3.4.96-2.6 0-4.8-1.76-5.6-4.12H3.06v2.58A10 10 0 0 0 12 22z"
        fill="#34A853"
      />
      <path d="M6.4 13.92a5.99 5.99 0 0 1 0-3.84V7.5H3.06a10 10 0 0 0 0 9l3.34-2.58z" fill="#FBBC05" />
      <path
        d="M12 6.04c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.5l3.34 2.58C7.2 7.8 9.4 6.04 12 6.04z"
        fill="#EA4335"
      />
    </svg>
  );
}
