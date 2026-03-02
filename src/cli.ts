#!/usr/bin/env node
/**
 * cli.ts - Command-line controller for Insta360 Link webcams
 * ===========================================================
 * Usage: insta360 [options] <command> [args]
 */

import { Command } from "commander";
import { V4L2 } from "./v4l2.js";
import {
  Insta360Link,
  CameraMode,
  TrackingFrame,
  TrackingTarget,
} from "./insta360link.js";

const program = new Command();

let verbose = false;

function connect(opts: { device?: string; unit?: number }): Insta360Link {
  const cam = new Insta360Link();
  if (verbose) {
    cam.onLog = (msg) => console.log(`[LOG] ${msg}`);
  }
  if (opts.unit !== undefined) cam.xuUnitId = opts.unit;

  const devPath = opts.device ?? Insta360Link.autoDetect();
  if (!devPath) {
    console.error("ERROR: No camera found. Specify with -d /dev/videoN");
    process.exit(1);
  }

  if (!cam.open(devPath)) {
    console.error(`ERROR: Cannot open ${devPath}`);
    process.exit(1);
  }

  if (!verbose) {
    console.log(`Connected: ${cam.deviceName} (${devPath})`);
  }
  return cam;
}

function parseOnOff(s: string): boolean {
  return ["on", "1", "true", "yes", "enable"].includes(s.toLowerCase());
}

function result(ok: boolean) {
  if (ok) console.log("OK");
  else console.log("Command may have failed. Try with -v for details.");
}

program
  .name("insta360")
  .description("Native Linux controller for Insta360 Link webcams")
  .version("0.1.0")
  .option("-d, --device <path>", "V4L2 device path (default: auto-detect)")
  .option("-u, --unit <id>", "XU unit ID (default: auto-detect)", parseInt)
  .option("-v, --verbose", "Verbose output")
  .enablePositionalOptions()
  .passThroughOptions()
  .hook("preAction", (thisCommand) => {
    const rootOpts = program.opts();
    verbose = rootOpts.verbose ?? false;
  });

// ===== List devices =====
program
  .command("list")
  .description("List available video devices")
  .action(() => {
    const devices = V4L2.enumDevices();
    if (devices.length === 0) {
      console.log("No V4L2 video devices found.");
    } else {
      for (const d of devices) {
        console.log(`${d.path}  [${d.card} - ${d.driver}]`);
      }
    }
  });

// ===== Info =====
program
  .command("info")
  .description("Show camera info and all controls")
  .action(() => {
    const cam = connect(program.opts());
    console.log(`\nDevice: ${cam.deviceName}`);
    console.log(`Driver: ${cam.driverName}`);
    console.log(`Bus:    ${cam.busInfo}`);
    console.log(`Model:  ${cam.cameraModel}`);
    console.log(`XU ID:  ${cam.xuUnitId}`);

    console.log("\n=== Available Controls ===");
    for (const c of cam.enumerateControls()) {
      console.log(
        `  ${c.name.padEnd(30)} val=${c.value}  min=${c.min}  max=${c.max}  step=${c.step}  def=${c.defaultValue}`
      );
    }

    console.log("\n=== Control Ranges ===");
    if (cam.panRange.available)
      console.log(`  Pan:        ${cam.panRange.min}..${cam.panRange.max}  current=${cam.getPanAbsolute()}`);
    if (cam.tiltRange.available)
      console.log(`  Tilt:       ${cam.tiltRange.min}..${cam.tiltRange.max}  current=${cam.getTiltAbsolute()}`);
    if (cam.zoomRange.available)
      console.log(`  Zoom:       ${cam.zoomRange.min}..${cam.zoomRange.max}  current=${cam.getZoom()}`);
    if (cam.focusRange.available)
      console.log(`  Focus:      ${cam.focusRange.min}..${cam.focusRange.max}`);
    if (cam.brightnessRange.available)
      console.log(`  Brightness: ${cam.brightnessRange.min}..${cam.brightnessRange.max}  current=${cam.getBrightness()}`);

    cam.close();
  });

// ===== PTZ =====
program
  .command("pan <value>")
  .description("Set absolute pan (-522000..522000)")
  .action((value) => {
    const cam = connect(program.opts());
    result(cam.setPanAbsolute(parseInt(value)));
    cam.close();
  });

program
  .command("tilt <value>")
  .description("Set absolute tilt (-324000..360000)")
  .action((value) => {
    const cam = connect(program.opts());
    result(cam.setTiltAbsolute(parseInt(value)));
    cam.close();
  });

program
  .command("move <panDelta> <tiltDelta>")
  .description("Relative pan/tilt (-30..30 each)")
  .action((px, ty) => {
    const cam = connect(program.opts());
    result(cam.panTiltRelative(parseInt(px), parseInt(ty)));
    cam.close();
  });

program
  .command("zoom <value>")
  .description("Set zoom (100=1x to 400=4x)")
  .action((value) => {
    const cam = connect(program.opts());
    result(cam.setZoom(parseInt(value)));
    cam.close();
  });

