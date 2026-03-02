#!/usr/bin/env node
/**
 * tui.ts - Terminal UI for Insta360 Link webcam controller
 * =========================================================
 * Raw ANSI terminal interface with mpv tct live video preview.
 * No framework dependencies -- just escape sequences and stdin.
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  Insta360Link,
  CameraMode,
  TrackingFrame,
} from "./insta360link.js";

// ===== ANSI helpers =====

const ESC = "\x1b";
const CSI = `${ESC}[`;

const ansi = {
  clear: `${CSI}2J`,
  home: `${CSI}H`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  saveCursor: `${ESC}7`,
  restoreCursor: `${ESC}8`,
  moveTo: (row: number, col: number) => `${CSI}${row};${col}H`,
  moveToCol: (col: number) => `${CSI}${col}G`,
  eraseToEnd: `${CSI}J`,
  eraseLine: `${CSI}2K`,
  scrollRegion: (top: number, bottom: number) => `${CSI}${top};${bottom}r`,
  resetScrollRegion: `${CSI}r`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  reset: `${CSI}0m`,
  fg: (r: number, g: number, b: number) => `${CSI}38;2;${r};${g};${b}m`,
  bg: (r: number, g: number, b: number) => `${CSI}48;2;${r};${g};${b}m`,
  // Named colors
  green: `${CSI}32m`,
  red: `${CSI}31m`,
  yellow: `${CSI}33m`,
  cyan: `${CSI}36m`,
  magenta: `${CSI}35m`,
  white: `${CSI}37m`,
  bgGray: `${CSI}48;5;236m`,
};

// ===== Terminal size =====

function getTermSize(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

// ===== State =====

interface AppState {
  mode: CameraMode;
  tracking: boolean;
  frame: TrackingFrame;
  pan: number;
  tilt: number;
  zoom: number;
  log: string[];
  showVideo: boolean;
}

// ===== Control bar rendering =====

const CONTROL_ROWS = 10; // rows reserved for the control bar at the bottom

function renderBar(cam: Insta360Link, state: AppState) {
  const { cols, rows } = getTermSize();
  const barStart = rows - CONTROL_ROWS + 1;

  let out = "";

  // Position cursor at the control bar area
  out += ansi.saveCursor;

  // --- Row 1: separator ---
  out += ansi.moveTo(barStart, 1) + ansi.eraseLine;
  out += ansi.dim + "─".repeat(cols) + ansi.reset;

  // --- Row 2: device info ---
  out += ansi.moveTo(barStart + 1, 1) + ansi.eraseLine;
  out += `${ansi.bold}${ansi.green}${cam.deviceName}${ansi.reset}`;
  out += `${ansi.dim} (${cam.devicePath}) ${cam.cameraModel}${ansi.reset}`;

  // --- Row 3: mode + tracking ---
  out += ansi.moveTo(barStart + 2, 1) + ansi.eraseLine;

  const modeColor =
    state.mode === "deskview" ? ansi.yellow :
    state.mode === "whiteboard" ? ansi.cyan :
    state.mode === "overhead" ? ansi.magenta :
    ansi.white;
  out += ` Mode: ${modeColor}${ansi.bold}${state.mode.toUpperCase()}${ansi.reset}`;

  const trackColor = state.tracking ? ansi.green : ansi.red;
  out += `   AI Tracking: ${trackColor}${ansi.bold}${state.tracking ? "ON" : "OFF"}${ansi.reset}`;

  if (state.tracking) {
    out += `   Frame: ${ansi.bold}${state.frame.toUpperCase()}${ansi.reset}`;
  }

  // --- Row 4: PTZ ---
  out += ansi.moveTo(barStart + 3, 1) + ansi.eraseLine;

  const ptzBar = (val: number, min: number, max: number, w: number) => {
    if (max <= min) return "[" + "─".repeat(w) + "]";
    const ratio = (val - min) / (max - min);
    const pos = Math.round(ratio * (w - 1));
    return "[" + "─".repeat(pos) + "█" + "─".repeat(Math.max(0, w - 1 - pos)) + "]";
  };

  const bw = 20;
  out += ` Pan:${String(state.pan).padStart(8)} ${ptzBar(state.pan, cam.panRange.min, cam.panRange.max, bw)}`;
  out += `  Tilt:${String(state.tilt).padStart(8)} ${ptzBar(state.tilt, cam.tiltRange.min, cam.tiltRange.max, bw)}`;

  out += ansi.moveTo(barStart + 4, 1) + ansi.eraseLine;
  out += ` Zoom:${String(state.zoom).padStart(4)} ${ptzBar(state.zoom, cam.zoomRange.min, cam.zoomRange.max, bw)}`;
  out += `  Video: ${state.showVideo ? `${ansi.green}ON${ansi.reset}` : `${ansi.red}OFF${ansi.reset}`}`;

  // --- Row 5: separator ---
  out += ansi.moveTo(barStart + 5, 1) + ansi.eraseLine;
  out += ansi.dim + "─".repeat(cols) + ansi.reset;

  // --- Row 6-7: key help ---
  out += ansi.moveTo(barStart + 6, 1) + ansi.eraseLine;
  const keys1 = [
    ["←→↑↓", "Pan/Tilt"],
    ["+/-", "Zoom"],
    ["t", "Tracking"],
    ["f", "Frame"],
    ["d", "DeskView"],
    ["w", "Whiteboard"],
  ];
  out += " " + keys1.map(([k, d]) => `${ansi.cyan}${ansi.bold}${k}${ansi.reset}${ansi.dim} ${d}${ansi.reset}`).join("  ");

  out += ansi.moveTo(barStart + 7, 1) + ansi.eraseLine;
  const keys2 = [
    ["o", "Overhead"],
    ["n", "Normal"],
    ["h", "Home"],
    ["v", "Video"],
    ["1-6", "Preset"],
    ["q", "Quit"],
  ];
  out += " " + keys2.map(([k, d]) => `${ansi.cyan}${ansi.bold}${k}${ansi.reset}${ansi.dim} ${d}${ansi.reset}`).join("  ");

  // --- Row 8-9: log ---
  const visibleLogs = state.log.slice(-2);
  for (let i = 0; i < 2; i++) {
    out += ansi.moveTo(barStart + 8 + i, 1) + ansi.eraseLine;
    if (visibleLogs[i]) {
      out += `${ansi.dim}${visibleLogs[i]}${ansi.reset}`;
    }
  }

  out += ansi.restoreCursor;
  process.stdout.write(out);
}

// ===== mpv video process =====

function startMpv(devicePath: string, rows: number): ChildProcess {
  // mpv renders into the top portion of the terminal
  const videoHeight = rows - CONTROL_ROWS;

  const proc = spawn("mpv", [
    `av://v4l2:${devicePath}`,
    "--vo=tct",
    "--profile=low-latency",
    `--vo-tct-height=${videoHeight}`,
    "--vo-tct-algo=half-blocks",
    "--vo-tct-buffering=frame",
    "--really-quiet",
    "--no-audio",
    "--untimed",
    "--no-cache",
    "--no-input-terminal",
    "--input-default-bindings=no",
    "--no-osc",
    "--no-terminal",
    "--vf=fps=15",
  ], {
    stdio: ["ignore", "pipe", "ignore"],
    detached: false,
  });

  proc.stdout?.on("data", (data: Buffer) => {
    // mpv writes ANSI-encoded video frames to stdout
    // Position at top-left before writing
    process.stdout.write(ansi.home + data);
  });

  return proc;
}

// ===== Key parsing =====

interface KeyEvent {
  name: string;
  shift: boolean;
  raw: Buffer;
}

function parseKey(buf: Buffer): KeyEvent {
  const str = buf.toString("utf8");

  // Arrow keys
  if (str === "\x1b[A") return { name: "up", shift: false, raw: buf };
  if (str === "\x1b[B") return { name: "down", shift: false, raw: buf };
  if (str === "\x1b[C") return { name: "right", shift: false, raw: buf };
  if (str === "\x1b[D") return { name: "left", shift: false, raw: buf };

  // Shift+arrows
  if (str === "\x1b[1;2A") return { name: "up", shift: true, raw: buf };
  if (str === "\x1b[1;2B") return { name: "down", shift: true, raw: buf };
  if (str === "\x1b[1;2C") return { name: "right", shift: true, raw: buf };
  if (str === "\x1b[1;2D") return { name: "left", shift: true, raw: buf };

  // Ctrl+C
  if (str === "\x03") return { name: "ctrl-c", shift: false, raw: buf };

  // Regular character
  const ch = str[0] ?? "";
  const isUpper = ch >= "A" && ch <= "Z";
  return {
    name: ch.toLowerCase(),
    shift: isUpper || (ch >= "!" && ch <= ")"), // Shift+1-9 = !@#$%^&*(
    raw: buf,
  };
}

// Map shift+number keys to preset indices
function shiftNumToPreset(ch: string): number | null {
  const map: Record<string, number> = {
    "!": 0, "@": 1, "#": 2, "$": 3, "%": 4, "^": 5,
  };
  return map[ch] ?? null;
}

// ===== Main =====

function main() {
  const cam = new Insta360Link();
  const devPath = process.argv[2] ?? Insta360Link.autoDetect();

  if (!devPath) {
    console.error("No camera found. Usage: insta360-tui [/dev/videoN]");
    process.exit(1);
  }

  if (!cam.open(devPath)) {
    console.error(`Cannot open ${devPath}`);
    process.exit(1);
  }

  const state: AppState = {
    mode: cam.currentMode,
    tracking: cam.aiTrackingEnabled,
    frame: cam.trackingFrame,
    pan: cam.getPanAbsolute(),
    tilt: cam.getTiltAbsolute(),
    zoom: cam.getZoom(),
    log: [],
    showVideo: true,
  };

  cam.onLog = (msg) => {
    state.log.push(msg);
    if (state.log.length > 50) state.log.shift();
    renderBar(cam, state);
  };

  // Setup terminal
  const { rows } = getTermSize();
  process.stdout.write(ansi.clear + ansi.home + ansi.hideCursor);

  // Start mpv for video
  let mpvProc: ChildProcess | null = startMpv(devPath, rows);

  // Initial control bar render
  renderBar(cam, state);

  // Re-render on terminal resize
  process.stdout.on("resize", () => {
    const newSize = getTermSize();
    // Restart mpv with new dimensions
    if (mpvProc && state.showVideo) {
      mpvProc.kill("SIGTERM");
      mpvProc = startMpv(devPath, newSize.rows);
    }
    renderBar(cam, state);
  });

  // Raw mode for keyboard input
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  const PAN_STEP = 5;
  const TILT_STEP = 5;
  const ZOOM_STEP = 10;

  function cleanup() {
    if (mpvProc) {
      mpvProc.kill("SIGTERM");
      mpvProc = null;
    }
    cam.close();
    process.stdout.write(ansi.resetScrollRegion + ansi.showCursor + ansi.clear + ansi.home);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  process.stdin.on("data", (data: string) => {
    const key = parseKey(Buffer.from(data, "utf8"));

    switch (key.name) {
      case "q":
      case "ctrl-c":
        cleanup();
        return;

      // Video toggle
      case "v":
        state.showVideo = !state.showVideo;
        if (state.showVideo) {
          mpvProc = startMpv(devPath, getTermSize().rows);
        } else if (mpvProc) {
          mpvProc.kill("SIGTERM");
          mpvProc = null;
          // Clear the video area
          const { rows: r } = getTermSize();
          let clearStr = "";
          for (let i = 1; i <= r - CONTROL_ROWS; i++) {
            clearStr += ansi.moveTo(i, 1) + ansi.eraseLine;
          }
          process.stdout.write(clearStr);
        }
        break;

      // PTZ
      case "left":
        cam.panTiltRelative(-PAN_STEP, 0);
        state.pan = cam.getPanAbsolute();
        break;
      case "right":
        cam.panTiltRelative(PAN_STEP, 0);
        state.pan = cam.getPanAbsolute();
        break;
      case "up":
        cam.panTiltRelative(0, TILT_STEP);
        state.tilt = cam.getTiltAbsolute();
        break;
      case "down":
        cam.panTiltRelative(0, -TILT_STEP);
        state.tilt = cam.getTiltAbsolute();
        break;

      // Zoom
      case "+":
      case "=":
        state.zoom = Math.min(cam.zoomRange.max, state.zoom + ZOOM_STEP);
        cam.setZoom(state.zoom);
        break;
      case "-":
        state.zoom = Math.max(cam.zoomRange.min, state.zoom - ZOOM_STEP);
        cam.setZoom(state.zoom);
        break;

      // Home
      case "h":
        cam.gimbalReset();
        state.pan = 0;
        state.tilt = 0;
        state.zoom = 100;
        break;

      // Tracking
      case "t":
        state.tracking = !state.tracking;
        cam.setAITracking(state.tracking);
        if (state.tracking) state.mode = CameraMode.Normal;
        break;

      // Frame mode cycle
      case "f": {
        const frames = [TrackingFrame.Head, TrackingFrame.HalfBody, TrackingFrame.FullBody];
        const idx = (frames.indexOf(state.frame) + 1) % frames.length;
        state.frame = frames[idx];
        cam.setTrackingFrame(state.frame);
        break;
      }

      // Camera modes
      case "d": {
        const enable = state.mode !== CameraMode.DeskView;
        cam.setDeskView(enable);
        state.mode = enable ? CameraMode.DeskView : CameraMode.Normal;
        state.tracking = false;
        break;
      }
      case "w": {
        const enable = state.mode !== CameraMode.Whiteboard;
        cam.setWhiteboard(enable);
        state.mode = enable ? CameraMode.Whiteboard : CameraMode.Normal;
        state.tracking = false;
        break;
      }
      case "o": {
        const enable = state.mode !== CameraMode.Overhead;
        cam.setOverhead(enable);
        state.mode = enable ? CameraMode.Overhead : CameraMode.Normal;
        state.tracking = false;
        break;
      }
      case "n":
        cam.setCameraMode(CameraMode.Normal);
        state.mode = CameraMode.Normal;
        state.tracking = false;
        break;

      // Presets: 1-6 recall
      case "1": case "2": case "3": case "4": case "5": case "6": {
        const idx = parseInt(key.name) - 1;
        cam.recallPreset(idx);
        state.pan = cam.getPanAbsolute();
        state.tilt = cam.getTiltAbsolute();
        state.zoom = cam.getZoom();
        break;
      }

      default: {
        // Check for shift+number (preset save)
        const raw = data[0] ?? "";
        const presetIdx = shiftNumToPreset(raw);
        if (presetIdx !== null) {
          cam.savePreset(presetIdx);
        }
        break;
      }
    }

    renderBar(cam, state);
  });
}

main();
