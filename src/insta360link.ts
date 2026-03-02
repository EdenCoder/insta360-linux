/**
 * insta360link.ts - High-level Insta360 Link Camera Controller
 * ==============================================================
 * Wraps V4L2 standard controls and UVC Extension Unit commands
 * into a clean API for controlling all Insta360 Link features.
 *
 * Port of uinsta360link.pas from the Insta360 Link Controller for Linux.
 *
 * XU Selector Map (confirmed via Windows KS property monitoring):
 *   Selector 2 (52 bytes) = Master mode control
 *     byte[0]=0x01, byte[1]=0x00 = AI Tracking
 *     byte[0]=0x04, byte[1]=0x01 = Whiteboard
 *     byte[0]=0x05, byte[1]=0x03 = Overhead
 *     byte[0]=0x06, byte[1]=0x10 = DeskView
 *     byte[0]=0x00              = Off/Normal
 */

import { readFileSync } from "node:fs";
import {
  V4L2,
  type V4L2Capability,
  type V4L2QueryCtrl,
  type V4L2Device,
  V4L2_CID_BRIGHTNESS,
  V4L2_CID_CONTRAST,
  V4L2_CID_SATURATION,
  V4L2_CID_SHARPNESS,
  V4L2_CID_GAIN,
  V4L2_CID_BACKLIGHT_COMPENSATION,
  V4L2_CID_AUTO_WHITE_BALANCE,
  V4L2_CID_WHITE_BALANCE_TEMPERATURE,
  V4L2_CID_EXPOSURE_AUTO,
  V4L2_CID_EXPOSURE_ABSOLUTE,
  V4L2_CID_FOCUS_ABSOLUTE,
  V4L2_CID_FOCUS_AUTO,
  V4L2_CID_PAN_ABSOLUTE,
  V4L2_CID_TILT_ABSOLUTE,
  V4L2_CID_ZOOM_ABSOLUTE,
  V4L2_CID_BASE,
  V4L2_CID_CAMERA_CLASS_BASE,
  V4L2_CTRL_FLAG_DISABLED,
  V4L2_EXPOSURE_MANUAL,
  V4L2_EXPOSURE_APERTURE_PRIORITY,
  UVC_GET_LEN,
  UVC_GET_INFO,
  UVC_GET_CUR,
  XU_MODE_CONTROL,
  XU_MODE_OFF,
  XU_MODE_AI_TRACKING,
  XU_MODE_WHITEBOARD,
  XU_MODE_OVERHEAD,
  XU_MODE_DESKVIEW,
  XU_FLAG_AI_TRACKING,
  XU_FLAG_WHITEBOARD,
  XU_FLAG_OVERHEAD,
  XU_FLAG_DESKVIEW,
  XU_GIMBAL_RESET_CONTROL,
  XU_TRACKING_FRAME_CONTROL,
  XU_FRAME_HEAD,
  XU_FRAME_HALF_BODY,
  XU_FRAME_FULL_BODY,
  XU_TRACKING_TARGET_UNIT,
  XU_TRACKING_TARGET_CONTROL,
  XU_TARGET_SINGLE,
  XU_TARGET_GROUP,
} from "./v4l2.js";

// ===== Enums =====

export enum CameraMode {
  Normal = "normal",
  DeskView = "deskview",
  Whiteboard = "whiteboard",
  Overhead = "overhead",
}

export enum CameraModel {
  Unknown = "unknown",
  Link = "link",
  Link2 = "link2",
}

export enum TrackingFrame {
  Head = "head",
  HalfBody = "half",
  FullBody = "full",
}

export enum TrackingTarget {
  Single = "single",
  Group = "group",
}

// ===== Types =====

export interface CtrlRange {
  available: boolean;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  current: number;
}

export interface PresetPosition {
  name: string;
  pan: number;
  tilt: number;
  zoom: number;
  valid: boolean;
}

