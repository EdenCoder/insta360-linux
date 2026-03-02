/**
 * video.ts - Camera stream keeper and terminal video preview
 * ============================================================
 * Keeps the Insta360 Link awake by maintaining an active V4L2 stream,
 * and provides terminal-renderable video preview frames via chafa.
 */

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export class VideoStream {
  private ffmpegProc: ChildProcess | null = null;
  private tmpDir: string;
  private framePath: string;
  private _lastFrame: string = "";
  private captureInterval: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private devicePath: string;
  private width: number;
  private height: number;

  constructor(devicePath: string, width = 60, height = 20) {
    this.devicePath = devicePath;
    this.width = width;
    this.height = height;
    this.tmpDir = mkdtempSync(join(tmpdir(), "insta360-"));
    this.framePath = join(this.tmpDir, "frame.jpg");
  }

  get running() {
    return this._running;
  }

  get lastFrame() {
    return this._lastFrame;
  }

  /**
   * Start the camera stream. This wakes up the camera and keeps it active.
   * Also begins periodic frame capture for the preview.
   */
  start(fps = 2): void {
    if (this._running) return;
    this._running = true;

    // Spawn ffmpeg to continuously read from the camera and overwrite a single JPEG.
    // -update 1 tells ffmpeg to keep overwriting the same output file.
    // We use MJPEG input at low resolution to minimize CPU usage.
    this.ffmpegProc = spawn(
      "ffmpeg",
      [
        "-f", "v4l2",
        "-input_format", "mjpeg",
        "-video_size", "640x480",
        "-framerate", String(fps),
        "-i", this.devicePath,
        "-vf", `fps=${fps}`,
        "-q:v", "5",
        "-update", "1",
        "-y",
        this.framePath,
      ],
      {
        stdio: ["ignore", "ignore", "ignore"],
        detached: false,
      }
    );

    this.ffmpegProc.on("error", () => {
      this._running = false;
    });

    this.ffmpegProc.on("exit", () => {
      this._running = false;
    });

    // Wait a moment for ffmpeg to produce the first frame, then start capturing
    setTimeout(() => {
      this.captureInterval = setInterval(() => {
        this.renderFrame();
      }, Math.round(1000 / fps));
    }, 1000);
  }

  /**
   * Render the latest frame to terminal-art using chafa.
   */
  private renderFrame(): void {
    try {
      if (!existsSync(this.framePath)) return;

      const output = execSync(
        `chafa --format symbols --size ${this.width}x${this.height} --animate off "${this.framePath}" 2>/dev/null`,
        { encoding: "utf8", timeout: 2000 }
      );
      this._lastFrame = output;
    } catch {
      // Frame not ready or chafa failed, skip
    }
  }

  /**
   * Stop the camera stream and clean up.
   */
  stop(): void {
    this._running = false;

    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }

    if (this.ffmpegProc) {
      this.ffmpegProc.kill("SIGTERM");
      this.ffmpegProc = null;
    }

    // Clean up temp files
    try {
      rmSync(this.tmpDir, { recursive: true, force: true });
    } catch {}
  }
}
