from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import tempfile
from typing import Any

from .moderation import analyze_subtitles
from .subtitles import SubtitleEntry

DEFAULT_MODEL_ID = "mlx-community/Qwen2.5-VL-7B-Instruct-4bit"
DEFAULT_INTERVAL_SECONDS = 2.0
FRAME_PROMPT = (
    "Describe this video frame in one short sentence. Focus on any visible romance, immodest "
    "clothing, violence, magic, music, dancing, religious symbols, or scary content."
)


def emit_progress(
    stage: str,
    message: str,
    *,
    current: int | None = None,
    total: int | None = None,
) -> None:
    payload: dict[str, object] = {
        "message": message,
        "stage": stage,
    }
    if current is not None:
        payload["current"] = current
    if total is not None:
        payload["total"] = total

    print(
        f"AIYAAL_FRAME_SCAN:{json.dumps(payload, separators=(',', ':'))}",
        file=sys.stderr,
        flush=True,
    )


def frame_analysis_path(video_path: Path) -> Path:
    return video_path.with_name(f"{video_path.stem}.frames.analysis.json")


def build_visual_rules() -> list[dict[str, Any]]:
    return [
        {
            "ruleId": "vision_romance",
            "category": "relationships",
            "priority": "medium",
            "reason": "Frame may depict romantic or affectionate behavior.",
            "patterns": [
                "kiss",
                "kissing",
                "romantic",
                "date",
                "dating",
                "wedding",
                "bride",
                "groom",
            ],
        },
        {
            "ruleId": "vision_immodesty",
            "category": "immodesty",
            "priority": "medium",
            "reason": "Frame may depict immodest clothing or exposed body areas.",
            "patterns": [
                "bikini",
                "swimsuit",
                "underwear",
                "shirtless",
                "cleavage",
                "bare chest",
            ],
        },
        {
            "ruleId": "vision_music",
            "category": "music",
            "priority": "medium",
            "reason": "Frame may depict music or dancing.",
            "patterns": [
                "dance",
                "dancing",
                "singing",
                "concert",
                "stage performance",
                "microphone",
                "guitar",
                "piano",
                "drums",
                "violin",
            ],
        },
        {
            "ruleId": "vision_magic",
            "category": "magic",
            "priority": "high",
            "reason": "Frame may depict magic, sorcery, or supernatural ritual content.",
            "patterns": [
                "magic",
                "wizard",
                "witch",
                "spell",
                "wand",
                "sorcer",
                "ritual",
                "summoning",
                "demon",
            ],
        },
        {
            "ruleId": "vision_violence",
            "category": "violence",
            "priority": "high",
            "reason": "Frame may depict violence, weapons, or injury.",
            "patterns": [
                "gun",
                "knife",
                "sword",
                "weapon",
                "blood",
                "fight",
                "fighting",
                "attack",
                "explosion",
                "injured",
            ],
        },
        {
            "ruleId": "vision_scary",
            "category": "scary",
            "priority": "low",
            "reason": "Frame may depict frightening creatures or horror imagery.",
            "patterns": [
                "monster",
                "ghost",
                "skeleton",
                "zombie",
                "scary",
                "horror",
                "creepy",
            ],
        },
        {
            "ruleId": "vision_aqeedah",
            "category": "aqeedah",
            "priority": "high",
            "reason": "Frame may depict non-Islamic religious symbolism or worship.",
            "patterns": [
                "cross",
                "church",
                "christmas",
                "santa",
                "worship",
                "idol",
                "temple",
                "statue of a god",
            ],
        },
    ]


def merge_visual_rules(settings: dict[str, Any]) -> dict[str, Any]:
    merged = dict(settings)
    existing_rules = settings.get("rules", [])
    next_rules = [rule for rule in existing_rules if isinstance(rule, dict)]
    existing_rule_ids = {str(rule.get("ruleId", "")).strip() for rule in next_rules}

    for rule in build_visual_rules():
        if rule["ruleId"] in existing_rule_ids:
            continue
        next_rules.append(rule)

    merged["rules"] = next_rules
    return merged


def normalize_caption(text: str) -> str:
    cleaned = " ".join(text.replace("\n", " ").split()).strip()
    if cleaned.lower().startswith("assistant:"):
        cleaned = cleaned.split(":", maxsplit=1)[1].strip()
    return cleaned


def build_frame_entries(captions: list[str], interval_seconds: float) -> list[SubtitleEntry]:
    entries: list[SubtitleEntry] = []
    for index, raw_caption in enumerate(captions, start=1):
        caption = normalize_caption(raw_caption)
        if not caption:
            continue

        start_time = (index - 1) * interval_seconds
        entries.append(
            SubtitleEntry(
                index=index,
                start_time=start_time,
                end_time=start_time + interval_seconds,
                text=caption,
            )
        )

    return collapse_repeated_entries(entries)


def collapse_repeated_entries(entries: list[SubtitleEntry]) -> list[SubtitleEntry]:
    collapsed: list[SubtitleEntry] = []
    for entry in entries:
        if collapsed and collapsed[-1].text == entry.text:
            collapsed[-1].end_time = entry.end_time
            continue
        collapsed.append(entry)
    return collapsed


