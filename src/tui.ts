#!/usr/bin/env node
/**
 * tui.ts - Terminal UI for Insta360 Link webcam controller
 * =========================================================
 * Interactive terminal interface with real-time camera controls.
 */

import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import {
  Insta360Link,
  CameraMode,
  TrackingFrame,
  TrackingTarget,
  type CtrlRange,
} from "./insta360link.js";

// ===== Components =====

function StatusBar({ cam }: { cam: Insta360Link }) {
  return React.createElement(
    Box,
    { flexDirection: "row", gap: 2, marginBottom: 1 },
    React.createElement(
      Text,
      { bold: true, color: "green" },
      cam.deviceName
    ),
    React.createElement(
      Text,
      { dimColor: true },
      `(${cam.devicePath})`
    ),
    React.createElement(
      Text,
      { color: "cyan" },
      `Model: ${cam.cameraModel}`
    )
  );
}

function ModeIndicator({
  mode,
  tracking,
  frame,
}: {
  mode: CameraMode;
  tracking: boolean;
  frame: TrackingFrame;
}) {
  const modeColors: Record<string, string> = {
    normal: "white",
    deskview: "yellow",
    whiteboard: "blue",
    overhead: "magenta",
  };
  return React.createElement(
    Box,
    { flexDirection: "row", gap: 2, marginBottom: 1 },
    React.createElement(
      Text,
      null,
      "Mode: ",
      React.createElement(
        Text,
        { bold: true, color: modeColors[mode] ?? "white" },
        mode.toUpperCase()
      )
    ),
    React.createElement(
      Text,
      null,
      "AI Tracking: ",
      React.createElement(
        Text,
        { bold: true, color: tracking ? "green" : "red" },
        tracking ? "ON" : "OFF"
      )
    ),
    tracking &&
      React.createElement(
        Text,
        null,
        "Frame: ",
        React.createElement(Text, { bold: true }, frame.toUpperCase())
      )
  );
}

function PTZDisplay({
  pan,
  tilt,
  zoom,
  panRange,
  tiltRange,
  zoomRange,
}: {
  pan: number;
  tilt: number;
  zoom: number;
  panRange: CtrlRange;
  tiltRange: CtrlRange;
  zoomRange: CtrlRange;
}) {
  const bar = (val: number, min: number, max: number, width: number) => {
    const ratio = max > min ? (val - min) / (max - min) : 0.5;
    const pos = Math.round(ratio * (width - 1));
    return (
      "[" +
      ".".repeat(pos) +
      "#" +
      ".".repeat(Math.max(0, width - 1 - pos)) +
      "]"
    );
  };

  return React.createElement(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    React.createElement(
      Text,
      null,
      `  Pan:  ${pan.toString().padStart(7)}  ${bar(pan, panRange.min, panRange.max, 30)}`
    ),
    React.createElement(
      Text,
      null,
      `  Tilt: ${tilt.toString().padStart(7)}  ${bar(tilt, tiltRange.min, tiltRange.max, 30)}`
    ),
    React.createElement(
      Text,
      null,
      `  Zoom: ${zoom.toString().padStart(7)}  ${bar(zoom, zoomRange.min, zoomRange.max, 30)}`
    )
  );
}

function HelpBar() {
  const keys = [
    ["arrows", "Pan/Tilt"],
    ["+/-", "Zoom"],
    ["t", "Tracking"],
    ["f", "Frame mode"],
    ["d", "DeskView"],
    ["w", "Whiteboard"],
    ["o", "Overhead"],
    ["n", "Normal"],
    ["h", "Home/Center"],
    ["1-6", "Recall preset"],
    ["S+1-6", "Save preset"],
    ["q", "Quit"],
  ];

  return React.createElement(
    Box,
    { flexDirection: "column", borderStyle: "single", borderColor: "gray", paddingX: 1 },
    React.createElement(
      Text,
      { bold: true, color: "yellow" },
      "Controls"
    ),
    React.createElement(
      Box,
      { flexDirection: "row", flexWrap: "wrap", columnGap: 2 },
      ...keys.map(([key, desc]) =>
        React.createElement(
          Text,
          { key: key },
          React.createElement(Text, { color: "cyan", bold: true }, key),
          React.createElement(Text, { dimColor: true }, ` ${desc}`)
        )
      )
    )
  );
}

function LogView({ logs }: { logs: string[] }) {
  const visible = logs.slice(-5);
  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    React.createElement(Text, { dimColor: true }, "--- Log ---"),
    ...visible.map((l, i) =>
      React.createElement(Text, { key: i, dimColor: true }, l)
    )
  );
}

