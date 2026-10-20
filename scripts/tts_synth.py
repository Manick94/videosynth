"""Phase 2: Local TTS (Windows SAPI, zero-install, zero-VRAM) -> wav + durations"""
import json
import os
import subprocess
import wave

SCRIPT_PATH = "output/script.json"
AUDIO_DIR = "output/audio"

PS_TEMPLATE = r"""
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = -1
$synth.SetOutputToWaveFile("{wav_path}")
$synth.Speak(@"
{text}
"@)
$synth.Dispose()
"""


def synth(text, wav_path):
    ps = PS_TEMPLATE.format(wav_path=wav_path.replace("/", "\\"), text=text.replace("`", "'"))
    subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
        check=True,
        capture_output=True,
    )


def wav_duration(path):
    with wave.open(path, "rb") as w:
        return w.getnframes() / float(w.getframerate())


def main():
    os.makedirs(AUDIO_DIR, exist_ok=True)
    with open(SCRIPT_PATH, encoding="utf-8") as f:
        steps = json.load(f)

    for s in steps:
        wav_path = f"{AUDIO_DIR}/step_{s['step']:02d}.wav"
        print(f"[TTS] step {s['step']}: synthesizing...")
        synth(s["narration"], wav_path)
        dur = wav_duration(wav_path)
        s["audio_path"] = wav_path
        s["duration"] = round(dur, 2)
        print(f"  -> {wav_path} ({dur:.2f}s)")

    with open(SCRIPT_PATH, "w", encoding="utf-8") as f:
        json.dump(steps, f, indent=2)
    print(f"[TTS] updated {SCRIPT_PATH}")


if __name__ == "__main__":
    main()