export interface ControlInfo {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export type LogFn = (msg: string) => void;

// ===== Main Controller =====

export class Insta360Link {
  private v4l2: V4L2 | null = null;
  private _connected = false;
  private _devicePath = "";
  private _cameraModel = CameraModel.Unknown;
  private _deviceName = "";
  private _driverName = "";
  private _busInfo = "";
  private _xuUnitId = 9;
  private xuLens: Map<number, number> = new Map();
  private presets: PresetPosition[] = Array.from({ length: 6 }, () => ({
    name: "",
    pan: 0,
    tilt: 0,
    zoom: 100,
    valid: false,
  }));

  // Cached control ranges
  private _panRange: CtrlRange = this.emptyRange();
  private _tiltRange: CtrlRange = this.emptyRange();
  private _zoomRange: CtrlRange = this.emptyRange();
  private _focusRange: CtrlRange = this.emptyRange();
  private _brightnessRange: CtrlRange = this.emptyRange();
  private _contrastRange: CtrlRange = this.emptyRange();
  private _saturationRange: CtrlRange = this.emptyRange();
  private _sharpnessRange: CtrlRange = this.emptyRange();
  private _gainRange: CtrlRange = this.emptyRange();
  private _wbTempRange: CtrlRange = this.emptyRange();
  private _exposureRange: CtrlRange = this.emptyRange();

  // Current state
  private _currentMode = CameraMode.Normal;
  private _aiTrackingEnabled = false;
  private _trackingFrame = TrackingFrame.HalfBody;
  private _trackingTarget = TrackingTarget.Single;
  private panPos = 0;
  private tiltPos = 0;

  // Logging
  onLog: LogFn | null = null;

  private log(msg: string) {
    this.onLog?.(msg);
  }

  private emptyRange(): CtrlRange {
    return {
      available: false,
      min: 0,
      max: 0,
      step: 0,
      defaultValue: 0,
      current: 0,
    };
  }

  // ===== Getters =====

  get connected() {
    return this._connected;
  }
  get devicePath() {
    return this._devicePath;
  }
  get deviceName() {
    return this._deviceName;
  }
  get driverName() {
    return this._driverName;
  }
  get busInfo() {
    return this._busInfo;
  }
  get cameraModel() {
    return this._cameraModel;
  }
  get xuUnitId() {
    return this._xuUnitId;
  }
  set xuUnitId(v: number) {
    this._xuUnitId = v;
  }
  get currentMode() {
    return this._currentMode;
  }
  get aiTrackingEnabled() {
    return this._aiTrackingEnabled;
  }
  get trackingFrame() {
    return this._trackingFrame;
  }
  get trackingTarget() {
    return this._trackingTarget;
  }
  get panRange() {
    return this._panRange;
  }
  get tiltRange() {
    return this._tiltRange;
  }
  get zoomRange() {
    return this._zoomRange;
  }
  get focusRange() {
    return this._focusRange;
  }
  get brightnessRange() {
    return this._brightnessRange;
  }
  get contrastRange() {
    return this._contrastRange;
  }
  get saturationRange() {
    return this._saturationRange;
  }
  get sharpnessRange() {
    return this._sharpnessRange;
  }
  get gainRange() {
    return this._gainRange;
  }
  get wbTempRange() {
    return this._wbTempRange;
  }
  get exposureRange() {
    return this._exposureRange;
  }

  // ===== Connection =====

  open(devPath: string): boolean {
    this.close();

    this.v4l2 = new V4L2(devPath);
    this._devicePath = devPath;

    const cap = this.v4l2.queryCap();
    if (cap) {
      this._deviceName = cap.card;
      this._driverName = cap.driver;
      this._busInfo = cap.busInfo;
      this.log(`Connected to: ${cap.card}`);
      this.log(`Driver: ${cap.driver}  Bus: ${cap.busInfo}`);
    }

    this._connected = true;

    // Detect camera model from USB PID via sysfs
    this._cameraModel = CameraModel.Unknown;
    try {
      const vidName = devPath.split("/").pop()!;
      const pid = readFileSync(
        `/sys/class/video4linux/${vidName}/device/../idProduct`,
        "utf8"
      )
        .trim()
        .toLowerCase();
      if (pid === "4c01") this._cameraModel = CameraModel.Link;
      else if (pid === "4c04") this._cameraModel = CameraModel.Link2;
    } catch {}

    this.log(`Camera model: ${this._cameraModel}`);

    // Detect XU unit ID
    this._xuUnitId = this.detectXUUnitId();

    // Scan XU selectors to get data lengths
    this.scanXUSelectors();

    // Cache control ranges
    this.cacheControlRanges();

    return true;
  }

