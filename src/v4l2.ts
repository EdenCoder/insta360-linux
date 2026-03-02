/**
 * v4l2.ts - Video4Linux2 + UVC Extension Unit bindings for Node.js
 * =================================================================
 * Provides low-level access to V4L2 controls and UVC Extension Unit
 * commands via Linux ioctl syscalls.
 *
 * Port of uv4l2.pas from the Insta360 Link Controller for Linux.
 */

import { openSync, closeSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ===== ioctl encoding helpers =====

const _IOC_NRBITS = 8;
const _IOC_TYPEBITS = 8;
const _IOC_SIZEBITS = 14;
const _IOC_DIRBITS = 2;

const _IOC_NONE = 0;
const _IOC_WRITE = 1;
const _IOC_READ = 2;

const _IOC_NRSHIFT = 0;
const _IOC_TYPESHIFT = _IOC_NRBITS;
const _IOC_SIZESHIFT = _IOC_TYPESHIFT + _IOC_TYPEBITS;
const _IOC_DIRSHIFT = _IOC_SIZESHIFT + _IOC_SIZEBITS;

function _IOC(dir: number, type: number, nr: number, size: number): number {
  return (
    ((dir << _IOC_DIRSHIFT) |
      (type << _IOC_TYPESHIFT) |
      (nr << _IOC_NRSHIFT) |
      (size << _IOC_SIZESHIFT)) >>>
    0
  );
}

function _IOR(type: number, nr: number, size: number): number {
  return _IOC(_IOC_READ, type, nr, size);
}
function _IOW(type: number, nr: number, size: number): number {
  return _IOC(_IOC_WRITE, type, nr, size);
}
function _IOWR(type: number, nr: number, size: number): number {
  return _IOC(_IOC_READ | _IOC_WRITE, type, nr, size);
}

// ===== V4L2 ioctl constants =====

const VIDIOC_TYPE = 0x56; // 'V'

// V4L2 User-class control IDs (base 0x00980900)
export const V4L2_CID_BASE = 0x00980900;
export const V4L2_CID_BRIGHTNESS = V4L2_CID_BASE + 0;
export const V4L2_CID_CONTRAST = V4L2_CID_BASE + 1;
export const V4L2_CID_SATURATION = V4L2_CID_BASE + 2;
export const V4L2_CID_HUE = V4L2_CID_BASE + 3;
export const V4L2_CID_AUTO_WHITE_BALANCE = V4L2_CID_BASE + 12;
export const V4L2_CID_GAMMA = V4L2_CID_BASE + 17;
export const V4L2_CID_GAIN = V4L2_CID_BASE + 19;
export const V4L2_CID_POWER_LINE_FREQUENCY = V4L2_CID_BASE + 24;
export const V4L2_CID_WHITE_BALANCE_TEMPERATURE = V4L2_CID_BASE + 26;
export const V4L2_CID_SHARPNESS = V4L2_CID_BASE + 27;
export const V4L2_CID_BACKLIGHT_COMPENSATION = V4L2_CID_BASE + 28;

// V4L2 Camera-class control IDs (base 0x009A0900)
export const V4L2_CID_CAMERA_CLASS_BASE = 0x009a0900;
export const V4L2_CID_EXPOSURE_AUTO = V4L2_CID_CAMERA_CLASS_BASE + 1;
export const V4L2_CID_EXPOSURE_ABSOLUTE = V4L2_CID_CAMERA_CLASS_BASE + 2;
export const V4L2_CID_EXPOSURE_AUTO_PRIORITY = V4L2_CID_CAMERA_CLASS_BASE + 3;
export const V4L2_CID_PAN_RELATIVE = V4L2_CID_CAMERA_CLASS_BASE + 4;
export const V4L2_CID_TILT_RELATIVE = V4L2_CID_CAMERA_CLASS_BASE + 5;
export const V4L2_CID_PAN_RESET = V4L2_CID_CAMERA_CLASS_BASE + 6;
export const V4L2_CID_TILT_RESET = V4L2_CID_CAMERA_CLASS_BASE + 7;
export const V4L2_CID_PAN_ABSOLUTE = V4L2_CID_CAMERA_CLASS_BASE + 8;
export const V4L2_CID_TILT_ABSOLUTE = V4L2_CID_CAMERA_CLASS_BASE + 9;
export const V4L2_CID_FOCUS_ABSOLUTE = V4L2_CID_CAMERA_CLASS_BASE + 10;
export const V4L2_CID_FOCUS_RELATIVE = V4L2_CID_CAMERA_CLASS_BASE + 11;
export const V4L2_CID_FOCUS_AUTO = V4L2_CID_CAMERA_CLASS_BASE + 12;
export const V4L2_CID_ZOOM_ABSOLUTE = V4L2_CID_CAMERA_CLASS_BASE + 13;
export const V4L2_CID_ZOOM_RELATIVE = V4L2_CID_CAMERA_CLASS_BASE + 14;
export const V4L2_CID_ZOOM_CONTINUOUS = V4L2_CID_CAMERA_CLASS_BASE + 15;
export const V4L2_CID_PAN_SPEED = V4L2_CID_CAMERA_CLASS_BASE + 32;
export const V4L2_CID_TILT_SPEED = V4L2_CID_CAMERA_CLASS_BASE + 33;

// Exposure modes
export const V4L2_EXPOSURE_AUTO = 0;
export const V4L2_EXPOSURE_MANUAL = 1;
export const V4L2_EXPOSURE_SHUTTER_PRIORITY = 2;
export const V4L2_EXPOSURE_APERTURE_PRIORITY = 3;

// Control types
export const V4L2_CTRL_TYPE_INTEGER = 1;
export const V4L2_CTRL_TYPE_BOOLEAN = 2;
export const V4L2_CTRL_TYPE_MENU = 3;
export const V4L2_CTRL_TYPE_BUTTON = 4;

// Control flags
export const V4L2_CTRL_FLAG_DISABLED = 0x0001;
export const V4L2_CTRL_FLAG_GRABBED = 0x0002;
export const V4L2_CTRL_FLAG_READ_ONLY = 0x0004;
export const V4L2_CTRL_FLAG_UPDATE = 0x0008;
export const V4L2_CTRL_FLAG_INACTIVE = 0x0010;

// UVC XU query request types
export const UVC_SET_CUR = 1;
export const UVC_GET_CUR = 0x81;
export const UVC_GET_MIN = 0x82;
export const UVC_GET_MAX = 0x83;
export const UVC_GET_RES = 0x84;
export const UVC_GET_LEN = 0x85;
export const UVC_GET_INFO = 0x86;
export const UVC_GET_DEF = 0x87;

// ===== Insta360 Link XU Selectors =====
// Confirmed via Windows Kernel Streaming property monitoring

export const XU_PANTILT_RELATIVE_CONTROL = 13;
export const XU_GIMBAL_RESET_CONTROL = 14;
export const XU_MODE_CONTROL = 2;

// Mode IDs for XU_MODE_CONTROL byte[0]
export const XU_MODE_OFF = 0x00;
export const XU_MODE_AI_TRACKING = 0x01;
export const XU_MODE_WHITEBOARD = 0x04;
export const XU_MODE_OVERHEAD = 0x05;
export const XU_MODE_DESKVIEW = 0x06;

// Mode flags for XU_MODE_CONTROL byte[1]
export const XU_FLAG_AI_TRACKING = 0x00;
export const XU_FLAG_WHITEBOARD = 0x01;
export const XU_FLAG_OVERHEAD = 0x03;
export const XU_FLAG_DESKVIEW = 0x10;

// Tracking framing mode (Selector 19, 1-byte value)
export const XU_TRACKING_FRAME_CONTROL = 19;
export const XU_FRAME_HEAD = 0x01;
export const XU_FRAME_HALF_BODY = 0x02;
export const XU_FRAME_FULL_BODY = 0x03;

// Tracking target mode (XU-10, Selector 1, 8-byte buffer, byte[4])
export const XU_TRACKING_TARGET_UNIT = 10;
export const XU_TRACKING_TARGET_CONTROL = 1;
export const XU_TARGET_SINGLE = 0x00;
export const XU_TARGET_GROUP = 0x01;

// ===== ioctl request numbers =====

// struct v4l2_capability = 104 bytes
const VIDIOC_QUERYCAP = _IOR(VIDIOC_TYPE, 0, 104);
// struct v4l2_queryctrl = 68 bytes
const VIDIOC_QUERYCTRL = _IOWR(VIDIOC_TYPE, 36, 68);
// struct v4l2_control = 8 bytes
const VIDIOC_G_CTRL = _IOWR(VIDIOC_TYPE, 27, 8);
const VIDIOC_S_CTRL = _IOWR(VIDIOC_TYPE, 28, 8);
// struct v4l2_ext_controls = 32 bytes (on 64-bit)
const VIDIOC_S_EXT_CTRLS = _IOWR(VIDIOC_TYPE, 72, 32);
// struct uvc_xu_control_query = 16 bytes (on 64-bit, with padding)
const UVCIOC_CTRL_QUERY = _IOWR(0x75 /* 'u' */, 0x21, 16);

// ===== Types =====

export interface V4L2Capability {
  driver: string;
  card: string;
  busInfo: string;
  version: number;
  capabilities: number;
}

export interface V4L2QueryCtrl {
  id: number;
  type: number;
  name: string;
  minimum: number;
  maximum: number;
  step: number;
  defaultValue: number;
  flags: number;
}

export interface V4L2Device {
  path: string;
  card: string;
  driver: string;
}

// ===== Native ioctl via v4l2-ctl wrapper =====
// Node.js doesn't have native ioctl. We use v4l2-ctl for standard controls
// and a tiny C helper for UVC XU commands. For now, v4l2-ctl covers most needs,
// and we compile the XU helper on first use.

/**
 * Wrapper around v4l2-ctl for standard V4L2 controls,
 * with a compiled C helper for UVC Extension Unit commands.
 */
export class V4L2 {
  private devicePath: string;
  private xuHelperPath: string | null = null;

  constructor(devicePath: string) {
    this.devicePath = devicePath;
  }

  // ===== Device enumeration =====

  static enumDevices(): V4L2Device[] {
    const devices: V4L2Device[] = [];
    try {
      const output = execSync("v4l2-ctl --list-devices 2>/dev/null", {
        encoding: "utf8",
      });
      let currentCard = "";
      for (const line of output.split("\n")) {
        const trimmed = line.trimEnd();
        if (trimmed && !trimmed.startsWith("\t") && !trimmed.startsWith(" ")) {
          // Device name line: "Insta360 Link: Insta360 Link (usb-0000:...):"
          currentCard = trimmed.replace(/:\s*$/, "").trim();
        } else if (trimmed.trim().startsWith("/dev/video")) {
          const path = trimmed.trim();
          // Get driver from v4l2-ctl --info
          let driver = "uvcvideo";
          try {
            const info = execSync(
              `v4l2-ctl -d ${path} --info 2>/dev/null`,
              { encoding: "utf8" }
            );
            const m = info.match(/Driver name\s*:\s*(\S+)/);
            if (m) driver = m[1];
          } catch {}
          devices.push({ path, card: currentCard, driver });
        }
      }
    } catch {}
    return devices;
  }

  // ===== Cached controls from v4l2-ctl --list-ctrls-menus =====

  private controlCache: Map<number, V4L2QueryCtrl & { value: number }> | null = null;

  private ensureControlCache(): Map<number, V4L2QueryCtrl & { value: number }> {
    if (this.controlCache) return this.controlCache;
    this.controlCache = new Map();
    try {
      const output = execSync(
        `v4l2-ctl -d ${this.devicePath} --list-ctrls-menus 2>/dev/null`,
        { encoding: "utf8" }
      );
      // Parse lines like:
      // "                     brightness 0x00980900 (int)    : min=0 max=100 step=1 default=50 value=50 flags=has-min-max"
      const ctrlRegex = /^\s+(\S+)\s+(0x[0-9a-f]+)\s+\((\w+)\)\s*:\s*(.+)$/gm;
      let match;
      while ((match = ctrlRegex.exec(output)) !== null) {
        const name = match[1];
        const id = parseInt(match[2], 16);
        const type = match[3];
        const rest = match[4];
        const get = (key: string) => {
          const m = rest.match(new RegExp(`${key}=(-?\\d+)`));
          return m ? parseInt(m[1], 10) : 0;
        };
        const flagsStr = rest.match(/flags=(\S+)/)?.[1] ?? "";
        this.controlCache.set(id, {
          id,
          type: type === "bool" ? V4L2_CTRL_TYPE_BOOLEAN : type === "menu" ? V4L2_CTRL_TYPE_MENU : V4L2_CTRL_TYPE_INTEGER,
          name,
          minimum: get("min"),
          maximum: get("max"),
          step: get("step"),
          defaultValue: get("default"),
          value: get("value"),
          flags: flagsStr.includes("disabled") ? V4L2_CTRL_FLAG_DISABLED :
                 flagsStr.includes("inactive") ? V4L2_CTRL_FLAG_INACTIVE : 0,
        });
      }
    } catch {}
    return this.controlCache;
  }

  /**
   * Get all parsed controls from the device.
   */
  getAllControls(): Array<V4L2QueryCtrl & { value: number }> {
    return Array.from(this.ensureControlCache().values());
  }

  // ===== Standard V4L2 controls via v4l2-ctl =====

  getCtrl(ctrlId: number): number | null {
    // Try cache first
    const cached = this.ensureControlCache().get(ctrlId);
    if (cached !== undefined) return cached.value;
    // Fall back to live read
    const ctrlRef = `0x${ctrlId.toString(16).padStart(8, "0")}`;
    try {
      const output = execSync(
        `v4l2-ctl -d ${this.devicePath} -C ${ctrlRef} 2>/dev/null`,
        { encoding: "utf8" }
      );
      const match = output.match(/:\s*(-?\d+)/);
      return match ? parseInt(match[1], 10) : null;
    } catch {
      return null;
    }
  }

  setCtrl(ctrlId: number, value: number): boolean {
    // Use control name from cache if available, fall back to hex ID
    const cached = this.ensureControlCache().get(ctrlId);
    const ctrlRef = cached ? cached.name : `0x${ctrlId.toString(16).padStart(8, "0")}`;
    try {
      execSync(
        `v4l2-ctl -d ${this.devicePath} -c ${ctrlRef}=${value} 2>/dev/null`
      );
      // Update cache
      if (cached) cached.value = value;
      return true;
    } catch {
      return false;
    }
  }

  queryCtrl(ctrlId: number): V4L2QueryCtrl | null {
    const cached = this.ensureControlCache().get(ctrlId);
    if (cached) return cached;
    return null;
  }

  queryCap(): V4L2Capability | null {
    try {
      const output = execSync(
        `v4l2-ctl -d ${this.devicePath} --info 2>/dev/null`,
        { encoding: "utf8" }
      );
      const get = (key: string) => {
        const m = output.match(new RegExp(`${key}\\s*:\\s*(.+)`));
        return m?.[1]?.trim() ?? "";
      };
      return {
        driver: get("Driver name"),
        card: get("Card type"),
        busInfo: get("Bus info"),
        version: 0,
        capabilities: 0,
      };
    } catch {
      return null;
    }
  }

  // Set pan and tilt atomically
  setPanTilt(pan: number, tilt: number): boolean {
    try {
      execSync(
        `v4l2-ctl -d ${this.devicePath} -c pan_absolute=${pan},tilt_absolute=${tilt} 2>/dev/null`
      );
      // Update cache
      const panCached = this.ensureControlCache().get(V4L2_CID_PAN_ABSOLUTE);
      const tiltCached = this.ensureControlCache().get(V4L2_CID_TILT_ABSOLUTE);
      if (panCached) panCached.value = pan;
      if (tiltCached) tiltCached.value = tilt;
      return true;
    } catch {
      return false;
    }
  }

  // ===== UVC Extension Unit commands via compiled C helper =====

  private ensureXUHelper(): string {
    if (this.xuHelperPath) return this.xuHelperPath;

    const helperDir = dirname(fileURLToPath(import.meta.url));
    const srcPath = join(helperDir, "xu_helper.c");
    const binPath = join(helperDir, "xu_helper");

    // Check if already compiled
    try {
      if (existsSync(binPath)) {
        this.xuHelperPath = binPath;
        return binPath;
      }
    } catch {}

    // Write and compile the C helper
    const cSource = `
/* xu_helper.c - UVC Extension Unit ioctl helper for Node.js
 * Usage:
 *   xu_helper <device> set <unit> <selector> <hex_data>
 *   xu_helper <device> get <unit> <selector> <size>
 *   xu_helper <device> query <unit> <selector> <query_type> <size>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <linux/usb/video.h>
#include <linux/uvcvideo.h>
#include <errno.h>

int main(int argc, char *argv[]) {
    if (argc < 5) {
        fprintf(stderr, "Usage: xu_helper <device> set|get|query <unit> <selector> [data|size] [query_type]\\n");
        return 1;
    }

    const char *device = argv[1];
    const char *cmd = argv[2];
    int unit = atoi(argv[3]);
    int selector = atoi(argv[4]);

    int fd = open(device, O_RDWR | O_NONBLOCK);
    if (fd < 0) {
        fprintf(stderr, "ERROR: Cannot open %s: %s\\n", device, strerror(errno));
        return 1;
    }

    struct uvc_xu_control_query query;
    memset(&query, 0, sizeof(query));
    query.unit = unit;
    query.selector = selector;

    if (strcmp(cmd, "set") == 0 && argc >= 6) {
        /* Parse hex data string: "0102ff00..." */
        const char *hex = argv[5];
        int len = strlen(hex) / 2;
        unsigned char *data = calloc(len, 1);
        for (int i = 0; i < len; i++) {
            unsigned int byte;
            sscanf(hex + i * 2, "%02x", &byte);
            data[i] = (unsigned char)byte;
        }
        query.query = UVC_SET_CUR;
        query.size = len;
        query.data = data;
        int ret = ioctl(fd, UVCIOC_CTRL_QUERY, &query);
        free(data);
        close(fd);
        if (ret < 0) {
            fprintf(stderr, "ERROR: ioctl failed: %s\\n", strerror(errno));
            return 1;
        }
        printf("OK\\n");
        return 0;
    }

    if (strcmp(cmd, "get") == 0 && argc >= 6) {
        int size = atoi(argv[5]);
        unsigned char *data = calloc(size, 1);
        query.query = UVC_GET_CUR;
        query.size = size;
        query.data = data;
        int ret = ioctl(fd, UVCIOC_CTRL_QUERY, &query);
        close(fd);
        if (ret < 0) {
            fprintf(stderr, "ERROR: ioctl failed: %s\\n", strerror(errno));
            free(data);
            return 1;
        }
        for (int i = 0; i < size; i++) printf("%02x", data[i]);
        printf("\\n");
        free(data);
        return 0;
    }

    if (strcmp(cmd, "query") == 0 && argc >= 7) {
        int query_type = atoi(argv[5]);
        int size = atoi(argv[6]);
        unsigned char *data = calloc(size, 1);
        query.query = query_type;
        query.size = size;
        query.data = data;
        int ret = ioctl(fd, UVCIOC_CTRL_QUERY, &query);
        close(fd);
        if (ret < 0) {
            fprintf(stderr, "ERROR: ioctl failed: %s\\n", strerror(errno));
            free(data);
            return 1;
        }
        for (int i = 0; i < size; i++) printf("%02x", data[i]);
        printf("\\n");
        free(data);
        return 0;
    }

    close(fd);
    fprintf(stderr, "Unknown command: %s\\n", cmd);
    return 1;
}
`;

    try {
      writeFileSync(srcPath, cSource);
      execSync(`gcc -O2 -o "${binPath}" "${srcPath}" 2>&1`);
      this.xuHelperPath = binPath;
      return binPath;
    } catch (e) {
      throw new Error(`Failed to compile XU helper: ${e}`);
    }
  }

  /**
   * Send a UVC Extension Unit SET_CUR command.
   */
  xuSetCur(unitId: number, selector: number, data: Buffer): boolean {
    try {
      const helper = this.ensureXUHelper();
      const hex = data.toString("hex");
      execSync(
        `${helper} ${this.devicePath} set ${unitId} ${selector} ${hex} 2>/dev/null`
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send a UVC Extension Unit GET_CUR command.
   */
  xuGetCur(unitId: number, selector: number, size: number): Buffer | null {
    try {
      const helper = this.ensureXUHelper();
      const output = execSync(
        `${helper} ${this.devicePath} get ${unitId} ${selector} ${size} 2>/dev/null`,
        { encoding: "utf8" }
      ).trim();
      return Buffer.from(output, "hex");
    } catch {
      return null;
    }
  }

  /**
   * Send a raw UVC Extension Unit query.
   */
  xuQuery(
    unitId: number,
    selector: number,
    queryType: number,
    size: number
  ): Buffer | null {
    try {
      const helper = this.ensureXUHelper();
      const output = execSync(
        `${helper} ${this.devicePath} query ${unitId} ${selector} ${queryType} ${size} 2>/dev/null`,
        { encoding: "utf8" }
      ).trim();
      return Buffer.from(output, "hex");
    } catch {
      return null;
    }
  }

  /**
   * Get the CID name for display.
   */
  static cidName(cid: number): string {
    const names: Record<number, string> = {
      [V4L2_CID_BRIGHTNESS]: "Brightness",
      [V4L2_CID_CONTRAST]: "Contrast",
      [V4L2_CID_SATURATION]: "Saturation",
      [V4L2_CID_HUE]: "Hue",
      [V4L2_CID_AUTO_WHITE_BALANCE]: "Auto White Balance",
      [V4L2_CID_GAMMA]: "Gamma",
      [V4L2_CID_GAIN]: "Gain",
      [V4L2_CID_POWER_LINE_FREQUENCY]: "Power Line Frequency",
      [V4L2_CID_WHITE_BALANCE_TEMPERATURE]: "White Balance Temp",
      [V4L2_CID_SHARPNESS]: "Sharpness",
      [V4L2_CID_BACKLIGHT_COMPENSATION]: "Backlight Compensation",
      [V4L2_CID_EXPOSURE_AUTO]: "Exposure Mode",
      [V4L2_CID_EXPOSURE_ABSOLUTE]: "Exposure (Absolute)",
      [V4L2_CID_PAN_ABSOLUTE]: "Pan (Absolute)",
      [V4L2_CID_TILT_ABSOLUTE]: "Tilt (Absolute)",
      [V4L2_CID_FOCUS_ABSOLUTE]: "Focus (Absolute)",
      [V4L2_CID_FOCUS_AUTO]: "Auto Focus",
      [V4L2_CID_ZOOM_ABSOLUTE]: "Zoom (Absolute)",
    };
    return names[cid] ?? `Control 0x${cid.toString(16).padStart(8, "0")}`;
  }
}
