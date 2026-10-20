"""Phase 1: VLM analyzes screenshots + instructions.md context -> script.json"""
import base64
import glob
import json
import os
import re

import requests

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "qwen2.5vl:7b"
INPUT_DIR = "ziva5"
OUT_PATH = "output/script.json"

# Screenshot -> business context slice from instructions.md (keeps narration grounded, not hallucinated)
IMAGE_CONTEXT = {
    "ziva1.png": (
        "Dedupe Functionality for existing CSPL customer. When the user does the dedupe, "
        "customer code and all other fields are prefilled and displayed in the dedupe window. "
        "All fields on this screen are frozen and non-editable, so the customer identity cannot be changed."
    ),
    "ziva2.png": (
        "Tenure Eligibility Check screen, applicable for OL, OF, PL, L3, L4 products. "
        "The system checks tenure eligibility for the parent loan before creating the sanction "
        "or triggering the DIY link for a child loan."
    ),
    "ziva3.png": (
        "Continuation of the Tenure Eligibility Check for OL, OF, PL, L3, L4 products, showing "
        "the result of the eligibility validation before sanction."
    ),
    "ziva4.png": (
        "Parent and Child Loan dedupe check, applicable for OL, OF, PL, L3, L4 products. "
        "If the system attempts to create a second child loan while an existing child loan is "
        "already disbursed to the customer, the system alerts with a deviation to restrict "
        "multiple child loans."
    ),
    "ziva5.png": (
        "Continuation of the Parent and Child Loan dedupe deviation alert screen, confirming the "
        "restriction preventing multiple child loan disbursals for the same parent loan customer."
    ),
}

PROMPT_TMPL = """You are writing a short voiceover line for an internal team demo video of a loan
management system called ZIVA. Business context for this exact screen:
"{context}"

Look at the attached screenshot (size {w}x{h} pixels). Reply with ONLY a JSON object, no markdown,
no explanation, in this exact shape:
{{"narration": "<one natural spoken sentence, max 28 words, explaining this screen to the team>",
"focus_coordinate": {{"x": <int pixel x of the most important UI element>, "y": <int pixel y>, "radius": 90}}}}
"""


def b64_image(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def call_vlm(image_path, context, w, h):
    prompt = PROMPT_TMPL.format(context=context, w=w, h=h)
    resp = requests.post(
        OLLAMA_URL,
        json={
            "model": MODEL,
            "prompt": prompt,
            "images": [b64_image(image_path)],
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.3},
        },
        timeout=180,
    )
    resp.raise_for_status()
    raw = resp.json().get("response", "")
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise ValueError(f"no JSON in VLM response: {raw[:200]}")
    return json.loads(match.group(0))


def main():
    from PIL import Image

    files = sorted(
        glob.glob(os.path.join(INPUT_DIR, "*.png")),
        key=lambda p: (len(os.path.basename(p)), os.path.basename(p)),
    )
    steps = []
    for i, path in enumerate(files, 1):
        name = os.path.basename(path)
        context = IMAGE_CONTEXT.get(name, "ZIVA loan system screen.")
        w, h = Image.open(path).size
        print(f"[VLM] step {i}: {name}")
        try:
            data = call_vlm(path, context, w, h)
            narration = data["narration"].strip()
            fc = data["focus_coordinate"]
            fx, fy = int(fc["x"]), int(fc["y"])
            fx = max(0, min(w, fx))
            fy = max(0, min(h, fy))
            radius = int(fc.get("radius", 90))
        except Exception as e:
            print(f"  ! VLM parse failed ({e}), using fallback")
            narration = context.split(".")[0].strip() + "."
            fx, fy, radius = w // 2, h // 2, 90

        steps.append(
            {
                "step": i,
                "image_path": path.replace("\\", "/"),
                "narration": narration,
                "focus_coordinate": {"x": fx, "y": fy, "radius": radius},
                "image_size": {"w": w, "h": h},
            }
        )
        print(f"  narration: {narration}")
        print(f"  focus: ({fx},{fy})")

    os.makedirs("output", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(steps, f, indent=2)
    print(f"[VLM] wrote {OUT_PATH} with {len(steps)} steps")


if __name__ == "__main__":
    main()