  close() {
    if (this._connected) {
      this.log(`Disconnected from ${this._devicePath}`);
      this.v4l2 = null;
      this._connected = false;
      this._devicePath = "";
      this._deviceName = "";
    }
  }

  // ===== Private helpers =====

  private detectXUUnitId(): number {
    if (!this.v4l2) return 9;

    const ids = [9, 10, 11, 4, 3, 6];
    for (const id of ids) {
      const result = this.v4l2.xuQuery(id, 1, UVC_GET_INFO, 1);
      if (result) {
        this.log(`XU Unit ID detected: ${id} (via GET_INFO)`);
        return id;
      }
    }

    // Second pass: try GET_LEN
    for (const id of ids) {
      const result = this.v4l2.xuQuery(id, 1, UVC_GET_LEN, 2);
      if (result) {
        this.log(`XU Unit ID detected: ${id} (via GET_LEN)`);
        return id;
      }
    }

    this.log("WARNING: Could not detect XU Unit ID, defaulting to 9");
    return 9;
  }

  private scanXUSelectors() {
    if (!this.v4l2) return;

    const units = [9, 10, 11];
    for (const unitId of units) {
      this.log(`--- Scanning XU unit ${unitId} ---`);
      for (let sel = 1; sel <= 20; sel++) {
        const lenBuf = this.v4l2.xuQuery(unitId, sel, UVC_GET_LEN, 2);
        if (lenBuf) {
          const dataLen = lenBuf[0] | (lenBuf[1] << 8);
          if (unitId === this._xuUnitId) {
            this.xuLens.set(sel, dataLen);
          }
          const infoBuf = this.v4l2.xuQuery(unitId, sel, UVC_GET_INFO, 1);
          const flags = infoBuf ? infoBuf[0] : 0;
          this.log(
            `  Sel ${sel.toString().padStart(2)}: len=${dataLen.toString().padStart(3)} flags=0x${flags.toString(16).padStart(2, "0")} GET=${(flags & 1) !== 0 ? "Y" : "N"} SET=${(flags & 2) !== 0 ? "Y" : "N"}`
          );
        }
      }
    }
    this.log("--- End XU scan ---");
  }

  private queryControlRange(ctrlId: number): CtrlRange {
    if (!this.v4l2 || !this._connected) return this.emptyRange();

    const qc = this.v4l2.queryCtrl(ctrlId);
    if (!qc) return this.emptyRange();

    const current = this.v4l2.getCtrl(ctrlId) ?? 0;
    return {
      available: (qc.flags & V4L2_CTRL_FLAG_DISABLED) === 0,
      min: qc.minimum,
      max: qc.maximum,
      step: qc.step,
      defaultValue: qc.defaultValue,
      current,
    };
  }

  private cacheControlRanges() {
    this._panRange = this.queryControlRange(V4L2_CID_PAN_ABSOLUTE);
    this._tiltRange = this.queryControlRange(V4L2_CID_TILT_ABSOLUTE);
    this._zoomRange = this.queryControlRange(V4L2_CID_ZOOM_ABSOLUTE);
    this._focusRange = this.queryControlRange(V4L2_CID_FOCUS_ABSOLUTE);
    this._brightnessRange = this.queryControlRange(V4L2_CID_BRIGHTNESS);
    this._contrastRange = this.queryControlRange(V4L2_CID_CONTRAST);
    this._saturationRange = this.queryControlRange(V4L2_CID_SATURATION);
    this._sharpnessRange = this.queryControlRange(V4L2_CID_SHARPNESS);
    this._gainRange = this.queryControlRange(V4L2_CID_GAIN);
    this._wbTempRange = this.queryControlRange(V4L2_CID_WHITE_BALANCE_TEMPERATURE);
    this._exposureRange = this.queryControlRange(V4L2_CID_EXPOSURE_ABSOLUTE);

    if (this._panRange.available)
      this.log(`Pan: ${this._panRange.min}..${this._panRange.max}`);
    if (this._tiltRange.available)
      this.log(`Tilt: ${this._tiltRange.min}..${this._tiltRange.max}`);
    if (this._zoomRange.available)
      this.log(`Zoom: ${this._zoomRange.min}..${this._zoomRange.max}`);
  }