program
  .command("home")
  .description("Reset gimbal to center")
  .action(() => {
    const cam = connect(program.opts());
    result(cam.gimbalReset());
    cam.close();
  });

// ===== AI Tracking =====
program
  .command("tracking <on|off>")
  .description("Enable/disable AI tracking")
  .action((state) => {
    const cam = connect(program.opts());
    result(cam.setAITracking(parseOnOff(state)));
    cam.close();
  });

program
  .command("frame <head|half|full>")
  .description("Set tracking framing mode")
  .action((mode) => {
    const cam = connect(program.opts());
    const frameMap: Record<string, TrackingFrame> = {
      head: TrackingFrame.Head,
      half: TrackingFrame.HalfBody,
      full: TrackingFrame.FullBody,
    };
    const frame = frameMap[mode.toLowerCase()];
    if (!frame) {
      console.error("Unknown frame mode. Use: head, half, full");
      process.exit(1);
    }
    result(cam.setTrackingFrame(frame));
    cam.close();
  });

// ===== Camera Modes =====
program
  .command("deskview <on|off>")
  .description("Toggle DeskView mode")
  .action((state) => {
    const cam = connect(program.opts());
    result(cam.setDeskView(parseOnOff(state)));
    cam.close();
  });

program
  .command("whiteboard <on|off>")
  .description("Toggle Whiteboard mode")
  .action((state) => {
    const cam = connect(program.opts());
    result(cam.setWhiteboard(parseOnOff(state)));
    cam.close();
  });

program
  .command("overhead <on|off>")
  .description("Toggle Overhead document view")
  .action((state) => {
    const cam = connect(program.opts());
    result(cam.setOverhead(parseOnOff(state)));
    cam.close();
  });

program
  .command("normal")
  .description("Switch to normal webcam mode")
  .action(() => {
    const cam = connect(program.opts());
    result(cam.setCameraMode(CameraMode.Normal));
    cam.close();
  });

// ===== Image Controls =====
program
  .command("brightness <value>")
  .description("Set brightness")
  .action((v) => {
    const cam = connect(program.opts());
    result(cam.setBrightness(parseInt(v)));
    cam.close();
  });

program
  .command("contrast <value>")
  .description("Set contrast")
  .action((v) => {
    const cam = connect(program.opts());
    result(cam.setContrast(parseInt(v)));
    cam.close();
  });

program
  .command("saturation <value>")
  .description("Set saturation")
  .action((v) => {
    const cam = connect(program.opts());
    result(cam.setSaturation(parseInt(v)));
    cam.close();
  });

program
  .command("sharpness <value>")
  .description("Set sharpness")
  .action((v) => {
    const cam = connect(program.opts());
    result(cam.setSharpness(parseInt(v)));
    cam.close();
  });

program
  .command("wb <auto|temp>")
  .description("White balance (auto or Kelvin temperature)")
  .action((v) => {
    const cam = connect(program.opts());
    if (v.toLowerCase() === "auto") {
      result(cam.setAutoWhiteBalance(true));
    } else {
      cam.setAutoWhiteBalance(false);
      result(cam.setWhiteBalanceTemp(parseInt(v)));
    }
    cam.close();
  });

program
  .command("exposure <auto|value>")
  .description("Exposure (auto or absolute value)")
  .action((v) => {
    const cam = connect(program.opts());
    if (v.toLowerCase() === "auto") {
      result(cam.setExposureAuto(true));
    } else {
      cam.setExposureAuto(false);
      result(cam.setExposureAbsolute(parseInt(v)));
    }
    cam.close();
  });

program
  .command("focus <auto|value>")
  .description("Focus (auto or absolute value)")
  .action((v) => {
    const cam = connect(program.opts());
    if (v.toLowerCase() === "auto") {
      result(cam.setAutoFocus(true));
    } else {
      cam.setAutoFocus(false);
      result(cam.setFocusAbsolute(parseInt(v)));
    }
    cam.close();
  });

// ===== Presets =====
program
  .command("preset <save|recall> <index>")
  .description("Save or recall a preset (0-5)")
  .action((action, index) => {
    const cam = connect(program.opts());
    const idx = parseInt(index);
    if (action === "save") result(cam.savePreset(idx));
    else if (action === "recall") result(cam.recallPreset(idx));
    else console.error("Usage: preset save|recall <0-5>");
    cam.close();
  });

// ===== Raw XU =====
program
  .command("xu <selector> <hexbytes...>")
  .description("Send raw XU command (hex bytes)")
  .action((selector, hexbytes) => {
    const cam = connect(program.opts());
    const data = (hexbytes as string[]).map((h: string) => parseInt(h, 16));
    const ok = cam.rawXUSet(parseInt(selector), data);
    console.log(ok ? "XU command sent OK" : "XU command FAILED");
    cam.close();
  });

program.parse();
