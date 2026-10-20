"""Phase 3: FFmpeg Ken Burns zoom to focus_coordinate + burned subtitles -> final_explainer.mp4"""
import json
import os
import subprocess
import textwrap

from PIL import Image, ImageDraw, ImageFont

SCRIPT_PATH = "output/script.json"
FRAMES_DIR = "output/frames"
FINAL_OUT = "output/final_explainer.mp4"
W, H = 1280, 720
FPS = 25
ZMAX = 1.15
UPSCALE = 2  # pre-scale source before zoompan so pixel-rounding doesn't show as jitter


def font(size):
    for path in (
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def make_subtitle_png(text, out_path):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    f = font(32)
    lines = textwrap.wrap(text, width=60)
    line_h = 42
    box_h = line_h * len(lines) + 30
    box_top = H - box_h - 40
    draw.rectangle([40, box_top, W - 40, H - 40], fill=(0, 0, 0, 160))
    y = box_top + 15
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=f)
        tw = bbox[2] - bbox[0]
        draw.text(((W - tw) / 2, y), line, font=f, fill=(255, 255, 255, 255))
        y += line_h
    img.save(out_path)


def zoompan_filter(fx, fy, iw, ih, duration):
    # Non-recursive zoom (closed-form on the absolute frame counter `on`) instead of
    # z='zoom+step' — the recursive form accumulates floating-point rounding error
    # frame over frame, which is what shows up as visible wobble/jitter in the pan.
    # Pre-scaling the source 2x before zoompan avoids pixel-snapping at low zoom deltas.
    d = max(1, round(duration * FPS))
    sx, sy = fx * UPSCALE, fy * UPSCALE
    zexpr = f"min(1+({ZMAX}-1)*on/{max(d - 1, 1)},{ZMAX})"
    xexpr = f"max(0,min(iw-iw/zoom,{sx}-(iw/zoom/2)))"
    yexpr = f"max(0,min(ih-ih/zoom,{sy}-(ih/zoom/2)))"
    return f"scale=iw*{UPSCALE}:ih*{UPSCALE},zoompan=z='{zexpr}':x='{xexpr}':y='{yexpr}':d={d}:s={W}x{H}:fps={FPS}"


def build_segment(step, idx):
    img = step["image_path"]
    sub_png = f"{FRAMES_DIR}/sub_{idx:02d}.png"
    make_subtitle_png(step["narration"], sub_png)

    fc = step["focus_coordinate"]
    iw, ih = step["image_size"]["w"], step["image_size"]["h"]
    duration = step["duration"]
    zp = zoompan_filter(fc["x"], fc["y"], iw, ih, duration)

    out_path = f"{FRAMES_DIR}/seg_{idx:02d}.mp4"
    filter_complex = f"[0:v]{zp}[zoomed];[zoomed][1:v]overlay=0:0[outv]"
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-i", img,
        "-loop", "1", "-i", sub_png,
        "-i", step["audio_path"],
        "-filter_complex", filter_complex,
        "-map", "[outv]", "-map", "2:a",
        "-c:v", "libx264", "-preset", "fast", "-c:a", "aac",
        "-pix_fmt", "yuv420p", "-t", str(duration),
        out_path,
    ]
    print(f"[FFMPEG] segment {idx}: {os.path.basename(img)} ({duration}s)")
    subprocess.run(cmd, check=True, capture_output=True)
    return out_path


def main():
    os.makedirs(FRAMES_DIR, exist_ok=True)
    with open(SCRIPT_PATH, encoding="utf-8") as f:
        steps = json.load(f)

    seg_paths = [build_segment(s, i) for i, s in enumerate(steps, 1)]

    list_path = f"{FRAMES_DIR}/concat_list.txt"
    with open(list_path, "w", encoding="utf-8") as f:
        for p in seg_paths:
            f.write(f"file '{os.path.abspath(p)}'\n")

    print("[FFMPEG] concatenating final video...")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_path,
         "-c", "copy", FINAL_OUT],
        check=True, capture_output=True,
    )
    print(f"[FFMPEG] done -> {FINAL_OUT}")


if __name__ == "__main__":
    main()