  /**
   * Send padded XU data (fills buffer to expected selector length).
   */
  private xuSetPadded(selector: number, data: number[]): boolean {
    if (!this.v4l2) return false;
    const expectedLen = this.xuLens.get(selector);
    if (!expectedLen) {
      this.log(`XU_SetPadded: selector ${selector} has no cached length`);
      return false;
    }
    const buf = Buffer.alloc(expectedLen, 0);
    for (let i = 0; i < Math.min(data.length, expectedLen); i++) {
      buf[i] = data[i];
    }
    return this.v4l2.xuSetCur(this._xuUnitId, selector, buf);
  }

  /**
   * Read padded XU data.
   */
  private xuGetPadded(selector: number): Buffer | null {
    if (!this.v4l2) return null;
    const expectedLen = this.xuLens.get(selector);
    if (!expectedLen) return null;
    return this.v4l2.xuGetCur(this._xuUnitId, selector, expectedLen);
  }

  /**
   * Write mode to XU Selector 2 (52-byte buffer).
   */
  private xuSetMode(modeId: number, modeFlag: number): boolean {
    if (!this._connected) return false;
    const data = new Array(52).fill(0);
    data[0] = modeId;
    data[1] = modeFlag;
    const ok = this.xuSetPadded(XU_MODE_CONTROL, data);
    if (ok) {
      this.log(
        `XU Mode SET: byte[0]=0x${modeId.toString(16).padStart(2, "0")} byte[1]=0x${modeFlag.toString(16).padStart(2, "0")}`
      );
    } else {
      this.log("XU Mode SET FAILED");
    }
    return ok;
  }

  // ===== PTZ Controls =====

  setPanAbsolute(value: number): boolean {
    if (!this.v4l2 || !this._connected) return false;
    let ok = this.v4l2.setCtrl(V4L2_CID_PAN_ABSOLUTE, value);
    if (!ok) ok = this.v4l2.setPanTilt(value, this.tiltPos);
    if (ok) {
      this.panPos = value;
      this.log(`Pan absolute: ${value}`);
    }
    return ok;
  }

  getPanAbsolute(): number {
    return this.panPos;
  }

  setTiltAbsolute(value: number): boolean {
    if (!this.v4l2 || !this._connected) return false;
    let ok = this.v4l2.setCtrl(V4L2_CID_TILT_ABSOLUTE, value);
    if (!ok) ok = this.v4l2.setPanTilt(this.panPos, value);
    if (ok) {
      this.tiltPos = value;
      this.log(`Tilt absolute: ${value}`);
    }
    return ok;
  }

  getTiltAbsolute(): number {
    return this.tiltPos;
  }

  panTiltRelative(panDelta: number, tiltDelta: number): boolean {
    if (!this.v4l2 || !this._connected) return false;

    let newPan = this.panPos + panDelta * 3600;
    let newTilt = this.tiltPos + tiltDelta * 3600;

    if (this._panRange.available) {
      newPan = Math.max(this._panRange.min, Math.min(this._panRange.max, newPan));
    }
    if (this._tiltRange.available) {
      newTilt = Math.max(this._tiltRange.min, Math.min(this._tiltRange.max, newTilt));
    }

    let ok = this.v4l2.setPanTilt(newPan, newTilt);
    if (!ok) {
      this.v4l2.setCtrl(V4L2_CID_PAN_ABSOLUTE, newPan);
      ok = this.v4l2.setCtrl(V4L2_CID_TILT_ABSOLUTE, newTilt);
    }
    if (ok) {
      this.log(`Pan/Tilt: pan=${this.panPos}->${newPan} tilt=${this.tiltPos}->${newTilt}`);
      this.panPos = newPan;
      this.tiltPos = newTilt;
    }
    return ok;
  }

