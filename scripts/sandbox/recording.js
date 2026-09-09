'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { listEvents, readRun, writeJsonAtomic } = require('./session-store');
const MAX_VIDEO_FRAMES = 180;

function writePrivateAtomic(filePath, content) {
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}`);
  fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

function renderEvent(event) {
  const prefix = `[${String(event.seq).padStart(4, '0')}] ${event.type}`;
  if (event.text !== undefined) return `${prefix} ${event.text}\r\n`;
  if (event.exit !== undefined) return `${prefix} exit=${event.exit}\r\n`;
  return `${prefix}\r\n`;
}

function writeCast(runId, root) {
  const current = readRun(runId, root);
  const events = listEvents(runId, root);
  const header = {
    version: 2,
    width: 120,
    height: 36,
    timestamp: Math.floor(current.session.created_ms / 1000),
    env: { TERM: 'xterm-256color', SHELL: '/bin/sh' },
    title: `ECC sandbox ${runId}`,
  };
  const lines = [JSON.stringify(header)];
  for (const event of events) {
    lines.push(JSON.stringify([event.elapsed_ms / 1000, 'o', renderEvent(event)]));
  }
  const content = `${lines.join('\n')}\n`;
  const castPath = path.join(current.run_directory, 'review.cast');
  writePrivateAtomic(castPath, content);
  return {
    path: castPath,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    events: events.length,
  };
}

function subtitleTime(milliseconds) {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  const millis = value % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function subtitleText(event) {
  return renderEvent(event)
    .replace(/\r?\n/g, ' ')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, 500);
}

function writeSubtitles(runId, root) {
  const current = readRun(runId, root);
  const events = listEvents(runId, root);
  const blocks = events.map((event, index) => {
    const start = event.elapsed_ms;
    const next = events[index + 1]?.elapsed_ms;
    const end = Math.max(start + 500, Number.isFinite(next) ? next : start + 1_500);
    return `${index + 1}\n${subtitleTime(start)} --> ${subtitleTime(end)}\n${subtitleText(event)}\n`;
  });
  const subtitlePath = path.join(current.run_directory, 'review.srt');
  writePrivateAtomic(subtitlePath, `${blocks.join('\n')}\n`);
  return { path: subtitlePath, events };
}

const FONT = Object.fromEntries(Object.entries({
  ' ': ['00','00','00','00','00','00','00'],
  '?': ['0e','11','01','02','04','00','04'],
  '[': ['0e','08','08','08','08','08','0e'], ']': ['0e','02','02','02','02','02','0e'],
  '(': ['02','04','08','08','08','04','02'], ')': ['08','04','02','02','02','04','08'],
  '.': ['00','00','00','00','00','0c','0c'], ',': ['00','00','00','00','0c','0c','08'],
  ':': ['00','0c','0c','00','0c','0c','00'], ';': ['00','0c','0c','00','0c','0c','08'],
  '-': ['00','00','00','1f','00','00','00'], '_': ['00','00','00','00','00','00','1f'],
  '=': ['00','00','1f','00','1f','00','00'], '/': ['01','02','04','08','10','00','00'],
  '\\': ['10','08','04','02','01','00','00'], '+': ['00','04','04','1f','04','04','00'],
  '#': ['0a','0a','1f','0a','1f','0a','0a'], "'": ['0c','0c','08','00','00','00','00'],
  '0': ['0e','11','13','15','19','11','0e'], '1': ['04','0c','04','04','04','04','0e'],
  '2': ['0e','11','01','02','04','08','1f'], '3': ['1e','01','01','0e','01','01','1e'],
  '4': ['02','06','0a','12','1f','02','02'], '5': ['1f','10','10','1e','01','01','1e'],
  '6': ['06','08','10','1e','11','11','0e'], '7': ['1f','01','02','04','08','08','08'],
  '8': ['0e','11','11','0e','11','11','0e'], '9': ['0e','11','11','0f','01','02','0c'],
  A: ['0e','11','11','1f','11','11','11'], B: ['1e','11','11','1e','11','11','1e'],
  C: ['0f','10','10','10','10','10','0f'], D: ['1e','11','11','11','11','11','1e'],
  E: ['1f','10','10','1e','10','10','1f'], F: ['1f','10','10','1e','10','10','10'],
  G: ['0f','10','10','17','11','11','0f'], H: ['11','11','11','1f','11','11','11'],
  I: ['0e','04','04','04','04','04','0e'], J: ['01','01','01','01','11','11','0e'],
  K: ['11','12','14','18','14','12','11'], L: ['10','10','10','10','10','10','1f'],
  M: ['11','1b','15','15','11','11','11'], N: ['11','19','15','13','11','11','11'],
  O: ['0e','11','11','11','11','11','0e'], P: ['1e','11','11','1e','10','10','10'],
  Q: ['0e','11','11','11','15','12','0d'], R: ['1e','11','11','1e','14','12','11'],
  S: ['0f','10','10','0e','01','01','1e'], T: ['1f','04','04','04','04','04','04'],
  U: ['11','11','11','11','11','11','0e'], V: ['11','11','11','11','11','0a','04'],
  W: ['11','11','11','15','15','15','0a'], X: ['11','11','0a','04','0a','11','11'],
  Y: ['11','11','0a','04','04','04','04'], Z: ['1f','01','02','04','08','10','1f'],
}).map(([character, rows]) => [character, rows.map(row => Number.parseInt(row, 16))]));

function visibleLines(events, throughIndex, width = 76, height = 27) {
  const lines = [];
  for (const event of events.slice(0, throughIndex + 1)) {
    const text = renderEvent(event).replace(/\r?\n/g, ' ').replace(/[^\x20-\x7e]/g, '?').toUpperCase();
    for (let offset = 0; offset < text.length; offset += width) lines.push(text.slice(offset, offset + width));
  }
  return lines.slice(-height);
}

function writePpm(filePath, lines) {
  const width = 960;
  const height = 540;
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii');
  const pixels = Buffer.alloc(width * height * 3, 17);
  const scale = 2;
  const originX = 22;
  const originY = 20;
  const foreground = [230, 235, 240];
  lines.forEach((line, lineIndex) => {
    [...line].forEach((character, characterIndex) => {
      const glyph = FONT[character] || FONT['?'];
      glyph.forEach((row, y) => {
        for (let x = 0; x < 5; x += 1) {
          if ((row & (1 << (4 - x))) === 0) continue;
          for (let dy = 0; dy < scale; dy += 1) {
            for (let dx = 0; dx < scale; dx += 1) {
              const pixelX = originX + (characterIndex * 12) + (x * scale) + dx;
              const pixelY = originY + (lineIndex * 18) + (y * scale) + dy;
              const index = ((pixelY * width) + pixelX) * 3;
              foreground.forEach((value, channel) => { pixels[index + channel] = value; });
            }
          }
        }
      });
    });
  });
  fs.writeFileSync(filePath, Buffer.concat([header, pixels]), { mode: 0o600 });
}

function ffconcatQuote(filePath) {
  return `'${filePath.replace(/'/g, `'\\''`)}'`;
}