// ===== Main App =====

function App({ cam }: { cam: Insta360Link }) {
  const { exit } = useApp();
  const [mode, setMode] = useState(cam.currentMode);
  const [tracking, setTracking] = useState(cam.aiTrackingEnabled);
  const [frame, setFrame] = useState(cam.trackingFrame);
  const [pan, setPan] = useState(cam.getPanAbsolute());
  const [tilt, setTilt] = useState(cam.getTiltAbsolute());
  const [zoom, setZoom] = useState(cam.getZoom());
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    cam.onLog = (msg) => {
      setLogs((prev) => [...prev.slice(-20), msg]);
    };
  }, [cam]);

  const PAN_STEP = 5;
  const TILT_STEP = 5;
  const ZOOM_STEP = 10;

  useInput((input, key) => {
    // Quit
    if (input === "q") {
      cam.close();
      exit();
      return;
    }

    // PTZ - Arrow keys
    if (key.leftArrow) {
      cam.panTiltRelative(-PAN_STEP, 0);
      setPan(cam.getPanAbsolute());
    }
    if (key.rightArrow) {
      cam.panTiltRelative(PAN_STEP, 0);
      setPan(cam.getPanAbsolute());
    }
    if (key.upArrow) {
      cam.panTiltRelative(0, TILT_STEP);
      setTilt(cam.getTiltAbsolute());
    }
    if (key.downArrow) {
      cam.panTiltRelative(0, -TILT_STEP);
      setTilt(cam.getTiltAbsolute());
    }

    // Zoom
    if (input === "+" || input === "=") {
      const newZoom = Math.min(cam.zoomRange.max, zoom + ZOOM_STEP);
      cam.setZoom(newZoom);
      setZoom(newZoom);
    }
    if (input === "-") {
      const newZoom = Math.max(cam.zoomRange.min, zoom - ZOOM_STEP);
      cam.setZoom(newZoom);
      setZoom(newZoom);
    }

    // Home/center
    if (input === "h") {
      cam.gimbalReset();
      setPan(0);
      setTilt(0);
      setZoom(100);
    }

    // Tracking toggle
    if (input === "t") {
      const newState = !tracking;
      cam.setAITracking(newState);
      setTracking(newState);
      if (newState) setMode(CameraMode.Normal);
    }

    // Frame mode cycle
    if (input === "f") {
      const frames = [TrackingFrame.Head, TrackingFrame.HalfBody, TrackingFrame.FullBody];
      const idx = (frames.indexOf(frame) + 1) % frames.length;
      cam.setTrackingFrame(frames[idx]);
      setFrame(frames[idx]);
    }

    // Camera modes
    if (input === "d") {
      const enable = mode !== CameraMode.DeskView;
      cam.setDeskView(enable);
      setMode(enable ? CameraMode.DeskView : CameraMode.Normal);
      setTracking(false);
    }
    if (input === "w") {
      const enable = mode !== CameraMode.Whiteboard;
      cam.setWhiteboard(enable);
      setMode(enable ? CameraMode.Whiteboard : CameraMode.Normal);
      setTracking(false);
    }
    if (input === "o") {
      const enable = mode !== CameraMode.Overhead;
      cam.setOverhead(enable);
      setMode(enable ? CameraMode.Overhead : CameraMode.Normal);
      setTracking(false);
    }
    if (input === "n") {
      cam.setCameraMode(CameraMode.Normal);
      setMode(CameraMode.Normal);
      setTracking(false);
    }

    // Presets: 1-6 to recall, Shift+1-6 to save
    const presetNum = parseInt(input);
    if (presetNum >= 1 && presetNum <= 6) {
      if (key.shift) {
        cam.savePreset(presetNum - 1);
      } else {
        cam.recallPreset(presetNum - 1);
        setPan(cam.getPanAbsolute());
        setTilt(cam.getTiltAbsolute());
        setZoom(cam.getZoom());
      }
    }
  });

  return React.createElement(
    Box,
    { flexDirection: "column", padding: 1 },
    React.createElement(
      Text,
      { bold: true, color: "white" },
      "Insta360 Link Controller"
    ),
    React.createElement(StatusBar, { cam }),
    React.createElement(ModeIndicator, { mode, tracking, frame }),
    React.createElement(PTZDisplay, {
      pan,
      tilt,
      zoom,
      panRange: cam.panRange,
      tiltRange: cam.tiltRange,
      zoomRange: cam.zoomRange,
    }),
    React.createElement(HelpBar, null),
    React.createElement(LogView, { logs })
  );
}

// ===== Entry point =====

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

  render(React.createElement(App, { cam }));
}

main();