  setZoom(value: number): boolean {
    if (!this.v4l2 || !this._connected) return false;
    const ok = this.v4l2.setCtrl(V4L2_CID_ZOOM_ABSOLUTE, value);
    if (ok) this.log(`Zoom: ${value}`);
    return ok;
  }

  getZoom(): number {
    return this.v4l2?.getCtrl(V4L2_CID_ZOOM_ABSOLUTE) ?? 100;
  }

  gimbalReset(): boolean {
    if (!this.v4l2 || !this._connected) return false;
    this.xuSetPadded(XU_GIMBAL_RESET_CONTROL, [1]);
    let ok = this.v4l2.setPanTilt(0, 0);
    if (!ok) {
      this.v4l2.setCtrl(V4L2_CID_PAN_ABSOLUTE, 0);
      ok = this.v4l2.setCtrl(V4L2_CID_TILT_ABSOLUTE, 0);
    }
    if (ok) {
      this.panPos = 0;
      this.tiltPos = 0;
      this.log("Gimbal reset to center");
    }
    return ok;
  }

  // ===== AI Tracking =====

  setAITracking(enable: boolean): boolean {
    if (!this._connected) return false;
    const ok = enable
      ? this.xuSetMode(XU_MODE_AI_TRACKING, XU_FLAG_AI_TRACKING)
      : this.xuSetMode(XU_MODE_OFF, 0);
    if (ok) {
      this._aiTrackingEnabled = enable;
      this.log(`AI Tracking: ${enable ? "ENABLED" : "DISABLED"}`);
    }
    return ok;
  }

  getAITracking(): boolean {
    const buf = this.xuGetPadded(XU_MODE_CONTROL);
    return buf ? buf[0] === XU_MODE_AI_TRACKING : false;
  }

  setTrackingFrame(frame: TrackingFrame): boolean {
    if (!this._connected) return false;
    const byteVal =
      frame === TrackingFrame.Head
        ? XU_FRAME_HEAD
        : frame === TrackingFrame.HalfBody
          ? XU_FRAME_HALF_BODY
          : XU_FRAME_FULL_BODY;
    const ok = this.xuSetPadded(XU_TRACKING_FRAME_CONTROL, [byteVal]);
    if (ok) {
      this._trackingFrame = frame;
      this.log(`Tracking frame: ${frame.toUpperCase()}`);
    }
    return ok;
  }

  getTrackingFrame(): TrackingFrame {
    const buf = this.xuGetPadded(XU_TRACKING_FRAME_CONTROL);
    if (!buf) return TrackingFrame.HalfBody;
    switch (buf[0]) {
      case XU_FRAME_HEAD:
        return TrackingFrame.Head;
      case XU_FRAME_HALF_BODY:
        return TrackingFrame.HalfBody;
      case XU_FRAME_FULL_BODY:
        return TrackingFrame.FullBody;
      default:
        return TrackingFrame.HalfBody;
    }
  }

  setTrackingTarget(target: TrackingTarget): boolean {
    if (!this.v4l2 || !this._connected) return false;

    // Query data length for XU-10 Sel 1
    const lenBuf = this.v4l2.xuQuery(
      XU_TRACKING_TARGET_UNIT,
      XU_TRACKING_TARGET_CONTROL,
      UVC_GET_LEN,
      2
    );
    let dataLen = lenBuf ? lenBuf[0] | (lenBuf[1] << 8) : 8;
    dataLen = Math.min(dataLen, 8);

    // Read current state
    let buf = this.v4l2.xuGetCur(
      XU_TRACKING_TARGET_UNIT,
      XU_TRACKING_TARGET_CONTROL,
      dataLen
    );
    if (!buf) buf = Buffer.alloc(dataLen, 0);

    buf[4] = target === TrackingTarget.Single ? XU_TARGET_SINGLE : XU_TARGET_GROUP;
    const ok = this.v4l2.xuSetCur(
      XU_TRACKING_TARGET_UNIT,
      XU_TRACKING_TARGET_CONTROL,
      buf
    );
    if (ok) {
      this._trackingTarget = target;
      this.log(`Tracking target: ${target.toUpperCase()}`);
    }
    return ok;
  }