def extract_frames(
    video_path: Path,
    output_dir: Path,
    interval_seconds: float,
    ffmpeg_path: str,
) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_pattern = output_dir / "frame-%06d.jpg"
    fps = 1 / interval_seconds
    command = [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video_path),
        "-vf",
        f"fps={fps}",
        "-q:v",
        "3",
        str(output_pattern),
    ]

    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        stderr = result.stderr.strip()
        raise RuntimeError(stderr or "ffmpeg frame extraction failed.")

    return sorted(output_dir.glob("frame-*.jpg"))


class MlxCaptioner:
    def __init__(self, model_id: str = DEFAULT_MODEL_ID) -> None:
        from mlx_vlm import load
        from mlx_vlm.prompt_utils import apply_chat_template
        from mlx_vlm.utils import load_config

        self.model_id = model_id
        self._apply_chat_template = apply_chat_template
        self._generate = None
        with contextlib.redirect_stdout(sys.stderr):
            self.model, self.processor = load(model_id)
            self.config = load_config(model_id)

    def caption(self, image_path: str) -> str:
        if self._generate is None:
            from mlx_vlm import generate

            self._generate = generate

        prompt = self._apply_chat_template(
            self.processor,
            self.config,
            FRAME_PROMPT,
            num_images=1,
        )
        with contextlib.redirect_stdout(sys.stderr):
            result = self._generate(
                self.model,
                self.processor,
                prompt,
                image=image_path,
                max_tokens=48,
                temperature=0.0,
                verbose=False,
            )
        return normalize_caption(result.text)


def build_sidecar_payload(
    source_path: Path,
    flagged: list[dict[str, Any]],
    summary: str,
    captions: list[SubtitleEntry],
    model_id: str,
    interval_seconds: float,
) -> dict[str, Any]:
    return {
        "captionModel": model_id,
        "captions": [
            {
                "endTime": entry.end_time,
                "startTime": entry.start_time,
                "text": entry.text,
            }
            for entry in captions
        ],
        "createdAt": datetime.now(tz=timezone.utc).isoformat(),
        "engine": "blacklist",
        "flagged": flagged,
        "sampleIntervalSeconds": interval_seconds,
        "scanMode": "local_vision_poc",
        "summary": summary,
        "videoFileName": source_path.name,
    }


def run_scan(
    video_path: Path,
    settings: dict[str, Any],
    interval_seconds: float = DEFAULT_INTERVAL_SECONDS,
    model_id: str = DEFAULT_MODEL_ID,
) -> dict[str, Any]:
    if interval_seconds <= 0:
        raise ValueError("interval_seconds must be greater than 0.")

    ffmpeg_path = os.getenv("AIYAAL_FFMPEG_PATH", "ffmpeg")
    emit_progress(
        "extract_frames",
        f"Extracting frames every {interval_seconds:.1f}s from {video_path.name}.",
    )

    captions: list[str] = []
    with tempfile.TemporaryDirectory(prefix="al-iyaal-frame-scan-") as temp_dir:
        frame_paths = extract_frames(
            video_path=video_path,
            output_dir=Path(temp_dir),
            interval_seconds=interval_seconds,
            ffmpeg_path=ffmpeg_path,
        )
        emit_progress(
            "extract_frames",
            f"Extracted {len(frame_paths)} frame(s).",
            current=0,
            total=len(frame_paths),
        )
        if frame_paths:
            emit_progress("load_model", f"Loading local vision model {model_id}.")
            captioner = MlxCaptioner(model_id=model_id)

            for index, frame_path in enumerate(frame_paths, start=1):
                emit_progress(
                    "caption",
                    f"Captioning frame {index} of {len(frame_paths)}.",
                    current=index,
                    total=len(frame_paths),
                )
                captions.append(captioner.caption(str(frame_path)))

    entries = build_frame_entries(captions, interval_seconds)
    emit_progress(
        "moderation",
        f"Running local rules over {len(entries)} caption segment(s).",
        current=len(entries),
        total=len(frame_paths),
    )
    merged_settings = merge_visual_rules(settings)
    flagged, summary = analyze_subtitles(entries, merged_settings)
    output_path = frame_analysis_path(video_path)
    emit_progress("write_sidecar", f"Writing {output_path.name}.")
    payload = build_sidecar_payload(
        source_path=video_path,
        flagged=flagged,
        summary=summary if entries else "No frame captions were produced.",
        captions=entries,
        model_id=model_id,
        interval_seconds=interval_seconds,
    )
    output_path.write_text(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False),
        encoding="utf-8",
    )
    emit_progress(
        "completed",
        f"Completed frame scan with {len(flagged)} flagged frame(s).",
        current=len(frame_paths),
        total=len(frame_paths),
    )

    return {
        "flaggedCount": len(flagged),
        "outputPath": str(output_path),
        "summary": payload["summary"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run local MLX frame caption scan.")
    parser.add_argument("--video-path", required=True)
    parser.add_argument("--settings-path", required=True)
    parser.add_argument("--interval-seconds", type=float, default=DEFAULT_INTERVAL_SECONDS)
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID)
    args = parser.parse_args()

    video_path = Path(args.video_path)
    settings_path = Path(args.settings_path)
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    result = run_scan(
        video_path=video_path,
        settings=settings,
        interval_seconds=args.interval_seconds,
        model_id=args.model_id,
    )
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
