# insta360-linux

Native Linux controller for **Insta360 Link** webcams. Control AI tracking, PTZ (pan/tilt/zoom), camera modes, and image settings directly from the terminal -- no Wine or Windows software needed.

Supports both **Insta360 Link** and **Insta360 Link 2**.

## Features

- **AI Tracking** -- enable/disable person tracking with head, half-body, or full-body framing
- **PTZ Controls** -- pan, tilt, zoom with absolute and relative positioning
- **Camera Modes** -- DeskView (split desk + face), Whiteboard, Overhead document view
- **Image Controls** -- brightness, contrast, saturation, sharpness, white balance, exposure, focus
- **Presets** -- save and recall up to 6 camera positions
- **Gimbal Reset** -- return camera to center position
- **Interactive TUI** -- real-time terminal interface with keyboard controls
- **CLI** -- scriptable command-line interface

## How It Works

Standard V4L2 controls (image settings, PTZ) are accessed via `v4l2-ctl`. Proprietary Insta360 features (AI tracking, camera modes, gimbal reset) are controlled through **UVC Extension Unit** commands using a small C helper that's auto-compiled on first run.

The UVC XU protocol was reverse-engineered by monitoring the official Insta360 Link Controller on Windows (credit to [vrwallace](https://github.com/vrwallace/Insta360-Link-1-and-2-Controller-for-Linux) for the original Pascal implementation this project is ported from).

### XU Selector Map (confirmed)

All camera modes are controlled via **XU Unit 9, Selector 2** (52-byte buffer):

| Mode | byte[0] | byte[1] | Description |
|------|---------|---------|-------------|
| Off/Normal | `0x00` | `0x00` | Standard webcam mode |
| AI Tracking | `0x01` | `0x00` | AI person tracking |
| Whiteboard | `0x04` | `0x01` | Whiteboard capture & straighten |
| Overhead | `0x05` | `0x03` | Document camera view |
| DeskView | `0x06` | `0x10` | Split-screen desk + face |

Tracking framing is controlled via **Selector 19** (1-byte): `0x01` head, `0x02` half body, `0x03` full body.

## Requirements

- Linux with V4L2 support
- Node.js 22+
- `v4l2-ctl` (usually part of `v4l2-utils`)
- `gcc` (for auto-compiling the UVC XU helper)
- `ffmpeg` + `chafa` (for live video preview in the TUI)
- Insta360 Link connected via USB

## Install

```bash
git clone git@github.com:EdenCoder/insta360-linux.git
cd insta360-linux
pnpm install
```

### Device Permissions

To use without `sudo`, install the udev rules:

```bash
sudo cp 99-insta360-link.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
sudo udevadm trigger
```

Or add yourself to the `video` group:

```bash
sudo usermod -aG video $USER
# Log out and back in
```

## Usage

### CLI

```bash
# List devices
npx tsx src/cli.ts list

# Show camera info and all controls
npx tsx src/cli.ts info

# AI Tracking
npx tsx src/cli.ts tracking on
npx tsx src/cli.ts tracking off
npx tsx src/cli.ts frame half          # head | half | full

# PTZ
npx tsx src/cli.ts home                # reset gimbal to center
npx tsx src/cli.ts zoom 200            # 2x zoom (100-400)
npx tsx src/cli.ts pan 36000           # absolute pan
npx tsx src/cli.ts tilt -18000         # absolute tilt
npx tsx src/cli.ts move 5 0            # relative pan right

# Camera Modes
npx tsx src/cli.ts deskview on
npx tsx src/cli.ts whiteboard on
npx tsx src/cli.ts overhead on
npx tsx src/cli.ts normal              # back to standard mode

# Image Controls
npx tsx src/cli.ts brightness 60
npx tsx src/cli.ts contrast 50
npx tsx src/cli.ts wb auto             # or: wb 5600 (Kelvin)
npx tsx src/cli.ts exposure auto       # or: exposure 500
npx tsx src/cli.ts focus auto          # or: focus 50

# Presets
npx tsx src/cli.ts preset save 0
npx tsx src/cli.ts preset recall 0

# Raw XU command (advanced)
npx tsx src/cli.ts xu 3 01

# Verbose mode (shows XU scan, all logs)
npx tsx src/cli.ts -v tracking on
```

### Interactive TUI

```bash
npx tsx src/tui.ts
```

The TUI opens a live video stream to wake the camera and shows a real-time ASCII preview alongside the controls. Requires `ffmpeg` and `chafa`.

| Key | Action |
|-----|--------|
| Arrows | Pan / Tilt |
| `+` / `-` | Zoom in / out |
| `t` | Toggle AI tracking |
| `f` | Cycle frame mode (head / half / full) |
| `d` | Toggle DeskView |
| `w` | Toggle Whiteboard |
| `o` | Toggle Overhead |
| `n` | Normal mode |
| `h` | Home / center gimbal |
| `v` | Toggle video preview |
| `1-6` | Recall preset |
| `q` | Quit |

## Project Structure

```
src/
  v4l2.ts           V4L2 + UVC Extension Unit bindings
  insta360link.ts    High-level camera controller class
  cli.ts             Commander-based CLI
  tui.ts             Ink-based interactive TUI with live video preview
  video.ts           Camera stream keeper and terminal video renderer
```

## Credits

- UVC XU protocol reverse-engineered from the official Insta360 Link Controller via Windows Kernel Streaming property monitoring
- Original Pascal implementation: [vrwallace/Insta360-Link-1-and-2-Controller-for-Linux](https://github.com/vrwallace/Insta360-Link-1-and-2-Controller-for-Linux)
- Additional reference: [Daniel15/WebCamControl](https://github.com/Daniel15/WebCamControl)

## License

MIT