  // ===== Camera Modes =====

  setCameraMode(mode: CameraMode): boolean {
    if (!this._connected) return false;
    this.xuSetMode(XU_MODE_OFF, 0);
    this._aiTrackingEnabled = false;

    switch (mode) {
      case CameraMode.Normal:
        this._currentMode = mode;
        this.log("Mode: Normal");
        return true;
      case CameraMode.DeskView:
        return this.setDeskView(true);
      case CameraMode.Whiteboard:
        return this.setWhiteboard(true);
      case CameraMode.Overhead:
        return this.setOverhead(true);
    }
  }

  setDeskView(enable: boolean): boolean {
    const ok = enable
      ? this.xuSetMode(XU_MODE_DESKVIEW, XU_FLAG_DESKVIEW)
      : this.xuSetMode(XU_MODE_OFF, 0);
    if (ok && enable) {
      this._currentMode = CameraMode.DeskView;
      this._aiTrackingEnabled = false;
    }
    this.log(`DeskView: ${enable ? "ENABLED" : "DISABLED"}`);
    return ok;
  }

  setWhiteboard(enable: boolean): boolean {
    const ok = enable
      ? this.xuSetMode(XU_MODE_WHITEBOARD, XU_FLAG_WHITEBOARD)
      : this.xuSetMode(XU_MODE_OFF, 0);
    if (ok && enable) {
      this._currentMode = CameraMode.Whiteboard;
      this._aiTrackingEnabled = false;
    }
    this.log(`Whiteboard: ${enable ? "ENABLED" : "DISABLED"}`);
    return ok;
  }

  setOverhead(enable: boolean): boolean {
    const ok = enable
      ? this.xuSetMode(XU_MODE_OVERHEAD, XU_FLAG_OVERHEAD)
      : this.xuSetMode(XU_MODE_OFF, 0);
    if (ok && enable) {
      this._currentMode = CameraMode.Overhead;
      this._aiTrackingEnabled = false;
    }
    this.log(`Overhead: ${enable ? "ENABLED" : "DISABLED"}`);
    return ok;
  }

  // ===== Image Controls =====

  setBrightness(v: number) {
    return this.v4l2?.setCtrl(V4L2_CID_BRIGHTNESS, v) ?? false;
  }
  getBrightness() {
    return this.v4l2?.getCtrl(V4L2_CID_BRIGHTNESS) ?? 0;
  }
  setContrast(v: number) {
    return this.v4l2?.setCtrl(V4L2_CID_CONTRAST, v) ?? false;
  }
  getContrast() {
    return this.v4l2?.getCtrl(V4L2_CID_CONTRAST) ?? 0;
  }
  setSaturation(v: number) {
    return this.v4l2?.setCtrl(V4L2_CID_SATURATION, v) ?? false;
  }
  getSaturation() {
    return this.v4l2?.getCtrl(V4L2_CID_SATURATION) ?? 0;
  }
  setSharpness(v: number) {
    return this.v4l2?.setCtrl(V4L2_CID_SHARPNESS, v) ?? false;
  }
  getSharpness() {
    return this.v4l2?.getCtrl(V4L2_CID_SHARPNESS) ?? 0;
  }
  setGain(v: number) {
    return this.v4l2?.setCtrl(V4L2_CID_GAIN, v) ?? false;
  }
  getGain() {
    return this.v4l2?.getCtrl(V4L2_CID_GAIN) ?? 0;
  }
  setBacklightCompensation(enable: boolean) {
    return this.v4l2?.setCtrl(V4L2_CID_BACKLIGHT_COMPENSATION, enable ? 1 : 0) ?? false;
  }
  setAutoWhiteBalance(enable: boolean) {
    return this.v4l2?.setCtrl(V4L2_CID_AUTO_WHITE_BALANCE, enable ? 1 : 0) ?? false;
  }
  setWhiteBalanceTemp(v: number) {
    return this.v4l2?.setCtrl(V4L2_CID_WHITE_BALANCE_TEMPERATURE, v) ?? false;
  }
  setExposureAuto(enable: boolean) {
    return (
      this.v4l2?.setCtrl(
        V4L2_CID_EXPOSURE_AUTO,
        enable ? V4L2_EXPOSURE_APERTURE_PRIORITY : V4L2_EXPOSURE_MANUAL
      ) ?? false
    );
  }
  setExposureAbsolute(v: number) {
    return this.v4l2?.setCtrl(V4L2_CID_EXPOSURE_ABSOLUTE, v) ?? false;
  }
  setAutoFocus(enable: boolean) {
    return this.v4l2?.setCtrl(V4L2_CID_FOCUS_AUTO, enable ? 1 : 0) ?? false;
  }
  setFocusAbsolute(v: number) {
    return this.v4l2?.setCtrl(V4L2_CID_FOCUS_ABSOLUTE, v) ?? false;
  }