function writeVideoFrames(runId, root) {
  const current = readRun(runId, root);
  const allEvents = listEvents(runId, root);
  const events = allEvents.length <= MAX_VIDEO_FRAMES
    ? allEvents
    : Array.from({ length: MAX_VIDEO_FRAMES }, (_, index) => (
      allEvents[Math.round(index * (allEvents.length - 1) / (MAX_VIDEO_FRAMES - 1))]
    ));
  const frameDirectory = fs.mkdtempSync(path.join(current.run_directory, '.video-frames-'));
  fs.chmodSync(frameDirectory, 0o700);
  const concat = ['ffconcat version 1.0'];
  events.forEach((event, index) => {
    const framePath = path.join(frameDirectory, `frame-${String(index).padStart(4, '0')}.ppm`);
    writePpm(framePath, visibleLines(events, index));
    const next = events[index + 1]?.elapsed_ms;
    const duration = Math.max(0.25, ((Number.isFinite(next) ? next : event.elapsed_ms + 1_000) - event.elapsed_ms) / 1000);
    concat.push(`file ${ffconcatQuote(framePath)}`, `duration ${duration.toFixed(3)}`);
  });
  if (events.length > 0) {
    concat.push(`file ${ffconcatQuote(path.join(frameDirectory, `frame-${String(events.length - 1).padStart(4, '0')}.ppm`))}`);
  }
  const concatPath = path.join(frameDirectory, 'frames.ffconcat');
  writePrivateAtomic(concatPath, `${concat.join('\n')}\n`);
  return { frameDirectory, concatPath, events };
}

function exportMp4(runId, root, dependencies = {}) {
  const run = dependencies.run || ((executable, argv) => spawnSync(executable, argv, {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  }));
  const version = run('ffmpeg', ['-version']);
  if (version.error?.code === 'ENOENT' || version.status !== 0) {
    throw new Error('MP4 export requires ffmpeg; install it with: brew install ffmpeg');
  }
  const current = readRun(runId, root);
  if (!['completed', 'error', 'lease-expired', 'recovered'].includes(current.state.status)) {
    throw new Error('MP4 export requires a terminal sandbox run');
  }
  writeSubtitles(runId, root);
  const frames = writeVideoFrames(runId, root);
  const outputPath = path.join(current.run_directory, 'review.mp4');
  const temporaryOutput = path.join(
    current.run_directory,
    `.review.mp4.${process.pid}.${crypto.randomBytes(6).toString('hex')}`
  );
  const rendered = run('ffmpeg', [
    '-n', '-f', 'concat', '-safe', '0', '-i', frames.concatPath,
    '-vf', 'scale=1280:720:flags=neighbor', '-r', '30',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-f', 'mp4',
    temporaryOutput,
  ]);
  fs.rmSync(frames.frameDirectory, { recursive: true, force: true });
  if (rendered.status !== 0 || !fs.existsSync(temporaryOutput)) {
    fs.rmSync(temporaryOutput, { force: true });
    throw new Error(`ffmpeg could not export the redacted review video: ${String(rendered.stderr || rendered.stdout || '').trim()}`);
  }
  fs.renameSync(temporaryOutput, outputPath);
  fs.chmodSync(outputPath, 0o600);
  const content = fs.readFileSync(outputPath);
  const artifact = {
    schema_version: 1,
    run_id: runId,
    path: outputPath,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    bytes: content.length,
    renderer: String(version.stdout || '').split(/\r?\n/, 1)[0],
    source: 'redacted-event-journal',
  };
  writeJsonAtomic(path.join(current.run_directory, 'video.json'), artifact);
  return artifact;
}

module.exports = {
  MAX_VIDEO_FRAMES, exportMp4, renderEvent, subtitleTime, visibleLines,
  writeCast, writeSubtitles, writeVideoFrames,
};