  // ===== Presets =====

  savePreset(index: number): boolean {
    if (!this._connected || index > 5) return false;
    this.presets[index] = {
      name: `Preset ${index}`,
      pan: this.panPos,
      tilt: this.tiltPos,
      zoom: this.getZoom(),
      valid: true,
    };
    this.log(
      `Preset ${index} SAVED: pan=${this.panPos} tilt=${this.tiltPos} zoom=${this.presets[index].zoom}`
    );
    return true;
  }

  recallPreset(index: number): boolean {
    if (!this.v4l2 || !this._connected || index > 5) return false;
    const p = this.presets[index];
    if (!p.valid) {
      this.log(`Preset ${index} not saved yet`);
      return false;
    }
    let ok = this.v4l2.setPanTilt(p.pan, p.tilt);
    if (!ok) {
      this.v4l2.setCtrl(V4L2_CID_PAN_ABSOLUTE, p.pan);
      this.v4l2.setCtrl(V4L2_CID_TILT_ABSOLUTE, p.tilt);
      ok = true;
    }
    this.v4l2.setCtrl(V4L2_CID_ZOOM_ABSOLUTE, p.zoom);
    this.panPos = p.pan;
    this.tiltPos = p.tilt;
    this.log(`Preset ${index} RECALLED: pan=${p.pan} tilt=${p.tilt} zoom=${p.zoom}`);
    return ok;
  }

  getPreset(index: number): PresetPosition {
    return this.presets[index] ?? { name: "", pan: 0, tilt: 0, zoom: 100, valid: false };
  }

  // ===== Utility =====

  enumerateControls(): ControlInfo[] {
    if (!this.v4l2) return [];
    return this.v4l2.getAllControls()
      .filter((c) => (c.flags & V4L2_CTRL_FLAG_DISABLED) === 0)
      .map((c) => ({
        name: c.name,
        value: c.value,
        min: c.minimum,
        max: c.maximum,
        step: c.step,
        defaultValue: c.defaultValue,
      }));
  }

  rawXUSet(selector: number, data: number[]): boolean {
    if (!this.v4l2) return false;
    return this.v4l2.xuSetCur(this._xuUnitId, selector, Buffer.from(data));
  }

  rawXUGet(selector: number, len: number): Buffer | null {
    if (!this.v4l2) return null;
    return this.v4l2.xuGetCur(this._xuUnitId, selector, len);
  }

  /** Auto-detect an Insta360 Link device. */
  static autoDetect(): string | null {
    const devices = V4L2.enumDevices();
    for (const d of devices) {
      if (d.card.toLowerCase().includes("insta360")) return d.path;
    }
    return devices[0]?.path ?? null;
  }
}
